// Spec 201 phase 1 — unit tests over the pure ApprovalSummary assembly
// (AC-2: recorded facts only, deterministic; AC-4: hash stability +
// recomputability; FR-001/FR-002 fail-closed conditions).
//
// Pure — imports only `approvalSummary-pure.ts`; runs under bare vitest
// (no Encore runtime, no DB).

import { describe, expect, it } from "vitest";
import {
  assembleApprovalSummaryFromFacts,
  computeApprovalSummaryHash,
  OVERRIDE_VERIFICATION_PREDICATE,
  type ApprovalSummaryFacts,
} from "./approvalSummary-pure";

const ENVELOPE_HASH = "e".repeat(64);
const MANIFEST_HASH = "m".repeat(64);

function baseFacts(
  overrides: Partial<ApprovalSummaryFacts> = {},
): ApprovalSummaryFacts {
  return {
    gatePredicate: "approval-before-build-spec-freeze",
    actorId: "rauthy-subject-1",
    assembledAt: "2026-06-11T12:00:00.000Z",
    admission: {
      admitted: true,
      reason: null,
      envelopeHash: ENVELOPE_HASH,
      composed: {
        process: {
          schema_version: "1.0.0",
          process: {
            id: "factory-process",
            objective_class: "scaffold",
            goal_identifier_scheme: "build-spec:<project>",
          },
          ceilings: { max_tier: "tier2", max_mutation: "scoped-write" },
          gates: [
            { predicate: "approval-before-build-spec-freeze" },
            { predicate: "plain-language-summaries" },
          ],
          emits: [{ kind: "build-spec" }, { kind: "stage-output" }],
          constituents: { agents: "process/agents/*.md" },
          overrides: { require_verified: true },
        },
        adapters: {
          "acme-vue-encore": {
            governance: {
              max_tier: "tier2",
              file_write_scope: ["src/**", "package.json"],
              allowed_commands_from: "commands",
              scaffold_execution: {
                setup_commands_from: "commands",
                isolation: "sandbox-required",
              },
              agents_from: "agents",
            },
            manifestHash: MANIFEST_HASH,
          },
        },
        agentDigests: {},
      },
    },
    provenanceRows: [
      {
        id: "row-envelope",
        path: "process/governance-envelope.yaml",
        kind: "governance-envelope",
        contentHash: ENVELOPE_HASH,
      },
      {
        id: "row-manifest",
        path: "adapters/acme-vue-encore/manifest.yaml",
        kind: "adapter-manifest",
        contentHash: MANIFEST_HASH,
      },
    ],
    overrideRows: [
      {
        id: "row-override-1",
        path: "process/agents/architect.md",
        contentHash: "a".repeat(64),
        userBodyVerified: false,
        verifiedBy: null,
        verifiedAt: null,
      },
    ],
    ...overrides,
  };
}

