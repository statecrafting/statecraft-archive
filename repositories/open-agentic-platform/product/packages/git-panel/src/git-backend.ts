/**
 * GitBackend facade — wires plumbing commands, parsers, and operations
 * into a single cohesive interface that satisfies the GitBackend contract.
 */

import {
  diffFiles,
  diffIndex,
  lsFilesUntracked,
  currentBranch,
  aheadBehind,
  upstreamBranch,
  fileDiff,
  gitLog,
  commitDiffRaw,
} from "./backend/plumbing.js";
import {
  parseNameStatus,
  parseUntrackedFiles,
  parseLog,
} from "./backend/parser.js";
import { createStagingOps } from "./operations/staging.js";
import { createCommitOps } from "./operations/commit.js";
import { createBranchOps } from "./operations/branch.js";
import type {
  GitBackend,
  GitStatus,
  GitCommit,
  BranchInfo,
  HunkRange,
  CommitOptions,
} from "./types.js";

/**
 * Create a GitBackend implementation bound to a repository path.
 * FR-011: uses plumbing commands for status retrieval.
 */
export function createGitBackend(cwd: string): GitBackend {
  const staging = createStagingOps(cwd);
  const commits = createCommitOps(cwd);
  const branches = createBranchOps(cwd);

  return {
    async status(): Promise<GitStatus> {
      const [
        unstagedOutput,
        stagedOutput,
        untrackedOutput,
        branch,
        upstream,
        counts,
      ] = await Promise.all([
        diffFiles(cwd),
        diffIndex(cwd),
        lsFilesUntracked(cwd),
        currentBranch(cwd),
        upstreamBranch(cwd),
        aheadBehind(cwd),
      ]);

      return {
        branch,
        upstream,
        ahead: counts[0],
        behind: counts[1],
        staged: parseNameStatus(stagedOutput, true),
        unstaged: parseNameStatus(unstagedOutput, false),
        untracked: parseUntrackedFiles(untrackedOutput),
      };
    },

    async diff(path: string, staged: boolean): Promise<string> {
      return fileDiff(cwd, path, staged);
    },

    async stage(path: string, hunks?: HunkRange[]): Promise<void> {
      return staging.stage(path, hunks);
    },

    async unstage(path: string, hunks?: HunkRange[]): Promise<void> {
      return staging.unstage(path, hunks);
    },

    async commit(
      message: string,
      options?: CommitOptions,
    ): Promise<GitCommit> {
      return commits.commit(message, options);
    },

    async log(limit: number, offset?: number): Promise<GitCommit[]> {
      const output = await gitLog(cwd, limit, offset);
      return parseLog(output);
    },

    async commitDiff(hash: string): Promise<string> {
      return commitDiffRaw(cwd, hash);
    },

    async branches(): Promise<BranchInfo[]> {
      return branches.list();
    },

    async checkout(branch: string): Promise<void> {
      return branches.checkout(branch);
    },

    async createBranch(name: string): Promise<void> {
      return branches.create(name);
    },
  };
}
