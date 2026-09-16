// Spec 139 Phase 1 — T011 substrate state-machine property test.
//
// Validates the spec §5 + §6 invariants on `applyOp(row, op)`:
//
//   I-S1: effective_body == coalesce(user_body, upstream_body)
//   I-S2: conflict_state ∈ {null, 'ok', 'diverged'}
//   I-S3: a sync that fast-forwards an unchanged row preserves user_body
//   I-S4: a sync that changes upstream_body while user_body is set →
//         conflict_state='diverged' and user_body is preserved.
//   I-S5: status ∈ {'active', 'retired'}; retired rows preserve user_body.
//   I-S6: `version` is monotone non-decreasing.
//
// Pure functional — no DB. Runs under `npm test`.

import { describe, expect, test } from "vitest";
import {
  SUBSTRATE_VERSION,
  applyOp,
  initialRow,
  type SubstrateRow,
  type Op,
  type ArtifactConflictState,
} from "./substrate";

const ALLOWED_CONFLICT_STATES = new Set<ArtifactConflictState>([
  null,
  "ok",
  "diverged",
]);

function assertInvariants(row: SubstrateRow): void {
  // I-S1
  expect(row.effectiveBody).toBe(row.userBody ?? row.upstreamBody ?? "");
  // I-S2
  expect(ALLOWED_CONFLICT_STATES.has(row.conflictState)).toBe(true);
  // I-S5
  expect(["active", "retired"]).toContain(row.status);
}

