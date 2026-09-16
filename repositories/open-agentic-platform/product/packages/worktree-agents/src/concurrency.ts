export type ConcurrencyMetrics = {
  maxConcurrent: number;
  activeCount: number;
  queuedCount: number;
};

type QueueEntry = {
  resolve: (release: () => void) => void;
};

/**
 * FIFO semaphore for background-agent slots (051 FR-002 / SC-002).
 * A caller acquires a slot and receives a `release()` function that must be
 * called exactly once when the agent reaches a terminal state.
 */
export class FifoConcurrencyLimiter {
  private readonly maxConcurrent: number;
  private activeCount = 0;
  private readonly queue: QueueEntry[] = [];

  constructor(maxConcurrent = 4) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent <= 0) {
      throw new Error(
        `maxConcurrent must be a positive integer, received: ${maxConcurrent}`,
      );
    }
    this.maxConcurrent = maxConcurrent;
  }

  acquire(): Promise<() => void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount += 1;
      return Promise.resolve(this.createRelease());
    }

    return new Promise((resolve) => {
      this.queue.push({ resolve });
    });
  }

  getMetrics(): ConcurrencyMetrics {
    return {
      maxConcurrent: this.maxConcurrent,
      activeCount: this.activeCount,
      queuedCount: this.queue.length,
    };
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.releaseOne();
    };
  }

  private releaseOne(): void {
    if (this.activeCount > 0) {
      this.activeCount -= 1;
    }

    const next = this.queue.shift();
    if (!next) {
      return;
    }

    this.activeCount += 1;
    next.resolve(this.createRelease());
  }
}
