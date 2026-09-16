// Spec 114 §5.1 — sync queue endpoint for the project clone pipeline.
//
// This endpoint replaces spec 113's monolithic synchronous clone. It runs
// only fast pre-flight checks (auth, permission, source-project / repo
// existence, destination installation), inserts a `project_clone_runs`
// row at status='pending', publishes a PubSub message keyed by the run
// id, and returns 202 with `{ cloneJobId, status: 'queued' }`. The heavy
// work (mirror clone + push + artefact hydration + audit) lives in the
// project-clone-worker subscription (cloneWorker.ts) which calls
// runCloneWork in cloneCore.ts. The dialog polls
// GET /api/projects/clone/runs/:cloneJobId for the terminal verdict.
//
// Pure helpers + shell wrappers continue to live in `cloneHelpers.ts` so
// vitest can pin the parts that don't need the Encore runtime.

import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { and, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  githubInstallations,
  projectCloneRuns,
  projectRepos,
  projects,
} from "../db/schema";
import { hasOrgPermission } from "../auth/membership";
import { ProjectCloneRequestTopic } from "./cloneEvents";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CloneProjectRequest {
  sourceProjectId: string;
  name?: string;
  slug?: string;
  repoName?: string;
}

export interface CloneJobAccepted {
  cloneJobId: string;
  status: "queued";
}

// ---------------------------------------------------------------------------
// Endpoint
// ---------------------------------------------------------------------------

export const cloneProject = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/projects/:sourceProjectId/clone",
  },
  async (req: CloneProjectRequest): Promise<CloneJobAccepted> => {
    const auth = getAuthData()!;

    // FR-024 — `org:project.create` gate (same as factory-create).
    if (!hasOrgPermission(auth.platformRole, "project:create")) {
      throw APIError.permissionDenied(
        "Insufficient permissions to clone projects in this org",
      );
    }
    // Source project existence + org scope. The worker will re-load
    // these rows; we validate up front so the dialog gets a synchronous
    // 4xx for the obvious permission shapes instead of a queued failure.
    const [source] = await db
      .select({
        id: projects.id,
        orgId: projects.orgId,
      })
      .from(projects)
      .where(
        and(
          eq(projects.id, req.sourceProjectId),
          eq(projects.orgId, auth.orgId),
        ),
      )
      .limit(1);
    if (!source) {
      throw APIError.notFound("source project not found in this org");
    }

    const [sourceRepo] = await db
      .select({
        repoName: projectRepos.repoName,
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
      throw APIError.failedPrecondition(
        "source_repo_missing: source project has no primary repo",
      );
    }

    const [destInstallation] = await db
      .select({
        installationId: githubInstallations.installationId,
      })
      .from(githubInstallations)
      .where(
        and(
          eq(githubInstallations.orgId, auth.orgId),
          eq(githubInstallations.installationState, "active"),
        ),
      )
      .limit(1);
    if (!destInstallation) {
      throw APIError.failedPrecondition(
        "no_github_installation: no active GitHub App installation for this org",
      );
    }

    // Spec 114 FR-002 — insert run row at pending.
    const [run] = await db
      .insert(projectCloneRuns)
      .values({
        sourceProjectId: source.id,
        orgId: auth.orgId,
        triggeredBy: auth.userID,
        status: "pending",
        requestedName: req.name?.trim() ?? null,
        requestedSlug: req.slug?.trim() ?? null,
        requestedRepoName: req.repoName?.trim() ?? null,
      })
      .returning({ id: projectCloneRuns.id });

    // Spec 114 FR-003 — publish; on failure mark the row failed so it
    // doesn't sit at pending forever, then surface a typed 5xx.
    try {
      await ProjectCloneRequestTopic.publish({ cloneJobId: run.id });
    } catch (err) {
      await db
        .update(projectCloneRuns)
        .set({
          status: "failed",
          error: "publish_failed",
          completedAt: new Date(),
        })
        .where(eq(projectCloneRuns.id, run.id));
      throw APIError.unavailable(
        `failed to enqueue clone job: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { cloneJobId: run.id, status: "queued" };
  },
);
