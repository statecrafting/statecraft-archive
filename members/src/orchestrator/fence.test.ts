// Spec 125 FR-001, FR-003, FR-004: the credential fence, proven from inside.
// Spec 129 B-3 adds the supervisor's count, proven the same way.
//
// Every case here spawns a real process with the fenced environment and reads
// what it did, rather than asserting over the object the engine built. An
// environment that looks right and does not close the reach is exactly the
// failure 122's recorded limit was, so the suite is a negative one in 124's
// idiom. No case touches the real github.com; the remote is a bare
// repository on disk, which is 122's live-smoke shape.

import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scrubEnv, CHILD_ENV_DENY, openCandidate } from "./candidate";
import {
  applyFence,
  buildFence,
  fenceBinDir,
  fenceOverlay,
  fencePath,
  fenceRefusalLog,
  gitConfigSource,
  openFenceChannel,
  readFenceRefusals,
  shimSource,
  FENCE_REFUSAL_EXIT,
} from "./fence";

function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
  return new TextDecoder().decode(result.stdout).trim();
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "fence-repo-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "t"]);
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "init"]);
  return dir;
}

interface Ran {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

// Runs a command with exactly the environment a fenced session receives.
function inFence(fenceDir: string, cwd: string, cmd: string[]): Ran {
  const env = applyFence(scrubEnv(process.env), fenceDir);
  const result = Bun.spawnSync(cmd, { cwd, env });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function freshFence(): string {
  return buildFence(fencePath(mkdtempSync(join(tmpdir(), "fence-home-")), "p", "900-spec"));
}

// --- B-3: the overlay (FR-003) ----------------------------------------------

test("B-3: the overlay names every redirection, puts the fence first on PATH, and leaves HOME alone", () => {
  const fence = freshFence();
  const scrubbed = scrubEnv({ PATH: "/usr/bin:/bin", HOME: "/Users/someone", FOO: "bar" });
  const env = applyFence(scrubbed, fence);

  expect(env.PATH).toBe(`${fenceBinDir(fence)}:/usr/bin:/bin`);
  expect(env.PATH.startsWith(fenceBinDir(fence))).toBe(true);
  expect(env.GH_CONFIG_DIR).toBe(join(fence, "gh"));
  expect(env.GIT_CONFIG_GLOBAL).toBe(join(fence, "gitconfig"));
  expect(env.GIT_CONFIG_SYSTEM).toBe("/dev/null");
  expect(env.GIT_TERMINAL_PROMPT).toBe("0");
  expect(env.GIT_ASKPASS).toBe(join(fenceBinDir(fence), "gh"));
  expect(env.SSH_ASKPASS).toBe(join(fenceBinDir(fence), "gh"));

  // HOME is deliberately untouched: both providers authenticate from it.
  expect(env.HOME).toBe("/Users/someone");
  expect(env.FOO).toBe("bar");
  // Every key the overlay names is in the table and nowhere else.
  expect(Object.keys(fenceOverlay(fence, "/usr/bin")).sort()).toEqual([
    "GH_CONFIG_DIR",
    "GIT_ASKPASS",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_SYSTEM",
    "GIT_TERMINAL_PROMPT",
    "PATH",
    "SSH_ASKPASS",
  ]);
});

test("B-3: no fence directory means the plain scrub, which is 121 D-5's in-place mode", () => {
  const scrubbed = scrubEnv({ PATH: "/usr/bin", GH_TOKEN: "secret" });
  expect(applyFence(scrubbed, null)).toEqual(scrubbed);
  expect(applyFence(scrubbed, null).GH_TOKEN).toBeUndefined();
});

// --- B-4: the deny list (FR-002) --------------------------------------------

test("B-4: the deny list is six names and drops the ssh agent as well as the tokens", () => {
  expect(CHILD_ENV_DENY.length).toBe(6);
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "SSH_AUTH_SOCK", "SSH_AGENT_PID"]) {
    expect(CHILD_ENV_DENY).toContain(name);
  }
  const scrubbed = scrubEnv({ SSH_AUTH_SOCK: "/tmp/agent.sock", SSH_AGENT_PID: "42", PATH: "/usr/bin" });
  expect(scrubbed.SSH_AUTH_SOCK).toBeUndefined();
  expect(scrubbed.SSH_AGENT_PID).toBeUndefined();
});

