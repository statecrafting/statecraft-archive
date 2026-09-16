/**
 * Types for Claude Code hooks configuration
 */

export interface HookCommand {
  type: 'command';
  command: string;
  timeout?: number; // Optional timeout in seconds (default: 60)

  // Spec 166 — OPC Stop-hook gate chain. Identifies a hook for cross-tier
  // referencing (override / disable). Required for any entry the platform
  // tier wishes to mark as mandatory.
  id?: string;

  // Spec 166 FR-006: the platform tier marks specific entries as
  // mandatory. Project / user / local tiers cannot disable or remove
  // entries with this flag set; attempts are recorded in the merge audit.
  platform_mandatory?: boolean;

  // Spec 166 FR-006: project / user / local tiers may suppress a
  // non-mandatory platform entry by setting `disabled: true` and providing
  // a `disable_reason`. The reason surfaces in audit and in the next
  // session's startup diagnostics.
  disabled?: boolean;
  disable_reason?: string;
}

export interface HookMatcher {
  matcher?: string; // Pattern to match tool names (regex supported)
  hooks: HookCommand[];
}

export interface HooksConfiguration {
  PreToolUse?: HookMatcher[];
  PostToolUse?: HookMatcher[];
  Notification?: HookCommand[];
  Stop?: HookCommand[];
  SubagentStop?: HookCommand[];
}

export type HookEvent = keyof HooksConfiguration;

export interface ClaudeSettingsWithHooks {
  hooks?: HooksConfiguration;
  [key: string]: any;
}

export interface HookValidationError {
  event: string;
  matcher?: string;
  command?: string;
  message: string;
}

export interface HookValidationWarning {
  event: string;
  matcher?: string;
  command: string;
  message: string;
}

export interface HookValidationResult {
  valid: boolean;
  errors: HookValidationError[];
  warnings: HookValidationWarning[];
}

export type HookScope = 'user' | 'project' | 'local';

// Spec 166: the OPC-bundled platform tier sits above user/project/local.
// It is the source of the platform-mandatory floor (FR-006).
export type HookScopeWithPlatform = HookScope | 'platform';

// Spec 166: audit entry produced by mergeWithPlatform when a lower tier
// attempts to disable or override a platform entry. Bypass attempts on
// platform-mandatory entries are recorded but do not take effect.
export interface HookMergeAuditEntry {
  kind: 'disabled' | 'mandatory_bypass_blocked' | 'disabled_missing_reason';
  event: HookEvent;
  matcher?: string;
  hookId: string;
  scope: HookScopeWithPlatform;
  reason?: string;
}

export interface HookMergeResult {
  merged: HooksConfiguration;
  audit: HookMergeAuditEntry[];
}

// Common tool matchers for autocomplete
export const COMMON_TOOL_MATCHERS = [
  'Task',
  'Bash',
  'Glob',
  'Grep',
  'Read',
  'Edit',
  'MultiEdit',
  'Write',
  'WebFetch',
  'WebSearch',
  'Notebook.*',
  'Edit|Write',
  'mcp__.*',
  'mcp__memory__.*',
  'mcp__filesystem__.*',
  'mcp__github__.*',
];

// Hook templates
export interface HookTemplate {
  id: string;
  name: string;
  description: string;
  event: HookEvent;
  matcher?: string;
  commands: string[];
}

export const HOOK_TEMPLATES: HookTemplate[] = [
  {
    id: 'log-bash-commands',
    name: 'Log Shell Commands',
    description: 'Log all bash commands to a file for auditing',
    event: 'PreToolUse',
    matcher: 'Bash',
    commands: ['jq -r \'"\(.tool_input.command) - \(.tool_input.description // "No description")"\' >> ~/.claude/bash-command-log.txt']
  },
  {
    id: 'format-on-save',
    name: 'Auto-format Code',
    description: 'Run code formatters after file modifications',
    event: 'PostToolUse',
    matcher: 'Write|Edit|MultiEdit',
    commands: [
      'if [[ "$( jq -r .tool_input.file_path )" =~ \\.(ts|tsx|js|jsx)$ ]]; then prettier --write "$( jq -r .tool_input.file_path )"; fi',
      'if [[ "$( jq -r .tool_input.file_path )" =~ \\.go$ ]]; then gofmt -w "$( jq -r .tool_input.file_path )"; fi'
    ]
  },
  {
    id: 'git-commit-guard',
    name: 'Protect Main Branch',
    description: 'Prevent direct commits to main/master branch',
    event: 'PreToolUse',
    matcher: 'Bash',
    commands: ['if [[ "$(jq -r .tool_input.command)" =~ "git commit" ]] && [[ "$(git branch --show-current 2>/dev/null)" =~ ^(main|master)$ ]]; then echo "Direct commits to main/master branch are not allowed"; exit 2; fi']
  },
  {
    id: 'custom-notification',
    name: 'Custom Notifications',
    description: 'Send custom notifications when Claude needs attention',
    event: 'Notification',
    commands: ['osascript -e "display notification \\"$(jq -r .message)\\" with title \\"$(jq -r .title)\\" sound name \\"Glass\\""']
  },
  {
    id: 'continue-on-tests',
    name: 'Auto-continue on Test Success',
    description: 'Automatically continue when tests pass',
    event: 'Stop',
    commands: ['if grep -q "All tests passed" "$( jq -r .transcript_path )"; then echo \'{"decision": "block", "reason": "All tests passed. Continue with next task."}\'; fi']
  }
]; 
