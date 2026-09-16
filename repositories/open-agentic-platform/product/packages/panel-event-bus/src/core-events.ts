import type { EventTypeSchema, EventBusOptions } from './types.js';
import { EventBus } from './event-bus.js';

// --- Core event payload types ---

export interface CommandExecutedPayload {
  command: string;
  exitCode: number;
  cwd?: string;
}

export interface OutputReceivedPayload {
  text: string;
  stream: 'stdout' | 'stderr';
}

export interface FilesChangedPayload {
  paths: string[];
  kind: 'created' | 'modified' | 'deleted';
}

export interface FileOpenedPayload {
  path: string;
  line?: number;
}

export interface FileSavedPayload {
  path: string;
}

export interface GitCommitPayload {
  sha: string;
  message: string;
  branch: string;
}

export interface GitPushPayload {
  remote: string;
  branch: string;
}

export interface GitPullPayload {
  remote: string;
  branch: string;
  mergeCommit?: string;
}

export interface GitBranchPayload {
  action: 'create' | 'switch' | 'delete';
  branch: string;
  previousBranch?: string;
}

export interface AgentMessagePayload {
  agentId: string;
  sessionId: string;
  content: string;
}

export interface AgentToolInvokedPayload {
  agentId: string;
  sessionId: string;
  tool: string;
  args?: Record<string, unknown>;
}

// --- Event type schemas ---

export const CORE_EVENT_SCHEMAS: EventTypeSchema[] = [
  { name: 'terminal:command_executed' },
  { name: 'terminal:output_received' },
  { name: 'files:changed' },
  { name: 'files:opened' },
  { name: 'files:saved' },
  { name: 'git:operation_commit' },
  { name: 'git:operation_push' },
  { name: 'git:operation_pull' },
  { name: 'git:operation_branch' },
  { name: 'agent:message_received' },
  { name: 'agent:tool_invoked' },
];

/** All core event type names. */
export const CORE_EVENT_NAMES = CORE_EVENT_SCHEMAS.map(s => s.name);

/**
 * Create an EventBus pre-loaded with all core event types.
 * Convenience factory for the common case.
 */
export function createBusWithCoreEvents(options?: EventBusOptions): EventBus {
  const bus = new EventBus(options);
  for (const schema of CORE_EVENT_SCHEMAS) {
    bus.registerEventType(schema);
  }
  return bus;
}
