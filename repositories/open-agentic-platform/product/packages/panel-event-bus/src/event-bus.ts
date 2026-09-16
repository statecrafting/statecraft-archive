import type {
  EventTypeName,
  PanelInstanceId,
  EventTypeSchema,
  PanelEventContract,
  BusEvent,
  EventHandler,
  SubscribeOptions,
  EventBusOptions,
} from './types.js';
import { DEFAULT_RING_BUFFER_SIZE } from './types.js';
import { RingBuffer } from './ring-buffer.js';
import { matchesPattern, isWildcard } from './wildcards.js';

interface Subscription {
  subscriberPanel: PanelInstanceId;
  pattern: string;
  handler: EventHandler<any>;
}

/**
 * Typed inter-panel event bus (FR-001).
 *
 * Manages event registration, emission with contract enforcement,
 * subscriptions with wildcard support, source auto-exclusion,
 * and bounded event history via ring buffers.
 */
export class EventBus {
  private readonly eventTypes = new Map<EventTypeName, EventTypeSchema>();
  private readonly panels = new Map<PanelInstanceId, PanelEventContract>();
  private readonly subscriptions: Subscription[] = [];
  private readonly buffers = new Map<EventTypeName, RingBuffer>();
  private readonly maxPerType: number;

  constructor(options?: EventBusOptions) {
    this.maxPerType = options?.ringBuffer?.maxPerType ?? DEFAULT_RING_BUFFER_SIZE;
  }

  // --- Event type registration (FR-002) ---

  /** Register an event type with the bus. */
  registerEventType(schema: EventTypeSchema): void {
    this.eventTypes.set(schema.name, schema);
  }

  /** Check if an event type is registered. */
  hasEventType(name: EventTypeName): boolean {
    return this.eventTypes.has(name);
  }

  /** Get all registered event type names. */
  getEventTypeNames(): EventTypeName[] {
    return [...this.eventTypes.keys()];
  }

  // --- Panel registration (FR-003) ---

  /** Register a panel instance with its event contract. */
  registerPanel(instanceId: PanelInstanceId, contract: PanelEventContract): void {
    this.panels.set(instanceId, contract);
  }

  /** Unregister a panel, removing all its subscriptions (FR-007). */
  unregisterPanel(instanceId: PanelInstanceId): void {
    this.panels.delete(instanceId);
    // Remove all subscriptions for this panel
    for (let i = this.subscriptions.length - 1; i >= 0; i--) {
      if (this.subscriptions[i].subscriberPanel === instanceId) {
        this.subscriptions.splice(i, 1);
      }
    }
  }

  /** Check if a panel is registered. */
  hasPanel(instanceId: PanelInstanceId): boolean {
    return this.panels.has(instanceId);
  }

  // --- Emission (FR-002, FR-003, FR-004) ---

  /** Emit an event from a panel. Enforces contract and delivers to subscribers. */
  emit<T>(sourcePanel: PanelInstanceId, type: EventTypeName, payload: T): BusEvent<T> {
    // FR-002: Reject unregistered event types
    if (!this.eventTypes.has(type)) {
      throw new Error(`Event type "${type}" is not registered`);
    }

    // FR-003: Enforce panel contract — panel must declare this event in emits
    const contract = this.panels.get(sourcePanel);
    if (!contract) {
      throw new Error(`Panel "${sourcePanel}" is not registered`);
    }
    if (!contract.emits.includes(type)) {
      throw new Error(
        `Panel "${sourcePanel}" (type: ${contract.panelType}) is not allowed to emit "${type}". ` +
        `Declared emits: [${contract.emits.join(', ')}]`
      );
    }

    // Create event
    const event: BusEvent<T> = {
      id: crypto.randomUUID(),
      type,
      payload,
      sourcePanel,
      timestamp: Date.now(),
    };

    // Store in ring buffer (FR-005)
    let buffer = this.buffers.get(type);
    if (!buffer) {
      buffer = new RingBuffer(this.maxPerType);
      this.buffers.set(type, buffer);
    }
    buffer.push(event as BusEvent);

    // Deliver to subscribers (FR-004: skip source panel, FR-006: wildcard matching)
    for (const sub of this.subscriptions) {
      if (sub.subscriberPanel === sourcePanel) continue; // FR-004: auto-exclusion
      if (matchesPattern(type, sub.pattern)) {
        sub.handler(event);
      }
    }

    return event;
  }

  // --- Subscription (FR-003, FR-005, FR-006) ---

  /** Subscribe to events matching a pattern. Returns an unsubscribe function. */
  subscribe<T>(
    subscriberPanel: PanelInstanceId,
    pattern: string,
    handler: EventHandler<T>,
    options?: SubscribeOptions,
  ): () => void {
    // FR-003: Enforce panel contract — panel must declare matching subscriptions
    const contract = this.panels.get(subscriberPanel);
    if (!contract) {
      throw new Error(`Panel "${subscriberPanel}" is not registered`);
    }

    // Check that the subscription pattern is covered by the panel's declared subscribes
    const allowed = contract.subscribes.some(
      declared => matchesPattern(pattern, declared) || pattern === declared
    );
    // For wildcard patterns in subscribe call, check if any declared pattern matches
    const allowedWild = isWildcard(pattern)
      ? contract.subscribes.some(declared => pattern === declared)
      : contract.subscribes.some(declared => matchesPattern(pattern, declared));
    if (!allowedWild && !allowed) {
      throw new Error(
        `Panel "${subscriberPanel}" (type: ${contract.panelType}) is not allowed to subscribe to "${pattern}". ` +
        `Declared subscribes: [${contract.subscribes.join(', ')}]`
      );
    }

    const subscription: Subscription = {
      subscriberPanel,
      pattern,
      handler: handler as EventHandler<any>,
    };
    this.subscriptions.push(subscription);

    // FR-005: Replay recent events if requested
    if (options?.replay && options.replay > 0) {
      if (isWildcard(pattern)) {
        // Replay from all matching buffers
        const allEvents: BusEvent[] = [];
        for (const [eventType, buffer] of this.buffers) {
          if (matchesPattern(eventType, pattern)) {
            allEvents.push(...buffer.last(options.replay));
          }
        }
        // Sort by timestamp, take most recent N
        allEvents.sort((a, b) => b.timestamp - a.timestamp);
        const toReplay = allEvents.slice(0, options.replay).reverse(); // deliver oldest first
        for (const event of toReplay) {
          if (event.sourcePanel !== subscriberPanel) {
            handler(event as BusEvent<T>);
          }
        }
      } else {
        const buffer = this.buffers.get(pattern);
        if (buffer) {
          const events = buffer.last(options.replay).reverse(); // oldest first
          for (const event of events) {
            if (event.sourcePanel !== subscriberPanel) {
              handler(event as BusEvent<T>);
            }
          }
        }
      }
    }

    // Return unsubscribe function
    return () => {
      const idx = this.subscriptions.indexOf(subscription);
      if (idx !== -1) this.subscriptions.splice(idx, 1);
    };
  }

  // --- History (FR-008) ---

  /** Query past events for a type without subscribing. */
  history(type: EventTypeName, count?: number): BusEvent[] {
    const buffer = this.buffers.get(type);
    if (!buffer) return [];
    return buffer.last(count);
  }

  // --- Utility ---

  /** Clear all state. */
  reset(): void {
    this.eventTypes.clear();
    this.panels.clear();
    this.subscriptions.length = 0;
    this.buffers.clear();
  }
}
