import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAgentDiff } from "./diff.js";

function gitLocal(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString("utf8");
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "oap-wt-diff-"));
  gitLocal(dir, ["init"]);
  gitLocal(dir, ["config", "user.email", "t@t.t"]);
  gitLocal(dir, ["config", "user.name", "t"]);
  writeFileSync(path.join(dir, "README.md"), "line-1\n", "utf8");
  gitLocal(dir, ["add", "README.md"]);
  gitLocal(dir, ["commit", "-m", "init"]);
  return dir;
}

describe("diff", () => {
  it("returns unified diff and commit summary for all agent branch changes", async () => {
    const repo = initRepo();
    const parent = gitLocal(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    const agent = "agent/a1-fix";
    gitLocal(repo, ["checkout", "-b", agent]);
    writeFileSync(path.join(repo, "README.md"), "line-1\nline-2\n", "utf8");
    gitLocal(repo, ["add", "README.md"]);
    gitLocal(repo, ["commit", "-m", "agent change 1"]);
    writeFileSync(path.join(repo, "NOTES.md"), "note\n", "utf8");
    gitLocal(repo, ["add", "NOTES.md"]);
    gitLocal(repo, ["commit", "-m", "agent change 2"]);
    gitLocal(repo, ["checkout", parent]);

    const result = await getAgentDiff({
      repoRoot: repo,
      parentBranch: parent,
      agentBranch: agent,
    });

    expect(result.unifiedDiff).toContain("diff --git a/README.md b/README.md");
    expect(result.unifiedDiff).toContain("diff --git a/NOTES.md b/NOTES.md");
    expect(result.commits.length).toBe(2);
    expect(result.commits.map((c) => c.subject)).toEqual([
      "agent change 2",
      "agent change 1",
    ]);
  });
});
