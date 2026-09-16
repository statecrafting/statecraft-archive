import type {
  FunctionCall,
  FunctionCallPart,
  GenerateContentResponse,
  TextPart,
} from "@google/generative-ai";
import type { AgentEvent, Role, TokenUsage } from "../types.js";

function isTextPart(p: unknown): p is TextPart {
  return (
    typeof p === "object" &&
    p !== null &&
    "text" in p &&
    typeof (p as TextPart).text === "string"
  );
}

function isFunctionCallPart(p: unknown): p is FunctionCallPart {
  return (
    typeof p === "object" &&
    p !== null &&
    "functionCall" in p &&
    typeof (p as FunctionCallPart).functionCall === "object" &&
    (p as FunctionCallPart).functionCall !== null
  );
}

function usageFromResponse(
  u: NonNullable<GenerateContentResponse["usageMetadata"]>,
): TokenUsage {
  return {
    inputTokens: u.promptTokenCount ?? 0,
    outputTokens: u.candidatesTokenCount ?? 0,
    cacheReadTokens: u.cachedContentTokenCount,
  };
}

/**
 * Stateful normalizer: Gemini streaming chunks → {@link AgentEvent} (FR-003).
 */
export class GeminiStreamNormalizer {
  private messageStarted = false;
  private modelLabel = "";
  private usageEmitted = false;
  private lastStopReason = "stop";
  private toolSeq = 0;

  /** Map one streamed {@link GenerateContentResponse} chunk to events. */
  *push(chunk: GenerateContentResponse): Generator<AgentEvent> {
    const cand = chunk.candidates?.[0];
    if (cand?.content?.parts?.length) {
      for (const part of cand.content.parts) {
        if (isTextPart(part) && part.text) {
          if (!this.messageStarted) {
            yield {
              type: "message_start",
              role: "assistant" as Role,
              model: this.modelLabel,
            };
            this.messageStarted = true;
          }
          yield { type: "text_delta", delta: part.text };
        } else if (isFunctionCallPart(part)) {
          yield* this.emitFunctionCall(part.functionCall);
        }
      }
    }

    if (cand?.finishReason) {
      this.lastStopReason = String(cand.finishReason);
    }

    if (
      chunk.usageMetadata !== undefined &&
      chunk.usageMetadata !== null &&
      !this.usageEmitted
    ) {
      this.usageEmitted = true;
      yield {
        type: "message_complete",
        stopReason: this.lastStopReason,
        usage: usageFromResponse(chunk.usageMetadata),
      };
    }
  }

  /** Call once if the model id is known before streaming (improves message_start). */
  setModelLabel(model: string): void {
    this.modelLabel = model;
  }

  private *emitFunctionCall(fc: FunctionCall): Generator<AgentEvent> {
    this.toolSeq += 1;
    const name = fc.name ?? "unknown";
    const id = `gemini-${this.toolSeq}-${name}`;
    if (!this.messageStarted) {
      yield {
        type: "message_start",
        role: "assistant" as Role,
        model: this.modelLabel,
      };
      this.messageStarted = true;
    }
    yield { type: "tool_use_start", toolCallId: id, toolName: name };
    const args = fc.args as Record<string, unknown> | undefined;
    yield {
      type: "tool_use_complete",
      toolCallId: id,
      input: args ?? {},
    };
  }
}

/** Non-streaming {@link GenerateContentResponse} → {@link AgentEvent} sequence. */
export function generateContentResponseToAgentEvents(
  response: GenerateContentResponse,
  model: string,
): AgentEvent[] {
  const out: AgentEvent[] = [
    {
      type: "message_start",
      role: "assistant" as Role,
      model,
    },
  ];

  const cand = response.candidates?.[0];
  const parts = cand?.content?.parts ?? [];

  let fnIdx = 0;
  for (const part of parts) {
    if (isTextPart(part) && part.text) {
      out.push({ type: "text_complete", text: part.text });
    } else if (isFunctionCallPart(part)) {
      const fc = part.functionCall;
      fnIdx += 1;
      const id = `gemini-${fnIdx}-${fc.name ?? "fn"}`;
      out.push({
        type: "tool_use_start",
        toolCallId: id,
        toolName: fc.name ?? "unknown",
      });
      const args = fc.args as Record<string, unknown> | undefined;
      out.push({
        type: "tool_use_complete",
        toolCallId: id,
        input: args ?? {},
      });
    }
  }

  const stop =
    cand?.finishReason !== undefined
      ? String(cand.finishReason)
      : "stop";
  const usage: TokenUsage = response.usageMetadata
    ? usageFromResponse(response.usageMetadata)
    : { inputTokens: 0, outputTokens: 0 };

  out.push({
    type: "message_complete",
    stopReason: stop,
    usage,
  });

  return out;
}
