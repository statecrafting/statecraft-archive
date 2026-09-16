// Spec 115 FR-018 / FR-019 — pure tests for the cost estimator + tool
// fail-closed gate. The day-aggregate gate is exercised end-to-end in the
// Phase 4 verification suite (DB-bound).

import { describe, expect, test } from "vitest";
import { ExtractorError } from "./types";
import {
  actualCostUsd,
  assertNoTools,
  estimateCallCostUsd,
} from "./agent-cost-helpers";

describe("estimateCallCostUsd", () => {
  test("zero tokens → zero cost", () => {
    expect(
      estimateCallCostUsd({
        inputTokensEstimated: 0,
        outputTokensEstimated: 0,
      }),
    ).toBe(0);
  });

  test("scales linearly per-million-tok", () => {
    const oneM = estimateCallCostUsd({
      inputTokensEstimated: 1_000_000,
      outputTokensEstimated: 0,
    });
    const halfM = estimateCallCostUsd({
      inputTokensEstimated: 500_000,
      outputTokensEstimated: 0,
    });
    expect(halfM * 2).toBeCloseTo(oneM, 6);
  });

  test("includes cache-write and cache-read tokens", () => {
    const baseline = estimateCallCostUsd({
      inputTokensEstimated: 1_000,
      outputTokensEstimated: 1_000,
    });
    const withCache = estimateCallCostUsd({
      inputTokensEstimated: 1_000,
      outputTokensEstimated: 1_000,
      cacheWriteTokensEstimated: 1_000,
      cacheReadTokensEstimated: 1_000,
    });
    expect(withCache).toBeGreaterThan(baseline);
  });
});

describe("actualCostUsd", () => {
  test("reproduces estimateCallCostUsd over the same inputs", () => {
    const cost = actualCostUsd({ input: 100, output: 200 });
    const est = estimateCallCostUsd({
      inputTokensEstimated: 100,
      outputTokensEstimated: 200,
    });
    expect(cost).toBeCloseTo(est, 9);
  });
});

describe("assertNoTools", () => {
  test("passes when tools field is absent", () => {
    expect(() => assertNoTools({}, "agent-pdf-vision")).not.toThrow();
  });

  test("passes when tools field is an empty array", () => {
    expect(() =>
      assertNoTools({ tools: [] }, "agent-pdf-vision"),
    ).not.toThrow();
  });

  test("throws ExtractorError when tools are passed (FR-021)", () => {
    expect(() =>
      assertNoTools({ tools: [{ name: "anything" }] }, "agent-pdf-vision"),
    ).toThrow(ExtractorError);
  });
});
