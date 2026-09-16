/**
 * Git plumbing command execution layer.
 * Wraps child_process.execFile for safe, non-shell git invocation.
 */

import { execFile } from "node:child_process";

export interface ExecGitOptions {
  cwd: string;
  maxBuffer?: number;
}

export interface ExecGitResult {
  stdout: string;
  stderr: string;
}

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

export function execGit(
  args: string[],
  options: ExecGitOptions,
): Promise<ExecGitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd: options.cwd,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        encoding: "utf-8",
      },
      (error, stdout, stderr) => {
        if (error) {
          const err = new Error(
            `git ${args[0]} failed: ${stderr || error.message}`,
          );
          (err as NodeJS.ErrnoException).code = (
            error as NodeJS.ErrnoException
          ).code;
          reject(err);
          return;
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });
}

/** Get repository root path. */
export async function repoRoot(cwd: string): Promise<string> {
  const { stdout } = await execGit(
    ["rev-parse", "--show-toplevel"],
    { cwd },
  );
  return stdout.trimEnd();
}

/** Get unstaged changes via diff-files. */
export async function diffFiles(cwd: string): Promise<string> {
  const { stdout } = await execGit(
    ["diff-files", "--name-status"],
    { cwd },
  );
  return stdout;
}

/** Get staged changes via diff-index. */
export async function diffIndex(cwd: string): Promise<string> {
  const { stdout } = await execGit(
    ["diff-index", "--cached", "--name-status", "HEAD"],
    { cwd },
  );
  return stdout;
}

/** Get untracked files via ls-files. */
export async function lsFilesUntracked(cwd: string): Promise<string> {
  const { stdout } = await execGit(
    ["ls-files", "--others", "--exclude-standard"],
    { cwd },
  );
  return stdout;
}

/** Get current branch name. */
export async function currentBranch(cwd: string): Promise<string> {
  const { stdout } = await execGit(
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd },
  );
  return stdout.trimEnd();
}

/** Get ahead/behind counts relative to upstream. Returns [ahead, behind]. */
export async function aheadBehind(
  cwd: string,
): Promise<[number, number]> {
  try {
    const { stdout } = await execGit(
      ["rev-list", "--left-right", "--count", "HEAD...@{u}"],
      { cwd },
    );
    const parts = stdout.trim().split(/\s+/);
    return [parseInt(parts[0] ?? "0", 10), parseInt(parts[1] ?? "0", 10)];
  } catch {
    // No upstream configured
    return [0, 0];
  }
}

/** Get upstream branch name. */
export async function upstreamBranch(
  cwd: string,
): Promise<string | undefined> {
  try {
    const { stdout } = await execGit(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      { cwd },
    );
    const name = stdout.trimEnd();
    return name || undefined;
  } catch {
    return undefined;
  }
}

/** Get unified diff for a file (staged or unstaged). */
export async function fileDiff(
  cwd: string,
  path: string,
  staged: boolean,
): Promise<string> {
  const args = staged
    ? ["diff-index", "--cached", "-p", "HEAD", "--", path]
    : ["diff-files", "-p", path];
  const { stdout } = await execGit(args, { cwd });
  return stdout;
}

/** Get commit log with a structured format. Uses \x01 as record separator. */
export async function gitLog(
  cwd: string,
  limit: number,
  offset?: number,
): Promise<string> {
  const args = [
    "log",
    `--format=%H%x00%h%x00%an%x00%ae%x00%at%x00%P%x00%s%x01`,
    `-n`,
    String(limit),
  ];
  if (offset && offset > 0) {
    args.push(`--skip=${offset}`);
  }
  const { stdout } = await execGit(args, { cwd });
  return stdout;
}

/** Get diff for a specific commit. */
export async function commitDiffRaw(
  cwd: string,
  hash: string,
): Promise<string> {
  const { stdout } = await execGit(
    ["diff-tree", "-p", hash],
    { cwd },
  );
  return stdout;
}

/** List local branches with structured format. */
export async function forEachRef(cwd: string): Promise<string> {
  const { stdout } = await execGit(
    [
      "for-each-ref",
      "--format=%(refname:short)%00%(objectname:short)%00%(committerdate:unix)%00%(upstream:short)",
      "refs/heads/",
    ],
    { cwd },
  );
  return stdout;
}

/** Stage a file. */
export async function stageFile(
  cwd: string,
  path: string,
): Promise<void> {
  await execGit(["add", "--", path], { cwd });
}

/** Unstage a file. */
export async function unstageFile(
  cwd: string,
  path: string,
): Promise<void> {
  await execGit(["reset", "HEAD", "--", path], { cwd });
}

/** Stage a patch from stdin. */
export async function applyPatch(
  cwd: string,
  patch: string,
  cached: boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = cached
      ? ["apply", "--cached", "--unidiff-zero", "-"]
      : ["apply", "--unidiff-zero", "-"];
    const child = execFile(
      "git",
      args,
      { cwd, encoding: "utf-8" },
      (error, _stdout, stderr) => {
        if (error) {
          reject(
            new Error(`git apply failed: ${stderr || error.message}`),
          );
          return;
        }
        resolve();
      },
    );
    child.stdin?.write(patch);
    child.stdin?.end();
  });
}

/** Create a commit. */
export async function createCommit(
  cwd: string,
  message: string,
  options?: { amend?: boolean; signoff?: boolean },
): Promise<string> {
  const args = ["commit", "-m", message];
  if (options?.amend) args.push("--amend");
  if (options?.signoff) args.push("--signoff");
  args.push("--format=%H");
  await execGit(args, { cwd });
  // Return the new HEAD hash
  const { stdout } = await execGit(
    ["rev-parse", "HEAD"],
    { cwd },
  );
  return stdout.trimEnd();
}

/** Switch to a branch. */
export async function checkoutBranch(
  cwd: string,
  branch: string,
): Promise<void> {
  await execGit(["checkout", branch], { cwd });
}

/** Create a new branch from HEAD. */
export async function createNewBranch(
  cwd: string,
  name: string,
): Promise<void> {
  await execGit(["checkout", "-b", name], { cwd });
}

/** Get the staged diff as a string (for AI commit message generation). */
export async function stagedDiff(cwd: string): Promise<string> {
  const { stdout } = await execGit(
    ["diff", "--cached"],
    { cwd },
  );
  return stdout;
}
