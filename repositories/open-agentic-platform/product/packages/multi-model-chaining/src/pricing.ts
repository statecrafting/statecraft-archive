import type { PricingEntry, PricingTable, PhaseUsage } from "./types.js";

const PER_MILLION = 1_000_000;

/**
 * Build the pricing table key (NF-003: O(1) lookup).
 */
export function pricingKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

/**
 * Create a PricingTable from an array of entries.
 */
export function createPricingTable(entries: PricingEntry[]): PricingTable {
  const table: PricingTable = new Map();
  for (const entry of entries) {
    table.set(pricingKey(entry.providerId, entry.modelId), entry);
  }
  return table;
}

/**
 * Look up pricing for a specific provider/model pair.
 */
export function lookupPricing(
  table: PricingTable,
  providerId: string,
  modelId: string,
): PricingEntry | undefined {
  return table.get(pricingKey(providerId, modelId));
}

/**
 * Compute estimated cost from phase usages and a pricing table (FR-006).
 * Unknown provider/model pairs contribute $0.
 */
export function computeCost(
  phases: PhaseUsage[],
  table: PricingTable,
): number {
  let totalCost = 0;

  for (const phase of phases) {
    const entry = lookupPricing(table, phase.providerId, phase.modelId);
    if (!entry) continue;

    const inputCost =
      (phase.inputTokens / PER_MILLION) * entry.inputTokenCostPerMillion;
    const outputCost =
      (phase.outputTokens / PER_MILLION) * entry.outputTokenCostPerMillion;

    totalCost += inputCost + outputCost;
  }

  return totalCost;
}
