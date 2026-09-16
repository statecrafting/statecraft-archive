export type {
  NotificationKind,
  Severity,
  NotificationEvent,
  ChannelAdapter,
  PreferenceRule,
  NotificationPreferences,
  DeliveryStatus,
  NotifyResult,
} from "./types.js";

export { NotificationOrchestrator } from "./orchestrator.js";
export type { NotifyOptions, OrchestratorOptions } from "./orchestrator.js";

export { DedupIndex, DEFAULT_WINDOW_MS } from "./deduplication/dedup-index.js";
export type { DedupIndexOptions } from "./deduplication/dedup-index.js";

export { resolveChannels } from "./preferences/preference-engine.js";
export { PreferenceStore } from "./preferences/store.js";

export { NativeNotificationAdapter } from "./channels/native.js";
export type { NativeNotificationAdapterOptions } from "./channels/native.js";

export { WebPushAdapter } from "./channels/web-push.js";
export type {
  PushRegistration,
  WebPushAdapterOptions,
} from "./channels/web-push.js";

export { ToastAdapter } from "./channels/toast.js";
export type { ToastHandler, ToastAdapterOptions } from "./channels/toast.js";

export { EventLog } from "./log/event-log.js";
export type {
  EventLogEntry,
  EventLogQuery,
  EventLogOptions,
} from "./log/event-log.js";

export { LogPruner, DEFAULT_RETENTION_MS, DEFAULT_PRUNE_INTERVAL_MS } from "./log/pruner.js";
export type { LogPrunerOptions } from "./log/pruner.js";

export {
  createNotifyOptions,
  connectLifecycleBus,
  DEFAULT_LIFECYCLE_MAPPINGS,
} from "./integration.js";
export type {
  AgentLifecycleStatus,
  AgentLifecycleEvent,
  LifecycleMapping,
  ConnectOptions,
  LifecycleEventSource,
  ConnectionHandle,
} from "./integration.js";
