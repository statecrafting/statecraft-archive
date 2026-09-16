import { execFile } from "node:child_process";
import { promises as fs, realpathSync } from "node:fs";
import path from "node:path";
import type {
  CreateAgentWorktreeOptions,
  OapWorktreeEntry,
  RemoveAgentWorktreeOptions,
} from "./types.js";

export const WORKTREES_DIR_NAME = ".worktrees";

export class WorktreeManagerError extends Error {
  constructor(
    message: string,
    public readonly code: "GIT_ERROR" | "PATH_EXISTS" | "NOT_FOUND",
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = "WorktreeManagerError";
  }
}

function sanitizeSegment(input: string): string {
  const t = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return (t.length > 0 ? t : "agent").slice(0, 64);
}

/** Directory name under `.worktrees/` (stable, filesystem-safe). */
export function worktreeDirectoryName(agentId: string): string {
  return sanitizeSegment(agentId);
}

/** Branch name `agent/<id>-<slug>` per 051 spec. */
export function branchNameForAgent(agentId: string, slug: string): string {
  return `agent/${worktreeDirectoryName(agentId)}-${sanitizeSegment(slug)}`;
}

export function defaultWorktreePath(repoRoot: string, agentId: string): string {
  return path.join(repoRoot, WORKTREES_DIR_NAME, worktreeDirectoryName(agentId));
}

/** Compare paths after resolving symlinks (macOS often maps `/var` → `/private/var`). */
export function sameRealPath(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

function toRepoRelativeGitPath(repoRoot: string, absolutePath: string): string {
  const rel = path.relative(repoRoot, absolutePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new WorktreeManagerError(
      `Path ${absolutePath} is not under repo root ${repoRoot}`,
      "NOT_FOUND",
    );
  }
  return rel.split(path.sep).join("/");
}

async function git(
  repoRoot: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new WorktreeManagerError(
              err.message || "git command failed",
              "GIT_ERROR",
              stderr,
            ),
          );
        } else {
          resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
        }
      },
    );
  });
}

/** Ensure `.worktrees/.gitignore` exists so worktree contents are never committed (051 F-001). */
export async function ensureWorktreesDirectoryIgnored(repoRoot: string): Promise<void> {
  const root = path.join(repoRoot, WORKTREES_DIR_NAME);
  await fs.mkdir(root, { recursive: true });
  const gi = path.join(root, ".gitignore");
  try {
    await fs.access(gi);
  } catch {
    await fs.writeFile(gi, "*\n", "utf8");
  }
}

export function parseWorktreeListPorcelain(stdout: string): OapWorktreeEntry[] {
  const blocks = stdout.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  const out: OapWorktreeEntry[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.replace(/\r$/, ""));
    let wtPath: string | undefined;
    let head: string | undefined;
    let branch: string | null = null;
    let detached = false;
    for (const line of lines) {
      if (line.startsWith("worktree ")) wtPath = line.slice("worktree ".length);
      else if (line.startsWith("HEAD ")) head = line.slice("HEAD ".length);
      else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length).trim();
        branch =
          ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
      } else if (line === "detached") detached = true;
    }
    if (wtPath && head) {
      if (detached) branch = null;
      out.push({ path: path.resolve(wtPath), head, branch });
    }
  }
  return out;
}

async function listAllWorktrees(repoRoot: string): Promise<OapWorktreeEntry[]> {
  const { stdout } = await git(repoRoot, ["worktree", "list", "--porcelain"]);
  return parseWorktreeListPorcelain(stdout);
}

function isUnderOapWorktrees(repoRoot: string, worktreePath: string): boolean {
  try {
    const base = realpathSync(path.join(path.resolve(repoRoot), WORKTREES_DIR_NAME));
    const wt = realpathSync(worktreePath);
    const rel = path.relative(base, wt);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

/** List git worktrees whose checkout lives under `.worktrees/`. */
export async function listOapWorktrees(repoRoot: string): Promise<OapWorktreeEntry[]> {
  const all = await listAllWorktrees(repoRoot);
  const root = path.resolve(repoRoot);
  return all.filter((e) => isUnderOapWorktrees(root, e.path));
}

export async function createAgentWorktree(
  options: CreateAgentWorktreeOptions,
): Promise<{ worktreePath: string; branch: string }> {
  const { repoRoot, agentId, slug, startPoint = "HEAD" } = options;
  await ensureWorktreesDirectoryIgnored(repoRoot);
  const branch = branchNameForAgent(agentId, slug);
  const absPath = defaultWorktreePath(repoRoot, agentId);
  const rel = toRepoRelativeGitPath(repoRoot, absPath);
  try {
    await fs.access(absPath);
    throw new WorktreeManagerError(
      `Worktree path already exists: ${absPath}`,
      "PATH_EXISTS",
    );
  } catch (e: unknown) {
    if (e instanceof WorktreeManagerError) throw e;
    const err = e as NodeJS.ErrnoException;
    if (err?.code !== "ENOENT") throw e;
  }
  await git(repoRoot, ["worktree", "add", rel, "-b", branch, startPoint]);
  return { worktreePath: absPath, branch };
}

/**
 * Remove worktree registration and checkout directory. Idempotent: missing path
 * or unregistered worktree is success (NF-003). Uses `git worktree remove --force`
 * when registered.
 */
export async function removeAgentWorktree(
  options: RemoveAgentWorktreeOptions,
): Promise<void> {
  const { repoRoot, agentId, deleteBranchLocalName } = options;
  const absPath = defaultWorktreePath(repoRoot, agentId);
  const rel = toRepoRelativeGitPath(repoRoot, absPath);
  const all = await listAllWorktrees(repoRoot);
  const match = all.some((e) => sameRealPath(e.path, absPath));

  if (match) {
    try {
      await git(repoRoot, ["worktree", "remove", "--force", rel]);
    } catch {
      await fs.rm(absPath, { recursive: true, force: true }).catch(() => {});
    }
  } else {
    await fs.rm(absPath, { recursive: true, force: true }).catch(() => {});
  }

  await git(repoRoot, ["worktree", "prune"]).catch(() => {});

  if (deleteBranchLocalName) {
    await git(repoRoot, ["branch", "-D", deleteBranchLocalName]).catch(() => {});
  }
}

/**
 * Directories under `.worktrees/` that are not named in `knownDirectoryNames`
 * (sanitized agent ids). Used for orphan reconciliation after crash (051 R-003 / F-003).
 */
export async function reconcileOrphanWorktreeDirs(
  repoRoot: string,
  knownDirectoryNames: Set<string>,
): Promise<{ orphanPaths: string[] }> {
  const wtRoot = path.join(repoRoot, WORKTREES_DIR_NAME);
  let entries;
  try {
    entries = await fs.readdir(wtRoot, { withFileTypes: true });
  } catch {
    return { orphanPaths: [] };
  }
  const orphans: string[] = [];
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    if (d.name === ".git") continue;
    if (!knownDirectoryNames.has(d.name)) {
      orphans.push(path.join(wtRoot, d.name));
    }
  }
  return { orphanPaths: orphans };
}
