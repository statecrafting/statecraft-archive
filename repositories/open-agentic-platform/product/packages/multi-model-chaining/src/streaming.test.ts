import { describe, it, expect } from "vitest";
import {
  createPhaseStartEvent,
  createPhaseEndEvent,
  createChainCompleteEvent,
  createChainErrorEvent,
  augmentEventWithPhase,
} from "./streaming.js";
import type { ChainPhase, PhaseUsage, ChainUsage } from "./types.js";
import type { AgentEvent } from "@opc/provider-registry";

describe("streaming", () => {
  const phase: ChainPhase = {
    phaseIndex: 0,
    providerId: "anthropic",
    modelId: "claude-opus-4",
    role: "reasoning",
    outputTransform: "thinking_tags",
  };

  const usage: PhaseUsage = {
    phaseIndex: 0,
    providerId: "anthropic",
    modelId: "claude-opus-4",
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  it("createPhaseStartEvent has correct structure", () => {
    const event = createPhaseStartEvent(phase);
    expect(event.type).toBe("chain:phase_start");
    expect(event).toEqual({
      type: "chain:phase_start",
      phaseIndex: 0,
      providerId: "anthropic",
      modelId: "claude-opus-4",
    });
  });

  it("createPhaseEndEvent includes usage", () => {
    const event = createPhaseEndEvent(0, usage);
    expect(event.type).toBe("chain:phase_end");
    expect(event).toEqual({
      type: "chain:phase_end",
      phaseIndex: 0,
      usage,
    });
  });

  it("createChainCompleteEvent includes full chain usage", () => {
    const chainUsage: ChainUsage = {
      totalInputTokens: 2000,
      totalOutputTokens: 1000,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      phases: [usage],
      estimatedCostUsd: 0.05,
    };
    const event = createChainCompleteEvent(chainUsage);
    expect(event.type).toBe("chain:complete");
    expect(event).toEqual({ type: "chain:complete", usage: chainUsage });
  });

  it("createChainErrorEvent captures phase and error message", () => {
    const event = createChainErrorEvent(1, "Provider timeout");
    expect(event).toEqual({
      type: "chain:error",
      phaseIndex: 1,
      error: "Provider timeout",
    });
  });

  it("augmentEventWithPhase adds phaseIndex to AgentEvent", () => {
    const agentEvent: AgentEvent = { type: "text_delta", delta: "hello" };
    const augmented = augmentEventWithPhase(agentEvent, 2);
    expect(augmented).toEqual({
      type: "text_delta",
      delta: "hello",
      phaseIndex: 2,
    });
  });

  it("augmentEventWithPhase preserves all original fields", () => {
    const agentEvent: AgentEvent = {
      type: "message_complete",
      stopReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
    };
    const augmented = augmentEventWithPhase(agentEvent, 0);
    expect(augmented.type).toBe("message_complete");
    expect("stopReason" in augmented && augmented.stopReason).toBe("end_turn");
    expect("phaseIndex" in augmented && augmented.phaseIndex).toBe(0);
  });
});
