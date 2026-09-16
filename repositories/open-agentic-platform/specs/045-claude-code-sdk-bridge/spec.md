---
id: "045-claude-code-sdk-bridge"
title: "Claude Code SDK bridge"
feature_branch: "045-claude-code-sdk-bridge"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
establishes:
  - unit: { kind: crate, id: "@opc/claude-code-bridge" }
extends:
  - spec: "035-agent-governed-execution"
    nature: wrapping
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/claude.rs }
summary: >
  Replace the current CLI-subprocess integration with a first-class bridge to
  the @anthropic-ai/claude-code SDK, providing typed message streaming, session
  resumption, programmatic permission control, cost tracking, and an
  AbortController-based cancellation model, while retaining the existing
  stream-JSON CLI path as a fallback for environments where the SDK is
  unavailable.
---

# Feature Specification: Claude Code SDK bridge

## Purpose

The desktop app currently communicates with Claude Code by spawning a CLI
subprocess with `--output-format stream-json` and parsing its stdout line by
line (see `commands/claude.rs: spawn_claude_process`). This works but has
significant limitations:

1. **No typed contract** -- the frontend parses raw JSONL with `(message as any).type` casts throughout `useClaudeMessages.ts`, making the protocol fragile and untyped.
2. **No programmatic permission control** -- permission handling is delegated entirely to CLI flags (`--allowedTools`, `--dangerously-skip-permissions`). There is no way for the desktop app to intercept a permission request, present a UI dialog, and respond.
3. **Coarse cancellation** -- cancellation works by killing the child process via PID, which can leave state dirty. The SDK provides an `AbortController` model that signals graceful shutdown.
4. **Session resumption by convention** -- the `--resume <id>` and `-c` flags work but session identity is inferred from the working directory. The SDK's `resume` option provides explicit, reliable session resumption.
5. **No structured cost data** -- cost and token usage are only available if the frontend happens to see a `response` message with a `usage` field. The SDK's `SDKResultMessage` guarantees `total_cost_usd`, `total_input_tokens`, `total_output_tokens`, `num_turns`, and `duration_ms` on every completed query.

This feature introduces a bridge layer (`product/packages/claude-code-bridge/`) that wraps the SDK's `query()` function behind a well-typed interface consumed by both the Tauri backend (via a sidecar Node process or embedded runtime) and, optionally, the web-server mode.

## Scope

### In scope

- **SDK query() integration contract** -- TypeScript wrapper around `query()` that normalizes options, manages the async generator lifecycle, and emits structured events.
- **Message protocol types** -- shared TypeScript type definitions for the four SDK message kinds (system, user, assistant, result) and the bridge's own envelope events (start, message, error, complete).
- **Session resumption model** -- explicit session ID tracking with `resume` option support, replacing the implicit `-c` flag convention.
- **Permission handling via canUseTool** -- a `canUseTool` hook that pauses execution, emits a permission-request event to the desktop UI, waits for the user's allow/deny response, and returns the decision to the SDK.
- **AbortController cancellation** -- replace PID-based kill with `AbortController.abort()`, with a fallback to process kill if the SDK does not respond within a timeout.
- **Cost and usage tracking** -- extract `total_cost_usd`, token counts, turn count, and duration from `SDKResultMessage` and surface them to the frontend via a structured `session-complete` event.
- **CLI fallback mode** -- retain the existing `--output-format stream-json` subprocess path as a fallback when the SDK package is not installed or the Node runtime is unavailable. The stream-JSON parser in `useClaudeMessages.ts` continues to work unchanged.
- **OAuth token passthrough** -- forward OAuth tokens from OAP's auth layer to the SDK via environment variables (`CLAUDE_OAUTH_TOKEN`), enabling subscription-based authentication.

### Out of scope

- **Desktop UI for permission dialogs** -- this spec defines the IPC contract for permission requests; the UI implementation is a follow-on feature.
- **MCP server configuration passthrough** -- the SDK supports `mcpServers` in its options; wiring OAP's MCP server registry to the SDK is a separate feature.
- **Multi-agent orchestration** -- routing between multiple Claude Code instances is covered by 043-multi-agent-orchestration.
- **Single-binary packaging** -- bundling the SDK into a standalone binary (Bun compile) is a build/packaging concern, not a runtime integration concern.

## Requirements

### Functional

