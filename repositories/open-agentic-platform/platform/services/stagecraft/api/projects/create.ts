// Spec 112 §5.2 — ACP-native project creation endpoint.
//
// Drives the six absorbed scaffold operations (§5.3) end-to-end:
//
//   1. Resolve adapter + verify warmup readiness.
//   2. Insert a scaffold_jobs row in `running` state.
//   3. Create the GitHub repo (auto_init=false → commit #1 is ours).
//   4. Run the per-request scaffold against the prebuilt profile, copy
//      into a temp dir, install user-selected extras, write the L0
//      pipeline-state seed.
//   5. Run server-side artifact extraction (when seed inputs supplied).
//   6. Init + commit + push to the new GitHub repo.
//   7. Insert projects / project_repos / project_members / environments
//      rows + audit event in one transaction.
//   8. Mark the job succeeded and clean up the local working tree.
//
// Failure handling (spec 112 §10):
//   - Pre-repo-create failures (validation, no PAT, warmup not ready)
//     surface as APIError.failedPrecondition / invalidArgument with the
//     actual cause — never the Encore-wrapped "an internal error occurred".
//   - Post-repo-create failures mark the scaffold_jobs row `orphaned` so
//     an operator can reclaim the empty repo. The error is rethrown as
//     APIError.internal with the underlying message attached.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import log from "encore.dev/log";
import { and, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  auditLog,
  environments,
  githubInstallations,
  projectMembers,
  projectRepos,
  projects,
  scaffoldJobs,
} from "../db/schema";
import { hasOrgPermission } from "../auth/membership";
import { brokerInstallationToken } from "../github/repoInit";
import { loadSubstrateForOrg } from "../factory/substrateBrowser";
import { loadOrgView } from "../factory/browse";
import type { SubstrateTranslation } from "../factory/translator";
import { listAdapterViews } from "../factory/adapterView";
import {
  isFactoryAdmitted,
  loadLatestAdmission,
} from "../factory/admission";
import { publishProjectCatalogUpsert } from "../sync/projectCatalogRelay";
import { createRepoWithBranchProtection } from "./scaffold/githubRepoCreate";
import { gitInitAndPush } from "./scaffold/gitInitAndPush";
import {
  scaffoldFromPrebuilt,
  regenerateProducedClient,
  regenerateProducedIndex,
} from "./scaffold/perRequestScaffold";
import { provisionTenantSigningKey } from "./scaffold/tenantSigningKey";
import { buildL0PipelineStateSeed } from "./scaffold/seedPipelineState";
import { buildProjectOpenDeepLink } from "./scaffold/deepLink";
import { extractArtifactsIntoTree } from "./scaffold/artifactExtract";
import { resolveScaffoldUpstream } from "./scaffold/scheduler";
import {
  getInitStatus,
  isTemplateCacheReady,
  isTemplateCacheRefreshing,
  defaultWorkspaceDir,
  specSpineBin,
  encoreBinDir,
} from "./scaffold/templateCache";
import {
  isKnownModule,
  pickProfileFromModules,
  profileModulesFor,
} from "./scaffold/moduleCatalog";
import {
  deriveModuleCatalogFromView,
  deriveProfileDefaultsFromView,
} from "../factory/moduleCatalog";
import type {
  ScaffoldAdapterRef,
  ScaffoldSeedInput,
  ScaffoldStep,
} from "./scaffold/types";

// ── Request / response ─────────────────────────────────────────────────

export interface CreateFactoryProjectRequest {
  /** Human-readable project name. */
  name: string;
  /** URL-safe slug, unique within the org. */
  slug: string;
  description?: string;
  /** UUID of a row in `factory_adapters` — the adapter to scaffold from. */
  adapterId: string;
  /** Matches Build Spec project.variant; one of "single-public" | "single-internal" | "dual". */
  variant: string;
  /** Modules selected from MODULE_CATALOG. Filtered server-side. */
  modules?: string[];
  /** GitHub repo name (created under the org's active App installation). */
  repoName: string;
  isPrivate?: boolean;
  /** Seed uploads already staged in the project bucket (spec 112 §4.3). */
  seedInputs?: ScaffoldSeedInput[];
  /**
   * Spec 227 Stage 2: Base-app config (BFF gateway knobs) plumbed into the
   * scaffolded app's committed `apps/api/.env.example`. Omitted/blank leaves the
   * template's commented default.
   */
  bffPrivateApiBaseUrl?: string;
  gatewayTimeoutMs?: number;
  /**
   * Spec 229 auth-driver axis: the app-level AUTH_DRIVER patched into the
   * scaffolded app's `apps/api/.env.example`. "mock" (dev) or "rauthy" (prod);
   * defaults to "rauthy" when omitted. Every real IdP federates inside Rauthy.
   */
  authDriver?: string;
}

