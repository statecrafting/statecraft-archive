/** Identifies a registered provider. */
export type ProviderId = string;

/** Capabilities a provider may advertise. */
export interface ProviderCapabilities {
  streaming: boolean;
  toolUse: boolean;
  vision: boolean;
  extendedThinking: boolean;
  maxContextTokens: number;
}

/** Configuration supplied when registering a provider. */
export interface ProviderConfig {
  id: ProviderId;
  apiKey?: string;
  baseUrl?: string;
  defaultModel: string;
  rateLimitRpm?: number;
  timeoutMs?: number;
  extra?: Record<string, unknown>;
}

/** A session created by spawn(). */
export interface AgentSession {
  sessionId: string;
  providerId: ProviderId;
  model: string;
  createdAt: number;
}

/** Message role for normalized events. */
export type Role = "user" | "assistant" | "system" | "tool";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Normalized event emitted by all providers (FR-003). */
export type AgentEvent =
  | { type: "text_delta"; delta: string }
  | { type: "text_complete"; text: string }
  | { type: "tool_use_start"; toolCallId: string; toolName: string }
  | { type: "tool_use_delta"; toolCallId: string; delta: string }
  | { type: "tool_use_complete"; toolCallId: string; input: unknown }
  | { type: "tool_result"; toolCallId: string; output: unknown; isError: boolean }
  | { type: "thinking_delta"; delta: string }
  | { type: "thinking_complete"; text: string }
  | { type: "message_start"; role: Role; model: string }
  | {
      type: "message_complete";
      stopReason: string;
      usage: TokenUsage;
    }
  | { type: "error"; code: string; message: string; retryable: boolean };

export interface ContentBlock {
  type: "text" | "image" | "tool_use" | "tool_result";
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Query parameters for single-turn and streaming calls. */
export interface QueryParams {
  model?: string;
  messages: Array<{ role: Role; content: string | ContentBlock[] }>;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
}

/** Structured failure from providers (FR-006). */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** The interface every provider must implement (FR-002). */
export interface Provider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;

  spawn(config?: Partial<ProviderConfig>): Promise<AgentSession>;
  query(session: AgentSession, params: QueryParams): Promise<AgentEvent[]>;
  stream(session: AgentSession, params: QueryParams): AsyncIterable<AgentEvent>;
  abort(session: AgentSession): Promise<void>;
}

/** Singleton registry managing all providers (FR-001, FR-004, FR-005). */
export interface ProviderRegistry {
  register(provider: Provider): void;
  get(id: ProviderId): Provider;
  has(id: ProviderId): boolean;
  list(): Array<{ id: ProviderId; capabilities: ProviderCapabilities }>;
  unregister(id: ProviderId): boolean;
}
