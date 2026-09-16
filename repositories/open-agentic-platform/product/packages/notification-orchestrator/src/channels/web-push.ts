import type { ChannelAdapter, NotificationEvent } from "../types.js";

/**
 * Minimal interface for a service worker registration that supports
 * `showNotification`. Keeps the adapter testable without requiring a
 * full `ServiceWorkerRegistration`.
 */
export interface PushRegistration {
  showNotification(
    title: string,
    options?: NotificationOptions,
  ): Promise<void>;
}

/**
 * Options for constructing a {@link WebPushAdapter}.
 */
export interface WebPushAdapterOptions {
  /**
   * Supply the service worker registration (or a compatible stub) that
   * will display push notifications. When omitted, the adapter is
   * permanently unavailable (`isAvailable()` returns `false`).
   */
  registration?: PushRegistration | null;
}

/**
 * Channel adapter that delivers notifications via the Service Worker
 * Push API (`ServiceWorkerRegistration.showNotification`).
 *
 * `isAvailable()` returns `true` only when a registration has been provided.
 * Callers are responsible for obtaining and passing the registration
 * (e.g., via `navigator.serviceWorker.ready`).
 */
export class WebPushAdapter implements ChannelAdapter {
  readonly channelId = "web-push";
  private registration: PushRegistration | null;

  constructor(options?: WebPushAdapterOptions) {
    this.registration = options?.registration ?? null;
  }

  /**
   * Replace the current service worker registration at runtime
   * (e.g., after the user grants push permission).
   */
  setRegistration(registration: PushRegistration | null): void {
    this.registration = registration;
  }

  isAvailable(): boolean {
    return this.registration !== null;
  }

  async deliver(event: NotificationEvent): Promise<void> {
    if (!this.registration) {
      throw new Error("No service worker registration available");
    }
    await this.registration.showNotification(event.title, {
      body: event.body,
      tag: event.dedupeKey,
      data: {
        eventId: event.id,
        kind: event.kind,
        severity: event.severity,
        sessionId: event.sessionId,
        provider: event.provider,
        metadata: event.metadata,
      },
    });
  }
}
