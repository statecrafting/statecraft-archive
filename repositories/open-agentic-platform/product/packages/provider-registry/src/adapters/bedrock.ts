import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type {
  ContentBlock,
  ConversationRole,
  Message,
  SystemContentBlock,
  ToolConfiguration,
} from "@aws-sdk/client-bedrock-runtime";
import { randomUUID } from "node:crypto";
import {
  BedrockStreamNormalizer,
  converseResponseToAgentEvents,
} from "../normalization/bedrock-events.js";
import type {
  AgentEvent,
  AgentSession,
  ContentBlock as SpecContentBlock,
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
  maxContextTokens: 200_000,
};

/**
 * Factory for an AWS Bedrock Converse provider (spec 042 Phase 5).
 * Uses the default AWS credential provider chain and {@link ProviderConfig.extra.region}
 * (or `AWS_REGION`, default `us-east-1`).
 */
export function createBedrockProvider(config: ProviderConfig): Provider {
  return new BedrockConverseProvider(config);
}

class BedrockConverseProvider implements Provider {
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

  private region(): string {
    const r = this.base.extra?.region;
    if (typeof r === "string" && r.trim()) return r.trim();
    if (process.env.AWS_REGION?.trim()) return process.env.AWS_REGION.trim();
    return "us-east-1";
  }

  private client(): BedrockRuntimeClient {
    return new BedrockRuntimeClient({
      region: this.region(),
    });
  }

  async spawn(config?: Partial<ProviderConfig>): Promise<AgentSession> {
    const model = config?.defaultModel ?? this.base.defaultModel;
    if (!model?.trim()) {
      throw new ProviderError(
        "Bedrock model id is missing (ProviderConfig.defaultModel).",
        "missing_model",
        false,
      );
    }
    return {
      sessionId: randomUUID(),
      providerId: this.id,
      model: model.trim(),
      createdAt: Date.now(),
    };
  }

  async query(session: AgentSession, params: QueryParams): Promise<AgentEvent[]> {
    try {
      const mapped = toBedrockRequest(params);
      const res = await this.client().send(
        new ConverseCommand({
          modelId: params.model ?? session.model,
          messages: mapped.messages,
          system: mapped.system,
          inferenceConfig: {
            maxTokens: params.maxTokens ?? 4096,
            temperature: params.temperature,
          },
          toolConfig: mapped.toolConfig,
        }),
        { abortSignal: params.signal },
      );
      return converseResponseToAgentEvents(res, params.model ?? session.model);
    } catch (e) {
      throw toProviderError(e);
    }
  }

  async *stream(
    session: AgentSession,
    params: QueryParams,
  ): AsyncIterable<AgentEvent> {
    const ac = new AbortController();
    this.inflight.set(session.sessionId, ac);
    const signal = params.signal
      ? mergeAbortSignals(ac.signal, params.signal)
      : ac.signal;

    try {
      const mapped = toBedrockRequest(params);
      const out = await this.client().send(
        new ConverseStreamCommand({
          modelId: params.model ?? session.model,
          messages: mapped.messages,
          system: mapped.system,
          inferenceConfig: {
            maxTokens: params.maxTokens ?? 4096,
            temperature: params.temperature,
          },
          toolConfig: mapped.toolConfig,
        }),
        { abortSignal: signal },
      );
      const normalizer = new BedrockStreamNormalizer();
      normalizer.setModelLabel(params.model ?? session.model);
      const stream = out.stream;
      if (!stream) {
        yield {
          type: "error",
          code: "no_stream",
          message: "Bedrock ConverseStream returned no stream body.",
          retryable: true,
        };
        return;
      }
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

function toContentBlocks(content: string | SpecContentBlock[]): ContentBlock[] {
  if (typeof content === "string") {
    return [{ text: content }];
  }
  const blocks: ContentBlock[] = [];
  for (const b of content) {
    if (
      b.type === "text" &&
      "text" in b &&
      typeof (b as unknown as { text?: unknown }).text === "string"
    ) {
      blocks.push({ text: (b as unknown as { text: string }).text });
    } else {
      blocks.push({ text: JSON.stringify(b) });
    }
  }
  return blocks.length > 0 ? blocks : [{ text: "" }];
}

function toolRoleToBedrockToolResults(
  content: string | SpecContentBlock[],
): ContentBlock[] {
  if (typeof content === "string") {
    return [{ text: content }];
  }
  const out: ContentBlock[] = [];
  for (const b of content) {
    if (b.type !== "tool_result") continue;
    const toolUseId = String(
      (b as { tool_use_id?: string; toolUseId?: string }).tool_use_id ??
        (b as { toolUseId?: string }).toolUseId ??
        "",
    );
    const raw = (b as { content?: unknown }).content;
    const text =
      typeof raw === "string"
        ? raw
        : raw === undefined
          ? ""
          : JSON.stringify(raw);
    out.push({
      toolResult: {
        toolUseId,
        content: [{ text }],
      },
    });
  }
  return out;
}

function toBedrockRequest(params: QueryParams): {
  messages: Message[];
  system?: SystemContentBlock[];
  toolConfig: ToolConfiguration | undefined;
} {
  const messages: Message[] = [];
  const systemBlocks: SystemContentBlock[] = [];
  if (params.systemPrompt?.trim()) {
    systemBlocks.push({ text: params.systemPrompt.trim() });
  }
  for (const m of params.messages) {
    if (m.role === "system") {
      if (typeof m.content === "string") {
        systemBlocks.push({ text: m.content });
      } else {
        systemBlocks.push({ text: JSON.stringify(m.content) });
      }
      continue;
    }
    if (m.role === "tool") {
      const blocks = toolRoleToBedrockToolResults(m.content);
      if (blocks.length > 0) {
        messages.push({
          role: "user",
          content: blocks,
        });
      }
      continue;
    }
    const role = (m.role === "assistant" ? "assistant" : "user") as ConversationRole;
    messages.push({
      role,
      content: toContentBlocks(m.content),
    });
  }

  const toolConfig: ToolConfiguration | undefined =
    params.tools && params.tools.length > 0
      ? ({
          tools: params.tools.map((t) => ({
            toolSpec: {
              name: t.name,
              description: t.description,
              inputSchema: { json: t.inputSchema as Record<string, unknown> },
            },
          })),
        } as ToolConfiguration)
      : undefined;

  return {
    messages,
    system: systemBlocks.length > 0 ? systemBlocks : undefined,
    toolConfig,
  };
}

function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Error) {
    return new ProviderError(e.message, "provider_error", true);
  }
  return new ProviderError(String(e), "provider_error", false);
}
