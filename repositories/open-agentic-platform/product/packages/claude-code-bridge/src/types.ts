// ---------------------------------------------------------------------------
// SDK message types (mirroring @anthropic-ai/claude-code output)
// ---------------------------------------------------------------------------

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ContentBlock = TextBlock | ToolUseBlock;

export interface SDKSystemMessage {
  type: "system";
  subtype: "init";
  session_id: string;
  tools: string[];
  mcp_servers: string[];
  model: string;
  permission_mode: string;
  cwd: string;
}

export interface SDKUserMessage {
  type: "user";
  message: { role: "user"; content: string };
  parent_tool_use_id?: string;
}

export interface SDKAssistantMessage {
  type: "assistant";
  message: {
    role: "assistant";
    content: ContentBlock[];
    model: string;
    usage: { input_tokens: number; output_tokens: number };
  };
  session_id: string;
}

export interface SDKResultMessage {
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

export type SDKMessage =
  | SDKSystemMessage
  | SDKUserMessage
  | SDKAssistantMessage
  | SDKResultMessage;

// ---------------------------------------------------------------------------
// Bridge envelope types (FR-009)
// ---------------------------------------------------------------------------

export interface BridgeStartEvent {
  kind: "start";
  sessionId: string;
}

export interface BridgeMessageEvent {
  kind: "message";
  message: SDKSystemMessage | SDKUserMessage | SDKAssistantMessage;
}

export interface BridgePermissionRequestEvent {
  kind: "permission-request";
  requestId: string;
  toolName: string;
  toolInput: unknown;
}

export interface BridgeSessionCompleteEvent {
  kind: "session-complete";
  summary: SessionCostSummary;
}

export interface BridgeErrorEvent {
  kind: "error";
  error: string;
  fatal: boolean;
}

export type BridgeEvent =
  | BridgeStartEvent
  | BridgeMessageEvent
  | BridgePermissionRequestEvent
  | BridgeSessionCompleteEvent
  | BridgeErrorEvent;

// ---------------------------------------------------------------------------
// Session cost summary (FR-007)
// ---------------------------------------------------------------------------

export interface SessionCostSummary {
  sessionId: string;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  numTurns: number;
  durationMs: number;
  isError: boolean;
}

// ---------------------------------------------------------------------------
// Bridge query options (FR-002)
// ---------------------------------------------------------------------------

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

export interface BridgeQueryOptions {
  prompt: string;
  workingDirectory: string;
  model?: string;
  sessionId?: string;
  abortController?: AbortController;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
  systemPrompt?: string;
  oauthToken?: string;
  /** Callback invoked when the SDK requests tool-use permission. */
  canUseTool?: (toolName: string, toolInput: Record<string, unknown>) => Promise<boolean>;
}