// --- B-5: proven from inside ------------------------------------------------

test("B-5: gh is fenced; `gh auth token` refuses on stderr and names the broker", () => {
  const fence = freshFence();
  const repo = initRepo();
  const ran = inFence(fence, repo, ["gh", "auth", "token"]);

  expect(ran.exitCode).toBe(FENCE_REFUSAL_EXIT);
  expect(ran.stderr).toContain("broker");
  expect(ran.stderr).toContain("spec 122");
  // The token must not reach stdout by any path.
  expect(ran.stdout.trim()).toBe("");
  expect(ran.stdout).not.toContain("gho_");
});

test("B-5: `gh api user` refuses too, so it is the binary that is fenced and not one subcommand", () => {
  const fence = freshFence();
  const repo = initRepo();
  const ran = inFence(fence, repo, ["gh", "api", "user"]);
  expect(ran.exitCode).toBe(FENCE_REFUSAL_EXIT);
  expect(ran.stdout.trim()).toBe("");
});

test("B-5: git resolves no credential, because the inherited helper chain is reset", () => {
  const fence = freshFence();
  const repo = initRepo();
  const env = applyFence(scrubEnv(process.env), fence);
  const proc = Bun.spawnSync(["git", "credential", "fill"], {
    cwd: repo,
    env,
    stdin: new TextEncoder().encode("protocol=https\nhost=github.com\n\n"),
  });
  const stdout = new TextDecoder().decode(proc.stdout);
  expect(stdout).not.toContain("password=");
  expect(stdout).not.toContain("gho_");
});

test("B-5: a push over an ssh remote fails at the fenced ssh", () => {
  const fence = freshFence();
  const repo = initRepo();
  const ran = inFence(fence, repo, ["git", "ls-remote", "git@github.com:statecrafting/statecraft-cli.git"]);
  expect(ran.exitCode).not.toBe(0);
  // The refusal came from our shim, not from a network timeout.
  expect(readFenceRefusals(fence)).toBeGreaterThan(0);
});

test("B-5: the fence closes credentials, not git; a push to a local bare remote still succeeds", () => {
  const fence = freshFence();
  const repo = initRepo();
  const bare = mkdtempSync(join(tmpdir(), "fence-bare-"));
  git(bare, ["init", "-q", "--bare", "-b", "main"]);

  const ran = inFence(fence, repo, ["git", "push", `file://${bare}`, "main:main"]);
  expect(ran.exitCode).toBe(0);
  expect(git(bare, ["rev-parse", "main"])).toBe(git(repo, ["rev-parse", "main"]));
});

// --- B-2 and B-7: construction and the tally (FR-004) -----------------------

test("B-2: the shims are executable and rewritten on every build, so a tampered fence does not survive", () => {
  const fence = freshFence();
  const shim = join(fenceBinDir(fence), "gh");
  expect(existsSync(shim)).toBe(true);
  expect(statSync(shim).mode & 0o111).not.toBe(0);

  // A session that rewrites the shim to hand itself a token gets it back.
  writeFileSync(shim, "#!/bin/sh\necho gho_stolen\nexit 0\n", { mode: 0o755 });
  expect(readFileSync(shim, "utf8")).toContain("gho_stolen");

  buildFence(fence);
  expect(readFileSync(shim, "utf8")).not.toContain("gho_stolen");
  expect(statSync(shim).mode & 0o111).not.toBe(0);
  const ran = inFence(fence, initRepo(), ["gh", "auth", "token"]);
  expect(ran.exitCode).toBe(FENCE_REFUSAL_EXIT);
});

test("B-7: each refusal is tallied, and a rebuild starts the round's count fresh", () => {
  const fence = freshFence();
  const repo = initRepo();
  expect(readFenceRefusals(fence)).toBe(0);

  inFence(fence, repo, ["gh", "auth", "token"]);
  inFence(fence, repo, ["gh", "api", "user"]);
  expect(readFenceRefusals(fence)).toBe(2);
  expect(readFileSync(fenceRefusalLog(fence), "utf8")).toContain("gh");

  buildFence(fence);
  expect(readFenceRefusals(fence)).toBe(0);
});

test("B-7: a missing fence is zero refusals, never an error", () => {
  expect(readFenceRefusals(null)).toBe(0);
  expect(readFenceRefusals(join(tmpdir(), "fence-that-does-not-exist"))).toBe(0);
});