- **FR-001**: The bridge exposes an async generator function `queryClaudeCode(options: BridgeQueryOptions): AsyncGenerator<BridgeEvent>` that wraps the SDK's `query()`.
- **FR-002**: `BridgeQueryOptions` includes: `prompt`, `workingDirectory`, `model`, `sessionId?` (for resumption), `abortController?`, `permissionMode`, `allowedTools?`, `disallowedTools?`, `systemPrompt?`, and `oauthToken?`.
- **FR-003**: When `sessionId` is provided, the bridge passes `resume: sessionId` to `query()`, enabling multi-turn conversations on the same Claude Code session.
- **FR-004**: The bridge accepts a `canUseTool` callback in its options. When the SDK invokes `canUseTool(toolName, toolInput)`, the bridge emits a `permission-request` event with `{ toolName, toolInput, requestId }` and blocks until a corresponding `permission-response` is received.
- **FR-005**: If the `canUseTool` callback is not provided, the bridge falls back to the `permissionMode` setting (one of `default`, `acceptEdits`, `bypassPermissions`, `plan`).
- **FR-006**: When `abortController.abort()` is called, the bridge propagates the signal to the SDK's `query()`, which terminates the current turn gracefully.
- **FR-007**: On query completion, the bridge emits a `session-complete` event containing `{ sessionId, totalCostUsd, inputTokens, outputTokens, numTurns, durationMs, isError }` extracted from `SDKResultMessage`.
- **FR-008**: When the SDK package is not available (import fails), the bridge automatically falls back to CLI subprocess mode using `--output-format stream-json`, preserving existing behavior.
- **FR-009**: The bridge emits events with a discriminated union type: `BridgeEvent = BridgeStartEvent | BridgeMessageEvent | BridgePermissionRequestEvent | BridgeSessionCompleteEvent | BridgeErrorEvent`.

### Non-functional

