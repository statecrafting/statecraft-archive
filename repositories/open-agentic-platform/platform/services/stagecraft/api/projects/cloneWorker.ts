// Spec 114 §5.2 — PubSub subscriber that owns the heavy clone work.
//
// At-least-once delivery: the handler MUST be idempotent. We CAS-claim
// the run row from pending → running before any side-effect; a no-row-
// returned outcome is one of:
//   - already terminal (`ok` / `failed`)         → log and return
//   - already running, no dest repo recorded     → log and return; the
//     in-flight worker is still doing the work
//   - already running, dest_repo_full_name set   → spec 114 FR-011:
//     reclaim the partial state (delete the dest repo) and mark the run
//     `failed` with code `partial_state_reclaimed`. We cannot resume —
//     git mirror operations are not safely resumable from arbitrary
//     mid-state without complex bookkeeping (out of scope here).

import { Subscription } from "encore.dev/pubsub";
import log from "encore.dev/log";
import { and, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import { githubInstallations, organizations, projectCloneRuns } from "../db/schema";
import { brokerInstallationToken } from "../github/repoInit";
import { deleteGithubRepo } from "./cloneHelpers";
import {
  ProjectCloneRequestTopic,
  type ProjectCloneRequest,
} from "./cloneEvents";
import {
  CloneWorkerError,
  runCloneWork,
  type CloneFailureCode,
} from "./cloneCore";

async function handleCloneRequest(req: ProjectCloneRequest): Promise<void> {
  const startedAt = new Date();

  const claimed = await db
    .update(projectCloneRuns)
    .set({ status: "running", startedAt })
    .where(
      and(
        eq(projectCloneRuns.id, req.cloneJobId),
        eq(projectCloneRuns.status, "pending"),
      ),
    )
    .returning({ id: projectCloneRuns.id });

  if (claimed.length === 0) {
    await maybeReclaimPartialState(req.cloneJobId);
    return;
  }

  const [row] = await db
    .select()
    .from(projectCloneRuns)
    .where(eq(projectCloneRuns.id, req.cloneJobId))
    .limit(1);
  if (!row) {
    log.warn("clone worker: claimed row vanished", { cloneJobId: req.cloneJobId });
    return;
  }

  try {
    const [org] = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, row.orgId))
      .limit(1);
    const result = await runCloneWork({
      runId: row.id,
      sourceProjectId: row.sourceProjectId,
      orgId: row.orgId,
      orgSlug: org?.slug ?? "unknown",
      triggeredBy: row.triggeredBy,
      requestedName: row.requestedName,
      requestedSlug: row.requestedSlug,
      requestedRepoName: row.requestedRepoName,
    });
    await db
      .update(projectCloneRuns)
      .set({
        status: "ok",
        projectId: result.projectId,
        finalName: result.finalName,
        finalSlug: result.finalSlug,
        finalRepoName: result.finalRepoName,
        defaultBranch: result.defaultBranch,
        destRepoFullName: result.destRepoFullName,
        opcDeepLink: result.opcDeepLink,
        rawArtifactsCopied: result.rawArtifactsCopied,
        rawArtifactsSkipped: result.rawArtifactsSkipped,
        durationMs: result.durationMs,
        completedAt: new Date(),
      })
      .where(eq(projectCloneRuns.id, row.id));
    log.info("clone worker: ok", {
      cloneJobId: row.id,
      projectId: result.projectId,
      durationMs: result.durationMs,
    });
  } catch (err) {
    const code: CloneFailureCode =
      err instanceof CloneWorkerError ? err.code : "unknown";
    const message = err instanceof Error ? err.message : String(err);
    log.error("clone worker: failed", {
      cloneJobId: row.id,
      code,
      err: message,
    });
    await db
      .update(projectCloneRuns)
      .set({
        status: "failed",
        error: code,
        errorDetail: message.slice(0, 4000),
        completedAt: new Date(),
      })
      .where(eq(projectCloneRuns.id, row.id));
  }
}

/**
 * Spec 114 FR-011 — redelivered message hits an already-claimed run. If
 * the previous attempt got as far as creating the destination GitHub
 * repo, delete it before terminating, so we don't leak orphan repos.
 */
async function maybeReclaimPartialState(cloneJobId: string): Promise<void> {
  const [row] = await db
    .select()
    .from(projectCloneRuns)
    .where(eq(projectCloneRuns.id, cloneJobId))
    .limit(1);
  if (!row) {
    log.warn("clone worker: redelivery for unknown run", { cloneJobId });
    return;
  }
  if (row.status !== "running") {
    log.info("clone worker: redelivery for terminal run, no-op", {
      cloneJobId,
      status: row.status,
    });
    return;
  }
  if (!row.destRepoFullName) {
    log.info("clone worker: redelivery before partial state, no-op", {
      cloneJobId,
    });
    return;
  }

  log.warn("clone worker: reclaiming partial state", {
    cloneJobId,
    destRepoFullName: row.destRepoFullName,
  });

  const [destInstallation] = await db
    .select({
      installationId: githubInstallations.installationId,
    })
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.orgId, row.orgId),
        eq(githubInstallations.installationState, "active"),
      ),
    )
    .limit(1);
  if (destInstallation) {
    try {
      const { token } = await brokerInstallationToken(
        destInstallation.installationId,
        { administration: "write" },
      );
      await deleteGithubRepo(token, row.destRepoFullName);
    } catch (err) {
      log.warn("clone worker: partial-state repo delete failed", {
        cloneJobId,
        destRepoFullName: row.destRepoFullName,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await db
    .update(projectCloneRuns)
    .set({
      status: "failed",
      error: "partial_state_reclaimed",
      completedAt: new Date(),
    })
    .where(eq(projectCloneRuns.id, cloneJobId));
}

const _cloneWorker = new Subscription(
  ProjectCloneRequestTopic,
  "project-clone-worker",
  {
    handler: handleCloneRequest,
  },
);
void _cloneWorker;
