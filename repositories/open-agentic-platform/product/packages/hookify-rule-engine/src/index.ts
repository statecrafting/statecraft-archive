export type {
  Action,
  ActionExecutionResult,
  ActionType,
  ConditionLeaf,
  ConditionNode,
  Diagnostic,
  DiagnosticSeverity,
  EvaluationResult,
  FailMode,
  HandlerType,
  HookActionResult,
  HookAuditEntry,
  HookDispatchResult,
  HookEvent,
  HookEventType,
  HookHandler,
  HookSource,
  Matcher,
  ParseRuleResult,
  RegisteredHook,
  Rule,
  TerminalDecision,
} from "./types.js";

export { parseRuleFile, parseRuleSet } from "./parser.js";
export { evaluateConditionNode } from "./conditions.js";
export { matchesRuleEventType, matchesRuleMatcher } from "./matcher.js";
export { executeRuleAction } from "./actions.js";
export { evaluate } from "./engine.js";
export type { EvaluateInput } from "./engine.js";

export {
  createRuleRuntime,
  DEFAULT_RULES_DIR,
  discoverMarkdownRuleFiles,
  loadRules,
} from "./loader.js";
export type { LoaderConfig, RuleRuntime, RulesetSnapshot } from "./loader.js";

export {
  HOOKIFY_LIFECYCLE_EVENTS,
  buildHooksManifest,
  defaultHookCommandForEvent,
  stringifyHooksManifest,
  writeHooksManifest,
} from "./hooks-json.js";
export type { HooksManifest, BuildHooksManifestOptions, WriteHooksManifestOptions } from "./hooks-json.js";

// --- Spec 069: Lifecycle Hook Runtime ---

export type {
  EventPayloadMap,
  FileChangedPayload,
  PostToolUsePayload,
  PreToolUsePayload,
  SessionStartPayload,
  SessionStopPayload,
  TypedHookEvent,
  UserPromptSubmitPayload,
} from "./events.js";
export { buildEnvVars } from "./events.js";

export {
  executeBashHandler,
  executeAgentHandler,
  executePromptHandler,
  executeHandler,
  defaultAgentDispatch,
  defaultPromptDisplay,
} from "./handlers.js";
export type { AgentDispatchFn, HandlerContext, HandlerExecutionResult, PromptDisplayFn } from "./handlers.js";

export { HookRegistry } from "./registry.js";
export type { HookRegistryOptions } from "./registry.js";

export { parseSettingsHooks } from "./settings-parser.js";

export { consoleAuditSink, MemoryAuditSink, nullAuditSink } from "./audit.js";
export type { AuditSink } from "./audit.js";

export { HookRuntime } from "./hook-runtime.js";
export type { HookRuntimeOptions } from "./hook-runtime.js";
