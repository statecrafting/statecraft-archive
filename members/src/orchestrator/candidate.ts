// Spec 121: the candidate (doc 04 §5, D47, D48). A run works a worktree of
// its own for the spec's branch, under the daemon's home, and the operator's
// checkout is read for its `.git` and nothing else. A worktree shares
// repository administration and is not a security boundary; it is the
// organization the receipt needs (a stable revision, a single writer) and
// the smallest change that keeps a driven session out of the tree the
// operator is sitting in. The environment every session receives is
// scrubbed by the deny list below, the same list on both sides of the wire.

import * as fs from "fs";
import { join } from "path";

import { buildFence, fencePath } from "./fence";

// --- the environment deny list (B-3) ----------------------------------------

// What a driven session never inherits. Both Rust providers drop the same
// names; the contract fixture `child-env-deny.json` is the list both sides
// assert against. Spec 122 adds the GitHub tokens when the engine publishes.
// Spec 122 B-7 added the GitHub tokens: the engine publishes, the candidate
// does not. Spec 125 B-4 adds the ssh agent: a repository whose origin is an
// ssh URL is pushed to from the agent socket, which no token name reaches.
//
// The list is the subtractive half of the fence and can only remove what it
// names. The additive half, which closes the reaches that are not
// environment-variable shaped at all (a keyring-backed `gh`, a credential
// helper, a key on disk), is `fence.ts`.
export const CHILD_ENV_DENY: readonly string[] = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
];

export function scrubEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !CHILD_ENV_DENY.includes(key)) out[key] = value;
  }
  out.NO_COLOR = "1";
  return out;
}

// --- the worktree (B-1) -----------------------------------------------------

export interface OpenCandidateParams {
  // The operator's checkout: where `.git` is, never written to.
  readonly repoDir: string;
  // The daemon's home; candidates live at <homeDir>/candidates/<project>/<branch>.
  readonly homeDir: string;
  readonly project: string;
  readonly branch: string;
  // The commit a fresh branch starts from (119 B-2's resolved base).
  readonly baseSha: string;
}

export interface Candidate {
  readonly path: string;
  readonly branch: string;
  // True when the branch already existed (016 B-2's reconcile): a crashed
  // prior attempt, or an earlier run of the same spec.
  readonly reused: boolean;
  // 125 B-2: the fence built beside this candidate, whose shims and git
  // config the session's environment points at. Never inside `path`.
  readonly fenceDir: string;
}

function git(cwd: string, args: readonly string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["git", ...args], { cwd });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout).trim(),
    stderr: new TextDecoder().decode(result.stderr).trim(),
  };
}

function requireGit(cwd: string, args: readonly string[], label: string): string {
  const result = git(cwd, args);
  if (result.exitCode !== 0) throw new Error(`candidate: ${label} failed (exit ${result.exitCode}): ${result.stderr}`);
  return result.stdout;
}

export function candidatePath(homeDir: string, project: string, branch: string): string {
  return join(homeDir, "candidates", project, branch);
}

// Opens the candidate: a worktree at the candidate path on `branch`. An
// existing worktree at that path is reopened as it is (never recreated); a
// branch that exists without a worktree is checked out into a new one; a
// branch that does not exist is created from `baseSha`. A branch checked
// out elsewhere (the operator's own checkout on the spec branch) cannot be
// a candidate, and the error says so.
export function openCandidate(params: OpenCandidateParams): Candidate {
  const { repoDir, branch, baseSha } = params;
  const path = candidatePath(params.homeDir, params.project, branch);
  // 125 B-2: the fence is rebuilt on every open, before the worktree is
  // touched, so a session never runs against shims left by a crashed round.
  const fenceDir = buildFence(fencePath(params.homeDir, params.project, branch));
  if (fs.existsSync(join(path, ".git"))) {
    const current = requireGit(path, ["branch", "--show-current"], "git branch --show-current");
    if (current !== branch) {
      throw new Error(`candidate: ${path} is a worktree on "${current}", not "${branch}"; remove it before reopening`);
    }
    return { path, branch, reused: true, fenceDir };
  }
  // A stale directory with no worktree behind it (a pruned or half-removed
  // one) is cleared so `git worktree add` can claim the path.
  if (fs.existsSync(path)) fs.rmSync(path, { recursive: true, force: true });
  fs.mkdirSync(join(params.homeDir, "candidates", params.project), { recursive: true });
  // `git worktree prune` first: a worktree whose directory vanished still
  // holds its branch, and `add` would refuse the branch as checked out.
  git(repoDir, ["worktree", "prune"]);
  const exists = git(repoDir, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).exitCode === 0;
  if (exists) {
    requireGit(repoDir, ["worktree", "add", path, branch], `git worktree add ${branch}`);
    return { path, branch, reused: true, fenceDir };
  }
  requireGit(repoDir, ["worktree", "add", "-b", branch, path, baseSha], `git worktree add -b ${branch}`);
  return { path, branch, reused: false, fenceDir };
}

