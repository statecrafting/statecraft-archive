import { PermissionBroker } from "./permission-broker.js";
import type {
  BridgeEvent,
  BridgeQueryOptions,
  SDKMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SessionCostSummary,
} from "./types.js";

/** Maps SDK permission mode strings to the SDK's expected values. */
const PERMISSION_MODE_MAP: Record<string, string> = {
  default: "default",
  acceptEdits: "acceptEdits",
  bypassPermissions: "bypassPermissions",
  plan: "plan",
};

/**
 * Query Claude Code via the @anthropic-ai/claude-code SDK.
 *
 * Returns an async generator of BridgeEvents (FR-001).
 * Throws if the SDK is not installed (caller should catch and fall back).
 */
export async function* queryViaSdk(
  options: BridgeQueryOptions,
): AsyncGenerator<BridgeEvent> {
  // Dynamic import — throws if the SDK package is absent (FR-008 trigger).
  // The module specifier is assigned to a variable so TypeScript does not
  // attempt static resolution of the optional peer dependency.
  const sdkModule: string = "@anthropic-ai/claude-code";
  const sdk = await import(/* webpackIgnore: true */ sdkModule);
  const query = sdk.query ?? (sdk as any).default?.query;
  if (typeof query !== "function") {
    throw new Error("@anthropic-ai/claude-code does not export query()");
  }

  const broker = new PermissionBroker();

  // Build SDK query options (FR-002, FR-003, FR-005).
  const queryOptions: Record<string, unknown> = {
    prompt: options.prompt,
    cwd: options.workingDirectory,
    abortController: options.abortController, // FR-006
    permissionMode:
      PERMISSION_MODE_MAP[options.permissionMode ?? "default"] ?? "default",
  };

  if (options.model) queryOptions.model = options.model;
  if (options.sessionId) queryOptions.resume = options.sessionId; // FR-003
  if (options.allowedTools) queryOptions.allowedTools = options.allowedTools;
  if (options.disallowedTools)
    queryOptions.disallowedTools = options.disallowedTools;
  if (options.systemPrompt) queryOptions.systemPrompt = options.systemPrompt;

  // FR-004: wire canUseTool through PermissionBroker or direct callback.
  if (options.canUseTool) {
    const userCallback = options.canUseTool;
    queryOptions.canUseTool = async (
      toolName: string,
      toolInput: Record<string, unknown>,
    ) => userCallback(toolName, toolInput);
  }

  // OAuth token passthrough via environment variable.
  if (options.oauthToken) {
    queryOptions.env = {
      ...((queryOptions.env as Record<string, string>) ?? {}),
      CLAUDE_OAUTH_TOKEN: options.oauthToken,
    };
  }

  // Expose the broker so the caller can wire IPC-based permission responses.
  // Attach it to the generator for external access.
  const gen = queryImpl(
    query as (opts: Record<string, unknown>) => AsyncGenerator<unknown>,
    queryOptions,
    broker,
    options.abortController,
  );
  (gen as any).__permissionBroker = broker;
  yield* gen;
}

async function* queryImpl(
  query: (opts: Record<string, unknown>) => AsyncGenerator<unknown>,
  queryOptions: Record<string, unknown>,
  broker: PermissionBroker,
  abortController?: AbortController,
): AsyncGenerator<BridgeEvent> {
  let sessionId = "";

  try {
    const stream = query(queryOptions);

    for await (const raw of stream) {
      const msg = raw as SDKMessage;

      // Extract session ID from init message.
      if (msg.type === "system" && (msg as SDKSystemMessage).session_id) {
        sessionId = (msg as SDKSystemMessage).session_id;
        yield { kind: "start", sessionId };
      }

      // Wrap SDK messages in BridgeMessageEvent envelope.
      if (msg.type === "system" || msg.type === "user" || msg.type === "assistant") {
        yield { kind: "message", message: msg as any };
      }

      // FR-007: emit session-complete on result message.
      if (msg.type === "result") {
        const result = msg as SDKResultMessage;
        sessionId = result.session_id || sessionId;
        const summary: SessionCostSummary = {
          sessionId,
          totalCostUsd: result.total_cost_usd ?? 0,
          inputTokens: result.total_input_tokens ?? 0,
          outputTokens: result.total_output_tokens ?? 0,
          numTurns: result.num_turns ?? 0,
          durationMs: result.duration_ms ?? 0,
          isError: result.subtype === "error",
        };
        yield { kind: "session-complete", summary };
      }
    }
  } catch (err: unknown) {
    broker.denyAll();

    const message = err instanceof Error ? err.message : String(err);
    const isAbort =
      abortController?.signal.aborted ||
      message.includes("abort") ||
      message.includes("cancel");

    if (!isAbort) {
      yield { kind: "error", error: message, fatal: true };
    }

    // Always emit session-complete so consumers get a terminal event.
    if (sessionId) {
      yield {
        kind: "session-complete",
        summary: {
          sessionId,
          totalCostUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          numTurns: 0,
          durationMs: 0,
          isError: true,
        },
      };
    }
  } finally {
    broker.denyAll();
  }
}
