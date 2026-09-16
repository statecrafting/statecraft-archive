import type {
  BridgeEvent,
  SDKAssistantMessage,
  SDKSystemMessage,
  TextBlock,
  ToolUseBlock,
} from "@opc/claude-code-bridge";
import type { AgentEvent, Role, TokenUsage } from "../types.js";

/**
 * Mutable state for {@link ClaudeCodeBridgeNormalizer} (maps BridgeEvent → AgentEvent, FR-003).
 */
export interface ClaudeCodeNormalizerState {
  /** Model from the latest `system` init message (used if assistant omits model). */
  modelHint: string;
}

function emptyState(): ClaudeCodeNormalizerState {
  return { modelHint: "" };
}

/**
 * Stateful normalizer: one instance per `queryClaudeCode()` stream.
 * Emits `message_complete` only on `session-complete` (aggregate usage from the bridge).
 */
export class ClaudeCodeBridgeNormalizer {
  private state: ClaudeCodeNormalizerState = emptyState();

  reset(): void {
    this.state = emptyState();
  }

  /** Map a single {@link BridgeEvent} to zero or more {@link AgentEvent}s. */
  *push(ev: BridgeEvent): Generator<AgentEvent> {
    yield* mapBridgeEvent(ev, this.state);
  }
}

/**
 * Stateless mapping for tests and one-shot expansion (uses fresh state each call).
 */
export function bridgeEventToAgentEvents(ev: BridgeEvent): AgentEvent[] {
  const st = emptyState();
  return [...mapBridgeEvent(ev, st)];
}

function* mapBridgeEvent(
  ev: BridgeEvent,
  state: ClaudeCodeNormalizerState,
): Generator<AgentEvent> {
  switch (ev.kind) {
    case "start":
      return;
    case "message": {
      const msg = ev.message;
      if (msg.type === "system") {
        const sys = msg as SDKSystemMessage;
        if (sys.subtype === "init" && sys.model) {
          state.modelHint = sys.model;
        }
        return;
      }
      if (msg.type === "user") {
        return;
      }
      if (msg.type === "assistant") {
        yield* assistantMessageToEvents(msg as SDKAssistantMessage, state);
      }
      return;
    }
    case "permission-request": {
      yield {
        type: "error",
        code: "permission_request",
        message: `Tool "${ev.toolName}" requires permission (request ${ev.requestId}).`,
        retryable: true,
      };
      return;
    }
    case "session-complete": {
      const u = ev.summary;
      const usage: TokenUsage = {
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
      };
      yield {
        type: "message_complete",
        stopReason: u.isError ? "error" : "end_turn",
        usage,
      };
      return;
    }
    case "error": {
      yield {
        type: "error",
        code: ev.fatal ? "bridge_fatal" : "bridge_error",
        message: ev.error,
        retryable: !ev.fatal,
      };
      return;
    }
  }
}

function* assistantMessageToEvents(
  msg: SDKAssistantMessage,
  state: ClaudeCodeNormalizerState,
): Generator<AgentEvent> {
  const model =
    msg.message.model?.trim() || state.modelHint.trim() || "claude";
  yield { type: "message_start", role: "assistant" as Role, model };

  for (const block of msg.message.content) {
    if (block.type === "text") {
      yield* textBlockToEvents(block);
    } else if (block.type === "tool_use") {
      yield* toolUseBlockToEvents(block);
    }
  }
}

function* textBlockToEvents(block: TextBlock): Generator<AgentEvent> {
  const text = block.text ?? "";
  if (text.length > 0) {
    yield { type: "text_delta", delta: text };
  }
  yield { type: "text_complete", text };
}

function* toolUseBlockToEvents(block: ToolUseBlock): Generator<AgentEvent> {
  yield {
    type: "tool_use_start",
    toolCallId: block.id,
    toolName: block.name,
  };
  yield {
    type: "tool_use_complete",
    toolCallId: block.id,
    input: block.input ?? {},
  };
}
