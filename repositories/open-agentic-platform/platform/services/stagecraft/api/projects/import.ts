// Spec 112 §6 — ACP-native factory project import endpoint.
//
// Clones a GitHub repo the user's App installation has access to, runs
// the `factory-project-detect` CLI against the checkout, and branches
// on detection level (§6.2):
//
//   NotFactory       → reject
//   ScaffoldOnly     → reject
//   LegacyProduced   → if legacy_complete, translate + open PR; else reject
//   AcpProduced      → register directly
//
// Follows the same governed-consumer posture as Create: statecraft
// never parses contract JSON on the Node side — it shells the detection
// binary and reads its structured output.

import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import log from "encore.dev/log";
import { and, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  auditLog,
  githubInstallations,
  projectGithubPats,
  projectMembers,
  projectRepos,
  projects,
} from "../db/schema";
import { hasOrgPermission } from "../auth/membership";
import { brokerInstallationToken } from "../github/repoInit";
import { publishProjectCatalogUpsert } from "../sync/projectCatalogRelay";
import { buildProjectOpenDeepLink } from "./scaffold/deepLink";
import { encryptPat } from "../auth/patCrypto";
import { loadSubstrateForOrg } from "../factory/substrateBrowser";
import { findAdapterView, listAdapterViews } from "../factory/adapterView";
import { classifyFormat, probeGitHub, tokenPrefix } from "../auth/patProbe";
import { errorForLog } from "../auth/errorLog";
import {
  translateLegacyManifest,
  type FactoryAdapterRow,
  type GoaSoftwareFactoryManifest,
  type GoaWorkingState,
} from "../factory/translator";
import {
  parseRepoUrlImpl,
  TRANSLATOR_VERSION as TRANSLATOR_VERSION_IMPL,
} from "./importHelpers";
import {
  registerRawArtifactsFromRepo,
  type RegisteredArtifact,
} from "./importArtifacts";
import {
  buildImportPrBody,
  openImportPullRequest,
  OpenImportPrError,
} from "./scaffold/githubOpenPr";

// ── Public types ────────────────────────────────────────────────────────

export type ImportDetectionLevel =
  | "not_factory"
  | "scaffold_only"
  | "legacy_produced"
  | "acp_produced";

export interface ImportFactoryProjectRequest {
  /** e.g. "https://github.com/acme/foo" or "acme/foo". */
  repoUrl: string;
  name?: string;
  slug?: string;
  description?: string;
  /**
   * Dry-run mode: perform detection + translation preview but do not
   * insert DB rows or open a PR. Returns the same shape with
   * `previewOnly = true`.
   */
  previewOnly?: boolean;
  /**
   * Optional GitHub PAT escape hatch. Required only when the target repo
   * lives in a GitHub org that does NOT have the OAP App installed for
   * this OAP org. When supplied for an org that DOES have an installation,
   * the installation token still wins (apps are revocable per-org and
   * preferred). On a successful import, the PAT is persisted to
   * `project_github_pats` so subsequent operations on this project resolve
   * the same credential via the standard token resolver.
   */
  githubPat?: string;
  /**
   * Spec 112 §6.2 step 4 — when true, register the project but do not
   * open the L1 translation PR. Useful for callers that want to
   * inspect the translated pipeline-state and open the PR via a
   * follow-up button, or for tests. Default: false (open the PR
   * unless overridden).
   */
  skipPullRequest?: boolean;
}

type TokenSource = "github_installation" | "project_github_pat";

interface ResolvedImportToken {
  token: string;
  source: TokenSource;
  installation: { installationId: number; githubOrgLogin: string } | null;
  patProbe?: {
    tokenPrefix: string;
    isFineGrained: boolean;
    scopes: string[];
    githubLogin: string;
  };
}

