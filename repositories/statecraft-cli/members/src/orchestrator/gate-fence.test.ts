// Spec 129: the gate fence, proven from inside.
//
// 125's fence.test.ts proved the fence from a session's point of view; this
// suite proves it from every other place the engine runs code a repository
// controls. Each case spawns real processes through the production seams (the
// build runner, the verify runner, the broker's push) with fabricated tokens in
// the daemon's environment, and reads what the child saw and what the
// supervisor counted, rather than asserting over an object the engine built.
// No case touches a real remote: the remotes are bare repositories on disk,
// and the ssh reach is refused before any network is attempted.

import { test, expect } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CHILD_ENV_DENY, fencedEnv } from "./candidate";
import { fenceBinDir, fencePath, readFenceRefusals } from "./fence";
import { openJournal, type JournalHandle } from "./journal";
import { openDecisionsChain } from "./decisions";
import { createRun, transition } from "./state";
import { mintReceipt, receiptPayload, RECEIPT_KIND } from "./receipt";
import { ACTION_KIND, createBroker, createProcessGitPush } from "./broker";
import type { GateContract } from "./gate-contract";
import type { SessionResult } from "./session";
import type { GitHubClient } from "./stages/ship";
import {
  createProcessRunner,
  evaluateCompletion,
  FENCE_REFUSED_KIND,
  GATE_FENCE_REFUSED,
  runBuildStage,
  type Runner,
} from "./stages/build";
import {
  ACCEPTANCE_BASE_KIND,
  ACCEPTANCE_CHANGED_KIND,
  createProcessVerifyRunner,
  runVerifyStage,
  type BrowserAssertContext,
  type BrowserVerifier,
} from "./stages/verify";
import {
  DEFAULT_VERIFY_ALLOWANCE,
  openProjectsChain,
  projectsFromChain,
  registerProject,
  setProjectVerifyAllowance,
} from "./projects";

const SPEC = "900-fixture-spec";
const SPEC_PATH = `specs/${SPEC}/spec.md`;

// --- the daemon's environment, with credentials in it ------------------------

// One fabricated value per deny-list name. The whole point of the suite is
// that none of these reaches a fenced child, so each is distinctive enough to
// grep for in anything a child printed.
const FABRICATED: Readonly<Record<string, string>> = {
  ANTHROPIC_API_KEY: "sk-ant-fabricated-129",
  OPENAI_API_KEY: "sk-fabricated-129",
  GH_TOKEN: "gho_fabricated129",
  GITHUB_TOKEN: "ghp_fabricated129",
  SSH_AUTH_SOCK: "/tmp/fabricated-agent-129.sock",
  SSH_AGENT_PID: "129129",
};

