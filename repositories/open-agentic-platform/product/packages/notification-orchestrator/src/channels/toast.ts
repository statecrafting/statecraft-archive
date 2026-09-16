import type { ChannelAdapter, NotificationEvent } from "../types.js";

/**
 * Callback invoked when a toast notification should be displayed.
 * The UI layer (e.g., `packages/ui/src/toast.tsx`) subscribes via
 * {@link ToastAdapter.onToast} and renders accordingly.
 */
export type ToastHandler = (event: NotificationEvent) => void;

/**
 * Options for constructing a {@link ToastAdapter}.
 */
export interface ToastAdapterOptions {
  /**
   * When `true`, the adapter reports itself as unavailable
   * (e.g., during SSR or headless test runs). Default: `false`.
   */
  disabled?: boolean;
}

/**
 * Channel adapter that emits notification events for in-app toast rendering.
 *
 * Unlike native and web-push adapters, the toast adapter does not depend
 * on browser APIs — it simply invokes registered handler callbacks,
 * decoupling the notification orchestrator from any specific UI framework.
 *
 * Always available unless explicitly disabled via options.
 */
export class ToastAdapter implements ChannelAdapter {
  readonly channelId = "toast";
  private handlers: Set<ToastHandler> = new Set();
  private readonly disabled: boolean;

  constructor(options?: ToastAdapterOptions) {
    this.disabled = options?.disabled ?? false;
  }

  isAvailable(): boolean {
    return !this.disabled;
  }

  /**
   * Register a handler to be called on each toast delivery.
   * Returns an unsubscribe function.
   */
  onToast(handler: ToastHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async deliver(event: NotificationEvent): Promise<void> {
    for (const handler of this.handlers) {
      handler(event);
    }
  }
}
