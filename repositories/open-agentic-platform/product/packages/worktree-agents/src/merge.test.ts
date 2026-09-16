import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mergeAgent } from "./merge.js";

function gitLocal(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString("utf8");
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "oap-wt-merge-"));
  gitLocal(dir, ["init"]);
  gitLocal(dir, ["config", "user.email", "t@t.t"]);
  gitLocal(dir, ["config", "user.name", "t"]);
  writeFileSync(path.join(dir, "README.md"), "base\n", "utf8");
  gitLocal(dir, ["add", "README.md"]);
  gitLocal(dir, ["commit", "-m", "init"]);
  return dir;
}

describe("merge", () => {
  it("squash merge creates one parent-branch commit with agent changes", async () => {
    const repo = initRepo();
    const parent = gitLocal(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    const agent = "agent/a1-fix";
    gitLocal(repo, ["checkout", "-b", agent]);
    writeFileSync(path.join(repo, "README.md"), "base\nmore\n", "utf8");
    gitLocal(repo, ["add", "README.md"]);
    gitLocal(repo, ["commit", "-m", "change 1"]);
    writeFileSync(path.join(repo, "SECOND.md"), "second\n", "utf8");
    gitLocal(repo, ["add", "SECOND.md"]);
    gitLocal(repo, ["commit", "-m", "change 2"]);
    gitLocal(repo, ["checkout", parent]);

    const beforeHead = gitLocal(repo, ["rev-parse", "HEAD"]).trim();
    const result = await mergeAgent({
      repoRoot: repo,
      parentBranch: parent,
      agentBranch: agent,
      strategy: "squash",
      squashCommitMessage: "squash agent branch",
    });
    const afterHead = gitLocal(repo, ["rev-parse", "HEAD"]).trim();

    expect(result.createdCommitSha).toBe(afterHead);
    expect(result.mergedCommits.length).toBe(2);
    expect(beforeHead).not.toBe(afterHead);
    const parentCount = gitLocal(repo, ["rev-list", "--count", `${beforeHead}..${afterHead}`]).trim();
    expect(parentCount).toBe("1");
    const parentLine = gitLocal(repo, ["rev-list", "--parents", "-n", "1", afterHead]).trim();
    expect(parentLine.split(" ").length).toBe(2);
    expect(readFileSync(path.join(repo, "README.md"), "utf8")).toContain("more");
    expect(readFileSync(path.join(repo, "SECOND.md"), "utf8")).toContain("second");
  });
});
