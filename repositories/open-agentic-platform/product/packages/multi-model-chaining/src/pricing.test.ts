import { describe, it, expect } from "vitest";
import {
  pricingKey,
  createPricingTable,
  lookupPricing,
  computeCost,
} from "./pricing.js";
import type { PhaseUsage, PricingEntry } from "./types.js";

describe("pricingKey", () => {
  it("combines provider and model with colon", () => {
    expect(pricingKey("anthropic", "claude-opus-4")).toBe("anthropic:claude-opus-4");
  });

  it("handles empty strings", () => {
    expect(pricingKey("", "")).toBe(":");
  });
});

describe("createPricingTable", () => {
  it("creates a Map keyed by provider:model (NF-003)", () => {
    const entries: PricingEntry[] = [
      { providerId: "anthropic", modelId: "claude-opus-4", inputTokenCostPerMillion: 15, outputTokenCostPerMillion: 75 },
      { providerId: "openai", modelId: "gpt-4o", inputTokenCostPerMillion: 2.5, outputTokenCostPerMillion: 10 },
    ];
    const table = createPricingTable(entries);
    expect(table.size).toBe(2);
    expect(table.has("anthropic:claude-opus-4")).toBe(true);
    expect(table.has("openai:gpt-4o")).toBe(true);
  });

  it("handles empty entries", () => {
    const table = createPricingTable([]);
    expect(table.size).toBe(0);
  });

  it("last entry wins on duplicate keys", () => {
    const entries: PricingEntry[] = [
      { providerId: "a", modelId: "m", inputTokenCostPerMillion: 1, outputTokenCostPerMillion: 2 },
      { providerId: "a", modelId: "m", inputTokenCostPerMillion: 10, outputTokenCostPerMillion: 20 },
    ];
    const table = createPricingTable(entries);
    expect(table.size).toBe(1);
    expect(table.get("a:m")!.inputTokenCostPerMillion).toBe(10);
  });
});

describe("lookupPricing", () => {
  const table = createPricingTable([
    { providerId: "anthropic", modelId: "claude-opus-4", inputTokenCostPerMillion: 15, outputTokenCostPerMillion: 75 },
  ]);

  it("returns entry for known provider:model", () => {
    const entry = lookupPricing(table, "anthropic", "claude-opus-4");
    expect(entry).toBeDefined();
    expect(entry!.inputTokenCostPerMillion).toBe(15);
  });

  it("returns undefined for unknown provider:model", () => {
    const entry = lookupPricing(table, "openai", "gpt-4o");
    expect(entry).toBeUndefined();
  });
});

describe("computeCost", () => {
  const table = createPricingTable([
    { providerId: "anthropic", modelId: "claude-opus-4", inputTokenCostPerMillion: 15, outputTokenCostPerMillion: 75 },
    { providerId: "openai", modelId: "gpt-4o", inputTokenCostPerMillion: 2.5, outputTokenCostPerMillion: 10 },
  ]);

  it("computes correct cost for single phase (FR-006)", () => {
    const phases: PhaseUsage[] = [
      { phaseIndex: 0, providerId: "anthropic", modelId: "claude-opus-4", inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ];
    const cost = computeCost(phases, table);
    // (1M/1M)*15 + (100K/1M)*75 = 15 + 7.5 = 22.5
    expect(cost).toBeCloseTo(22.5, 6);
  });

  it("computes correct cost for multiple phases", () => {
    const phases: PhaseUsage[] = [
      { phaseIndex: 0, providerId: "anthropic", modelId: "claude-opus-4", inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
      { phaseIndex: 1, providerId: "openai", modelId: "gpt-4o", inputTokens: 2000, outputTokens: 800, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ];
    const cost = computeCost(phases, table);
    // anthropic: 0.015 + 0.0375 = 0.0525
    // openai: 0.005 + 0.008 = 0.013
    expect(cost).toBeCloseTo(0.0655, 6);
  });

  it("returns 0 for unknown provider:model pairs", () => {
    const phases: PhaseUsage[] = [
      { phaseIndex: 0, providerId: "unknown", modelId: "model", inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ];
    const cost = computeCost(phases, table);
    expect(cost).toBe(0);
  });

  it("returns 0 for empty phases", () => {
    const cost = computeCost([], table);
    expect(cost).toBe(0);
  });

  it("handles zero token counts", () => {
    const phases: PhaseUsage[] = [
      { phaseIndex: 0, providerId: "anthropic", modelId: "claude-opus-4", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ];
    const cost = computeCost(phases, table);
    expect(cost).toBe(0);
  });

  it("SC-004: matches expected values for known token counts", () => {
    const phases: PhaseUsage[] = [
      { phaseIndex: 0, providerId: "anthropic", modelId: "claude-opus-4", inputTokens: 10_000, outputTokens: 5_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ];
    const cost = computeCost(phases, table);
    // (10000/1M)*15 + (5000/1M)*75 = 0.15 + 0.375 = 0.525
    expect(cost).toBeCloseTo(0.525, 6);
  });
});
