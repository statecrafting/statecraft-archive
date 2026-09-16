import { describe, expect, it } from "vitest";
import type { ConverseStreamOutput } from "@aws-sdk/client-bedrock-runtime";
import type { AgentEvent } from "../types.js";
import { BedrockStreamNormalizer } from "./bedrock-events.js";

describe("BedrockStreamNormalizer", () => {
  it("maps messageStart, text deltas, metadata to message_complete", () => {
    const events: ConverseStreamOutput[] = [
      {
        messageStart: { role: "assistant" },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { text: "Hi" },
        },
      },
      {
        messageStop: { stopReason: "end_turn" },
      },
      {
        metadata: {
          usage: {
            inputTokens: 4,
            outputTokens: 2,
            totalTokens: 6,
          },
          metrics: { latencyMs: 100 },
        },
      },
    ];

    const n = new BedrockStreamNormalizer();
    n.setModelLabel("us.anthropic.claude-3-5-sonnet-20241022-v2:0");
    const out: AgentEvent[] = [];
    for (const e of events) {
      out.push(...Array.from(n.push(e)));
    }

    expect(out.map((e) => e.type)).toEqual([
      "message_start",
      "text_delta",
      "message_complete",
    ]);
    expect(out[2]).toMatchObject({
      type: "message_complete",
      stopReason: "end_turn",
      usage: { inputTokens: 4, outputTokens: 2 },
    });
  });
});
