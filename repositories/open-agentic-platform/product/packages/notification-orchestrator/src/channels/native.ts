import type { ChannelAdapter, NotificationEvent } from "../types.js";

/**
 * Options for constructing a {@link NativeNotificationAdapter}.
 */
export interface NativeNotificationAdapterOptions {
  /**
   * Injected Notification constructor for environments where the global
   * `Notification` is unavailable or for testing. When omitted, the adapter
   * reads `globalThis.Notification`.
   */
  NotificationCtor?: typeof Notification;
}

/**
 * Channel adapter that delivers notifications via the Web Notification API
 * (supported in Electron and Tauri webviews).
 *
 * `isAvailable()` returns `true` only when the Notification API exists and
 * permission is `"granted"` (R-001 — graceful fallback when native is
 * unavailable or denied).
 */
export class NativeNotificationAdapter implements ChannelAdapter {
  readonly channelId = "native";
  private readonly ctor: typeof Notification | undefined;

  constructor(options?: NativeNotificationAdapterOptions) {
    this.ctor =
      options?.NotificationCtor ??
      (typeof globalThis !== "undefined"
        ? (globalThis as Record<string, unknown>).Notification as
            | typeof Notification
            | undefined
        : undefined);
  }

  isAvailable(): boolean {
    if (!this.ctor) return false;
    return this.ctor.permission === "granted";
  }

  async deliver(event: NotificationEvent): Promise<void> {
    if (!this.ctor) {
      throw new Error("Notification API is not available");
    }
    new this.ctor(event.title, {
      body: event.body,
      tag: event.dedupeKey,
      data: {
        eventId: event.id,
        kind: event.kind,
        severity: event.severity,
        sessionId: event.sessionId,
        provider: event.provider,
      },
    });
  }
}
