// Spec 114 §5.2 — heavy-lifting logic for the cloneProject worker.
//
// `runCloneWork` is what the PubSub subscriber invokes once it has CAS-
// claimed a `project_clone_runs` row. It does:
//   1. mirror-clone the source repo
//   2. enforce size caps
//   3. broker the destination installation token
//   4. resolve final repo name + slug (per spec 113 FR-029/FR-030)
//   5. create the destination GitHub repo, then **checkpoint** the
//      dest_repo_full_name onto the run row so a redelivery can detect
//      partial state (spec 114 FR-011) without producing a second clone
//   6. mirror-push, then set default branch
//   7. transactional DB writes (projects + project_repos + project_members)
//   8. raw-artefact hydration via the same helper factory-import uses
//   9. emit project.cloned audit row
//   10. broadcast catalog upsert (spec 112 phase 8)
//
// Throws CloneWorkerError with a typed code on any business-logic failure.
// Cleanup of mirror + worktree tempdirs is unconditional via `finally`.

import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import log from "encore.dev/log";
import { and, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  auditLog,
  githubInstallations,
  projectCloneRuns,
  projectMembers,
  projectRepos,
  projects,
} from "../db/schema";
import { brokerInstallationToken } from "../github/repoInit";
import { resolveProjectToken } from "./tokenResolver";
import { publishProjectCatalogUpsert } from "../sync/projectCatalogRelay";
import { buildProjectOpenDeepLink } from "./scaffold/deepLink";
import { registerRawArtifactsFromRepo } from "./importArtifacts";
import {
  addWorktree,
  createCloneDestRepo,
  defaultProjectSlug,
  defaultRepoName,
  deleteGithubRepo,
  isOverSizeCap,
  measureBytes,
  measureCommitCount,
  mirrorClone,
  mirrorPush,
  probeSourceRepo,
  readDefaultBranch,
  resolveSizeCaps,
  setDefaultBranch,
  suffixCandidate,
} from "./cloneHelpers";
import { checkSlugAvailable } from "./cloneAvailability";
import {
  checkRepoAvailable,
  isValidGithubRepoName,
  isValidProjectSlug,
} from "./cloneAvailabilityHelpers";

const MAX_SUFFIX_ATTEMPTS = 25;

export type CloneFailureCode =
  | "source_unauthorized"
  | "source_too_large"
  | "name_taken"
  | "name_exhausted"
  | "slug_taken"
  | "slug_exhausted"
  | "invalid_repo_name"
  | "invalid_slug"
  | "source_repo_missing"
  | "no_github_installation"
  | "dest_repo_create_failed"
  | "mirror_clone_failed"
  | "mirror_push_failed"
  | "db_insert_failed"
  | "partial_state_reclaimed"
  | "publish_failed"
  | "unknown";

export class CloneWorkerError extends Error {
  constructor(
    public code: CloneFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "CloneWorkerError";
  }
}

export interface CloneWorkArgs {
  runId: string;
  sourceProjectId: string;
  orgId: string;
  /** Used to derive the new project's `object_store_bucket` (spec 119 §4.2). */
  orgSlug: string;
  triggeredBy: string;
  requestedName: string | null;
  requestedSlug: string | null;
  requestedRepoName: string | null;
}

export interface CloneWorkResult {
  projectId: string;
  finalName: string;
  finalSlug: string;
  finalRepoName: string;
  defaultBranch: string;
  destRepoFullName: string;
  opcDeepLink: string | null;
  rawArtifactsCopied: number;
  rawArtifactsSkipped: number;
  durationMs: number;
}

