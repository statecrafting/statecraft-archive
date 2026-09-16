import { describe, it, expect } from "vitest";
import { createPhaseUsage, aggregateUsage } from "./usage.js";
import { createPricingTable } from "./pricing.js";
import type { ChainPhase, PhaseUsage } from "./types.js";
import type { TokenUsage } from "@opc/provider-registry";

describe("createPhaseUsage", () => {
  const phase: ChainPhase = {
    phaseIndex: 0,
    providerId: "anthropic",
    modelId: "claude-opus-4",
    role: "reasoning",
    outputTransform: "thinking_tags",
  };

  it("maps TokenUsage to PhaseUsage", () => {
    const tokenUsage: TokenUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
    };
    const result = createPhaseUsage(phase, tokenUsage);
    expect(result).toEqual({
      phaseIndex: 0,
      providerId: "anthropic",
      modelId: "claude-opus-4",
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
    });
  });

  it("defaults cache tokens to 0 when undefined", () => {
    const tokenUsage: TokenUsage = {
      inputTokens: 500,
      outputTokens: 250,
    };
    const result = createPhaseUsage(phase, tokenUsage);
    expect(result.cacheReadTokens).toBe(0);
    expect(result.cacheWriteTokens).toBe(0);
  });
});

describe("aggregateUsage", () => {
  const phase0: PhaseUsage = {
    phaseIndex: 0,
    providerId: "anthropic",
    modelId: "claude-opus-4",
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 100,
    cacheWriteTokens: 50,
  };

  const phase1: PhaseUsage = {
    phaseIndex: 1,
    providerId: "openai",
    modelId: "gpt-4o",
    inputTokens: 2000,
    outputTokens: 800,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  it("sums tokens across phases", () => {
    const result = aggregateUsage([phase0, phase1]);
    expect(result.totalInputTokens).toBe(3000);
    expect(result.totalOutputTokens).toBe(1300);
    expect(result.totalCacheReadTokens).toBe(100);
    expect(result.totalCacheWriteTokens).toBe(50);
  });

  it("includes all phase usages", () => {
    const result = aggregateUsage([phase0, phase1]);
    expect(result.phases).toHaveLength(2);
    expect(result.phases[0]).toBe(phase0);
    expect(result.phases[1]).toBe(phase1);
  });

  it("returns 0 cost when no pricing table", () => {
    const result = aggregateUsage([phase0, phase1]);
    expect(result.estimatedCostUsd).toBe(0);
  });

  it("computes cost when pricing table provided", () => {
    const table = createPricingTable([
      { providerId: "anthropic", modelId: "claude-opus-4", inputTokenCostPerMillion: 15, outputTokenCostPerMillion: 75 },
      { providerId: "openai", modelId: "gpt-4o", inputTokenCostPerMillion: 2.5, outputTokenCostPerMillion: 10 },
    ]);
    const result = aggregateUsage([phase0, phase1], table);
    // anthropic: (1000/1M)*15 + (500/1M)*75 = 0.015 + 0.0375 = 0.0525
    // openai: (2000/1M)*2.5 + (800/1M)*10 = 0.005 + 0.008 = 0.013
    // total: 0.0655
    expect(result.estimatedCostUsd).toBeCloseTo(0.0655, 6);
  });

  it("handles empty phases", () => {
    const result = aggregateUsage([]);
    expect(result.totalInputTokens).toBe(0);
    expect(result.totalOutputTokens).toBe(0);
    expect(result.phases).toHaveLength(0);
    expect(result.estimatedCostUsd).toBe(0);
  });

  it("handles single phase", () => {
    const result = aggregateUsage([phase0]);
    expect(result.totalInputTokens).toBe(1000);
    expect(result.totalOutputTokens).toBe(500);
    expect(result.phases).toHaveLength(1);
  });
});
