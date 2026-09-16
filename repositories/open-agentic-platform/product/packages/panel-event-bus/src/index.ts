// Types
export type {
  EventTypeName,
  PanelInstanceId,
  EventTypeSchema,
  BusEvent,
  PanelEventContract,
  EventHandler,
  SubscribeOptions,
  RingBufferOptions,
  EventBusOptions,
} from './types.js';
export { DEFAULT_RING_BUFFER_SIZE } from './types.js';

// Core bus
export { EventBus } from './event-bus.js';
export { RingBuffer } from './ring-buffer.js';

// Contracts
export { defineContract, mergeContracts, validateContract } from './contracts.js';

// Wildcards
export { isWildcard, patternToRegExp, matchesPattern } from './wildcards.js';

// Lifecycle
export type { PanelHandle } from './lifecycle.js';
export { mountPanel } from './lifecycle.js';

// Core events
export type {
  CommandExecutedPayload,
  OutputReceivedPayload,
  FilesChangedPayload,
  FileOpenedPayload,
  FileSavedPayload,
  GitCommitPayload,
  GitPushPayload,
  GitPullPayload,
  GitBranchPayload,
  AgentMessagePayload,
  AgentToolInvokedPayload,
} from './core-events.js';
export { CORE_EVENT_SCHEMAS, CORE_EVENT_NAMES, createBusWithCoreEvents } from './core-events.js';
