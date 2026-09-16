/**
 * Hook handler executors for the 3 handler types (FR-003):
 * - bash: spawn shell command with env vars, capture stdout/stderr, enforce timeout (FR-006)
 * - agent: spawn sub-agent with prompt template + payload context (FR-007)
 * - prompt: display question to user, capture answer
 */

import { execFile } from "node:child_process";
import { buildEnvVars } from "./events.js";
import type { HookActionResult, HookEventType, HookHandler } from "./types.js";

export interface HandlerContext {
  event: HookEventType;
  payload: Record<string, unknown>;
  sessionId?: string;
  projectPath?: string;
}

export interface HandlerExecutionResult {
  action: HookActionResult;
  stdout?: string;
  stderr?: string;
}

/**
 * Execute a bash handler: spawn shell command with HOOK_* env vars,
 * capture stdout/stderr, enforce timeout (FR-006).
 *
 * Non-zero exit → block (if the hook's declared action is "block") or warn.
 * Timeout → warn by default (FR-006: timeout treated as warn, not block).
 */
export async function executeBashHandler(
  command: string,
  context: HandlerContext,
  timeoutMs: number,
  declaredAction: "block" | "warn" | "modify",
): Promise<HandlerExecutionResult> {
  const env = {
    ...process.env,
    ...buildEnvVars(context.event, context.payload, {
      sessionId: context.sessionId,
      projectPath: context.projectPath,
    }),
  };

  return new Promise<HandlerExecutionResult>((resolve) => {
    const child = execFile(
      "/bin/sh",
      ["-c", command],
      { env, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const out = stdout?.toString() ?? "";
        const err = stderr?.toString() ?? "";

        if (error) {
          // Timeout produces error.killed === true
          if (error.killed) {
            resolve({
              action: { type: "warn", message: `Hook timed out after ${timeoutMs}ms: ${command}` },
              stdout: out,
              stderr: err,
            });
            return;
          }

          // Non-zero exit
          if (declaredAction === "block") {
            resolve({
              action: { type: "block", reason: out.trim() || err.trim() || `Hook command failed: ${command}` },
              stdout: out,
              stderr: err,
            });
          } else {
            resolve({
              action: { type: "warn", message: out.trim() || err.trim() || `Hook command failed: ${command}` },
              stdout: out,
              stderr: err,
            });
          }
          return;
        }

        // Success — map to declared action
        const message = out.trim();
        if (declaredAction === "block") {
          resolve({
            action: { type: "block", reason: message || "Blocked by hook" },
            stdout: out,
            stderr: err,
          });
        } else if (declaredAction === "modify" && message) {
          try {
            const patch = JSON.parse(message) as Record<string, unknown>;
            resolve({
              action: { type: "modify", patch },
              stdout: out,
              stderr: err,
            });
          } catch {
            resolve({
              action: { type: "warn", message: `modify handler returned non-JSON: ${message}` },
              stdout: out,
              stderr: err,
            });
          }
        } else {
          resolve({
            action: message ? { type: "warn", message } : { type: "allow" },
            stdout: out,
            stderr: err,
          });
        }
      },
    );

    // Safety: if the process hangs beyond timeout, ensure we don't leak
    child.on("error", (err) => {
      resolve({
        action: { type: "warn", message: `Hook process error: ${err.message}` },
      });
    });
  });
}

/**
 * Agent handler delegate type. The actual agent dispatch is injected by the
 * consuming application (e.g., OPC wires Feature 035's governed execution).
 */
export type AgentDispatchFn = (
  promptTemplate: string,
  payload: Record<string, unknown>,
) => Promise<HookActionResult>;

/** Default agent dispatch — returns allow (no agent runtime wired). */
export const defaultAgentDispatch: AgentDispatchFn = async () => ({ type: "allow" });

/**
 * Execute an agent handler (FR-007): invoke the agent dispatch delegate
 * with the prompt template and event payload as context.
 */
export async function executeAgentHandler(
  promptTemplate: string,
  context: HandlerContext,
  dispatch: AgentDispatchFn,
): Promise<HandlerExecutionResult> {
  const action = await dispatch(promptTemplate, context.payload);
  return { action };
}

/**
 * Prompt handler delegate type. The actual prompt display is injected by
 * the consuming application (e.g., OPC renders an AskUser dialog).
 */
export type PromptDisplayFn = (message: string) => Promise<string>;

/** Default prompt display — returns empty string (no UI wired). */
export const defaultPromptDisplay: PromptDisplayFn = async () => "";

/**
 * Execute a prompt handler (FR-003): display a message to the user
 * and capture their response. Always results in "allow" (informational).
 */
export async function executePromptHandler(
  message: string,
  display: PromptDisplayFn,
): Promise<HandlerExecutionResult> {
  const answer = await display(message);
  return {
    action: { type: "allow" },
    stdout: answer,
  };
}

/**
 * Dispatch a handler based on its type. Central routing for all 3 handler types.
 */
export async function executeHandler(
  handler: HookHandler,
  context: HandlerContext,
  timeoutMs: number,
  declaredAction: "block" | "warn" | "modify",
  delegates: {
    agentDispatch?: AgentDispatchFn;
    promptDisplay?: PromptDisplayFn;
  } = {},
): Promise<HandlerExecutionResult> {
  switch (handler.type) {
    case "bash":
      return executeBashHandler(handler.command, context, timeoutMs, declaredAction);
    case "agent":
      return executeAgentHandler(
        handler.promptTemplate,
        context,
        delegates.agentDispatch ?? defaultAgentDispatch,
      );
    case "prompt":
      return executePromptHandler(
        handler.message,
        delegates.promptDisplay ?? defaultPromptDisplay,
      );
  }
}
