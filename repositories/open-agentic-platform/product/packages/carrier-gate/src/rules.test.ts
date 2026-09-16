// Spec 204 FR-001 / AC-1: the canonical carrier gate, fixture-driven.

import { describe, expect, it } from "vitest";
import {
  runCarrierGate,
  checkUtf8,
  checkCarriers,
  checkSecrets,
  CARRIER_FIXTURE,
  CLEAN_FIXTURE,
} from "./index.js";

describe("spec 204 FR-001 carrier gate", () => {
  it.each(CARRIER_FIXTURE.map((s) => [s.label, s.ruleId, s.sample]))(
    "refuses %s with %s",
    (_label, ruleId, sample) => {
      const verdict = runCarrierGate(sample as string);
      expect(verdict.ok).toBe(false);
      if (verdict.ok) return;
      expect(verdict.ruleId).toBe(ruleId);
      expect(verdict.detail.length).toBeGreaterThan(0);
    },
  );

  it.each(CLEAN_FIXTURE.map((s, i) => [i, s]))(
    "passes clean sample %i",
    (_i, sample) => {
      expect(runCarrierGate(sample as string)).toEqual({ ok: true });
    },
  );

  it("is deterministic: same input, same verdict object", () => {
    const input = "stable content";
    expect(runCarrierGate(input)).toEqual(runCarrierGate(input));
  });

  it("granular checks return null on clean content", () => {
    expect(checkUtf8("clean")).toBeNull();
    expect(checkCarriers("clean")).toBeNull();
    expect(checkSecrets("clean")).toBeNull();
  });

  it("runCarrierGate order: utf8 before carriers before secrets", () => {
    // A string tripping multiple rules resolves to the earliest in order.
    // utf8 (lone surrogate) wins over an also-present HTML comment.
    const both = "bad \uD800 <!-- comment -->";
    const verdict = runCarrierGate(both);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.ruleId).toBe("gate.utf8");
  });
});
