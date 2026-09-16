// Spec 114 §5.3 — clone run status endpoint (amended by spec 119).
//
// The dialog polls this every ~1.5s after submitting a clone, until the
// run reaches `ok` or `failed`. The endpoint is org-scoped, never mutates
// state, never audits, and never consumes any retry budget.

import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { and, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import { projectCloneRuns } from "../db/schema";

interface CloneRunStatusRequest {
  cloneJobId: string;
}

export type CloneRunStatusResponse = {
  cloneJobId: string;
  status: "pending" | "running" | "ok" | "failed";
  sourceProjectId: string;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  projectId: string | null;
  finalName: string | null;
  finalSlug: string | null;
  repoFullName: string | null;
  defaultBranch: string | null;
  opcDeepLink: string | null;
  rawArtifactsCopied: number | null;
  rawArtifactsSkipped: number | null;
  durationMs: number | null;
  error: string | null;
  errorDetail: string | null;
};

export const getCloneRunStatus = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/clone/runs/:cloneJobId",
  },
  async (req: CloneRunStatusRequest): Promise<CloneRunStatusResponse> => {
    const auth = getAuthData()!;

    const [row] = await db
      .select()
      .from(projectCloneRuns)
      .where(
        and(
          eq(projectCloneRuns.id, req.cloneJobId),
          eq(projectCloneRuns.orgId, auth.orgId),
        ),
      )
      .limit(1);
    if (!row) {
      throw APIError.notFound("clone run not found");
    }

    return {
      cloneJobId: row.id,
      status: row.status,
      sourceProjectId: row.sourceProjectId,
      queuedAt: row.queuedAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      projectId: row.projectId,
      finalName: row.finalName,
      finalSlug: row.finalSlug,
      repoFullName: row.destRepoFullName,
      defaultBranch: row.defaultBranch,
      opcDeepLink: row.opcDeepLink,
      rawArtifactsCopied: row.rawArtifactsCopied,
      rawArtifactsSkipped: row.rawArtifactsSkipped,
      durationMs: row.durationMs,
      error: row.error,
      errorDetail: row.errorDetail,
    };
  },
);