// --- B-2: the candidate builds it (FR-004) ----------------------------------

test("B-2: openCandidate builds the fence beside the worktree, never inside it", () => {
  const repo = initRepo();
  const home = mkdtempSync(join(tmpdir(), "fence-candhome-"));
  const base = git(repo, ["rev-parse", "main"]);

  const opened = openCandidate({ repoDir: repo, homeDir: home, project: "p", branch: "900-spec", baseSha: base });
  expect(opened.fenceDir).toBe(fencePath(home, "p", "900-spec"));
  expect(existsSync(join(opened.fenceDir, "bin", "gh"))).toBe(true);
  expect(existsSync(join(opened.fenceDir, "gitconfig"))).toBe(true);

  // Never inside the candidate: 121 B-4 requires that tree clean.
  expect(opened.fenceDir.startsWith(opened.path)).toBe(false);
  expect(git(opened.path, ["status", "--porcelain"])).toBe("");

  // Reopening rebuilds the fence rather than trusting what is there.
  writeFileSync(join(opened.fenceDir, "bin", "gh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const again = openCandidate({ repoDir: repo, homeDir: home, project: "p", branch: "900-spec", baseSha: base });
  expect(again.reused).toBe(true);
  expect(readFileSync(join(again.fenceDir, "bin", "gh"), "utf8")).toContain("Spec 125");
});

// --- B-6: the broker is not fenced (FR-005) ---------------------------------

// The fence is a property of the child's environment, not of the process tree
// or the machine. The broker runs in the daemon's own environment (122 B-7),
// so a fence standing beside a session must not reach it. This is the case
// FR-005 names; it is asserted here rather than in 122's suite because what
// is under test is the fence's blast radius, not the broker's logic.
test("B-6: a fence beside a session does not reach a process the daemon spawns itself", () => {
  const fence = freshFence();
  const repo = initRepo();
  const bare = mkdtempSync(join(tmpdir(), "fence-broker-bare-"));
  git(bare, ["init", "-q", "--bare", "-b", "main"]);

  // The session's view: `gh` refuses.
  expect(inFence(fence, repo, ["gh", "auth", "token"]).exitCode).toBe(FENCE_REFUSAL_EXIT);

  // The broker's view, spawned with the daemon's environment and no overlay:
  // git resolves normally and the push lands.
  const brokerPush = Bun.spawnSync(["git", "push", `file://${bare}`, "main:main"], { cwd: repo });
  expect(brokerPush.exitCode).toBe(0);
  expect(git(bare, ["rev-parse", "main"])).toBe(git(repo, ["rev-parse", "main"]));

  // And the daemon's PATH still finds the real `gh`, whatever it answers:
  // the fence never edited anything outside its own directory.
  const realGh = Bun.spawnSync(["sh", "-c", "command -v gh"], {});
  if (realGh.exitCode === 0) {
    const resolved = new TextDecoder().decode(realGh.stdout).trim();
    expect(resolved.startsWith(fenceBinDir(fence))).toBe(false);
  }
});

// --- 129 B-3: the supervisor's count ----------------------------------------

// The count 129 moved out of the fenced process's reach. Every case spawns a
// real shim through the fenced environment and reads the supervisor's tally.

function fenceWithChannel(): { fence: string; channel: ReturnType<typeof openFenceChannel> } {
  const channel = openFenceChannel();
  const fence = buildFence(fencePath(mkdtempSync(join(tmpdir(), "fence-home-")), "p", "900-spec"), { channel });
  return { fence, channel };
}

test("129 B-3: a refusal is counted by the supervisor before the shim exits, and no later act of the child withdraws it", () => {
  const { fence, channel } = fenceWithChannel();
  const repo = initRepo();
  const erase = [
    "gh pr create --fill || true",
    `: > ${JSON.stringify(fenceRefusalLog(fence))}`,
    `rm -f ${JSON.stringify(fenceRefusalLog(fence))}`,
    // Rewriting the shim is an escape (125 §6): it loses the next report, never
    // the one already made.
    `printf '#!/bin/sh\\nexit 0\\n' > ${JSON.stringify(join(fenceBinDir(fence), "gh"))}`,
    "gh pr create --fill",
  ].join("; ");
  const ran = inFence(fence, repo, ["sh", "-c", erase]);
  expect(ran.exitCode).toBe(0);
  expect(readFenceRefusals(fence)).toBe(0);
  expect(channel.tally()).toEqual({ refusals: 1, byTool: { gh: 1, ssh: 0 } });
  channel.close();
});

test("129 B-3: ssh is counted as ssh, the shim still names the broker, and a rebuild starts the round's count fresh", () => {
  const { fence, channel } = fenceWithChannel();
  const repo = initRepo();
  const ran = inFence(fence, repo, ["git", "ls-remote", "git@github.com:statecrafting/statecraft-cli.git"]);
  expect(ran.exitCode).not.toBe(0);
  expect(channel.tally().byTool.ssh).toBeGreaterThan(0);
  expect(inFence(fence, repo, ["gh", "api", "user"]).stderr).toContain("broker");
  expect(channel.tally().byTool.gh).toBe(1);

  buildFence(fence, { channel });
  expect(channel.tally()).toEqual({ refusals: 0, byTool: { gh: 0, ssh: 0 } });
  channel.close();
});

test("129 B-3: a report to another fence's slot, with the wrong secret, or to a closed slot counts nothing, and the shim still refuses promptly", () => {
  const first = fenceWithChannel();
  const second = fenceWithChannel();
  const repo = initRepo();
  const forged = `exec 9<>/dev/tcp/127.0.0.1/${second.channel.address.port} && printf 'refused ${second.channel.address.slot} ${"0".repeat(31)}1 gh\\n' >&9 && read -r -t 2 ack <&9; echo "ack=\${ack-}"`;
  const lie = Bun.spawnSync(["/bin/bash", "-c", forged]);
  expect(new TextDecoder().decode(lie.stdout).trim()).toBe("ack=");
  expect(second.channel.tally().refusals).toBe(0);

  inFence(first.fence, repo, ["gh", "auth", "token"]);
  expect(first.channel.tally().refusals).toBe(1);
  expect(second.channel.tally().refusals).toBe(0);

  first.channel.close();
  const started = Date.now();
  const late = inFence(first.fence, repo, ["gh", "auth", "token"]);
  expect(late.exitCode).toBe(FENCE_REFUSAL_EXIT);
  // Unanswered, the shim waits out its acknowledgement bound and refuses.
  expect(Date.now() - started).toBeLessThan(10_000);
  second.channel.close();
});

test("129 B-3: without a channel the shim is 125's byte for byte; with one it reports under bash", () => {
  const fence = freshFence();
  expect(shimSource(fence, "gh")).toBe(readFileSync(join(fenceBinDir(fence), "gh"), "utf8"));
  expect(shimSource(fence, "gh").startsWith("#!/bin/sh\n")).toBe(true);
  expect(shimSource(fence, "gh")).not.toContain("/dev/tcp");
  const withChannel = shimSource(fence, "gh", { port: 4242, slot: 7, secret: "ab".repeat(16) });
  expect(withChannel.startsWith("#!/bin/bash\n")).toBe(true);
  expect(withChannel).toContain("/dev/tcp/127.0.0.1/4242");
  expect(withChannel).toContain(`printf 'refused %s %s %s\\n' 7 ${"ab".repeat(16)} gh`);
});

test("129 D-12: the fence's git config carries the operator's identity when there is one, and nothing else of the operator's", () => {
  const fence = freshFence();
  expect(gitConfigSource(fence)).not.toContain("[user]");
  const withIdentity = gitConfigSource(fence, { name: "Operator Name", email: "operator@example.com" });
  expect(withIdentity).toContain('[user]\n\tname = "Operator Name"\n\temail = "operator@example.com"');
  expect(withIdentity).toContain("\thelper =");

  // A commit inside the fence is made under that identity, not a guessed one.
  const repo = mkdtempSync(join(tmpdir(), "fence-identity-"));
  git(repo, ["init", "-q", "-b", "main"]);
  const identified = buildFence(fence, { identity: { name: "Operator Name", email: "operator@example.com" } });
  writeFileSync(join(repo, "a.txt"), "a\n");
  expect(inFence(identified, repo, ["git", "add", "-A"]).exitCode).toBe(0);
  expect(inFence(identified, repo, ["git", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "one"]).exitCode).toBe(0);
  expect(git(repo, ["log", "-1", "--format=%an <%ae>"])).toBe("Operator Name <operator@example.com>");
});
