import type {
  ContentBlock,
  Message,
  RawContentBlockDeltaEvent,
  RawContentBlockStartEvent,
  RawContentBlockStopEvent,
  RawMessageDeltaEvent,
  RawMessageStartEvent,
  RawMessageStreamEvent,
} from "@anthropic-ai/sdk/resources/messages/messages.js";
import type { AgentEvent, TokenUsage } from "../types.js";

/**
 * Stateful normalizer: Anthropic {@link RawMessageStreamEvent} → {@link AgentEvent} (FR-003).
 * Instantiate one per streaming request.
 */
export class AnthropicStreamNormalizer {
  private toolInputByIndex = new Map<number, string>();
  private toolMetaByIndex = new Map<number, { id: string; name: string }>();
  private lastUsage: TokenUsage | null = null;
  private lastStopReason: string | null = null;

  /** Map a single raw stream event to zero or more AgentEvents. */
  *push(event: RawMessageStreamEvent): Generator<AgentEvent> {
    switch (event.type) {
      case "message_start": {
        const ev = event as RawMessageStartEvent;
        yield {
          type: "message_start",
          role: "assistant",
          model: ev.message.model,
        };
        return;
      }
      case "content_block_start": {
        const ev = event as RawContentBlockStartEvent;
        const block = ev.content_block;
        if (block.type === "tool_use") {
          this.toolMetaByIndex.set(ev.index, { id: block.id, name: block.name });
          this.toolInputByIndex.set(ev.index, "");
          yield {
            type: "tool_use_start",
            toolCallId: block.id,
            toolName: block.name,
          };
        }
        return;
      }
      case "content_block_delta": {
        const ev = event as RawContentBlockDeltaEvent;
        const d = ev.delta;
        if (d.type === "text_delta") {
          yield { type: "text_delta", delta: d.text };
        } else if (d.type === "input_json_delta") {
          const prev = this.toolInputByIndex.get(ev.index) ?? "";
          const next = prev + d.partial_json;
          this.toolInputByIndex.set(ev.index, next);
          const meta = this.toolMetaByIndex.get(ev.index);
          yield {
            type: "tool_use_delta",
            toolCallId: meta?.id ?? String(ev.index),
            delta: d.partial_json,
          };
        } else if (d.type === "thinking_delta") {
          yield { type: "thinking_delta", delta: d.thinking };
        }
        return;
      }
      case "content_block_stop": {
        const ev = event as RawContentBlockStopEvent;
        const meta = this.toolMetaByIndex.get(ev.index);
        const buf = this.toolInputByIndex.get(ev.index);
        if (meta !== undefined && buf !== undefined) {
          let input: unknown = buf;
          if (buf.length > 0) {
            try {
              input = JSON.parse(buf) as unknown;
            } catch {
              input = buf;
            }
          } else {
            input = {};
          }
          yield { type: "tool_use_complete", toolCallId: meta.id, input };
        }
        this.toolInputByIndex.delete(ev.index);
        this.toolMetaByIndex.delete(ev.index);
        return;
      }
      case "message_delta": {
        const ev = event as RawMessageDeltaEvent;
        const u = ev.usage;
        this.lastUsage = {
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens,
          cacheReadTokens: u.cache_read_input_tokens ?? undefined,
          cacheWriteTokens: u.cache_creation_input_tokens ?? undefined,
        };
        this.lastStopReason = ev.delta.stop_reason ?? null;
        return;
      }
      case "message_stop": {
        if (this.lastUsage) {
          yield {
            type: "message_complete",
            stopReason: this.lastStopReason ?? "end_turn",
            usage: this.lastUsage,
          };
        }
        return;
      }
      default:
        return;
    }
  }
}

/** Non-streaming {@link Message} → {@link AgentEvent} sequence. */
export function messageToAgentEvents(message: Message): AgentEvent[] {
  const out: AgentEvent[] = [
    {
      type: "message_start",
      role: "assistant",
      model: message.model,
    },
  ];

  for (const block of message.content) {
    out.push(...contentBlockToEvents(block));
  }

  out.push({
    type: "message_complete",
    stopReason: message.stop_reason ?? "end_turn",
    usage: usageToTokenUsage(message.usage),
  });

  return out;
}

function usageToTokenUsage(u: Message["usage"]): TokenUsage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? undefined,
    cacheWriteTokens: u.cache_creation_input_tokens ?? undefined,
  };
}

function contentBlockToEvents(block: ContentBlock): AgentEvent[] {
  switch (block.type) {
    case "text":
      return [{ type: "text_complete", text: block.text }];
    case "tool_use":
      return [
        {
          type: "tool_use_start",
          toolCallId: block.id,
          toolName: block.name,
        },
        {
          type: "tool_use_complete",
          toolCallId: block.id,
          input: block.input,
        },
      ];
    case "thinking":
      return [{ type: "thinking_complete", text: block.thinking }];
    default:
      return [];
  }
}
