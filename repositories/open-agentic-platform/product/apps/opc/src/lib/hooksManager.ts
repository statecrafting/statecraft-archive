/**
 * Hooks configuration manager for Claude Code hooks
 */

import {
  HooksConfiguration,
  HookMatcher,
  HookValidationResult,
  HookValidationError,
  HookValidationWarning,
  HookCommand,
  HookEvent,
  HookMergeAuditEntry,
  HookMergeResult,
  HookScopeWithPlatform,
} from '@/types/hooks';

export class HooksManager {
  /**
   * Merge hooks configurations with proper priority
   * Priority: local > project > user
   */
  static mergeConfigs(
    user: HooksConfiguration,
    project: HooksConfiguration,
    local: HooksConfiguration
  ): HooksConfiguration {
    const merged: HooksConfiguration = {};
    
    // Events with matchers (tool-related)
    const matcherEvents: (keyof HooksConfiguration)[] = ['PreToolUse', 'PostToolUse'];
    
    // Events without matchers (non-tool-related)
    const directEvents: (keyof HooksConfiguration)[] = ['Notification', 'Stop', 'SubagentStop'];

    // Merge events with matchers
    for (const event of matcherEvents) {
      // Start with user hooks
      let matchers = [...((user[event] as HookMatcher[] | undefined) || [])];
      
      // Add project hooks (may override by matcher pattern)
      if (project[event]) {
        matchers = this.mergeMatchers(matchers, project[event] as HookMatcher[]);
      }
      
      // Add local hooks (highest priority)
      if (local[event]) {
        matchers = this.mergeMatchers(matchers, local[event] as HookMatcher[]);
      }
      
      if (matchers.length > 0) {
        (merged as any)[event] = matchers;
      }
    }
    
    // Merge events without matchers
    for (const event of directEvents) {
      // Combine all hooks from all levels (local takes precedence)
      const hooks: HookCommand[] = [];
      
      // Add user hooks
      if (user[event]) {
        hooks.push(...(user[event] as HookCommand[]));
      }
      
      // Add project hooks
      if (project[event]) {
        hooks.push(...(project[event] as HookCommand[]));
      }
      
      // Add local hooks (highest priority)
      if (local[event]) {
        hooks.push(...(local[event] as HookCommand[]));
      }
      
      if (hooks.length > 0) {
        (merged as any)[event] = hooks;
      }
    }
    
    return merged;
  }

  /**
   * Merge matcher arrays, with later items taking precedence
   */
  private static mergeMatchers(
    base: HookMatcher[],
    override: HookMatcher[]
  ): HookMatcher[] {
    const result = [...base];
    
    for (const overrideMatcher of override) {
      const existingIndex = result.findIndex(
        m => m.matcher === overrideMatcher.matcher
      );
      
      if (existingIndex >= 0) {
        // Replace existing matcher
        result[existingIndex] = overrideMatcher;
      } else {
        // Add new matcher
        result.push(overrideMatcher);
      }
    }
    
    return result;
  }

