import { describe, expect, it } from "vitest";
import type { BridgeEvent } from "@opc/claude-code-bridge";
import {
  bridgeEventToAgentEvents,
  ClaudeCodeBridgeNormalizer,
} from "./claude-code-events.js";

describe("ClaudeCodeBridgeNormalizer", () => {
  it("maps system init then assistant text to message_start, text events, then session-complete", () => {
    const n = new ClaudeCodeBridgeNormalizer();
    const sys: BridgeEvent = {
      kind: "message",
      message: {
        type: "system",
        subtype: "init",
        session_id: "sess-1",
        tools: [],
        mcp_servers: [],
        model: "claude-3-5-sonnet",
        permission_mode: "default",
        cwd: "/tmp",
      },
    };
    expect([...n.push(sys)]).toEqual([]);

    const assistant: BridgeEvent = {
      kind: "message",
      message: {
        type: "assistant",
        session_id: "sess-1",
        message: {
          role: "assistant",
          model: "claude-3-5-sonnet",
          content: [{ type: "text", text: "Hello" }],
          usage: { input_tokens: 10, output_tokens: 2 },
        },
      },
    };
    const mid = [...n.push(assistant)];
    expect(mid).toEqual([
      { type: "message_start", role: "assistant", model: "claude-3-5-sonnet" },
      { type: "text_delta", delta: "Hello" },
      { type: "text_complete", text: "Hello" },
    ]);

    const done: BridgeEvent = {
      kind: "session-complete",
      summary: {
        sessionId: "sess-1",
        totalCostUsd: 0,
        inputTokens: 10,
        outputTokens: 2,
        numTurns: 1,
        durationMs: 100,
        isError: false,
      },
    };
    expect([...n.push(done)]).toEqual([
      {
        type: "message_complete",
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 2 },
      },
    ]);
  });

  it("maps tool_use blocks", () => {
    const n = new ClaudeCodeBridgeNormalizer();
    const assistant: BridgeEvent = {
      kind: "message",
      message: {
        type: "assistant",
        session_id: "s",
        message: {
          role: "assistant",
          model: "m",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "Read",
              input: { path: "/a" },
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
    };
    expect([...n.push(assistant)]).toEqual([
      { type: "message_start", role: "assistant", model: "m" },
      {
        type: "tool_use_start",
        toolCallId: "toolu_1",
        toolName: "Read",
      },
      {
        type: "tool_use_complete",
        toolCallId: "toolu_1",
        input: { path: "/a" },
      },
    ]);
  });

  it("bridgeEventToAgentEvents matches push for a permission-request", () => {
    const ev: BridgeEvent = {
      kind: "permission-request",
      requestId: "r1",
      toolName: "Bash",
      toolInput: {},
    };
    expect(bridgeEventToAgentEvents(ev)).toEqual([
      {
        type: "error",
        code: "permission_request",
        message: 'Tool "Bash" requires permission (request r1).',
        retryable: true,
      },
    ]);
  });
});