export interface ImportFactoryProjectResponse {
  projectId: string | null;
  detectionLevel: ImportDetectionLevel;
  repoUrl: string;
  cloneUrl: string;
  opcDeepLink: string | null;
  translatorVersion: string | null;
  /** L1 only — the translated pipeline-state the translator would commit. */
  translatedPreview?: Record<string, unknown>;
  previewOnly: boolean;
  /**
   * Summary of per-file knowledge_objects rows created from
   * `.artifacts/raw/`. Empty when the imported repo has no raw artifacts
   * or when `previewOnly=true`. The full rows are available through the
   * knowledge-objects-for-project endpoint.
   */
  rawArtifacts: Array<{
    objectId: string;
    filename: string;
    relativePath: string;
    contentHash: string;
    sizeBytes: number;
  }>;
  rawArtifactsSkipped: number;
  /**
   * L1 only — URL of the PR opened against the source repo adding
   * `.factory/pipeline-state.json`. `null` for previewOnly imports,
   * for non-L1 detection levels, or when the caller suppressed PR
   * creation via `skipPullRequest`. When PR creation fails after
   * the project rows have been written, the project is kept and
   * `pullRequestError` carries an actionable message.
   */
  pullRequestUrl: string | null;
  pullRequestError?: string;
}

// ── Detection-crate consumer interface ─────────────────────────────────

export interface DetectionReport {
  level: ImportDetectionLevel;
  adapter_ref?: { name: string; version: string };
  pipeline_state?: { schema_version: string; pipeline?: unknown };
  legacy_manifest?: GoaSoftwareFactoryManifest;
  legacy_complete?: boolean;
  legacy_incomplete_stages?: string[];
}

export const TRANSLATOR_VERSION = TRANSLATOR_VERSION_IMPL;

export interface RunDetectionOptions {
  binaryPath?: string;
  timeoutMs?: number;
}

export async function runDetectionBinary(
  repoRoot: string,
  opts: RunDetectionOptions = {}
): Promise<DetectionReport> {
  const bin = opts.binaryPath ?? process.env.FACTORY_PROJECT_DETECT_BIN;
  if (!bin) {
    throw new Error(
      "factory-project-detect binary path is not configured. Set FACTORY_PROJECT_DETECT_BIN or build the crate: " +
        "`cargo build --release --manifest-path crates/factory-project-detect/Cargo.toml`"
    );
  }
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, ["inspect", repoRoot, "--json"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on("data", (d: Buffer) => out.push(d));
    proc.stderr.on("data", (d: Buffer) => err.push(d));
    const timer = setTimeout(() => proc.kill("SIGKILL"), opts.timeoutMs ?? 30_000).unref();
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `factory-project-detect exited ${code}: ${Buffer.concat(err).toString("utf8")}`
          )
        );
        return;
      }
      try {
        const report = JSON.parse(Buffer.concat(out).toString("utf8")) as DetectionReport;
        resolve(report);
      } catch (parseErr) {
        reject(
          new Error(`factory-project-detect emitted non-JSON output: ${String(parseErr)}`)
        );
      }
    });
    proc.on("error", reject);
  });
}

// ── Endpoint ────────────────────────────────────────────────────────────

