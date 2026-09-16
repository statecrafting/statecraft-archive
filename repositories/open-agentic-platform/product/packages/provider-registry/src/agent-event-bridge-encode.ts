import type {
  BridgeEvent,
  SDKAssistantMessage,
  SDKSystemMessage,
  TextBlock,
  ToolUseBlock,
} from "@opc/claude-code-bridge/types";
import { bridgeEventToClaudeOutputLines } from "@opc/claude-code-bridge/claude-output-lines";
import type { AgentEvent } from "./types.js";

/**
 * Stateful encoder: spec 042 {@link AgentEvent} stream → 045 {@link BridgeEvent} → JSONL lines
 * for `claude-output` consumers (same contract as the Claude Code bridge sidecar).
 */
export class AgentEventBridgeEncoder {
  private readonly sessionId: string;
  private readonly cwd: string;
  private model = "claude";
  private emittedSystemInit = false;
  private readonly toolInputById = new Map<string, string>();
  private readonly toolNameById = new Map<string, string>();

  constructor(sessionId: string, cwd: string) {
    this.sessionId = sessionId;
    this.cwd = cwd;
  }

  *push(ev: AgentEvent): Generator<BridgeEvent> {
    switch (ev.type) {
      case "message_start": {
        if (ev.model?.trim()) {
          this.model = ev.model.trim();
        }
        if (!this.emittedSystemInit) {
          this.emittedSystemInit = true;
          const sys: SDKSystemMessage = {
            type: "system",
            subtype: "init",
            session_id: this.sessionId,
            tools: [],
            mcp_servers: [],
            model: this.model,
            permission_mode: "default",
            cwd: this.cwd,
          };
          yield { kind: "message", message: sys };
        }
        return;
      }
      case "text_delta":
        return;
      case "text_complete": {
        const text = ev.text ?? "";
        if (text.length === 0) return;
        const msg: SDKAssistantMessage = {
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text } satisfies TextBlock],
            model: this.model,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
          session_id: this.sessionId,
        };
        yield { kind: "message", message: msg };
        return;
      }
      case "tool_use_start": {
        this.toolNameById.set(ev.toolCallId, ev.toolName);
        this.toolInputById.set(ev.toolCallId, "");
        return;
      }
      case "tool_use_delta": {
        const prev = this.toolInputById.get(ev.toolCallId) ?? "";
        this.toolInputById.set(ev.toolCallId, prev + ev.delta);
        return;
      }
      case "tool_use_complete": {
        const name = this.toolNameById.get(ev.toolCallId) ?? "tool";
        let input: Record<string, unknown> = {};
        const buf = this.toolInputById.get(ev.toolCallId) ?? "";
        if (buf.length > 0) {
          try {
            input = JSON.parse(buf) as Record<string, unknown>;
          } catch {
            input = { raw: buf };
          }
        }
        const block: ToolUseBlock = {
          type: "tool_use",
          id: ev.toolCallId,
          name,
          input,
        };
        const msg: SDKAssistantMessage = {
          type: "assistant",
          message: {
            role: "assistant",
            content: [block],
            model: this.model,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
          session_id: this.sessionId,
        };
        yield { kind: "message", message: msg };
        this.toolInputById.delete(ev.toolCallId);
        this.toolNameById.delete(ev.toolCallId);
        return;
      }
      case "message_complete": {
        const u = ev.usage;
        yield {
          kind: "session-complete",
          summary: {
            sessionId: this.sessionId,
            totalCostUsd: 0,
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            numTurns: 1,
            durationMs: 0,
            isError: false,
          },
        };
        return;
      }
      case "error": {
        yield {
          kind: "error",
          error: ev.message,
          fatal: !ev.retryable,
        };
        return;
      }
      case "thinking_delta":
      case "thinking_complete":
      case "tool_result":
        return;
    }
  }
}
