import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  branchNameForAgent,
  createAgentWorktree,
  defaultWorktreePath,
  ensureWorktreesDirectoryIgnored,
  listOapWorktrees,
  reconcileOrphanWorktreeDirs,
  removeAgentWorktree,
  sameRealPath,
  worktreeDirectoryName,
} from "./worktree-manager.js";

function gitLocal(repo: string, args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "pipe" });
}

function initBareRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "oap-wt-"));
  gitLocal(dir, ["init"]);
  gitLocal(dir, ["config", "user.email", "t@t.t"]);
  gitLocal(dir, ["config", "user.name", "t"]);
  writeFileSync(path.join(dir, "README.md"), "main\n", "utf8");
  gitLocal(dir, ["add", "README.md"]);
  gitLocal(dir, ["commit", "-m", "init"]);
  return dir;
}

describe("worktree-manager", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) {
      try {
        execFileSync("git", ["worktree", "prune"], { cwd: d, stdio: "pipe" });
      } catch {
        /* ignore */
      }
    }
    dirs.length = 0;
  });

  it("createAgentWorktree adds an isolated checkout under .worktrees", async () => {
    const repo = initBareRepo();
    dirs.push(repo);
    const agentId = "a1b2c3";
    const slug = "fix-typos";
    const { worktreePath, branch } = await createAgentWorktree({
      repoRoot: repo,
      agentId,
      slug,
    });
    expect(branch).toBe(branchNameForAgent(agentId, slug));
    expect(worktreePath).toBe(defaultWorktreePath(repo, agentId));

    const mainReadme = readFileSync(path.join(repo, "README.md"), "utf8");
    writeFileSync(path.join(worktreePath, "wt-only.txt"), "secret\n", "utf8");
    expect(readFileSync(path.join(repo, "README.md"), "utf8")).toBe(mainReadme);
    expect(() => readFileSync(path.join(repo, "wt-only.txt"), "utf8")).toThrow();

    const listed = await listOapWorktrees(repo);
    expect(listed.some((e) => sameRealPath(e.path, worktreePath))).toBe(true);
  });

  it("ensureWorktreesDirectoryIgnored writes .worktrees/.gitignore", async () => {
    const repo = initBareRepo();
    dirs.push(repo);
    await ensureWorktreesDirectoryIgnored(repo);
    const gi = readFileSync(path.join(repo, ".worktrees", ".gitignore"), "utf8");
    expect(gi.trim()).toBe("*");
  });

  it("removeAgentWorktree is idempotent", async () => {
    const repo = initBareRepo();
    dirs.push(repo);
    const agentId = "x1";
    const branch = branchNameForAgent(agentId, "t");
    await createAgentWorktree({ repoRoot: repo, agentId, slug: "t" });
    await removeAgentWorktree({
      repoRoot: repo,
      agentId,
      deleteBranchLocalName: branch,
    });
    await removeAgentWorktree({
      repoRoot: repo,
      agentId,
      deleteBranchLocalName: branch,
    });
    const listed = await listOapWorktrees(repo);
    expect(listed.some((e) => e.branch?.includes(worktreeDirectoryName(agentId)))).toBe(
      false,
    );
  });

  it("reconcileOrphanWorktreeDirs flags unknown directories", async () => {
    const repo = initBareRepo();
    dirs.push(repo);
    await ensureWorktreesDirectoryIgnored(repo);
    const orphan = path.join(repo, ".worktrees", "ghost");
    const fsp = await import("node:fs/promises");
    await fsp.mkdir(orphan, { recursive: true });
    await fsp.writeFile(path.join(orphan, "f.txt"), "x", "utf8");

    const { orphanPaths } = await reconcileOrphanWorktreeDirs(repo, new Set(["known"]));
    expect(orphanPaths.map((p) => path.basename(p))).toContain("ghost");
  });
});
