/** Registered git worktree under {@link WORKTREES_DIR_NAME} for an OAP agent. */
export type OapWorktreeEntry = {
  /** Absolute path to the linked checkout. */
  path: string;
  head: string;
  /** Short branch name, or null when HEAD is detached. */
  branch: string | null;
};

export type CreateAgentWorktreeOptions = {
  repoRoot: string;
  agentId: string;
  /** Task slug for branch naming (e.g. fix-typos). */
  slug: string;
  /** Revision to branch from (default HEAD). */
  startPoint?: string;
};

export type RemoveAgentWorktreeOptions = {
  repoRoot: string;
  agentId: string;
  /**
   * Local branch name to delete after worktree removal (e.g. agent/abc-fix-typos).
   * Best-effort; missing branch is ignored.
   */
  deleteBranchLocalName?: string;
};
