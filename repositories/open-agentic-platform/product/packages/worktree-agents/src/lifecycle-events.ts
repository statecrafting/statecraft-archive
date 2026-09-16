import { EventEmitter } from "node:events";

import type { AgentLifecycleStatus } from "./agent-runner.js";

type BasePayload = {
  agentId: string;
  timestamp: number;
};

export type AgentSpawnedEvent = BasePayload & {
  status: "spawned";
  branchName: string;
  worktreePath: string;
  parentBranch: string;
};

export type AgentRunningEvent = BasePayload & {
  status: "running";
};

export type AgentToolUseEvent = BasePayload & {
  status: "tool_use";
  detail?: string;
};

export type AgentCompletedEvent = BasePayload & {
  status: "completed";
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

export type AgentFailedEvent = BasePayload & {
  status: "failed";
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  detail?: string;
};

export type AgentTimedOutEvent = BasePayload & {
  status: "timed_out";
  timeoutMs: number;
};

export type AgentLifecyclePayloadByStatus = {
  spawned: AgentSpawnedEvent;
  running: AgentRunningEvent;
  tool_use: AgentToolUseEvent;
  completed: AgentCompletedEvent;
  failed: AgentFailedEvent;
  timed_out: AgentTimedOutEvent;
};

export type AgentLifecyclePayload =
  AgentLifecyclePayloadByStatus[keyof AgentLifecyclePayloadByStatus];

export type AgentListItem = {
  agentId: string;
  status: AgentLifecycleStatus;
  branchName: string | null;
  elapsedMs: number;
  startedAt: number | null;
  lastEvent: AgentLifecyclePayload;
};

type InternalAgentRecord = {
  status: AgentLifecycleStatus;
  branchName: string | null;
  startedAt: number | null;
  lastEvent: AgentLifecyclePayload;
  terminalAt: number | null;
};

const TERMINAL_STATUSES = new Set<AgentLifecycleStatus>([
  "completed",
  "failed",
  "timed_out",
]);

export class AgentLifecycleBus {
  private readonly emitter = new EventEmitter();
  private readonly records = new Map<string, InternalAgentRecord>();
  private readonly terminalOrder: string[] = [];
  private readonly recentTerminalLimit: number;

  constructor(options?: { recentTerminalLimit?: number }) {
    const recentTerminalLimit = options?.recentTerminalLimit ?? 25;
    if (!Number.isInteger(recentTerminalLimit) || recentTerminalLimit < 1) {
      throw new Error("recentTerminalLimit must be a positive integer");
    }
    this.recentTerminalLimit = recentTerminalLimit;
  }

  on<TStatus extends keyof AgentLifecyclePayloadByStatus>(
    status: TStatus,
    listener: (event: AgentLifecyclePayloadByStatus[TStatus]) => void,
  ): () => void {
    const wrapped = listener as (event: AgentLifecyclePayload) => void;
    this.emitter.on(status, wrapped);
    return () => {
      this.emitter.off(status, wrapped);
    };
  }

  emit<TStatus extends keyof AgentLifecyclePayloadByStatus>(
    status: TStatus,
    payload: Omit<AgentLifecyclePayloadByStatus[TStatus], "status">,
  ): AgentLifecyclePayloadByStatus[TStatus] {
    const event = { ...payload, status } as AgentLifecyclePayloadByStatus[TStatus];
    this.projectEvent(event);
    this.emitter.emit(status, event);
    this.emitter.emit("event", event);
    return event;
  }

  onAny(listener: (event: AgentLifecyclePayload) => void): () => void {
    this.emitter.on("event", listener);
    return () => {
      this.emitter.off("event", listener);
    };
  }

  listAgents(now = Date.now()): AgentListItem[] {
    const active: AgentListItem[] = [];
    for (const [agentId, record] of this.records.entries()) {
      if (TERMINAL_STATUSES.has(record.status)) {
        continue;
      }
      active.push(this.toListItem(agentId, record, now));
    }

    const recentTerminal: AgentListItem[] = [];
    for (let i = this.terminalOrder.length - 1; i >= 0; i -= 1) {
      if (recentTerminal.length >= this.recentTerminalLimit) {
        break;
      }
      const agentId = this.terminalOrder[i];
      const record = this.records.get(agentId);
      if (!record || !TERMINAL_STATUSES.has(record.status)) {
        continue;
      }
      recentTerminal.push(this.toListItem(agentId, record, now));
    }

    active.sort((a, b) => b.lastEvent.timestamp - a.lastEvent.timestamp);
    return [...active, ...recentTerminal];
  }

  private projectEvent(event: AgentLifecyclePayload): void {
    const existing = this.records.get(event.agentId);
    const startedAt =
      event.status === "spawned"
        ? event.timestamp
        : existing?.startedAt ?? event.timestamp;
    const branchName =
      event.status === "spawned"
        ? event.branchName
        : existing?.branchName ?? null;

    const record: InternalAgentRecord = {
      status: event.status,
      branchName,
      startedAt,
      lastEvent: event,
      terminalAt: TERMINAL_STATUSES.has(event.status)
        ? event.timestamp
        : existing?.terminalAt ?? null,
    };
    this.records.set(event.agentId, record);

    if (TERMINAL_STATUSES.has(event.status)) {
      this.terminalOrder.push(event.agentId);
      this.trimTerminalOrder();
    } else if (existing?.terminalAt) {
      this.pruneTerminalEntry(event.agentId);
    }
  }

  private toListItem(
    agentId: string,
    record: InternalAgentRecord,
    now: number,
  ): AgentListItem {
    const effectiveNow = Number.isFinite(now) ? now : Date.now();
    const baseline = record.startedAt ?? record.lastEvent.timestamp;
    const elapsedMs = Math.max(0, effectiveNow - baseline);
    return {
      agentId,
      status: record.status,
      branchName: record.branchName,
      elapsedMs,
      startedAt: record.startedAt,
      lastEvent: record.lastEvent,
    };
  }

  private trimTerminalOrder(): void {
    if (this.terminalOrder.length <= this.recentTerminalLimit * 3) {
      return;
    }
    const keep = new Set(this.terminalOrder.slice(-this.recentTerminalLimit));
    this.terminalOrder.splice(
      0,
      this.terminalOrder.length - this.recentTerminalLimit,
    );
    for (const [agentId, record] of this.records.entries()) {
      if (record.terminalAt && !keep.has(agentId)) {
        this.records.delete(agentId);
      }
    }
  }

  private pruneTerminalEntry(agentId: string): void {
    for (let i = this.terminalOrder.length - 1; i >= 0; i -= 1) {
      if (this.terminalOrder[i] === agentId) {
        this.terminalOrder.splice(i, 1);
      }
    }
  }
}
