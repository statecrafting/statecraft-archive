// Spec 124 §6 / §6.1 — duplex handlers for the `factory.run.*` envelope family.
//
// Five envelopes flow over the duplex bus from OPC into a `factory_runs`
// row that the platform created at reservation time (`POST /api/factory/runs`,
// Phase 2). The handlers here are thin business-logic shims; transport
// concerns (envelope decoding, ACK/NACK, inbox persistence) live in
// `api/sync/service.ts::handleInbound` which dispatches into this module
// after `isClientEnvelope` has validated the envelope shape.
//
// Idempotency contract (spec §6 step 5): every handler is keyed on the
// `(run_id, stage_id, status)` tuple where applicable so at-least-once
// duplex delivery is safe. Out-of-order arrival (`stage_completed` before
// `stage_started`) is tolerated — `handleStageCompleted` synthesises a
// stage_progress entry rather than reject (spec T032 / §6).
//
// Authority invariant (spec §3): every handler asserts that
// `factory_runs.org_id` matches the duplex session's authenticated org.
// A foreign-org event is `org_mismatch` — never silently dropped, never
// allowed to reach the persistence layer.

import log from "encore.dev/log";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  factoryRuns,
  auditLog,
  type FactoryRunStageProgressEntry,
  type FactoryRunStatus,
  type FactoryRunTokenSpend,
} from "../db/schema";
import {
  FACTORY_RUN_COMPLETED,
  FACTORY_RUN_FAILED,
  FACTORY_RUN_CANCELLED,
} from "./auditActions";
import type {
  ClientFactoryRunStageStarted,
  ClientFactoryRunStageCompleted,
  ClientFactoryRunCompleted,
  ClientFactoryRunFailed,
  ClientFactoryRunCancelled,
  FactoryAgentRef,
} from "../sync/types";

// ---------------------------------------------------------------------------
// Result type — mirrors the sync service's `InboundResult` so the dispatch
// in `handleInbound` can pass a handler verdict straight through to the
// ACK/NACK publisher.
// ---------------------------------------------------------------------------

export type RunHandlerResult =
  | { ok: true }
  | {
      ok: false;
      reason: "invalid" | "org_mismatch" | "internal_error";
      detail?: string;
    };

