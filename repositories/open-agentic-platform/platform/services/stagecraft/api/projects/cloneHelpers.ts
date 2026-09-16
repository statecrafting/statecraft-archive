/**
 * Spec 113 Phase 1b — pure helpers + shell wrappers for the clone endpoint.
 *
 * The Encore endpoint lives in `clone.ts`; this file is split out so
 * vitest can exercise the pure pieces (default-name derivation, size-cap
 * threshold logic) without booting the Encore native runtime — same
 * pattern as `importHelpers.ts` and `cloneAvailabilityHelpers.ts`.
 */

import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import log from "encore.dev/log";

// ---------------------------------------------------------------------------
// Default-name derivation (FR-009 server-side mirror)
// ---------------------------------------------------------------------------

/**
 * The dialog pre-fills `repoName = "<sourceRepo>-clone"`. The submit
 * endpoint needs to recompute the same default to detect when a request
 * body's `repoName` matches the server's default — silent suffixing is
 * only allowed on the default path (FR-029).
 */
export function defaultRepoName(sourceRepo: string): string {
  return `${sourceRepo}-clone`;
}

/**
 * Mirror of `defaultRepoName` for project slugs (FR-030).
 */
export function defaultProjectSlug(sourceSlug: string): string {
  return `${sourceSlug}-clone`;
}

/**
 * Generate the Nth suffixed candidate for a base name.
 *   index 0 → base
 *   index 1 → base-2
 *   index 2 → base-3
 *   …
 */
export function suffixCandidate(base: string, index: number): string {
  if (index === 0) return base;
  return `${base}-${index + 1}`;
}

// ---------------------------------------------------------------------------
// Size-cap evaluation (FR-036)
// ---------------------------------------------------------------------------

export const DEFAULT_CLONE_MAX_BYTES = 500 * 1024 * 1024; // 500 MB
export const DEFAULT_CLONE_MAX_COMMITS = 50_000;

export interface SizeCapEnv {
  maxBytes?: number;
  maxCommits?: number;
}

export function resolveSizeCaps(env: NodeJS.ProcessEnv): {
  maxBytes: number;
  maxCommits: number;
} {
  const bytesRaw = env.statecraft_CLONE_MAX_BYTES;
  const commitsRaw = env.statecraft_CLONE_MAX_COMMITS;
  const maxBytes =
    bytesRaw !== undefined && Number.isFinite(Number(bytesRaw))
      ? Number(bytesRaw)
      : DEFAULT_CLONE_MAX_BYTES;
  const maxCommits =
    commitsRaw !== undefined && Number.isFinite(Number(commitsRaw))
      ? Number(commitsRaw)
      : DEFAULT_CLONE_MAX_COMMITS;
  return { maxBytes, maxCommits };
}

/**
 * Pure decision: given the observed clone size and commit count, decide
 * whether the source exceeds the configured cap.
 */
export function isOverSizeCap(args: {
  bytes: number;
  commits: number;
  maxBytes: number;
  maxCommits: number;
}): { over: boolean; reason?: "bytes" | "commits" } {
  if (args.bytes > args.maxBytes) return { over: true, reason: "bytes" };
  if (args.commits > args.maxCommits) return { over: true, reason: "commits" };
  return { over: false };
}

// ---------------------------------------------------------------------------
// Shell helpers (mirror clone, push, size measurements, repo delete)
// ---------------------------------------------------------------------------

export type RunCmdResult = { stdout: string; stderr: string };

/**
 * Redact `x-access-token:<TOKEN>` (and a few other obvious credential
 * shapes) from any string that may carry the result of a shell invocation
 * with auth in argv. Belt-and-suspenders: argv values like
 *   https://x-access-token:ghs_xxx@github.com/owner/repo.git
 * leak into Error messages and stderr otherwise.
 */
export function redactSecrets(s: string): string {
  return s
    .replace(/x-access-token:[^@\s]+@/g, "x-access-token:***@")
    .replace(/(https?:\/\/)[^:@\s/]+:[^@\s]+@/g, "$1***:***@");
}

