import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { randomUUID } from "node:crypto";
import {
  completionToAgentEvents,
  OpenAIStreamNormalizer,
} from "../normalization/openai-events.js";
import type {
  AgentEvent,
  AgentSession,
  Provider,
  ProviderCapabilities,
  ProviderConfig,
  QueryParams,
} from "../types.js";
import { ProviderError } from "../types.js";

const DEFAULT_CAPS: ProviderCapabilities = {
  streaming: true,
  toolUse: true,
  vision: true,
  extendedThinking: false,
  maxContextTokens: 128_000,
};

/**
 * Factory for an OpenAI Chat Completions provider (spec 042 Phase 4).
 */
export function createOpenAIProvider(config: ProviderConfig): Provider {
  return new OpenAIChatProvider(config);
}

class OpenAIChatProvider implements Provider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities = DEFAULT_CAPS;
  private readonly base: ProviderConfig;
  private readonly inflight = new Map<string, AbortController>();

  constructor(config: ProviderConfig) {
    if (!config.id?.trim()) {
      throw new Error("ProviderConfig.id is required");
    }
    this.id = config.id;
    this.base = config;
  }

  private client(apiKey: string): OpenAI {
    return new OpenAI({
      apiKey,
      baseURL: this.base.baseUrl,
      timeout: this.base.timeoutMs,
    });
  }

  private requireKey(override?: Partial<ProviderConfig>): string {
    const key = override?.apiKey ?? this.base.apiKey;
    if (!key?.trim()) {
      throw new ProviderError(
        "OpenAI API key is missing (ProviderConfig.apiKey).",
        "missing_api_key",
        false,
      );
    }
    return key.trim();
  }

  async spawn(config?: Partial<ProviderConfig>): Promise<AgentSession> {
    this.requireKey(config);
    return {
      sessionId: randomUUID(),
      providerId: this.id,
      model: config?.defaultModel ?? this.base.defaultModel,
      createdAt: Date.now(),
    };
  }

  async query(session: AgentSession, params: QueryParams): Promise<AgentEvent[]> {
    const apiKey = this.requireKey();
    try {
      const completion = await this.client(apiKey).chat.completions.create(
        {
          model: params.model ?? session.model,
          max_tokens: params.maxTokens ?? 4096,
          messages: toOpenAIMessages(params),
          tools: toOpenAITools(params),
          temperature: params.temperature,
        },
        { signal: params.signal },
      );
      return completionToAgentEvents(completion);
    } catch (e) {
      throw toProviderError(e);
    }
  }

  async *stream(
    session: AgentSession,
    params: QueryParams,
  ): AsyncIterable<AgentEvent> {
    const apiKey = this.requireKey();
    const ac = new AbortController();
    this.inflight.set(session.sessionId, ac);
    const signal = params.signal
      ? mergeAbortSignals(ac.signal, params.signal)
      : ac.signal;

    try {
      const stream = await this.client(apiKey).chat.completions.create(
        {
          model: params.model ?? session.model,
          max_tokens: params.maxTokens ?? 4096,
          messages: toOpenAIMessages(params),
          tools: toOpenAITools(params),
          temperature: params.temperature,
          stream: true,
          stream_options: { include_usage: true },
        },
        { signal },
      );

      const normalizer = new OpenAIStreamNormalizer();
      for await (const chunk of stream) {
        yield* normalizer.push(chunk);
      }
    } catch (e) {
      throw toProviderError(e);
    } finally {
      this.inflight.delete(session.sessionId);
    }
  }

  async abort(session: AgentSession): Promise<void> {
    this.inflight.get(session.sessionId)?.abort();
  }
}

function mergeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted || b.aborted) {
    const c = new AbortController();
    c.abort();
    return c.signal;
  }
  const c = new AbortController();
  const forward = (): void => {
    c.abort();
  };
  a.addEventListener("abort", forward, { once: true });
  b.addEventListener("abort", forward, { once: true });
  return c.signal;
}

function toOpenAITools(
  params: QueryParams,
): ChatCompletionTool[] | undefined {
  if (!params.tools?.length) return undefined;
  return params.tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));
}

function toOpenAIMessages(params: QueryParams): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [];
  if (params.systemPrompt?.trim()) {
    out.push({ role: "system", content: params.systemPrompt.trim() });
  }
  for (const m of params.messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      throw new ProviderError(
        "Role 'tool' is not mapped; pass tool results as OpenAI tool messages in a future slice.",
        "unsupported_role",
        false,
      );
    }
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
    } else {
      out.push({
        role: m.role,
        content: JSON.stringify(m.content),
      });
    }
  }
  return out;
}

function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Error) {
    return new ProviderError(e.message, "provider_error", true);
  }
  return new ProviderError(String(e), "provider_error", false);
}
