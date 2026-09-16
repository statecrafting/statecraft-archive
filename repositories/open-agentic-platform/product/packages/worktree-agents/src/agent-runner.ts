import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

export type AgentLifecycleStatus =
  | "spawned"
  | "running"
  | "tool_use"
  | "completed"
  | "failed"
  | "timed_out";

export type PreApprovedPermissions = {
  tools?: string[];
  readGlobs?: string[];
  writeGlobs?: string[];
  networkHosts?: string[];
};

export type AgentRunnerSpawnOptions = {
  agentId: string;
  worktreePath: string;
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  inactivityTimeoutMs?: number;
  timeoutKillGraceMs?: number;
  permissions: PreApprovedPermissions;
};

export type AgentLifecycleEvent = {
  agentId: string;
  status: AgentLifecycleStatus;
  timestamp: number;
  detail?: string;
};

export type AgentRunResult = {
  agentId: string;
  status: "completed" | "failed" | "timed_out";
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
};

export class AgentRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRunnerError";
  }
}

type InternalState = {
  runningObserved: boolean;
  terminal: boolean;
  timeoutHandle: NodeJS.Timeout | null;
  killEscalationHandle: NodeJS.Timeout | null;
};

const DEFAULT_INACTIVITY_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_KILL_GRACE_MS = 1_000;

/**
 * Phase 3 runner for background agents (051 FR-003/FR-004):
 * - spawns process in isolated worktree
 * - resets inactivity timeout on output/lifecycle activity
 * - transitions to timed_out and terminates process on inactivity
 */
export class BackgroundAgentRunner extends EventEmitter {
  private readonly options: Required<
    Pick<AgentRunnerSpawnOptions, "args" | "inactivityTimeoutMs" | "timeoutKillGraceMs">
  > &
    Omit<
      AgentRunnerSpawnOptions,
      "args" | "inactivityTimeoutMs" | "timeoutKillGraceMs"
    >;

  constructor(options: AgentRunnerSpawnOptions) {
    super();
    if (!options.agentId.trim()) {
      throw new AgentRunnerError("agentId must be non-empty");
    }
    if (!options.worktreePath.trim()) {
      throw new AgentRunnerError("worktreePath must be non-empty");
    }
    if (!options.command.trim()) {
      throw new AgentRunnerError("command must be non-empty");
    }
    this.options = {
      ...options,
      args: options.args ?? [],
      inactivityTimeoutMs:
        options.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS,
      timeoutKillGraceMs: options.timeoutKillGraceMs ?? DEFAULT_KILL_GRACE_MS,
    };
  }

  start(): { result: Promise<AgentRunResult>; stop: () => void } {
    const child = spawn(this.options.command, this.options.args, {
      cwd: this.options.worktreePath,
      env: this.options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const state: InternalState = {
      runningObserved: false,
      terminal: false,
      timeoutHandle: null,
      killEscalationHandle: null,
    };

    let resolveResult!: (value: AgentRunResult) => void;
    const result = new Promise<AgentRunResult>((resolve) => {
      resolveResult = resolve;
    });

    const emitLifecycle = (
      status: AgentLifecycleStatus,
      detail?: string,
      shouldTouch = true,
    ) => {
      this.emit("lifecycle", {
        agentId: this.options.agentId,
        status,
        timestamp: Date.now(),
        detail,
      } satisfies AgentLifecycleEvent);
      if (shouldTouch) {
        touchActivityTimer();
      }
    };

    const clearTimers = () => {
      if (state.timeoutHandle) clearTimeout(state.timeoutHandle);
      if (state.killEscalationHandle) clearTimeout(state.killEscalationHandle);
      state.timeoutHandle = null;
      state.killEscalationHandle = null;
    };

    const finalize = (
      status: "completed" | "failed" | "timed_out",
      exitCode: number | null,
      signal: NodeJS.Signals | null,
      timedOut: boolean,
    ) => {
      if (state.terminal) return;
      state.terminal = true;
      clearTimers();
      emitLifecycle(status, undefined, false);
      resolveResult({
        agentId: this.options.agentId,
        status,
        exitCode,
        signal,
        timedOut,
      });
    };

    const touchActivityTimer = () => {
      if (state.terminal) return;
      if (state.timeoutHandle) clearTimeout(state.timeoutHandle);
      state.timeoutHandle = setTimeout(() => {
        if (state.terminal) return;
        finalize("timed_out", child.exitCode, null, true);
        child.kill("SIGTERM");
        state.killEscalationHandle = setTimeout(() => {
          if (child.exitCode === null) {
            child.kill("SIGKILL");
          }
        }, this.options.timeoutKillGraceMs);
      }, this.options.inactivityTimeoutMs);
    };

    const markRunning = () => {
      if (state.runningObserved || state.terminal) return;
      state.runningObserved = true;
      emitLifecycle("running");
    };

    emitLifecycle("spawned");

    child.stdout?.on("data", (chunk: Buffer) => {
      markRunning();
      const text = chunk.toString("utf8");
      emitLifecycle("tool_use", text.slice(0, 240));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      markRunning();
      emitLifecycle("tool_use", chunk.toString("utf8").slice(0, 240));
    });
    child.on("error", (err) => {
      finalize("failed", child.exitCode, null, false);
      this.emit("error", err);
    });
    child.on("close", (code, signal) => {
      if (state.terminal) return;
      if (code === 0) finalize("completed", code, signal, false);
      else finalize("failed", code, signal, false);
    });

    return {
      result,
      stop: () => {
        if (!state.terminal && child.exitCode === null) {
          child.kill("SIGTERM");
        }
      },
    };
  }
}
