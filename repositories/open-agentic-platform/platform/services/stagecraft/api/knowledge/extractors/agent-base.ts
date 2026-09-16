// Spec 115 §5 / FR-017 — FR-021 — agent-extractor shared infrastructure.
//
// The Anthropic SDK has a very large type graph; encore's tsparser walks
// every reachable type at build time and chokes on it. We keep the SDK
// confined to this single file and expose only narrowly-typed entry
// points so the rest of the extraction surface (agent-pdf-vision.ts,
// agent-image-vision.ts) stays parser-friendly. Concretely:
//   - `runAgentMessage` accepts content as an opaque `unknown[]` and
//     forwards it untouched to `messages.create`. The SDK validates at
//     runtime; mistakes there fail loudly. Type safety inside this
//     module relies on the local declarations below.
//   - `getAnthropicClient` returns `unknown` so callers can pass it
//     through without dragging the SDK type tree into their files.

import { createHash } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import log from "encore.dev/log";
import { secret } from "encore.dev/config";
import { db } from "../../db/drizzle";
import { knowledgeExtractionRuns } from "../../db/schema";
import type { AgentRun, TokenSpend } from "../extractionOutput";
import type { ExtractionPolicy } from "../extractionPolicy";
import type { AssembledPrompt } from "../prompts";
import { ExtractorError, type TokenSpendReporter } from "./types";
import {
  actualCostUsd,
  assertNoTools,
  estimateCallCostUsd,
  nextUtcMidnightIso,
  type CostEstimateInput,
} from "./agent-cost-helpers";

export {
  actualCostUsd,
  assertNoTools,
  estimateCallCostUsd,
  type CostEstimateInput,
} from "./agent-cost-helpers";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Anthropic model the agent extractors fall back to when the workspace
 *  policy does not pin a `modelPin`. Pinned to a vision-capable, tool-use-
 *  capable model in the Claude 4.X family (cutoff 2026-01); the prompt
 *  cache reduces cold-start cost on repeat extractions. */
export const DEFAULT_MODEL_ID = "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// Anthropic HTTP client.
// ---------------------------------------------------------------------------
//
// We hand-roll a minimal client over `fetch` instead of using
// `@anthropic-ai/sdk`. The SDK exposes a ~25k-line type tree that hangs
// encore's tsparser indefinitely (>25 min on `encore build docker`). The
// surface we actually need is one HTTP call; the tradeoff favours a
// 60-line wrapper over an unbuildable docker image.
//
// Tests override `_setAnthropicClientForTesting` with a fake transport
// that returns deterministic `MessagesCreateResponse` shapes.

const anthropicApiKey = secret("ANTHROPIC_API_KEY");
const ANTHROPIC_API_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicClientShape {
  messages: {
    create: (params: Record<string, unknown>) => Promise<MessagesCreateResponse>;
  };
}

type MessagesCreateResponse = {
  content: Array<{ type: string; text?: string }>;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

class AnthropicHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`anthropic http ${status}: ${body.slice(0, 200)}`);
    this.name = "AnthropicHttpError";
  }
}

