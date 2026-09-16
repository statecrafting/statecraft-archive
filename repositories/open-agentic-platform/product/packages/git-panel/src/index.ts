/**
 * @opc/git-panel — Comprehensive git panel with plumbing-based backend.
 *
 * Public API:
 * - Types: GitStatus, GitCommit, BranchInfo, GitBackend, etc.
 * - Backend: createGitBackend() — full GitBackend facade
 * - Parsers: parseNameStatus, parseUntrackedFiles, parseLog, parseBranches, parseDiff, buildHunkPatch
 * - Operations: createStagingOps, createCommitOps, createBranchOps
 * - AI: generateCommitMessage, buildPrompt
 * - Watcher: createWatcher, withRefresh
 */

// ── Types ────────────────────────────────────────────────────────────
export type {
  FileStatusCode,
  GitFileStatus,
  GitStatus,
  GitCommit,
  BranchInfo,
  HunkRange,
  DiffLine,
  DiffHunk,
  FileDiff,
  CommitOptions,
  CommitMessageProvider,
  GitBackend,
  GitPanelWatcher,
} from "./types.js";

// ── Backend facade ───────────────────────────────────────────────────
export { createGitBackend } from "./git-backend.js";

// ── Parsers ──────────────────────────────────────────────────────────
export {
  parseNameStatus,
  parseUntrackedFiles,
  parseLog,
  parseBranches,
} from "./backend/parser.js";

export { parseDiff, buildHunkPatch } from "./backend/diff-parser.js";

// ── Plumbing (low-level) ─────────────────────────────────────────────
export { execGit, repoRoot } from "./backend/plumbing.js";

// ── Operations ───────────────────────────────────────────────────────
export { createStagingOps } from "./operations/staging.js";
export type { StagingOperations } from "./operations/staging.js";

export { createCommitOps } from "./operations/commit.js";
export type { CommitOperations } from "./operations/commit.js";

export { createBranchOps } from "./operations/branch.js";
export type { BranchOperations } from "./operations/branch.js";

// ── AI commit messages ───────────────────────────────────────────────
export {
  generateCommitMessage,
  buildPrompt,
  DEFAULT_EXAMPLE_COUNT,
  MAX_DIFF_SIZE,
} from "./ai/commit-message.js";

// ── Watcher ──────────────────────────────────────────────────────────
export { createWatcher, withRefresh } from "./watcher.js";
export type { WatcherOptions } from "./watcher.js";
