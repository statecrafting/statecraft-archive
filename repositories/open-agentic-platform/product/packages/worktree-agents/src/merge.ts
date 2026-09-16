import { execFile } from "node:child_process";

export type MergeStrategy = "fast-forward" | "squash" | "cherry-pick";

export type MergeAgentOptions = {
  repoRoot: string;
  parentBranch: string;
  agentBranch: string;
  strategy: MergeStrategy;
  cherryPickCommits?: string[];
  squashCommitMessage?: string;
};

export type MergeAgentResult = {
  strategy: MergeStrategy;
  mergedCommits: string[];
  createdCommitSha: string | null;
};

export class MergeAgentError extends Error {
  constructor(
    message: string,
    public readonly code: "GIT_ERROR" | "INVALID_INPUT" | "DIRTY_WORKTREE",
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = "MergeAgentError";
  }
}

function git(repoRoot: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new MergeAgentError(
              `git ${args.join(" ")} failed`,
              "GIT_ERROR",
              stderr?.toString(),
            ),
          );
          return;
        }
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      },
    );
  });
}

async function ensureCleanWorktree(repoRoot: string): Promise<void> {
  const { stdout } = await git(repoRoot, ["status", "--porcelain"]);
  if (stdout.trim().length > 0) {
    throw new MergeAgentError(
      "Refusing merge: repository has uncommitted changes. Commit/stash first.",
      "DIRTY_WORKTREE",
    );
  }
}

async function currentBranch(repoRoot: string): Promise<string> {
  const { stdout } = await git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return stdout.trim();
}

async function checkoutBranch(repoRoot: string, branch: string): Promise<void> {
  await git(repoRoot, ["checkout", branch]);
}

async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  try {
    await git(repoRoot, ["rev-parse", "--verify", branch]);
    return true;
  } catch {
    return false;
  }
}

async function collectMergedCommits(
  repoRoot: string,
  parentBranch: string,
  agentBranch: string,
): Promise<string[]> {
  const { stdout } = await git(repoRoot, ["rev-list", `${parentBranch}..${agentBranch}`]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function headSha(repoRoot: string): Promise<string> {
  const { stdout } = await git(repoRoot, ["rev-parse", "HEAD"]);
  return stdout.trim();
}

/** FR-007: merge an agent branch into parent using explicit strategy. */
export async function mergeAgent(options: MergeAgentOptions): Promise<MergeAgentResult> {
  const { repoRoot, parentBranch, agentBranch, strategy } = options;

  if (!(await branchExists(repoRoot, parentBranch))) {
    throw new MergeAgentError(`Parent branch not found: ${parentBranch}`, "INVALID_INPUT");
  }
  if (!(await branchExists(repoRoot, agentBranch))) {
    throw new MergeAgentError(`Agent branch not found: ${agentBranch}`, "INVALID_INPUT");
  }

  if (strategy === "cherry-pick") {
    if (!options.cherryPickCommits || options.cherryPickCommits.length === 0) {
      throw new MergeAgentError(
        "Cherry-pick strategy requires cherryPickCommits",
        "INVALID_INPUT",
      );
    }
  }

  await ensureCleanWorktree(repoRoot);
  const startBranch = await currentBranch(repoRoot);
  const mergedCommits = await collectMergedCommits(repoRoot, parentBranch, agentBranch);
  let createdCommitSha: string | null = null;

  try {
    if (startBranch !== parentBranch) {
      await checkoutBranch(repoRoot, parentBranch);
    }

    if (strategy === "fast-forward") {
      await git(repoRoot, ["merge", "--ff-only", agentBranch]);
    } else if (strategy === "squash") {
      await git(repoRoot, ["merge", "--squash", "--no-commit", agentBranch]);
      await git(repoRoot, [
        "commit",
        "-m",
        options.squashCommitMessage ??
          `Squash merge ${agentBranch} into ${parentBranch}`,
      ]);
      createdCommitSha = await headSha(repoRoot);
    } else {
      for (const commit of options.cherryPickCommits ?? []) {
        await git(repoRoot, ["cherry-pick", commit]);
      }
      createdCommitSha = await headSha(repoRoot);
    }
  } catch (error) {
    if (strategy === "squash") {
      await git(repoRoot, ["merge", "--abort"]).catch(() => {});
    }
    throw error;
  } finally {
    if (startBranch !== parentBranch) {
      await checkoutBranch(repoRoot, startBranch).catch(() => {});
    }
  }

  return { strategy, mergedCommits, createdCommitSha };
}
