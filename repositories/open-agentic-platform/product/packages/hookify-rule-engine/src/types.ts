export type HookEventType =
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "SessionStart"
  | "SessionStop"
  | "FileChanged";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  filePath?: string;
  ruleId?: string;
}

export interface Matcher {
  tool?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
}

export interface ConditionLeaf {
  field: string;
  "=="?: unknown;
  "!="?: unknown;
  contains?: string;
  matches?: string;
  glob?: string;
}

export interface ConditionAllNode {
  all: ConditionNode[];
}

export interface ConditionAnyNode {
  any: ConditionNode[];
}

export interface ConditionNotNode {
  not: ConditionNode;
}

export type ConditionNode =
  | ConditionLeaf
  | ConditionAllNode
  | ConditionAnyNode
  | ConditionNotNode;

export type ActionType = "block" | "warn" | "modify";

export interface ModifyTransform {
  type: string;
  [key: string]: unknown;
}

export interface Action {
  type: ActionType;
  transform?: ModifyTransform;
}

export interface Rule {
  id: string;
  event: HookEventType;
  matcher: Matcher;
  conditions: ConditionNode;
  action: Action;
  priority: number;
  rationale: string;
  sourcePath: string;
}

export interface HookEvent {
  type: HookEventType;
  payload: Record<string, unknown>;
}

export interface EvaluationResult {
  allowed: boolean;
  blockedByRuleId?: string;
  /** When `allowed` is false due to a block action, human-facing rationale from the rule body. */
  blockRationale?: string;
  warnings: string[];
  diagnostics: Diagnostic[];
  payload: Record<string, unknown>;
  terminalDecision?: TerminalDecision;
  matchedRuleIds?: string[];
}

export type TerminalDecision = "allowed" | "blocked";

export interface ActionExecutionResult {
  payload: Record<string, unknown>;
  warnings: string[];
  diagnostics: Diagnostic[];
  terminalDecision: TerminalDecision;
  matchedRuleIds: string[];
  blockedByRuleId?: string;
}

export interface ParseRuleResult {
  rule: Rule | null;
  diagnostics: Diagnostic[];
}

// --- Spec 069: Lifecycle Hook Runtime types ---

/** Handler types supported by the hook runtime (FR-003). */
export type HandlerType = "bash" | "agent" | "prompt";

/** Source from which a hook was registered (FR-005). */
export type HookSource = "settings" | "rule_file" | "manifest" | "programmatic";

/** Behavior when a handler fails (crash/timeout) (FR-009). */
export type FailMode = "warn" | "block";

/** Result action returned by hook dispatch. */
export type HookActionResult =
  | { type: "block"; reason: string }
  | { type: "warn"; message: string }
  | { type: "modify"; patch: Record<string, unknown> }
  | { type: "allow" };

/** Handler definition for a registered hook. */
export type HookHandler =
  | { type: "bash"; command: string }
  | { type: "agent"; promptTemplate: string }
  | { type: "prompt"; message: string };

/** A hook registered in the HookRegistry. */
export interface RegisteredHook {
  name: string;
  event: HookEventType;
  condition: ConditionNode | null;
  matcher: Matcher;
  handler: HookHandler;
  action: ActionType;
  priority: number;
  failMode: FailMode;
  timeoutMs: number;
  source: HookSource;
}

/** Dispatch result from the hook registry. */
export type HookDispatchResult =
  | { outcome: "allowed" }
  | { outcome: "blocked"; reason: string; hookName: string }
  | { outcome: "modified"; payload: Record<string, unknown> };

/** Audit entry for a single hook execution (NF-002). */
export interface HookAuditEntry {
  eventType: HookEventType;
  hookName: string;
  handlerType: HandlerType;
  durationMs: number;
  result: "block" | "warn" | "allow" | "modify" | "error";
  message?: string;
  timestamp: number;
}
