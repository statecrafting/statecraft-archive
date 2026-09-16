/**
 * Sliding-window deduplication index (FR-003, FR-004, NF-002).
 *
 * Tracks `dedupeKey` timestamps in a memory-resident Map. An event is
 * considered a duplicate if a previous event with the same key was seen
 * within the configured window. Each duplicate resets the window
 * (FR-003: "the window resets on each new duplicate").
 *
 * Periodic cleanup removes expired entries so the map does not grow
 * unboundedly (NF-002: up to 10,000 active keys without overhead).
 */

/** Default deduplication window in milliseconds (20 seconds per spec). */
export const DEFAULT_WINDOW_MS = 20_000;

/** Default cleanup interval — run every 60 seconds. */
export const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;

export interface DedupIndexOptions {
  /** Sliding window duration in milliseconds (default 20 000). */
  windowMs?: number;
  /** Interval between automatic cleanup sweeps in milliseconds (default 60 000). Set to 0 to disable. */
  cleanupIntervalMs?: number;
  /** Clock function for testability — returns current time in ms. */
  now?: () => number;
}

export class DedupIndex {
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly keys: Map<string, number> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: DedupIndexOptions) {
    this.windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS;
    this.now = options?.now ?? (() => Date.now());

    const cleanupIntervalMs =
      options?.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;

    if (cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs);
      // Allow the process to exit even if the timer is still running.
      if (typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
        this.cleanupTimer.unref();
      }
    }
  }

  /**
   * Check whether `dedupeKey` is a duplicate within the current window.
   *
   * - If no entry exists or the entry has expired, records the key and
   *   returns `false` (not a duplicate — deliver the event).
   * - If an entry exists and is within the window, updates the timestamp
   *   (resetting the window per FR-003) and returns `true` (duplicate —
   *   suppress the event).
   */
  isDuplicate(dedupeKey: string, timestamp?: number): boolean {
    const ts = timestamp ?? this.now();
    const lastSeen = this.keys.get(dedupeKey);

    if (lastSeen !== undefined && ts - lastSeen < this.windowMs) {
      // Duplicate — reset the window.
      this.keys.set(dedupeKey, ts);
      return true;
    }

    // New or expired — record and allow delivery.
    this.keys.set(dedupeKey, ts);
    return false;
  }

  /** Number of tracked (possibly expired) keys. */
  get size(): number {
    return this.keys.size;
  }

  /** Remove all entries whose window has expired. */
  cleanup(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, ts] of this.keys) {
      if (now - ts >= this.windowMs) {
        this.keys.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Clear all entries and stop the cleanup timer. */
  dispose(): void {
    this.keys.clear();
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
