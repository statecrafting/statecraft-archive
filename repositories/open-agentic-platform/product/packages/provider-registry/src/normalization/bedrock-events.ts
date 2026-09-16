import type {
  ConverseResponse,
  ConverseStreamOutput,
  Message,
} from "@aws-sdk/client-bedrock-runtime";
import type { AgentEvent, Role, TokenUsage } from "../types.js";

function tokenUsageFromBedrock(u: {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
}): TokenUsage {
  return {
    inputTokens: u.inputTokens ?? 0,
    outputTokens: u.outputTokens ?? 0,
    cacheReadTokens: u.cacheReadInputTokens,
    cacheWriteTokens: u.cacheWriteInputTokens,
  };
}

/**
 * Stateful normalizer: Bedrock {@link ConverseStream} events → {@link AgentEvent} (FR-003).
 */
export class BedrockStreamNormalizer {
  private messageStarted = false;
  private modelLabel = "";
  private stopReason = "end_turn";
  private usageEmitted = false;
  private readonly toolByBlock = new Map<
    number,
    { toolUseId: string; name: string; input: string }
  >();

  setModelLabel(model: string): void {
    this.modelLabel = model;
  }

  *push(event: ConverseStreamOutput): Generator<AgentEvent> {
    if ("messageStart" in event && event.messageStart) {
      if (!this.messageStarted) {
        yield {
          type: "message_start",
          role: "assistant" as Role,
          model: this.modelLabel,
        };
        this.messageStarted = true;
      }
    }

    if ("contentBlockStart" in event && event.contentBlockStart) {
      const start = event.contentBlockStart.start;
      const idx = event.contentBlockStart.contentBlockIndex ?? 0;
      if (start && "toolUse" in start && start.toolUse) {
        const tu = start.toolUse;
        const id = tu.toolUseId ?? "tool";
        this.toolByBlock.set(idx, {
          toolUseId: id,
          name: tu.name ?? "unknown",
          input: "",
        });
        yield {
          type: "tool_use_start",
          toolCallId: id,
          toolName: tu.name ?? "unknown",
        };
      }
    }

    if ("contentBlockDelta" in event && event.contentBlockDelta) {
      const delta = event.contentBlockDelta.delta;
      const idx = event.contentBlockDelta.contentBlockIndex ?? 0;
      if (delta && "text" in delta && delta.text) {
        yield { type: "text_delta", delta: delta.text };
      }
      if (delta && "toolUse" in delta && delta.toolUse?.input) {
        const acc = this.toolByBlock.get(idx);
        if (acc) {
          acc.input += delta.toolUse.input;
          yield {
            type: "tool_use_delta",
            toolCallId: acc.toolUseId,
            delta: delta.toolUse.input,
          };
        }
      }
    }

    if ("contentBlockStop" in event && event.contentBlockStop) {
      const idx = event.contentBlockStop.contentBlockIndex ?? 0;
      const acc = this.toolByBlock.get(idx);
      if (acc) {
        let input: unknown = {};
        if (acc.input.length > 0) {
          try {
            input = JSON.parse(acc.input) as unknown;
          } catch {
            input = acc.input;
          }
        }
        yield {
          type: "tool_use_complete",
          toolCallId: acc.toolUseId,
          input,
        };
        this.toolByBlock.delete(idx);
      }
    }

    if ("messageStop" in event && event.messageStop?.stopReason) {
      this.stopReason = String(event.messageStop.stopReason);
    }

    if (
      "metadata" in event &&
      event.metadata?.usage !== undefined &&
      event.metadata.usage !== null &&
      !this.usageEmitted
    ) {
      this.usageEmitted = true;
      yield {
        type: "message_complete",
        stopReason: this.stopReason,
        usage: tokenUsageFromBedrock(event.metadata.usage),
      };
    }
  }
}

function messageToAgentEvents(msg: Message, modelId: string): AgentEvent[] {
  const out: AgentEvent[] = [
    {
      type: "message_start",
      role: "assistant" as Role,
      model: modelId,
    },
  ];

  const blocks = msg.content ?? [];
  for (const block of blocks) {
    if ("text" in block && block.text !== undefined) {
      out.push({ type: "text_complete", text: block.text });
    }
    if ("toolUse" in block && block.toolUse) {
      const tu = block.toolUse;
      const id = tu.toolUseId ?? "tool";
      out.push({
        type: "tool_use_start",
        toolCallId: id,
        toolName: tu.name ?? "unknown",
      });
      out.push({
        type: "tool_use_complete",
        toolCallId: id,
        input: (tu.input ?? {}) as unknown,
      });
    }
  }

  return out;
}

/** Non-streaming {@link ConverseResponse} → {@link AgentEvent} sequence. */
export function converseResponseToAgentEvents(
  response: ConverseResponse,
  modelId: string,
): AgentEvent[] {
  const out = messageToAgentEventsFromOutput(
    response.output,
    modelId,
    response.stopReason,
    response.usage,
  );
  return out;
}

function messageToAgentEventsFromOutput(
  output: ConverseResponse["output"],
  modelId: string,
  stopReason: ConverseResponse["stopReason"],
  usage: ConverseResponse["usage"],
): AgentEvent[] {
  if (!output || !("message" in output) || !output.message) {
    return [
      {
        type: "error",
        code: "empty_output",
        message: "Bedrock Converse returned no assistant message.",
        retryable: false,
      },
    ];
  }

  const msg = output.message;
  const events = messageToAgentEvents(msg, modelId);
  events.push({
    type: "message_complete",
    stopReason: stopReason !== undefined ? String(stopReason) : "end_turn",
    usage: usage
      ? tokenUsageFromBedrock(usage)
      : { inputTokens: 0, outputTokens: 0 },
  });
  return events;
}

/** Map a completed assistant {@link Message} (e.g. from tests) to events + completion. */
export function bedrockMessageToAgentEvents(
  msg: Message,
  modelId: string,
  stopReason: string,
  usage: TokenUsage,
): AgentEvent[] {
  const events = messageToAgentEvents(msg, modelId);
  events.push({
    type: "message_complete",
    stopReason,
    usage,
  });
  return events;
}
