// Spec 115 FR-018 / FR-019 — pure cost-estimation helpers (no
// Encore-runtime imports so they are unit-testable under plain vitest).

import type { TokenSpend } from "../extractionOutput";
import { ExtractorError } from "./types";

const DEFAULT_PRICE_INPUT_USD_PER_MTOK = 3.0;
const DEFAULT_PRICE_OUTPUT_USD_PER_MTOK = 15.0;
const DEFAULT_PRICE_CACHE_WRITE_USD_PER_MTOK = 3.75;
const DEFAULT_PRICE_CACHE_READ_USD_PER_MTOK = 0.3;

function priceFromEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function getPricingUsdPerMtok() {
  return {
    input: priceFromEnv(
      "STATECRAFT_EXTRACT_PRICE_INPUT_USD_PER_MTOK",
      DEFAULT_PRICE_INPUT_USD_PER_MTOK,
    ),
    output: priceFromEnv(
      "STATECRAFT_EXTRACT_PRICE_OUTPUT_USD_PER_MTOK",
      DEFAULT_PRICE_OUTPUT_USD_PER_MTOK,
    ),
    cacheWrite: priceFromEnv(
      "STATECRAFT_EXTRACT_PRICE_CACHE_WRITE_USD_PER_MTOK",
      DEFAULT_PRICE_CACHE_WRITE_USD_PER_MTOK,
    ),
    cacheRead: priceFromEnv(
      "STATECRAFT_EXTRACT_PRICE_CACHE_READ_USD_PER_MTOK",
      DEFAULT_PRICE_CACHE_READ_USD_PER_MTOK,
    ),
  };
}

export type CostEstimateInput = {
  inputTokensEstimated: number;
  outputTokensEstimated: number;
  cacheWriteTokensEstimated?: number;
  cacheReadTokensEstimated?: number;
};

export function estimateCallCostUsd(args: CostEstimateInput): number {
  const p = getPricingUsdPerMtok();
  const M = 1_000_000;
  return (
    (args.inputTokensEstimated * p.input) / M +
    (args.outputTokensEstimated * p.output) / M +
    ((args.cacheWriteTokensEstimated ?? 0) * p.cacheWrite) / M +
    ((args.cacheReadTokensEstimated ?? 0) * p.cacheRead) / M
  );
}

export function actualCostUsd(spend: TokenSpend): number {
  return estimateCallCostUsd({
    inputTokensEstimated: spend.input,
    outputTokensEstimated: spend.output,
    cacheWriteTokensEstimated: spend.cacheWrite ?? 0,
    cacheReadTokensEstimated: spend.cacheRead ?? 0,
  });
}

export function assertNoTools(
  request: { tools?: unknown[] | undefined },
  extractorKind: string,
): void {
  if (request.tools && request.tools.length > 0) {
    throw new ExtractorError({
      code: "extractor_tool_use_forbidden",
      extractorKind,
      message:
        "agent extractors MUST NOT pass tool definitions; spec 115 FR-021",
    });
  }
}

export function nextUtcMidnightIso(now: Date = new Date()): string {
  const m = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return m.toISOString();
}