async function withFabricatedCredentials<T>(fn: () => T | Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(FABRICATED)) {
    saved[name] = process.env[name];
    process.env[name] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

// --- fixtures ----------------------------------------------------------------

function run(cwd: string, cmd: string[], env?: Record<string, string>): string {
  const result = Bun.spawnSync(cmd, env === undefined ? { cwd } : { cwd, env });
  if (result.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} failed (exit ${result.exitCode}): ${new TextDecoder().decode(result.stderr)}`);
  }
  return new TextDecoder().decode(result.stdout).trim();
}

const git = (cwd: string, args: string[]): string => run(cwd, ["git", ...args]);

function specSource(implementation: string): string {
  return `---
id: "${SPEC}"
title: "Fixture spec"
status: approved
created: "2026-09-13"
implementation: ${implementation}
depends_on:
  - "000-bootstrap"
establishes:
  - "src/example.ts"
summary: >
  A fixture the gate fence is proven over.
---

# 900: Fixture

A fixture.
`;
}

interface Governed {
  readonly dir: string;
  readonly remote: string;
  readonly baseSha: string;
}

// A governed repository in this repository's shape: a spec-spine corpus with
// committed shards, a package manifest, one approved spec that establishes one
// file, and an origin that is a bare repository on disk. The real spec-spine
// floor passes over it, so a gate over it is the gate a live round runs.
function governedFixture(options: { preCommitMarker?: string } = {}): Governed {
  const dir = mkdtempSync(join(tmpdir(), "gate-fence-repo-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "fixture@example.com"]);
  git(dir, ["config", "user.name", "Fixture"]);
  run(dir, ["spec-spine", "init"]);
  const toml = join(dir, "spec-spine.toml");
  // The fixture claims a source file; folding src/ into the hashed inputs is
  // what keeps L-008 quiet, as this repository's own configuration does. The
  // scaffold's default list is extended rather than matched, so a newer
  // spec-spine with a different default still yields a governed fixture.
  const scaffolded = readFileSync(toml, "utf8");
  const hashed = /^extra_hashed_inputs = \[(.*)\]$/m;
  if (!hashed.test(scaffolded)) throw new Error("gate-fence fixture: spec-spine init wrote no extra_hashed_inputs line");
  writeFileSync(
    toml,
    scaffolded.replace(hashed, (_line, list: string) => `extra_hashed_inputs = [${list.trim() === "" ? "" : `${list}, `}"src/**/*"]`)
  );
  writeFileSync(join(dir, "package.json"), '{"name":"fixture","private":true}\n');
  mkdirSync(join(dir, "specs", SPEC), { recursive: true });
  writeFileSync(join(dir, SPEC_PATH), specSource("pending"));
  if (options.preCommitMarker !== undefined) {
    // husky's shape: a tracked hooks directory the repository points git at.
    mkdirSync(join(dir, ".githooks"), { recursive: true });
    const hook = join(dir, ".githooks", "pre-commit");
    writeFileSync(
      hook,
      `#!/bin/sh\n{ printf 'PATH=%s\\n' "$PATH"; printf 'GH_TOKEN=%s\\n' "\${GH_TOKEN-}"; } >> ${JSON.stringify(options.preCommitMarker)}\n`
    );
    chmodSync(hook, 0o755);
  }
  run(dir, ["spec-spine", "compile"]);
  run(dir, ["spec-spine", "index"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "chore: governed fixture"]);
  if (options.preCommitMarker !== undefined) git(dir, ["config", "core.hooksPath", ".githooks"]);
  const remote = mkdtempSync(join(tmpdir(), "gate-fence-remote-"));
  git(remote, ["init", "-q", "--bare", "-b", "main"]);
  git(dir, ["remote", "add", "origin", remote]);
  git(dir, ["push", "-q", "origin", "main"]);
  return { dir, remote, baseSha: git(dir, ["rev-parse", "HEAD"]) };
}

// What a session does to finish the fixture spec: the established file, the
// frontmatter flipped complete, the shards regenerated, one commit. Hooks are
// skipped here because this is the test standing in for a session, and a hook
// recording its environment must record only the engine's own commit.
function completeTheSpec(dir: string, from: string): void {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "example.ts"), "export const example = 1;\n");
  writeFileSync(join(dir, SPEC_PATH), readFileSync(join(dir, SPEC_PATH), "utf8").replace(`implementation: ${from}`, "implementation: complete"));
  run(dir, ["spec-spine", "compile"]);
  run(dir, ["spec-spine", "index"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--no-verify", "-m", "feat(900): the fixture"]);
}

function sessionResult(sessionId: string): SessionResult {
  return {
    classification: { kind: "completed", resetAtMs: null, detail: "fake" },
    exitCode: 0,
    durationMs: 1,
    numTurns: 1,
    costMicroUsd: 0,
    usage: null,
    sessionId,
    transcriptPath: null,
    overflow: { lines: [], truncatedCount: 0 },
    stderrTail: "",
    denials: 0,
    denialSamples: [],
  };
}

function contract(...commands: string[][]): GateContract {
  return { commands, source: "cli", rule: null };
}

interface Stage {
  readonly home: string;
  readonly runner: Runner;
  readonly journal: JournalHandle;
  readonly close: () => void;
  readonly stage: (gate: GateContract, session: Runner["runSession"]) => ReturnType<typeof runBuildStage>;
}

function buildWorld(world: Governed): Stage {
  const home = mkdtempSync(join(tmpdir(), "gate-fence-home-"));
  const runner = createProcessRunner({ repoDir: world.dir, candidateHome: home, project: "fixture" });
  const journalDir = mkdtempSync(join(tmpdir(), "gate-fence-journal-"));
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);
  return {
    home,
    runner,
    journal,
    close: () => {
      journal.close();
      decisionsChain.close();
    },
    stage: (gate, session) =>
      runBuildStage({
        runner: { ...runner, runSession: session },
        specId: SPEC,
        journal,
        decisionsChain,
        dropboxDir: join(journalDir, "decision-dropbox"),
        knownSpecIds: new Set([SPEC, "000-bootstrap"]),
        isSpecReady: () => true,
        gate,
      }),
  };
}

const DENY_PATTERN = `^(${CHILD_ENV_DENY.join("|")})=`;

// --- FR-001: the gate receives the session's environment ---------------------

