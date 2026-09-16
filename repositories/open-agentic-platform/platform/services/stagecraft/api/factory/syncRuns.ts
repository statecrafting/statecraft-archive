/**
 * Factory sync run query endpoints (spec 109 §5 + §6).
 *
 *   GET /api/factory/upstreams/sync          — last 20 runs for the caller's org
 *   GET /api/factory/upstreams/sync/:id      — single run by id (polling target)
 *
 * Org scoping is enforced by filtering on auth.orgId. A run id from another
 * org returns 404 to the caller, never the row.
 */

import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import { factorySyncRuns } from "../db/schema";

export interface FactorySyncRunView {
  id: string;
  status: "pending" | "running" | "ok" | "failed";
  triggeredBy: string;
  factorySha: string | null;
  templateSha: string | null;
  counts: { adapters: number; contracts: number; processes: number } | null;
  error: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

function toView(row: typeof factorySyncRuns.$inferSelect): FactorySyncRunView {
  return {
    id: row.id,
    status: row.status,
    triggeredBy: row.triggeredBy,
    factorySha: row.factorySha,
    templateSha: row.templateSha,
    counts: row.counts as FactorySyncRunView["counts"],
    error: row.error,
    queuedAt: row.queuedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export const listFactorySyncRuns = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/factory/upstreams/sync",
  },
  async (): Promise<{ runs: FactorySyncRunView[] }> => {
    const auth = getAuthData()!;
    const rows = await db
      .select()
      .from(factorySyncRuns)
      .where(eq(factorySyncRuns.orgId, auth.orgId))
      .orderBy(desc(factorySyncRuns.queuedAt))
      .limit(20);
    return { runs: rows.map(toView) };
  }
);

export const getFactorySyncRun = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/factory/upstreams/sync/:id",
  },
  async ({ id }: { id: string }): Promise<FactorySyncRunView> => {
    const auth = getAuthData()!;
    const [row] = await db
      .select()
      .from(factorySyncRuns)
      .where(
        and(
          eq(factorySyncRuns.id, id),
          eq(factorySyncRuns.orgId, auth.orgId)
        )
      )
      .limit(1);

    if (!row) throw APIError.notFound("Sync run not found");
    return toView(row);
  }
);
