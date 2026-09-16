import { randomUUID } from "node:crypto";
import { queryClaudeCode } from "@opc/claude-code-bridge";
import type { BridgeQueryOptions } from "@opc/claude-code-bridge";
import { ClaudeCodeBridgeNormalizer } from "../normalization/claude-code-events.js";
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
  vision: false,
  extendedThinking: false,
  maxContextTokens: 200_000,
};

const DEFAULT_PROVIDER_ID = "claude-code-sdk";

/**
 * Factory for a Claude Code SDK provider backed by `@opc/claude-code-bridge` / `queryClaudeCode()` (spec 042 Phase 3).
 */
export function createClaudeCodeSdkProvider(config: ProviderConfig): Provider {
  return new ClaudeCodeSdkProvider(config);
}

class ClaudeCodeSdkProvider implements Provider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities = DEFAULT_CAPS;
  private readonly base: ProviderConfig;
  /** Local spawn id → Claude Code session id from bridge `start` (resume). */
  private readonly bridgeSessionIds = new Map<string, string>();
  private readonly inflight = new Map<string, AbortController>();

  constructor(config: ProviderConfig) {
    if (!config.id?.trim()) {
      throw new Error("ProviderConfig.id is required");
    }
    this.id = config.id;
    this.base = config;
  }

  async spawn(config?: Partial<ProviderConfig>): Promise<AgentSession> {
    return {
      sessionId: randomUUID(),
      providerId: this.id,
      model: config?.defaultModel ?? this.base.defaultModel,
      createdAt: Date.now(),
    };
  }

  async query(session: AgentSession, params: QueryParams): Promise<AgentEvent[]> {
    const normalizer = new ClaudeCodeBridgeNormalizer();
    const out: AgentEvent[] = [];
    const ac = new AbortController();
    forwardAbort(params.signal, ac);
    this.inflight.set(session.sessionId, ac);

    try {
      const opts = this.toBridgeOptions(session, params, ac);
      for await (const ev of queryClaudeCode(opts)) {
        if (ev.kind === "start" && ev.sessionId) {
          this.bridgeSessionIds.set(session.sessionId, ev.sessionId);
        }
        for (const a of normalizer.push(ev)) {
          out.push(a);
        }
      }
    } catch (e) {
      throw toProviderError(e);
    } finally {
      this.inflight.delete(session.sessionId);
    }
    return out;
  }

  async *stream(
    session: AgentSession,
    params: QueryParams,
  ): AsyncIterable<AgentEvent> {
    const normalizer = new ClaudeCodeBridgeNormalizer();
    const ac = new AbortController();
    forwardAbort(params.signal, ac);
    this.inflight.set(session.sessionId, ac);

    try {
      const opts = this.toBridgeOptions(session, params, ac);
      for await (const ev of queryClaudeCode(opts)) {
        if (ac.signal.aborted) break;
        if (ev.kind === "start" && ev.sessionId) {
          this.bridgeSessionIds.set(session.sessionId, ev.sessionId);
        }
        for (const a of normalizer.push(ev)) {
          yield a;
        }
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

  private toBridgeOptions(
    session: AgentSession,
    params: QueryParams,
    ac: AbortController,
  ): BridgeQueryOptions {
    const cwd = resolveWorkingDirectory(this.base);
    const resumeId = this.bridgeSessionIds.get(session.sessionId);
    const extra = this.base.extra ?? {};
    const canUseTool = extra.canUseTool as
      | BridgeQueryOptions["canUseTool"]
      | undefined;
    const permissionMode = extra.permissionMode as
      | BridgeQueryOptions["permissionMode"]
      | undefined;
    const allowedTools = extra.allowedTools as string[] | undefined;
    const disallowedTools = extra.disallowedTools as string[] | undefined;
    const oauthToken = extra.oauthToken as string | undefined;

    return {
      prompt: queryParamsToPrompt(params),
      workingDirectory: cwd,
      model: params.model ?? session.model,
      sessionId: resumeId,
      abortController: ac,
      permissionMode: permissionMode ?? "default",
      allowedTools,
      disallowedTools,
      systemPrompt: params.systemPrompt,
      oauthToken,
      canUseTool,
    };
  }
}

function resolveWorkingDirectory(base: ProviderConfig): string {
  const ex = base.extra ?? {};
  const cwd = ex.workingDirectory ?? ex.cwd;
  if (typeof cwd === "string" && cwd.trim()) {
    return cwd.trim();
  }
  if (typeof process !== "undefined" && typeof process.cwd === "function") {
    return process.cwd();
  }
  throw new ProviderError(
    "workingDirectory is required (ProviderConfig.extra.workingDirectory or extra.cwd), or process.cwd() must be available.",
    "missing_cwd",
    false,
  );
}

function queryParamsToPrompt(params: QueryParams): string {
  if (!params.messages?.length) {
    return "";
  }
  const lines: string[] = [];
  for (const m of params.messages) {
    if (m.role === "system") continue;
    if (typeof m.content === "string") {
      lines.push(`${m.role}: ${m.content}`);
    } else {
      lines.push(`${m.role}: ${JSON.stringify(m.content)}`);
    }
  }
  return lines.join("\n\n");
}

/** When the caller passes `params.signal`, abort the bridge controller too (FR-007). */
function forwardAbort(
  caller: AbortSignal | undefined,
  bridge: AbortController,
): void {
  if (!caller) return;
  if (caller.aborted) {
    bridge.abort();
    return;
  }
  caller.addEventListener("abort", () => bridge.abort(), { once: true });
}

function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Error) {
    return new ProviderError(e.message, "provider_error", true);
  }
  return new ProviderError(String(e), "provider_error", false);
}

/** Default id for {@link createClaudeCodeSdkProvider} when using shared factory helpers. */
export { DEFAULT_PROVIDER_ID as CLAUDE_CODE_SDK_PROVIDER_ID };
