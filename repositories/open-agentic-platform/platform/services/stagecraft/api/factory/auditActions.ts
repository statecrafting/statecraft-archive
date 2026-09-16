// Spec 124 §4 / §6.1 — audit action constants for the factory_runs lifecycle.
//
// `audit_log.action` is a free-text column (api/db/schema.ts). Following the
// spec 115 `auditActions.ts` pattern: centralise the literals so renames stay
// grep-able and dashboards keying on these strings can't drift from the
// writers.
//
// Actor convention:
//   - `factory.run.reserved` / `.completed` / `.failed` / `.cancelled` carry
//     the user that triggered the run (or initiated the cancel) as actor.
//   - `factory.run.swept` carries the system user (spec 119 seed migration
//     `2_seed_system_user`) — the sweeper is a server-side cron, not a user
//     action.

export const FACTORY_RUN_RESERVED = "factory.run.reserved" as const;
export const FACTORY_RUN_COMPLETED = "factory.run.completed" as const;
export const FACTORY_RUN_FAILED = "factory.run.failed" as const;
export const FACTORY_RUN_CANCELLED = "factory.run.cancelled" as const;
export const FACTORY_RUN_SWEPT = "factory.run.swept" as const;
// Spec 198 FR-005/FR-014 — run-grant + countersign lifecycle. Grant
// refusals are governance evidence (goal-shift / revocation propagation,
// ASI01 m4/m7), recorded with the refusal reason in metadata.
export const FACTORY_RUN_GRANT_ISSUED = "factory.run.grant_issued" as const;
export const FACTORY_RUN_GRANT_REFUSED = "factory.run.grant_refused" as const;
export const FACTORY_RUN_COUNTERSIGNED = "factory.run.countersigned" as const;
// Spec 201 FR-004 — run-level HITL gate ratification. The metadata carries
// the `summaryHash` of the ApprovalSummary the approver saw, so the
// certificate chain can prove the basis, not just the click.
export const FACTORY_RUN_GATE_APPROVED = "factory.run.gate_approved" as const;
// Spec 207 AC-4: audit segment countersign. Recorded once per upsert so
// reconnect re-submissions are visible in the audit trail.
export const FACTORY_AUDIT_SEGMENT_COUNTERSIGNED =
  "factory.audit_segment.countersigned" as const;
// Spec 208 FR-001/FR-003/FR-004: org-wide agent kill-switch lifecycle. The
// reason is audit evidence, not a toggle (FR-001), so `activated` carries the
// scope + reason; `lifted` records the human actor that initiated
// reintegration; `engine_ack` records a per-engine acknowledgment timestamp
// (FR-003, written in Phase 2). Phase 3: `reintegrated` records the staged
// `reintegrating -> lifted` completion once every engine that halt-acked has
// also lift-acked (FR-004); `reasserted` records a re-halt pulled on a scope
// still mid-reintegration (the ack ledger is reset so completion recounts).
export const FACTORY_ORG_HALT_ACTIVATED =
  "factory.org_halt.activated" as const;
export const FACTORY_ORG_HALT_LIFTED = "factory.org_halt.lifted" as const;
export const FACTORY_ORG_HALT_ENGINE_ACK =
  "factory.org_halt.engine_ack" as const;
export const FACTORY_ORG_HALT_REINTEGRATED =
  "factory.org_halt.reintegrated" as const;
export const FACTORY_ORG_HALT_REASSERTED =
  "factory.org_halt.reasserted" as const;
// Spec 208 Phase 3.1 (T024, FR-004 follow-up): a duplex org.halt.ack that was
// dropped rather than recorded. Emitted on every benign drop path in
// `orgHaltAckDispatch` (a duplicate replay, a halt-ack arriving after the scope
// left `halted`, or a lift-ack arriving while not `reintegrating`), with the
// drop `reason` in metadata. These paths previously only `log.info`d, so a
// dropped ack was invisible to the audit chain the rest of the switch preserves;
// this closes that forensic gap on a safety-critical containment path.
export const FACTORY_ORG_HALT_ACK_DROPPED =
  "factory.org_halt.ack_dropped" as const;
// Spec 202 FR-003(c): queue-storm detection (detection-only; the run is
// still admitted). Recorded when an org's in-flight run count is at or over
// the configured ceiling at reservation time (`api/factory/queueStormGate.ts`).
export const FACTORY_RUN_STORM_DETECTED =
  "factory.run.storm_detected" as const;
// Spec 202 FR-004: approval-velocity anomaly (detection-only; the approval is
// still recorded). Written at the approve path when an actor's gate approvals
// within the configured window reach the anomaly threshold
// (`api/factory/approvalVelocity.ts`). The metadata carries the actor, the
// observed count, the threshold, and the window so the audit trail shows the
// governance-drift signal, not just the approval it rode in on.
export const FACTORY_RUN_APPROVAL_VELOCITY_ANOMALY =
  "factory.run.approval_velocity_anomaly" as const;

export type FactoryRunAuditAction =
  | typeof FACTORY_RUN_RESERVED
  | typeof FACTORY_RUN_COMPLETED
  | typeof FACTORY_RUN_FAILED
  | typeof FACTORY_RUN_CANCELLED
  | typeof FACTORY_RUN_SWEPT
  | typeof FACTORY_RUN_GRANT_ISSUED
  | typeof FACTORY_RUN_GRANT_REFUSED
  | typeof FACTORY_RUN_COUNTERSIGNED
  | typeof FACTORY_RUN_GATE_APPROVED
  | typeof FACTORY_AUDIT_SEGMENT_COUNTERSIGNED
  | typeof FACTORY_ORG_HALT_ACTIVATED
  | typeof FACTORY_ORG_HALT_LIFTED
  | typeof FACTORY_ORG_HALT_ENGINE_ACK
  | typeof FACTORY_ORG_HALT_REINTEGRATED
  | typeof FACTORY_ORG_HALT_REASSERTED
  | typeof FACTORY_ORG_HALT_ACK_DROPPED
  | typeof FACTORY_RUN_STORM_DETECTED
  | typeof FACTORY_RUN_APPROVAL_VELOCITY_ANOMALY;