test("FR-001: a gate command in a real fenced candidate sees no deny-list name and the fence's PATH, GH_CONFIG_DIR and GIT_CONFIG_GLOBAL", async () => {
  await withFabricatedCredentials(async () => {
    const world = buildWorld(governedFixture());
    try {
      const printEnv = ["sh", "-c", `env | grep -E '^(PATH|GH_CONFIG_DIR|GIT_CONFIG_GLOBAL)=|${DENY_PATTERN}'`];
      const result = await world.stage(contract(printEnv), async () => {
        completeTheSpec(world.runner.workDir(), "in-progress");
        return sessionResult("fr-001");
      });

      const fence = fencePath(world.home, "fixture", SPEC);
      const seen = result.evidence.gates.find((g) => g.cmd.join(" ") === printEnv.join(" "))!;
      expect(seen.exitCode).toBe(0);
      const lines = seen.stdoutTail.split("\n");
      for (const name of CHILD_ENV_DENY) expect(lines.some((l) => l.startsWith(`${name}=`))).toBe(false);
      for (const value of Object.values(FABRICATED)) expect(seen.stdoutTail).not.toContain(value);
      expect(lines.find((l) => l.startsWith("PATH="))!.startsWith(`PATH=${fenceBinDir(fence)}:`)).toBe(true);
      expect(lines).toContain(`GH_CONFIG_DIR=${join(fence, "gh")}`);
      expect(lines).toContain(`GIT_CONFIG_GLOBAL=${join(fence, "gitconfig")}`);
      expect(seen.fence).toEqual({ applied: true, refusals: 0 });
      expect(result.outcome).toBe("passed");
    } finally {
      world.close();
    }
  });
});

// --- FR-002, B-3: a refusal in the gate is the gate's, not the session's ------

test("FR-002 / B-3: a gate command running gh exits 127, the suite is red, and the refusal is counted on the gate and not on the session", async () => {
  await withFabricatedCredentials(async () => {
    const world = buildWorld(governedFixture());
    try {
      // Green at the base (no file yet), so the preflight passes; after the
      // session the command reaches for gh, as a test the session wrote would.
      const reach = ["sh", "-c", "if [ -f src/example.ts ]; then gh pr create --fill; fi"];
      let calls = 0;
      const result = await world.stage(contract(reach), async () => {
        calls++;
        const dir = world.runner.workDir();
        if (calls === 1) {
          // The session reaches for gh once itself, through the fence it was
          // given, which is what a provider's shell tool does.
          const own = Bun.spawnSync(["gh", "auth", "token"], { cwd: dir, env: fencedEnv(fencePath(world.home, "fixture", SPEC)) });
          expect(own.exitCode).toBe(127);
          completeTheSpec(dir, "in-progress");
        }
        return sessionResult(`fr-002-${calls}`);
      });

      expect(result.outcome).toBe("failed");
      const gate = result.evidence.gates.find((g) => g.cmd.join(" ") === reach.join(" "))!;
      expect(gate.exitCode).toBe(127);
      expect(gate.stderrTail).toContain("broker");
      expect(gate.fence).toEqual({ applied: true, refusals: 1 });
      expect(result.evidence.gateFence).toEqual({ applied: true, refusals: 1 });
      expect(result.evidence.fenceRefusal).toEqual({ reason: GATE_FENCE_REFUSED, refusals: 1, tools: ["gh"] });
      // Round 1's session reached once; the remediation session did not; the
      // gate's refusals in both rounds are in neither count.
      expect(result.evidence.sessions.map((s) => s.fenceRefusals)).toEqual([1, 0]);
      const refused = world.journal.fold().byKind["fence.refused"] ?? [];
      expect(refused.map((r) => (r.payload as { refusals: number }).refusals)).toEqual([1]);
      expect(world.journal.fold().byKind[RECEIPT_KIND]).toBeUndefined();
    } finally {
      world.close();
    }
  });
});

// --- FR-003: the fence closes credentials, not git ---------------------------

