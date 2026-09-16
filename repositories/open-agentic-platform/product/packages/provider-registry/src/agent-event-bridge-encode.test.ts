import { describe, expect, it } from "vitest";
import { AgentEventBridgeEncoder } from "./agent-event-bridge-encode.js";
import { bridgeEventToClaudeOutputLines } from "@opc/claude-code-bridge/claude-output-lines";

describe("AgentEventBridgeEncoder", () => {
  it("emits system init then assistant text for a minimal stream", () => {
    const enc = new AgentEventBridgeEncoder("sess-1", "/tmp/proj");
    const lines: string[] = [];
    const events = [
      { type: "message_start" as const, role: "assistant" as const, model: "m" },
      { type: "text_complete" as const, text: "hi" },
      {
        type: "message_complete" as const,
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 2 },
      },
    ];
    for (const ev of events) {
      for (const be of enc.push(ev)) {
        lines.push(...bridgeEventToClaudeOutputLines(be));
      }
    }
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed[0].type).toBe("system");
    expect(parsed[0].subtype).toBe("init");
    expect(parsed.find((p) => p.type === "assistant")?.message?.content?.[0]?.text).toBe(
      "hi",
    );
  });
});
