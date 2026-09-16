import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BackgroundAgentRunner } from "./agent-runner.js";
import { createAgentWorktree } from "./worktree-manager.js";

function gitLocal(repo: string, args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "pipe" });
}

function initBareRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "oap-runner-"));
  gitLocal(dir, ["init"]);
  gitLocal(dir, ["config", "user.email", "t@t.t"]);
  gitLocal(dir, ["config", "user.name", "t"]);
  writeFileSync(path.join(dir, "README.md"), "main\n", "utf8");
  gitLocal(dir, ["add", "README.md"]);
  gitLocal(dir, ["commit", "-m", "init"]);
  return dir;
}

describe("BackgroundAgentRunner", () => {
  it("runs in the agent worktree and completes", async () => {
    const repo = initBareRepo();
    const { worktreePath } = await createAgentWorktree({
      repoRoot: repo,
      agentId: "runner-a",
      slug: "phase3",
    });

    const runner = new BackgroundAgentRunner({
      agentId: "runner-a",
      worktreePath,
      command: process.execPath,
      args: [
        "-e",
        "const fs=require('node:fs'); fs.writeFileSync('from-runner.txt','ok\\n'); console.log('done');",
      ],
      inactivityTimeoutMs: 2_000,
      permissions: { tools: ["read", "write"] },
    });

    const { result } = runner.start();
    const done = await result;

    expect(done.status).toBe("completed");
    expect(done.timedOut).toBe(false);
    expect(readFileSync(path.join(worktreePath, "from-runner.txt"), "utf8")).toBe(
      "ok\n",
    );
    expect(existsSync(path.join(repo, "from-runner.txt"))).toBe(false);
  });

  it("times out inactive processes and preserves worktree", async () => {
    const repo = initBareRepo();
    const { worktreePath } = await createAgentWorktree({
      repoRoot: repo,
      agentId: "runner-timeout",
      slug: "phase3",
    });

    const runner = new BackgroundAgentRunner({
      agentId: "runner-timeout",
      worktreePath,
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 50);"],
      inactivityTimeoutMs: 100,
      timeoutKillGraceMs: 50,
      permissions: { tools: ["read"] },
    });

    const events: string[] = [];
    runner.on("lifecycle", (e: { status: string }) => events.push(e.status));

    const { result } = runner.start();
    const done = await result;

    expect(done.status).toBe("timed_out");
    expect(done.timedOut).toBe(true);
    expect(existsSync(worktreePath)).toBe(true);
    expect(events).toContain("spawned");
    expect(events).toContain("timed_out");
  });
});