export function runCmd(
  bin: string,
  args: string[],
  opts: { cwd?: string } = {}
): Promise<RunCmdResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on("data", (d: Buffer) => out.push(d));
    proc.stderr.on("data", (d: Buffer) => err.push(d));
    proc.on("close", (code) => {
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      if (code === 0) resolve({ stdout, stderr });
      else {
        const safeArgs = args.map(redactSecrets).join(" ");
        const safeOutput = redactSecrets(stderr || stdout);
        reject(
          new Error(`${bin} ${safeArgs} exited ${code}: ${safeOutput}`)
        );
      }
    });
    proc.on("error", reject);
  });
}

/**
 * `git clone --mirror` of `<owner>/<repo>` into a fresh tempdir, returning
 * the absolute path to the bare mirror. The caller owns cleanup.
 */
export async function mirrorClone(
  installationToken: string,
  owner: string,
  repo: string
): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), "statecraft-clone-"));
  const target = join(workDir, "mirror.git");
  const authUrl = `https://x-access-token:${installationToken}@github.com/${owner}/${repo}.git`;
  await runCmd("git", ["clone", "--mirror", authUrl, target]);
  return target;
}

/**
 * Push branches and tags from a bare mirror to a destination remote URL
 * (which must already include the auth header in its userinfo segment).
 *
 * Explicit refspecs instead of `--mirror`: GitHub denies updates to
 * `refs/pull/*` ("hidden refs") and `refs/notes/*`, which would fail the
 * whole mirror push. The destination is a freshly-created repo so there
 * are no refs to prune, and the source's pull-request refs are not
 * meaningful in the new repo anyway.
 */
export async function mirrorPush(
  mirrorPath: string,
  authedRemoteUrl: string
): Promise<void> {
  await runCmd(
    "git",
    [
      "push",
      authedRemoteUrl,
      "+refs/heads/*:refs/heads/*",
      "+refs/tags/*:refs/tags/*",
    ],
    { cwd: mirrorPath }
  );
}

/**
 * Read the source repo's default branch from the mirror (HEAD ref). Falls
 * back to "main" if HEAD is detached or unreadable.
 */
export async function readDefaultBranch(mirrorPath: string): Promise<string> {
  try {
    const { stdout } = await runCmd(
      "git",
      ["symbolic-ref", "HEAD"],
      { cwd: mirrorPath }
    );
    const ref = stdout.trim();
    if (ref.startsWith("refs/heads/")) return ref.substring("refs/heads/".length);
  } catch {
    // fall through
  }
  return "main";
}

/**
 * Best-effort byte size of the mirror dir. Uses `du -sk` for portability.
 */
export async function measureBytes(mirrorPath: string): Promise<number> {
  try {
    const { stdout } = await runCmd("du", ["-sk", mirrorPath]);
    const kb = Number(stdout.trim().split(/\s+/, 1)[0]);
    if (Number.isFinite(kb)) return kb * 1024;
  } catch (err) {
    log.warn("clone: du failed", { err: String(err) });
  }
  return 0;
}

/**
 * Add a working tree from the bare mirror so we can walk `.artifacts/raw/`
 * for knowledge-object hydration without a second network clone. Returns
 * the absolute path of the new worktree.
 */
export async function addWorktree(
  mirrorPath: string,
  branch: string
): Promise<string> {
  const wtRoot = await mkdtemp(join(tmpdir(), "statecraft-clone-wt-"));
  const wtPath = join(wtRoot, "tree");
  await runCmd("git", ["worktree", "add", "--detach", wtPath, branch], {
    cwd: mirrorPath,
  });
  return wtPath;
}

/**
 * Total commit count across all refs in the mirror.
 */
export async function measureCommitCount(mirrorPath: string): Promise<number> {
  try {
    const { stdout } = await runCmd(
      "git",
      ["rev-list", "--count", "--all"],
      { cwd: mirrorPath }
    );
    const n = Number(stdout.trim());
    if (Number.isFinite(n)) return n;
  } catch (err) {
    log.warn("clone: rev-list --count --all failed", { err: String(err) });
  }
  return 0;
}

