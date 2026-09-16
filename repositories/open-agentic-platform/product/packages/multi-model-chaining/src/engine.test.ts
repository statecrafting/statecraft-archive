import { describe, it, expect } from "vitest";
import { ChainEngine } from "./engine.js";
import { createPricingTable } from "./pricing.js";
import type {
  ModelChain,
  ChainProvider,
  ChainEvent,
  ChainMessage,
} from "./types.js";
import { ChainError } from "./types.js";
import type { AgentEvent } from "@opc/provider-registry";

// --- Test helpers ---

function createMockProvider(
  responses: Map<string, { output: string; inputTokens: number; outputTokens: number }>,
): ChainProvider {
  return {
    async *stream(providerId, modelId, params) {
      const key = `${providerId}:${modelId}`;
      const resp = responses.get(key);
      if (!resp) throw new Error(`No mock for ${key}`);

      // Check abort before streaming
      if (params.signal?.aborted) {
        throw new Error("Aborted");
      }

      yield { type: "message_start", role: "assistant", model: modelId } as AgentEvent;

      // Stream text in chunks
      const words = resp.output.split(" ");
      for (const word of words) {
        if (params.signal?.aborted) {
          throw new Error("Aborted");
        }
        yield { type: "text_delta", delta: word + " " } as AgentEvent;
      }

      yield { type: "text_complete", text: resp.output } as AgentEvent;
      yield {
        type: "message_complete",
        stopReason: "end_turn",
        usage: {
          inputTokens: resp.inputTokens,
          outputTokens: resp.outputTokens,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      } as AgentEvent;
    },
  };
}

function twoPhaseChain(): ModelChain {
  return {
    id: "reasoning-response",
    name: "Reasoning + Response",
    phases: [
      {
        phaseIndex: 0,
        providerId: "anthropic",
        modelId: "claude-opus-4",
        role: "reasoning",
        outputTransform: "thinking_tags",
      },
      {
        phaseIndex: 1,
        providerId: "openai",
        modelId: "gpt-4o",
        role: "response",
        outputTransform: "raw",
      },
    ],
  };
}

const pricingTable = createPricingTable([
  { providerId: "anthropic", modelId: "claude-opus-4", inputTokenCostPerMillion: 15, outputTokenCostPerMillion: 75 },
  { providerId: "openai", modelId: "gpt-4o", inputTokenCostPerMillion: 2.5, outputTokenCostPerMillion: 10 },
]);

// --- Tests ---

describe("ChainEngine", () => {
  describe("stream()", () => {
    it("emits phase_start and phase_end for each phase (FR-007, SC-002)", async () => {
      const provider = createMockProvider(
        new Map([
          ["anthropic:claude-opus-4", { output: "reasoning output", inputTokens: 100, outputTokens: 50 }],
          ["openai:gpt-4o", { output: "final response", inputTokens: 200, outputTokens: 100 }],
        ]),
      );
      const engine = new ChainEngine({ provider });
      const events: ChainEvent[] = [];

      for await (const event of engine.stream(twoPhaseChain(), { messages: [{ role: "user", content: "hello" }] })) {
        events.push(event);
      }

      const phaseStarts = events.filter((e) => e.type === "chain:phase_start");
      const phaseEnds = events.filter((e) => e.type === "chain:phase_end");
      expect(phaseStarts).toHaveLength(2);
      expect(phaseEnds).toHaveLength(2);

      expect(phaseStarts[0]).toEqual({ type: "chain:phase_start", phaseIndex: 0, providerId: "anthropic", modelId: "claude-opus-4" });
      expect(phaseStarts[1]).toEqual({ type: "chain:phase_start", phaseIndex: 1, providerId: "openai", modelId: "gpt-4o" });
    });

    it("emits chain:complete at the end (FR-007)", async () => {
      const provider = createMockProvider(
        new Map([
          ["anthropic:claude-opus-4", { output: "analysis", inputTokens: 100, outputTokens: 50 }],
          ["openai:gpt-4o", { output: "response", inputTokens: 200, outputTokens: 100 }],
        ]),
      );
      const engine = new ChainEngine({ provider });
      const events: ChainEvent[] = [];

      for await (const event of engine.stream(twoPhaseChain(), { messages: [{ role: "user", content: "hi" }] })) {
        events.push(event);
      }

      const complete = events.find((e) => e.type === "chain:complete");
      expect(complete).toBeDefined();
      expect(complete!.type).toBe("chain:complete");
    });

    it("augments AgentEvents with phaseIndex (SC-002)", async () => {
      const provider = createMockProvider(
        new Map([
          ["anthropic:claude-opus-4", { output: "thinking", inputTokens: 50, outputTokens: 25 }],
          ["openai:gpt-4o", { output: "answer", inputTokens: 100, outputTokens: 50 }],
        ]),
      );
      const engine = new ChainEngine({ provider });
      const textDeltas: ChainEvent[] = [];

      for await (const event of engine.stream(twoPhaseChain(), { messages: [{ role: "user", content: "hi" }] })) {
        if (event.type === "text_delta") textDeltas.push(event);
      }

      // Phase 0 deltas have phaseIndex 0
      const phase0Deltas = textDeltas.filter((e) => "phaseIndex" in e && e.phaseIndex === 0);
      const phase1Deltas = textDeltas.filter((e) => "phaseIndex" in e && e.phaseIndex === 1);
      expect(phase0Deltas.length).toBeGreaterThan(0);
      expect(phase1Deltas.length).toBeGreaterThan(0);
    });

    it("aggregates token usage across phases (FR-005, SC-003)", async () => {
      const provider = createMockProvider(
        new Map([
          ["anthropic:claude-opus-4", { output: "thinking", inputTokens: 1000, outputTokens: 500 }],
          ["openai:gpt-4o", { output: "answer", inputTokens: 2000, outputTokens: 800 }],
        ]),
      );
      const engine = new ChainEngine({ provider, pricingTable });
      const events: ChainEvent[] = [];

      for await (const event of engine.stream(twoPhaseChain(), { messages: [{ role: "user", content: "hi" }] })) {
        events.push(event);
      }

      const complete = events.find((e) => e.type === "chain:complete") as Extract<ChainEvent, { type: "chain:complete" }>;
      expect(complete.usage.totalInputTokens).toBe(3000);
      expect(complete.usage.totalOutputTokens).toBe(1300);
      expect(complete.usage.phases).toHaveLength(2);
    });

    it("computes estimated cost (FR-006, SC-004)", async () => {
      const provider = createMockProvider(
        new Map([
          ["anthropic:claude-opus-4", { output: "thinking", inputTokens: 1000, outputTokens: 500 }],
          ["openai:gpt-4o", { output: "answer", inputTokens: 2000, outputTokens: 800 }],
        ]),
      );
      const engine = new ChainEngine({ provider, pricingTable });
      const events: ChainEvent[] = [];

      for await (const event of engine.stream(twoPhaseChain(), { messages: [{ role: "user", content: "hi" }] })) {
        events.push(event);
      }

      const complete = events.find((e) => e.type === "chain:complete") as Extract<ChainEvent, { type: "chain:complete" }>;
      expect(complete.usage.estimatedCostUsd).toBeGreaterThan(0);
      expect(complete.usage.estimatedCostUsd).toBeCloseTo(0.0655, 4);
    });

    it("emits chain:error on phase failure (FR-008, SC-006)", async () => {
      const provider: ChainProvider = {
        async *stream(providerId) {
          if (providerId === "anthropic") {
            throw new Error("Provider timeout");
          }
          yield { type: "text_delta", delta: "never reached" } as AgentEvent;
        },
      };
      const engine = new ChainEngine({ provider });

      const events: ChainEvent[] = [];
      try {
        for await (const event of engine.stream(twoPhaseChain(), { messages: [{ role: "user", content: "hi" }] })) {
          events.push(event);
        }
      } catch (err) {
        expect(err).toBeInstanceOf(ChainError);
        expect((err as ChainError).phaseIndex).toBe(0);
      }

      const errorEvent = events.find((e) => e.type === "chain:error");
      expect(errorEvent).toBeDefined();
      expect((errorEvent as Extract<ChainEvent, { type: "chain:error" }>).phaseIndex).toBe(0);
      expect((errorEvent as Extract<ChainEvent, { type: "chain:error" }>).error).toContain("Provider timeout");
    });

    it("halts chain on phase failure — Phase 2 not executed (FR-008)", async () => {
      const called: string[] = [];
      const provider: ChainProvider = {
        async *stream(providerId) {
          called.push(providerId);
          if (providerId === "anthropic") {
            throw new Error("fail");
          }
          yield { type: "text_delta", delta: "x" } as AgentEvent;
        },
      };
      const engine = new ChainEngine({ provider });

      try {
        for await (const _ of engine.stream(twoPhaseChain(), { messages: [{ role: "user", content: "hi" }] })) {
          // consume
        }
      } catch {
        // expected
      }

      expect(called).toEqual(["anthropic"]);
    });
  });

  describe("execute()", () => {
    it("SC-001: two-phase chain injects thinking tags into response context", async () => {
      let capturedMessages: ChainMessage[] = [];
      const provider: ChainProvider = {
        async *stream(providerId, modelId, params) {
          if (providerId === "openai") {
            capturedMessages = [...params.messages];
          }
          const output = providerId === "anthropic" ? "Step 1: analyze. Step 2: solve." : "Here is the answer.";
          yield { type: "text_complete", text: output } as AgentEvent;
          yield { type: "message_complete", stopReason: "end_turn", usage: { inputTokens: 50, outputTokens: 25 } } as AgentEvent;
        },
      };
      const engine = new ChainEngine({ provider });
      const result = await engine.execute(twoPhaseChain(), {
        messages: [{ role: "user", content: "Solve this problem" }],
      });

      // Response model received thinking-tagged output from reasoning model
      const assistantMsg = capturedMessages.find((m) => m.role === "assistant");
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.content).toContain("<thinking>");
      expect(assistantMsg!.content).toContain("Step 1: analyze");
      expect(assistantMsg!.content).toContain("</thinking>");

      expect(result.output).toBe("Here is the answer.");
      expect(result.phases).toHaveLength(2);
      expect(result.aborted).toBe(false);
    });

    it("returns aggregated usage in result", async () => {
      const provider = createMockProvider(
        new Map([
          ["anthropic:claude-opus-4", { output: "analysis", inputTokens: 1000, outputTokens: 500 }],
          ["openai:gpt-4o", { output: "response", inputTokens: 2000, outputTokens: 800 }],
        ]),
      );
      const engine = new ChainEngine({ provider, pricingTable });
      const result = await engine.execute(twoPhaseChain(), {
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.usage.totalInputTokens).toBe(3000);
      expect(result.usage.totalOutputTokens).toBe(1300);
      expect(result.usage.estimatedCostUsd).toBeGreaterThan(0);
    });

    it("throws ChainError on phase failure", async () => {
      const provider: ChainProvider = {
        async *stream() {
          throw new Error("network error");
        },
      };
      const engine = new ChainEngine({ provider });

      await expect(
        engine.execute(twoPhaseChain(), { messages: [{ role: "user", content: "hi" }] }),
      ).rejects.toThrow(ChainError);
    });

    it("handles three-phase chain (FR-004)", async () => {
      const threePhaseChain: ModelChain = {
        id: "three-phase",
        name: "Three Phase",
        phases: [
          { phaseIndex: 0, providerId: "a", modelId: "m1", role: "reasoning", outputTransform: "thinking_tags" },
          { phaseIndex: 1, providerId: "b", modelId: "m2", role: "custom", outputTransform: "raw" },
          { phaseIndex: 2, providerId: "c", modelId: "m3", role: "response", outputTransform: "raw" },
        ],
      };
      const provider = createMockProvider(
        new Map([
          ["a:m1", { output: "phase0 output", inputTokens: 100, outputTokens: 50 }],
          ["b:m2", { output: "phase1 output", inputTokens: 200, outputTokens: 100 }],
          ["c:m3", { output: "final output", inputTokens: 300, outputTokens: 150 }],
        ]),
      );
      const engine = new ChainEngine({ provider });
      const result = await engine.execute(threePhaseChain, {
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.phases).toHaveLength(3);
      expect(result.output).toBe("final output");
      expect(result.usage.totalInputTokens).toBe(600);
      expect(result.usage.totalOutputTokens).toBe(300);
    });
  });

  describe("abort (FR-009)", () => {
    it("SC-005: abort before Phase 2 prevents execution", async () => {
      const controller = new AbortController();
      const called: string[] = [];
      const provider: ChainProvider = {
        async *stream(providerId, modelId, params) {
          called.push(providerId);
          yield { type: "text_complete", text: "phase0 done" } as AgentEvent;
          yield { type: "message_complete", stopReason: "end_turn", usage: { inputTokens: 50, outputTokens: 25 } } as AgentEvent;
          // Abort after phase 0 completes
          if (providerId === "anthropic") {
            controller.abort();
          }
        },
      };
      const engine = new ChainEngine({ provider });
      const events: ChainEvent[] = [];

      for await (const event of engine.stream(twoPhaseChain(), {
        messages: [{ role: "user", content: "hi" }],
        signal: controller.signal,
      })) {
        events.push(event);
      }

      // Phase 2 (openai) should not have been called
      expect(called).toEqual(["anthropic"]);
      const errorEvent = events.find((e) => e.type === "chain:error");
      expect(errorEvent).toBeDefined();
    });

    it("abort during streaming stops current phase", async () => {
      const controller = new AbortController();
      let deltaCount = 0;
      const provider: ChainProvider = {
        async *stream(providerId, modelId, params) {
          for (let i = 0; i < 100; i++) {
            if (params.signal?.aborted) throw new Error("Aborted");
            yield { type: "text_delta", delta: `word${i} ` } as AgentEvent;
            deltaCount++;
            if (i === 2) controller.abort();
          }
          yield { type: "message_complete", stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5 } } as AgentEvent;
        },
      };
      const engine = new ChainEngine({ provider });

      try {
        for await (const _ of engine.stream(twoPhaseChain(), {
          messages: [{ role: "user", content: "hi" }],
          signal: controller.signal,
        })) {
          // consume
        }
      } catch {
        // expected
      }

      // Should have stopped early
      expect(deltaCount).toBeLessThan(100);
    });
  });

  describe("single phase chain", () => {
    it("works with a single phase", async () => {
      const singleChain: ModelChain = {
        id: "single",
        name: "Single Phase",
        phases: [
          { phaseIndex: 0, providerId: "anthropic", modelId: "claude-opus-4", role: "response", outputTransform: "raw" },
        ],
      };
      const provider = createMockProvider(
        new Map([["anthropic:claude-opus-4", { output: "direct response", inputTokens: 100, outputTokens: 50 }]]),
      );
      const engine = new ChainEngine({ provider });
      const result = await engine.execute(singleChain, {
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.output).toBe("direct response");
      expect(result.phases).toHaveLength(1);
    });
  });
});