test("FR-003: a gate command pushing to an ssh remote fails at the fenced ssh; the same push to a file:// remote succeeds", async () => {
  await withFabricatedCredentials(() => {
    const world = governedFixture();
    const home = mkdtempSync(join(tmpdir(), "gate-fence-home-"));
    const runner = createProcessRunner({ repoDir: world.dir, candidateHome: home, project: "fixture" });
    runner.openCandidate(SPEC, world.baseSha);

    const ssh = runner.runGate(["git", "push", "git@github.com:statecrafting/statecraft-cli.git", "HEAD:refs/heads/fence-probe"]);
    expect(ssh.exitCode).not.toBe(0);
    expect(runner.fenceTally!().byTool.ssh).toBeGreaterThan(0);

    const bare = mkdtempSync(join(tmpdir(), "gate-fence-bare-"));
    git(bare, ["init", "-q", "--bare", "-b", "main"]);
    const local = runner.runGate(["git", "push", `file://${bare}`, "HEAD:refs/heads/main"]);
    expect(local.exitCode).toBe(0);
    expect(git(bare, ["rev-parse", "main"])).toBe(git(runner.workDir(), ["rev-parse", "HEAD"]));
    runner.closeCandidate(SPEC);
  });
});

// --- FR-004, FR-006: a clean fenced gate mints a receipt, and the broker still publishes

test("FR-004 / FR-006: a clean gate over the governance floor passes under the fence and mints a receipt, and the broker pushes that head with it", async () => {
  await withFabricatedCredentials(async () => {
    const governed = governedFixture();
    const world = buildWorld(governed);
    try {
      const live = createRun(world.journal, governed.dir);
      transition(world.journal, live, "running");
      const result = await world.stage(contract(["sh", "-c", "test -f package.json"]), async () => {
        completeTheSpec(world.runner.workDir(), "in-progress");
        return sessionResult("fr-004");
      });

      expect(result.outcome).toBe("passed");
      expect(result.evidence.receipt).not.toBeNull();
      expect(result.evidence.gateFence).toEqual({ applied: true, refusals: 0 });
      expect(result.evidence.fenceRefusal).toBeNull();
      expect(result.evidence.gates.map((g) => g.cmd[0] === "spec-spine" ? g.cmd.slice(0, 2).join(" ") : g.cmd.join(" "))).toEqual([
        "spec-spine check",
        "spec-spine lint",
        "spec-spine couple",
        "sh -c test -f package.json",
      ]);
      for (const g of result.evidence.gates) {
        expect(g.exitCode).toBe(0);
        expect(g.fence).toEqual({ applied: true, refusals: 0 });
      }
      const gateRecord = world.journal.fold().byKind["stage.build.gate"]!.at(-1)!.payload as Record<string, unknown>;
      expect(gateRecord.fence).toEqual({ applied: true, refusals: 0 });
      expect(gateRecord.reason).toBeNull();

      // FR-006: the positive control, in the world whose gate was fenced.
      const receipts = world.journal.fold().byKind[RECEIPT_KIND]!;
      const head = git(world.runner.workDir(), ["rev-parse", "HEAD"]);
      const gh = { prForBranch: () => null } as unknown as GitHubClient;
      const broker = createBroker({ journal: world.journal, gh, git: createProcessGitPush(() => world.runner.workDir()) });
      const pushed = broker.push({ runId: live.id, specId: SPEC, branch: SPEC, headSha: head, receiptHash: receipts.at(-1)!.recordHash });
      expect(pushed.status).toBe("done");
      expect(git(governed.remote, ["rev-parse", SPEC])).toBe(head);
    } finally {
      world.close();
    }
  });
});

// --- FR-005: in place, the scrub --------------------------------------------

test("FR-005: in place (no candidate home) the gate receives the scrub, with no fence and an explicit zero", async () => {
  await withFabricatedCredentials(() => {
    const governed = governedFixture();
    const runner = createProcessRunner({ repoDir: governed.dir });
    const printed = runner.runGate(["sh", "-c", "env"]);
    for (const name of CHILD_ENV_DENY) expect(printed.stdoutTail.split("\n").some((l) => l.startsWith(`${name}=`))).toBe(false);
    expect(printed.stdoutTail).toContain("NO_COLOR=1");
    expect(printed.stdoutTail).not.toContain(`${join("fences", "fixture")}`);
    expect(runner.fenceTally!().applied).toBe(false);

    const journal = openJournal(mkdtempSync(join(tmpdir(), "gate-fence-journal-")));
    try {
      const completion = evaluateCompletion({
        runner,
        specId: SPEC,
        specPath: SPEC_PATH,
        gate: contract(["true"]),
        baseSha: governed.baseSha,
        branch: "main",
        round: 1,
        journal,
        profile: undefined,
      });
      expect(completion.fence).toEqual({ applied: false, refusals: 0 });
      expect(completion.gates.every((g) => g.fence.applied === false && g.fence.refusals === 0)).toBe(true);
      expect(completion.fenceRefusal).toBeNull();
    } finally {
      journal.close();
    }
  });
});

