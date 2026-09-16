/**
 * Background expiry sweeper (SC-004).
 *
 * Periodically removes expired memory entries from the database.
 */

import type { MemoryStorage } from "../storage/sqlite.js";

export interface SweeperOptions {
  /** Sweep interval in milliseconds. Default: 60_000 (1 minute). */
  intervalMs?: number;
}

export interface SweeperResult {
  deletedCount: number;
  sweptAt: number;
}

export class ExpirySweeper {
  private storage: MemoryStorage;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastResult: SweeperResult | null = null;

  constructor(storage: MemoryStorage, options?: SweeperOptions) {
    this.storage = storage;
    this.intervalMs = options?.intervalMs ?? 60_000;
  }

  /** Run a single sweep. Returns count of deleted entries. */
  sweep(): SweeperResult {
    const deletedCount = this.storage.sweepExpired();
    this.lastResult = { deletedCount, sweptAt: Math.floor(Date.now() / 1000) };
    return this.lastResult;
  }

  /** Start the background sweep timer. */
  start(): void {
    if (this.timer) return;
    // Run an initial sweep immediately
    this.sweep();
    this.timer = setInterval(() => this.sweep(), this.intervalMs);
    // Allow the process to exit even if the timer is running
    if (this.timer && typeof this.timer === "object" && "unref" in this.timer) {
      this.timer.unref();
    }
  }

  /** Stop the background sweep timer. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Get the result of the last sweep. */
  getLastResult(): SweeperResult | null {
    return this.lastResult;
  }

  /** Check if the sweeper is running. */
  isRunning(): boolean {
    return this.timer !== null;
  }
}
