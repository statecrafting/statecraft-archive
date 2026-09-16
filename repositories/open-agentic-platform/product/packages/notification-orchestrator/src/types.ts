/**
 * Notification kinds corresponding to agent lifecycle events (FR-008).
 */
export type NotificationKind =
  | "task_complete"
  | "task_error"
  | "permission_request"
  | "progress_update"
  | "system_alert";

/**
 * Event severity levels, ordered from least to most urgent.
 */
export type Severity = "info" | "warning" | "error" | "critical";

/**
 * A structured notification event emitted by any subsystem (FR-002).
 *
 * The `provider` field maps to a provider id from the Multi-Provider Agent
 * Registry (spec 042). The `dedupeKey` is used by the deduplication index
 * (Phase 2) to collapse duplicate events within a sliding window.
 */
export interface NotificationEvent {
  /** Unique event identifier (UUID via crypto.randomUUID). */
  id: string;
  /** Provider that originated the event (maps to 042 ProviderId). */
  provider: string;
  /** Owning agent session. */
  sessionId: string;
  /** Classification of the event. */
  kind: NotificationKind;
  /** Urgency level. */
  severity: Severity;
  /** Key for sliding-window deduplication. */
  dedupeKey: string;
  /** Short display title. */
  title: string;
  /** Longer human-readable description. */
  body: string;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
  /** Arbitrary extra data attached by the caller. */
  metadata: Record<string, unknown>;
}

/**
 * Pluggable delivery backend for a single notification channel (FR-006).
 *
 * Each adapter represents one delivery mechanism (native OS, web push,
 * in-app toast, etc.). The orchestrator iterates registered adapters and
 * calls `deliver()` on each available channel.
 */
export interface ChannelAdapter {
  /** Stable channel identifier, e.g. "native", "web-push", "toast". */
  readonly channelId: string;
  /** Deliver a notification event through this channel. */
  deliver(event: NotificationEvent): Promise<void>;
  /** Runtime availability check (e.g. OS notification permission granted). */
  isAvailable(): boolean;
}

/**
 * A single preference rule controlling which channels receive events
 * matching a given kind and/or severity (FR-005).
 *
 * When both `kind` and `severity` are specified, both must match.
 * Omitting a field means "match all" for that dimension.
 * An empty `channels` array suppresses delivery entirely.
 */
export interface PreferenceRule {
  /** Match a specific notification kind, or all kinds if omitted. */
  kind?: NotificationKind;
  /** Match a specific severity, or all severities if omitted. */
  severity?: Severity;
  /** Channel ids to deliver to. Empty array = suppress. */
  channels: string[];
}

/**
 * User notification preferences (FR-005).
 *
 * Rules are evaluated in order; the first matching rule wins.
 * If no rule matches, `defaultChannels` is used as the fallback.
 */
export interface NotificationPreferences {
  /** Ordered preference rules — first match wins. */
  rules: PreferenceRule[];
  /** Fallback channels when no rule matches. */
  defaultChannels: string[];
}

/**
 * Delivery outcome for a single notification event.
 */
export type DeliveryStatus = "delivered" | "suppressed" | "partial";

/**
 * Result returned by `notify()` describing what happened (FR-001).
 */
export interface NotifyResult {
  /** The event id. */
  eventId: string;
  /** Overall delivery status. */
  status: DeliveryStatus;
  /** Channels that successfully delivered the event. */
  deliveredTo: string[];
  /** Channels that failed, with error details. */
  failures: Array<{ channelId: string; error: string }>;
}