  /**
   * Validate hooks configuration
   */
  static async validateConfig(hooks: HooksConfiguration): Promise<HookValidationResult> {
    const errors: HookValidationError[] = [];
    const warnings: HookValidationWarning[] = [];

    // Guard against undefined or null hooks
    if (!hooks) {
      return { valid: true, errors, warnings };
    }

    // Events with matchers
    const matcherEvents = ['PreToolUse', 'PostToolUse'] as const;
    
    // Events without matchers
    const directEvents = ['Notification', 'Stop', 'SubagentStop'] as const;

    // Validate events with matchers
    for (const event of matcherEvents) {
      const matchers = hooks[event];
      if (!matchers || !Array.isArray(matchers)) continue;

      for (const matcher of matchers) {
        // Validate regex pattern if provided
        if (matcher.matcher) {
          try {
            new RegExp(matcher.matcher);
          } catch (e) {
            errors.push({
              event,
              matcher: matcher.matcher,
              message: `Invalid regex pattern: ${e instanceof Error ? e.message : 'Unknown error'}`
            });
          }
        }

        // Validate commands
        if (matcher.hooks && Array.isArray(matcher.hooks)) {
          for (const hook of matcher.hooks) {
            if (!hook.command || !hook.command.trim()) {
              errors.push({
                event,
                matcher: matcher.matcher,
                message: 'Empty command'
              });
            }

            // Check for dangerous patterns
            const dangers = this.checkDangerousPatterns(hook.command || '');
            warnings.push(...dangers.map(d => ({
              event,
              matcher: matcher.matcher,
              command: hook.command || '',
              message: d
            })));
          }
        }
      }
    }

    // Validate events without matchers
    for (const event of directEvents) {
      const directHooks = hooks[event];
      if (!directHooks || !Array.isArray(directHooks)) continue;

      for (const hook of directHooks) {
        if (!hook.command || !hook.command.trim()) {
          errors.push({
            event,
            message: 'Empty command'
          });
        }

        // Check for dangerous patterns
        const dangers = this.checkDangerousPatterns(hook.command || '');
        warnings.push(...dangers.map(d => ({
          event,
          command: hook.command || '',
          message: d
        })));
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Check for potentially dangerous command patterns
   */
  public static checkDangerousPatterns(command: string): string[] {
    const warnings: string[] = [];
    
    // Guard against undefined or null commands
    if (!command || typeof command !== 'string') {
      return warnings;
    }
    
    const patterns = [
      { pattern: /rm\s+-rf\s+\/(?:\s|$)/, message: 'Destructive command on root directory' },
      { pattern: /rm\s+-rf\s+~/, message: 'Destructive command on home directory' },
      { pattern: /:\s*\(\s*\)\s*\{.*\}\s*;/, message: 'Fork bomb pattern detected' },
      { pattern: /curl.*\|\s*(?:bash|sh)/, message: 'Downloading and executing remote code' },
      { pattern: /wget.*\|\s*(?:bash|sh)/, message: 'Downloading and executing remote code' },
      { pattern: />\/dev\/sda/, message: 'Direct disk write operation' },
      { pattern: /sudo\s+/, message: 'Elevated privileges required' },
      { pattern: /dd\s+.*of=\/dev\//, message: 'Dangerous disk operation' },
      { pattern: /mkfs\./, message: 'Filesystem formatting command' },
      { pattern: /:(){ :|:& };:/, message: 'Fork bomb detected' },
    ];

    for (const { pattern, message } of patterns) {
      if (pattern.test(command)) {
        warnings.push(message);
      }
    }

    // Check for unescaped variables that could lead to code injection
    if (command.includes('$') && !command.includes('"$')) {
      warnings.push('Unquoted shell variable detected - potential code injection risk');
    }

    return warnings;
  }

  /**
   * Escape a command for safe shell execution
   */
  static escapeCommand(command: string): string {
    // Basic shell escaping - in production, use a proper shell escaping library
    return command
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`');
  }

  /**
   * Generate a unique ID for hooks/matchers/commands
   */
  static generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ── Spec 166: OPC Stop-hook gate chain ───────────────────────────────────
  //
  // The mergeConfigs above is the legacy 3-tier surface (user > project >
  // local) used elsewhere in the desktop app. Spec 166 adds a fourth tier —
  // the OPC-bundled platform tier — and tightens the merge semantics:
  //
  //   1. The platform tier is the foundation: its hooks come first in the
  //      merged list, preserving the prescribed Stop ordering (spec 166 §2.1).
  //   2. Lower tiers may APPEND new entries (FR-006).
  //   3. Lower tiers may DISABLE platform entries by `id`, supplying a
  //      `disable_reason`. The merged hook keeps its slot but is marked
  //      `disabled: true` so audit can render the override.
  //   4. Lower tiers MUST NOT disable an entry marked
  //      `platform_mandatory: true` (FR-006). Bypass attempts are recorded
  //      in audit but do not take effect; the entry remains enabled.
  //   5. A disable without a `disable_reason` is recorded as a validation
  //      error in audit; the override is applied but the missing reason
  //      surfaces so the user can correct it.

  static mergeWithPlatform(
    platform: HooksConfiguration,
    user: HooksConfiguration,
    project: HooksConfiguration,
    local: HooksConfiguration,
  ): HookMergeResult {
    const merged: HooksConfiguration = {};
    const audit: HookMergeAuditEntry[] = [];

    const matcherEvents: HookEvent[] = ['PreToolUse', 'PostToolUse'];
    const directEvents: HookEvent[] = ['Notification', 'Stop', 'SubagentStop'];

    for (const event of matcherEvents) {
      const platformMatchers = (platform[event] as HookMatcher[] | undefined) ?? [];
      const lowerMatchersByScope: Array<{
        scope: HookScopeWithPlatform;
        matchers: HookMatcher[];
      }> = [
        { scope: 'user', matchers: (user[event] as HookMatcher[] | undefined) ?? [] },
        { scope: 'project', matchers: (project[event] as HookMatcher[] | undefined) ?? [] },
        { scope: 'local', matchers: (local[event] as HookMatcher[] | undefined) ?? [] },
      ];

      const result: HookMatcher[] = platformMatchers.map((m) => ({
        ...m,
        hooks: m.hooks ? m.hooks.map((h) => ({ ...h })) : [],
      }));

      for (const { scope, matchers } of lowerMatchersByScope) {
        for (const lowerMatcher of matchers) {
          const existing = result.find((r) => r.matcher === lowerMatcher.matcher);
          if (existing) {
            for (const lowerHook of lowerMatcher.hooks || []) {
              this.applyLowerHook({
                event,
                matcher: lowerMatcher.matcher,
                scope,
                target: existing,
                lowerHook,
                audit,
              });
            }
          } else {
            result.push({
              ...lowerMatcher,
              hooks: (lowerMatcher.hooks || []).map((h) => ({ ...h })),
            });
          }
        }
      }

      if (result.length > 0) {
        (merged as any)[event] = result;
      }
    }

    for (const event of directEvents) {
      const platformHooks = (platform[event] as HookCommand[] | undefined) ?? [];
      const lowerHooksByScope: Array<{
        scope: HookScopeWithPlatform;
        hooks: HookCommand[];
      }> = [
        { scope: 'user', hooks: (user[event] as HookCommand[] | undefined) ?? [] },
        { scope: 'project', hooks: (project[event] as HookCommand[] | undefined) ?? [] },
        { scope: 'local', hooks: (local[event] as HookCommand[] | undefined) ?? [] },
      ];

      const result: HookCommand[] = platformHooks.map((h) => ({ ...h }));

      for (const { scope, hooks } of lowerHooksByScope) {
        for (const lowerHook of hooks) {
          this.applyLowerDirectHook({
            event,
            scope,
            result,
            lowerHook,
            audit,
          });
        }
      }

      if (result.length > 0) {
        (merged as any)[event] = result;
      }
    }

    return { merged, audit };
  }

  private static applyLowerHook(args: {
    event: HookEvent;
    matcher?: string;
    scope: HookScopeWithPlatform;
    target: HookMatcher;
    lowerHook: HookCommand;
    audit: HookMergeAuditEntry[];
  }): void {
    const { event, matcher, scope, target, lowerHook, audit } = args;
    if (lowerHook.id) {
      const platformEntry = target.hooks?.find((h) => h.id === lowerHook.id);
      if (platformEntry) {
        this.applyOverride({ event, matcher, scope, platformEntry, lowerHook, audit });
        return;
      }
    }
    target.hooks = target.hooks || [];
    target.hooks.push({ ...lowerHook });
  }

  private static applyLowerDirectHook(args: {
    event: HookEvent;
    scope: HookScopeWithPlatform;
    result: HookCommand[];
    lowerHook: HookCommand;
    audit: HookMergeAuditEntry[];
  }): void {
    const { event, scope, result, lowerHook, audit } = args;
    if (lowerHook.id) {
      const platformEntry = result.find((h) => h.id === lowerHook.id);
      if (platformEntry) {
        this.applyOverride({ event, scope, platformEntry, lowerHook, audit });
        return;
      }
    }
    result.push({ ...lowerHook });
  }

  private static applyOverride(args: {
    event: HookEvent;
    matcher?: string;
    scope: HookScopeWithPlatform;
    platformEntry: HookCommand;
    lowerHook: HookCommand;
    audit: HookMergeAuditEntry[];
  }): void {
    const { event, matcher, scope, platformEntry, lowerHook, audit } = args;
    if (!lowerHook.disabled) {
      // Not a disable — silently merge non-disable fields (timeout etc.)
      // that the lower tier wishes to tighten. Command and id are
      // platform-owned and not overridable.
      if (lowerHook.timeout !== undefined) {
        platformEntry.timeout = lowerHook.timeout;
      }
      return;
    }
    if (platformEntry.platform_mandatory) {
      audit.push({
        kind: 'mandatory_bypass_blocked',
        event,
        matcher,
        hookId: platformEntry.id!,
        scope,
        reason: lowerHook.disable_reason,
      });
      return;
    }
    platformEntry.disabled = true;
    platformEntry.disable_reason = lowerHook.disable_reason;
    if (!lowerHook.disable_reason || !lowerHook.disable_reason.trim()) {
      audit.push({
        kind: 'disabled_missing_reason',
        event,
        matcher,
        hookId: platformEntry.id!,
        scope,
      });
    } else {
      audit.push({
        kind: 'disabled',
        event,
        matcher,
        hookId: platformEntry.id!,
        scope,
        reason: lowerHook.disable_reason,
      });
    }
  }

  // Substitute the ${OPC_HOOKS_DIR} placeholder in a HooksConfiguration. The
  // platform tier ships commands with this placeholder; at runtime OPC
  // resolves it to the absolute path of the bundled claude-hooks directory.
  //
  // Substitution is applied to the `command` string only; other fields are
  // unaffected. Commands without the placeholder pass through unchanged.
  static resolvePlatformPaths(
    hooks: HooksConfiguration,
    hooksDir: string,
  ): HooksConfiguration {
    const replace = (cmd: string): string => cmd.split('${OPC_HOOKS_DIR}').join(hooksDir);

    const out: HooksConfiguration = {};
    const matcherEvents: HookEvent[] = ['PreToolUse', 'PostToolUse'];
    for (const event of matcherEvents) {
      const matchers = hooks[event] as HookMatcher[] | undefined;
      if (!matchers) continue;
      (out as any)[event] = matchers.map((m) => ({
        ...m,
        hooks: (m.hooks || []).map((h) => ({ ...h, command: replace(h.command) })),
      }));
    }

    const directEvents: HookEvent[] = ['Notification', 'Stop', 'SubagentStop'];
    for (const event of directEvents) {
      const arr = hooks[event] as HookCommand[] | undefined;
      if (!arr) continue;
      (out as any)[event] = arr.map((h) => ({ ...h, command: replace(h.command) }));
    }

    return out;
  }
}

