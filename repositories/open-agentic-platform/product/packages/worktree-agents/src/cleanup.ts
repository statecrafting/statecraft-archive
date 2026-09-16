import { removeAgentWorktree } from "./worktree-manager.js";

export type DiscardAgentOptions = {
  repoRoot: string;
  agentId: string;
  branchName: string;
};

/** FR-008 / SC-006: remove worktree + local branch artifacts. */
export async function discardAgent(options: DiscardAgentOptions): Promise<void> {
  await removeAgentWorktree({
    repoRoot: options.repoRoot,
    agentId: options.agentId,
    deleteBranchLocalName: options.branchName,
  });
}