// --- FR-007, FR-008: the swallowed refusal and the erased log -----------------

interface Finished {
  readonly governed: Governed;
  readonly runner: Runner;
  readonly journal: JournalHandle;
  readonly fence: string;
}

// A candidate as a session leaves it: the spec complete and committed, the
// tree clean, so the gate is the only thing left to judge.
function finishedCandidate(): Finished {
  const governed = governedFixture();
  const home = mkdtempSync(join(tmpdir(), "gate-fence-home-"));
  const runner = createProcessRunner({ repoDir: governed.dir, candidateHome: home, project: "fixture" });
  runner.openCandidate(SPEC, governed.baseSha);
  completeTheSpec(runner.workDir(), "pending");
  const journal = openJournal(mkdtempSync(join(tmpdir(), "gate-fence-journal-")));
  return { governed, runner, journal, fence: fencePath(home, "fixture", SPEC) };
}

function judge(world: Finished, gate: GateContract, round = 1): ReturnType<typeof evaluateCompletion> {
  return evaluateCompletion({
    runner: world.runner,
    specId: SPEC,
    specPath: SPEC_PATH,
    gate,
    baseSha: world.governed.baseSha,
    branch: SPEC,
    round,
    journal: world.journal,
    profile: undefined,
  });
}

test("FR-007: `gh pr create --fill || true` exits 0 and every exit code is 0, yet the refusal is counted and the round is not accepted", async () => {
  await withFabricatedCredentials(() => {
    const world = finishedCandidate();
    try {
      const completion = judge(world, contract(["sh", "-c", "gh pr create --fill || true"]));
      expect(completion.gates.map((g) => g.exitCode)).toEqual([0, 0, 0, 0]);
      expect(completion.fence).toEqual({ applied: true, refusals: 1 });
      expect(completion.fenceRefusal).toEqual({ reason: GATE_FENCE_REFUSED, refusals: 1, tools: ["gh"] });
      expect(completion.stable).toBe(true);
      expect(completion.frontmatterComplete).toBe(true);
      expect(completion.passing).toBe(false);
      expect(completion.receipt).toBeNull();
      const folded = world.journal.fold().byKind;
      expect(folded[RECEIPT_KIND]).toBeUndefined();
      expect(folded[FENCE_REFUSED_KIND]!.map((r) => r.payload)).toEqual([
        { specId: SPEC, round: 1, reason: GATE_FENCE_REFUSED, refusals: 1, tools: ["gh"] },
      ]);
    } finally {
      world.journal.close();
    }
  });
});

test("FR-008: a command refused and then truncating the refusal log exits 0; the supervisor still counts 1 and the round is not accepted", async () => {
  await withFabricatedCredentials(() => {
    const world = finishedCandidate();
    try {
      const erase = ["sh", "-c", 'gh pr create --fill; : > "$(dirname "$(command -v gh)")/../refusals.log"'];
      const completion = judge(world, contract(erase));
      expect(completion.gates.every((g) => g.exitCode === 0)).toBe(true);
      // The legible copy is gone, which is exactly why no stage reads it.
      expect(readFenceRefusals(world.fence)).toBe(0);
      expect(completion.fence.refusals).toBe(1);
      expect(completion.fenceRefusal?.reason).toBe(GATE_FENCE_REFUSED);
      expect(completion.passing).toBe(false);
      expect(completion.receipt).toBeNull();
    } finally {
      world.journal.close();
    }
  });
});

test("FR-008 / D-8: the residual, pinned: a tool invoked by an absolute path meets no shim and adds nothing to the tally", async () => {
  await withFabricatedCredentials(() => {
    const world = finishedCandidate();
    try {
      const stubDir = mkdtempSync(join(tmpdir(), "gate-fence-stub-"));
      const stub = join(stubDir, "gh");
      writeFileSync(stub, "#!/bin/sh\necho 'gh version 0.0.0 (a stub outside the fence)'\n");
      chmodSync(stub, 0o755);
      const completion = judge(world, contract(["sh", "-c", `${JSON.stringify(stub)} --version`]));
      expect(completion.gates.every((g) => g.exitCode === 0)).toBe(true);
      // Zero proves only that nothing reached for a fenced tool through PATH.
      expect(completion.fence).toEqual({ applied: true, refusals: 0 });
      expect(completion.passing).toBe(true);
      expect(completion.receipt).not.toBeNull();
    } finally {
      world.journal.close();
    }
  });
});

