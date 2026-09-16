// Spec 115 §5 (amended by spec 119) — heavy-lifting logic for the extraction worker.
//
// This module is the only place that mutates `knowledge_extraction_runs`
// and the only place that advances `knowledge_objects.state` outside the
// (legacy, gated) `transitionState` endpoint. It exposes three entry
// points:
//
//   - `enqueueExtraction(...)` — FR-003. Inserts a `pending` run row +
//     publishes the topic + handles enqueue-failure recovery. Idempotency
//     key is `(projectId, contentHash, extractorVersion)` over the last
//     24h (spec 119 collapsed the legacy workspace scope into project).
//   - `runExtractionWork(...)` — FR-004. The worker calls this once it has
//     CAS-claimed a row. CAS-transitions the object to `extracting`, picks
//     an extractor, runs it, validates the typed output, advances the
//     object to `extracted`, and audits.
//   - `markRunFailed(...)` — FR-022. Reverts the object to `imported` with
//     `lastExtractionError` populated, marks the run `failed`, audits.
//
// The Subscription that drives `runExtractionWork` lives in
// `extractionWorker.ts`; the staleness sweeper that recovers crashed runs
// lives in `scheduler.ts`. Both are thin wrappers around this module.

import { and, eq, gte, sql } from "drizzle-orm";
import log from "encore.dev/log";
import { db } from "../db/drizzle";
import {
  auditLog,
  knowledgeExtractionRuns,
  knowledgeObjects,
  projects,
} from "../db/schema";
import { broadcastToOrg } from "../sync/sync";
import {
  KNOWLEDGE_EXTRACTED,
  KNOWLEDGE_EXTRACTION_FAILED,
  KNOWLEDGE_UNSUPPORTED_TYPE,
} from "./auditActions";
import {
  ExtractorReturnedMalformedOutputError,
  validateExtractionOutput,
  type ExtractionOutput,
} from "./extractionOutput";
import {
  resolveExtractionPolicy,
} from "./extractionPolicy";
import {
  pickExtractor,
  pickExtractorVersion,
} from "./extractors/dispatch";
// Side-effect import populates the dispatch registry with the
// deterministic + agent extractors. enqueueExtraction calls
// pickExtractorVersion at queue time, so the registry must be live
// before the very first enqueue, not just before the worker fires.
import "./extractors";
import {
  ExtractorError,
  type ExtractorContext,
  type ExtractorInput,
  type ExtractorLogger,
  type TokenSpendReporter,
} from "./extractors/types";
import { getObject, getPresignedDownloadUrl, sniffMimeType } from "./storage";
import {
  KnowledgeExtractionRequestTopic,
} from "./extractionEvents";

// ---------------------------------------------------------------------------
// Tunables (env-driven, with defaults)
// ---------------------------------------------------------------------------

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

// FR-003: idempotency window — the same (project, contentHash, version)
// key dedupes only against runs queued in the last 24h. Older runs
// (failed or completed) do not block a fresh enqueue, so an operator-
// driven re-extract a week later still works.
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

// Spec 143 §12 FU-019 — synthetic policy used only to probe the
// dispatch registry for "would any extractor handle this MIME under
// any policy?" Constructing it inline next to a real policy would be
// noisy and easy to drift; pinning it as a module-scoped constant
// keeps the probe legible and grep-able. NOT a real authorisation
// signal — never reaches the extractor's `extract` call.
const MAXIMALLY_PERMISSIVE_POLICY_FOR_DISPATCH_PROBE: {
  visionAllowed: boolean;
  audioAllowed: boolean;
  costCeilingUsdPerCall: number;
  costCeilingUsdPerDay: number;
  source: "compiled_bundle";
} = {
  visionAllowed: true,
  audioAllowed: true,
  costCeilingUsdPerCall: Number.MAX_SAFE_INTEGER,
  costCeilingUsdPerDay: Number.MAX_SAFE_INTEGER,
  source: "compiled_bundle",
};

// FR-023: cap on auto-retries. PubSub at-least-once will redeliver a
// message after a worker crash; the cap prevents a poison object from
// looping forever. The Retry endpoint (FR-010) ignores this cap.
const DEFAULT_MAX_AUTO_RETRIES = 2;

