import { describe, expect, it } from "vitest";
import type { RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/messages/messages.js";
import type { AgentEvent } from "../types.js";
import { AnthropicStreamNormalizer } from "./anthropic-events.js";

describe("AnthropicStreamNormalizer", () => {
  it("emits message_start then text_delta then message_complete", () => {
    const n = new AnthropicStreamNormalizer();
    const events: AgentEvent[] = [];

    const raw: RawMessageStreamEvent[] = [
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-sonnet-4-20250514",
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 1,
            output_tokens: 0,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            cache_creation: null,
            server_tool_use: null,
            service_tier: null,
            inference_geo: null,
          },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "", citations: null },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hi" },
      },
      {
        type: "content_block_stop",
        index: 0,
      },
      {
        type: "message_delta",
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          server_tool_use: null,
        },
        delta: {
          stop_reason: "end_turn",
          stop_sequence: null,
          container: null,
        },
      },
      { type: "message_stop" },
    ];

    for (const r of raw) {
      events.push(...Array.from(n.push(r)));
    }

    expect(events.map((e) => e.type)).toEqual([
      "message_start",
      "text_delta",
      "message_complete",
    ]);
    expect(events[0]).toMatchObject({
      type: "message_start",
      model: "claude-sonnet-4-20250514",
    });
    expect(events[1]).toEqual({ type: "text_delta", delta: "Hi" });
    expect(events[2]).toMatchObject({
      type: "message_complete",
      stopReason: "end_turn",
    });
  });
});
