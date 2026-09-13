// Spec 121 FR-001, FR-004: the candidate worktree over a real repository,
// and the environment deny list on both sides of the wire.

import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  CHILD_ENV_DENY,
  candidatePath,
  changedPaths,
  closeCandidate,
  containsUrlUserinfo,
  openCandidate,
  originUrl,
  reduceRemoteUrl,
  scrubEnv,
  withoutUrlUserinfo,
} from "./candidate";

function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
  return new TextDecoder().decode(result.stdout).trim();
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "candidate-repo-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "t"]);
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "init"]);
  return dir;
}

function snapshot(dir: string): { head: string; branch: string; status: string } {
  return { head: git(dir, ["rev-parse", "HEAD"]), branch: git(dir, ["branch", "--show-current"]), status: git(dir, ["status", "--porcelain"]) };
}

test("B-1: open creates a worktree and a branch from the base; reopen reuses; close removes and prunes; the checkout never moves", () => {
  const repo = initRepo();
  const home = mkdtempSync(join(tmpdir(), "candidate-home-"));
  const base = git(repo, ["rev-parse", "main"]);
  // The operator's checkout is dirty and on another branch: allowed.
  git(repo, ["checkout", "-q", "-b", "operator-work"]);
  writeFileSync(join(repo, "scratch.txt"), "uncommitted\n");
  const before = snapshot(repo);

  const opened = openCandidate({ repoDir: repo, homeDir: home, project: "p", branch: "900-spec", baseSha: base });
  expect(opened.path).toBe(candidatePath(home, "p", "900-spec"));
  expect(opened.path).toBe(join(home, "candidates", "p", "900-spec"));
  expect(opened.reused).toBe(false);
  expect(git(opened.path, ["branch", "--show-current"])).toBe("900-spec");
  expect(git(opened.path, ["rev-parse", "HEAD"])).toBe(base);
  expect(snapshot(repo)).toEqual(before);

  // Work in the candidate is invisible to the checkout.
  writeFileSync(join(opened.path, "src.txt"), "work\n");
  git(opened.path, ["add", "-A"]);
  git(opened.path, ["commit", "-q", "-m", "work"]);
  const head = git(opened.path, ["rev-parse", "HEAD"]);
  expect(snapshot(repo)).toEqual(before);
  expect(changedPaths(opened.path, base, head)).toEqual(["src.txt"]);
  expect(existsSync(join(repo, "src.txt"))).toBe(false);

  // Reopen: the same worktree, as it was left.
  const again = openCandidate({ repoDir: repo, homeDir: home, project: "p", branch: "900-spec", baseSha: base });
  expect(again.path).toBe(opened.path);
  expect(again.reused).toBe(true);
  expect(git(again.path, ["rev-parse", "HEAD"])).toBe(head);

  // Close: the worktree goes, the branch and its commit stay.
  closeCandidate(repo, opened.path);
  expect(existsSync(opened.path)).toBe(false);
  expect(git(repo, ["rev-parse", "900-spec"])).toBe(head);
  expect(git(repo, ["worktree", "list"]).split("\n").length).toBe(1);
  closeCandidate(repo, opened.path);

  // An existing branch without a worktree is checked out into a new one
  // (016 B-2's reused).
  const third = openCandidate({ repoDir: repo, homeDir: home, project: "p", branch: "900-spec", baseSha: base });
  expect(third.reused).toBe(true);
  expect(git(third.path, ["rev-parse", "HEAD"])).toBe(head);
  expect(snapshot(repo)).toEqual(before);
});

test("B-1: a branch checked out in the operator's checkout cannot be a candidate, and the error says so", () => {
  const repo = initRepo();
  const home = mkdtempSync(join(tmpdir(), "candidate-home-"));
  const base = git(repo, ["rev-parse", "main"]);
  git(repo, ["checkout", "-q", "-b", "900-spec"]);
  expect(() => openCandidate({ repoDir: repo, homeDir: home, project: "p", branch: "900-spec", baseSha: base })).toThrow(/worktree add/);
});

