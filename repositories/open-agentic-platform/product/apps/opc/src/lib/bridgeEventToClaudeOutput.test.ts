import { describe, it, expect } from "vitest";
import { bridgeEventToClaudeOutputLines } from "./bridgeEventToClaudeOutput";

describe("bridgeEventToClaudeOutputLines", () => {
  it("returns no lines for start", () => {
    expect(
      bridgeEventToClaudeOutputLines({
        kind: "start",
        sessionId: "sess-1",
      }),
    ).toEqual([]);
  });

  it("passes through SDK message JSON", () => {
    const msg = {
      type: "system" as const,
      subtype: "init" as const,
      session_id: "abc",
      tools: [],
      mcp_servers: [],
      model: "sonnet",
      permission_mode: "default",
      cwd: "/tmp",
    };
    const lines = bridgeEventToClaudeOutputLines({ kind: "message", message: msg });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual(msg);
  });

  it("maps session-complete to result line", () => {
    const lines = bridgeEventToClaudeOutputLines({
      kind: "session-complete",
      summary: {
        sessionId: "s1",
        totalCostUsd: 0.01,
        inputTokens: 10,
        outputTokens: 20,
        numTurns: 1,
        durationMs: 100,
        isError: false,
      },
    });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.type).toBe("result");
    expect(parsed.subtype).toBe("success");
    expect(parsed.session_id).toBe("s1");
    expect(parsed.total_input_tokens).toBe(10);
  });

  it("emits permission stub for UI follow-on", () => {
    const lines = bridgeEventToClaudeOutputLines({
      kind: "permission-request",
      requestId: "r1",
      toolName: "Bash",
      toolInput: { cmd: "ls" },
    });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.type).toBe("bridge_permission_request");
    expect(parsed.request_id).toBe("r1");
  });
});