// --- FR-009: the engine's commit runs the hook, without a credential ---------

test("FR-009: with a tracked hooks directory, the engine's bracket commit runs pre-commit, which sees no GH_TOKEN and the fence's PATH", async () => {
  await withFabricatedCredentials(async () => {
    const marker = join(mkdtempSync(join(tmpdir(), "gate-fence-hook-")), "pre-commit-env.txt");
    const governed = governedFixture({ preCommitMarker: marker });
    const world = buildWorld(governed);
    try {
      const result = await world.stage(contract(), async () => {
        completeTheSpec(world.runner.workDir(), "in-progress");
        return sessionResult("fr-009");
      });
      expect(result.outcome).toBe("passed");
      const seen = readFileSync(marker, "utf8").split("\n").filter((l) => l.length > 0);
      // One commit ran the hook: the bracket's. The session's skipped it.
      expect(seen.length).toBe(2);
      // git puts its own exec path in front for a hook; the first entry after
      // it is the fence's, so the hook's `gh` is the shim.
      const path = seen[0]!.slice("PATH=".length).split(":").filter((entry) => !entry.includes("git-core"));
      expect(path[0]).toBe(fenceBinDir(fencePath(world.home, "fixture", SPEC)));
      expect(seen[1]).toBe("GH_TOKEN=");
    } finally {
      world.close();
    }
  });
});

// --- FR-011, B-9, B-10: the verify stage's acceptance, fenced ----------------

function verifyFixture(block: string): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), "gate-fence-verify-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "fixture@example.com"]);
  git(dir, ["config", "user.name", "Fixture"]);
  mkdirSync(join(dir, "specs", SPEC), { recursive: true });
  writeFileSync(join(dir, SPEC_PATH), `${specSource("complete")}\n## Verification\n\n\`\`\`verify:cli\n${block}\n\`\`\`\n`);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "spec"]);
  return { dir, sha: git(dir, ["rev-parse", "HEAD"]) };
}

const neverBrowser: BrowserVerifier = {
  async assert() {
    throw new Error("no browser block in this fixture");
  },
};

async function verifyOnce(block: string, options: { allowance?: () => "fenced" | "inherit"; home?: string } = {}) {
  const fixture = verifyFixture(block);
  const home = options.home ?? mkdtempSync(join(tmpdir(), "gate-fence-verify-home-"));
  const journal = openJournal(mkdtempSync(join(tmpdir(), "gate-fence-verify-journal-")));
  try {
    const result = await runVerifyStage({
      runner: createProcessVerifyRunner({ repoDir: fixture.dir, homeDir: home }),
      browserVerifier: neverBrowser,
      specId: SPEC,
      sha: fixture.sha,
      journal,
      evidenceDir: mkdtempSync(join(tmpdir(), "gate-fence-verify-evidence-")),
      ...(options.allowance === undefined ? {} : { allowance: options.allowance }),
    });
    return { result, records: journal.fold(), home };
  } finally {
    journal.close();
  }
}

test("FR-011: acceptance lines run with no deny-list name present, under a fence built beside the worktree in the daemon home and removed with it", async () => {
  await withFabricatedCredentials(async () => {
    const { result, records, home } = await verifyOnce(`sh -c "env | grep -E '${DENY_PATTERN}'" && exit 1 || exit 0`);
    expect(result.outcome).toBe("passed");
    expect(result.evidence.fence).toEqual({ applied: true, refusals: 0 });
    expect(result.evidence.acceptanceBase).toBe("unrecorded");
    expect(records.byKind[ACCEPTANCE_BASE_KIND]!.map((r) => (r.payload as { base: string }).base)).toEqual(["unrecorded"]);
    // Removed with the worktree: nothing is left under the daemon home.
    expect(existsSync(join(home, "verify")) ? Bun.spawnSync(["ls", join(home, "verify")]).stdout.toString().trim() : "").toBe("");
  });
});

test("FR-011: an acceptance line that runs gh and swallows the exit fails the stage, and so does one that is refused and truncates the log", async () => {
  await withFabricatedCredentials(async () => {
    const swallowed = await verifyOnce("gh pr create --fill || true");
    expect(swallowed.result.outcome).toBe("failed");
    expect(swallowed.result.evidence.cli[0]!.exitCode).toBe(0);
    expect(swallowed.result.evidence.cli[0]!.fenceRefusals).toBe(1);
    expect(swallowed.result.evidence.fence).toEqual({ applied: true, refusals: 1 });
    expect(swallowed.result.evidence.firstFailure?.description).toContain(GATE_FENCE_REFUSED);

    const erased = await verifyOnce('gh pr create --fill; : > "$(dirname "$(command -v gh)")/../refusals.log"');
    expect(erased.result.outcome).toBe("failed");
    expect(erased.result.evidence.cli[0]!.exitCode).toBe(0);
    expect(erased.result.evidence.fence.refusals).toBe(1);
  });
});

