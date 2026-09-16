/**
 * Commit creation with options (amend, signoff).
 * FR-005: multi-line commit message, SC-005: valid git commits.
 */

import { createCommit, gitLog } from "../backend/plumbing.js";
import { parseLog } from "../backend/parser.js";
import type { GitCommit, CommitOptions } from "../types.js";

export interface CommitOperations {
  /** Create a commit with the given message and options. */
  commit(message: string, options?: CommitOptions): Promise<GitCommit>;
}

/**
 * Create commit operations bound to a repository path.
 */
export function createCommitOps(cwd: string): CommitOperations {
  return {
    async commit(
      message: string,
      options?: CommitOptions,
    ): Promise<GitCommit> {
      if (!message.trim()) {
        throw new Error("Commit message cannot be empty");
      }

      await createCommit(cwd, message, options);

      // Fetch the commit we just created to return full details
      const logOutput = await gitLog(cwd, 1);
      const commits = parseLog(logOutput);
      if (commits.length === 0) {
        throw new Error("Failed to read newly created commit");
      }
      return commits[0]!;
    },
  };
}
