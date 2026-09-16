import type { AgentEvent, TokenUsage } from "@opc/provider-registry";

// --- Chain configuration (FR-001) ---

export type TransformFn = (phaseOutput: string, phaseIndex: number) => string;

export type OutputTransform = "thinking_tags" | "system_prompt" | "raw" | TransformFn;

export interface ChainPhase {
  phaseIndex: number;
  providerId: string;
  modelId: string;
  role: "reasoning" | "response" | "custom";
  outputTransform: OutputTransform;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface ModelChain {
  id: string;
  name: string;
  phases: ChainPhase[];
}

// --- Token usage and pricing (FR-005, FR-006) ---

export interface PhaseUsage {
  phaseIndex: number;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ChainUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  phases: PhaseUsage[];
  estimatedCostUsd: number;
}

export interface PricingEntry {
  providerId: string;
  modelId: string;
  inputTokenCostPerMillion: number;
  outputTokenCostPerMillion: number;
}

/** Key format: "providerId:modelId" (NF-003: O(1) lookup) */
export type PricingTable = Map<string, PricingEntry>;

// --- SSE event extensions (FR-007) ---

export type ChainEvent =
  | { type: "chain:phase_start"; phaseIndex: number; providerId: string; modelId: string }
  | { type: "chain:phase_end"; phaseIndex: number; usage: PhaseUsage }
  | { type: "chain:complete"; usage: ChainUsage }
  | { type: "chain:error"; phaseIndex: number; error: string }
  | (AgentEvent & { phaseIndex?: number });

// --- Execution options ---

export interface ChainMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

export interface ChainExecuteOptions {
  messages: ChainMessage[];
  signal?: AbortSignal;
}

// --- Result types ---

export interface PhaseResult {
  phaseIndex: number;
  output: string;
  usage: PhaseUsage;
}

export interface ChainResult {
  output: string;
  phases: PhaseResult[];
  usage: ChainUsage;
  aborted: boolean;
}

// --- Error types ---

export class ChainError extends Error {
  constructor(
    message: string,
    public readonly phaseIndex: number,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "ChainError";
  }
}

export class ChainAbortError extends Error {
  constructor(
    public readonly phaseIndex: number,
    public readonly partialResults: PhaseResult[],
  ) {
    super(`Chain aborted during phase ${phaseIndex}`);
    this.name = "ChainAbortError";
  }
}

// --- Provider interface (dependency injection) ---

export interface ChainProvider {
  stream(
    providerId: string,
    modelId: string,
    params: {
      messages: ChainMessage[];
      maxTokens?: number;
      temperature?: number;
      systemPrompt?: string;
      signal?: AbortSignal;
    },
  ): AsyncIterable<AgentEvent>;
}
