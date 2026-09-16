// Spec 201 phase 2 — AC-1 decision-logic coverage for the override-verify
// surface, over the pure `approvalControlState` (the JSX is a thin renderer
// of this state; same testing posture as factory-run-helpers).
//
// Pure — runs under bare vitest.

import { describe, expect, it } from "vitest";
import {
  approvalControlState,
  runGateControlState,
} from "./approval-basis-helpers";
import type {
  ApprovalSummaryWire,
  ArtifactApprovalSummaryResponse,
} from "./factory-api.server";

const SUMMARY: ApprovalSummaryWire = {
  summaryHash: "c".repeat(64),
  gatePredicate: "overrides.require_verified",
  blastRadiusStatement: "Ratifying 'overrides.require_verified' authorises…",
  provenanceLinks: [
    {
      artifactId: "row-env",
      contentHash: "e".repeat(64),
      kind: "governance-envelope",
      path: "process/governance-envelope.yaml",
    },
  ],
  consumedOverrides: [
    {
      artifactId: "row-1",
      contentHash: "a".repeat(64),
      path: "process/agents/architect.md",
      verifiedBy: null,
      verifiedAt: null,
      requireVerifiedSatisfied: false,
    },
    {
      artifactId: "row-2",
      contentHash: "b".repeat(64),
      path: "process/agents/reviewer.md",
      verifiedBy: "admin-1",
      verifiedAt: "2026-06-11T10:00:00.000Z",
      requireVerifiedSatisfied: true,
    },
  ],
  assembledAt: "2026-06-11T12:00:00.000Z",
  actorId: "subject-1",
};

const OK_RESPONSE: ArtifactApprovalSummaryResponse = {
  applicable: true,
  ok: true,
  summary: SUMMARY,
};

describe("spec 201 FR-002 — approvalControlState (AC-1)", () => {
  it("hides everything when there is no override", () => {
    expect(
      approvalControlState(
        { userBody: null, overrideVerified: null },
        OK_RESPONSE,
      ),
    ).toEqual({ kind: "hidden" });
  });

  it("hides everything when the revision is already verified", () => {
    expect(
      approvalControlState(
        { userBody: "x", overrideVerified: true },
        OK_RESPONSE,
      ),
    ).toEqual({ kind: "hidden" });
  });

  it("fails closed when the basis fetch did not produce a response", () => {
    const state = approvalControlState(
      { userBody: "x", overrideVerified: false },
      null,
    );
    expect(state.kind).toBe("blocked");
    if (state.kind !== "blocked") return;
    expect(state.reason).toContain("withheld");
  });

  it("fails closed with the attributable reason when assembly refused", () => {
    const state = approvalControlState(
      { userBody: "x", overrideVerified: false },
      {
        applicable: true,
        ok: false,
        reason: "factory 'f' has no admission evaluation — run /factory-sync",
      },
    );
    expect(state).toEqual({
      kind: "blocked",
      reason: "factory 'f' has no admission evaluation — run /factory-sync",
    });
  });

  it("keeps the legacy verify for the user-authored trust class", () => {
    expect(
      approvalControlState(
        { userBody: "x", overrideVerified: false },
        { applicable: false },
      ),
    ).toEqual({ kind: "legacy-verify" });
  });

  it("fails closed when ok is true but the summary is absent (malformed wire)", () => {
    const state = approvalControlState(
      { userBody: "x", overrideVerified: false },
      { applicable: true, ok: true },
    );
    expect(state.kind).toBe("blocked");
  });

  it("renders the basis + verify, listing envelope-unsatisfied overrides", () => {
    const state = approvalControlState(
      { userBody: "x", overrideVerified: false },
      OK_RESPONSE,
    );
    expect(state.kind).toBe("verify-with-basis");
    if (state.kind !== "verify-with-basis") return;
    expect(state.summary.summaryHash).toBe("c".repeat(64));
    expect(state.unverifiedPaths).toEqual(["process/agents/architect.md"]);
  });
});

describe("spec 201 phase 3 — runGateControlState (AC-1, run surface)", () => {
  const APPROVAL = {
    stageId: "s1",
    gatePredicate: "approval-before-build-spec-freeze",
    summaryHash: "d".repeat(64),
    approvedBy: "subject-2",
    approvedAt: "2026-06-11T13:00:00.000Z",
  };
  const CLEAN_SUMMARY: ApprovalSummaryWire = {
    ...SUMMARY,
    consumedOverrides: SUMMARY.consumedOverrides.map((o) => ({
      ...o,
      requireVerifiedSatisfied: true,
    })),
  };
  const OK_CONTEXT = {
    requiredStageIds: ["s1", "s2", "s3"],
    approvals: [APPROVAL],
    ok: true,
    gatePredicate: "approval-before-build-spec-freeze",
    summary: CLEAN_SUMMARY,
    blockingOverridePaths: [],
  };

  it("renders the recorded approval receipt for an approved stage", () => {
    expect(runGateControlState(OK_CONTEXT, "s1")).toEqual({
      kind: "approved",
      approval: APPROVAL,
    });
  });

  it("fails closed when the context fetch produced nothing", () => {
    const state = runGateControlState(null, "s2");
    expect(state.kind).toBe("blocked");
  });

  it("fails closed with the attributable reason when assembly refused", () => {
    const state = runGateControlState(
      {
        requiredStageIds: ["s1", "s2", "s3"],
        approvals: [],
        ok: false,
        reason: "no factory upstream configured for this org",
      },
      "s2",
    );
    expect(state).toEqual({
      kind: "blocked",
      reason: "no factory upstream configured for this org",
    });
  });

  it("WITHHOLDS approve on envelope-unsatisfied overrides (FR-002)", () => {
    const state = runGateControlState(
      {
        ...OK_CONTEXT,
        blockingOverridePaths: ["process/agents/architect.md"],
      },
      "s2",
    );
    expect(state).toEqual({
      kind: "withheld",
      blockingPaths: ["process/agents/architect.md"],
    });
  });

  it("renders the approvable basis for a clean unapproved stage", () => {
    const state = runGateControlState(OK_CONTEXT, "s2");
    expect(state.kind).toBe("approvable");
    if (state.kind !== "approvable") return;
    expect(state.gatePredicate).toBe("approval-before-build-spec-freeze");
    expect(state.summary.summaryHash).toBe(SUMMARY.summaryHash);
  });

  it("recorded approval wins even when the context is otherwise blocked", () => {
    const state = runGateControlState(
      {
        requiredStageIds: ["s1", "s2", "s3"],
        approvals: [APPROVAL],
        ok: false,
        reason: "basis no longer assemblable",
      },
      "s1",
    );
    expect(state.kind).toBe("approved");
  });
});
