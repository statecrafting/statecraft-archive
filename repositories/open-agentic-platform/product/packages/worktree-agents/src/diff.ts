import { execFile } from "node:child_process";

export type CommitSummaryEntry = {
  sha: string;
  subject: string;
};

export type AgentDiffResult = {
  unifiedDiff: string;
  commits: CommitSummaryEntry[];
};

export type GetAgentDiffOptions = {
  repoRoot: string;
  parentBranch: string;
  agentBranch: string;
};

export class AgentDiffError extends Error {
  constructor(
    message: string,
    public readonly code: "GIT_ERROR",
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = "AgentDiffError";
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
            new AgentDiffError(err.message || "git command failed", "GIT_ERROR", stderr),
          );
          return;
        }
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      },
    );
  });
}

function parseCommitSummary(stdout: string): CommitSummaryEntry[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const tabIdx = line.indexOf("\t");
      if (tabIdx === -1) {
        return { sha: line, subject: "" };
      }
      return {
        sha: line.slice(0, tabIdx).trim(),
        subject: line.slice(tabIdx + 1).trim(),
      };
    });
}

/** FR-006: unified diff + commit summary between parent and agent branch. */
export async function getAgentDiff(options: GetAgentDiffOptions): Promise<AgentDiffResult> {
  const { repoRoot, parentBranch, agentBranch } = options;
  const [diff, log] = await Promise.all([
    git(repoRoot, ["diff", "--no-color", `${parentBranch}...${agentBranch}`]),
    git(repoRoot, ["log", "--no-color", "--pretty=format:%H%x09%s", `${parentBranch}..${agentBranch}`]),
  ]);

  return {
    unifiedDiff: diff.stdout,
    commits: parseCommitSummary(log.stdout),
  };
}
