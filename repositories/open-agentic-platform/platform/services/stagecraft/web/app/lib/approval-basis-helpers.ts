/**
 * Spec 201 FR-002 — fail-closed approve-control decision logic for the
 * override-verify surface, as a pure function so the contract is unit
 * tested without DOM infrastructure (same posture as
 * `factory-run-helpers.ts`). The JSX in `app.factory.artifacts.tsx` stays
 * a thin renderer over the returned state.
 */

import type {
  ApprovalSummaryWire,
  ArtifactApprovalSummaryResponse,
  RunApprovalContextWire,
  RunGateApprovalWire,
} from "./factory-api.server";

export type ApprovalControlState =
  /** No override, or the current revision is already verified — no
   * verify control, no basis panel. */
  | { kind: "hidden" }
  /** Spec 111 user-authored trust class — verify keeps its legacy
   * presentation; no envelope-grounded basis exists (FR-004 scoping). */
  | { kind: "legacy-verify" }
  /** Basis unavailable — render the attributable reason and NO verify
   * control (FR-002 fail-closed). */
  | { kind: "blocked"; reason: string }
  /** Basis assembled — render the fact sections, then the verify control
   * in a distinct subtree (FR-005). `unverifiedPaths` lists overrides in
   * scope that an envelope predicate leaves unsatisfied — informative on
   * this surface (verify IS the resolution path), blocking on approve
   * surfaces (phase 3). */
  | {
      kind: "verify-with-basis";
      summary: ApprovalSummaryWire;
      unverifiedPaths: string[];
    };

export function approvalControlState(
  detail: { userBody: string | null; overrideVerified: boolean | null },
  approval: ArtifactApprovalSummaryResponse | null,
): ApprovalControlState {
  if (detail.userBody === null || detail.overrideVerified === true) {
    return { kind: "hidden" };
  }
  if (approval === null) {
    // The loader fetches the basis whenever the verify control would
    // render; a missing response is a failed fetch — fail closed.
    return {
      kind: "blocked",
      reason:
        "approval basis could not be loaded — the verify control is " +
        "withheld until the summary endpoint responds (spec 201 FR-002)",
    };
  }
  if (!approval.applicable) {
    return { kind: "legacy-verify" };
  }
  if (approval.ok !== true || !approval.summary) {
    return {
      kind: "blocked",
      reason:
        approval.reason ??
        "approval basis refused without a stated reason (spec 201 FR-002)",
    };
  }
  return {
    kind: "verify-with-basis",
    summary: approval.summary,
    unverifiedPaths: approval.summary.consumedOverrides
      .filter((o) => !o.requireVerifiedSatisfied)
      .map((o) => o.path),
  };
}

// ---------------------------------------------------------------------------
// Run-level HITL gate (spec 201 phase 3) — per-stage control state.
// ---------------------------------------------------------------------------

export type RunGateControlState =
  /** This stage's approval is already recorded — render the receipt. */
  | { kind: "approved"; approval: RunGateApprovalWire }
  /** No basis — attributable error, no approve control (FR-002). */
  | { kind: "blocked"; reason: string }
  /** Basis exists but the envelope's require_verified policy is
   * unsatisfied — approve is WITHHELD, blocking paths listed (FR-002;
   * unlike the verify surface, this surface blocks). */
  | { kind: "withheld"; blockingPaths: string[] }
  /** Basis assembled and clean — render fact sections + approve control
   * carrying the summaryHash for the FR-003 (b) replay guard. */
  | {
      kind: "approvable";
      gatePredicate: string;
      summary: ApprovalSummaryWire;
    };

export function runGateControlState(
  context: RunApprovalContextWire | null,
  stageId: string,
): RunGateControlState {
  const recorded = context?.approvals.find((a) => a.stageId === stageId);
  if (recorded) return { kind: "approved", approval: recorded };
  if (context === null) {
    return {
      kind: "blocked",
      reason:
        "approval context could not be loaded — the approve control is " +
        "withheld until the context endpoint responds (spec 201 FR-002)",
    };
  }
  if (!context.ok || !context.summary || !context.gatePredicate) {
    return {
      kind: "blocked",
      reason:
        context.reason ??
        "approval basis refused without a stated reason (spec 201 FR-002)",
    };
  }
  if ((context.blockingOverridePaths ?? []).length > 0) {
    return { kind: "withheld", blockingPaths: context.blockingOverridePaths! };
  }
  return {
    kind: "approvable",
    gatePredicate: context.gatePredicate,
    summary: context.summary,
  };
}
