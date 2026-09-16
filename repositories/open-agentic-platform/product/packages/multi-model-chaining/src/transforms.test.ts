import { describe, it, expect } from "vitest";
import { applyTransform, buildPhaseMessages } from "./transforms.js";
import type { ChainPhase, ChainMessage } from "./types.js";

describe("applyTransform", () => {
  it("wraps output in thinking tags", () => {
    const result = applyTransform("deep analysis", "thinking_tags", 0);
    expect(result).toBe("<thinking>\ndeep analysis\n</thinking>");
  });

  it("returns output unchanged for system_prompt", () => {
    const result = applyTransform("context info", "system_prompt", 0);
    expect(result).toBe("context info");
  });

  it("returns output unchanged for raw", () => {
    const result = applyTransform("raw text", "raw", 0);
    expect(result).toBe("raw text");
  });

  it("calls custom TransformFn with output and phaseIndex", () => {
    const fn = (output: string, idx: number) => `[phase-${idx}] ${output}`;
    const result = applyTransform("data", fn, 3);
    expect(result).toBe("[phase-3] data");
  });

  it("handles empty output in thinking tags", () => {
    const result = applyTransform("", "thinking_tags", 0);
    expect(result).toBe("<thinking>\n\n</thinking>");
  });

  it("handles multiline output in thinking tags", () => {
    const result = applyTransform("line1\nline2\nline3", "thinking_tags", 0);
    expect(result).toContain("line1\nline2\nline3");
    expect(result).toMatch(/^<thinking>\n/);
    expect(result).toMatch(/\n<\/thinking>$/);
  });
});

describe("buildPhaseMessages", () => {
  const userMessages: ChainMessage[] = [
    { role: "user", content: "Explain quantum computing" },
  ];

  it("returns original messages when no prior outputs", () => {
    const phase: ChainPhase = {
      phaseIndex: 0,
      providerId: "anthropic",
      modelId: "claude-opus-4",
      role: "reasoning",
      outputTransform: "thinking_tags",
    };
    const { messages, systemPrompt } = buildPhaseMessages(userMessages, [], phase);
    expect(messages).toEqual(userMessages);
    expect(systemPrompt).toBeUndefined();
  });

  it("injects thinking-tagged output as assistant message (FR-002, FR-003)", () => {
    const reasoningPhase: ChainPhase = {
      phaseIndex: 0,
      providerId: "anthropic",
      modelId: "claude-opus-4",
      role: "reasoning",
      outputTransform: "thinking_tags",
    };
    const responsePhase: ChainPhase = {
      phaseIndex: 1,
      providerId: "openai",
      modelId: "gpt-4o",
      role: "response",
      outputTransform: "raw",
    };
    const { messages } = buildPhaseMessages(
      userMessages,
      [{ output: "Step 1: Consider qubits...", phase: reasoningPhase }],
      responsePhase,
    );
    expect(messages).toHaveLength(2);
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toContain("<thinking>");
    expect(messages[1].content).toContain("Step 1: Consider qubits...");
    expect(messages[1].content).toContain("</thinking>");
  });

  it("injects system_prompt transform into systemPrompt", () => {
    const contextPhase: ChainPhase = {
      phaseIndex: 0,
      providerId: "a",
      modelId: "m",
      role: "custom",
      outputTransform: "system_prompt",
    };
    const responsePhase: ChainPhase = {
      phaseIndex: 1,
      providerId: "b",
      modelId: "m2",
      role: "response",
      outputTransform: "raw",
      systemPrompt: "Be concise.",
    };
    const { messages, systemPrompt } = buildPhaseMessages(
      userMessages,
      [{ output: "Background context here", phase: contextPhase }],
      responsePhase,
    );
    expect(messages).toHaveLength(1); // No assistant message injected
    expect(systemPrompt).toContain("Background context here");
    expect(systemPrompt).toContain("Be concise.");
  });

  it("injects raw output as assistant message", () => {
    const rawPhase: ChainPhase = {
      phaseIndex: 0,
      providerId: "a",
      modelId: "m",
      role: "custom",
      outputTransform: "raw",
    };
    const nextPhase: ChainPhase = {
      phaseIndex: 1,
      providerId: "b",
      modelId: "m2",
      role: "response",
      outputTransform: "raw",
    };
    const { messages } = buildPhaseMessages(
      userMessages,
      [{ output: "raw output", phase: rawPhase }],
      nextPhase,
    );
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toBe("raw output");
  });

  it("handles multiple prior phases (FR-004)", () => {
    const phase0: ChainPhase = {
      phaseIndex: 0,
      providerId: "a",
      modelId: "m1",
      role: "reasoning",
      outputTransform: "thinking_tags",
    };
    const phase1: ChainPhase = {
      phaseIndex: 1,
      providerId: "b",
      modelId: "m2",
      role: "custom",
      outputTransform: "raw",
    };
    const phase2: ChainPhase = {
      phaseIndex: 2,
      providerId: "c",
      modelId: "m3",
      role: "response",
      outputTransform: "raw",
    };
    const { messages } = buildPhaseMessages(
      userMessages,
      [
        { output: "analysis", phase: phase0 },
        { output: "refinement", phase: phase1 },
      ],
      phase2,
    );
    expect(messages).toHaveLength(3); // original + 2 assistant messages
    expect(messages[1].content).toContain("<thinking>");
    expect(messages[2].content).toBe("refinement");
  });

  it("does not mutate original messages array", () => {
    const origLen = userMessages.length;
    const phase: ChainPhase = {
      phaseIndex: 0,
      providerId: "a",
      modelId: "m",
      role: "reasoning",
      outputTransform: "thinking_tags",
    };
    buildPhaseMessages(
      userMessages,
      [{ output: "data", phase }],
      { ...phase, phaseIndex: 1, role: "response" },
    );
    expect(userMessages).toHaveLength(origLen);
  });

  it("uses custom TransformFn for injection", () => {
    const customPhase: ChainPhase = {
      phaseIndex: 0,
      providerId: "a",
      modelId: "m",
      role: "custom",
      outputTransform: (output, idx) => `<<phase-${idx}: ${output}>>`,
    };
    const nextPhase: ChainPhase = {
      phaseIndex: 1,
      providerId: "b",
      modelId: "m2",
      role: "response",
      outputTransform: "raw",
    };
    const { messages } = buildPhaseMessages(
      userMessages,
      [{ output: "stuff", phase: customPhase }],
      nextPhase,
    );
    expect(messages[1].content).toBe("<<phase-0: stuff>>");
  });
});