// Removes the worktree and prunes; the branch stays (it is the run's
// history, and the remote may hold it). Idempotent.
export function closeCandidate(repoDir: string, path: string): void {
  if (fs.existsSync(path)) {
    git(repoDir, ["worktree", "remove", "--force", path]);
    fs.rmSync(path, { recursive: true, force: true });
  }
  git(repoDir, ["worktree", "prune"]);
}

// The paths a candidate changed against its base, repository-relative, for
// the receipt's policy-sensitive set (121 B-5).
export function changedPaths(candidateDir: string, baseSha: string, headSha: string): string[] {
  const result = git(candidateDir, ["diff", "--name-only", `${baseSha}..${headSha}`]);
  if (result.exitCode !== 0) throw new Error(`candidate: git diff --name-only failed: ${result.stderr}`);
  return result.stdout.length === 0 ? [] : result.stdout.split("\n");
}

// --- a URL's userinfo (128 B-6) ---------------------------------------------

// An `http` or `https` URL's userinfo, wherever it sits inside a string: the
// part between `://` and an `@` that comes before any path, query or fragment.
// A token can be the user or the password (`x-access-token:<token>@`, or a
// bare `<token>@`), so the whole userinfo goes (D-5). The scheme is matched
// letter by letter rather than case-insensitively and whitespace is spelled
// out, so the Rust copy of this pattern (statecraft-journal's bundle scan)
// matches exactly the same strings.
const URL_USERINFO = /([hH][tT][tT][pP][sS]?:\/\/)[^ \t\n\r\x0B\x0C\/?#@]+@/g;

export function containsUrlUserinfo(text: string): boolean {
  URL_USERINFO.lastIndex = 0;
  return URL_USERINFO.test(text);
}

// Every `http` or `https` URL inside the string, without its userinfo; the
// rest of the string is untouched. What the API applies to a value it serves
// from a record already written (B-8).
export function withoutUrlUserinfo(text: string): string {
  URL_USERINFO.lastIndex = 0;
  return text.replace(URL_USERINFO, "$1");
}

// The one reduction both origin lookups use (B-6). An `http` or `https`
// remote loses its userinfo; one that does not parse as a URL is null, never
// guessed; an `ssh://` or scp-style remote and a local path are returned as
// they are, since an SSH user part is not a secret and 031 withholds a private
// path on export.
export function reduceRemoteUrl(remote: string): string | null {
  if (!/^[hH][tT][tT][pP][sS]?:\/\//.test(remote)) return remote;
  let parsed: URL;
  try {
    parsed = new URL(remote);
  } catch {
    return null;
  }
  if (parsed.username === "" && parsed.password === "") return remote;
  const reduced = withoutUrlUserinfo(remote);
  try {
    const check = new URL(reduced);
    return check.username === "" && check.password === "" ? reduced : null;
  } catch {
    return null;
  }
}

// The remote the repository publishes to, without any credential in it, or
// null when it has none (or has one that does not parse).
export function originUrl(repoDir: string): string | null {
  const result = git(repoDir, ["remote", "get-url", "origin"]);
  return result.exitCode === 0 && result.stdout.length > 0 ? reduceRemoteUrl(result.stdout) : null;
}
