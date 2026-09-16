// Spec 200 — substrate override async scanner: enqueue, worker logic, and
// staleness sweeper (FR-001/FR-002/FR-005), plus the shared content-hash
// revocation sweep the enforcement sites consume (FR-003/FR-006).
//
// ARCHITECTURE CONSTRAINT (AC-1/AC-3): this module is imported by the
// `user_body` write paths (artifacts.ts, conflicts.ts, agents/catalog.ts),
// so it MUST NOT import the model client (`api/knowledge/extractors/
// agent-base.ts`). Model invocation is dependency-injected by the worker
// (`overrideScanWorker.ts`) — the only module allowed to import the model
// client. A model may DETECT; only rules may BLOCK: every enforcement
// surface in this file is a deterministic DB read.

import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import log from "encore.dev/log";
import { db } from "../db/drizzle";
import {
  factoryArtifactSubstrate,
  factoryArtifactSubstrateAudit,
  factoryOverrideScanRuns,
  factoryRevocations,
} from "../db/schema";
import { OverrideScanRequestTopic } from "./overrideScanEvents";
import {
  resolveOverrideScanPolicy,
  type OverrideScanPolicy,
} from "./overrideScanPolicy";
import {
  getOverrideScanPrompt,
  OVERRIDE_SCAN_PROMPT_KIND,
  type AssembledScanPrompt,
} from "./overrideScanPrompts";
import { estimateCallCostUsd } from "../knowledge/extractors/agent-cost-helpers";

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** Bump on scanner-logic change. The composed `scanner_version` below
 * subsumes the prompt registry version (FR-001): a prompt-only update
 * produces fresh, non-deduped runs. */
export const OVERRIDE_SCANNER_CODE_VERSION = "1";

export function overrideScannerVersion(): string {
  const prompt = getOverrideScanPrompt(OVERRIDE_SCAN_PROMPT_KIND);
  return `${OVERRIDE_SCANNER_CODE_VERSION}+prompt.${prompt.version}`;
}

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

function getStaleAfterSec(): number {
  const v = process.env.statecraft_OVERRIDE_SCAN_STALE_AFTER_SEC;
  if (!v) return 600;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 600;
}

function getMaxAutoRetries(): number {
  const v = process.env.statecraft_OVERRIDE_SCAN_MAX_AUTO_RETRIES;
  if (!v) return 2;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 2;
}

/** Rationale is untrusted model output stored as evidence; cap what rides
 * into the revocation `reason` so a hostile body cannot bloat audit rows. */
const RATIONALE_EVIDENCE_MAX_CHARS = 2000;

// ---------------------------------------------------------------------------
// FR-001 — durable intent inside the write transaction
// ---------------------------------------------------------------------------

export type RecordScanIntentArgs = {
  orgId: string;
  artifactId: string;
  /** The revision's content hash as stamped on the substrate row — the
   * future quarantine key (FR-002: sourced from here, never from model
   * output). */
  contentHash: string;
  reason: "override_applied" | "conflict_edit_accepted" | "agent_created" | "agent_patched";
};

export type RecordScanIntentResult = {
  scanRunId: string;
  /** `recorded` = fresh row inserted (publish after commit).
   * `deduped` = an existing queued|running|completed run for the same
   *   (org, artifact, content_hash, scanner_version) within the window
   *   absorbed the enqueue; `skipped`/`failed` runs do NOT absorb. */
  outcome: "recorded" | "deduped";
};

/**
 * Insert the scan run row INSIDE the caller's write transaction (durable
 * intent — deterministic bookkeeping, not model judgment). The caller MUST
 * call `publishOverrideScanRun` with the returned id after the transaction
 * commits; a lost publish is re-driven by the staleness sweeper.
 */
export async function recordOverrideScanIntent(
  tx: typeof db,
  args: RecordScanIntentArgs,
): Promise<RecordScanIntentResult> {
  const scannerVersion = overrideScannerVersion();
  const since = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
  const existing = await tx
    .select({
      id: factoryOverrideScanRuns.id,
      status: factoryOverrideScanRuns.status,
    })
    .from(factoryOverrideScanRuns)
    .where(
      and(
        eq(factoryOverrideScanRuns.orgId, args.orgId),
        eq(factoryOverrideScanRuns.artifactId, args.artifactId),
        eq(factoryOverrideScanRuns.contentHash, args.contentHash),
        eq(factoryOverrideScanRuns.scannerVersion, scannerVersion),
        gte(factoryOverrideScanRuns.queuedAt, since),
        inArray(factoryOverrideScanRuns.status, [
          "queued",
          "running",
          "completed",
        ]),
      ),
    )
    .limit(1);
  if (existing[0]) {
    return { scanRunId: existing[0].id, outcome: "deduped" };
  }
  const [row] = await tx
    .insert(factoryOverrideScanRuns)
    .values({
      orgId: args.orgId,
      artifactId: args.artifactId,
      contentHash: args.contentHash,
      scannerVersion,
      status: "queued",
      detail: { reason: args.reason },
    })
    .returning({ id: factoryOverrideScanRuns.id });
  return { scanRunId: row.id, outcome: "recorded" };
}

