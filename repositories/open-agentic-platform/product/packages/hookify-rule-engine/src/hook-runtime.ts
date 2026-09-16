/**
 * HookRuntime — unified lifecycle dispatch facade (spec 069).
 *
 * Composes two subsystems into a single dispatch entry point:
 *
 * 1. **Rules** (spec 048) — pure condition → action evaluation from `.claude/hooks/rules/*.md`.
 *    Zero I/O, runs synchronously, highest priority (policy enforcement).
 *
 * 2. **Hooks** (spec 069) — bash/agent/prompt handlers from settings.json, orchestrator
 *    manifests, and programmatic registration. Has I/O, runs async.
 *
 * Dispatch order: rules first (instant policy checks), then hooks (side-effect handlers).
 * A rule block short-circuits before any hook handler executes.
 *
 * FR-005: Multi-source registration — settings (a), rule files (b), manifests (c), programmatic (d).
 * FR-008: Hot-reload of rule files via RuleRuntime file watcher.
 * SC-002: All sources fire correctly through a single dispatch path.
 */

import { evaluate } from "./engine.js";
import { createRuleRuntime, type LoaderConfig, type RuleRuntime } from "./loader.js";
import { HookRegistry, type HookRegistryOptions } from "./registry.js";
import { parseSettingsHooks } from "./settings-parser.js";
import type { HookDispatchResult, HookEventType, RegisteredHook, Rule } from "./types.js";

export interface HookRuntimeOptions extends HookRegistryOptions {
  /** Loader config for .claude/hooks/rules/ directory. */
  loader?: LoaderConfig;
  /** settings.json content (to parse hooks from on startup). */
  settings?: Record<string, unknown>;
  /** Enable hot-reload of rule files (FR-008). Default: false. */
  hotReload?: boolean;
}

export class HookRuntime {
  private readonly registry: HookRegistry;
  private readonly ruleRuntime: RuleRuntime;

  constructor(options: HookRuntimeOptions = {}) {
    this.registry = new HookRegistry(options);
    this.ruleRuntime = createRuleRuntime(options.loader);

    // Load settings hooks (FR-005a)
    if (options.settings) {
      const hooks = parseSettingsHooks(options.settings);
      this.registry.registerAll(hooks);
    }

    // Start hot-reload if requested (FR-008)
    if (options.hotReload) {
      this.ruleRuntime.startHotReload();
    }
  }

  /** Register a hook programmatically (FR-005d). */
  register(hook: RegisteredHook): void {
    this.registry.register(hook);
  }

  /** Register multiple hooks at once. */
  registerAll(hooks: RegisteredHook[]): void {
    this.registry.registerAll(hooks);
  }

  /** Reload settings hooks atomically (FR-005a). */
  loadSettings(settings: Record<string, unknown>): void {
    const hooks = parseSettingsHooks(settings);
    this.registry.replaceSource("settings", hooks);
  }

  /** Reload rules from disk (FR-008). */
  reloadRules(): void {
    this.ruleRuntime.loadRules();
  }

  /**
   * Dispatch a lifecycle event through the full pipeline.
   *
   * Phase 1: Evaluate spec-048 rules (pure conditions, zero I/O).
   *          A rule block short-circuits before any hook handler runs.
   *          Rule modifications (warn/modify) patch the payload for Phase 2.
   *
   * Phase 2: Dispatch through HookRegistry (bash/agent/prompt handlers).
   *          Priority-ordered, short-circuit on block.
   */
  async dispatch(
    event: HookEventType,
    payload: Record<string, unknown>,
  ): Promise<HookDispatchResult> {
    // Phase 1: Rule evaluation (instant policy checks)
    const snapshot = this.ruleRuntime.getRulesSnapshot();
    let effectivePayload = payload;

    if (snapshot.rules.length > 0) {
      const ruleResult = evaluate({
        rules: snapshot.rules as Rule[],
        event: { type: event, payload },
      });

      if (!ruleResult.allowed && ruleResult.blockedByRuleId) {
        return {
          outcome: "blocked",
          reason: ruleResult.blockRationale || "Blocked by rule",
          hookName: ruleResult.blockedByRuleId,
        };
      }

      // Carry forward any payload modifications from rules
      effectivePayload = ruleResult.payload;
    }

    // Phase 2: Hook dispatch (handlers with I/O)
    return this.registry.dispatch(event, effectivePayload);
  }

  /** Total registered hooks (excludes rule-file rules). */
  get hookCount(): number {
    return this.registry.size;
  }

  /** Current rule snapshot version. */
  get ruleVersion(): number {
    return this.ruleRuntime.getRulesSnapshot().version;
  }

  /** Access the underlying HookRegistry (for inspection/testing). */
  getRegistry(): HookRegistry {
    return this.registry;
  }

  /** Access the underlying RuleRuntime (for inspection/testing). */
  getRuleRuntime(): RuleRuntime {
    return this.ruleRuntime;
  }

  /** Stop hot-reload and release resources. */
  dispose(): void {
    this.ruleRuntime.stopHotReload();
  }
}
