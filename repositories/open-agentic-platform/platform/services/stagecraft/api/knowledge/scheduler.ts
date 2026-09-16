/**
 * Connector sync scheduler (spec 087 Phase 4).
 *
 * Encore cron job that runs every 15 minutes and dispatches sync runs
 * for connectors that have a sync_schedule set and are due for a sync.
 *
 * The scheduler checks each active connector's sync_schedule (a simple
 * interval string) against its last_synced_at timestamp. If a connector
 * is due, it dispatches an async sync run via executeSyncRun().
 *
 * Supported sync_schedule values:
 *   "15m", "30m", "1h", "6h", "12h", "24h"
 */

import { api, Header } from "encore.dev/api";
import { CronJob } from "encore.dev/cron";
import log from "encore.dev/log";
import { db } from "../db/drizzle";
import { sourceConnectors, syncRuns, projects } from "../db/schema";
import { and, eq, desc, isNotNull } from "drizzle-orm";
import { executeSyncRun } from "./knowledge";
import { sweepStaleExtractionRuns } from "./extractionCore";
import { runOrphanSweep } from "./orphanSweeper";
import { validateM2mRequest } from "../auth/m2mAuth.js";

// ---------------------------------------------------------------------------
// Schedule interval parser
// ---------------------------------------------------------------------------