test("B-1: a stale directory at the candidate path with no worktree behind it is cleared, not reused", () => {
  const repo = initRepo();
  const home = mkdtempSync(join(tmpdir(), "candidate-home-"));
  const base = git(repo, ["rev-parse", "main"]);
  const path = candidatePath(home, "p", "900-spec");
  Bun.spawnSync(["mkdir", "-p", path]);
  writeFileSync(join(path, "stale.txt"), "x");
  const opened = openCandidate({ repoDir: repo, homeDir: home, project: "p", branch: "900-spec", baseSha: base });
  expect(opened.reused).toBe(false);
  expect(existsSync(join(path, "stale.txt"))).toBe(false);
  expect(readFileSync(join(path, "README.md"), "utf8")).toBe("# fixture\n");
});

test("originUrl answers the remote or null", () => {
  const repo = initRepo();
  expect(originUrl(repo)).toBeNull();
  git(repo, ["remote", "add", "origin", "git@example.invalid:o/r.git"]);
  expect(originUrl(repo)).toBe("git@example.invalid:o/r.git");
});

// 128 FR-005: the remote shapes F3 measured passing through verbatim, each
// set on a real repository and read back through the production lookup.
test("128 FR-005: originUrl drops the whole userinfo of an https remote and leaves the other shapes alone", () => {
  const cases: readonly (readonly [string, string | null])[] = [
    ["https://x-access-token:ghp_fabricated0000@github.com/org/repo.git", "https://github.com/org/repo.git"],
    ["https://user:password@github.com/org/repo.git", "https://github.com/org/repo.git"],
    ["https://ghp_fabricatedUserOnly@github.com/org/repo.git", "https://github.com/org/repo.git"],
    ["http://user:pw@git.example.invalid:8080/r.git", "http://git.example.invalid:8080/r.git"],
    ["https://github.com/org/repo.git", "https://github.com/org/repo.git"],
    ["git@github.com:org/repo.git", "git@github.com:org/repo.git"],
    ["ssh://git@github.com/org/repo.git", "ssh://git@github.com/org/repo.git"],
    ["/srv/git/repo.git", "/srv/git/repo.git"],
    // Names https and does not parse as a URL (a port that is not one): null, never guessed.
    ["https://user:pa/ss@github.com/org/repo.git", null],
  ];
  for (const [remote, expected] of cases) {
    const repo = initRepo();
    git(repo, ["remote", "add", "origin", remote]);
    expect(originUrl(repo)).toBe(expected);
  }
  expect(reduceRemoteUrl("https://x-access-token:tok@github.com/o/r")).toBe("https://github.com/o/r");
  expect(containsUrlUserinfo("origin is https://tok@github.com/o/r")).toBe(true);
  expect(containsUrlUserinfo("https://github.com/o/r?u=a@b")).toBe(false);
  expect(withoutUrlUserinfo("a https://u:t@h/x and HTTP://v@h2/y")).toBe("a https://h/x and HTTP://h2/y");
});

test("B-3 / FR-004: scrubEnv drops exactly the deny list and sets NO_COLOR; the list is the contract's", () => {
  const fixture = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "..", "..", "crates", "statecraft-contract", "fixtures", "child-env-deny.json"), "utf8")
  ) as string[];
  expect(fixture).toEqual([...CHILD_ENV_DENY]);
  const env = scrubEnv({
    ANTHROPIC_API_KEY: "a",
    OPENAI_API_KEY: "o",
    GH_TOKEN: "g",
    GITHUB_TOKEN: "t",
    SSH_AUTH_SOCK: "/tmp/agent.sock",
    SSH_AGENT_PID: "42",
    HOME: "/h",
    PATH: "/bin",
    EMPTY: undefined,
  });
  expect(env).toEqual({ HOME: "/h", PATH: "/bin", NO_COLOR: "1" });
  // 122 B-7 made it four; 125 B-4 adds the ssh agent, because a repository
  // whose origin is an ssh URL is pushed to from the socket, not a token.
  expect(CHILD_ENV_DENY.length).toBe(6);
});
