import type {
  NotificationEvent,
  NotificationKind,
  Severity,
  DeliveryStatus,
} from "../types.js";

/**
 * A persisted event log entry combining the notification event
 * with its delivery outcome (FR-007, SC-004).
 */
export interface EventLogEntry {
  /** The full notification event. */
  event: NotificationEvent;
  /** Delivery outcome at time of logging. */
  status: DeliveryStatus;
  /** Channels that successfully delivered. */
  deliveredTo: string[];
  /** Timestamp when the entry was logged (ms). */
  loggedAt: number;
}

/**
 * Query filter for retrieving event log entries (FR-007).
 * All fields are optional — omitted fields match everything.
 */
export interface EventLogQuery {
  /** Filter by session id. */
  sessionId?: string;
  /** Filter by notification kind. */
  kind?: NotificationKind;
  /** Filter by severity. */
  severity?: Severity;
  /** Filter by delivery status. */
  status?: DeliveryStatus;
  /** Inclusive lower bound (ms timestamp). */
  from?: number;
  /** Inclusive upper bound (ms timestamp). */
  to?: number;
  /** Maximum entries to return (newest first). */
  limit?: number;
}

/**
 * Options for constructing an {@link EventLog}.
 */
export interface EventLogOptions {
  /** Injectable clock for testing. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * In-memory event log that persists all notification events — both
 * delivered and suppressed — for later querying (FR-007, SC-004).
 *
 * Entries are stored in insertion order. Queries return newest-first.
 */
export class EventLog {
  private entries: EventLogEntry[] = [];
  private readonly now: () => number;

  constructor(options?: EventLogOptions) {
    this.now = options?.now ?? (() => Date.now());
  }

  /**
   * Append an event with its delivery outcome to the log.
   * Both delivered and suppressed events are recorded (SC-004).
   */
  append(
    event: NotificationEvent,
    status: DeliveryStatus,
    deliveredTo: string[] = [],
  ): EventLogEntry {
    const entry: EventLogEntry = {
      event,
      status,
      deliveredTo: [...deliveredTo],
      loggedAt: this.now(),
    };
    this.entries.push(entry);
    return entry;
  }

  /**
   * Query the event log with optional filters (FR-007).
   * Returns entries newest-first (by event timestamp).
   */
  query(filter?: EventLogQuery): EventLogEntry[] {
    let results = this.entries;

    if (filter) {
      results = results.filter((entry) => {
        if (
          filter.sessionId !== undefined &&
          entry.event.sessionId !== filter.sessionId
        ) {
          return false;
        }
        if (filter.kind !== undefined && entry.event.kind !== filter.kind) {
          return false;
        }
        if (
          filter.severity !== undefined &&
          entry.event.severity !== filter.severity
        ) {
          return false;
        }
        if (
          filter.status !== undefined &&
          entry.status !== filter.status
        ) {
          return false;
        }
        if (
          filter.from !== undefined &&
          entry.event.timestamp < filter.from
        ) {
          return false;
        }
        if (filter.to !== undefined && entry.event.timestamp > filter.to) {
          return false;
        }
        return true;
      });
    }

    // Newest first by event timestamp.
    results = [...results].sort(
      (a, b) => b.event.timestamp - a.event.timestamp,
    );

    if (filter?.limit !== undefined && filter.limit >= 0) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /**
   * Return total number of entries in the log.
   */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Remove all entries whose event timestamp is older than `cutoffMs`.
   * Returns the number of entries removed.
   */
  prune(cutoffMs: number): number {
    const before = this.entries.length;
    this.entries = this.entries.filter(
      (entry) => entry.event.timestamp >= cutoffMs,
    );
    return before - this.entries.length;
  }

  /**
   * Remove all entries from the log.
   */
  clear(): void {
    this.entries = [];
  }
}
