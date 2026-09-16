import type { BridgeEvent } from "./types.js";

/**
 * Maps spec 045 {@link BridgeEvent} values to JSONL lines compatible with the
 * desktop `claude-output` / `useClaudeMessages` path (stream-json shape).
 */
export function bridgeEventToClaudeOutputLines(event: BridgeEvent): string[] {
  switch (event.kind) {
    case "start":
      return [];
    case "message":
      return [JSON.stringify(event.message)];
    case "permission-request":
      return [
        JSON.stringify({
          type: "bridge_permission_request",
          request_id: event.requestId,
          tool_name: event.toolName,
          tool_input: event.toolInput,
        }),
      ];
    case "session-complete": {
      const s = event.summary;
      return [
        JSON.stringify({
          type: "result",
          subtype: s.isError ? "error" : "success",
          session_id: s.sessionId,
          total_cost_usd: s.totalCostUsd,
          total_input_tokens: s.inputTokens,
          total_output_tokens: s.outputTokens,
          num_turns: s.numTurns,
          duration_ms: s.durationMs,
          duration_api_ms: 0,
        }),
      ];
    }
    case "error":
      return [
        JSON.stringify({
          type: "error",
          error: event.error,
          fatal: event.fatal,
        }),
      ];
    default: {
      const _never: never = event;
      return _never;
    }
  }
}