export interface CreateFactoryProjectResponse {
  projectId: string;
  repoUrl: string;
  cloneUrl: string;
  opcDeepLink: string;
  scaffoldJobId: string;
  factoryAdapterId: string;
  /** Spec 112 §11 / Phase 7 — auto-provisioned dev environment row. */
  devEnvironmentId: string;
  /** Profile chosen by pickProfileFromModules (informational, for UI). */
  profile: string;
}

// ── Endpoint ───────────────────────────────────────────────────────────

export const createFactoryProject = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/projects/factory-create",
  },
  async (
    req: CreateFactoryProjectRequest
  ): Promise<CreateFactoryProjectResponse> => {
    const auth = getAuthData()!;
    validateSlug(req.slug);
    validateRepoName(req.repoName);
    validateVariant(req.variant);
    // Spec 227 Stage 2: gateway timeout is a positive integer (milliseconds).
    if (
      req.gatewayTimeoutMs !== undefined &&
      (!Number.isInteger(req.gatewayTimeoutMs) || req.gatewayTimeoutMs <= 0)
    ) {
      throw APIError.invalidArgument(
        "gatewayTimeoutMs must be a positive integer (milliseconds)"
      );
    }
    // Spec 227 Stage 2: guard the BFF URL so it cannot inject env lines or a
    // non-URL value into the scaffolded apps/api/.env.example. Empty is allowed
    // (keeps the template default); otherwise it must be a plain http(s) URL
    // with no control characters.
    if (req.bffPrivateApiBaseUrl) {
      const url = req.bffPrivateApiBaseUrl;
      const hasControlChar = [...url].some(
        (c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f
      );
      if (hasControlChar || !/^https?:\/\/\S+$/.test(url)) {
        throw APIError.invalidArgument(
          "bffPrivateApiBaseUrl must be an http(s) URL with no control characters"
        );
      }
    }
    // Spec 229 auth-driver axis: only the two app-level drivers are accepted.
    if (
      req.authDriver !== undefined &&
      req.authDriver !== "mock" &&
      req.authDriver !== "rauthy"
    ) {
      throw APIError.invalidArgument('authDriver must be "mock" or "rauthy"');
    }
    if (!hasOrgPermission(auth.platformRole, "project:create")) {
      throw APIError.permissionDenied(
        "Insufficient permissions to create projects in this org"
      );
    }

    // Spec 227 Stage 1: the module catalog is derived from the org's admitted
    // adapter manifests (the substrate), not a hand-mirrored constant, so
    // `isKnownModule` validates against what the adapter actually exposes.
    // Load the OrgView once and reuse its substrate for both the catalog and
    // the adapter resolution below, so a create request makes a single
    // substrate round-trip (ai-review on #533).
    const orgView = await loadOrgView(auth.orgId);
    const catalog = deriveModuleCatalogFromView(orgView, auth.orgId);
    // Spec 227 Stage 2: per-profile defaults from the same admitted view, so the
    // prebuilt profile's built-in modules are filtered out of the extras.
    const profiles = deriveProfileDefaultsFromView(orgView, auth.orgId);
    const selectedModules = (req.modules ?? []).filter((id) =>
      isKnownModule(catalog, id)
    );

    // ── 1. Warmup readiness — Create blocks if cache/prebuilds aren't up. ──
    const status = getInitStatus();
    if (isTemplateCacheRefreshing()) {
      throw APIError.failedPrecondition(
        `Template cache is still initializing (step: ${status.step}, ${status.progress}%). ` +
          `Please retry in a couple of minutes.`
      );
    }
    if (!isTemplateCacheReady() || !status.ready) {
      throw APIError.failedPrecondition(
        status.error
          ? `Scaffold infrastructure not ready: ${status.error}`
          : `Scaffold infrastructure not ready (step: ${status.step}, ${status.progress}%). ` +
              `Wait for warmup to complete and retry.`
      );
    }

    // ── 2. Resolve the factory adapter + verify scaffold_source_id. ───
    // Spec 140 §2.2 — adapter manifest carries `scaffold_source_id`
    // (an id, not a URL). The actual clone target lives in
    // `factory_upstreams` for the same org and is resolved by
    // `scheduler.ts::resolveScaffoldUpstream` at warmup time.
    const adapter = await loadFactoryAdapter(
      auth.orgId,
      req.adapterId,
      orgView.substrate
    );
    const manifest = adapter.manifest;

    // Spec 112 §10 — Create-eligibility gate. Adapters that declare a
    // non-Node-24 scaffold runtime are not executable on statecraft (web
    // UI is Node-24-only); they need OPC-side dispatch via spec 110.
    // The check accepts both `scaffold.runtime` (legacy block) and
    // `scaffold_runtime` (spec 139 §7.2 / spec 140 §2.1 top-level).
    const declaredRuntime =
      (manifest as { scaffold?: { runtime?: string } }).scaffold?.runtime ??
      (typeof (manifest as { scaffold_runtime?: unknown }).scaffold_runtime ===
      "string"
        ? ((manifest as { scaffold_runtime: string }).scaffold_runtime)
        : undefined);
    if (declaredRuntime && declaredRuntime !== "node-24") {
      throw APIError.failedPrecondition(
        `Factory adapter ${adapter.name}@${adapter.version} declares scaffold runtime "${declaredRuntime}". ` +
          `Statecraft Create executes Node-24 adapters only (spec 112 §10); ` +
          `non-Node-24 scaffolds must dispatch to OPC.`
      );
    }

    // Spec 199 FR-009 / spec 198 D-5 — the scaffold source was resolved at
    // ADMISSION time from the manifest's org-agnostic
    // `scaffold.source.remote`; the create path reads the admission
    // record. The flat manifest `scaffold_source_id` (spec 140 §2.2,
    // injected at ingest) is retired.
    const admissionState = await loadLatestAdmission(auth.orgId, adapter.origin);
    const resolution = admissionState.scaffoldResolutions[adapter.name];
    if (!resolution) {
      throw APIError.failedPrecondition(
        `Factory adapter ${adapter.name}@${adapter.version} has no scaffold-source resolution on its admission record. ` +
          `Register the scaffold upstream at /app/factory/upstreams and re-run /factory-sync (spec 199 FR-009).`
      );
    }
    const upstream = await resolveScaffoldUpstream(
      auth.orgId,
      resolution.source_id,
    );
    if (!upstream) {
      throw APIError.failedPrecondition(
        `Factory adapter ${adapter.name}@${adapter.version} resolved scaffold source "${resolution.source_id}" at admission, but no factory_upstreams row matches it now. ` +
          `Register the upstream at /app/factory/upstreams and re-run /factory-sync (spec 199 FR-009).`
      );
    }

    // ── 3. The factory upstream PAT is optional. The scaffold path loads it
    // on demand and falls back to an anonymous clone (public template repos);
    // a private repo without a PAT surfaces a clear clone error downstream
    // rather than a preemptive block here.

    const profile = pickProfileFromModules(req.variant, selectedModules);
    const profileBuiltIns = profileModulesFor(profiles, profile);

    const adapterRef: ScaffoldAdapterRef = {
      id: adapter.id,
      name: adapter.name,
      version: adapter.version,
      sourceSha: adapter.sourceSha,
    };

    // ── 4. Resolve the GitHub App installation + token. ───────────────
    const installation = await loadActiveInstallation(auth.orgId);
    const { token } = await brokerInstallationToken(installation.installationId, {
      contents: "write",
      administration: "write",
      actions: "write",
      workflows: "write",
      // Spec 220 FR-003: setting the OAP_SIGNING_KEY Actions secret hits
      // `/repos/{repo}/actions/secrets/*`, which GitHub governs under the
      // dedicated `secrets` permission, NOT `actions`. Without this the
      // public-key fetch 403s ("Resource not accessible by integration").
      secrets: "write",
    });

    // ── 5. Insert a running scaffold_jobs row. ────────────────────────
    const [job] = await db
      .insert(scaffoldJobs)
      .values({
        orgId: auth.orgId,
        factoryAdapterId: adapter.id,
        requestedBy: auth.userID,
        variant: req.variant,
        profileName: profile,
        status: "running",
        step: "repo-create",
        githubOrg: installation.githubOrgLogin,
        repoName: req.repoName,
        metadata: {
          adapter: { name: adapter.name, version: adapter.version },
          selectedModules,
          seedInputCount: req.seedInputs?.length ?? 0,
          // Spec 227 Stage 2: record the (validated) Base-app config knobs so an
          // injected or odd value is traceable.
          baseAppConfig: {
            bffPrivateApiBaseUrl: req.bffPrivateApiBaseUrl,
            gatewayTimeoutMs: req.gatewayTimeoutMs,
          },
        },
      })
      .returning();

    // ── 6. Create the GitHub repo. (Past this point, failures = orphan.) ─
    let repoCreate;
    try {
      repoCreate = await createRepoWithBranchProtection({
        token,
        githubOrg: installation.githubOrgLogin,
        repoName: req.repoName,
        isPrivate: req.isPrivate ?? true,
        description: req.description ?? "",
      });
    } catch (err) {
      await markJobFailed(job.id, "repo-create", err);
      // Pre-repo failure — no orphan to leave behind.
      const msg = err instanceof Error ? err.message : String(err);
      if (/already exists/i.test(msg)) {
        throw APIError.alreadyExists(
          `GitHub repository ${installation.githubOrgLogin}/${req.repoName} already exists`
        );
      }
      throw APIError.internal(`Failed to create GitHub repository: ${msg}`);
    }

    // ── 7. Per-request scaffold + seed write + push. ──────────────────
    const workspace = defaultWorkspaceDir();
    const tmpRoot = await mkdtemp(join(tmpdir(), "statecraft-create-"));
    const projectRoot = join(tmpRoot, req.repoName);

    const pipelineStateSeed = buildL0PipelineStateSeed(adapterRef);
    let commitSha = "";
    // Spec 220 FR-003: the Ed25519 public key of the tenant signer minted
    // below, recorded in the project.created audit for attribution.
    let signerPublicKey = "";

    try {
      await advanceStep(job.id, "run-entry");
      await scaffoldFromPrebuilt({
        workspaceDir: workspace,
        profile,
        selectedModules,
        // Spec 227 Stage 1: pass the already-derived catalog through so
        // extrasFor resolves install order without a second substrate load.
        catalog,
        // Spec 227 Stage 2: the profile's manifest-declared built-in modules,
        // so extrasFor does not re-compose what the prebuilt already ships.
        profileBuiltIns,
        // Spec 227 Stage 2: Base-app config plumbed into the produced app's
        // committed apps/api/.env.example.
        baseAppConfig: {
          privateApiBaseUrl: req.bffPrivateApiBaseUrl,
          gatewayTimeoutMs: req.gatewayTimeoutMs,
          authDriver: req.authDriver,
        },
        destDir: projectRoot,
        pipelineStateSeed: pipelineStateSeed as unknown as Record<string, unknown>,
        // Spec 167 §2.3: adapter identity + manifest feed the .kernel-version
        // born-with stamp written into commit #1.
        adapter: adapterRef,
        manifest,
      });

      if (req.seedInputs && req.seedInputs.length > 0) {
        await advanceStep(job.id, "extract-artifacts");
        await extractArtifactsIntoTree({
          projectRoot,
          inputs: req.seedInputs,
        });
      }

      // Spec 220 FR-003 (OQ-3): mint the tenant's Ed25519 signing key and set
      // it as the produced repo's OAP_SIGNING_KEY Actions secret BEFORE the
      // first push, so commit #1's born-with CI can fire `tenant-emit
      // build-certificate --require-operator-key` against a resolvable
      // operator key rather than halting on the ephemeral fallback. A failure
      // orphans the job on the same fail-closed path as push.
      await advanceStep(job.id, "provision-signing-key");
      const signer = await provisionTenantSigningKey(token, repoCreate.fullName);
      signerPublicKey = signer.publicKeyB64;

      // Spec 112 §5.3 + spec 220 AC-2: regenerate the produced app's codebase
      // index over the FINAL tree so commit #1 ships a fresh, committed
      // `.derived`. The generator strips the template's `.derived` precisely
      // because it must be recomputed against the produced tree (seeded specs,
      // born-with Makefile + tools/lint, the added oap-build.yml); the produced
      // app's own born-with CI gates on `spec-spine index check`, so without
      // this every produced app is born red (index absent, exit 3), which also
      // blocks the spec 220 certificate emission. Fail-closed: a scaffold that
      // cannot produce a fresh index orphans the job rather than pushing a
      // red-on-arrival repo.
      // Spec 220 AC-2 (Option C): regenerate the produced app's typed Encore
      // client over the FINAL composed graph with the pinned CLI, so the
      // committed `apps/web/src/lib/encore-client.ts` matches what the produced
      // app's own `Typed client up-to-date` CI job regenerates. Runs before the
      // index regen so the committed `.derived` reflects the fresh client.
      await advanceStep(job.id, "regenerate-index");
      await regenerateProducedClient({
        dest: projectRoot,
        encoreBinDir: encoreBinDir(workspace),
        workspaceDir: workspace,
      });
      await regenerateProducedIndex({
        dest: projectRoot,
        specSpineBin: specSpineBin(workspace),
        workspaceDir: workspace,
      });

      await advanceStep(job.id, "push-initial");
      const pushed = await gitInitAndPush({
        projectRoot,
        githubOrg: installation.githubOrgLogin,
        repoName: req.repoName,
        token,
        branch: repoCreate.defaultBranch,
        commitMessage: "Initial commit",
        authorName: "Statecraft",
        authorEmail: "noreply@statecraft.ing",
      });
      commitSha = pushed.commitSha;
    } catch (err) {
      await markJobOrphaned(
        job.id,
        installation.githubOrgLogin,
        req.repoName,
        err
      );
      await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      // `aborted`, not `internal`: production Encore redacts internal
      // messages to a generic 500, leaving the real cause readable only
      // in pod logs while the user retries blind. The message is already
      // token-redacted by the scaffold subprocess wrappers, and the job
      // id lets an operator find the orphaned row.
      throw APIError.aborted(
        `Scaffold/push failed: ${msg} (scaffold job ${job.id} orphaned — operator reclaim)`
      );
    }

    // ── 8. DB transaction: project + repo + member + env + audit. ─────
    let projectRow: typeof projects.$inferSelect;
    let devEnvRow: typeof environments.$inferSelect;
    try {
      const tx = await db.transaction(async (tx) => {
        const [p] = await tx
          .insert(projects)
          .values({
            orgId: auth.orgId,
            name: req.name,
            slug: req.slug,
            description: req.description ?? "",
            objectStoreBucket: `oap-${auth.orgSlug || "unknown"}-${req.slug}`,
            factoryAdapterId: adapter.id,
            // Spec 227 Stage 4: the opt-in Redis infra selection (the factory
            // data-redis module) is fixed at scaffold; the deploy trigger reads
            // it to provision a dev preview Redis.
            usesRedis: selectedModules.includes("data-redis"),
            createdBy: auth.userID,
          })
          .returning();
        await tx.insert(projectRepos).values({
          projectId: p.id,
          githubOrg: installation.githubOrgLogin,
          repoName: req.repoName,
          defaultBranch: repoCreate.defaultBranch,
          isPrimary: true,
          githubInstallId: installation.installationId,
        });
        await tx.insert(projectMembers).values({
          projectId: p.id,
          userId: auth.userID,
          role: "admin",
        });
        // Spec 112 Phase 7 — auto-provision the development env row so
        // POST /api/projects/:id/factory/deploy and the PR webhook path
        // both target a pre-existing row instead of one path lazy-creating
        // and the other not. Pure DB insert; no namespace is created on
        // the cluster until something actually deploys.
        const namespaceSlug = `oap-${auth.orgSlug || "unknown"}-${req.slug}-dev`;
        const [devEnv] = await tx
          .insert(environments)
          .values({
            projectId: p.id,
            name: "development",
            kind: "development",
            k8sNamespace: namespaceSlug,
            autoDeployBranch: repoCreate.defaultBranch,
            requiresApproval: false,
          })
          .returning();
        await tx.insert(auditLog).values({
          actorUserId: auth.userID,
          action: "project.created",
          targetType: "project",
          targetId: p.id,
          metadata: {
            name: req.name,
            slug: req.slug,
            factoryAdapterId: adapter.id,
            adapter: `${adapter.name}@${adapter.version}`,
            variant: req.variant,
            profile,
            selectedModules,
            // Spec 227 Stage 2: the (validated) Base-app config knobs, for audit
            // traceability of any injected or odd value.
            baseAppConfig: {
              bffPrivateApiBaseUrl: req.bffPrivateApiBaseUrl,
              gatewayTimeoutMs: req.gatewayTimeoutMs,
            },
            githubOrg: installation.githubOrgLogin,
            repoName: req.repoName,
            githubRepoUrl: repoCreate.htmlUrl,
            commitSha,
            // Spec 220 FR-003: attributes the born-with certificate signer.
            signerPublicKey,
            scaffoldJobId: job.id,
            devEnvironmentId: devEnv.id,
            pipelineStateSeed: {
              schema_version: pipelineStateSeed.schema_version,
              pipeline_id: pipelineStateSeed.pipeline.id,
            },
            orgId: auth.orgId,
          },
        });
        return { project: p, devEnv };
      });
      projectRow = tx.project;
      devEnvRow = tx.devEnv;
    } catch (err) {
      await markJobOrphaned(
        job.id,
        installation.githubOrgLogin,
        req.repoName,
        err
      );
      await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
      log.error("Project DB transaction failed after GitHub push", {
        jobId: job.id,
        githubRepo: repoCreate.fullName,
        error: err instanceof Error ? err.message : String(err),
      });
      const msg = err instanceof Error ? err.message : String(err);
      if (/unique|duplicate/i.test(msg)) {
        throw APIError.alreadyExists(
          "A project with that slug already exists in this org"
        );
      }
      // Typed (non-internal) so the real cause survives prod redaction —
      // same rationale as the scaffold/push failure above.
      throw APIError.aborted(
        `Failed to record project: ${msg} (scaffold job ${job.id} orphaned — operator reclaim)`
      );
    }

    // ── 9. Mark scaffold_jobs succeeded + clean up the working tree. ──
    await db
      .update(scaffoldJobs)
      .set({
        status: "succeeded",
        step: "cleanup",
        projectId: projectRow.id,
        cloneUrl: repoCreate.cloneUrl,
        commitSha,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scaffoldJobs.id, job.id));
    await rm(tmpRoot, { recursive: true, force: true }).catch((err) => {
      log.warn("scaffold cleanup failed (non-fatal)", {
        tmpRoot,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    const opcDeepLink = buildProjectOpenDeepLink({
      projectId: projectRow.id,
      cloneUrl: repoCreate.cloneUrl,
      detectionLevel: "scaffold_only",
    });

    // Spec 112 Phase 8 — broadcast the new project to connected OPCs.
    // Fire-and-log: a sync hiccup must not roll back the project we
    // just created.
    void publishProjectCatalogUpsert({
      orgId: auth.orgId,
      project: {
        id: projectRow.id,
        name: projectRow.name,
        slug: projectRow.slug,
        description: projectRow.description,
        factoryAdapterId: adapter.id,
        detectionLevel: "scaffold_only",
        updatedAt: projectRow.updatedAt,
      },
      repo: {
        githubOrg: installation.githubOrgLogin,
        repoName: req.repoName,
        defaultBranch: repoCreate.defaultBranch,
      },
    }).catch((err) => {
      log.warn("factory project create: catalog upsert broadcast failed", {
        projectId: projectRow.id,
        err: err instanceof Error ? err.message : String(err),
      });
    });

    log.info("factory project created", {
      projectId: projectRow.id,
      repoName: req.repoName,
      adapter: `${adapter.name}@${adapter.version}`,
      profile,
      commitSha,
      devEnvironmentId: devEnvRow.id,
      scaffoldJobId: job.id,
    });

    return {
      projectId: projectRow.id,
      repoUrl: repoCreate.htmlUrl,
      cloneUrl: repoCreate.cloneUrl,
      opcDeepLink,
      scaffoldJobId: job.id,
      factoryAdapterId: adapter.id,
      devEnvironmentId: devEnvRow.id,
      profile,
    };
  }
);

// ── Helpers ────────────────────────────────────────────────────────────

function validateSlug(slug: string): void {
  const pattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
  if (!slug || slug.length < 2 || slug.length > 100 || !pattern.test(slug)) {
    throw APIError.invalidArgument(
      "slug must be 2-100 chars, lowercase alphanumeric with hyphens"
    );
  }
}

function validateRepoName(name: string): void {
  const pattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
  if (!name || name.length > 100 || !pattern.test(name)) {
    throw APIError.invalidArgument(
      "repoName must match GitHub repo naming rules"
    );
  }
}

function validateVariant(variant: string): void {
  const valid = new Set(["single-public", "single-internal", "dual"]);
  if (!valid.has(variant)) {
    throw APIError.invalidArgument(
      `variant must be one of: ${[...valid].join(", ")}`
    );
  }
}

async function loadFactoryAdapter(
  orgId: string,
  adapterId: string,
  preloadedSubstrate?: SubstrateTranslation
): Promise<{
  id: string;
  name: string;
  version: string;
  sourceSha: string;
  /** Substrate origin (= configured source_id) — the admission-record key. */
  origin: string;
  manifest: Record<string, unknown>;
}> {
  // Spec 199 FR-002 — adapters resolve by manifest-declared identity from
  // the substrate (thin consumer); the synthesised id matches
  // `browse.ts::synthesiseId` so consumers that received the id from
  // listAdapters can use it here unchanged.
  // Spec 198 FR-001 — binding is admission-gated: an inadmissible factory
  // MUST NOT be bound to a project.
  // A caller that already loaded the org substrate (create's OrgView) threads
  // it in to avoid a second round-trip (ai-review on #533).
  const substrate = preloadedSubstrate ?? (await loadSubstrateForOrg(orgId));
  const found = listAdapterViews(substrate).find(
    (a) => synthesiseAdapterId(orgId, a.name) === adapterId,
  );
  if (!found) {
    throw APIError.notFound(`Factory adapter ${adapterId} not found in org`);
  }
  const admission = await isFactoryAdmitted(orgId, found.origin);
  if (!admission.admitted) {
    throw APIError.failedPrecondition(
      `Factory adapter ${found.name} cannot be bound: ${admission.reason}`,
    );
  }
  return {
    id: adapterId,
    name: found.name,
    version: found.version,
    sourceSha: found.sourceSha,
    origin: found.origin,
    manifest: found.manifest,
  };
}

/** Spec 139 Phase 4 — must match `browse.ts::synthesiseId` (substrate cutover). */
function synthesiseAdapterId(orgId: string, name: string): string {
  return `synthetic-adapter-${orgId.slice(0, 8)}-${name}`;
}

async function loadActiveInstallation(
  orgId: string
): Promise<{ installationId: number; githubOrgLogin: string }> {
  const [row] = await db
    .select({
      installationId: githubInstallations.installationId,
      githubOrgLogin: githubInstallations.githubOrgLogin,
    })
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.orgId, orgId),
        eq(githubInstallations.installationState, "active")
      )
    )
    .limit(1);
  if (!row) {
    throw APIError.failedPrecondition(
      "No active GitHub App installation for this org. Install the OAP GitHub App first."
    );
  }
  return row;
}

async function advanceStep(jobId: string, step: ScaffoldStep): Promise<void> {
  await db
    .update(scaffoldJobs)
    .set({ step, updatedAt: new Date() })
    .where(eq(scaffoldJobs.id, jobId));
}

async function markJobFailed(
  jobId: string,
  step: ScaffoldStep,
  err: unknown
): Promise<void> {
  await db
    .update(scaffoldJobs)
    .set({
      status: "failed",
      step,
      errorMessage: err instanceof Error ? err.message : String(err),
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(scaffoldJobs.id, jobId));
}

/**
 * Spec 112 §10 — orphan-repo recovery. Past `repo-create` we have an empty
 * GitHub repo; mark the job `orphaned` so an operator can reclaim it via
 * the admin UI rather than letting the empty repo sit silently.
 */
async function markJobOrphaned(
  jobId: string,
  githubOrg: string,
  repoName: string,
  err: unknown
): Promise<void> {
  await db
    .update(scaffoldJobs)
    .set({
      status: "orphaned",
      errorMessage: err instanceof Error ? err.message : String(err),
      githubOrg,
      repoName,
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(scaffoldJobs.id, jobId));
}