test("FR-011 / B-9: under a journaled `inherit` allowance the same stage sees the daemon's environment and records operator-allowed", async () => {
  await withFabricatedCredentials(async () => {
    const chain = openProjectsChain(mkdtempSync(join(tmpdir(), "gate-fence-registry-")));
    try {
      const target = mkdtempSync(join(tmpdir(), "gate-fence-target-"));
      registerProject({ chain, repoDir: target, name: "live", qualification: { qualified: true, checks: [], warnings: [] }, source: "cli" });
      const allowance = () => projectsFromChain(chain.fold()).get("live")!.verify.allowance;

      const fenced = await verifyOnce(`test -z "\${GH_TOKEN-}"`, { allowance });
      expect(fenced.result.outcome).toBe("passed");
      expect(fenced.result.evidence.fence).toEqual({ applied: true, refusals: 0 });

      setProjectVerifyAllowance({ chain, name: "live", allowance: "inherit", source: "cli" });
      const inherited = await verifyOnce(`test "$GH_TOKEN" = "${FABRICATED.GH_TOKEN}"`, { allowance });
      expect(inherited.result.outcome).toBe("passed");
      expect(inherited.result.evidence.fence).toEqual({ applied: false, refusals: 0, reason: "operator-allowed" });
      const resultRecord = inherited.records.byKind["stage.verify.result"]!.at(-1)!.payload as Record<string, unknown>;
      expect(resultRecord.fence).toEqual({ applied: false, refusals: 0, reason: "operator-allowed" });
    } finally {
      chain.close();
    }
  });
});

test("B-9: the allowance is registry state: fenced by default with no record, journaled with its source, and refused for any other value", () => {
  const chain = openProjectsChain(mkdtempSync(join(tmpdir(), "gate-fence-registry-")));
  try {
    const target = mkdtempSync(join(tmpdir(), "gate-fence-target-"));
    registerProject({ chain, repoDir: target, name: "alpha", qualification: { qualified: true, checks: [], warnings: [] }, source: "api" });
    expect(projectsFromChain(chain.fold()).get("alpha")!.verify).toEqual(DEFAULT_VERIFY_ALLOWANCE);

    const set = setProjectVerifyAllowance({ chain, name: "alpha", allowance: "inherit", source: "api" });
    expect(set.record.kind).toBe("project.verify.set");
    expect(set.record.payload).toEqual({ name: "alpha", allowance: "inherit", source: "api" });
    expect(set.project!.verify).toEqual({ allowance: "inherit", source: "api", setAt: set.record.ts });

    expect(() =>
      setProjectVerifyAllowance({ chain, name: "alpha", allowance: "everything" as "inherit", source: "api" })
    ).toThrow(/verify allowance/);
    expect(() => setProjectVerifyAllowance({ chain, name: "nobody", allowance: "fenced", source: "cli" })).toThrow(/no registered project/);
  } finally {
    chain.close();
  }
});

test("B-10: a browser assertion session runs in the verify worktree with the verify fence, and with no fence under `inherit`", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-fence-browser-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "fixture@example.com"]);
  git(dir, ["config", "user.name", "Fixture"]);
  mkdirSync(join(dir, "specs", SPEC), { recursive: true });
  writeFileSync(join(dir, SPEC_PATH), `${specSource("complete")}\n## Verification\n\n\`\`\`verify:browser\nurl: http://127.0.0.1:1/\nThe page says hello\n\`\`\`\n`);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "spec"]);
  const sha = git(dir, ["rev-parse", "HEAD"]);

  for (const allowance of ["fenced", "inherit"] as const) {
    const seen: BrowserAssertContext[] = [];
    const journal = openJournal(mkdtempSync(join(tmpdir(), "gate-fence-browser-journal-")));
    try {
      const result = await runVerifyStage({
        runner: createProcessVerifyRunner({ repoDir: dir, homeDir: mkdtempSync(join(tmpdir(), "gate-fence-browser-home-")) }),
        browserVerifier: {
          async assert(_url, _assertion, context) {
            seen.push(context!);
            expect(existsSync(join(context!.cwd, SPEC_PATH))).toBe(true);
            if (context!.fenceDir !== null) expect(existsSync(join(context!.fenceDir, "bin", "gh"))).toBe(true);
            return { pass: true, detail: "hello" };
          },
        },
        specId: SPEC,
        sha,
        journal,
        evidenceDir: mkdtempSync(join(tmpdir(), "gate-fence-browser-evidence-")),
        allowance,
      });
      expect(result.outcome).toBe("passed");
      expect(seen.length).toBe(1);
      expect(seen[0]!.cwd).not.toBe(dir);
      expect(seen[0]!.cwd.endsWith("worktree")).toBe(true);
      expect(seen[0]!.fenceDir === null).toBe(allowance === "inherit");
    } finally {
      journal.close();
    }
  }
});