- **NF-001**: The bridge adds less than 50ms latency to first-token time compared to direct SDK usage.
- **NF-002**: Memory usage for the bridge process stays within 100MB for a typical session (excluding Claude Code's own memory).
- **NF-003**: The `canUseTool` round-trip (emit request, receive response) completes within the SDK's default tool-use timeout. If the user does not respond in time, the bridge denies the tool use by default.

## Architecture

### Package structure

```
packages/claude-code-bridge/
  src/
    index.ts              # Public API: queryClaudeCode(), types
    sdk-adapter.ts        # Wraps @anthropic-ai/claude-code query()
    cli-adapter.ts        # Fallback: spawns CLI with stream-json
    types.ts              # BridgeEvent, BridgeQueryOptions, message types
    permission-broker.ts  # canUseTool hook with event-based request/response
    cost-tracker.ts       # Extracts and normalizes SDKResultMessage data
  package.json            # Depends on @anthropic-ai/claude-code (optional peer)
```

### Message protocol types

```typescript
// Re-exported from @anthropic-ai/claude-code SDK for consumers
interface SDKSystemMessage {
  type: "system";
  subtype: "init";
  tools: string[];
  mcp_servers: string[];
  model: string;
  permission_mode: string;
}

interface SDKUserMessage {
  type: "user";
  message: { role: "user"; content: string };
  parent_tool_use_id?: string;
}

interface SDKAssistantMessage {
  type: "assistant";
  message: {
    role: "assistant";
    content: Array<TextBlock | ToolUseBlock>;
    model: string;
    usage: { input_tokens: number; output_tokens: number };
  };
  session_id: string;
}

interface SDKResultMessage {
  type: "result";
  subtype: "success" | "error";
  session_id: string;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  num_turns: number;
  duration_ms: number;
  duration_api_ms: number;
}

// Bridge envelope types
type BridgeEvent =
  | { kind: "start"; sessionId: string }
  | { kind: "message"; message: SDKSystemMessage | SDKUserMessage | SDKAssistantMessage }
  | { kind: "permission-request"; requestId: string; toolName: string; toolInput: unknown }
  | { kind: "session-complete"; summary: SessionCostSummary }
  | { kind: "error"; error: string; fatal: boolean };

interface SessionCostSummary {
  sessionId: string;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  numTurns: number;
  durationMs: number;
  isError: boolean;
}
```

### Integration with Tauri backend

The bridge runs as a sidecar Node.js process or is loaded via the web-server
backend. Communication between Tauri (Rust) and the bridge uses the existing
event-emit pattern established in `commands/claude.rs`:

```
Tauri command (Rust)
  → spawns / calls bridge process
  → bridge yields BridgeEvents
  → Tauri emits "claude-output" events to frontend
  → frontend useClaudeMessages hook processes typed events
```

For permission requests, the flow adds a round-trip:

```
bridge emits BridgeEvent { kind: "permission-request" }
  → Tauri emits "claude-permission-request" to frontend
  → frontend shows permission dialog
  → frontend calls Tauri command "respond_to_permission"
  → Tauri sends response to bridge
  → bridge resolves canUseTool promise
  → SDK continues or skips tool
```

### Session resumption model

```
First prompt:
  queryClaudeCode({ prompt, workingDirectory })
    → SDK creates new session
    → SDKResultMessage contains session_id
    → bridge emits session-complete with sessionId
    → frontend stores sessionId

Subsequent prompts:
  queryClaudeCode({ prompt, workingDirectory, sessionId: stored })
    → SDK resumes session via resume option
    → conversation continues in same context
```

### CLI fallback mode

When `import("@anthropic-ai/claude-code")` fails (package not installed), the
bridge falls back to `cli-adapter.ts`:

1. Spawns `claude` binary with `--output-format stream-json` flags.
2. Reads stdout line by line, parsing each JSON line.
3. Maps CLI message types (`start`, `partial`, `response`, `error`, `session_info`, `output`) to `BridgeEvent` envelope types.
4. Cancellation falls back to `process.kill(pid, "SIGTERM")`.
5. Cost tracking falls back to accumulating `usage` fields from `response` messages (best-effort, not guaranteed complete).

The fallback is transparent to consumers -- they receive the same `BridgeEvent` stream regardless of backend.

### Key integration points

| Component | File | Change |
|-----------|------|--------|
| Bridge package | `product/packages/claude-code-bridge/` | New package |
| Tauri commands | `product/apps/opc/src-tauri/src/commands/claude.rs` | Refactor `execute_claude_code`, `continue_claude_code`, `resume_claude_code` to use bridge |
| Permission command | `product/apps/opc/src-tauri/src/commands/claude.rs` | New `respond_to_permission` command |
| Frontend hook | `product/apps/opc/src/components/claude-code-session/useClaudeMessages.ts` | Replace `(message as any)` casts with typed `BridgeEvent` discriminated union |
| Frontend types | `product/apps/opc/src/types/claude-bridge.ts` | New shared type definitions |
| Web server | `product/apps/opc/src-tauri/src/web_server.rs` | Route bridge events over WebSocket |

## Success criteria

- **SC-001**: `queryClaudeCode({ prompt, workingDirectory })` returns an async generator that yields typed `BridgeEvent` objects, with the final event being `session-complete` containing cost data.
- **SC-002**: Passing `sessionId` from a previous query's `session-complete` event to a new `queryClaudeCode` call resumes the conversation (verified by Claude Code having access to prior context).
- **SC-003**: When `canUseTool` is provided, the bridge pauses on tool-use and emits a `permission-request` event. Responding with `{ allowed: true }` lets the tool proceed; `{ allowed: false }` causes the SDK to skip the tool.
- **SC-004**: Calling `abortController.abort()` during a running query causes the generator to terminate within 5 seconds without leaving orphaned processes.
- **SC-005**: When `@anthropic-ai/claude-code` is not installed, the bridge falls back to CLI mode and still produces valid `BridgeEvent` objects.
- **SC-006**: The `session-complete` event contains accurate `totalCostUsd` and token counts that match the SDK's `SDKResultMessage` values.
- **SC-007**: The frontend `useClaudeMessages` hook consumes `BridgeEvent` types without any `as any` casts.

## Contract notes

- The `@anthropic-ai/claude-code` package is declared as an optional peer dependency. The bridge must handle its absence gracefully (FR-008).
- The SDK's `query()` function returns `AsyncGenerator<SDKMessage>`. The bridge wraps each yielded message in a `BridgeEvent` envelope to add the `kind` discriminator and any bridge-level metadata.
- The `canUseTool` hook signature in the SDK is `(toolName: string, toolInput: Record<string, unknown>) => Promise<boolean>`. The bridge converts this to an event-based protocol for IPC compatibility.
- The existing `governed_claude` module (`product/apps/opc/src-tauri/src/governed_claude.rs`) currently appends `--allowedTools` CLI flags. With the SDK bridge, these map to the `allowedTools` and `disallowedTools` query options, and the `canUseTool` hook can enforce governance rules programmatically.

## Risk

- **R-001**: The `@anthropic-ai/claude-code` SDK may change its `query()` signature or message types between versions. Mitigation: pin the SDK version in `package.json`; the bridge's type layer insulates consumers from SDK-internal changes.
- **R-002**: The `canUseTool` round-trip through IPC (bridge -> Tauri -> frontend -> Tauri -> bridge) may be too slow for the SDK's internal timeout. Mitigation: measure the round-trip latency; if needed, configure the SDK's tool-use timeout or implement a local cache of recently approved tools.
- **R-003**: Running a Node.js sidecar process for the bridge adds process management complexity. Mitigation: the bridge can alternatively be loaded in-process if the web-server backend already runs Node.js; the CLI fallback eliminates the sidecar entirely for simpler deployments.
- **R-004**: The CLI fallback does not provide `canUseTool` or structured cost data. Mitigation: document the feature parity gap; the fallback is a degraded mode, not a full replacement.
