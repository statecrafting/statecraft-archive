/**
 * Typed event payloads for the 6-event lifecycle taxonomy (FR-002).
 *
 * Each payload carries the contextual data relevant to its lifecycle point.
 * Payloads are passed to hook handlers as environment variables (bash) or
 * structured context (agent/prompt).
 */

import type { HookEventType } from "./types.js";

/** PreToolUse — fired before a tool executes (FR-002). */
export interface PreToolUsePayload {
  tool: string;
  input: Record<string, unknown>;
  permissionResult: "allow" | "deny" | "ask";
  permissionReason?: string;
}

/** PostToolUse — fired after a tool executes (FR-002). */
export interface PostToolUsePayload {
  tool: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  durationMs: number;
  error?: string;
}

/** UserPromptSubmit — fired when user submits a prompt (FR-002). */
export interface UserPromptSubmitPayload {
  prompt: string;
  sessionId: string;
  sessionContext?: Record<string, unknown>;
}

/** SessionStart — fired when a session begins (FR-002). */
export interface SessionStartPayload {
  sessionId: string;
  projectPath: string;
  settingsSnapshot?: Record<string, unknown>;
}

/** SessionStop — fired when a session ends (FR-002). */
export interface SessionStopPayload {
  sessionId: string;
  durationMs: number;
  toolCallCount: number;
}

/** FileChanged — fired when a watched file changes (FR-002). */
export interface FileChangedPayload {
  filePath: string;
  changeType: "create" | "modify" | "delete";
  contentHash?: string;
}

/** Union of all typed payloads, keyed by event type. */
export interface EventPayloadMap {
  PreToolUse: PreToolUsePayload;
  PostToolUse: PostToolUsePayload;
  UserPromptSubmit: UserPromptSubmitPayload;
  SessionStart: SessionStartPayload;
  SessionStop: SessionStopPayload;
  FileChanged: FileChangedPayload;
}

/** A fully-typed lifecycle event with its payload. */
export interface TypedHookEvent<T extends HookEventType = HookEventType> {
  type: T;
  payload: T extends keyof EventPayloadMap ? EventPayloadMap[T] : Record<string, unknown>;
}

/**
 * Build environment variables for a bash handler from an event payload.
 * Maps payload fields to the HOOK_* env var convention from the spec.
 */
export function buildEnvVars(
  event: HookEventType,
  payload: Record<string, unknown>,
  extra?: { sessionId?: string; projectPath?: string },
): Record<string, string> {
  const env: Record<string, string> = {
    HOOK_EVENT: event,
  };

  if (extra?.sessionId) {
    env.HOOK_SESSION_ID = extra.sessionId;
  }
  if (extra?.projectPath) {
    env.HOOK_PROJECT_PATH = extra.projectPath;
  }

  switch (event) {
    case "PreToolUse":
    case "PostToolUse": {
      const tool = payload.tool;
      if (typeof tool === "string") {
        env.HOOK_TOOL = tool;
      }
      if (payload.input !== undefined) {
        env.HOOK_TOOL_INPUT = JSON.stringify(payload.input);
      }
      if (event === "PostToolUse" && payload.output !== undefined) {
        env.HOOK_TOOL_OUTPUT = JSON.stringify(payload.output);
      }
      break;
    }
    case "UserPromptSubmit": {
      const prompt = payload.prompt;
      if (typeof prompt === "string") {
        env.HOOK_PROMPT = prompt;
      }
      break;
    }
    case "FileChanged": {
      const filePath = payload.filePath;
      if (typeof filePath === "string") {
        env.HOOK_FILE_PATH = filePath;
      }
      break;
    }
    case "SessionStart": {
      const projectPath = payload.projectPath;
      if (typeof projectPath === "string") {
        env.HOOK_PROJECT_PATH = projectPath;
      }
      break;
    }
    // SessionStop has no special env vars beyond the common ones
    default:
      break;
  }

  return env;
}
