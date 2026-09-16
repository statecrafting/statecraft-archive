import { describe, it, expect } from "vitest";
import type {
  ChainPhase,
  ModelChain,
  PhaseUsage,
  ChainUsage,
  PricingEntry,
  ChainEvent,
  ChainMessage,
  ChainExecuteOptions,
  PhaseResult,
  ChainResult,
  ChainProvider,
  TransformFn,
  OutputTransform,
} from "./types.js";
import { ChainError, ChainAbortError } from "./types.js";

describe("types", () => {
  it("ChainPhase has required fields", () => {
    const phase: ChainPhase = {
      phaseIndex: 0,
      providerId: "anthropic",
      modelId: "claude-opus-4",
      role: "reasoning",
      outputTransform: "thinking_tags",
    };
    expect(phase.phaseIndex).toBe(0);
    expect(phase.role).toBe("reasoning");
    expect(phase.outputTransform).toBe("thinking_tags");
  });

  it("ChainPhase supports optional fields", () => {
    const phase: ChainPhase = {
      phaseIndex: 1,
      providerId: "openai",
      modelId: "gpt-4o",
      role: "response",
      outputTransform: "raw",
      maxTokens: 4096,
      temperature: 0.7,
      systemPrompt: "You are a helpful assistant.",
    };
    expect(phase.maxTokens).toBe(4096);
    expect(phase.temperature).toBe(0.7);
    expect(phase.systemPrompt).toBe("You are a helpful assistant.");
  });

  it("ModelChain holds ordered phases", () => {
    const chain: ModelChain = {
      id: "test-chain",
      name: "Test Chain",
      phases: [
        { phaseIndex: 0, providerId: "a", modelId: "m1", role: "reasoning", outputTransform: "thinking_tags" },
        { phaseIndex: 1, providerId: "b", modelId: "m2", role: "response", outputTransform: "raw" },
      ],
    };
    expect(chain.phases).toHaveLength(2);
    expect(chain.phases[0].phaseIndex).toBe(0);
    expect(chain.phases[1].phaseIndex).toBe(1);
  });

  it("OutputTransform supports all variants", () => {
    const transforms: OutputTransform[] = [
      "thinking_tags",
      "system_prompt",
      "raw",
      (output: string, idx: number) => `[${idx}] ${output}`,
    ];
    expect(transforms).toHaveLength(4);
    expect(typeof transforms[3]).toBe("function");
  });

  it("PhaseUsage tracks per-phase tokens", () => {
    const usage: PhaseUsage = {
      phaseIndex: 0,
      providerId: "anthropic",
      modelId: "claude-opus-4",
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
    };
    expect(usage.inputTokens + usage.outputTokens).toBe(1500);
  });

  it("ChainUsage aggregates across phases", () => {
    const usage: ChainUsage = {
      totalInputTokens: 2000,
      totalOutputTokens: 1000,
      totalCacheReadTokens: 400,
      totalCacheWriteTokens: 200,
      phases: [],
      estimatedCostUsd: 0.05,
    };
    expect(usage.estimatedCostUsd).toBe(0.05);
  });

  it("PricingEntry has cost fields", () => {
    const entry: PricingEntry = {
      providerId: "anthropic",
      modelId: "claude-opus-4",
      inputTokenCostPerMillion: 15,
      outputTokenCostPerMillion: 75,
    };
    expect(entry.inputTokenCostPerMillion).toBe(15);
  });

  it("ChainEvent union covers all event types", () => {
    const events: ChainEvent[] = [
      { type: "chain:phase_start", phaseIndex: 0, providerId: "a", modelId: "m" },
      { type: "chain:phase_end", phaseIndex: 0, usage: { phaseIndex: 0, providerId: "a", modelId: "m", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      { type: "chain:complete", usage: { totalInputTokens: 0, totalOutputTokens: 0, totalCacheReadTokens: 0, totalCacheWriteTokens: 0, phases: [], estimatedCostUsd: 0 } },
      { type: "chain:error", phaseIndex: 0, error: "fail" },
      { type: "text_delta", delta: "hi", phaseIndex: 0 },
    ];
    expect(events).toHaveLength(5);
  });

  it("ChainError captures phase index", () => {
    const err = new ChainError("boom", 2);
    expect(err.name).toBe("ChainError");
    expect(err.message).toBe("boom");
    expect(err.phaseIndex).toBe(2);
    expect(err.cause).toBeUndefined();
  });

  it("ChainError wraps cause", () => {
    const cause = new Error("root");
    const err = new ChainError("phase failed", 1, cause);
    expect(err.cause).toBe(cause);
  });

  it("ChainAbortError preserves partial results", () => {
    const partials: PhaseResult[] = [
      { phaseIndex: 0, output: "analysis", usage: { phaseIndex: 0, providerId: "a", modelId: "m", inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    ];
    const err = new ChainAbortError(1, partials);
    expect(err.name).toBe("ChainAbortError");
    expect(err.phaseIndex).toBe(1);
    expect(err.partialResults).toHaveLength(1);
    expect(err.message).toContain("phase 1");
  });

  it("ChainMessage supports all roles", () => {
    const msgs: ChainMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "system", content: "you are helpful" },
      { role: "tool", content: '{"result":42}' },
    ];
    expect(msgs).toHaveLength(4);
  });
});
