import type { EventLog } from "./event-log.js";

/** 30 days in milliseconds (NF-003 default). */
export const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

/** 24 hours in milliseconds — default automatic pruning interval. */
export const DEFAULT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

/**
 * Options for constructing a {@link LogPruner}.
 */
export interface LogPrunerOptions {
  /** Retention period in milliseconds. Defaults to 30 days (NF-003). */
  retentionMs?: number;
  /**
   * Automatic pruning interval in milliseconds. Set to `0` to disable
   * automatic pruning. Defaults to 24 hours.
   */
  pruneIntervalMs?: number;
  /** Injectable clock for testing. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Retention-based log pruner (NF-003).
 *
 * Removes event log entries older than `retentionMs` (default 30 days).
 * Supports both manual `prune()` calls and an automatic interval timer.
 */
export class LogPruner {
  private readonly log: EventLog;
  private readonly retentionMs: number;
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(log: EventLog, options?: LogPrunerOptions) {
    this.log = log;
    this.retentionMs = options?.retentionMs ?? DEFAULT_RETENTION_MS;
    this.now = options?.now ?? (() => Date.now());

    const interval = options?.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;
    if (interval > 0) {
      this.timer = setInterval(() => this.prune(), interval);
      // Don't keep the process alive just for pruning.
      if (typeof this.timer === "object" && "unref" in this.timer) {
        this.timer.unref();
      }
    }
  }

  /**
   * Remove all entries older than the retention period.
   * Returns the number of entries pruned.
   */
  prune(): number {
    const cutoff = this.now() - this.retentionMs;
    return this.log.prune(cutoff);
  }

  /**
   * The retention period in milliseconds.
   */
  get retention(): number {
    return this.retentionMs;
  }

  /**
   * Stop the automatic pruning timer and release resources.
   */
  dispose(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