/**
 * Post-commit publish. Failures are logged and swallowed: the row stays
 * `queued` and the staleness sweeper re-drives it (FR-001). The write path
 * never waits on — and can never be failed by — scanner dispatch.
 */
export async function publishOverrideScanRun(scanRunId: string): Promise<void> {
  try {
    await OverrideScanRequestTopic.publish({ scanRunId });
  } catch (err) {
    log.warn("overrideScan: publish failed; sweeper will re-drive", {
      scanRunId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// FR-003 / FR-006 — shared enforcement sweep (deterministic rule layer)
// ---------------------------------------------------------------------------

export type ContentHashRevocationHit = {
  revocationId: string;
  key: string;
  mode: "revoked" | "quarantined";
};

/**
 * Sweep a set of content hashes against unlifted `content-hash`
 * revocations (org-scoped or global advisory). Returns the first hit or
 * null. Consumed by bundle assembly (`admission.ts`), grant issue/renew
 * (`grantDuplexHandlers.ts`), the approval-summary parity replica, the
 * user-authored agent serve paths, and the verify-override pre-flight.
 */
export async function sweepContentHashRevocations(
  orgId: string,
  contentHashes: string[],
): Promise<ContentHashRevocationHit | null> {
  if (contentHashes.length === 0) return null;
  const [hit] = await db
    .select({
      id: factoryRevocations.id,
      key: factoryRevocations.key,
      mode: factoryRevocations.mode,
    })
    .from(factoryRevocations)
    .where(
      and(
        eq(factoryRevocations.scopeKind, "content-hash"),
        inArray(factoryRevocations.key, contentHashes),
        isNull(factoryRevocations.liftedAt),
        or(
          eq(factoryRevocations.orgId, sql`${orgId}::uuid`),
          isNull(factoryRevocations.orgId),
        ),
      ),
    )
    .limit(1);
  return hit ? { revocationId: hit.id, key: hit.key, mode: hit.mode } : null;
}

// ---------------------------------------------------------------------------
// Worker logic — model invocation is dependency-injected (AC-1/AC-3)
// ---------------------------------------------------------------------------

export type OverrideScanModelInvoker = (args: {
  /** The override body under inspection — untrusted input (FR-007). */
  body: string;
  policy: OverrideScanPolicy;
  prompt: AssembledScanPrompt;
}) => Promise<{
  verdict: "clean" | "flagged";
  /** Untrusted model output — stored as evidence only. */
  rationale: string;
  costUsd: number;
  modelId: string;
}>;

type ScanRunRow = typeof factoryOverrideScanRuns.$inferSelect;

async function completeRun(
  runId: string,
  set: Partial<typeof factoryOverrideScanRuns.$inferInsert>,
): Promise<void> {
  const now = new Date();
  await db
    .update(factoryOverrideScanRuns)
    .set({ ...set, completedAt: now, lastEventAt: now })
    .where(eq(factoryOverrideScanRuns.id, runId));
}

async function auditScanOutcome(
  run: Pick<ScanRunRow, "id" | "orgId" | "artifactId" | "contentHash" | "scannerVersion">,
  action:
    | "artifact.scan_flagged"
    | "artifact.scan_clean"
    | "artifact.scan_skipped"
    | "artifact.scan_failed",
  after: Record<string, unknown>,
): Promise<void> {
  await db.insert(factoryArtifactSubstrateAudit).values({
    artifactId: run.artifactId,
    orgId: run.orgId,
    action,
    // Service provenance — the scanner has no user identity (FR-002).
    actorUserId: null,
    before: null,
    after: {
      scanRunId: run.id,
      contentHash: run.contentHash,
      scannerVersion: run.scannerVersion,
      ...after,
    },
  });
}

async function markSkipped(
  run: ScanRunRow,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await completeRun(run.id, {
    status: "skipped",
    detail: { code, message, ...extra },
  });
  await auditScanOutcome(run, "artifact.scan_skipped", {
    code,
    message,
    ...extra,
  });
}

async function markFailed(
  run: ScanRunRow,
  code: string,
  message: string,
): Promise<void> {
  await completeRun(run.id, {
    status: "failed",
    detail: { code, message },
  });
  await auditScanOutcome(run, "artifact.scan_failed", { code, message });
}

/** FR-005 day-aggregate — committed costs only (soft ceiling). */
export async function getOrgScanDayAggregateUsd(
  orgId: string,
  now: Date = new Date(),
): Promise<number> {
  const utcMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const result = await db
    .select({
      total: sql<string>`COALESCE(SUM(${factoryOverrideScanRuns.costUsd}), 0)::text`,
    })
    .from(factoryOverrideScanRuns)
    .where(
      and(
        eq(factoryOverrideScanRuns.orgId, orgId),
        gte(factoryOverrideScanRuns.completedAt, utcMidnight),
      ),
    );
  const n = Number.parseFloat(result[0]?.total ?? "0");
  return Number.isFinite(n) ? n : 0;
}

/**
 * Drive one scan run end-to-end. Idempotent under at-least-once delivery:
 * the CAS claim on `queued → running` makes redelivery of a terminal or
 * in-flight run a no-op. Model failures requeue for redelivery until the
 * auto-retry cap, then land `failed` with the error recorded (FR-007).
 */
export async function runOverrideScanWork(args: {
  scanRunId: string;
  invokeModel: OverrideScanModelInvoker;
}): Promise<void> {
  const claimed = await db
    .update(factoryOverrideScanRuns)
    .set({
      status: "running",
      runningAt: new Date(),
      lastEventAt: new Date(),
      attempts: sql`${factoryOverrideScanRuns.attempts} + 1`,
    })
    .where(
      and(
        eq(factoryOverrideScanRuns.id, args.scanRunId),
        eq(factoryOverrideScanRuns.status, "queued"),
      ),
    )
    .returning();
  if (claimed.length === 0) {
    log.info("runOverrideScanWork: redelivery, nothing to claim", {
      scanRunId: args.scanRunId,
    });
    return;
  }
  const run = claimed[0];

  if (run.attempts > getMaxAutoRetries() + 1) {
    await markFailed(
      run,
      "auto_retry_exhausted",
      `auto-retry cap of ${getMaxAutoRetries()} exhausted`,
    );
    return;
  }

  // Load the artifact. A vanished artifact or a superseded revision makes
  // this run moot — the newer revision enqueued its own scan.
  const [artifact] = await db
    .select({
      id: factoryArtifactSubstrate.id,
      userBody: factoryArtifactSubstrate.userBody,
      contentHash: factoryArtifactSubstrate.contentHash,
    })
    .from(factoryArtifactSubstrate)
    .where(
      and(
        eq(factoryArtifactSubstrate.orgId, run.orgId),
        eq(factoryArtifactSubstrate.id, run.artifactId),
      ),
    )
    .limit(1);
  if (!artifact) {
    // No audit row — the audit table names an artifact that no longer
    // exists; the run row itself is the record.
    await completeRun(run.id, {
      status: "skipped",
      detail: { code: "artifact_missing", message: "artifact row vanished" },
    });
    return;
  }
  if (artifact.userBody === null || artifact.contentHash !== run.contentHash) {
    await markSkipped(
      run,
      "revision_superseded",
      "the revision this run was enqueued for is no longer current",
    );
    return;
  }

  // FR-005 — org policy gate. Disabled or over-ceiling → visible, audited
  // skip; no model call.
  const policy = await resolveOverrideScanPolicy(run.orgId);
  if (!policy.scanAllowed) {
    await markSkipped(run, "scan_disabled", "org policy disables scanning", {
      policySource: policy.source,
    });
    return;
  }
  const prompt = getOverrideScanPrompt(OVERRIDE_SCAN_PROMPT_KIND);
  const estimate = estimateCallCostUsd({
    inputTokensEstimated: Math.ceil(
      (prompt.system.length + artifact.userBody.length) / 4,
    ),
    outputTokensEstimated: 300,
  });
  if (estimate > policy.costCeilingUsdPerCall) {
    await markSkipped(
      run,
      "per_call_ceiling",
      `pre-flight estimate $${estimate.toFixed(4)} exceeds per-call ceiling $${policy.costCeilingUsdPerCall.toFixed(4)}`,
    );
    return;
  }
  const dayTotal = await getOrgScanDayAggregateUsd(run.orgId);
  if (dayTotal + estimate > policy.costCeilingUsdPerDay) {
    await markSkipped(
      run,
      "daily_ceiling",
      `day-aggregate $${dayTotal.toFixed(4)} + estimate $${estimate.toFixed(4)} exceeds day ceiling $${policy.costCeilingUsdPerDay.toFixed(4)}`,
    );
    return;
  }

  // FR-007 — the injected model invocation. Failures requeue for
  // at-least-once redelivery; the attempts cap above stops the loop.
  let outcome: Awaited<ReturnType<OverrideScanModelInvoker>>;
  try {
    outcome = await args.invokeModel({
      body: artifact.userBody,
      policy,
      prompt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (run.attempts > getMaxAutoRetries()) {
      await markFailed(run, "scanner_error", message);
      return;
    }
    await db
      .update(factoryOverrideScanRuns)
      .set({ status: "queued", lastEventAt: new Date() })
      .where(eq(factoryOverrideScanRuns.id, run.id));
    log.warn("runOverrideScanWork: model invocation failed; requeued", {
      scanRunId: run.id,
      attempts: run.attempts,
      err: message,
    });
    throw err;
  }

  const rationale = outcome.rationale.slice(0, RATIONALE_EVIDENCE_MAX_CHARS);

  if (outcome.verdict === "clean") {
    await completeRun(run.id, {
      status: "completed",
      verdict: "clean",
      rationale,
      costUsd: outcome.costUsd.toFixed(6),
      detail: { modelId: outcome.modelId, promptFingerprint: prompt.fingerprint },
    });
    await auditScanOutcome(run, "artifact.scan_clean", {
      modelId: outcome.modelId,
      promptFingerprint: prompt.fingerprint,
    });
    return;
  }

  // FR-002 — flagged: quarantine via the spec 198 FR-010 machinery. The
  // key comes from the RUN ROW, never from model output (AC-7): a poisoned
  // rationale cannot aim the quarantine at a different artifact. The
  // rationale rides along as recorded evidence only.
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: factoryRevocations.id })
      .from(factoryRevocations)
      .where(
        and(
          eq(factoryRevocations.scopeKind, "content-hash"),
          eq(factoryRevocations.key, run.contentHash),
          eq(factoryRevocations.mode, "quarantined"),
          eq(factoryRevocations.orgId, sql`${run.orgId}::uuid`),
          isNull(factoryRevocations.liftedAt),
        ),
      )
      .limit(1);
    if (!existing[0]) {
      await tx.insert(factoryRevocations).values({
        orgId: run.orgId,
        scopeKind: "content-hash",
        key: run.contentHash,
        mode: "quarantined",
        // Service provenance (FR-002): NULL actor; the reason carries
        // scanner id + version, run id, and the rationale as evidence.
        actor: null,
        reason: `override-scan ${run.scannerVersion} (run ${run.id}, ${outcome.modelId}): ${rationale}`,
      });
    }
    await tx.insert(factoryArtifactSubstrateAudit).values({
      artifactId: run.artifactId,
      orgId: run.orgId,
      action: "artifact.scan_flagged",
      actorUserId: null,
      before: null,
      after: {
        scanRunId: run.id,
        contentHash: run.contentHash,
        scannerVersion: run.scannerVersion,
        modelId: outcome.modelId,
        promptFingerprint: prompt.fingerprint,
      },
    });
  });
  await completeRun(run.id, {
    status: "completed",
    verdict: "flagged",
    rationale,
    costUsd: outcome.costUsd.toFixed(6),
    detail: { modelId: outcome.modelId, promptFingerprint: prompt.fingerprint },
  });
  log.warn("overrideScan: revision quarantined pending human review", {
    scanRunId: run.id,
    artifactId: run.artifactId,
    contentHash: run.contentHash,
  });
}

// ---------------------------------------------------------------------------
// FR-001 — staleness sweeper (lost publishes + crashed workers)
// ---------------------------------------------------------------------------

export async function sweepOverrideScanRuns(
  now: Date = new Date(),
): Promise<{ redriven: number; failed: number }> {
  const cutoff = new Date(now.getTime() - getStaleAfterSec() * 1000);

  // Re-drive queued rows whose publish was lost. Bump last_event_at first
  // so a persistently-failing publish cannot hot-loop every sweep.
  const queued = await db
    .update(factoryOverrideScanRuns)
    .set({ lastEventAt: now })
    .where(
      and(
        eq(factoryOverrideScanRuns.status, "queued"),
        sql`${factoryOverrideScanRuns.lastEventAt} < ${cutoff}`,
      ),
    )
    .returning({ id: factoryOverrideScanRuns.id });
  for (const row of queued) {
    await publishOverrideScanRun(row.id);
  }

  // Fail stale running rows (crashed worker / lost process).
  const stale = await db
    .select()
    .from(factoryOverrideScanRuns)
    .where(
      and(
        eq(factoryOverrideScanRuns.status, "running"),
        sql`${factoryOverrideScanRuns.lastEventAt} < ${cutoff}`,
      ),
    );
  for (const run of stale) {
    await markFailed(
      run,
      "worker_crashed",
      `run was running > ${getStaleAfterSec()}s without completion`,
    );
  }

  if (queued.length > 0 || stale.length > 0) {
    log.warn("sweepOverrideScanRuns: recovered runs", {
      redriven: queued.length,
      failed: stale.length,
    });
  }
  return { redriven: queued.length, failed: stale.length };
}
