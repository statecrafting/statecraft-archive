import { describe, expect, it } from "vitest";
import type { GenerateContentResponse } from "@google/generative-ai";
import type { AgentEvent } from "../types.js";
import {
  GeminiStreamNormalizer,
  generateContentResponseToAgentEvents,
} from "./gemini-events.js";

describe("GeminiStreamNormalizer", () => {
  it("emits message_start, text deltas, message_complete with usage", () => {
    const chunks: GenerateContentResponse[] = [
      {
        candidates: [
          {
            index: 0,
            content: { role: "model", parts: [{ text: "Hi" }] },
            finishReason: "STOP",
          },
        ],
      },
      {
        usageMetadata: {
          promptTokenCount: 3,
          candidatesTokenCount: 2,
          totalTokenCount: 5,
        },
      },
    ];

    const n = new GeminiStreamNormalizer();
    n.setModelLabel("gemini-2.0-flash");
    const events: AgentEvent[] = [];
    for (const c of chunks) {
      events.push(...Array.from(n.push(c)));
    }

    expect(events.map((e) => e.type)).toEqual([
      "message_start",
      "text_delta",
      "message_complete",
    ]);
    expect(events[0]).toMatchObject({
      type: "message_start",
      model: "gemini-2.0-flash",
    });
    expect(events[1]).toEqual({ type: "text_delta", delta: "Hi" });
    expect(events[2]).toMatchObject({
      type: "message_complete",
      stopReason: "STOP",
      usage: { inputTokens: 3, outputTokens: 2 },
    });
  });
});

describe("generateContentResponseToAgentEvents", () => {
  it("maps a non-streaming response with text", () => {
    const res: GenerateContentResponse = {
      candidates: [
        {
          index: 0,
          content: {
            role: "model",
            parts: [{ text: "Hello" }],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 1,
        totalTokenCount: 2,
      },
    };
    const events = generateContentResponseToAgentEvents(res, "gemini-2.0-flash");
    expect(events.map((e) => e.type)).toEqual([
      "message_start",
      "text_complete",
      "message_complete",
    ]);
  });
});
