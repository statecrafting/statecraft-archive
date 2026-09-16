/**
 * HookRegistry — multi-source hook registration and async dispatch engine.
 *
 * FR-004: Priority-ordered dispatch (highest first), short-circuit on block.
 * FR-005: Multi-source registration (settings, rule files, manifests, programmatic).
 * FR-008: Hot-reload integration via file watcher on rule directory.
 * FR-009: Failure handling — non-blocking unless failMode is "block".
 * NF-001: <5ms dispatch overhead when no hooks match.
 * NF-003: Supports 100+ registered hooks without degradation.
 * R-003: Re-entrancy guard prevents circular hook dispatch.
 */

import type { AuditSink } from "./audit.js";
import { nullAuditSink } from "./audit.js";
import { evaluateConditionNode } from "./conditions.js";
import type { AgentDispatchFn, PromptDisplayFn } from "./handlers.js";
import { executeHandler } from "./handlers.js";
import { matchesRuleMatcher } from "./matcher.js";
import type {
  HookAuditEntry,
  HookDispatchResult,
  HookEventType,
  RegisteredHook,
} from "./types.js";

export interface HookRegistryOptions {
  auditSink?: AuditSink;
  agentDispatch?: AgentDispatchFn;
  promptDisplay?: PromptDisplayFn;
}

export class HookRegistry {
  private hooks: RegisteredHook[] = [];
  private sorted = false;
  private dispatching = false; // R-003: re-entrancy guard
  private readonly auditSink: AuditSink;
  private readonly agentDispatch?: AgentDispatchFn;
  private readonly promptDisplay?: PromptDisplayFn;

  constructor(options: HookRegistryOptions = {}) {
    this.auditSink = options.auditSink ?? nullAuditSink;
    this.agentDispatch = options.agentDispatch;
    this.promptDisplay = options.promptDisplay;
  }

  /** Register a hook from any source (FR-005d). */
  register(hook: RegisteredHook): void {
    this.hooks.push(hook);
    this.sorted = false;
  }

  /** Register multiple hooks at once. */
  registerAll(hooks: RegisteredHook[]): void {
    for (const hook of hooks) {
      this.hooks.push(hook);
    }
    this.sorted = false;
  }

  /** Remove all hooks from a given source (useful for hot-reload). */
  removeBySource(source: RegisteredHook["source"]): void {
    this.hooks = this.hooks.filter((h) => h.source !== source);
    this.sorted = false;
  }

  /** Replace all hooks from a given source atomically (FR-008). */
  replaceSource(source: RegisteredHook["source"], hooks: RegisteredHook[]): void {
    this.removeBySource(source);
    this.registerAll(hooks);
  }

  /** Total number of registered hooks. */
  get size(): number {
    return this.hooks.length;
  }

  /** Get all hooks (sorted by priority descending). */
  getAll(): readonly RegisteredHook[] {
    this.ensureSorted();
    return this.hooks;
  }

  /**
   * Dispatch an event through all matching hooks (FR-004).
   *
   * Hooks execute in priority order (highest first). A block action from any
   * hook short-circuits remaining hooks. Modify actions patch the payload for
   * subsequent hooks. Failures are non-blocking unless failMode is "block".
   */
  async dispatch(
    event: HookEventType,
    payload: Record<string, unknown>,
  ): Promise<HookDispatchResult> {
    // R-003: prevent circular dispatch
    if (this.dispatching) {
      return { outcome: "allowed" };
    }

    this.ensureSorted();

    // NF-001: fast path — no hooks for this event
    const matching = this.findMatching(event, payload);
    if (matching.length === 0) {
      return { outcome: "allowed" };
    }

    this.dispatching = true;
    let currentPayload = { ...payload };
    let modified = false;

    try {
      for (const hook of matching) {
        const start = Date.now();
        let auditResult: HookAuditEntry["result"] = "allow";
        let auditMessage: string | undefined;

        try {
          const handlerResult = await executeHandler(
            hook.handler,
            {
              event,
              payload: currentPayload,
            },
            hook.timeoutMs,
            hook.action,
            {
              agentDispatch: this.agentDispatch,
              promptDisplay: this.promptDisplay,
            },
          );

          const action = handlerResult.action;

          switch (action.type) {
            case "block": {
              auditResult = "block";
              auditMessage = action.reason;
              this.audit(event, hook, start, auditResult, auditMessage);
              return { outcome: "blocked", reason: action.reason, hookName: hook.name };
            }
            case "modify": {
              auditResult = "modify";
              Object.assign(currentPayload, action.patch);
              modified = true;
              break;
            }
            case "warn": {
              auditResult = "warn";
              auditMessage = action.message;
              break;
            }
            case "allow": {
              auditResult = "allow";
              break;
            }
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          auditResult = "error";
          auditMessage = errMsg;

          // FR-009: only block on failure if failMode is "block"
          if (hook.failMode === "block") {
            this.audit(event, hook, start, auditResult, auditMessage);
            return {
              outcome: "blocked",
              reason: `Hook ${hook.name} failed: ${errMsg}`,
              hookName: hook.name,
            };
          }
        }

        this.audit(event, hook, start, auditResult, auditMessage);
      }
    } finally {
      this.dispatching = false;
    }

    if (modified) {
      return { outcome: "modified", payload: currentPayload };
    }
    return { outcome: "allowed" };
  }

  /** Sort hooks by priority descending, then by name for determinism. */
  private ensureSorted(): void {
    if (this.sorted) return;
    this.hooks.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority; // highest first
      return a.name.localeCompare(b.name);
    });
    this.sorted = true;
  }

  /** Filter hooks that match this event and payload (NF-001 hot path). */
  private findMatching(
    event: HookEventType,
    payload: Record<string, unknown>,
  ): RegisteredHook[] {
    const result: RegisteredHook[] = [];
    for (const hook of this.hooks) {
      if (hook.event !== event) continue;

      // Matcher check (tool, input, output subset matching)
      if (!matchesRuleMatcher(hook.matcher, { type: event, payload })) continue;

      // Condition check (if the hook has conditions from a rule file)
      if (hook.condition) {
        const condResult = evaluateConditionNode(hook.condition, { payload });
        if (!condResult.matched) continue;
      }

      result.push(hook);
    }
    return result;
  }

  /** Emit an audit entry (NF-002). */
  private audit(
    event: HookEventType,
    hook: RegisteredHook,
    startTime: number,
    result: HookAuditEntry["result"],
    message?: string,
  ): void {
    this.auditSink.log({
      eventType: event,
      hookName: hook.name,
      handlerType: hook.handler.type,
      durationMs: Date.now() - startTime,
      result,
      message,
      timestamp: startTime,
    });
  }
}
