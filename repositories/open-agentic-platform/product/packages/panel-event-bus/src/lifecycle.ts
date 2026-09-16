import type { PanelInstanceId, PanelEventContract, EventHandler, SubscribeOptions } from './types.js';
import { EventBus } from './event-bus.js';

/**
 * Handle returned from `mountPanel` for lifecycle management (FR-007).
 * Tracks all subscriptions and cleans up on unmount.
 */
export interface PanelHandle {
  /** The panel instance ID. */
  readonly instanceId: PanelInstanceId;

  /** Subscribe to events. The subscription is tracked and cleaned up on unmount. */
  subscribe<T>(
    pattern: string,
    handler: EventHandler<T>,
    options?: SubscribeOptions,
  ): () => void;

  /** Emit an event from this panel. */
  emit<T>(type: string, payload: T): void;

  /** Unmount the panel: unregisters from bus, removes all subscriptions. */
  unmount(): void;

  /** Whether the panel is still mounted. */
  readonly mounted: boolean;
}

/**
 * Mount a panel on the bus (FR-007 lifecycle integration).
 *
 * Returns a PanelHandle that:
 * - Tracks subscriptions made through it
 * - Provides scoped emit/subscribe (no need to pass instanceId each time)
 * - Cleans up everything on unmount()
 */
export function mountPanel(
  bus: EventBus,
  instanceId: PanelInstanceId,
  contract: PanelEventContract,
): PanelHandle {
  bus.registerPanel(instanceId, contract);

  const unsubscribers: Array<() => void> = [];
  let isMounted = true;

  const handle: PanelHandle = {
    get instanceId() {
      return instanceId;
    },

    subscribe<T>(
      pattern: string,
      handler: EventHandler<T>,
      options?: SubscribeOptions,
    ): () => void {
      if (!isMounted) throw new Error(`Panel "${instanceId}" is not mounted`);
      const unsub = bus.subscribe(instanceId, pattern, handler, options);
      unsubscribers.push(unsub);
      return () => {
        const idx = unsubscribers.indexOf(unsub);
        if (idx !== -1) unsubscribers.splice(idx, 1);
        unsub();
      };
    },

    emit<T>(type: string, payload: T): void {
      if (!isMounted) throw new Error(`Panel "${instanceId}" is not mounted`);
      bus.emit(instanceId, type, payload);
    },

    unmount(): void {
      if (!isMounted) return;
      isMounted = false;
      // Clean up all tracked subscriptions
      for (const unsub of unsubscribers) {
        unsub();
      }
      unsubscribers.length = 0;
      bus.unregisterPanel(instanceId);
    },

    get mounted() {
      return isMounted;
    },
  };

  return handle;
}
