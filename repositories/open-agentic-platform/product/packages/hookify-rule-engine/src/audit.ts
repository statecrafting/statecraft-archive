/**
 * Hook execution audit logger (NF-002).
 *
 * All hook executions are logged with: event type, hook name, handler type,
 * duration, and result (block/warn/allow/modify/error).
 */

import type { HookAuditEntry } from "./types.js";

export interface AuditSink {
  log(entry: HookAuditEntry): void;
}

/**
 * Console-based audit sink — writes structured JSON to stderr.
 */
export const consoleAuditSink: AuditSink = {
  log(entry: HookAuditEntry): void {
    const line = JSON.stringify({
      _type: "hook_audit",
      event: entry.eventType,
      hook: entry.hookName,
      handler: entry.handlerType,
      durationMs: entry.durationMs,
      result: entry.result,
      ...(entry.message ? { message: entry.message } : {}),
      ts: entry.timestamp,
    });
    process.stderr.write(`${line}\n`);
  },
};

/**
 * In-memory audit sink — captures entries for testing and inspection.
 */
export class MemoryAuditSink implements AuditSink {
  readonly entries: HookAuditEntry[] = [];

  log(entry: HookAuditEntry): void {
    this.entries.push(entry);
  }

  clear(): void {
    this.entries.length = 0;
  }
}

/**
 * No-op audit sink — discards all entries.
 */
export const nullAuditSink: AuditSink = {
  log(): void {
    // intentionally empty
  },
};