export async function runCloneWork(args: CloneWorkArgs): Promise<CloneWorkResult> {
  const startedAt = Date.now();

  // Re-load source project + repo. The sync endpoint validated existence
  // at queue time; we re-read because the row could have changed between
  // queue and worker (rare; the CASCADE on source_project_id keeps it
  // consistent with its source).
  const [source] = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      description: projects.description,
      factoryAdapterId: projects.factoryAdapterId,
      orgId: projects.orgId,
    })
    .from(projects)
    .where(eq(projects.id, args.sourceProjectId))
    .limit(1);
  if (!source) {
    throw new CloneWorkerError(
      "source_repo_missing",
      "source project disappeared between queue and worker",
    );
  }

  const [sourceRepo] = await db
    .select({
      githubOrg: projectRepos.githubOrg,
      repoName: projectRepos.repoName,
      defaultBranch: projectRepos.defaultBranch,
    })
    .from(projectRepos)
    .where(
      and(
        eq(projectRepos.projectId, source.id),
        eq(projectRepos.isPrimary, true),
      ),
    )
    .limit(1);
  if (!sourceRepo) {
    throw new CloneWorkerError(
      "source_repo_missing",
      "source project has no primary repo",
    );
  }

  const [destInstallation] = await db
    .select({
      installationId: githubInstallations.installationId,
      githubOrgLogin: githubInstallations.githubOrgLogin,
    })
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.orgId, args.orgId),
        eq(githubInstallations.installationState, "active"),
      ),
    )
    .limit(1);
  if (!destInstallation) {
    throw new CloneWorkerError(
      "no_github_installation",
      "no active GitHub App installation for this org",
    );
  }

  // Source-side token (PAT or installation, depending on org).
  const sourceToken = await resolveProjectToken({
    orgId: args.orgId,
    projectId: source.id,
    targetGithubOrgLogin: sourceRepo.githubOrg,
    permissions: { contents: "read", metadata: "read" },
  });
  if (!sourceToken) {
    throw new CloneWorkerError(
      "source_unauthorized",
      "no usable GitHub token for the source repo",
    );
  }

  const sourceProbe = await probeSourceRepo(
    sourceToken.token,
    sourceRepo.githubOrg,
    sourceRepo.repoName,
  );
  const sourceIsPrivate = sourceProbe?.isPrivate ?? true;

  // ──────────────────────────────────────────────────────────────────────
  // Mirror clone + size cap
  // ──────────────────────────────────────────────────────────────────────

  let mirrorPath: string;
  try {
    mirrorPath = await mirrorClone(
      sourceToken.token,
      sourceRepo.githubOrg,
      sourceRepo.repoName,
    );
  } catch (err) {
    throw new CloneWorkerError(
      "mirror_clone_failed",
      `failed to mirror-clone source repo: ${errorMessage(err)}`,
    );
  }
  const cleanupMirror = mirrorPath;
  let cleanupWorktree: string | null = null;
  let createdDestRepo: { fullName: string } | null = null;
  let createdProjectId: string | null = null;
  let destToken: string | null = null;

  try {
    const sourceDefaultBranch =
      sourceProbe?.defaultBranch ??
      sourceRepo.defaultBranch ??
      (await readDefaultBranch(mirrorPath));

    const { maxBytes, maxCommits } = resolveSizeCaps(process.env);
    const [bytes, commits] = await Promise.all([
      measureBytes(mirrorPath),
      measureCommitCount(mirrorPath),
    ]);
    const cap = isOverSizeCap({ bytes, commits, maxBytes, maxCommits });
    if (cap.over) {
      throw new CloneWorkerError(
        "source_too_large",
        `source ${cap.reason} exceeds cap (${
          cap.reason === "bytes"
            ? `${bytes}B > ${maxBytes}B`
            : `${commits} > ${maxCommits} commits`
        })`,
      );
    }

    // ────────────────────────────────────────────────────────────────────
    // Final-name resolution (spec 113 FR-029, FR-030)
    // ────────────────────────────────────────────────────────────────────

    try {
      ({ token: destToken } = await brokerInstallationToken(
        destInstallation.installationId,
        {
          contents: "write",
          administration: "write",
          metadata: "read",
          workflows: "write",
        },
      ));
    } catch (err) {
      throw new CloneWorkerError(
        "dest_repo_create_failed",
        `failed to broker destination installation token: ${errorMessage(err)}`,
      );
    }

    const baseRepoName = defaultRepoName(sourceRepo.repoName);
    const userRepoName = args.requestedRepoName?.trim();
    const repoNameIsDefault =
      userRepoName === undefined || userRepoName === null || userRepoName === baseRepoName;
    if (
      userRepoName !== undefined &&
      userRepoName !== null &&
      userRepoName.length > 0 &&
      !isValidGithubRepoName(userRepoName)
    ) {
      throw new CloneWorkerError(
        "invalid_repo_name",
        "repoName must match GitHub naming rules",
      );
    }

    const finalRepoName = await resolveFinalRepoName({
      token: destToken,
      githubOrgLogin: destInstallation.githubOrgLogin,
      baseName: baseRepoName,
      userTyped: !repoNameIsDefault && userRepoName ? userRepoName : null,
    });

    const baseSlug = defaultProjectSlug(source.slug);
    const userSlug = args.requestedSlug?.trim();
    const slugIsDefault =
      userSlug === undefined || userSlug === null || userSlug === baseSlug;
    if (
      userSlug !== undefined &&
      userSlug !== null &&
      userSlug.length > 0 &&
      !isValidProjectSlug(userSlug)
    ) {
      throw new CloneWorkerError(
        "invalid_slug",
        "slug must match ^[a-z0-9][a-z0-9-]{0,62}$",
      );
    }

    const finalSlug = await resolveFinalSlug({
      orgId: args.orgId,
      baseSlug,
      userTyped: !slugIsDefault && userSlug ? userSlug : null,
    });

    const finalName =
      args.requestedName && args.requestedName.trim().length > 0
        ? args.requestedName.trim()
        : `${source.name} (clone)`;

    // ────────────────────────────────────────────────────────────────────
    // Create destination repo + checkpoint dest_repo_full_name
    // ────────────────────────────────────────────────────────────────────

    let destRepo: { fullName: string; cloneUrl: string; htmlUrl: string };
    try {
      destRepo = await createCloneDestRepo(
        destToken,
        destInstallation.githubOrgLogin,
        finalRepoName,
        {
          isPrivate: sourceIsPrivate,
          description: source.description ?? "",
        },
      );
    } catch (err) {
      throw new CloneWorkerError(
        "dest_repo_create_failed",
        `failed to create destination repo: ${errorMessage(err)}`,
      );
    }
    createdDestRepo = destRepo;

    // Spec 114 FR-011 — checkpoint so a worker crash + redelivery can
    // recognise partial state and reclaim instead of producing a duplicate.
    await db
      .update(projectCloneRuns)
      .set({ destRepoFullName: destRepo.fullName })
      .where(eq(projectCloneRuns.id, args.runId));

    // ────────────────────────────────────────────────────────────────────
    // Mirror push + default branch
    // ────────────────────────────────────────────────────────────────────

    try {
      const authedRemote = `https://x-access-token:${destToken}@github.com/${destRepo.fullName}.git`;
      await mirrorPush(mirrorPath, authedRemote);
      await setDefaultBranch(destToken, destRepo.fullName, sourceDefaultBranch);
    } catch (err) {
      throw new CloneWorkerError(
        "mirror_push_failed",
        `failed to push mirror to destination repo: ${errorMessage(err)}`,
      );
    }

    // ────────────────────────────────────────────────────────────────────
    // DB writes
    // ────────────────────────────────────────────────────────────────────

    let projectRow: { id: string; updatedAt: Date };
    try {
      projectRow = await db.transaction(async (tx) => {
        const [p] = await tx
          .insert(projects)
          .values({
            orgId: args.orgId,
            name: finalName,
            slug: finalSlug,
            description: source.description ?? "",
            // Spec 119 §4.2 — each project owns its own S3-compatible
            // bucket. Mirrors the naming convention used by the create
            // and import endpoints.
            objectStoreBucket: `oap-${args.orgSlug || "unknown"}-${finalSlug}`,
            factoryAdapterId: source.factoryAdapterId,
            createdBy: args.triggeredBy,
          })
          .returning({
            id: projects.id,
            updatedAt: projects.updatedAt,
          });

        await tx.insert(projectRepos).values({
          projectId: p.id,
          githubOrg: destInstallation.githubOrgLogin,
          repoName: finalRepoName,
          defaultBranch: sourceDefaultBranch,
          isPrimary: true,
          githubInstallId: destInstallation.installationId,
        });

        await tx.insert(projectMembers).values({
          projectId: p.id,
          userId: args.triggeredBy,
          role: "admin",
        });

        return p;
      });
    } catch (err) {
      const msg = errorMessage(err);
      if (/unique|duplicate/i.test(msg)) {
        throw new CloneWorkerError(
          "slug_taken",
          `slug "${finalSlug}" already exists in this org`,
        );
      }
      throw new CloneWorkerError(
        "db_insert_failed",
        `failed to register cloned project: ${msg}`,
      );
    }
    createdProjectId = projectRow.id;

    // ────────────────────────────────────────────────────────────────────
    // Raw-artefact hydration (best-effort, partial success allowed)
    // ────────────────────────────────────────────────────────────────────

    let rawCopied = 0;
    let rawSkipped = 0;
    try {
      const wt = await addWorktree(mirrorPath, sourceDefaultBranch);
      cleanupWorktree = wt;
      const result = await registerRawArtifactsFromRepo({
        projectId: projectRow.id,
        orgId: args.orgId,
        boundBy: args.triggeredBy,
        repoRoot: wt,
        sourceRepo: `${sourceRepo.githubOrg}/${sourceRepo.repoName}`,
      });
      rawCopied = result.registered.length;
      rawSkipped = result.skipped.length;
    } catch (err) {
      log.warn("clone worker: raw artefact hydration failed — continuing", {
        runId: args.runId,
        projectId: projectRow.id,
        err: errorMessage(err),
      });
      rawSkipped = -1;
    }

    const durationMs = Date.now() - startedAt;

    // Spec 113 FR-035 — audit row with requested AND final names so
    // governance can reconstruct any silent suffixing.
    await db.insert(auditLog).values({
      actorUserId: args.triggeredBy,
      action: "project.cloned",
      targetType: "project",
      targetId: projectRow.id,
      metadata: {
        sourceProjectId: source.id,
        sourceRepoFullName: `${sourceRepo.githubOrg}/${sourceRepo.repoName}`,
        newRepoFullName: destRepo.fullName,
        requestedRepoName: args.requestedRepoName,
        requestedSlug: args.requestedSlug,
        finalRepoName,
        finalSlug,
        finalName,
        rawArtifactsCopied: rawCopied,
        rawArtifactsSkipped: rawSkipped,
        durationMs,
        orgId: args.orgId,
        cloneJobId: args.runId,
      } as Record<string, unknown>,
    });

    // Spec 112 phase 8 — fire-and-log catalog upsert broadcast.
    void publishProjectCatalogUpsert({
      orgId: args.orgId,
      project: {
        id: projectRow.id,
        name: finalName,
        slug: finalSlug,
        description: source.description ?? "",
        factoryAdapterId: source.factoryAdapterId,
        detectionLevel: null,
        updatedAt: projectRow.updatedAt,
      },
      repo: {
        githubOrg: destInstallation.githubOrgLogin,
        repoName: finalRepoName,
        defaultBranch: sourceDefaultBranch,
      },
    }).catch((err) => {
      log.warn("clone worker: catalog upsert broadcast failed", {
        runId: args.runId,
        projectId: projectRow.id,
        err: errorMessage(err),
      });
    });

    const opcDeepLink = buildProjectOpenDeepLink({
      projectId: projectRow.id,
      cloneUrl: `https://github.com/${destRepo.fullName}.git`,
      detectionLevel: source.factoryAdapterId ? "acp_produced" : undefined,
    });

    return {
      projectId: projectRow.id,
      finalName,
      finalSlug,
      finalRepoName,
      defaultBranch: sourceDefaultBranch,
      destRepoFullName: destRepo.fullName,
      opcDeepLink,
      rawArtifactsCopied: rawCopied,
      rawArtifactsSkipped: rawSkipped < 0 ? 0 : rawSkipped,
      durationMs,
    };
  } catch (err) {
    // Rollback — mirror spec 113 FR-034 semantics.
    if (createdProjectId) {
      await db
        .delete(projects)
        .where(eq(projects.id, createdProjectId))
        .catch((dbErr) =>
          log.warn("clone worker: rollback projects delete failed", {
            runId: args.runId,
            err: errorMessage(dbErr),
          }),
        );
    }
    if (createdDestRepo && destToken) {
      await deleteGithubRepo(destToken, createdDestRepo.fullName);
    }
    throw err;
  } finally {
    if (cleanupWorktree) {
      await rm(dirname(cleanupWorktree), { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
    await rm(dirname(cleanupMirror), { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

/**
 * Spec 113 FR-029 — repo-name resolution. Mirror of the helper that
 * previously lived inside clone.ts. Moved here so the worker can call it.
 */
async function resolveFinalRepoName(args: {
  token: string;
  githubOrgLogin: string;
  baseName: string;
  userTyped: string | null;
}): Promise<string> {
  if (args.userTyped !== null) {
    const probe = await checkRepoAvailable(
      args.token,
      args.githubOrgLogin,
      args.userTyped,
    );
    if (probe.state === "available" || probe.state === "unverifiable") {
      return args.userTyped;
    }
    throw new CloneWorkerError(
      "name_taken",
      `GitHub repo "${args.githubOrgLogin}/${args.userTyped}" is unavailable`,
    );
  }

  for (let i = 0; i < MAX_SUFFIX_ATTEMPTS; i++) {
    const candidate = suffixCandidate(args.baseName, i);
    const probe = await checkRepoAvailable(
      args.token,
      args.githubOrgLogin,
      candidate,
    );
    if (probe.state === "available" || probe.state === "unverifiable") {
      return candidate;
    }
  }
  throw new CloneWorkerError(
    "name_exhausted",
    `no available repo name after ${MAX_SUFFIX_ATTEMPTS} attempts`,
  );
}

/**
 * Spec 113 FR-030 (amended by spec 119) — slug resolution against the
 * org's (org_id, slug) index.
 */
async function resolveFinalSlug(args: {
  orgId: string;
  baseSlug: string;
  userTyped: string | null;
}): Promise<string> {
  if (args.userTyped !== null) {
    const probe = await checkSlugAvailable(args.orgId, args.userTyped);
    if (probe.state === "available") return args.userTyped;
    throw new CloneWorkerError(
      "slug_taken",
      `project slug "${args.userTyped}" already exists in this org`,
    );
  }
  for (let i = 0; i < MAX_SUFFIX_ATTEMPTS; i++) {
    const candidate = suffixCandidate(args.baseSlug, i);
    const probe = await checkSlugAvailable(args.orgId, candidate);
    if (probe.state === "available") return candidate;
  }
  throw new CloneWorkerError(
    "slug_exhausted",
    `no available slug after ${MAX_SUFFIX_ATTEMPTS} attempts`,
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
