import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { BridgeEvent, BridgeQueryOptions } from "./types.js";

/**
 * Fallback adapter: spawns the `claude` CLI with `--output-format stream-json`
 * and maps JSONL output to BridgeEvent objects (FR-008).
 */
export async function* queryViaCli(
  options: BridgeQueryOptions,
): AsyncGenerator<BridgeEvent> {
  const args = buildCliArgs(options);
  const env = buildCliEnv(options);

  let child: ChildProcess;
  try {
    child = spawn("claude", args, {
      cwd: options.workingDirectory,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    yield {
      kind: "error",
      error: `Failed to spawn claude CLI: ${err instanceof Error ? err.message : err}`,
      fatal: true,
    };
    return;
  }

  // FR-006 fallback: abort via SIGTERM.
  const onAbort = () => {
    if (child.pid && !child.killed) {
      child.kill("SIGTERM");
    }
  };
  options.abortController?.signal.addEventListener("abort", onAbort, {
    once: true,
  });

  let sessionId = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const startTime = Date.now();

  const sessionCompleteTracker = { emitted: false };
  try {
    yield* streamOutput(
      child,
      () => sessionId,
      (id) => {
        sessionId = id;
      },
      (inp, out) => {
        totalInputTokens += inp;
        totalOutputTokens += out;
      },
      sessionCompleteTracker,
    );
  } finally {
    options.abortController?.signal.removeEventListener("abort", onAbort);
  }

  // Wait for process exit.
  const exitCode = await waitForExit(child);
  const durationMs = Date.now() - startTime;

  // Emit session-complete only if the CLI never sent a `result` line (F-002).
  if (!sessionCompleteTracker.emitted) {
    yield {
      kind: "session-complete",
      summary: {
        sessionId,
        totalCostUsd: 0, // CLI doesn't report cost directly
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        numTurns: 0, // Not tracked in CLI mode
        durationMs,
        isError: exitCode !== 0,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildCliArgs(options: BridgeQueryOptions): string[] {
  const args = ["-p", options.prompt, "--output-format", "stream-json", "--verbose"];

  if (options.model) args.push("--model", options.model);
  if (options.sessionId) args.push("--resume", options.sessionId);

  if (options.permissionMode === "bypassPermissions") {
    args.push("--dangerously-skip-permissions");
  } else if (options.permissionMode === "plan") {
    args.push("--permission-mode", "plan");
  } else if (options.permissionMode === "acceptEdits") {
    args.push("--permission-mode", "acceptEdits");
  }

  if (options.allowedTools?.length) {
    args.push("--allowedTools", ...options.allowedTools);
  }
  if (options.disallowedTools?.length) {
    args.push("--disallowedTools", ...options.disallowedTools);
  }
  if (options.systemPrompt) {
    args.push("--system-prompt", options.systemPrompt);
  }

  return args;
}

function buildCliEnv(
  options: BridgeQueryOptions,
): Record<string, string | undefined> {
  const env = { ...process.env };
  if (options.oauthToken) {
    env.CLAUDE_OAUTH_TOKEN = options.oauthToken;
  }
  return env;
}

async function* streamOutput(
  child: ChildProcess,
  getSessionId: () => string,
  setSessionId: (id: string) => void,
  addTokens: (input: number, output: number) => void,
  sessionCompleteTracker: { emitted: boolean },
): AsyncGenerator<BridgeEvent> {
  if (!child.stdout) return;

  const rl = createInterface({ input: child.stdout });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // Skip non-JSON lines (e.g. bare stderr leaking into stdout).
    }

    const type = parsed.type as string | undefined;

    // Extract session ID from system init message.
    if (type === "system" && parsed.subtype === "init" && parsed.session_id) {
      setSessionId(parsed.session_id as string);
      yield { kind: "start", sessionId: parsed.session_id as string };
    }

    // Forward system, user, and assistant messages.
    if (type === "system" || type === "user" || type === "assistant") {
      yield { kind: "message", message: parsed as any };
    }

    // Accumulate token usage from assistant response messages.
    if (type === "assistant") {
      const msg = parsed.message as Record<string, unknown> | undefined;
      const usage = msg?.usage as
        | { input_tokens?: number; output_tokens?: number }
        | undefined;
      if (usage) {
        addTokens(usage.input_tokens ?? 0, usage.output_tokens ?? 0);
      }
    }

    // Handle result messages (CLI also emits these).
    if (type === "result") {
      const result = parsed as Record<string, unknown>;
      const sid = (result.session_id as string) || getSessionId();
      setSessionId(sid);
      sessionCompleteTracker.emitted = true;
      yield {
        kind: "session-complete",
        summary: {
          sessionId: sid,
          totalCostUsd: (result.total_cost_usd as number) ?? 0,
          inputTokens: (result.total_input_tokens as number) ?? 0,
          outputTokens: (result.total_output_tokens as number) ?? 0,
          numTurns: (result.num_turns as number) ?? 0,
          durationMs: (result.duration_ms as number) ?? 0,
          isError: result.subtype === "error",
        },
      };
    }

    // Surface CLI errors.
    if (type === "error") {
      yield {
        kind: "error",
        error: (parsed.error as string) ?? JSON.stringify(parsed),
        fatal: (parsed.fatal as boolean) ?? false,
      };
    }
  }
}

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.on("exit", (code: number | null) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}
