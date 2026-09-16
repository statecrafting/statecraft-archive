export { bridgeEventToClaudeOutputLines } from "./claude-output-lines.js";

export type {
  BridgeEvent,
  BridgeStartEvent,
  BridgeMessageEvent,
  BridgePermissionRequestEvent,
  BridgeSessionCompleteEvent,
  BridgeErrorEvent,
  BridgeQueryOptions,
  SessionCostSummary,
  PermissionMode,
  SDKMessage,
  SDKSystemMessage,
  SDKUserMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
} from "./types.js";

export { PermissionBroker } from "./permission-broker.js";

import type { BridgeEvent, BridgeQueryOptions } from "./types.js";

/**
 * Query Claude Code via the SDK when available, falling back to the CLI
 * subprocess adapter when the SDK package is not installed (FR-001, FR-008).
 *
 * Returns an async generator that yields typed {@link BridgeEvent} objects.
 * The final event is always `session-complete`.
 */
export async function* queryClaudeCode(
  options: BridgeQueryOptions,
): AsyncGenerator<BridgeEvent> {
  try {
    // Attempt SDK path first.
    const { queryViaSdk } = await import("./sdk-adapter.js");
    yield* queryViaSdk(options);
  } catch (err: unknown) {
    // If the SDK import itself failed, fall back to CLI.
    const isSdkMissing =
      err instanceof Error &&
      (err.message.includes("Cannot find module") ||
        err.message.includes("MODULE_NOT_FOUND") ||
        err.message.includes("does not export query"));

    if (isSdkMissing) {
      const { queryViaCli } = await import("./cli-adapter.js");
      yield* queryViaCli(options);
    } else {
      // SDK was found but query() threw a runtime error — re-throw as event.
      const message = err instanceof Error ? err.message : String(err);
      yield { kind: "error", error: message, fatal: true };
    }
  }
}