const INTERVALS: Record<string, number> = {
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "12h": 12 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

function parseIntervalMs(schedule: string): number | null {
  return INTERVALS[schedule] ?? null;
}

// System user ID for scheduler-initiated syncs (not user-triggered)
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

// ---------------------------------------------------------------------------
// Cron endpoint — must be an api() endpoint for Encore CronJob
// ---------------------------------------------------------------------------

export const runScheduledSyncs = api(
  { expose: false, method: "POST", path: "/internal/knowledge/scheduled-sync" },
  async (): Promise<void> => {
    const now = Date.now();

    const connectors = await db
      .select()
      .from(sourceConnectors)
      .where(
        and(
          eq(sourceConnectors.status, "active"),
          isNotNull(sourceConnectors.syncSchedule)
        )
      );

    let dispatched = 0;

    for (const conn of connectors) {
      if (!conn.syncSchedule || conn.type === "upload") continue;

      const intervalMs = parseIntervalMs(conn.syncSchedule);
      if (!intervalMs) {
        log.warn("unknown sync_schedule", {
          connectorId: conn.id,
          schedule: conn.syncSchedule,
        });
        continue;
      }

      // Check if enough time has passed since the last sync
      const lastSync = conn.lastSyncedAt
        ? new Date(conn.lastSyncedAt).getTime()
        : 0;

      if (now - lastSync < intervalMs) continue;

      // Check if there's already a running sync for this connector
      const [running] = await db
        .select({ id: syncRuns.id })
        .from(syncRuns)
        .where(
          and(
            eq(syncRuns.connectorId, conn.id),
            eq(syncRuns.status, "running")
          )
        )
        .limit(1);

      if (running) continue;

      // Resolve project bucket + org for the broadcast key.
      const [project] = await db
        .select({
          orgId: projects.orgId,
          objectStoreBucket: projects.objectStoreBucket,
        })
        .from(projects)
        .where(eq(projects.id, conn.projectId))
        .limit(1);

      if (!project) continue;

      // Get the last successful delta token
      const [lastRun] = await db
        .select({ deltaToken: syncRuns.deltaToken })
        .from(syncRuns)
        .where(
          and(
            eq(syncRuns.connectorId, conn.id),
            eq(syncRuns.status, "completed")
          )
        )
        .orderBy(desc(syncRuns.completedAt))
        .limit(1);

      try {
        await executeSyncRun(
          conn.id,
          conn.projectId,
          project.orgId,
          project.objectStoreBucket,
          conn.type,
          (conn.configEncrypted as Record<string, unknown>) ?? {},
          lastRun?.deltaToken ?? null,
          SYSTEM_USER_ID
        );
        dispatched++;
      } catch (err) {
        log.error("failed to dispatch scheduled sync", {
          connectorId: conn.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (dispatched > 0) {
      log.info("scheduled syncs dispatched", { count: dispatched });
    }
  }
);

// ---------------------------------------------------------------------------
// Spec 115 FR-006 — staleness sweeper for the extraction worker.
// ---------------------------------------------------------------------------
//
// Runs every minute. Picks up any `knowledge_extraction_runs` row in
// `running` state whose `running_at` is older than
// STATECRAFT_EXTRACT_STALE_AFTER_SEC (default 600s) and flips it to
// `failed` with `worker_crashed`, reverting the corresponding object to
// `imported`. Closes the recovery loop for worker crashes mid-extraction
// so a single crash never permanently strands an object.

export const runExtractionStalenessSweep = api(
  {
    expose: false,
    method: "POST",
    path: "/internal/knowledge/extraction-staleness-sweep",
  },
  async (): Promise<void> => {
    try {
      const result = await sweepStaleExtractionRuns();
      if (result.swept > 0) {
        log.info("extraction staleness sweep: rows recovered", {
          swept: result.swept,
        });
      }
    } catch (err) {
      log.error("extraction staleness sweep failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Spec 143 FR-010 — orphan-imported sweeper.
// ---------------------------------------------------------------------------
//
// Reconciles `state = 'imported'` rows past the grace window (default
// 3600s) along two paths: Class A (no blob → delete) or Class B
// (blob present, missing confirm → self-heal via confirmUploadCore).
// See `orphanSweeper.ts` for the design rationale and concurrency model.

async function executeOrphanSweep(): Promise<void> {
  try {
    const result = await runOrphanSweep();
    if (
      result.deletedClassA > 0 ||
      result.selfHealedClassB > 0 ||
      result.errored > 0
    ) {
      log.info("orphan-imported sweep result", result);
    }
  } catch (err) {
    log.error("orphan-imported sweep failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Spec 143 §12 L-004: `expose: false` is "internal to the Encore service",
// not "internal to the cluster" — a K8s CronJob is an external HTTP caller
// relative to the Encore process boundary, regardless of the network hop
// being intra-cluster. So this endpoint exposes publicly and is gated by
// the platform M2M auth surface (spec 087 Phase 5 precedent — same pattern
// as `audit.ts` / `policy.ts` / `grants.ts`). The `platform:knowledge:sweep`
// scope must live in the calling Rauthy client's *Default Scopes* (load-
// bearing per §12 L-006: Rauthy 0.35 `client_credentials` mints Default
// Scopes regardless of `scope=`); placing it only in *Allowed Scopes* is
// silently inert under this flow.
export const runOrphanImportedSweep = api(
  {
    expose: true,
    method: "POST",
    path: "/internal/knowledge/orphan-imported-sweep",
  },
  async (req: { authorization: Header<"Authorization"> }): Promise<void> => {
    await validateM2mRequest(req.authorization, "platform:knowledge:sweep");
    await executeOrphanSweep();
  },
);

// Encore CronJob requires a parameterless endpoint, so the local-dev /
// future-Encore-Cloud cron path gets its own internal handler that runs
// the same kernel without a header parameter. Self-hosted production
// runs the K8s CronJob against `runOrphanImportedSweep` above (FR-010
// self-hosted scheduler amendment); this handler is a no-op there
// because Encore's CronJob primitive is unscheduled without Encore
// Cloud (§12 L-001).
export const runOrphanImportedSweepCron = api(
  {
    expose: false,
    method: "POST",
    path: "/internal/knowledge/orphan-imported-sweep-cron",
  },
  executeOrphanSweep,
);

// ---------------------------------------------------------------------------
// Register the cron jobs
// ---------------------------------------------------------------------------

const _connectorSync = new CronJob("connector-sync-scheduler", {
  title: "Connector Sync Scheduler",
  every: "15m",
  endpoint: runScheduledSyncs,
});
void _connectorSync;

const _extractionSweeper = new CronJob("extraction-staleness-sweeper", {
  title: "Knowledge Extraction Staleness Sweeper",
  every: "1m",
  endpoint: runExtractionStalenessSweep,
});
void _extractionSweeper;

// Cadence rationale (spec 143 FR-010): cleanup latency = grace +
// cadence. With grace 3600s and cadence 30m the worst-case latency is
// 90 min. Tighter cadence is wasted polling at current scale because
// no user-visible surface depends on sub-hour reconciliation. Loosen
// further only if observability shows the sweep is meaningfully
// load-burning.
const _orphanSweeper = new CronJob("knowledge-orphan-imported-sweeper", {
  title: "Knowledge Orphan-Imported Sweeper",
  every: "30m",
  endpoint: runOrphanImportedSweepCron,
});
void _orphanSweeper;
