import type { TokenUsage } from "@opc/provider-registry";
import type { PhaseUsage, ChainUsage, PricingTable, ChainPhase } from "./types.js";
import { computeCost } from "./pricing.js";

/**
 * Create a PhaseUsage from an AgentEvent's message_complete usage (FR-005).
 */
export function createPhaseUsage(
  phase: ChainPhase,
  usage: TokenUsage,
): PhaseUsage {
  return {
    phaseIndex: phase.phaseIndex,
    providerId: phase.providerId,
    modelId: phase.modelId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  };
}

/**
 * Aggregate per-phase usage into a ChainUsage (FR-005, FR-006).
 */
export function aggregateUsage(
  phases: PhaseUsage[],
  pricingTable?: PricingTable,
): ChainUsage {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;

  for (const phase of phases) {
    totalInputTokens += phase.inputTokens;
    totalOutputTokens += phase.outputTokens;
    totalCacheReadTokens += phase.cacheReadTokens;
    totalCacheWriteTokens += phase.cacheWriteTokens;
  }

  const estimatedCostUsd = pricingTable
    ? computeCost(phases, pricingTable)
    : 0;

  return {
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheWriteTokens,
    phases,
    estimatedCostUsd,
  };
}
