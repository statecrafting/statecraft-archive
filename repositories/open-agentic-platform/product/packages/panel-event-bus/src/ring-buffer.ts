import type { BusEvent } from './types.js';

/**
 * Bounded ring buffer for event history (FR-005).
 * Stores up to `capacity` events, overwriting the oldest when full.
 */
export class RingBuffer<T = unknown> {
  private readonly buffer: Array<BusEvent<T> | undefined>;
  private head = 0;
  private count = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  /** Push an event into the buffer. */
  push(event: BusEvent<T>): void {
    this.buffer[this.head] = event;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Return the last `n` events (newest first). */
  last(n?: number): BusEvent<T>[] {
    const take = Math.min(n ?? this.count, this.count);
    const result: BusEvent<T>[] = [];
    for (let i = 0; i < take; i++) {
      const idx = (this.head - 1 - i + this.capacity) % this.capacity;
      result.push(this.buffer[idx]!);
    }
    return result;
  }

  /** Number of events stored. */
  get size(): number {
    return this.count;
  }

  /** Clear all events. */
  clear(): void {
    this.buffer.fill(undefined);
    this.head = 0;
    this.count = 0;
  }
}
