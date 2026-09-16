/** Namespace-qualified event type identifier (e.g., "terminal:command_executed"). */
export type EventTypeName = string;

/** Unique identifier for a panel instance. */
export type PanelInstanceId = string;

/** Schema entry for a registered event type (FR-002). */
export interface EventTypeSchema<T = unknown> {
  name: EventTypeName;
  /** Optional runtime validator for payloads. */
  validate?: (payload: unknown) => payload is T;
}

/** An emitted event instance stored in the bus. */
export interface BusEvent<T = unknown> {
  id: string;
  type: EventTypeName;
  payload: T;
  sourcePanel: PanelInstanceId;
  timestamp: number;
}

/** What a panel declares about its event interactions (FR-003). */
export interface PanelEventContract {
  panelType: string;
  emits: EventTypeName[];
  subscribes: EventTypeName[];
}

/** Handler callback for event subscriptions. */
export type EventHandler<T = unknown> = (event: BusEvent<T>) => void;

/** Options for subscribing to events. */
export interface SubscribeOptions {
  /** Number of recent events to replay on subscription (FR-005). */
  replay?: number;
}

/** Configuration for the event bus ring buffer. */
export interface RingBufferOptions {
  /** Maximum events per type (default 50). */
  maxPerType?: number;
}

/** Full configuration for the EventBus. */
export interface EventBusOptions {
  /** Ring buffer configuration. */
  ringBuffer?: RingBufferOptions;
}

/** Default ring buffer size per event type (FR-005). */
export const DEFAULT_RING_BUFFER_SIZE = 50;
