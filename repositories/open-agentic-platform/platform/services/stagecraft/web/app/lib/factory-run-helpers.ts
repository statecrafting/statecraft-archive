// Spec 124 §7 — pure helpers shared by the Runs list + detail routes.
//
// Lives in `lib/` (not `lib/.../*.server`) so the same functions run on the
// SSR loader and inside browser-side useEffect bodies.

import type {
  FactoryRunStatus,
  FactoryRunStageProgressEntry,
  FactoryRunDetail,
  FactoryAgentRef,
} from "./factory-api.server";

export const FACTORY_RUN_TERMINAL_STATUSES: ReadonlySet<FactoryRunStatus> =
  new Set(["ok", "failed", "cancelled"]);

/** Run is in flight — the run-detail view should poll for live updates. */
export function shouldPollRun(status: FactoryRunStatus): boolean {
  return status === "queued" || status === "running";
}

/** First 8 hex chars of a content hash, prefixed for visual cue. */
export function shortContentHash(hash: string): string {
  if (!hash) return "";
  const cleaned = hash.replace(/^sha256[-:]/, "");
  return cleaned.slice(0, 8);
}

/** Human-readable agent triple — used in the hover tooltip. */
export function formatAgentRefTriple(ref: FactoryAgentRef): string {
  return `${ref.orgAgentId} · v${ref.version} · ${ref.contentHash}`;
}

const MS_PER_SEC = 1000;
const MS_PER_MIN = 60 * MS_PER_SEC;
const MS_PER_HOUR = 60 * MS_PER_MIN;

/**
 * Compact duration between two ISO timestamps. `endISO === null` means the
 * run is still in flight — duration is computed against `now`. Returns `—`
 * when `start` is unparseable (defence-in-depth; the API guarantees ISO).
 */
export function formatDuration(
  startISO: string,
  endISO: string | null | undefined,
  now: Date = new Date()
): string {
  const startMs = Date.parse(startISO);
  if (Number.isNaN(startMs)) return "—";
  const endMs = endISO ? Date.parse(endISO) : now.getTime();
  if (Number.isNaN(endMs)) return "—";
  const diff = Math.max(0, endMs - startMs);
  if (diff < MS_PER_MIN) {
    return `${Math.round(diff / MS_PER_SEC)}s`;
  }
  if (diff < MS_PER_HOUR) {
    const m = Math.floor(diff / MS_PER_MIN);
    const s = Math.round((diff % MS_PER_MIN) / MS_PER_SEC);
    return s === 0 ? `${m}m` : `${m}m ${s}s`;
  }
  const h = Math.floor(diff / MS_PER_HOUR);
  const m = Math.round((diff % MS_PER_HOUR) / MS_PER_MIN);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Tailwind classes for the per-status pill. Mirrored on list + detail. */
export const STATUS_PILL_CLASSES: Record<FactoryRunStatus, string> = {
  queued:
    "bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-300 ring-1 ring-inset ring-gray-200 dark:ring-gray-600",
  running:
    "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 ring-1 ring-inset ring-indigo-200 dark:ring-indigo-700",
  ok: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 ring-1 ring-inset ring-emerald-200 dark:ring-emerald-700",
  failed:
    "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 ring-1 ring-inset ring-red-200 dark:ring-red-700",
  cancelled:
    "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 ring-1 ring-inset ring-amber-200 dark:ring-amber-700",
};

/** Same shape but for stage entries — same five colors, narrower set. */
export const STAGE_STATUS_CLASSES: Record<
  FactoryRunStageProgressEntry["status"],
  string
> = {
  running: STATUS_PILL_CLASSES.running,
  ok: STATUS_PILL_CLASSES.ok,
  failed: STATUS_PILL_CLASSES.failed,
  skipped:
    "bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400 ring-1 ring-inset ring-gray-200 dark:ring-gray-700",
};

// ---------------------------------------------------------------------------
// Live-update merge — a thin model of how a duplex envelope mutates the
// loader's `RunDetail` shape. The route's polling loop revalidates the
// loader and gets the up-to-date row from the server; this helper exists so
// T074's vitest can simulate "events arriving" against a single reference
// detail object without spinning up a full client.
// ---------------------------------------------------------------------------

export type FactoryRunStageEvent =
  | {
      kind: "stage_started";
      runId: string;
      stageId: string;
      agentRef: FactoryAgentRef;
      startedAt: string;
    }
  | {
      kind: "stage_completed";
      runId: string;
      stageId: string;
      stageOutcome: "ok" | "failed" | "skipped";
      error?: string;
      completedAt: string;
    }
  | {
      kind: "completed";
      runId: string;
      tokenSpend: { input: number; output: number; total: number };
      completedAt: string;
    }
  | {
      kind: "failed";
      runId: string;
      error: string;
      completedAt: string;
    }
  | {
      kind: "cancelled";
      runId: string;
      completedAt: string;
      reason?: string;
    };

/**
 * Apply a single duplex envelope to a `RunDetail` object, returning a new
 * detail value. Mirrors the platform-side handler in
 * `api/factory/runDuplexHandlers.ts` so client-side optimistic updates and
 * server-side persistence stay in lock-step. Non-matching `runId` events
 * are ignored (defence in depth).
 *
 * Idempotency: a `stage_started` event for a stage already present as
 * `running` is a no-op; `stage_completed` for an unknown stage synthesises
 * an entry rather than fail (out-of-order delivery — spec 124 T032).
 */
export function applyStageEvent(
  detail: FactoryRunDetail,
  event: FactoryRunStageEvent
): FactoryRunDetail {
  if (event.runId !== detail.id) return detail;

  if (event.kind === "stage_started") {
    const existing = detail.stageProgress.find(
      (s) => s.stage_id === event.stageId && s.status === "running"
    );
    if (existing) return detail;
    const entry: FactoryRunStageProgressEntry = {
      stage_id: event.stageId,
      status: "running",
      started_at: event.startedAt,
      completed_at: null,
      agent_ref: event.agentRef,
    };
    return {
      ...detail,
      status: detail.status === "queued" ? "running" : detail.status,
      stageProgress: [...detail.stageProgress, entry],
      lastEventAt: event.startedAt,
    };
  }

  if (event.kind === "stage_completed") {
    const idx = detail.stageProgress.findIndex(
      (s) => s.stage_id === event.stageId && s.status === "running"
    );
    if (idx === -1) {
      // Out-of-order: synthesise the entry.
      const entry: FactoryRunStageProgressEntry = {
        stage_id: event.stageId,
        status: event.stageOutcome,
        started_at: event.completedAt,
        completed_at: event.completedAt,
        error: event.error ?? null,
      };
      return {
        ...detail,
        stageProgress: [...detail.stageProgress, entry],
        lastEventAt: event.completedAt,
      };
    }
    const next = detail.stageProgress.slice();
    next[idx] = {
      ...next[idx],
      status: event.stageOutcome,
      completed_at: event.completedAt,
      error: event.error ?? null,
    };
    return { ...detail, stageProgress: next, lastEventAt: event.completedAt };
  }

  if (event.kind === "completed") {
    return {
      ...detail,
      status: "ok",
      completedAt: event.completedAt,
      tokenSpend: event.tokenSpend,
      lastEventAt: event.completedAt,
    };
  }

  if (event.kind === "failed") {
    return {
      ...detail,
      status: "failed",
      completedAt: event.completedAt,
      error: event.error,
      lastEventAt: event.completedAt,
    };
  }

  // cancelled
  return {
    ...detail,
    status: "cancelled",
    completedAt: event.completedAt,
    lastEventAt: event.completedAt,
  };
}