function makeHttpClient(apiKey: string): AnthropicClientShape {
  return {
    messages: {
      async create(params: Record<string, unknown>): Promise<MessagesCreateResponse> {
        const res = await fetch(`${ANTHROPIC_API_BASE}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            // Prompt caching for the system block requires this beta header
            // until Anthropic GAs it. Statecraft tracks the GA migration in
            // a follow-up task; if/when removal lands, the cache_control
            // field on the system block is silently ignored.
            "anthropic-beta": "prompt-caching-2024-07-31",
          },
          body: JSON.stringify(params),
        });
        if (!res.ok) {
          throw new AnthropicHttpError(res.status, await res.text());
        }
        return (await res.json()) as MessagesCreateResponse;
      },
    },
  };
}

let cachedClient: AnthropicClientShape | null = null;

export function getAnthropicClient(): unknown {
  if (cachedClient) return cachedClient;
  cachedClient = makeHttpClient(anthropicApiKey());
  return cachedClient;
}

/** Visible for tests — the test transport overrides the cached client. */
export function _setAnthropicClientForTesting(client: unknown): void {
  cachedClient = client as AnthropicClientShape | null;
}

// ---------------------------------------------------------------------------
// Day-aggregate gate (FR-019). Pure helpers live in agent-cost-helpers.ts.
// ---------------------------------------------------------------------------

/**
 * FR-019 — sum of `cost_usd` for runs whose `completed_at >= today UTC
 * midnight` for this project. Runs that are still `pending` or
 * `running` are intentionally NOT counted; their cost is only known on
 * completion. This matches the spec's "we don't abort an in-flight call"
 * decision.
 */
export async function getDayAggregateCostUsd(
  projectId: string,
  now: Date = new Date(),
): Promise<number> {
  const utcMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const result = await db
    .select({ total: sql<string>`COALESCE(SUM(${knowledgeExtractionRuns.costUsd}), 0)::text` })
    .from(knowledgeExtractionRuns)
    .where(
      and(
        eq(knowledgeExtractionRuns.projectId, projectId),
        gte(knowledgeExtractionRuns.completedAt, utcMidnight),
      ),
    );
  const raw = result[0]?.total ?? "0";
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

export type CostGateArgs = {
  policy: ExtractionPolicy;
  projectId: string;
  extractorKind: string;
  estimate: CostEstimateInput;
};

/**
 * FR-018 + FR-019 — pre-flight cost check. Throws an `ExtractorError`
 * with the right code so the worker writes the correct
 * `lastExtractionError.code`. No HTTP call is made if either gate trips.
 */
export async function applyCostGates(args: CostGateArgs): Promise<void> {
  const estimate = estimateCallCostUsd(args.estimate);
  if (estimate > args.policy.costCeilingUsdPerCall) {
    throw new ExtractorError({
      code: "cost_ceiling_exceeded",
      extractorKind: args.extractorKind,
      message: `pre-flight estimate $${estimate.toFixed(
        4,
      )} exceeds per-call ceiling $${args.policy.costCeilingUsdPerCall.toFixed(4)}`,
    });
  }
  const dayTotal = await getDayAggregateCostUsd(args.projectId);
  if (dayTotal + estimate > args.policy.costCeilingUsdPerDay) {
    const tomorrow = nextUtcMidnightIso();
    throw new ExtractorError({
      code: "daily_cost_exhausted",
      extractorKind: args.extractorKind,
      message: `day-aggregate $${dayTotal.toFixed(4)} + estimate $${estimate.toFixed(
        4,
      )} exceeds day ceiling $${args.policy.costCeilingUsdPerDay.toFixed(
        4,
      )}; retryAt=${tomorrow}`,
      retriable: true,
    });
  }
}

// ---------------------------------------------------------------------------
// runAgentMessage — the only place that calls anthropic.messages.create
// ---------------------------------------------------------------------------

export type AgentMessageArgs = {
  /**
   * Anthropic SDK client returned by `getAnthropicClient` (cast to
   * `unknown` to keep the SDK type tree out of the encore parser graph).
   */
  client: unknown;
  modelId: string;
  prompt: AssembledPrompt;
  /**
   * User-content blocks. The shape MUST match Anthropic's
   * `ContentBlockParam` (text + image + document) but we type as
   * `unknown[]` so the SDK type tree does not propagate through the
   * extraction codebase. Mistakes here surface as 400s from the API.
   */
  content: unknown[];
  /** Estimated tokens for cost gating, set by the extractor. */
  estimate: CostEstimateInput;
  /** Project + extractor kind for the gate + audit. */
  policy: ExtractionPolicy;
  projectId: string;
  extractorKind: string;
  reportTokenSpend: TokenSpendReporter;
  /** Optional override for max output tokens (default 4096). */
  maxOutputTokens?: number;
};

export type AgentMessageResult = {
  text: string;
  spend: TokenSpend;
  costUsd: number;
};

export async function runAgentMessage(
  args: AgentMessageArgs,
): Promise<AgentMessageResult> {
  // Pre-flight cost gates — no HTTP call if either fails.
  await applyCostGates({
    policy: args.policy,
    projectId: args.projectId,
    extractorKind: args.extractorKind,
    estimate: args.estimate,
  });

  // FR-021 fail-closed.
  assertNoTools({}, args.extractorKind);

  const client = args.client as AnthropicClientShape;
  const startedAt = Date.now();
  const response = await client.messages.create({
    model: args.modelId,
    max_tokens: args.maxOutputTokens ?? 4096,
    system: [
      {
        type: "text",
        text: args.prompt.system,
        // Prompt caching for the system block. Statecraft sees high
        // repeat-rate on the system prompt across uploads in the same
        // workspace; the cache hit ratio dominates per-call cost.
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: args.content,
      },
    ],
  });
  const durationMs = Date.now() - startedAt;

  const text = response.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();

  const spend: TokenSpend = {
    input: response.usage.input_tokens ?? 0,
    output: response.usage.output_tokens ?? 0,
    cacheRead: response.usage.cache_read_input_tokens ?? undefined,
    cacheWrite: response.usage.cache_creation_input_tokens ?? undefined,
  };
  const costUsd = actualCostUsd(spend);
  args.reportTokenSpend(spend, costUsd);

  log.info("agent extractor: anthropic message complete", {
    extractorKind: args.extractorKind,
    modelId: args.modelId,
    durationMs,
    inputTokens: spend.input,
    outputTokens: spend.output,
    costUsd,
  });

  return { text, spend, costUsd };
}

// ---------------------------------------------------------------------------
// Helpers — common to every agent extractor
// ---------------------------------------------------------------------------

export function pickModelId(policy: ExtractionPolicy): string {
  return policy.modelPin && policy.modelPin.length > 0
    ? policy.modelPin
    : DEFAULT_MODEL_ID;
}

export function buildAgentRun(args: {
  modelId: string;
  prompt: AssembledPrompt;
  durationMs: number;
  spend: TokenSpend;
  costUsd: number;
  attempts: number;
}): AgentRun {
  return {
    modelId: args.modelId,
    promptFingerprint: args.prompt.fingerprint,
    durationMs: args.durationMs,
    tokenSpend: args.spend,
    costUsd: args.costUsd,
    attempts: args.attempts,
  };
}

/**
 * Hash a buffer's content; useful if a future extractor needs a per-image
 * fingerprint to log alongside `promptFingerprint`. Not used directly
 * today — exported for upcoming work.
 */
export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
