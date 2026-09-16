// Spec 109: factory_sync_runs staleness sweeper.
//
// Companion to api/factory/runsScheduler.ts (spec 124), which sweeps the
// OPC-run table factory_runs. This sweeper recovers the OTHER run table,
// factory_sync_runs (the upstream-sync lifecycle), which had no recovery
// path at all: a sync that claimed a row (pending -> running) and then died
// before writing ok/failed stayed `running` forever. Two locks made that
// permanent: the PubSub redelivery CAS guard (claims only `pending` rows) and
// the enqueue coalesce guard (returns the in-flight row instead of starting
// new work), so the UI Sync button stayed disabled indefinitely (observed in
// production 2026-06-27, queued row stuck for two days).
//
// factory_sync_runs has no last_event_at column (a sync is a single
// short-lived pipeline, not an event stream), so the staleness signal is
// COALESCE(started_at, queued_at) older than the cutoff. A healthy sync
// completes in seconds (the per-repo git clone timeout is 120s), so the
// default 10-minute window only ever catches genuinely-dead runs.
//
// Bias matches runsScheduler: prefer false-positive failure to a permanently
// stuck row. A swept run is recorded `failed`; the operator simply re-syncs.

import { api } from "encore.dev/api";
import { CronJob } from "encore.dev/cron";
import log from "encore.dev/log";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import { factorySyncRuns, factoryUpstreams, auditLog } from "../db/schema";
import { FACTORY_SOURCE_ID } from "./upstreams";

/** Default staleness window. The per-repo clone timeout is 120s and a healthy
 *  two-repo sync finishes in well under a minute, so ten minutes of silence
 *  means the worker died mid-run. */
const DEFAULT_STALE_AFTER_SEC = 10 * 60;

/** Override via STATECRAFT_FACTORY_SYNC_STALE_AFTER_SEC=<seconds>; used by
 *  integration tests to compress the window. Documented in statecraft/CLAUDE.md
 *  alongside the spec 124 / spec 115 sweeper knobs. */
const ENV_STALE_AFTER_SEC = "STATECRAFT_FACTORY_SYNC_STALE_AFTER_SEC";

/** Seed migration system user (default org seed in the consolidated baseline).
 *  The sweeper is a server-side cron, so every audit row it emits is authored
 *  by the system user. */
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

const SYNC_SWEPT_ACTION = "factory.upstreams.sync_swept";

function staleAfterSeconds(): number {
  const raw = process.env[ENV_STALE_AFTER_SEC];
  if (!raw) return DEFAULT_STALE_AFTER_SEC;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STALE_AFTER_SEC;
}

export interface SyncSweepResult {
  swept: number;
  ids: string[];
}

/**
 * Find every factory_sync_runs row in (pending, running) whose
 * COALESCE(started_at, queued_at) is older than the cutoff and flip it to
 * `failed`, then correct the denormalised factory_upstreams.last_sync_status
 * for that org so the Overview banner and the Sync button re-arm. Emits a
 * `factory.upstreams.sync_swept` audit row per swept run under the system user.
 *
 * `now` is injectable so tests can drive deterministic windows.
 */
export async function sweepStaleFactorySyncRuns(
  now: Date = new Date(),
): Promise<SyncSweepResult> {
  const staleAfter = staleAfterSeconds();
  const cutoff = new Date(now.getTime() - staleAfter * 1000);

  const stale = await db
    .select({
      id: factorySyncRuns.id,
      orgId: factorySyncRuns.orgId,
      status: factorySyncRuns.status,
      triggeredBy: factorySyncRuns.triggeredBy,
    })
    .from(factorySyncRuns)
    .where(
      and(
        inArray(factorySyncRuns.status, ["pending", "running"]),
        sql`COALESCE(${factorySyncRuns.startedAt}, ${factorySyncRuns.queuedAt}) < ${cutoff}`,
      ),
    );

  if (stale.length === 0) {
    return { swept: 0, ids: [] };
  }

  const errorMessage = `sweeper: factory sync incomplete after ${staleAfter}s (worker presumed dead)`;
  const ids: string[] = [];

  // One transaction per row so a transient DB hiccup loses a single row, not
  // the whole batch, and the next cron tick retries.
  for (const row of stale) {
    try {
      await db.transaction(async (tx) => {
        const updated = await tx
          .update(factorySyncRuns)
          .set({ status: "failed", error: errorMessage, completedAt: now })
          .where(
            and(
              eq(factorySyncRuns.id, row.id),
              // Re-check status under the transaction so we do not race the
              // worker writing a terminal state.
              inArray(factorySyncRuns.status, ["pending", "running"]),
            ),
          )
          .returning({ id: factorySyncRuns.id });

        if (updated.length === 0) return; // worker won the race; nothing to do.

        // Correct the denormalised current-state mirror on the factory-side
        // upstream row so the Overview banner stops showing `running`.
        await tx
          .update(factoryUpstreams)
          .set({
            lastSyncStatus: "failed",
            lastSyncError: errorMessage,
            updatedAt: now,
          })
          .where(
            and(
              eq(factoryUpstreams.orgId, row.orgId),
              eq(factoryUpstreams.sourceId, FACTORY_SOURCE_ID),
              eq(factoryUpstreams.lastSyncStatus, "running"),
            ),
          );

        await tx.insert(auditLog).values({
          actorUserId: SYSTEM_USER_ID,
          action: SYNC_SWEPT_ACTION,
          targetType: "factory_sync_runs",
          targetId: row.id,
          metadata: {
            orgId: row.orgId,
            triggeredBy: row.triggeredBy,
            statusBeforeSweep: row.status,
            staleAfterSec: staleAfter,
            sweptAt: now.toISOString(),
          },
        });
      });
      ids.push(row.id);
    } catch (err) {
      log.error("sweepStaleFactorySyncRuns: per-row sweep failed", {
        syncRunId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.warn("sweepStaleFactorySyncRuns: recovered sync runs", {
    swept: ids.length,
    staleAfterSec: staleAfter,
  });
  return { swept: ids.length, ids };
}

export const runFactorySyncRunsStalenessSweep = api(
  {
    expose: false,
    method: "POST",
    path: "/internal/factory/sync-runs-staleness-sweep",
  },
  async (): Promise<void> => {
    try {
      const result = await sweepStaleFactorySyncRuns();
      if (result.swept > 0) {
        log.info("factory.sync-runs staleness sweep: rows recovered", {
          swept: result.swept,
        });
      }
    } catch (err) {
      log.error("factory.sync-runs staleness sweep failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

const _factorySyncRunsSweeper = new CronJob(
  "factory-sync-runs-staleness-sweeper",
  {
    title: "Factory Sync Runs Staleness Sweeper",
    every: "1m",
    endpoint: runFactorySyncRunsStalenessSweep,
  },
);
void _factorySyncRunsSweeper;
