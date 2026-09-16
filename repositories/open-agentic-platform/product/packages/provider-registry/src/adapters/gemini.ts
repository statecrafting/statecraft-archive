import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  Content,
  FunctionDeclaration,
  Part,
  Tool,
} from "@google/generative-ai";
import { randomUUID } from "node:crypto";
import {
  GeminiStreamNormalizer,
  generateContentResponseToAgentEvents,
} from "../normalization/gemini-events.js";
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
  maxContextTokens: 1_000_000,
};

/**
 * Factory for a Google Gemini provider (spec 042 Phase 5).
 */
export function createGeminiProvider(config: ProviderConfig): Provider {
  return new GeminiProvider(config);
}

class GeminiProvider implements Provider {
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

  private genAI(apiKey: string): GoogleGenerativeAI {
    return new GoogleGenerativeAI(apiKey);
  }

  private requireKey(override?: Partial<ProviderConfig>): string {
    const key = override?.apiKey ?? this.base.apiKey;
    if (!key?.trim()) {
      throw new ProviderError(
        "Google AI API key is missing (ProviderConfig.apiKey).",
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
    const modelId = params.model ?? session.model;
    try {
      const model = this.genAI(apiKey).getGenerativeModel({
        model: modelId,
        systemInstruction: params.systemPrompt?.trim(),
        tools: toGeminiTools(params),
        generationConfig: {
          maxOutputTokens: params.maxTokens ?? 8192,
          temperature: params.temperature,
        },
      });
      const req = { contents: toGeminiContents(params) };
      const result = await model.generateContent(req, {
        signal: params.signal,
      });
      return generateContentResponseToAgentEvents(result.response, modelId);
    } catch (e) {
      throw toProviderError(e);
    }
  }

  async *stream(
    session: AgentSession,
    params: QueryParams,
  ): AsyncIterable<AgentEvent> {
    const apiKey = this.requireKey();
    const modelId = params.model ?? session.model;
    const ac = new AbortController();
    this.inflight.set(session.sessionId, ac);
    const signal = params.signal
      ? mergeAbortSignals(ac.signal, params.signal)
      : ac.signal;

    try {
      const model = this.genAI(apiKey).getGenerativeModel({
        model: modelId,
        systemInstruction: params.systemPrompt?.trim(),
        tools: toGeminiTools(params),
        generationConfig: {
          maxOutputTokens: params.maxTokens ?? 8192,
          temperature: params.temperature,
        },
      });
      const streamResult = await model.generateContentStream(
        { contents: toGeminiContents(params) },
        { signal },
      );
      const normalizer = new GeminiStreamNormalizer();
      normalizer.setModelLabel(modelId);
      for await (const chunk of streamResult.stream) {
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

function toGeminiTools(params: QueryParams): Tool[] | undefined {
  if (!params.tools?.length) return undefined;
  const decls: FunctionDeclaration[] = params.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema as unknown as FunctionDeclaration["parameters"],
  }));
  return [{ functionDeclarations: decls }];
}

function toolRoleToGeminiParts(content: string | SpecContentBlock[]): Part[] {
  if (typeof content === "string") {
    return [{ text: content }];
  }
  const parts: Part[] = [];
  for (const b of content) {
    if (b.type !== "tool_result") continue;
    const toolUseId = String(
      (b as { tool_use_id?: string; toolUseId?: string }).tool_use_id ??
        (b as { toolUseId?: string }).toolUseId ??
        "",
    );
    const name = String(
      (b as { name?: string }).name ?? `tool_${toolUseId.slice(0, 12) || "call"}`,
    );
    const raw = (b as { content?: unknown }).content;
    const responseObj =
      raw !== undefined &&
      typeof raw === "object" &&
      raw !== null &&
      !Array.isArray(raw)
        ? (raw as object)
        : { result: raw };
    parts.push({
      functionResponse: {
        name,
        response: responseObj,
      },
    });
  }
  return parts;
}

function toGeminiContents(params: QueryParams): Content[] {
  const out: Content[] = [];
  for (const m of params.messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      const parts = toolRoleToGeminiParts(m.content);
      if (parts.length > 0) {
        out.push({ role: "user", parts });
      }
      continue;
    }
    const role = m.role === "assistant" ? "model" : "user";
    out.push({
      role,
      parts: toParts(m.content),
    });
  }
  return out;
}

function toParts(content: string | SpecContentBlock[]): Part[] {
  if (typeof content === "string") {
    return [{ text: content }];
  }
  const parts: Part[] = [];
  for (const b of content) {
    if (
      b.type === "text" &&
      "text" in b &&
      typeof (b as unknown as { text?: unknown }).text === "string"
    ) {
      parts.push({ text: (b as unknown as { text: string }).text });
    } else {
      parts.push({ text: JSON.stringify(b) });
    }
  }
  return parts.length > 0 ? parts : [{ text: "" }];
}

function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Error) {
    return new ProviderError(e.message, "provider_error", true);
  }
  return new ProviderError(String(e), "provider_error", false);
}
