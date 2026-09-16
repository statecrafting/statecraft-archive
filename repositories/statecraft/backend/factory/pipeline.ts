/**
 * The stamp pipeline (spec 005 §3): export the pinned template, read its
 * contract, build the born-with cert, run the scaffold verb, create the repo,
 * push the tree, and watch the born-green verify run. The endpoint kicks this
 * un-awaited; progress is recorded on the StampJob via the status state machine,
 * so a reader (GET /stamps/:jobId) always sees where it is. Capabilities are
 * gated on the contract version actually read (scaffold verb, cert emission), so
 * the factory upgrades itself when the template does (spec 005 §1).
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { governance } from "~encore/clients";

import { logError, logInfo } from "../lib/logger";
import { getInstallationToken } from "../tenants/github-app";

import { stampAttestationPayload, stampSubject } from "./attest";
import { buildCert, certHash } from "./cert";
import {
  FACTORY_STAMPED_BY_ID,
  TEMPLATE_CACHE_DIR,
  TEMPLATE_REPO,
  VERIFY_POLL_INTERVAL_MS,
  VERIFY_TIMEOUT_MS,
} from "./config";
import {
  assertSupportedContract,
  hasScaffoldVerb,
  readContract,
  type ResolvedSlots,
  supportsCert,
  validateSlots,
} from "./contract";
import {
  cloneExisting,
  ensureTemplateCache,
  exportPinned,
  overlayCommitPushBranch,
  pushInitialCommit,
  resolveRef,
} from "./git";
import { createRepo, enablePages, getRepo, openPullRequest, setRepoVariable, waitForVerify } from "./github";
import { runScaffold } from "./scaffold";
import { fail, getJob, patchJob, transition } from "./store";

/** Minimal factory-side substitution for a contract with no scaffold verb (enrahitu spec 014 §3 step 2). */
async function v0Substitute(workdir: string, slots: ResolvedSlots): Promise<void> {
  const pkgPath = join(workdir, "package.json");
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, unknown>;
    pkg.name = slots.appName;
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  } catch {
    // No package.json to substitute: nothing to do.
  }
}