describe("spec 139 Phase 1 — substrate state machine (T011)", () => {
  test("SUBSTRATE_VERSION is a positive integer", () => {
    expect(typeof SUBSTRATE_VERSION).toBe("number");
    expect(Number.isInteger(SUBSTRATE_VERSION)).toBe(true);
    expect(SUBSTRATE_VERSION).toBeGreaterThan(0);
  });

  test("initial row from sync has conflict_state='ok' and version=1", () => {
    const row = initialRow({
      orgId: "00000000-0000-0000-0000-000000000001",
      origin: "legacy-factory",
      path: "Factory Agent/factory-orchestration.md",
      kind: "pipeline-orchestrator",
      upstreamSha: "a".repeat(40),
      upstreamBody: "v1 body",
      frontmatter: null,
    });
    expect(row.version).toBe(1);
    expect(row.conflictState).toBe("ok");
    expect(row.userBody).toBeNull();
    expect(row.effectiveBody).toBe("v1 body");
    expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/);
    assertInvariants(row);
  });

  test("sync no-change is a no-op (I-S3)", () => {
    let row = initialRow({
      orgId: "00000000-0000-0000-0000-000000000001",
      origin: "legacy-factory",
      path: "p",
      kind: "skill",
      upstreamSha: "a".repeat(40),
      upstreamBody: "body",
      frontmatter: null,
    });
    row = applyOp(row, {
      kind: "sync",
      upstreamSha: "a".repeat(40),
      upstreamBody: "body",
    });
    expect(row.version).toBe(1);
    expect(row.conflictState).toBe("ok");
    assertInvariants(row);
  });

  test("sync that changes body without user override fast-forwards version", () => {
    let row = initialRow({
      orgId: "00000000-0000-0000-0000-000000000001",
      origin: "legacy-factory",
      path: "p",
      kind: "skill",
      upstreamSha: "a".repeat(40),
      upstreamBody: "v1",
      frontmatter: null,
    });
    row = applyOp(row, {
      kind: "sync",
      upstreamSha: "b".repeat(40),
      upstreamBody: "v2",
    });
    expect(row.version).toBe(2);
    expect(row.upstreamBody).toBe("v2");
    expect(row.upstreamSha).toBe("b".repeat(40));
    expect(row.userBody).toBeNull();
    expect(row.effectiveBody).toBe("v2");
    expect(row.conflictState).toBe("ok");
    assertInvariants(row);
  });

  test("override + sync-unchanged preserves user_body", () => {
    let row = initialRow({
      orgId: "00000000-0000-0000-0000-000000000001",
      origin: "legacy-factory",
      path: "p",
      kind: "skill",
      upstreamSha: "a".repeat(40),
      upstreamBody: "v1",
      frontmatter: null,
    });
    row = applyOp(row, {
      kind: "override",
      userBody: "custom",
      userId: "11111111-1111-1111-1111-111111111111",
    });
    expect(row.userBody).toBe("custom");
    expect(row.effectiveBody).toBe("custom");

    row = applyOp(row, {
      kind: "sync",
      upstreamSha: "a".repeat(40),
      upstreamBody: "v1",
    });
    expect(row.userBody).toBe("custom");
    expect(row.upstreamBody).toBe("v1");
    expect(row.conflictState).toBe("ok");
    assertInvariants(row);
  });

  test("override + sync-changed sets diverged and preserves user_body (I-S4)", () => {
    let row = initialRow({
      orgId: "00000000-0000-0000-0000-000000000001",
      origin: "legacy-factory",
      path: "p",
      kind: "skill",
      upstreamSha: "a".repeat(40),
      upstreamBody: "v1",
      frontmatter: null,
    });
    row = applyOp(row, {
      kind: "override",
      userBody: "custom",
      userId: "11111111-1111-1111-1111-111111111111",
    });
    row = applyOp(row, {
      kind: "sync",
      upstreamSha: "b".repeat(40),
      upstreamBody: "v2",
    });
    expect(row.conflictState).toBe("diverged");
    expect(row.userBody).toBe("custom");
    expect(row.upstreamBody).toBe("v2");
    expect(row.upstreamSha).toBe("b".repeat(40));
    expect(row.effectiveBody).toBe("custom");
    assertInvariants(row);
  });

  test("conflict_resolved keep_mine clears diverged + retains user_body", () => {
    let row = initialRow({
      orgId: "o",
      origin: "x",
      path: "p",
      kind: "skill",
      upstreamSha: "a".repeat(40),
      upstreamBody: "v1",
      frontmatter: null,
    });
    row = applyOp(row, {
      kind: "override",
      userBody: "custom",
      userId: "u",
    });
    row = applyOp(row, {
      kind: "sync",
      upstreamSha: "b".repeat(40),
      upstreamBody: "v2",
    });
    expect(row.conflictState).toBe("diverged");

    row = applyOp(row, {
      kind: "resolve",
      action: "keep_mine",
      userId: "u",
    });
    expect(row.conflictState).toBe("ok");
    expect(row.userBody).toBe("custom");
    expect(row.effectiveBody).toBe("custom");
    assertInvariants(row);
  });

  test("conflict_resolved take_upstream drops user_body", () => {
    let row = initialRow({
      orgId: "o",
      origin: "x",
      path: "p",
      kind: "skill",
      upstreamSha: "a".repeat(40),
      upstreamBody: "v1",
      frontmatter: null,
    });
    row = applyOp(row, {
      kind: "override",
      userBody: "custom",
      userId: "u",
    });
    row = applyOp(row, {
      kind: "sync",
      upstreamSha: "b".repeat(40),
      upstreamBody: "v2",
    });
    row = applyOp(row, {
      kind: "resolve",
      action: "take_upstream",
      userId: "u",
    });
    expect(row.conflictState).toBe("ok");
    expect(row.userBody).toBeNull();
    expect(row.effectiveBody).toBe("v2");
    assertInvariants(row);
  });

  test("override_clear without conflict drops user_body", () => {
    let row = initialRow({
      orgId: "o",
      origin: "x",
      path: "p",
      kind: "skill",
      upstreamSha: "a".repeat(40),
      upstreamBody: "v1",
      frontmatter: null,
    });
    row = applyOp(row, {
      kind: "override",
      userBody: "custom",
      userId: "u",
    });
    row = applyOp(row, { kind: "clear_override", userId: "u" });
    expect(row.userBody).toBeNull();
    expect(row.effectiveBody).toBe("v1");
    expect(row.conflictState).toBe("ok");
    assertInvariants(row);
  });

  test("retire preserves user_body and forbids further binding", () => {
    let row = initialRow({
      orgId: "o",
      origin: "x",
      path: "p",
      kind: "skill",
      upstreamSha: "a".repeat(40),
      upstreamBody: "v1",
      frontmatter: null,
    });
    row = applyOp(row, {
      kind: "override",
      userBody: "custom",
      userId: "u",
    });
    row = applyOp(row, { kind: "retire" });
    expect(row.status).toBe("retired");
    expect(row.userBody).toBe("custom");
    expect(row.effectiveBody).toBe("custom");
    assertInvariants(row);
  });

  test("property: invariants hold for any sequence of legal ops", () => {
    // Small-step random walk over the op space. Deterministic seed so a
    // failure is reproducible.
    let seed = 0xc0ffee;
    function rng(): number {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return (seed >>> 0) / 0x100000000;
    }
    function pick<T>(xs: T[]): T {
      return xs[Math.floor(rng() * xs.length)];
    }
    function nextSha(): string {
      return Math.floor(rng() * 1e9)
        .toString(16)
        .padStart(40, "0");
    }
    function nextBody(): string {
      return `body-${Math.floor(rng() * 1e6)}`;
    }

    let row = initialRow({
      orgId: "o",
      origin: "x",
      path: "p",
      kind: "skill",
      upstreamSha: nextSha(),
      upstreamBody: nextBody(),
      frontmatter: null,
    });

    let lastVersion = row.version;
    const ops: Op[] = [];
    for (let i = 0; i < 200; i++) {
      const choice = pick([
        "sync",
        "sync",
        "sync",
        "override",
        "clear_override",
        "resolve",
        "retire",
      ] as const);
      let op: Op;
      switch (choice) {
        case "sync":
          op = {
            kind: "sync",
            upstreamSha: nextSha(),
            upstreamBody: nextBody(),
          };
          break;
        case "override":
          op = { kind: "override", userBody: nextBody(), userId: "u" };
          break;
        case "clear_override":
          op = { kind: "clear_override", userId: "u" };
          break;
        case "resolve":
          op = {
            kind: "resolve",
            action: pick(["keep_mine", "take_upstream"] as const),
            userId: "u",
          };
          break;
        case "retire":
          op = { kind: "retire" };
          break;
      }
      ops.push(op);
      row = applyOp(row, op);
      assertInvariants(row);
      // I-S6 — version is monotone non-decreasing.
      expect(row.version).toBeGreaterThanOrEqual(lastVersion);
      lastVersion = row.version;
    }
  });
});