function getMaxAutoRetries(): number {
  const v = process.env.statecraft_EXTRACT_MAX_AUTO_RETRIES;
  if (!v) return DEFAULT_MAX_AUTO_RETRIES;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MAX_AUTO_RETRIES;
}

// Eager-buffer threshold for ExtractorInput.buffer. Below this we hand the
// extractor an in-memory Buffer; above it we hand only the presigned
// download URL. Tunable via env to support load-test scenarios.
const DEFAULT_EAGER_BUFFER_BYTES = 4 * 1024 * 1024;

function getEagerBufferThreshold(): number {
  const v = process.env.statecraft_EXTRACT_EAGER_BUFFER_BYTES;
  if (!v) return DEFAULT_EAGER_BUFFER_BYTES;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_EAGER_BUFFER_BYTES;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ExtractionFailureCode =
  | "extractor_not_implemented"
  | "extractor_failed"
  | "extractor_returned_malformed_output"
  | "object_too_large"
  | "policy_pending"
  | "policy_denied"
  | "object_missing"
  | "enqueue_failed"
  | "worker_crashed"
  | "auto_retry_exhausted"
  | "abandoned"
  // Spec 143 §12 FU-019 — recorded on the run row's `error.code` when
  // no registered extractor's `canHandle` predicate matches the MIME
  // under any policy. The knowledge_object surface uses the
  // `unsupported_type` state with `lastExtractionError = null`; this
  // code carries the audit-trail reason on the run row itself.
  | "unsupported_type"
  | string;

export type StoredExtractionError = {
  code: ExtractionFailureCode;
  message: string;
  extractorKind: string | null;
  attemptedAt: string;
};

// ---------------------------------------------------------------------------
// Enqueue (FR-003)
// ---------------------------------------------------------------------------

export type EnqueueExtractionArgs = {
  knowledgeObjectId: string;
  projectId: string;
  reason: "upload_confirmed" | "connector_sync" | "retry" | string;
};

export type EnqueueExtractionResult = {
  runId: string;
  /**
   * `enqueued` = a fresh row was inserted and a topic message published.
   * `deduped` = an existing non-failed run within the idempotency window
   *   matched the (project, contentHash, extractorVersion) key; we
   *   returned its id without inserting.
   */
  outcome: "enqueued" | "deduped";
};

export async function enqueueExtraction(
  args: EnqueueExtractionArgs,
): Promise<EnqueueExtractionResult> {
  // 1. Load the object row to get the idempotency-key inputs.
  const [obj] = await db
    .select({
      id: knowledgeObjects.id,
      projectId: knowledgeObjects.projectId,
      filename: knowledgeObjects.filename,
      mimeType: knowledgeObjects.mimeType,
      sizeBytes: knowledgeObjects.sizeBytes,
      contentHash: knowledgeObjects.contentHash,
      storageKey: knowledgeObjects.storageKey,
    })
    .from(knowledgeObjects)
    .where(eq(knowledgeObjects.id, args.knowledgeObjectId))
    .limit(1);
  if (!obj) {
    throw new Error(
      `enqueueExtraction: knowledge object ${args.knowledgeObjectId} not found`,
    );
  }
  if (obj.projectId !== args.projectId) {
    throw new Error(
      `enqueueExtraction: project mismatch for object ${args.knowledgeObjectId}`,
    );
  }

  // 2. Resolve the policy and pick an extractor for the idempotency key.
  //    Phase 1a: dispatch is empty so this returns the "unresolved"
  //    placeholder; Phase 1b/2 fill it in. The placeholder is stable
  //    enough to dedupe back-to-back enqueues during the unimplemented
  //    window — when the extractor lands, fresh enqueues will pick its
  //    real version and produce a fresh run.
  const policy = await resolveExtractionPolicy(args.projectId);
  const dummyInput: ExtractorInput = {
    knowledgeObjectId: obj.id,
    projectId: obj.projectId,
    filename: obj.filename,
    mimeType: obj.mimeType,
    sizeBytes: obj.sizeBytes,
    contentHash: obj.contentHash,
    buffer: null,
    downloadUrl: "",
    bucket: "",
    storageKey: obj.storageKey,
  };
  const versionInfo = pickExtractorVersion(dummyInput, policy);

  // 3. Idempotency: any non-failed run in the last 24h with the same
  //    (project, contentHash, extractorVersion) wins.
  const sinceMs = Date.now() - IDEMPOTENCY_WINDOW_MS;
  const existing = await db
    .select({
      id: knowledgeExtractionRuns.id,
      status: knowledgeExtractionRuns.status,
    })
    .from(knowledgeExtractionRuns)
    .innerJoin(
      knowledgeObjects,
      eq(knowledgeExtractionRuns.knowledgeObjectId, knowledgeObjects.id),
    )
    .where(
      and(
        eq(knowledgeExtractionRuns.projectId, args.projectId),
        eq(knowledgeObjects.contentHash, obj.contentHash),
        eq(knowledgeExtractionRuns.extractorVersion, versionInfo.version),
        gte(knowledgeExtractionRuns.queuedAt, new Date(sinceMs)),
      ),
    )
    .orderBy(sql`${knowledgeExtractionRuns.queuedAt} DESC`)
    .limit(1);
  const live = existing.find(
    (r) => r.status === "pending" || r.status === "running" || r.status === "completed",
  );
  if (live) {
    log.info("enqueueExtraction: deduped to existing run", {
      knowledgeObjectId: args.knowledgeObjectId,
      runId: live.id,
      status: live.status,
      reason: args.reason,
    });
    return { runId: live.id, outcome: "deduped" };
  }

  // 4. Insert the pending row. Stamp the placeholder version + kind so the
  //    idempotency check above resolves consistently against future
  //    duplicate enqueues. The worker will overwrite both columns once it
  //    re-resolves at run time.
  const [run] = await db
    .insert(knowledgeExtractionRuns)
    .values({
      knowledgeObjectId: args.knowledgeObjectId,
      projectId: args.projectId,
      status: "pending",
      extractorKind: versionInfo.kind,
      extractorVersion: versionInfo.version,
    })
    .returning({ id: knowledgeExtractionRuns.id });

  // 5. Publish. On publish failure, mark the row `failed` with code
  //    `enqueue_failed` so a Retry can resurrect it (matches spec 114
  //    FR-003 semantics).
  try {
    await KnowledgeExtractionRequestTopic.publish({ extractionRunId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("enqueueExtraction: publish failed", {
      runId: run.id,
      err: message,
    });
    await db
      .update(knowledgeExtractionRuns)
      .set({
        status: "failed",
        error: {
          code: "enqueue_failed",
          message,
          extractorKind: versionInfo.kind,
          attemptedAt: new Date().toISOString(),
        } satisfies StoredExtractionError,
        completedAt: new Date(),
      })
      .where(eq(knowledgeExtractionRuns.id, run.id));
    return { runId: run.id, outcome: "enqueued" };
  }

  log.info("enqueueExtraction: enqueued", {
    runId: run.id,
    knowledgeObjectId: args.knowledgeObjectId,
    extractorKind: versionInfo.kind,
    extractorVersion: versionInfo.version,
    reason: args.reason,
  });
  return { runId: run.id, outcome: "enqueued" };
}

// ---------------------------------------------------------------------------
// Worker run (FR-004)
// ---------------------------------------------------------------------------

export async function runExtractionWork(args: {
  extractionRunId: string;
}): Promise<void> {
  const startedAtMs = Date.now();

  // CAS-transition pending → running, stamping runningAt and incrementing
  // attempts atomically. A redelivered message that finds the row already
  // running/completed/failed/abandoned is a no-op (FR-005).
  const claimed = await db
    .update(knowledgeExtractionRuns)
    .set({
      status: "running",
      runningAt: new Date(),
      attempts: sql`${knowledgeExtractionRuns.attempts} + 1`,
    })
    .where(
      and(
        eq(knowledgeExtractionRuns.id, args.extractionRunId),
        eq(knowledgeExtractionRuns.status, "pending"),
      ),
    )
    .returning({
      id: knowledgeExtractionRuns.id,
      knowledgeObjectId: knowledgeExtractionRuns.knowledgeObjectId,
      projectId: knowledgeExtractionRuns.projectId,
      attempts: knowledgeExtractionRuns.attempts,
    });

  if (claimed.length === 0) {
    log.info("runExtractionWork: redelivery, nothing to claim", {
      runId: args.extractionRunId,
    });
    return;
  }
  const run = claimed[0];

  // Auto-retry cap (FR-023). The CAS above already incremented `attempts`,
  // so check after the claim. If we've exceeded the cap, bail to `failed`
  // with `auto_retry_exhausted`. Operator-Retry creates a fresh row with
  // attempts back at 0.
  if (run.attempts > getMaxAutoRetries() + 1) {
    log.info("runExtractionWork: auto-retry cap exceeded", {
      runId: run.id,
      attempts: run.attempts,
    });
    await markRunFailedInternal({
      runId: run.id,
      knowledgeObjectId: run.knowledgeObjectId,
      projectId: run.projectId,
      error: {
        code: "auto_retry_exhausted",
        message: `auto-retry cap of ${getMaxAutoRetries()} exhausted`,
        extractorKind: null,
        attemptedAt: new Date().toISOString(),
      },
    });
    return;
  }

  // Load the object and resolve the policy. If the object disappeared
  // between enqueue and worker, transition the run to `abandoned` and
  // exit cleanly without an audit row (spec §4 edge case).
  const [obj] = await db
    .select()
    .from(knowledgeObjects)
    .where(eq(knowledgeObjects.id, run.knowledgeObjectId))
    .limit(1);
  if (!obj) {
    log.info("runExtractionWork: object vanished, abandoning run", {
      runId: run.id,
      knowledgeObjectId: run.knowledgeObjectId,
    });
    await db
      .update(knowledgeExtractionRuns)
      .set({
        status: "abandoned",
        completedAt: new Date(),
        durationMs: Date.now() - startedAtMs,
      })
      .where(eq(knowledgeExtractionRuns.id, run.id));
    return;
  }

  const policy = await resolveExtractionPolicy(run.projectId);

  // Advance the object to `extracting` (FR-004). If it's already past
  // `imported` (e.g. operator manual transition while the message was in
  // flight), respect their state and don't clobber.
  if (obj.state === "imported") {
    await db
      .update(knowledgeObjects)
      .set({ state: "extracting", updatedAt: new Date() })
      .where(eq(knowledgeObjects.id, obj.id));
    await broadcastObjectUpdated(obj.projectId, {
      objectId: obj.id,
      state: "extracting",
      hasExtractionOutput: obj.extractionOutput != null,
      lastExtractionError: null,
    });
  }

  // Resolve project bucket once; needed for sniff + extractor input.
  const [project] = await db
    .select({ bucket: projects.objectStoreBucket })
    .from(projects)
    .where(eq(projects.id, obj.projectId))
    .limit(1);
  if (!project) {
    await markRunFailedInternal({
      runId: run.id,
      knowledgeObjectId: run.knowledgeObjectId,
      projectId: run.projectId,
      error: {
        code: "object_missing",
        message: `project ${obj.projectId} not found`,
        extractorKind: null,
        attemptedAt: new Date().toISOString(),
      },
    });
    return;
  }

  // Mime sniff (FR-014). Reconcile declared mime against the magic
  // signature; on mismatch the sniffed value wins and we update the row.
  let resolvedMime = obj.mimeType;
  try {
    const sniff = await sniffMimeType({
      bucket: project.bucket,
      storageKey: obj.storageKey,
      declaredMime: obj.mimeType,
      sizeBytes: obj.sizeBytes,
    });
    resolvedMime = sniff.mimeType;
    if (sniff.mismatched) {
      log.warn("mime_mismatch", {
        runId: run.id,
        objectId: obj.id,
        declared: obj.mimeType,
        sniffed: sniff.sniffedAs,
      });
      await db
        .update(knowledgeObjects)
        .set({ mimeType: resolvedMime, updatedAt: new Date() })
        .where(eq(knowledgeObjects.id, obj.id));
    }
  } catch (err) {
    log.warn("mime sniff failed; falling back to declared", {
      runId: run.id,
      objectId: obj.id,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Build the extractor input (eagerly load buffer when small enough).
  const input: ExtractorInput = await buildExtractorInput(
    { ...obj, mimeType: resolvedMime },
    project.bucket,
  );

  const dispatch = pickExtractor(input, policy);
  if (!dispatch) {
    // Spec 143 §12 FU-019 — disambiguate "no extractor for this MIME"
    // from "an extractor exists but policy/fallback blocked it" before
    // emitting a red failure badge. Re-query the dispatcher with a
    // maximally-permissive synthetic policy; if it still returns null,
    // no registered extractor's `canHandle` predicate matches this
    // MIME under any policy — this is the `unsupported_type` case
    // (informational, not a pipeline failure). Reuses
    // `pickExtractor` unchanged; no dispatch.ts surface edit.
    const permissivePolicy = MAXIMALLY_PERMISSIVE_POLICY_FOR_DISPATCH_PROBE;
    const permissiveDispatch = pickExtractor(input, permissivePolicy);
    if (!permissiveDispatch) {
      await markRunUnsupportedInternal({
        runId: run.id,
        knowledgeObjectId: run.knowledgeObjectId,
        projectId: run.projectId,
        mimeType: input.mimeType,
      });
      return;
    }

    // An extractor exists for this MIME, but the real policy (or its
    // fallback shape) blocked it. Differentiate the failure by why.
    let code: ExtractionFailureCode;
    let message: string;
    if (policy.source === "default_fallback") {
      code = "policy_pending";
      message =
        "no policy bundle compiled for this project; agent extractors blocked";
    } else if (
      mimeRequiresAgent(input.mimeType) &&
      ((!policy.visionAllowed && isVisionMime(input.mimeType)) ||
        (!policy.audioAllowed && isAudioMime(input.mimeType)))
    ) {
      code = "policy_denied";
      message = `policy disallows ${
        isAudioMime(input.mimeType) ? "audio" : "vision"
      } extraction for ${input.mimeType}`;
    } else {
      code = "extractor_not_implemented";
      message = `no extractor registered for mime ${input.mimeType}`;
    }
    await markRunFailedInternal({
      runId: run.id,
      knowledgeObjectId: run.knowledgeObjectId,
      projectId: run.projectId,
      error: {
        code,
        message,
        extractorKind: null,
        attemptedAt: new Date().toISOString(),
      },
    });
    return;
  }

  // Stamp the resolved kind+version so the run row is honest about what ran.
  await db
    .update(knowledgeExtractionRuns)
    .set({
      extractorKind: dispatch.kind,
      extractorVersion: dispatch.version,
    })
    .where(eq(knowledgeExtractionRuns.id, run.id));

  // Per-run token-spend accumulator (agent extractors push into this).
  const collectedSpend: { input: number; output: number; cacheRead: number; cacheWrite: number } = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
  let collectedCostUsd = 0;
  const reportTokenSpend: TokenSpendReporter = (spend, costUsd) => {
    collectedSpend.input += spend.input;
    collectedSpend.output += spend.output;
    if (spend.cacheRead != null) collectedSpend.cacheRead += spend.cacheRead;
    if (spend.cacheWrite != null) collectedSpend.cacheWrite += spend.cacheWrite;
    collectedCostUsd += costUsd;
  };

  const ctx: ExtractorContext = {
    policy,
    log: makeExtractorLogger(run.id, dispatch.kind),
    reportTokenSpend,
  };

  let output: ExtractionOutput;
  try {
    const raw = await dispatch.extractor.extract(input, ctx);
    output = validateExtractionOutput(raw);
  } catch (err) {
    const failure = mapExtractorThrowToError(err, dispatch.kind);
    await markRunFailedInternal({
      runId: run.id,
      knowledgeObjectId: run.knowledgeObjectId,
      projectId: run.projectId,
      error: failure,
    });
    return;
  }

  // Mid-run deletion check (spec §4 edge case). Use FOR UPDATE inside a
  // transaction so a concurrent delete blocks until we either find the row
  // gone or write our output.
  let succeeded = false;
  try {
    await db.transaction(async (tx) => {
      const lockedRows = await tx
        .select({ id: knowledgeObjects.id, state: knowledgeObjects.state })
        .from(knowledgeObjects)
        .where(eq(knowledgeObjects.id, obj.id))
        .for("update")
        .limit(1);
      if (lockedRows.length === 0) {
        // Object vanished mid-run — abandon without audit.
        await tx
          .update(knowledgeExtractionRuns)
          .set({
            status: "abandoned",
            completedAt: new Date(),
            durationMs: Date.now() - startedAtMs,
          })
          .where(eq(knowledgeExtractionRuns.id, run.id));
        return;
      }

      await tx
        .update(knowledgeObjects)
        .set({
          state: "extracted",
          extractionOutput: output as unknown as Record<string, unknown>,
          lastExtractionError: null,
          updatedAt: new Date(),
        })
        .where(eq(knowledgeObjects.id, obj.id));

      const durationMs = Date.now() - startedAtMs;
      await tx
        .update(knowledgeExtractionRuns)
        .set({
          status: "completed",
          completedAt: new Date(),
          durationMs,
          tokenSpend:
            collectedSpend.input > 0 || collectedSpend.output > 0
              ? collectedSpend
              : null,
          costUsd:
            collectedCostUsd > 0 ? collectedCostUsd.toFixed(6) : null,
          agentRun: output.extractor.agentRun
            ? (output.extractor.agentRun as unknown as Record<string, unknown>)
            : null,
        })
        .where(eq(knowledgeExtractionRuns.id, run.id));

      const auditMeta: Record<string, unknown> = {
        runId: run.id,
        extractorKind: dispatch.kind,
        extractorVersion: dispatch.version,
        durationMs,
        projectId: obj.projectId,
      };
      if (output.extractor.agentRun) {
        auditMeta.modelId = output.extractor.agentRun.modelId;
        auditMeta.promptFingerprint =
          output.extractor.agentRun.promptFingerprint;
        auditMeta.costUsd = output.extractor.agentRun.costUsd;
        auditMeta.tokenSpend = output.extractor.agentRun.tokenSpend;
      }
      await tx.insert(auditLog).values({
        actorUserId: SYSTEM_USER_ID,
        action: KNOWLEDGE_EXTRACTED,
        targetType: "knowledge_object",
        targetId: obj.id,
        metadata: auditMeta,
      });

      succeeded = true;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("runExtractionWork: write transaction failed", {
      runId: run.id,
      err: message,
    });
    await markRunFailedInternal({
      runId: run.id,
      knowledgeObjectId: run.knowledgeObjectId,
      projectId: run.projectId,
      error: {
        code: "extractor_failed",
        message: `commit failed: ${message}`,
        extractorKind: dispatch.kind,
        attemptedAt: new Date().toISOString(),
      },
    });
    return;
  }

  if (succeeded) {
    await broadcastObjectUpdated(obj.projectId, {
      objectId: obj.id,
      state: "extracted",
      hasExtractionOutput: true,
      lastExtractionError: null,
    });
  }
}

// ---------------------------------------------------------------------------
// Failure handling (FR-022)
// ---------------------------------------------------------------------------

export async function markRunFailed(args: {
  runId: string;
  error: StoredExtractionError;
}): Promise<void> {
  const [row] = await db
    .select({
      knowledgeObjectId: knowledgeExtractionRuns.knowledgeObjectId,
      projectId: knowledgeExtractionRuns.projectId,
      status: knowledgeExtractionRuns.status,
    })
    .from(knowledgeExtractionRuns)
    .where(eq(knowledgeExtractionRuns.id, args.runId))
    .limit(1);
  if (!row) {
    throw new Error(`markRunFailed: run ${args.runId} not found`);
  }
  await markRunFailedInternal({
    runId: args.runId,
    knowledgeObjectId: row.knowledgeObjectId,
    projectId: row.projectId,
    error: args.error,
  });
}

async function markRunFailedInternal(args: {
  runId: string;
  knowledgeObjectId: string;
  projectId: string;
  error: StoredExtractionError;
}): Promise<void> {
  const completedAt = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(knowledgeExtractionRuns)
      .set({
        status: "failed",
        completedAt,
        error: args.error,
      })
      .where(eq(knowledgeExtractionRuns.id, args.runId));

    // Revert the object to `imported` (FR-022) and stamp the typed error.
    // Skip the revert if the object is already past `extracted` — a manual
    // transition or a successful subsequent run wins; we don't undo it.
    const [obj] = await tx
      .select({
        id: knowledgeObjects.id,
        state: knowledgeObjects.state,
      })
      .from(knowledgeObjects)
      .where(eq(knowledgeObjects.id, args.knowledgeObjectId))
      .limit(1);

    if (obj && (obj.state === "extracting" || obj.state === "imported")) {
      await tx
        .update(knowledgeObjects)
        .set({
          state: "imported",
          lastExtractionError: args.error,
          updatedAt: new Date(),
        })
        .where(eq(knowledgeObjects.id, obj.id));
    }

    await tx.insert(auditLog).values({
      actorUserId: SYSTEM_USER_ID,
      action: KNOWLEDGE_EXTRACTION_FAILED,
      targetType: "knowledge_object",
      targetId: args.knowledgeObjectId,
      metadata: {
        runId: args.runId,
        code: args.error.code,
        message: args.error.message,
        extractorKind: args.error.extractorKind,
        projectId: args.projectId,
      },
    });
  });

  await broadcastObjectUpdated(args.projectId, {
    objectId: args.knowledgeObjectId,
    state: "imported",
    hasExtractionOutput: false,
    lastExtractionError: { code: args.error.code },
  });
}

// Spec 143 §12 FU-019 — terminal "no extractor for this MIME under
// any policy" disposition. Unlike `markRunFailedInternal`, this does
// NOT revert the object to `imported` with a red error code. The run
// row's `error.code = "unsupported_type"` carries the audit-trail
// reason; the object's surface state is `unsupported_type` with
// `lastExtractionError = null` so the dashboard renders informational,
// not red (done-when (c)).
//
// The orphan-imported sweeper (`orphanSweeper.ts:110-115`) narrows its
// candidate WHERE clause to `state = 'imported' AND createdAt < cutoff`,
// so rows that land in `unsupported_type` are excluded by construction
// — see done-when (d) closure rationale in §12 FU-019.
async function markRunUnsupportedInternal(args: {
  runId: string;
  knowledgeObjectId: string;
  projectId: string;
  mimeType: string;
}): Promise<void> {
  const completedAt = new Date();
  const error: StoredExtractionError = {
    code: "unsupported_type",
    message: `no extractor registered for mime ${args.mimeType} under any policy`,
    extractorKind: null,
    attemptedAt: completedAt.toISOString(),
  };

  await db.transaction(async (tx) => {
    await tx
      .update(knowledgeExtractionRuns)
      .set({
        status: "failed",
        completedAt,
        error,
      })
      .where(eq(knowledgeExtractionRuns.id, args.runId));

    // Advance the object to `unsupported_type` only from a pre-terminal
    // state — mirror `markRunFailedInternal`'s guard so a manual
    // transition or a successful subsequent run does not get clobbered.
    const [obj] = await tx
      .select({
        id: knowledgeObjects.id,
        state: knowledgeObjects.state,
      })
      .from(knowledgeObjects)
      .where(eq(knowledgeObjects.id, args.knowledgeObjectId))
      .limit(1);

    if (obj && (obj.state === "extracting" || obj.state === "imported")) {
      await tx
        .update(knowledgeObjects)
        .set({
          state: "unsupported_type",
          lastExtractionError: null,
          updatedAt: new Date(),
        })
        .where(eq(knowledgeObjects.id, obj.id));
    }

    await tx.insert(auditLog).values({
      actorUserId: SYSTEM_USER_ID,
      action: KNOWLEDGE_UNSUPPORTED_TYPE,
      targetType: "knowledge_object",
      targetId: args.knowledgeObjectId,
      metadata: {
        runId: args.runId,
        mimeType: args.mimeType,
        projectId: args.projectId,
      },
    });
  });

  await broadcastObjectUpdated(args.projectId, {
    objectId: args.knowledgeObjectId,
    state: "unsupported_type",
    hasExtractionOutput: false,
    lastExtractionError: null,
  });
}

// ---------------------------------------------------------------------------
// Sweeper (FR-006). Called by scheduler.ts cron every 60s.
// ---------------------------------------------------------------------------

export async function sweepStaleExtractionRuns(now: Date = new Date()): Promise<{
  swept: number;
}> {
  const staleAfterSec = (() => {
    const v = process.env.statecraft_EXTRACT_STALE_AFTER_SEC;
    if (!v) return 600;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : 600;
  })();
  const cutoff = new Date(now.getTime() - staleAfterSec * 1000);

  const stale = await db
    .select({
      id: knowledgeExtractionRuns.id,
      knowledgeObjectId: knowledgeExtractionRuns.knowledgeObjectId,
      projectId: knowledgeExtractionRuns.projectId,
      extractorKind: knowledgeExtractionRuns.extractorKind,
    })
    .from(knowledgeExtractionRuns)
    .where(
      and(
        eq(knowledgeExtractionRuns.status, "running"),
        sql`${knowledgeExtractionRuns.runningAt} < ${cutoff}`,
      ),
    );

  if (stale.length === 0) {
    return { swept: 0 };
  }

  for (const row of stale) {
    await markRunFailedInternal({
      runId: row.id,
      knowledgeObjectId: row.knowledgeObjectId,
      projectId: row.projectId,
      error: {
        code: "worker_crashed",
        message: `run was running > ${staleAfterSec}s without completion`,
        extractorKind: row.extractorKind,
        attemptedAt: now.toISOString(),
      },
    });
  }
  log.warn("sweepStaleExtractionRuns: recovered runs", {
    swept: stale.length,
    staleAfterSec,
  });
  return { swept: stale.length };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildExtractorInput(
  obj: typeof knowledgeObjects.$inferSelect,
  bucket: string,
): Promise<ExtractorInput> {
  const eagerThreshold = getEagerBufferThreshold();
  let buffer: Buffer | null = null;
  if (obj.sizeBytes > 0 && obj.sizeBytes <= eagerThreshold) {
    try {
      buffer = await getObject(bucket, obj.storageKey);
    } catch (err) {
      log.warn("buildExtractorInput: eager load failed; using URL", {
        objectId: obj.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const downloadUrl = await getPresignedDownloadUrl(
    bucket,
    obj.storageKey,
    3600,
  );
  return {
    knowledgeObjectId: obj.id,
    projectId: obj.projectId,
    filename: obj.filename,
    mimeType: obj.mimeType,
    sizeBytes: obj.sizeBytes,
    contentHash: obj.contentHash,
    buffer,
    downloadUrl,
    bucket,
    storageKey: obj.storageKey,
  };
}

function makeExtractorLogger(
  runId: string,
  extractorKind: string,
): ExtractorLogger {
  const fields = { runId, extractorKind };
  return {
    info: (msg, meta) => log.info(msg, { ...fields, ...meta }),
    warn: (msg, meta) => log.warn(msg, { ...fields, ...meta }),
    error: (msg, meta) => log.error(msg, { ...fields, ...meta }),
  };
}

function mapExtractorThrowToError(
  err: unknown,
  extractorKind: string,
): StoredExtractionError {
  if (err instanceof ExtractorReturnedMalformedOutputError) {
    return {
      code: "extractor_returned_malformed_output",
      message: err.message,
      extractorKind,
      attemptedAt: new Date().toISOString(),
    };
  }
  if (err instanceof ExtractorError) {
    return {
      code: err.code,
      message: err.message,
      extractorKind: err.extractorKind || extractorKind,
      attemptedAt: new Date().toISOString(),
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    code: "extractor_failed",
    message,
    extractorKind,
    attemptedAt: new Date().toISOString(),
  };
}

function isVisionMime(mime: string): boolean {
  if (mime.startsWith("image/")) return true;
  // PDFs that fell through deterministic-pdf-embedded reach the agent
  // dispatch path; vision is the gating policy for them too.
  if (mime === "application/pdf") return true;
  return false;
}

function isAudioMime(mime: string): boolean {
  return mime.startsWith("audio/");
}

function mimeRequiresAgent(mime: string): boolean {
  // Best-effort: any mime not handled by a deterministic extractor needs
  // an agent. The dispatcher walked the registry already; we only call
  // this when no extractor matched.
  return isVisionMime(mime) || isAudioMime(mime);
}

// ---------------------------------------------------------------------------
// Broadcast (FR-029)
// ---------------------------------------------------------------------------

export type KnowledgeObjectUpdatedPayload = {
  objectId: string;
  state: string;
  hasExtractionOutput: boolean;
  lastExtractionError: { code: ExtractionFailureCode } | null;
};

// Spec 120 FR-016 — exported so the external POST `extraction-output`
// handler can surface the same duplex notification the internal worker
// emits, keeping OPC's subscription path uniform.
export async function broadcastObjectUpdated(
  projectId: string,
  payload: KnowledgeObjectUpdatedPayload,
): Promise<void> {
  // Resolve the org for the broadcast key. If the project has been
  // deleted between the work and the broadcast, log and drop the event —
  // an audit row already records the run's terminal state.
  const [project] = await db
    .select({ orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) {
    log.warn("broadcastObjectUpdated: project not found, dropping event", {
      projectId,
      objectId: payload.objectId,
    });
    return;
  }
  broadcastToOrg(project.orgId, {
    type: "knowledge.object.updated",
    orgId: project.orgId,
    timestamp: new Date().toISOString(),
    payload: {
      ...payload,
      projectId,
    } as unknown as Record<string, unknown>,
  });
}