export const importFactoryProject = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/projects/factory-import",
  },
  async (req: ImportFactoryProjectRequest): Promise<ImportFactoryProjectResponse> => {
    const auth = getAuthData()!;
    if (!hasOrgPermission(auth.platformRole, "project:create")) {
      throw APIError.permissionDenied(
        "Insufficient permissions to import projects in this org"
      );
    }

    const parsed = parseRepoUrl(req.repoUrl);
    const resolved = await resolveImportToken(auth.orgId, parsed.owner, req.githubPat);

    const cloneUrl = `https://github.com/${parsed.owner}/${parsed.repo}.git`;
    const repoRoot = await cloneRepo(resolved.token, parsed.owner, parsed.repo);
    try {
      const detection = await runDetectionBinary(repoRoot);
      return await route(
        detection,
        auth,
        resolved,
        req,
        parsed,
        cloneUrl,
        repoRoot
      );
    } finally {
      await rm(repoRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
);

// ── Token resolution ────────────────────────────────────────────────────
//
// Precedence:
//   1. If the target GitHub org has an active OAP App installation for
//      this OAP org → broker an installation token (preferred — revocable
//      per-org, no long-lived secret stored).
//   2. Else if a PAT was supplied on the request → validate and use it.
//   3. Else → reject with an actionable error directing the operator
//      either to install the OAP App on the target org or supply a PAT.

async function resolveImportToken(
  orgId: string,
  targetOwner: string,
  pat: string | undefined
): Promise<ResolvedImportToken> {
  const installation = await findInstallationForOwner(orgId, targetOwner);
  if (installation) {
    const { token } = await brokerInstallationToken(installation.installationId, {
      contents: "write",
      pull_requests: "write",
    });
    return { token, source: "github_installation", installation };
  }

  const trimmed = (pat ?? "").trim();
  if (!trimmed) {
    throw APIError.failedPrecondition(
      `No OAP GitHub App installation found for "${targetOwner}". ` +
        "Either install the OAP App on that GitHub org, or supply a GitHub PAT with repo access on the import form."
    );
  }

  const fmt = classifyFormat(trimmed);
  if (!fmt) {
    throw APIError.invalidArgument(
      "Unrecognised PAT format. Expected a GitHub token (ghp_*, github_pat_*, ghs_*, gho_*, or ghu_*)."
    );
  }

  let probe: Awaited<ReturnType<typeof probeGitHub>>;
  try {
    probe = await probeGitHub(trimmed);
  } catch (err) {
    log.warn("import PAT probe failed", { error: errorForLog(err) });
    throw APIError.unavailable("Could not reach GitHub to validate the supplied PAT");
  }

  if (!probe.ok) {
    const reason = probe.reason;
    if (reason === "pat_invalid") {
      throw APIError.invalidArgument("Supplied PAT is invalid or has insufficient scope.");
    }
    if (reason === "pat_rate_limited") {
      throw APIError.unavailable("GitHub rate-limited the PAT validation. Retry shortly.");
    }
    if (reason === "pat_saml_not_authorized") {
      throw APIError.permissionDenied(
        "Supplied PAT is not SAML-authorized for the target GitHub org."
      );
    }
    throw APIError.invalidArgument("Supplied PAT failed validation.");
  }

  return {
    token: trimmed,
    source: "project_github_pat",
    installation: null,
    patProbe: {
      tokenPrefix: tokenPrefix(trimmed),
      isFineGrained: fmt.isFineGrained,
      scopes: probe.scopes,
      githubLogin: probe.githubLogin,
    },
  };
}

async function findInstallationForOwner(
  orgId: string,
  targetOwner: string
): Promise<{ installationId: number; githubOrgLogin: string } | null> {
  const rows = await db
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
    );
  const match = rows.find(
    (r) => r.githubOrgLogin.toLowerCase() === targetOwner.toLowerCase()
  );
  return match ?? null;
}

// ── Routing by detection level ──────────────────────────────────────────

async function route(
  detection: DetectionReport,
  auth: { orgId: string; orgSlug: string; userID: string },
  resolved: ResolvedImportToken,
  req: ImportFactoryProjectRequest,
  parsed: { owner: string; repo: string },
  cloneUrl: string,
  repoRoot: string
): Promise<ImportFactoryProjectResponse> {
  const repoUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;
  const previewOnly = req.previewOnly === true;

  switch (detection.level) {
    case "not_factory":
      throw APIError.failedPrecondition(
        "Repo is not a factory project. Import accepts factory-produced repos only; 'Adopt' belongs to a future spec."
      );

    case "scaffold_only":
      throw APIError.failedPrecondition(
        "Repo is scaffold-only. Run the factory pipeline upstream to completion, then re-import."
      );

    case "legacy_produced":
      if (detection.legacy_complete !== true) {
        const incomplete = detection.legacy_incomplete_stages ?? [];
        throw APIError.failedPrecondition(
          `Legacy pipeline incomplete. Finish these stages in legacy-factory before importing: ${incomplete.join(", ")}`
        );
      }
      return await importLegacy(
        detection,
        auth,
        resolved,
        req,
        parsed,
        cloneUrl,
        repoUrl,
        repoRoot,
        previewOnly
      );

    case "acp_produced":
      return await importAcp(
        detection,
        auth,
        resolved,
        req,
        parsed,
        cloneUrl,
        repoUrl,
        repoRoot,
        previewOnly
      );

    default:
      throw APIError.internal(`unexpected detection level: ${detection.level}`);
  }
}

async function importLegacy(
  detection: DetectionReport,
  auth: { orgId: string; orgSlug: string; userID: string },
  resolved: ResolvedImportToken,
  req: ImportFactoryProjectRequest,
  parsed: { owner: string; repo: string },
  cloneUrl: string,
  repoUrl: string,
  repoRoot: string,
  previewOnly: boolean
): Promise<ImportFactoryProjectResponse> {
  const orgAdapters = await loadOrgAdapters(auth.orgId);
  if (orgAdapters.length === 0) {
    throw APIError.failedPrecondition(
      "No factory adapters registered for this org. Run factory sync first."
    );
  }
  const workingState = await readWorkingState(repoRoot);
  const translated = translateLegacyManifest(
    detection.legacy_manifest ?? {},
    workingState,
    orgAdapters.map<FactoryAdapterRow>((a) => ({
      name: a.name,
      version: a.version,
      sourceSha: a.sourceSha,
      manifest: a.manifest,
    }))
  );

  const adapterRow = orgAdapters.find((a) => a.name === translated.pipeline.adapter.name);

  if (previewOnly) {
    return {
      projectId: null,
      detectionLevel: "legacy_produced",
      repoUrl,
      cloneUrl,
      opcDeepLink: null,
      translatorVersion: TRANSLATOR_VERSION,
      translatedPreview: translated as unknown as Record<string, unknown>,
      previewOnly: true,
      rawArtifacts: [],
      rawArtifactsSkipped: 0,
      pullRequestUrl: null,
    };
  }

  const projectRow = await insertImportedProject({
    auth,
    resolved,
    req,
    parsed,
    factoryAdapterId: adapterRow?.id ?? null,
    detectionLevel: "legacy_produced",
    translatorVersion: TRANSLATOR_VERSION,
  });

  await persistImportPatIfNeeded(projectRow.id, auth.userID, resolved, req.githubPat);

  const artifacts = await registerRawArtifactsSafe({
    projectId: projectRow.id,
    orgId: auth.orgId,
    boundBy: auth.userID,
    repoRoot,
    sourceRepo: `${parsed.owner}/${parsed.repo}`,
  });

  // Spec 112 §6.2 step 4 — open the PR adding the translated
  // pipeline-state. Failures are non-fatal: the project is already
  // registered, so we surface the error in the response so the caller
  // can retry or open the PR by hand. The legacy manifest files are
  // never touched by this flow.
  const prResult = req.skipPullRequest
    ? { pullRequestUrl: null as string | null, pullRequestError: undefined as string | undefined }
    : await openTranslationPr({
        token: resolved.token,
        fullName: `${parsed.owner}/${parsed.repo}`,
        baseBranch: "main",
        translated,
        translatorVersion: TRANSLATOR_VERSION,
      });

  if (prResult.pullRequestUrl) {
    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "project.import.pr_opened",
      targetType: "project",
      targetId: projectRow.id,
      metadata: {
        pullRequestUrl: prResult.pullRequestUrl,
        translatorVersion: TRANSLATOR_VERSION,
      },
    });
  } else if (prResult.pullRequestError) {
    log.warn("import: PR open failed (project still registered)", {
      projectId: projectRow.id,
      error: prResult.pullRequestError,
    });
  }

  return {
    projectId: projectRow.id,
    detectionLevel: "legacy_produced",
    repoUrl,
    cloneUrl,
    opcDeepLink: buildProjectOpenDeepLink({
      projectId: projectRow.id,
      cloneUrl,
      detectionLevel: "legacy_produced",
    }),
    translatorVersion: TRANSLATOR_VERSION,
    translatedPreview: translated as unknown as Record<string, unknown>,
    previewOnly: false,
    rawArtifacts: artifacts.registered.map(redactArtifact),
    rawArtifactsSkipped: artifacts.skipped,
    pullRequestUrl: prResult.pullRequestUrl,
    pullRequestError: prResult.pullRequestError,
  };
}

