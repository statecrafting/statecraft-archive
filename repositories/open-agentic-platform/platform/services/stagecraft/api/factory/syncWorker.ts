/**
 * Factory sync PubSub worker (spec 109 §5).
 *
 * Consumes FactorySyncRequestTopic. For each request:
 *   1. CAS-transition factory_sync_runs.status from 'pending' -> 'running'.
 *      If the row is already 'running' / 'ok' / 'failed' we skip: the
 *      worker is idempotent under at-least-once redelivery.
 *   2. Load the upstream config and resolve a token (PAT -> installation
 *      -> anonymous).
 *   3. Run the shared sync pipeline (clone + translate + upsert).
 *   4. Update the run row with status + shas + counts (or error).
 *   5. Mirror the final status onto factory_upstreams so the Overview page
 *      can keep reading the denormalised "current state" columns.
 */

import { Subscription } from "encore.dev/pubsub";
import log from "encore.dev/log";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  auditLog,
  factorySyncRuns,
  factoryUpstreams,
} from "../db/schema";
import { FactorySyncRequestTopic, type FactorySyncRequest } from "./events";
import { resolveFactoryUpstreamToken } from "./tokenResolver";
import { runSyncPipeline } from "./syncPipeline";
import { runScaffoldWarmup } from "../projects/scaffold/scheduler";
import {
  FACTORY_SOURCE_ID,
  TEMPLATE_SOURCE_ID,
} from "./upstreams";

async function handleSyncRequest(req: FactorySyncRequest): Promise<void> {
  const startedAt = new Date();

  const claimed = await db
    .update(factorySyncRuns)
    .set({ status: "running", startedAt })
    .where(
      and(
        eq(factorySyncRuns.id, req.syncRunId),
        eq(factorySyncRuns.status, "pending")
      )
    )
    .returning({ id: factorySyncRuns.id });

  if (claimed.length === 0) {
    log.info("factory sync worker: run already claimed, skipping", {
      syncRunId: req.syncRunId,
      orgId: req.orgId,
    });
    return;
  }

  // Spec 139 Phase 4b — factory_upstreams is N-per-org. The legacy
  // singleton wire shape composes from two rows: `factory`
  // (factory side, role='mixed') and `template` (template
  // side, role='scaffold'). The four legacy per-side columns are
  // dropped in migration 35 — repo_url + ref are the canonical fields.
  const sideRows = await db
    .select()
    .from(factoryUpstreams)
    .where(
      and(
        eq(factoryUpstreams.orgId, req.orgId),
        sql`${factoryUpstreams.sourceId} IN (${FACTORY_SOURCE_ID}, ${TEMPLATE_SOURCE_ID})`,
      ),
    );
  const factoryRow = sideRows.find(
    (r) => r.sourceId === FACTORY_SOURCE_ID,
  );
  const templateRow = sideRows.find(
    (r) => r.sourceId === TEMPLATE_SOURCE_ID,
  );

  if (!factoryRow || !templateRow) {
    await failRun(
      req,
      "factory upstream not configured for org; reconfigure via POST /api/factory/upstreams",
    );
    return;
  }

  const factorySource = factoryRow.repoUrl;
  const factoryRef = factoryRow.ref;
  const templateSource = templateRow.repoUrl;
  const templateRef = templateRow.ref;

  await db
    .update(factoryUpstreams)
    .set({
      lastSyncStatus: "running",
      lastSyncError: null,
      updatedAt: startedAt,
    })
    .where(
      and(
        eq(factoryUpstreams.orgId, req.orgId),
        eq(factoryUpstreams.sourceId, FACTORY_SOURCE_ID),
      ),
    );

  try {
    const resolved = await resolveFactoryUpstreamToken(req.orgId);
    const result = await runSyncPipeline({
      orgId: req.orgId,
      factorySource,
      factoryRef,
      // Spec 199 FR-003 — origin-from-source: the substrate origin is the
      // upstream row's stable per-org source_id, never a static constant.
      factorySourceId: factoryRow.sourceId,
      templateSource,
      templateRef,
      templateSourceId: templateRow.sourceId,
      token: resolved?.token,
    });

    const completedAt = new Date();
    await db
      .update(factorySyncRuns)
      .set({
        status: "ok",
        factorySha: result.factorySha,
        templateSha: result.templateSha,
        counts: result.counts,
        completedAt,
      })
      .where(eq(factorySyncRuns.id, req.syncRunId));

    await db.insert(auditLog).values({
      actorUserId: req.triggeredBy,
      action: "factory.upstreams.sync_ok",
      targetType: "factory_sync_runs",
      targetId: req.syncRunId,
      metadata: {
        orgId: req.orgId,
        factorySha: result.factorySha,
        templateSha: result.templateSha,
        counts: result.counts,
        tokenSource: resolved?.source ?? "anonymous",
      },
    });

    // Spec 140 §2.1 — a successful /factory-sync may have just produced
    // adapter rows whose projected manifest carries `scaffold_source_id`
    // resolving to a `factory_upstreams` row. Kick the scaffold warmup
    // immediately so the Create form unlocks without waiting for the
    // next 30-min cron tick.
    void runScaffoldWarmup().catch((err) => {
      log.warn("factory sync worker: post-sync warmup trigger failed", {
        syncRunId: req.syncRunId,
        orgId: req.orgId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("factory sync worker: pipeline failed", {
      syncRunId: req.syncRunId,
      orgId: req.orgId,
      err: message,
    });
    await failRun(req, message);
  }
}

/**
 * Sanitize a pipeline error before it is written to the `error` /
 * `last_sync_error` TEXT columns. A failure message can embed the offending
 * payload (e.g. a Postgres error quoting the binary INSERT params), and a NUL
 * byte there would make the failRun UPDATE itself throw "invalid byte sequence
 * for encoding UTF8: 0x00", leaving the run stuck `running` forever with the
 * message NSQ-requeued. Strip NUL bytes and cap length so recording a failure
 * can never fail. This is the recovery path; it must always succeed.
 */
function sanitizeRunError(message: string): string {
  const stripped = message.replace(/\u0000/g, "");
  const MAX = 8000;
  return stripped.length > MAX
    ? `${stripped.slice(0, MAX)}… [truncated ${stripped.length - MAX} chars]`
    : stripped;
}

async function failRun(
  req: FactorySyncRequest,
  message: string
): Promise<void> {
  const completedAt = new Date();
  const safeMessage = sanitizeRunError(message);
  await db
    .update(factorySyncRuns)
    .set({ status: "failed", error: safeMessage, completedAt })
    .where(eq(factorySyncRuns.id, req.syncRunId));

  await db
    .update(factoryUpstreams)
    .set({
      lastSyncStatus: "failed",
      lastSyncError: safeMessage,
      updatedAt: completedAt,
    })
    .where(
      and(
        eq(factoryUpstreams.orgId, req.orgId),
        eq(factoryUpstreams.sourceId, FACTORY_SOURCE_ID),
      ),
    );

  await db.insert(auditLog).values({
    actorUserId: req.triggeredBy,
    action: "factory.upstreams.sync_failed",
    targetType: "factory_sync_runs",
    targetId: req.syncRunId,
    metadata: { orgId: req.orgId, error: safeMessage },
  });
}

const _syncWorker = new Subscription(FactorySyncRequestTopic, "factory-sync-worker", {
  handler: handleSyncRequest,
});
void _syncWorker;