export async function runStampPipeline(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) return;
  let workdir: string | undefined;
  let adoptRepoDir: string | undefined;

  try {
    await transition(jobId, "stamping");

    // 1. Export the pinned template tree.
    await ensureTemplateCache(TEMPLATE_CACHE_DIR, TEMPLATE_REPO);
    const pinnedSha = await resolveRef(TEMPLATE_CACHE_DIR, job.templateRef);
    workdir = await mkdtemp(join(tmpdir(), "factory-stamp-"));
    await exportPinned(TEMPLATE_CACHE_DIR, pinnedSha, workdir);

    // 2. Read + validate the contract.
    const contract = readContract(await readFile(join(workdir, "template.toml"), "utf8"));
    assertSupportedContract(contract);
    await patchJob(jobId, { contractVersion: contract.contractVersion });
    const slots = validateSlots(contract, {
      appName: job.appName,
      org: job.org,
      // The tenant's flavor choice (persisted on the job) reaches the scaffold
      // verb here; validateSlots checks it against [slots].frontend.allowed and
      // resolves the contract default when empty (enrahitu spec 015).
      frontend: job.frontend || undefined,
    });

    // 3. Build the born-with cert (gated on contract support).
    let certPath: string | undefined;
    let hash: string | undefined;
    if (supportsCert(contract)) {
      const cert = buildCert({
        appName: job.appName,
        org: job.org,
        templateName: contract.templateName,
        templateVersion: contract.templateVersion,
        contractVersion: contract.contractVersion,
        commit: pinnedSha,
        posture: job.posture,
        stampedById: FACTORY_STAMPED_BY_ID,
      });
      hash = certHash(cert);
      certPath = join(tmpdir(), `factory-cert-${jobId}.json`);
      await writeFile(certPath, `${JSON.stringify(cert, null, 2)}\n`, "utf8");
    } else {
      logInfo("factory.cert_skipped", { jobId, contractVersion: contract.contractVersion });
    }

    // 4. Scaffold (preferred) or v0 fallback.
    if (hasScaffoldVerb(contract)) {
      await runScaffold({
        workdir,
        appName: slots.appName,
        org: slots.org,
        frontend: slots.frontend || undefined,
        certPath,
        stampedFrom: pinnedSha,
      });
    } else {
      await v0Substitute(workdir, slots);
      if (certPath) {
        const dest = join(workdir, ".statecraft", "born-with.json");
        await mkdir(join(workdir, ".statecraft"), { recursive: true });
        await writeFile(dest, await readFile(certPath, "utf8"), "utf8");
      }
    }

    if (hash) await patchJob(jobId, { certHash: hash });
    if (certPath) await rm(certPath, { force: true }).catch(() => {});

    // 4b. Anchor the born-with cert in the governance attestation ledger (spec
    // 008), so the repo-local cert and the platform ledger are mutually
    // checkable (enrahitu spec 012 §4). Done before any repo mutation: a stamp
    // never lands a repo without its anchor.
    if (hash) {
      await governance.record({
        kind: "stamp",
        subject: stampSubject({ org: job.org, appName: job.appName }),
        actor: FACTORY_STAMPED_BY_ID,
        payload: stampAttestationPayload({
          mode: job.mode,
          appName: job.appName,
          org: job.org,
          templateCommit: pinnedSha,
          contractVersion: contract.contractVersion,
          posture: job.posture,
        }),
        certHash: hash,
      });
      logInfo("factory.cert_anchored", { jobId, certHash: hash });
    }

    // 5-6. Land the stamped tree: create a fresh repo (initial commit) or adopt
    // an existing one (PR the chassis onto its default branch). Both yield the
    // SHA the born-green verify then runs on.
    await transition(jobId, "pushing");
    const repoName = job.appName;
    let headSha: string;
    if (job.mode === "adopt") {
      const existing = await getRepo(job.installationId, job.org, repoName);
      adoptRepoDir = await mkdtemp(join(tmpdir(), "factory-adopt-"));
      const cloneToken = await getInstallationToken(job.installationId);
      await cloneExisting({ org: job.org, repo: repoName, token: cloneToken, destDir: adoptRepoDir });
      const branch = `factory/adopt-${pinnedSha.slice(0, 12)}`;
      const pushToken = await getInstallationToken(job.installationId);
      headSha = await overlayCommitPushBranch({
        repoDir: adoptRepoDir,
        overlayDir: workdir,
        branch,
        message: `Adopt enrahitu chassis @ ${pinnedSha.slice(0, 7)} into ${repoName}`,
        org: job.org,
        repo: repoName,
        token: pushToken,
      });
      const pr = await openPullRequest(job.installationId, job.org, repoName, {
        head: branch,
        base: existing.defaultBranch,
        title: `Adopt the enrahitu chassis (${job.appName})`,
        body:
          `statecraft Factory stamped the enrahitu chassis (contract ${contract.contractVersion}) ` +
          `at \`${pinnedSha}\` onto this existing repo. Files unique to the repo are preserved; ` +
          `chassis files were overlaid. Review the diff, then merge.\n\n` +
          (hash ? `Born-with cert hash: \`${hash}\` (anchored in the platform ledger).\n` : ""),
      });
      await patchJob(jobId, { prUrl: pr.url });
      logInfo("factory.adopt_pr_opened", { jobId, pr: pr.url });
    } else {
      const repo = await createRepo(job.installationId, job.org, repoName);
      const token = await getInstallationToken(job.installationId);
      headSha = await pushInitialCommit({
        workdir,
        org: job.org,
        repo: repo.name,
        token,
        message: `Stamp ${job.appName} from enrahitu ${pinnedSha.slice(0, 7)}`,
      });
    }

    // 6b. Provision GitHub Pages when the stamp opted in (create mode only).
    // Best-effort: the repo is pushed and Pages is an optional preview, so a
    // failure here (the App lacking the Pages/Variables grant per spec 004 §1,
    // or Pages already enabled) is logged and the stamp continues to verify.
    // Adopt lands via a PR, so ENABLE_PAGES-on-push would not apply until merge.
    if (job.pages && job.mode !== "adopt") {
      try {
        await enablePages(job.installationId, job.org, repoName);
        await setRepoVariable(job.installationId, job.org, repoName, "ENABLE_PAGES", "true");
        logInfo("factory.pages_enabled", { jobId, repo: `${job.org}/${repoName}` });
      } catch (err) {
        logError("factory.pages_enable_failed", {
          jobId,
          repo: `${job.org}/${repoName}`,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 7. Watch the born-green verify run (on the pushed SHA / PR head).
    await transition(jobId, "verifying");
    const result = await waitForVerify(
      job.installationId,
      job.org,
      repoName,
      headSha,
      VERIFY_TIMEOUT_MS,
      VERIFY_POLL_INTERVAL_MS,
    );
    const patch: Partial<{ checksRunId: string; error: string }> = {};
    if (result.runId) patch.checksRunId = result.runId;
    if (!result.green) patch.error = "born-green verify run did not pass";
    await transition(jobId, result.green ? "green" : "failed", patch);
    logInfo("factory.stamp_done", {
      jobId,
      mode: job.mode,
      green: result.green,
      repo: `${job.org}/${repoName}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("factory.stamp_failed", { jobId, message });
    await fail(jobId, message).catch(() => {});
  } finally {
    if (workdir) await rm(workdir, { recursive: true, force: true }).catch(() => {});
    if (adoptRepoDir) await rm(adoptRepoDir, { recursive: true, force: true }).catch(() => {});
  }
}
