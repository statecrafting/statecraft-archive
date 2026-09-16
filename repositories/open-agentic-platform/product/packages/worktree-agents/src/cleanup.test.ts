import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discardAgent } from "./cleanup.js";
import { branchNameForAgent, createAgentWorktree, defaultWorktreePath } from "./worktree-manager.js";

function gitLocal(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString("utf8");
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "oap-wt-clean-"));
  gitLocal(dir, ["init"]);
  gitLocal(dir, ["config", "user.email", "t@t.t"]);
  gitLocal(dir, ["config", "user.name", "t"]);
  writeFileSync(path.join(dir, "README.md"), "base\n", "utf8");
  gitLocal(dir, ["add", "README.md"]);
  gitLocal(dir, ["commit", "-m", "init"]);
  return dir;
}

describe("cleanup", () => {
  it("discardAgent removes worktree directory and local branch artifacts", async () => {
    const repo = initRepo();
    const agentId = "discard-01";
    const slug = "cleanup";
    const { branch } = await createAgentWorktree({ repoRoot: repo, agentId, slug });
    const worktreePath = defaultWorktreePath(repo, agentId);
    expect(existsSync(worktreePath)).toBe(true);

    await discardAgent({ repoRoot: repo, agentId, branchName: branch });

    expect(existsSync(worktreePath)).toBe(false);
    let branchStillExists = true;
    try {
      execFileSync(
        "git",
        ["show-ref", "--verify", "--quiet", `refs/heads/${branchNameForAgent(agentId, slug)}`],
        { cwd: repo, stdio: "pipe" },
      );
    } catch {
      branchStillExists = false;
    }
    expect(branchStillExists).toBe(false);
  });
});
