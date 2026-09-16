import { describe, expect, it } from "vitest";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import type { AgentEvent } from "../types.js";
import { OpenAIStreamNormalizer, completionToAgentEvents } from "./openai-events.js";

describe("OpenAIStreamNormalizer", () => {
  it("emits message_start, text_delta, message_complete when usage is on the final chunk", () => {
    const chunks: ChatCompletionChunk[] = [
      {
        id: "c1",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            delta: { role: "assistant" },
            finish_reason: null,
          },
        ],
      },
      {
        id: "c1",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            delta: { content: "Hi" },
            finish_reason: null,
          },
        ],
      },
      {
        id: "c1",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
          },
        ],
      },
      {
        id: "c1",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-4o",
        choices: [],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 2,
          total_tokens: 7,
        },
      },
    ];

    const n = new OpenAIStreamNormalizer();
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
      model: "gpt-4o",
    });
    expect(events[1]).toEqual({ type: "text_delta", delta: "Hi" });
    expect(events[2]).toMatchObject({
      type: "message_complete",
      stopReason: "stop",
      usage: { inputTokens: 5, outputTokens: 2 },
    });
  });

  it("emits message_complete when usage is on the same chunk as finish_reason", () => {
    const chunk: ChatCompletionChunk = {
      id: "c1",
      object: "chat.completion.chunk",
      created: 1,
      model: "gpt-4o-mini",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: "x" },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
      },
    };
    const n = new OpenAIStreamNormalizer();
    const events = [...n.push(chunk)];
    expect(events.map((e) => e.type)).toEqual([
      "message_start",
      "text_delta",
      "message_complete",
    ]);
  });
});

describe("completionToAgentEvents", () => {
  it("maps a non-streaming completion with text", () => {
    const events = completionToAgentEvents({
      id: "cmpl-1",
      object: "chat.completion",
      created: 0,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "Hello",
            refusal: null,
          },
          logprobs: null,
        },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    });
    expect(events.map((e) => e.type)).toEqual([
      "message_start",
      "text_complete",
      "message_complete",
    ]);
  });
});
