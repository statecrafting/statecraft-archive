import type {
  ChatCompletion,
  ChatCompletionChunk,
} from "openai/resources/chat/completions";
import type { AgentEvent, Role, TokenUsage } from "../types.js";

/**
 * Stateful normalizer: OpenAI Chat Completions SSE chunks → {@link AgentEvent} (FR-003).
 * Instantiate one per streaming request. Expects `stream_options: { include_usage: true }`
 * so a terminal usage chunk arrives (when the stream completes normally).
 */
export class OpenAIStreamNormalizer {
  private messageStarted = false;
  private model = "";
  private lastFinishReason: string | null = null;
  private usageEmitted = false;
  private readonly toolAcc = new Map<
    number,
    { id: string; name: string; args: string; started: boolean }
  >();

  /** Map a single streamed chunk to zero or more {@link AgentEvent}s. */
  *push(chunk: ChatCompletionChunk): Generator<AgentEvent> {
    if (chunk.model) this.model = chunk.model;

    const choice = chunk.choices[0];
    if (choice) {
      const d = choice.delta;
      if (
        !this.messageStarted &&
        (d.role === "assistant" ||
          (d.content !== undefined && d.content !== null && d.content !== "") ||
          (d.tool_calls !== undefined && d.tool_calls.length > 0))
      ) {
        yield {
          type: "message_start",
          role: "assistant" as Role,
          model: this.model || chunk.model,
        };
        this.messageStarted = true;
      }

      if (d.content) {
        yield { type: "text_delta", delta: d.content };
      }

      if (d.tool_calls?.length) {
        yield* this.consumeToolCallDeltas(d.tool_calls);
      }

      if (choice.finish_reason) {
        this.lastFinishReason = choice.finish_reason;
        if (choice.finish_reason === "tool_calls") {
          yield* this.finalizeToolCalls();
        }
      }
    }

    if (chunk.usage !== undefined && chunk.usage !== null && !this.usageEmitted) {
      this.usageEmitted = true;
      yield {
        type: "message_complete",
        stopReason: this.lastFinishReason ?? "stop",
        usage: completionUsageToTokenUsage(chunk.usage),
      };
    }
  }

  private *consumeToolCallDeltas(
    toolCalls: NonNullable<ChatCompletionChunk.Choice.Delta["tool_calls"]>,
  ): Generator<AgentEvent> {
    for (const tc of toolCalls) {
      const idx = tc.index;
      let st = this.toolAcc.get(idx);
      if (!st) {
        st = { id: "", name: "", args: "", started: false };
        this.toolAcc.set(idx, st);
      }
      if (tc.id) st.id = tc.id;
      if (tc.function?.name) st.name = tc.function.name;
      if (tc.function?.arguments) {
        st.args += tc.function.arguments;
      }

      if (st.id && st.name && !st.started) {
        yield {
          type: "tool_use_start",
          toolCallId: st.id,
          toolName: st.name,
        };
        st.started = true;
      }

      if (tc.function?.arguments && st.started) {
        yield {
          type: "tool_use_delta",
          toolCallId: st.id,
          delta: tc.function.arguments,
        };
      }
    }
  }

  private *finalizeToolCalls(): Generator<AgentEvent> {
    const entries = [...this.toolAcc.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, st] of entries) {
      if (st.id && st.name && !st.started) {
        yield {
          type: "tool_use_start",
          toolCallId: st.id,
          toolName: st.name,
        };
        st.started = true;
      }
      let input: unknown = {};
      if (st.args.length > 0) {
        try {
          input = JSON.parse(st.args) as unknown;
        } catch {
          input = st.args;
        }
      }
      if (st.id) {
        yield { type: "tool_use_complete", toolCallId: st.id, input };
      }
    }
    this.toolAcc.clear();
  }
}

function completionUsageToTokenUsage(
  u: NonNullable<ChatCompletionChunk["usage"]>,
): TokenUsage {
  return {
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
  };
}

/** Non-streaming {@link ChatCompletion} → {@link AgentEvent} sequence. */
export function completionToAgentEvents(completion: ChatCompletion): AgentEvent[] {
  const choice = completion.choices[0];
  if (!choice) {
    return [
      {
        type: "error",
        code: "empty_completion",
        message: "OpenAI chat completion returned no choices.",
        retryable: false,
      },
    ];
  }

  const msg = choice.message;
  const out: AgentEvent[] = [
    {
      type: "message_start",
      role: "assistant" as Role,
      model: completion.model,
    },
  ];

  if (msg.content) {
    out.push({ type: "text_complete", text: msg.content });
  }

  if (msg.tool_calls?.length) {
    for (const tc of msg.tool_calls) {
      if (tc.type !== "function") continue;
      out.push({
        type: "tool_use_start",
        toolCallId: tc.id,
        toolName: tc.function.name,
      });
      let input: unknown = {};
      const raw = tc.function.arguments ?? "{}";
      try {
        input = JSON.parse(raw) as unknown;
      } catch {
        input = raw;
      }
      out.push({
        type: "tool_use_complete",
        toolCallId: tc.id,
        input,
      });
    }
  }

  out.push({
    type: "message_complete",
    stopReason: choice.finish_reason ?? "stop",
    usage: {
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    },
  });

  return out;
}