describe("spec 201 FR-001 — assembleApprovalSummaryFromFacts", () => {
  it("assembles a summary from recorded facts (AC-2)", () => {
    const result = assembleApprovalSummaryFromFacts(baseFacts());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const s = result.summary;
    expect(s.gatePredicate).toBe("approval-before-build-spec-freeze");
    expect(s.provenanceLinks).toEqual([
      {
        artifactId: "row-envelope",
        contentHash: ENVELOPE_HASH,
        kind: "governance-envelope",
        path: "process/governance-envelope.yaml",
      },
      {
        artifactId: "row-manifest",
        contentHash: MANIFEST_HASH,
        kind: "adapter-manifest",
        path: "adapters/acme-vue-encore/manifest.yaml",
      },
    ]);
    // Plain language grounded in envelope facts — scopes, kinds, counts.
    expect(s.blastRadiusStatement).toContain("src/**");
    expect(s.blastRadiusStatement).toContain("acme-vue-encore");
    expect(s.blastRadiusStatement).toContain("build-spec");
    expect(s.blastRadiusStatement).toContain("1 per-org content override");
    expect(s.assembledAt).toBe("2026-06-11T12:00:00.000Z");
    expect(s.actorId).toBe("rauthy-subject-1");
  });

  it("is deterministic across calls — same facts, same output (AC-2)", () => {
    const a = assembleApprovalSummaryFromFacts(baseFacts());
    const b = assembleApprovalSummaryFromFacts(baseFacts());
    expect(a).toEqual(b);
  });

  it("hash is stable across assembledAt changes (AC-4 / FR-003 b)", () => {
    const a = assembleApprovalSummaryFromFacts(baseFacts());
    const b = assembleApprovalSummaryFromFacts(
      baseFacts({ assembledAt: "2026-06-12T08:30:00.000Z" }),
    );
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.summary.summaryHash).toBe(b.summary.summaryHash);
    expect(a.summary.assembledAt).not.toBe(b.summary.assembledAt);
  });

  it("hash changes when a recorded fact changes (AC-4)", () => {
    const a = assembleApprovalSummaryFromFacts(baseFacts());
    const facts = baseFacts();
    facts.overrideRows[0].contentHash = "b".repeat(64);
    const b = assembleApprovalSummaryFromFacts(facts);
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.summary.summaryHash).not.toBe(b.summary.summaryHash);
  });

  it("hash changes when the actor changes (TOCTOU binding)", () => {
    const a = assembleApprovalSummaryFromFacts(baseFacts());
    const b = assembleApprovalSummaryFromFacts(
      baseFacts({ actorId: "rauthy-subject-2" }),
    );
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.summary.summaryHash).not.toBe(b.summary.summaryHash);
  });

  it("summaryHash is recomputable from the summary's own fields (AC-4)", () => {
    const result = assembleApprovalSummaryFromFacts(baseFacts());
    if (!result.ok) throw new Error("expected ok");
    expect(computeApprovalSummaryHash(result.summary)).toBe(
      result.summary.summaryHash,
    );
  });

  it("marks unverified overrides unsatisfied under require_verified (AC-1)", () => {
    const result = assembleApprovalSummaryFromFacts(baseFacts());
    if (!result.ok) throw new Error("expected ok");
    expect(result.summary.consumedOverrides).toEqual([
      {
        artifactId: "row-override-1",
        contentHash: "a".repeat(64),
        path: "process/agents/architect.md",
        verifiedBy: null,
        verifiedAt: null,
        requireVerifiedSatisfied: false,
      },
    ]);
  });

  it("marks verified overrides satisfied under require_verified", () => {
    const facts = baseFacts();
    facts.overrideRows[0].userBodyVerified = true;
    facts.overrideRows[0].verifiedBy = "admin-1";
    facts.overrideRows[0].verifiedAt = new Date("2026-06-11T11:00:00Z");
    const result = assembleApprovalSummaryFromFacts(facts);
    if (!result.ok) throw new Error("expected ok");
    expect(result.summary.consumedOverrides[0].requireVerifiedSatisfied).toBe(
      true,
    );
    expect(result.summary.consumedOverrides[0].verifiedAt).toBe(
      "2026-06-11T11:00:00.000Z",
    );
  });

  it("treats every override as satisfied when require_verified is false", () => {
    const facts = baseFacts();
    facts.admission.composed!.process!.overrides.require_verified = false;
    const result = assembleApprovalSummaryFromFacts(facts);
    if (!result.ok) throw new Error("expected ok");
    expect(result.summary.consumedOverrides[0].requireVerifiedSatisfied).toBe(
      true,
    );
  });

  it("accepts the reserved override-verification predicate", () => {
    const result = assembleApprovalSummaryFromFacts(
      baseFacts({ gatePredicate: OVERRIDE_VERIFICATION_PREDICATE }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("spec 201 FR-001/FR-002 — fail-closed conditions", () => {
  it("refuses when the factory is not admitted", () => {
    const facts = baseFacts();
    facts.admission.admitted = false;
    facts.admission.reason = "factory 'x' was refused admission: …";
    const result = assembleApprovalSummaryFromFacts(facts);
    expect(result).toEqual({
      ok: false,
      reason: "factory 'x' was refused admission: …",
    });
  });

  it("refuses when the admission carries no composed envelope", () => {
    const facts = baseFacts();
    facts.admission.composed = null;
    const result = assembleApprovalSummaryFromFacts(facts);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("no composed envelope");
  });

  it("refuses an undeclared gate predicate", () => {
    const result = assembleApprovalSummaryFromFacts(
      baseFacts({ gatePredicate: "made-up-by-a-model" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("'made-up-by-a-model' is not declared");
    expect(result.reason).toContain("approval-before-build-spec-freeze");
  });

  it("refuses when the admitted envelope hash left the substrate", () => {
    const facts = baseFacts();
    facts.provenanceRows = facts.provenanceRows.filter(
      (r) => r.kind !== "governance-envelope",
    );
    const result = assembleApprovalSummaryFromFacts(facts);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("envelope hash is no longer present");
  });

  it("refuses when an admitted adapter manifest hash moved", () => {
    const facts = baseFacts();
    facts.provenanceRows[1].contentHash = "f".repeat(64);
    const result = assembleApprovalSummaryFromFacts(facts);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("'acme-vue-encore' manifest hash");
  });

  it("does NOT refuse on unverified overrides — that is the surface's", () => {
    // FR-002's withhold-on-unverified is a rendering decision; assembly
    // surfaces the flag so the surface (and the run-approve endpoint)
    // can act on it. Verify-override needs the summary to exist.
    const result = assembleApprovalSummaryFromFacts(baseFacts());
    expect(result.ok).toBe(true);
  });
});
