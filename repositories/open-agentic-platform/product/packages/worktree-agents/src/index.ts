export type {
  CreateAgentWorktreeOptions,
  OapWorktreeEntry,
  RemoveAgentWorktreeOptions,
} from "./types.js";
export { FifoConcurrencyLimiter } from "./concurrency.js";
export type { ConcurrencyMetrics } from "./concurrency.js";
export {
  AgentRunnerError,
  BackgroundAgentRunner,
} from "./agent-runner.js";
export type {
  AgentLifecycleEvent,
  AgentLifecycleStatus,
  AgentRunResult,
  AgentRunnerSpawnOptions,
  PreApprovedPermissions,
} from "./agent-runner.js";
export { AgentLifecycleBus } from "./lifecycle-events.js";
export type {
  AgentCompletedEvent,
  AgentFailedEvent,
  AgentLifecyclePayload,
  AgentLifecyclePayloadByStatus,
  AgentListItem,
  AgentRunningEvent,
  AgentSpawnedEvent,
  AgentTimedOutEvent,
  AgentToolUseEvent,
} from "./lifecycle-events.js";
export { getAgentDiff, AgentDiffError } from "./diff.js";
export type {
  AgentDiffResult,
  CommitSummaryEntry,
  GetAgentDiffOptions,
} from "./diff.js";
export { mergeAgent, MergeAgentError } from "./merge.js";
export type {
  MergeAgentOptions,
  MergeAgentResult,
  MergeStrategy,
} from "./merge.js";
export { discardAgent } from "./cleanup.js";
export type { DiscardAgentOptions } from "./cleanup.js";
export {
  WorktreeManagerError,
  WORKTREES_DIR_NAME,
  branchNameForAgent,
  createAgentWorktree,
  defaultWorktreePath,
  ensureWorktreesDirectoryIgnored,
  listOapWorktrees,
  parseWorktreeListPorcelain,
  reconcileOrphanWorktreeDirs,
  removeAgentWorktree,
  sameRealPath,
  worktreeDirectoryName,
} from "./worktree-manager.js";
