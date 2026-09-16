import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  Tool as AnthropicTool,
} from "@anthropic-ai/sdk/resources/messages/messages.js";
import { randomUUID } from "node:crypto";
import {
  AnthropicStreamNormalizer,
  messageToAgentEvents,
} from "../normalization/anthropic-events.js";
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
  extendedThinking: true,
  maxContextTokens: 200_000,
};

/**
 * Factory for an Anthropic Messages API provider (spec 042 Phase 2).
 */
export function createAnthropicProvider(config: ProviderConfig): Provider {
  return new AnthropicMessagesProvider(config);
}

class AnthropicMessagesProvider implements Provider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities = DEFAULT_CAPS;
  private readonly base: ProviderConfig;
  /** In-flight streaming requests (FR-007 / abort). */
  private readonly inflight = new Map<string, AbortController>();

  constructor(config: ProviderConfig) {
    if (!config.id?.trim()) {
      throw new Error("ProviderConfig.id is required");
    }
    this.id = config.id;
    this.base = config;
  }

  private client(apiKey: string): Anthropic {
    return new Anthropic({
      apiKey,
      baseURL: this.base.baseUrl,
      timeout: this.base.timeoutMs,
    });
  }

  private requireKey(override?: Partial<ProviderConfig>): string {
    const key = override?.apiKey ?? this.base.apiKey;
    if (!key?.trim()) {
      throw new ProviderError(
        "Anthropic API key is missing (ProviderConfig.apiKey).",
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
      const msg = await this.client(apiKey).messages.create(
        {
          model: params.model ?? session.model,
          max_tokens: params.maxTokens ?? 4096,
          messages: toMessageParams(params),
          system: params.systemPrompt,
          tools: toTools(params),
          temperature: params.temperature,
        },
        { signal: params.signal },
      );
      return messageToAgentEvents(msg);
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
      const stream = this.client(apiKey).messages.stream(
        {
          model: params.model ?? session.model,
          max_tokens: params.maxTokens ?? 4096,
          messages: toMessageParams(params),
          system: params.systemPrompt,
          tools: toTools(params),
          temperature: params.temperature,
        },
        { signal },
      );

      const normalizer = new AnthropicStreamNormalizer();
      for await (const event of stream) {
        yield* normalizer.push(event);
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

function toTools(params: QueryParams): AnthropicTool[] | undefined {
  if (!params.tools?.length) return undefined;
  return params.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as AnthropicTool["input_schema"],
  }));
}

function toMessageParams(params: QueryParams): MessageParam[] {
  const out: MessageParam[] = [];
  for (const m of params.messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      throw new ProviderError(
        "Role 'tool' is not mapped; use user messages with tool_result content blocks.",
        "unsupported_role",
        false,
      );
    }
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
    } else {
      out.push({
        role: m.role,
        content: m.content as unknown as MessageParam["content"],
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