interface HandlerCtx {
  orgId: string;
  userId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load the run and assert its `org_id` matches the duplex session's. A
 * mismatch returns `{ ok: false, reason: "org_mismatch" }` — never a 404,
 * because mixing the response codes would let a probe distinguish "row
 * exists in another org" from "row does not exist". Returning a uniform
 * `org_mismatch` for any non-owned row is simpler and tighter.
 */
export async function loadOwnedRun(
  runId: string,
  orgId: string,
): Promise<
  | { ok: true; row: typeof factoryRuns.$inferSelect }
  | { ok: false; reason: "invalid" | "org_mismatch"; detail: string }
> {
  if (!runId || typeof runId !== "string") {
    return { ok: false, reason: "invalid", detail: "runId required" };
  }
  const [row] = await db
    .select()
    .from(factoryRuns)
    .where(eq(factoryRuns.id, runId))
    .limit(1);
  if (!row) {
    return { ok: false, reason: "invalid", detail: "run not found" };
  }
  if (row.orgId !== orgId) {
    return {
      ok: false,
      reason: "org_mismatch",
      detail: "run belongs to a different org",
    };
  }
  return { ok: true, row };
}

/** Convert a wire-shape `FactoryAgentRef` (camelCase) into the snake_case
 *  shape persisted under `factory_runs.stage_progress[*].agent_ref`. */
function agentRefToDb(
  ref: FactoryAgentRef,
): NonNullable<FactoryRunStageProgressEntry["agent_ref"]> {
  return {
    org_agent_id: ref.orgAgentId,
    version: ref.version,
    content_hash: ref.contentHash,
  };
}

/**
 * Spec 139 Phase 3 (T073/T074) — resolve the (legacy) `agentRef` and the
 * (new) `artifactRef` envelopes into the canonical persisted shape. The
 * substrate guarantees `artifactId === orgAgentId` for migrated
 * user-authored agents (migration 33 §1) so the persisted row carries
 * the same triple regardless of which envelope the desktop emitted.
 *
 * Backward-compat window: handlers accept either field. `artifactRef`
 * wins when both are present (forward-leaning).
 */
function resolveStageRefForDb(
  evt: ClientFactoryRunStageStarted,
):
  | NonNullable<FactoryRunStageProgressEntry["agent_ref"]>
  | undefined {
  if (evt.artifactRef) {
    return {
      org_agent_id: evt.artifactRef.artifactId,
      version: evt.artifactRef.version,
      content_hash: evt.artifactRef.contentHash,
    };
  }
  if (evt.agentRef) {
    return agentRefToDb(evt.agentRef);
  }
  return undefined;
}

/** Find the latest stage_progress entry for `stageId` (newest by index). */
function findStageEntry(
  progress: FactoryRunStageProgressEntry[],
  stageId: string,
): { index: number; entry: FactoryRunStageProgressEntry } | undefined {
  for (let i = progress.length - 1; i >= 0; i -= 1) {
    if (progress[i].stage_id === stageId) {
      return { index: i, entry: progress[i] };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// factory.run.stage_started
// ---------------------------------------------------------------------------

export async function handleStageStarted(
  evt: ClientFactoryRunStageStarted,
  ctx: HandlerCtx,
): Promise<RunHandlerResult> {
  const owned = await loadOwnedRun(evt.runId, ctx.orgId);
  if (!owned.ok) return owned;

  const { row } = owned;
  const progress = (row.stageProgress ?? []) as FactoryRunStageProgressEntry[];
  const existing = findStageEntry(progress, evt.stageId);

  // Idempotent re-delivery: a prior `stage_started` for the same
  // (run, stage) is a no-op.
  if (existing && existing.entry.status === "running") {
    log.info("sync: factory.run.stage_started — idempotent re-delivery", {
      runId: evt.runId,
      stageId: evt.stageId,
    });
    return { ok: true };
  }

  // If the entry already moved to a terminal state (e.g. completed before
  // started arrived in a re-order), do not regress it back to `running`.
  if (
    existing &&
    (existing.entry.status === "ok" ||
      existing.entry.status === "failed" ||
      existing.entry.status === "skipped")
  ) {
    log.info(
      "sync: factory.run.stage_started after terminal — leaving stage_progress as-is",
      { runId: evt.runId, stageId: evt.stageId, terminal: existing.entry.status },
    );
    // Still bump lastEventAt so the sweeper sees the row alive.
    await db
      .update(factoryRuns)
      .set({ lastEventAt: new Date() })
      .where(eq(factoryRuns.id, row.id));
    return { ok: true };
  }

  // Spec 139 Phase 3 (T073/T074) — accept either agentRef or artifactRef.
  // Reject only when neither shape is present.
  const stageRef = resolveStageRefForDb(evt);
  if (!stageRef) {
    log.warn("sync: factory.run.stage_started without agentRef or artifactRef", {
      runId: evt.runId,
      stageId: evt.stageId,
    });
    return {
      ok: false,
      reason: "invalid",
      detail: "factory.run.stage_started must carry agentRef or artifactRef",
    };
  }

  const newEntry: FactoryRunStageProgressEntry = {
    stage_id: evt.stageId,
    status: "running",
    started_at: evt.startedAt,
    agent_ref: stageRef,
  };

  // Append; ensure the row's status flips queued → running on first start.
  const nextProgress = [...progress, newEntry];
  const nextStatus: FactoryRunStatus =
    row.status === "queued" ? "running" : row.status;

  await db
    .update(factoryRuns)
    .set({
      stageProgress: nextProgress,
      status: nextStatus,
      lastEventAt: new Date(),
    })
    .where(eq(factoryRuns.id, row.id));

  return { ok: true };
}

// ---------------------------------------------------------------------------
// factory.run.stage_completed
// ---------------------------------------------------------------------------

export async function handleStageCompleted(
  evt: ClientFactoryRunStageCompleted,
  ctx: HandlerCtx,
): Promise<RunHandlerResult> {
  const owned = await loadOwnedRun(evt.runId, ctx.orgId);
  if (!owned.ok) return owned;

  const { row } = owned;
  const progress = (row.stageProgress ?? []) as FactoryRunStageProgressEntry[];
  const existing = findStageEntry(progress, evt.stageId);

  // Map per-stage outcome → stage_progress.status terminal.
  const terminalStatus: FactoryRunStageProgressEntry["status"] =
    evt.stageOutcome === "ok"
      ? "ok"
      : evt.stageOutcome === "failed"
        ? "failed"
        : "skipped";

  // Idempotent re-delivery: same terminal status already recorded.
  if (existing && existing.entry.status === terminalStatus) {
    log.info("sync: factory.run.stage_completed — idempotent re-delivery", {
      runId: evt.runId,
      stageId: evt.stageId,
      stageStatus: terminalStatus,
    });
    return { ok: true };
  }

  const nextProgress = [...progress];
  if (existing) {
    nextProgress[existing.index] = {
      ...existing.entry,
      status: terminalStatus,
      completed_at: evt.completedAt,
      ...(evt.error !== undefined ? { error: evt.error } : {}),
    };
  } else {
    // T032 — out-of-order delivery: synthesise an entry rather than fail.
    // We don't have a reliable `started_at` for the synthesised entry, so
    // set it to `completed_at` (best signal we have); the UI will render
    // a zero-duration stage which correctly conveys "finished before we
    // saw it start".
    nextProgress.push({
      stage_id: evt.stageId,
      status: terminalStatus,
      started_at: evt.completedAt,
      completed_at: evt.completedAt,
      ...(evt.error !== undefined ? { error: evt.error } : {}),
    });
    log.warn(
      "sync: factory.run.stage_completed without prior stage_started — synthesised",
      { runId: evt.runId, stageId: evt.stageId },
    );
  }

  // The row's lifecycle status is unaffected by stage completion alone —
  // it only flips on `factory.run.completed` / `failed` / `cancelled`.
  // But if the row is still `queued` and a stage completed, normalise to
  // `running` for consistency with the started-then-completed path.
  const nextRunStatus: FactoryRunStatus =
    row.status === "queued" ? "running" : row.status;

  await db
    .update(factoryRuns)
    .set({
      stageProgress: nextProgress,
      status: nextRunStatus,
      lastEventAt: new Date(),
    })
    .where(eq(factoryRuns.id, row.id));

  return { ok: true };
}

// ---------------------------------------------------------------------------
// factory.run.completed
// ---------------------------------------------------------------------------

export async function handleRunCompleted(
  evt: ClientFactoryRunCompleted,
  ctx: HandlerCtx,
): Promise<RunHandlerResult> {
  const owned = await loadOwnedRun(evt.runId, ctx.orgId);
  if (!owned.ok) return owned;

  const { row } = owned;

  // Idempotent re-delivery: the row is already in the same terminal state.
  if (row.status === "ok" && row.completedAt !== null) {
    return { ok: true };
  }

  const tokenSpend: FactoryRunTokenSpend = {
    input: evt.tokenSpend.input,
    output: evt.tokenSpend.output,
    total: evt.tokenSpend.total,
  };

  await db.transaction(async (tx) => {
    await tx
      .update(factoryRuns)
      .set({
        status: "ok",
        completedAt: new Date(evt.completedAt),
        tokenSpend,
        lastEventAt: new Date(),
        // Spec 198 FR-014 — the engine-reported certificate self-hash. The
        // countersign flow (grantDuplexHandlers.countersignRunCertificate)
        // verifies the grant chain and stamps `countersigned_at`.
        certificateSha256: evt.certificateSha256 ?? null,
        // Clear any prior `error` if a previous failed→retry sequence had
        // populated it. (Out of scope for v1 but cheap to be defensive.)
        error: null,
      })
      .where(eq(factoryRuns.id, row.id));

    await tx.insert(auditLog).values({
      actorUserId: ctx.userId,
      action: FACTORY_RUN_COMPLETED,
      targetType: "factory_runs",
      targetId: row.id,
      metadata: {
        orgId: ctx.orgId,
        adapterId: row.adapterId,
        processId: row.processId,
        clientRunId: row.clientRunId,
        tokenSpend,
      },
    });
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// factory.run.failed
// ---------------------------------------------------------------------------

export async function handleRunFailed(
  evt: ClientFactoryRunFailed,
  ctx: HandlerCtx,
): Promise<RunHandlerResult> {
  const owned = await loadOwnedRun(evt.runId, ctx.orgId);
  if (!owned.ok) return owned;

  const { row } = owned;

  if (row.status === "failed" && row.completedAt !== null) {
    return { ok: true };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(factoryRuns)
      .set({
        status: "failed",
        completedAt: new Date(evt.completedAt),
        error: evt.error,
        lastEventAt: new Date(),
        // Note: stageProgress is intentionally NOT overwritten so partial
        // per-stage state is preserved (spec §4 / T034).
      })
      .where(eq(factoryRuns.id, row.id));

    await tx.insert(auditLog).values({
      actorUserId: ctx.userId,
      action: FACTORY_RUN_FAILED,
      targetType: "factory_runs",
      targetId: row.id,
      metadata: {
        orgId: ctx.orgId,
        adapterId: row.adapterId,
        processId: row.processId,
        clientRunId: row.clientRunId,
        error: evt.error,
      },
    });
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// factory.run.cancelled
// ---------------------------------------------------------------------------

export async function handleRunCancelled(
  evt: ClientFactoryRunCancelled,
  ctx: HandlerCtx,
): Promise<RunHandlerResult> {
  const owned = await loadOwnedRun(evt.runId, ctx.orgId);
  if (!owned.ok) return owned;

  const { row } = owned;

  if (row.status === "cancelled" && row.completedAt !== null) {
    return { ok: true };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(factoryRuns)
      .set({
        status: "cancelled",
        completedAt: new Date(evt.completedAt),
        // `error` stays null on cancellation — the spec separates the two
        // (§4 row "Same shape as failed but `status = 'cancelled'`, no
        // `error` required").
        lastEventAt: new Date(),
      })
      .where(eq(factoryRuns.id, row.id));

    await tx.insert(auditLog).values({
      actorUserId: ctx.userId,
      action: FACTORY_RUN_CANCELLED,
      targetType: "factory_runs",
      targetId: row.id,
      metadata: {
        orgId: ctx.orgId,
        adapterId: row.adapterId,
        processId: row.processId,
        clientRunId: row.clientRunId,
        ...(evt.reason !== undefined ? { reason: evt.reason } : {}),
      },
    });
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Test-visible: count of factory_runs in a given org. Used by the duplex
// handler tests to assert that no row was created/mutated cross-org.
// ---------------------------------------------------------------------------
export async function _countRunsByOrg(orgId: string): Promise<number> {
  const rows = await db.execute(
    sql`SELECT count(*) AS c FROM factory_runs WHERE org_id = ${orgId}`,
  );
  return Number((rows.rows[0] as { c: string | number }).c);
}