// ---------------------------------------------------------------------------
// GitHub repo create (without auto_init) + default-branch / privacy fixups
// ---------------------------------------------------------------------------

const GITHUB_API = "https://api.github.com";
const GH_API_VERSION = "2022-11-28";

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": GH_API_VERSION,
  };
}

/**
 * Probe `GET /repos/:org/:repo` for the source repo's privacy and default
 * branch. Used to mirror the source's privacy posture (FR-028) and to
 * pin the destination's default branch after `git push --mirror`.
 */
export async function probeSourceRepo(
  token: string,
  owner: string,
  repo: string
): Promise<{ isPrivate: boolean; defaultBranch: string } | null> {
  try {
    const resp = await fetch(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers: ghHeaders(token) }
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      private: boolean;
      default_branch: string;
    };
    return { isPrivate: data.private, defaultBranch: data.default_branch };
  } catch (err) {
    log.warn("clone: probeSourceRepo failed", { owner, repo, err: String(err) });
    return null;
  }
}

/**
 * Create a GitHub repo intended as a mirror-push target. Differs from
 * `createGitHubRepo` (factory-create's helper) in two ways: `auto_init`
 * is FALSE (the source's first commit becomes the destination's first
 * commit) and `delete_branch_on_merge` is TRUE.
 */
export async function createCloneDestRepo(
  token: string,
  org: string,
  repoName: string,
  opts: { isPrivate: boolean; description: string }
): Promise<{ fullName: string; cloneUrl: string; htmlUrl: string }> {
  const resp = await fetch(`${GITHUB_API}/orgs/${org}/repos`, {
    method: "POST",
    headers: ghHeaders(token),
    body: JSON.stringify({
      name: repoName,
      description: opts.description,
      private: opts.isPrivate,
      auto_init: false,
      delete_branch_on_merge: true,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    if (resp.status === 422 && body.includes("already exists")) {
      throw new Error(`Repository ${org}/${repoName} already exists on GitHub`);
    }
    throw new Error(`GitHub create repo failed: ${resp.status} ${body}`);
  }
  const data = (await resp.json()) as {
    full_name: string;
    clone_url: string;
    html_url: string;
  };
  return {
    fullName: data.full_name,
    cloneUrl: data.clone_url,
    htmlUrl: data.html_url,
  };
}

/**
 * After `git push --mirror`, the destination's HEAD ref may still point at
 * a branch name that differs from the source's default branch. PATCH the
 * repo's `default_branch` so the user lands on the right branch.
 */
export async function setDefaultBranch(
  token: string,
  fullName: string,
  defaultBranch: string
): Promise<void> {
  const resp = await fetch(`${GITHUB_API}/repos/${fullName}`, {
    method: "PATCH",
    headers: ghHeaders(token),
    body: JSON.stringify({ default_branch: defaultBranch }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    log.warn("clone: setDefaultBranch failed", {
      repo: fullName,
      defaultBranch,
      status: resp.status,
      body: body.slice(0, 300),
    });
  }
}

// ---------------------------------------------------------------------------
// GitHub repo delete (rollback)
// ---------------------------------------------------------------------------

/**
 * Best-effort `DELETE /repos/:owner/:repo`. Logs `rollback_repo_delete_failed`
 * on non-2xx, never throws — the rollback path must always be able to
 * propagate the original error to the caller.
 */
export async function deleteGithubRepo(
  token: string,
  fullName: string,
  fetcher: typeof fetch = fetch
): Promise<void> {
  try {
    const resp = await fetcher(
      `https://api.github.com/repos/${fullName}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    if (!resp.ok && resp.status !== 404) {
      log.warn("rollback_repo_delete_failed", {
        repo: fullName,
        status: resp.status,
      });
    }
  } catch (err) {
    log.warn("rollback_repo_delete_failed", {
      repo: fullName,
      err: String(err),
    });
  }
}
