/**
 * Branch operations: list, switch, create.
 * FR-007: branch header with ahead/behind, FR-008: branch switcher.
 */

import {
  forEachRef,
  currentBranch,
  checkoutBranch,
  createNewBranch,
  diffFiles,
  diffIndex,
} from "../backend/plumbing.js";
import { parseBranches, parseNameStatus } from "../backend/parser.js";
import type { BranchInfo } from "../types.js";

export interface BranchOperations {
  /** List all local branches. */
  list(): Promise<BranchInfo[]>;
  /** Switch to a branch. Throws if working tree is dirty and force is false. */
  checkout(branch: string, options?: { force?: boolean }): Promise<void>;
  /** Create a new branch from HEAD and switch to it. */
  create(name: string): Promise<void>;
  /** Check if the working tree has uncommitted changes. */
  isDirty(): Promise<boolean>;
}

/**
 * Create branch operations bound to a repository path.
 */
export function createBranchOps(cwd: string): BranchOperations {
  return {
    async list(): Promise<BranchInfo[]> {
      const [refsOutput, current] = await Promise.all([
        forEachRef(cwd),
        currentBranch(cwd),
      ]);
      return parseBranches(refsOutput, current);
    },

    async checkout(
      branch: string,
      options?: { force?: boolean },
    ): Promise<void> {
      if (!options?.force) {
        const dirty = await isDirtyImpl(cwd);
        if (dirty) {
          throw new Error(
            `Working tree has uncommitted changes. Commit, stash, or use force to switch to '${branch}'.`,
          );
        }
      }
      await checkoutBranch(cwd, branch);
    },

    async create(name: string): Promise<void> {
      if (!name.trim()) {
        throw new Error("Branch name cannot be empty");
      }
      await createNewBranch(cwd, name);
    },

    async isDirty(): Promise<boolean> {
      return isDirtyImpl(cwd);
    },
  };
}

async function isDirtyImpl(cwd: string): Promise<boolean> {
  const [unstagedOutput, stagedOutput] = await Promise.all([
    diffFiles(cwd),
    diffIndex(cwd),
  ]);
  const unstaged = parseNameStatus(unstagedOutput, false);
  const staged = parseNameStatus(stagedOutput, true);
  return unstaged.length > 0 || staged.length > 0;
}
