import type { NotificationOrchestrator, NotifyOptions } from "./orchestrator.js";
import type { NotificationKind, Severity, NotifyResult } from "./types.js";

/**
 * Agent lifecycle statuses that map to notification events.
 * Matches the discriminated union in @opc/worktree-agents lifecycle-events.ts.
 */
export type AgentLifecycleStatus =
  | "spawned"
  | "running"
  | "tool_use"
  | "completed"
  | "failed"
  | "timed_out";

/**
 * Minimal agent lifecycle event shape consumed by the integration layer.
 * Compatible with AgentLifecyclePayload from @opc/worktree-agents without
 * importing it directly (loose coupling).
 */
export interface AgentLifecycleEvent {
  agentId: string;
  status: AgentLifecycleStatus;
  timestamp: number;
  /** Optional branch name (present on "spawned" events). */
  branchName?: string;
  /** Optional exit code (present on "completed" and "failed" events). */
  exitCode?: number | null;
  /** Optional signal (present on "completed" and "failed" events). */
  signal?: string | null;
  /** Optional timeout duration (present on "timed_out" events). */
  timeoutMs?: number;
  /** Optional detail string (present on "tool_use" and "failed" events). */
  detail?: string;
}

/**
 * Mapping entry from an agent lifecycle status to notification parameters.
 */
export interface LifecycleMapping {
  kind: NotificationKind;
  severity: Severity;
  title: (event: AgentLifecycleEvent) => string;
  body: (event: AgentLifecycleEvent) => string;
}

/**
 * Options for {@link connectLifecycleBus}.
 */
export interface ConnectOptions {
  /** Provider id to include in notification events (maps to spec 042 ProviderId). */
  provider: string;
  /** Session id to include in notification events. */
  sessionId: string;
  /**
   * Optional custom lifecycle mapping overrides. Keys not present fall back
   * to the default mapping.
   */
  mappings?: Partial<Record<AgentLifecycleStatus, LifecycleMapping | null>>;
}

/**
 * Default mappings from agent lifecycle status to notification parameters.
 *
 * - `completed` → task_complete / info (SC-001)
 * - `failed` → task_error / error
 * - `timed_out` → task_error / warning
 * - `spawned` → system_alert / info
 * - `running` and `tool_use` are intentionally omitted to avoid noise.
 *   Callers can add them via the `mappings` override in {@link ConnectOptions}.
 */
export const DEFAULT_LIFECYCLE_MAPPINGS: Partial<
  Record<AgentLifecycleStatus, LifecycleMapping>
> = {
  completed: {
    kind: "task_complete",
    severity: "info",
    title: (e) => `Agent ${e.agentId} completed`,
    body: (e) =>
      e.exitCode === 0 || e.exitCode == null
        ? "Task finished successfully."
        : `Task exited with code ${e.exitCode}.`,
  },
  failed: {
    kind: "task_error",
    severity: "error",
    title: (e) => `Agent ${e.agentId} failed`,
    body: (e) => {
      const parts: string[] = [];
      if (e.exitCode != null) parts.push(`Exit code: ${e.exitCode}`);
      if (e.signal) parts.push(`Signal: ${e.signal}`);
      if (e.detail) parts.push(e.detail);
      return parts.length > 0 ? parts.join(". ") + "." : "Agent failed unexpectedly.";
    },
  },
  timed_out: {
    kind: "task_error",
    severity: "warning",
    title: (e) => `Agent ${e.agentId} timed out`,
    body: (e) =>
      e.timeoutMs != null
        ? `Agent exceeded ${e.timeoutMs}ms timeout.`
        : "Agent exceeded timeout.",
  },
  spawned: {
    kind: "system_alert",
    severity: "info",
    title: (e) => `Agent ${e.agentId} spawned`,
    body: (e) =>
      e.branchName
        ? `Working on branch ${e.branchName}.`
        : "Agent started.",
  },
};

/**
 * Create {@link NotifyOptions} from an agent lifecycle event.
 *
 * Returns `null` when the lifecycle status has no mapping (e.g. `running`,
 * `tool_use` by default), meaning the event should not produce a notification.
 */
export function createNotifyOptions(
  event: AgentLifecycleEvent,
  connectOpts: ConnectOptions,
): NotifyOptions | null {
  const customMapping = connectOpts.mappings?.[event.status];
  // Explicit null = suppress this status even if it has a default mapping
  if (customMapping === null) return null;

  const mapping =
    customMapping ?? DEFAULT_LIFECYCLE_MAPPINGS[event.status] ?? null;
  if (!mapping) return null;

  return {
    provider: connectOpts.provider,
    sessionId: connectOpts.sessionId,
    kind: mapping.kind,
    severity: mapping.severity,
    dedupeKey: `lifecycle:${event.agentId}:${event.status}`,
    title: mapping.title(event),
    body: mapping.body(event),
    metadata: {
      agentId: event.agentId,
      lifecycleStatus: event.status,
      ...(event.exitCode != null ? { exitCode: event.exitCode } : {}),
      ...(event.signal ? { signal: event.signal } : {}),
      ...(event.timeoutMs != null ? { timeoutMs: event.timeoutMs } : {}),
      ...(event.branchName ? { branchName: event.branchName } : {}),
      ...(event.detail ? { detail: event.detail } : {}),
    },
  };
}

/**
 * Minimal event bus interface — compatible with AgentLifecycleBus.onAny()
 * without importing the worktree-agents package.
 */
export interface LifecycleEventSource {
  onAny(listener: (event: AgentLifecycleEvent) => void): () => void;
}

/**
 * Result of {@link connectLifecycleBus}.
 */
export interface ConnectionHandle {
  /** Disconnect the listener. */
  disconnect: () => void;
}

/**
 * Connect an agent lifecycle event bus to a notification orchestrator.
 *
 * Subscribes to all lifecycle events via `onAny()` and calls `notify()`
 * on the orchestrator for each event that has a mapping. Events without
 * a mapping (e.g. `running`, `tool_use`) are silently skipped.
 *
 * Returns a {@link ConnectionHandle} to disconnect the listener.
 *
 * @example
 * ```ts
 * const handle = connectLifecycleBus(orchestrator, lifecycleBus, {
 *   provider: "anthropic",
 *   sessionId: "sess-123",
 * });
 * // Later:
 * handle.disconnect();
 * ```
 */
export function connectLifecycleBus(
  orchestrator: NotificationOrchestrator,
  source: LifecycleEventSource,
  options: ConnectOptions,
): ConnectionHandle {
  const unsubscribe = source.onAny((event: AgentLifecycleEvent) => {
    const notifyOpts = createNotifyOptions(event, options);
    if (notifyOpts) {
      // Fire-and-forget — delivery errors are captured in NotifyResult,
      // and the event log records all outcomes.
      void orchestrator.notify(notifyOpts);
    }
  });

  return { disconnect: unsubscribe };
}
