import type {
  NotificationEvent,
  NotificationKind,
  Severity,
  NotificationPreferences,
  ChannelAdapter,
  NotifyResult,
} from "./types.js";
import { DedupIndex } from "./deduplication/dedup-index.js";
import type { DedupIndexOptions } from "./deduplication/dedup-index.js";
import { resolveChannels } from "./preferences/preference-engine.js";
import { PreferenceStore } from "./preferences/store.js";
import { EventLog } from "./log/event-log.js";
import type { EventLogOptions, EventLogQuery, EventLogEntry } from "./log/event-log.js";
import { LogPruner } from "./log/pruner.js";
import type { LogPrunerOptions } from "./log/pruner.js";

/**
 * Options for creating a notification event via {@link NotificationOrchestrator.notify}.
 * All fields from {@link NotificationEvent} except `id` and `timestamp`,
 * which are generated automatically.
 */
export interface NotifyOptions {
  provider: string;
  sessionId: string;
  kind: NotificationKind;
  severity: Severity;
  dedupeKey: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

/**
 * Options for constructing a {@link NotificationOrchestrator}.
 */
export interface OrchestratorOptions {
  /** Options forwarded to the internal {@link DedupIndex}. */
  dedup?: DedupIndexOptions;
  /** Initial user notification preferences (FR-005). */
  preferences?: NotificationPreferences;
  /** Options for the event log (FR-007). */
  eventLog?: EventLogOptions;
  /** Options for the log pruner (NF-003). */
  pruner?: LogPrunerOptions;
}

/**
 * Core notification orchestrator.
 *
 * Accepts typed notification events via `notify()`, builds a full
 * {@link NotificationEvent}, checks the sliding-window deduplication
 * index (Phase 2, FR-003/FR-004), and dispatches to all registered
 * {@link ChannelAdapter}s that report themselves as available.
 */
export class NotificationOrchestrator {
  private adapters: Map<string, ChannelAdapter> = new Map();
  private readonly dedup: DedupIndex;
  private readonly preferenceStore: PreferenceStore = new PreferenceStore();
  private readonly eventLog: EventLog;
  private readonly pruner: LogPruner;

  constructor(options?: OrchestratorOptions) {
    this.dedup = new DedupIndex(options?.dedup);
    if (options?.preferences) {
      this.preferenceStore.set(options.preferences);
    }
    this.eventLog = new EventLog(options?.eventLog);
    this.pruner = new LogPruner(this.eventLog, options?.pruner);
  }

  /**
   * Register a channel adapter. Replaces any existing adapter with the
   * same `channelId`.
   */
  registerAdapter(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.channelId, adapter);
  }

  /**
   * Remove a previously registered adapter by channel id.
   * Returns `true` if the adapter was found and removed.
   */
  unregisterAdapter(channelId: string): boolean {
    return this.adapters.delete(channelId);
  }

  /**
   * Get all registered adapter channel ids.
   */
  getAdapterIds(): string[] {
    return [...this.adapters.keys()];
  }

  /**
   * Replace the user's notification preferences (FR-005).
   */
  setPreferences(preferences: NotificationPreferences): void {
    this.preferenceStore.set(preferences);
  }

  /**
   * Return current notification preferences, or `null` if none are set.
   */
  getPreferences(): NotificationPreferences | null {
    return this.preferenceStore.get();
  }

  /**
   * Emit a notification event and dispatch to all available adapters (FR-001).
   *
   * Generates `id` (UUID) and `timestamp` (Date.now()) automatically.
   * Returns a {@link NotifyResult} describing delivery outcomes.
   */
  async notify(options: NotifyOptions): Promise<NotifyResult> {
    const event: NotificationEvent = {
      id: crypto.randomUUID(),
      provider: options.provider,
      sessionId: options.sessionId,
      kind: options.kind,
      severity: options.severity,
      dedupeKey: options.dedupeKey,
      title: options.title,
      body: options.body,
      timestamp: Date.now(),
      metadata: options.metadata ?? {},
    };

    // Phase 2: sliding-window deduplication (FR-003, FR-004).
    if (this.dedup.isDuplicate(event.dedupeKey, event.timestamp)) {
      const result: NotifyResult = {
        eventId: event.id,
        status: "suppressed",
        deliveredTo: [],
        failures: [],
      };
      // Phase 5: log suppressed-by-dedup events (FR-007, SC-004).
      this.eventLog.append(event, result.status, result.deliveredTo);
      return result;
    }

    // Phase 3: preference-gated delivery (FR-005).
    // Resolve which channels should receive this event.
    const prefs = this.preferenceStore.get();
    let allowedChannels: string[] | null = null;
    if (prefs) {
      allowedChannels = resolveChannels(event.kind, event.severity, prefs);
      // Empty resolved list = suppress delivery entirely.
      if (allowedChannels.length === 0) {
        const result: NotifyResult = {
          eventId: event.id,
          status: "suppressed",
          deliveredTo: [],
          failures: [],
        };
        // Phase 5: log suppressed-by-preference events (FR-007, SC-004).
        this.eventLog.append(event, result.status, result.deliveredTo);
        return result;
      }
    }

    const result = await this.dispatch(event, allowedChannels);
    // Phase 5: log delivered/partial events (FR-007, SC-004).
    this.eventLog.append(event, result.status, result.deliveredTo);
    return result;
  }

  /**
   * Query the event log (FR-007). Returns entries newest-first.
   */
  queryLog(filter?: EventLogQuery): EventLogEntry[] {
    return this.eventLog.query(filter);
  }

  /**
   * Get the number of entries in the event log.
   */
  get logSize(): number {
    return this.eventLog.size;
  }

  /**
   * Manually trigger log pruning. Returns the number of entries removed.
   */
  pruneLog(): number {
    return this.pruner.prune();
  }

  /**
   * Tear down internal resources (cleanup timers).
   */
  dispose(): void {
    this.dedup.dispose();
    this.pruner.dispose();
  }

  /**
   * Internal dispatch loop. Iterates registered adapters, filters by
   * availability and optional channel allowlist, and collects results.
   *
   * @param allowedChannels  When non-null, only adapters whose channelId
   *   appears in this list are considered (preference-gated delivery).
   *   When null, all available adapters are used.
   */
  private async dispatch(
    event: NotificationEvent,
    allowedChannels: string[] | null = null,
  ): Promise<NotifyResult> {
    const deliveredTo: string[] = [];
    const failures: Array<{ channelId: string; error: string }> = [];

    let availableAdapters = [...this.adapters.values()].filter((a) =>
      a.isAvailable()
    );

    // Phase 3: restrict to preference-allowed channels (FR-005).
    if (allowedChannels !== null) {
      const allowed = new Set(allowedChannels);
      availableAdapters = availableAdapters.filter((a) =>
        allowed.has(a.channelId)
      );
    }

    if (availableAdapters.length === 0) {
      return {
        eventId: event.id,
        status: "suppressed",
        deliveredTo: [],
        failures: [],
      };
    }

    await Promise.all(
      availableAdapters.map(async (adapter) => {
        try {
          await adapter.deliver(event);
          deliveredTo.push(adapter.channelId);
        } catch (err) {
          failures.push({
            channelId: adapter.channelId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
    );

    let status: NotifyResult["status"];
    if (failures.length === 0) {
      status = "delivered";
    } else if (deliveredTo.length === 0) {
      status = "suppressed";
    } else {
      status = "partial";
    }

    return { eventId: event.id, status, deliveredTo, failures };
  }
}