// --- FR-012: acceptance is read at the base ----------------------------------

test("FR-012: a merged head whose Verification block differs from the base's runs the base's block and journals acceptance.changed with both digests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-fence-base-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "fixture@example.com"]);
  git(dir, ["config", "user.name", "Fixture"]);
  mkdirSync(join(dir, "specs", SPEC), { recursive: true });
  const withBlock = (block: string) => `${specSource("pending")}\n## Verification\n\n\`\`\`verify:cli\n${block}\n\`\`\`\n`;
  writeFileSync(join(dir, SPEC_PATH), withBlock("test -f required.txt"));
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "base"]);
  const base = git(dir, ["rev-parse", "HEAD"]);
  // The session weakens the acceptance it will be judged by.
  writeFileSync(join(dir, SPEC_PATH), withBlock("true"));
  git(dir, ["commit", "-q", "-am", "merged"]);
  const merged = git(dir, ["rev-parse", "HEAD"]);

  // The journal a pipeline run leaves: the receipt the gate minted over the
  // candidate, and the broker's merge outcome that consumed it.
  const journal = openJournal(mkdtempSync(join(tmpdir(), "gate-fence-base-journal-")));
  try {
    const receipt = mintReceipt({
      specId: SPEC,
      round: 1,
      origin: null,
      baseSha: base,
      candidateSha: merged,
      branch: SPEC,
      suite: [["true"]],
      gate: null,
      profile: { mode: "bypass" },
      specSpineVersion: null,
      results: [{ cmd: ["true"], exitCode: 0 }],
      changedPaths: [SPEC_PATH],
    });
    const receiptRecord = journal.append(RECEIPT_KIND, receiptPayload(receipt));
    journal.append(ACTION_KIND, {
      action: "merge",
      phase: "outcome",
      runId: "run-1",
      specId: SPEC,
      target: "#1",
      headSha: merged,
      receiptHash: receiptRecord.recordHash,
      ok: true,
      detail: merged,
    });

    const judged = await runVerifyStage({
      runner: createProcessVerifyRunner({ repoDir: dir }),
      browserVerifier: neverBrowser,
      specId: SPEC,
      sha: merged,
      journal,
      evidenceDir: mkdtempSync(join(tmpdir(), "gate-fence-base-evidence-")),
    });
    expect(judged.outcome).toBe("failed");
    expect(judged.evidence.acceptanceBase).toBe(base);
    expect(judged.evidence.cli.map((c) => c.command)).toEqual(["test -f required.txt"]);
    const changed = journal.fold().byKind[ACCEPTANCE_CHANGED_KIND]!;
    expect(changed.length).toBe(1);
    const payload = changed[0]!.payload as Record<string, string>;
    expect(payload.baseSha).toBe(base);
    expect(payload.baseDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.headDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.baseDigest).not.toBe(payload.headDigest);
  } finally {
    journal.close();
  }

  // B-8's second paragraph: a re-verify with no recorded run reads the block
  // at the revision it verifies, and says so, never inferring a base.
  const unrecorded = openJournal(mkdtempSync(join(tmpdir(), "gate-fence-base-journal-")));
  try {
    const reverified = await runVerifyStage({
      runner: createProcessVerifyRunner({ repoDir: dir }),
      browserVerifier: neverBrowser,
      specId: SPEC,
      sha: merged,
      journal: unrecorded,
      evidenceDir: mkdtempSync(join(tmpdir(), "gate-fence-base-evidence-")),
      isReVerification: true,
    });
    expect(reverified.outcome).toBe("passed");
    expect(reverified.evidence.acceptanceBase).toBe("unrecorded");
    expect(unrecorded.fold().byKind[ACCEPTANCE_CHANGED_KIND]).toBeUndefined();
  } finally {
    unrecorded.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