/**
 * Spec 112 §6.2 step 4 — wrap the PR helper with a default-branch
 * convention (main) and a deterministic head-branch name keyed on the
 * minute the import ran. Errors are caught and surfaced as
 * `pullRequestError` so the caller's response shape stays stable —
 * the project rows are already persisted by the time we reach here,
 * and rolling them back for a transient GitHub failure would be
 * worse than leaving the user a "retry the PR" button.
 */
async function openTranslationPr(args: {
  token: string;
  fullName: string;
  baseBranch: string;
  translated: ReturnType<typeof translateLegacyManifest>;
  translatorVersion: string;
}): Promise<{ pullRequestUrl: string | null; pullRequestError?: string }> {
  const stages = args.translated.stages ?? {};
  const stageCount = Object.keys(stages).length;
  // Minute-precision suffix: cheap idempotency on retry within a minute.
  const suffix = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const headBranch = `factory-import-${suffix}`;
  try {
    const result = await openImportPullRequest({
      token: args.token,
      fullName: args.fullName,
      baseBranch: args.baseBranch,
      headBranch,
      filePath: ".factory/pipeline-state.json",
      fileContent: `${JSON.stringify(args.translated, null, 2)}\n`,
      commitMessage:
        "chore(factory): add ACP-translated pipeline-state.json (spec 112 §6.2)",
      prTitle: "Factory import: add `.factory/pipeline-state.json`",
      prBody: buildImportPrBody({
        detectionLevel: "legacy_produced",
        translatorVersion: args.translatorVersion,
        legacyStageCount: stageCount,
      }),
    });
    return { pullRequestUrl: result.htmlUrl };
  } catch (err) {
    const message =
      err instanceof OpenImportPrError
        ? `${err.stage}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    return { pullRequestUrl: null, pullRequestError: message };
  }
}

async function importAcp(
  detection: DetectionReport,
  auth: { orgId: string; orgSlug: string; userID: string },
  resolved: ResolvedImportToken,
  req: ImportFactoryProjectRequest,
  parsed: { owner: string; repo: string },
  cloneUrl: string,
  repoUrl: string,
  repoRoot: string,
  previewOnly: boolean
): Promise<ImportFactoryProjectResponse> {
  const schemaVersion = detection.pipeline_state?.schema_version;
  if (schemaVersion !== "1.0.0") {
    throw APIError.failedPrecondition(
      `Unsupported pipeline-state schema version: ${schemaVersion ?? "<unset>"}. Expected 1.0.0.`
    );
  }
  const adapterName = detection.adapter_ref?.name;
  const factoryAdapterId = adapterName
    ? (await loadAdapterByName(auth.orgId, adapterName))?.id ?? null
    : null;

  if (previewOnly) {
    return {
      projectId: null,
      detectionLevel: "acp_produced",
      repoUrl,
      cloneUrl,
      opcDeepLink: null,
      translatorVersion: null,
      previewOnly: true,
      rawArtifacts: [],
      rawArtifactsSkipped: 0,
      pullRequestUrl: null,
    };
  }

  const projectRow = await insertImportedProject({
    auth,
    resolved,
    req,
    parsed,
    factoryAdapterId,
    detectionLevel: "acp_produced",
    translatorVersion: null,
  });

  await persistImportPatIfNeeded(projectRow.id, auth.userID, resolved, req.githubPat);

  const artifacts = await registerRawArtifactsSafe({
    projectId: projectRow.id,
    orgId: auth.orgId,
    boundBy: auth.userID,
    repoRoot,
    sourceRepo: `${parsed.owner}/${parsed.repo}`,
  });

  return {
    projectId: projectRow.id,
    detectionLevel: "acp_produced",
    repoUrl,
    cloneUrl,
    opcDeepLink: buildProjectOpenDeepLink({
      projectId: projectRow.id,
      cloneUrl,
      detectionLevel: "acp_produced",
    }),
    translatorVersion: null,
    previewOnly: false,
    rawArtifacts: artifacts.registered.map(redactArtifact),
    rawArtifactsSkipped: artifacts.skipped,
    pullRequestUrl: null,
  };
}

async function registerRawArtifactsSafe(input: {
  projectId: string;
  orgId: string;
  boundBy: string;
  repoRoot: string;
  sourceRepo: string;
}): Promise<{ registered: RegisteredArtifact[]; skipped: number }> {
  try {
    const result = await registerRawArtifactsFromRepo(input);
    return {
      registered: result.registered,
      skipped: result.skipped.length,
    };
  } catch (err) {
    log.error("registerRawArtifactsFromRepo failed — continuing import", {
      projectId: input.projectId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { registered: [], skipped: 0 };
  }
}

function redactArtifact(a: RegisteredArtifact): {
  objectId: string;
  filename: string;
  relativePath: string;
  contentHash: string;
  sizeBytes: number;
} {
  return {
    objectId: a.objectId,
    filename: a.filename,
    relativePath: a.relativePath,
    contentHash: a.contentHash,
    sizeBytes: a.sizeBytes,
  };
}

// ── DB helpers ──────────────────────────────────────────────────────────

async function insertImportedProject(input: {
  auth: { orgId: string; orgSlug: string; userID: string };
  resolved: ResolvedImportToken;
  req: ImportFactoryProjectRequest;
  parsed: { owner: string; repo: string };
  factoryAdapterId: string | null;
  detectionLevel: ImportDetectionLevel;
  translatorVersion: string | null;
}): Promise<{ id: string }> {
  const slug = input.req.slug ?? input.parsed.repo.toLowerCase();
  const name = input.req.name ?? input.parsed.repo;
  const githubOrg =
    input.resolved.installation?.githubOrgLogin ?? input.parsed.owner;
  const githubInstallId = input.resolved.installation?.installationId ?? null;
  try {
    const inserted = await db.transaction(async (tx) => {
      const [p] = await tx
        .insert(projects)
        .values({
          orgId: input.auth.orgId,
          name,
          slug,
          description: input.req.description ?? "",
          // Spec 119 §4.2 — each project owns its bucket. Naming
          // mirrors the create endpoint convention.
          objectStoreBucket: `oap-${input.auth.orgSlug || "unknown"}-${slug}`,
          factoryAdapterId: input.factoryAdapterId,
          createdBy: input.auth.userID,
        })
        .returning();
      await tx.insert(projectRepos).values({
        projectId: p.id,
        githubOrg,
        repoName: input.parsed.repo,
        defaultBranch: "main",
        isPrimary: true,
        githubInstallId,
      });
      await tx.insert(projectMembers).values({
        projectId: p.id,
        userId: input.auth.userID,
        role: "admin",
      });
      await tx.insert(auditLog).values({
        actorUserId: input.auth.userID,
        action: "project.imported",
        targetType: "project",
        targetId: p.id,
        metadata: {
          name,
          slug,
          githubOrg,
          repoName: input.parsed.repo,
          detectionLevel: input.detectionLevel,
          factoryAdapterId: input.factoryAdapterId,
          translatorVersion: input.translatorVersion,
          orgId: input.auth.orgId,
          tokenSource: input.resolved.source,
        },
      });
      return p;
    });

    // Spec 112 Phase 8 — broadcast the imported project to connected
    // OPCs. Fire-and-log: a sync hiccup must not roll back an import the
    // user just confirmed.
    void publishProjectCatalogUpsert({
      orgId: input.auth.orgId,
      project: {
        id: inserted.id,
        name: inserted.name,
        slug: inserted.slug,
        description: inserted.description,
        factoryAdapterId: input.factoryAdapterId,
        detectionLevel: input.detectionLevel,
        updatedAt: inserted.updatedAt,
      },
      repo: {
        githubOrg,
        repoName: input.parsed.repo,
        defaultBranch: "main",
      },
    }).catch((err) => {
      log.warn("import: catalog upsert broadcast failed", {
        projectId: inserted.id,
        err: err instanceof Error ? err.message : String(err),
      });
    });

    return { id: inserted.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(msg)) {
      throw APIError.alreadyExists(
        "A project with that slug already exists in this org"
      );
    }
    log.error("importFactoryProject DB transaction failed", { error: msg });
    throw APIError.internal("Failed to create imported project records");
  }
}

/**
 * When the import was authenticated via PAT (no App installation on the
 * target org), persist that PAT under `project_github_pats` so subsequent
 * project operations resolve the same credential through the standard
 * token resolver.
 */
async function persistImportPatIfNeeded(
  projectId: string,
  actorUserId: string,
  resolved: ResolvedImportToken,
  rawPat: string | undefined
): Promise<void> {
  if (resolved.source !== "project_github_pat") return;
  const token = (rawPat ?? "").trim();
  if (!token || !resolved.patProbe) return;

  let tokenEnc: Buffer;
  let tokenNonce: Buffer;
  try {
    ({ tokenEnc, tokenNonce } = encryptPat(token));
  } catch (err) {
    log.error("import PAT encryption failed — proceeding without persistence", {
      projectId,
      error: errorForLog(err),
    });
    return;
  }

  const now = new Date();
  await db
    .insert(projectGithubPats)
    .values({
      projectId,
      tokenEnc,
      tokenNonce,
      tokenPrefix: resolved.patProbe.tokenPrefix,
      scopes: resolved.patProbe.scopes,
      isFineGrained: resolved.patProbe.isFineGrained,
      githubLogin: resolved.patProbe.githubLogin,
      lastCheckedAt: now,
      createdBy: actorUserId,
    })
    .onConflictDoUpdate({
      target: projectGithubPats.projectId,
      set: {
        tokenEnc,
        tokenNonce,
        tokenPrefix: resolved.patProbe.tokenPrefix,
        scopes: resolved.patProbe.scopes,
        isFineGrained: resolved.patProbe.isFineGrained,
        githubLogin: resolved.patProbe.githubLogin,
        lastCheckedAt: now,
        lastUsedAt: null,
        createdBy: actorUserId,
        updatedAt: now,
      },
    });

  await db.insert(auditLog).values({
    actorUserId,
    action: "pat.project.stored",
    targetType: "project_github_pats",
    targetId: projectId,
    metadata: {
      origin: "project.imported",
      prefix: resolved.patProbe.tokenPrefix,
      is_fine_grained: resolved.patProbe.isFineGrained,
      scopes: resolved.patProbe.scopes,
      github_login: resolved.patProbe.githubLogin,
    },
  });
}

async function loadOrgAdapters(
  orgId: string
): Promise<
  Array<{
    id: string;
    name: string;
    version: string;
    sourceSha: string;
    manifest: Record<string, unknown>;
  }>
> {
  // Spec 199 FR-002 — adapters resolve by manifest-declared identity from
  // the substrate (thin consumer).
  const substrate = await loadSubstrateForOrg(orgId);
  return listAdapterViews(substrate).map((a) => ({
    id: synthesiseAdapterId(orgId, a.name),
    name: a.name,
    version: a.version,
    sourceSha: a.sourceSha,
    manifest: a.manifest,
  }));
}

async function loadAdapterByName(
  orgId: string,
  name: string
): Promise<{ id: string } | null> {
  const substrate = await loadSubstrateForOrg(orgId);
  const found = findAdapterView(substrate, name);
  if (!found) return null;
  return { id: synthesiseAdapterId(orgId, found.name) };
}

/** Spec 139 Phase 4 — must match `browse.ts::synthesiseId`. */
function synthesiseAdapterId(orgId: string, name: string): string {
  return `synthetic-adapter-${orgId.slice(0, 8)}-${name}`;
}

// ── Shell helpers ───────────────────────────────────────────────────────

async function cloneRepo(
  installationToken: string,
  owner: string,
  repo: string
): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), "statecraft-import-"));
  const cloneTarget = join(workDir, "repo");
  const authUrl = `https://x-access-token:${installationToken}@github.com/${owner}/${repo}.git`;
  await runCmd("git", ["clone", "--depth", "1", authUrl, cloneTarget]);
  return cloneTarget;
}

async function readWorkingState(repoRoot: string): Promise<GoaWorkingState> {
  try {
    const raw = await readFile(
      join(repoRoot, "requirements", "audit", "working-state.json"),
      "utf8"
    );
    return JSON.parse(raw) as GoaWorkingState;
  } catch {
    // A legacy project without working-state.json is still translatable;
    // the translator tolerates an empty object.
    return {};
  }
}

function runCmd(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const err: Buffer[] = [];
    proc.stderr.on("data", (d: Buffer) => err.push(d));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${bin} ${args.join(" ")} exited ${code}: ${Buffer.concat(err).toString("utf8")}`
          )
        );
    });
    proc.on("error", reject);
  });
}

// ── URL parsing (exported for tests) ────────────────────────────────────

export function parseRepoUrl(input: string): { owner: string; repo: string } {
  try {
    return parseRepoUrlImpl(input);
  } catch (err) {
    throw APIError.invalidArgument(
      `Invalid repo URL "${input.trim()}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
