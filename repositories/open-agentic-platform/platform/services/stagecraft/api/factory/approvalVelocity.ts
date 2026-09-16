// Spec 202 FR-004: approval-velocity (governance-drift) counter, DB half.
//
// Counts an actor's recent `factory.run.gate_approved` rows (the spec 201
// run-gate ratification audit trail) and classifies the rate as anomalous via
// the pure `computeApprovalVelocity`. Two entry points, both records-only and
// both fail-open (FR-004 never blocks an approval):
//
//   measureApprovalVelocity(ctx)  read-only; surfaced on the GET run-approval
//                                 context response. No writes (preserves spec
//                                 201 FR-003 GET-purity). Returns null on any
//                                 DB error so the context endpoint still
//                                 renders.
//   detectApprovalVelocity(ctx)   called from the POST approve path AFTER the
//                                 approval is recorded; writes a
//                                 `factory.run.approval_velocity_anomaly` audit
//                                 row when the break trips. Never throws.
//
// Org scoping: `audit_log` carries no `org_id` column, so the actor's
// approvals are scoped to the caller's org by joining the ratification rows
// (`targetType = "factory_runs"`, `targetId = <run uuid>`) to `factory_runs`
// on the org. `targetId` is text and `factory_runs.id` is uuid; the join casts
// the uuid to text (never the reverse) so a malformed `targetId` simply fails
// to match rather than throwing. Because `gate_approved` is only ever written
// with `targetType = "factory_runs"` (`approvalSummary.ts::approveRunGateCore`),
// `targetId` is always a run uuid here.

import log from "encore.dev/log";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import { auditLog, factoryRuns } from "../db/schema";
import {
  FACTORY_RUN_GATE_APPROVED,
  FACTORY_RUN_APPROVAL_VELOCITY_ANOMALY,
} from "./auditActions";
import { errorForLog } from "../auth/errorLog";
import {
  approvalVelocityThreshold,
  approvalVelocityWindowSecs,
  computeApprovalVelocity,
  type ApprovalVelocity,
} from "./approvalVelocity-pure";

export interface ApprovalVelocityContext {
  orgId: string;
  /** Rauthy subject performing the approval (the `audit_log.actor_user_id`
   *  the ratification rows are keyed on). */
  actorId: string;
  /** The run whose approve path fired this measurement; the anomaly audit row
   *  anchors to it for correlation with its `gate_approved` sibling. */
  runId: string;
}

/** Org-scoped `gate_approved` timestamps for `actorId` at or after `cutoff`,
 *  as ISO strings for the pure classifier. */
async function loadActorApprovalTimestamps(
  orgId: string,
  actorId: string,
  cutoff: Date,
): Promise<string[]> {
  const rows = await db
    .select({ createdAt: auditLog.createdAt })
    .from(auditLog)
    .innerJoin(
      factoryRuns,
      sql`${factoryRuns.id}::text = ${auditLog.targetId}`,
    )
    .where(
      and(
        eq(auditLog.action, FACTORY_RUN_GATE_APPROVED),
        // Defense-in-depth: `gate_approved` is only ever written with
        // targetType `factory_runs` (approvalSummary.ts::approveRunGateCore),
        // so the join to factory_runs is already correct; filtering targetType
        // explicitly keeps the count sound if that action string is ever
        // reused with a different target shape.
        eq(auditLog.targetType, "factory_runs"),
        eq(auditLog.actorUserId, actorId),
        eq(factoryRuns.orgId, orgId),
        gte(auditLog.createdAt, cutoff),
      ),
    );
  return rows.map((r) => r.createdAt.toISOString());
}

/**
 * Read-only FR-004 measurement for the run-approval context surface. Counts
 * the actor's org-scoped gate approvals in the rolling window and classifies
 * the rate. Never writes. Fail-open: returns null on any DB error, logged, so
 * the context endpoint still renders its approval basis.
 */
export async function measureApprovalVelocity(
  ctx: ApprovalVelocityContext,
): Promise<ApprovalVelocity | null> {
  try {
    const windowSecs = approvalVelocityWindowSecs();
    const threshold = approvalVelocityThreshold();
    const now = new Date();
    const cutoff = new Date(now.getTime() - windowSecs * 1000);
    const timestamps = await loadActorApprovalTimestamps(
      ctx.orgId,
      ctx.actorId,
      cutoff,
    );
    return computeApprovalVelocity(
      timestamps,
      now.toISOString(),
      windowSecs,
      threshold,
    );
  } catch (err) {
    log.error("measureApprovalVelocity: measurement failed; omitting", {
      orgId: ctx.orgId,
      actorId: ctx.actorId,
      error: errorForLog(err),
    });
    return null;
  }
}

/**
 * Approve-path FR-004 detection. Call AFTER the `gate_approved` row is written
 * so the current approval is counted. When the rate is anomalous, records a
 * `factory.run.approval_velocity_anomaly` audit row (the run is the correlation
 * anchor; the actor, count, threshold, and window ride in metadata). Records,
 * never blocks: every step is best-effort and swallowed so a detection failure
 * never fails the approval the caller already committed.
 */
export async function detectApprovalVelocity(
  ctx: ApprovalVelocityContext,
): Promise<void> {
  try {
    const velocity = await measureApprovalVelocity(ctx);
    if (!velocity || !velocity.anomalous) return;

    log.warn("detectApprovalVelocity: actor approval velocity anomalous", {
      orgId: ctx.orgId,
      actorId: ctx.actorId,
      runId: ctx.runId,
      count: velocity.count,
      threshold: velocity.threshold,
      windowSecs: velocity.windowSecs,
    });

    await db.insert(auditLog).values({
      actorUserId: ctx.actorId,
      action: FACTORY_RUN_APPROVAL_VELOCITY_ANOMALY,
      targetType: "factory_runs",
      targetId: ctx.runId,
      metadata: {
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        count: velocity.count,
        threshold: velocity.threshold,
        windowSecs: velocity.windowSecs,
      },
    });
  } catch (err) {
    log.error("detectApprovalVelocity: detection failed; approval stands", {
      orgId: ctx.orgId,
      actorId: ctx.actorId,
      runId: ctx.runId,
      error: errorForLog(err),
    });
  }
}
