import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openJournal } from "../journal";
import { openDecisionsChain, validateDecisionRecord } from "../decisions";
import type { SessionResult } from "../session";
import {
  runBuildStage,
  createProcessRunner,
  buildPrompt,
  flipImplementation,
  readImplementationStatus,
  parseFrontmatterListField,
  extractBacklogStep,
  BUILD_PROMPT_VERSION,
  FENCE_REFUSED_KIND,
  GATE_COMMANDS,
  GATE_FENCE_REFUSED,
  type Runner,
  type RunnerSessionOptions,
} from "./build";
import { FENCE_MESSAGES } from "../fence";
import { gateSuiteFor, LEGACY_GATE_CONTRACT, type GateContract } from "../gate-contract";
import { latestReceipt, policyDigest, RECEIPT_KIND, suiteDigest } from "../receipt";

// --- fixture repo -----------------------------------------------------------

function git(dir: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd: dir });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
  }
}

function gitIsClean(dir: string): boolean {
  const result = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: dir });
  return new TextDecoder().decode(result.stdout).trim().length === 0;
}

const AGENTS_MD_FIXTURE = `# AGENTS.md

## Working the backlog

1. Pick the next spec.
2. Flip its frontmatter to in-progress.
3. Implement exactly that spec's territory.
4. Run the gate.
5. Flip to complete.

## Conventions

Not part of the backlog step.
`;

function specFixture(specId: string, implementation: string): string {
  return `---
id: "${specId}"
title: "Fixture spec"
status: approved
kind: stage
implementation: ${implementation}
depends_on: []
establishes:
  - "src/example.ts"
---

# ${specId}: Fixture

Fixture spec body for build stage tests.
`;
}

function initFixtureRepo(specId = "900-fixture-spec"): { dir: string; specId: string } {
  const dir = mkdtempSync(join(tmpdir(), "build-stage-test-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);

  mkdirSync(join(dir, "specs", specId), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });

  writeFileSync(join(dir, "AGENTS.md"), AGENTS_MD_FIXTURE);
  writeFileSync(join(dir, "specs", specId, "spec.md"), specFixture(specId, "pending"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture" }));
  // The fixture target shares this repo's Bun + TypeScript conventions, so
  // the full six-command gate applies (D-10's four-command path has its own
  // fixture below).
  writeFileSync(join(dir, "tsconfig.json"), "{}\n");

  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "chore: fixture base"]);

  return { dir, specId };
}

function greenGate(): Runner["runGate"] {
  return () => ({ exitCode: 0, stdoutTail: "", stderrTail: "" });
}

function fakeSessionResult(sessionId: string, overrides: Partial<SessionResult> = {}): SessionResult {
  return {
    classification: { kind: "completed", resetAtMs: null, detail: "fake" },
    exitCode: 0,
    durationMs: 5,
    numTurns: 3,
    costMicroUsd: 1200,
    usage: null,
    sessionId,
    transcriptPath: null,
    overflow: { lines: [], truncatedCount: 0 },
    stderrTail: "",
    denials: 0,
    denialSamples: [],
    ...overrides,
  };
}

// A fake session that stands in for a real `claude` run (per spec 014's own
// "never spawn the real claude in tests" convention): it performs the same
// filesystem/git actions a real session would (write the fixture's one
// established file, flip the spec's frontmatter to complete, commit), then
// returns a completed SessionResult.
function fakeWritingSession(dir: string, specId: string): Runner["runSession"] {
  let calls = 0;
  return async (_options: RunnerSessionOptions) => {
    calls++;
    writeFileSync(join(dir, "src", "example.ts"), "export const example = 1;\n");
    const specPath = join(dir, "specs", specId, "spec.md");
    const content = readFileSync(specPath, "utf8");
    writeFileSync(specPath, content.replace("implementation: in-progress", "implementation: complete"));
    git(dir, ["add", "-A"]);
    // A remediation session may find nothing new to write (the fixture's
    // work was already complete after the first session): skip the commit
    // rather than fail on git's own "nothing to commit".
    if (!gitIsClean(dir)) git(dir, ["commit", "-q", "-m", `session commit ${calls}`]);
    return fakeSessionResult(`fake-session-${calls}`);
  };
}

// The journal/decisions chain live in their own temp directory, never
// inside the fixture git repo itself: journal.jsonl, anchor.json, and the
// lock file would otherwise show up as untracked files and trip the B-1
// dirty-tree preflight on every test.
function openHandles(_dir: string): { journalDir: string } {
  const journalDir = mkdtempSync(join(tmpdir(), "build-stage-journal-"));
  return { journalDir };
}

// --- pure helpers ------------------------------------------------------------

test("readImplementationStatus reads the top-level implementation field", () => {
  expect(readImplementationStatus(specFixture("x", "pending"))).toBe("pending");
});

test("flipImplementation rewrites from -> to and reports changed: true", () => {
  const result = flipImplementation(specFixture("x", "pending"), "pending", "in-progress");
  expect(result.changed).toBe(true);
  expect(readImplementationStatus(result.content)).toBe("in-progress");
});

test("flipImplementation is a no-op (changed: false) when already at the target status", () => {
  const content = specFixture("x", "in-progress");
  const result = flipImplementation(content, "pending", "in-progress");
  expect(result.changed).toBe(false);
  expect(result.content).toBe(content);
});

test("flipImplementation throws when the current status is neither from nor to", () => {
  const content = specFixture("x", "deferred");
  expect(() => flipImplementation(content, "pending", "in-progress")).toThrow(/expected "implementation: pending"/);
});

test("parseFrontmatterListField parses depends_on and establishes list items", () => {
  const md = specFixture("x", "pending").replace(
    "depends_on: []",
    'depends_on:\n  - "010-a"\n  - "011-b"'
  );
  expect(parseFrontmatterListField(md, "depends_on")).toEqual(["010-a", "011-b"]);
  expect(parseFrontmatterListField(md, "establishes")).toEqual(["src/example.ts"]);
});

test("parseFrontmatterListField returns an empty array when the field is absent", () => {
  expect(parseFrontmatterListField("no frontmatter here", "depends_on")).toEqual([]);
});

test("extractBacklogStep returns the Working the backlog section verbatim, stopping at the next heading", () => {
  const step = extractBacklogStep(AGENTS_MD_FIXTURE);
  expect(step).toContain("1. Pick the next spec.");
  expect(step).toContain("5. Flip to complete.");
  expect(step).not.toContain("Not part of the backlog step.");
});

test("extractBacklogStep falls back to a built-in summary when AGENTS.md has no such heading", () => {
  const step = extractBacklogStep("# AGENTS.md\n\nsomething else entirely\n");
  expect(step.length).toBeGreaterThan(0);
  expect(step).toContain("Implement exactly this spec's territory");
});

// --- prompt template (B-3) ----------------------------------------------------

test("buildPrompt embeds the spec body, backlog step, gate commands, drop-box path, and the house style rules", () => {
  const prompt = buildPrompt({
    specId: "900-x",
    specBody: "SPEC BODY MARKER",
    backlogStep: "BACKLOG STEP MARKER",
    decisions: { included: [], overflowCount: 0 },
    dropboxDir: "/tmp/dropbox-marker",
  });
  expect(prompt).toContain("SPEC BODY MARKER");
  expect(prompt).toContain("BACKLOG STEP MARKER");
  expect(prompt).toContain("/tmp/dropbox-marker");
  expect(prompt).toContain(`version: ${BUILD_PROMPT_VERSION}`);
  for (const cmd of GATE_COMMANDS) {
    expect(prompt).toContain(cmd.join(" "));
  }
  expect(prompt).toContain("No em dashes");
  expect(prompt).toContain("No AI attribution");
  // The template itself must never contain the character it forbids.
  expect(prompt.indexOf(String.fromCharCode(0x2014))).toBe(-1);
});

test("buildPrompt lists included decisions and states the overflow count, never silently dropping either", () => {
  const prompt = buildPrompt({
    specId: "900-x",
    specBody: "body",
    backlogStep: "step",
    decisions: {
      included: [
        { id: "d-1", specId: "900-x", scope: ["900-x"], title: "Use X", decision: "We use X", rationale: "because" },
      ],
      overflowCount: 2,
    },
    dropboxDir: "/tmp/dropbox",
  });
  expect(prompt).toContain("d-1 (900-x): Use X: We use X");
  expect(prompt).toContain("2 older decision(s) omitted");
});

// --- createProcessRunner (production seam) -----------------------------------

test("createProcessRunner: statusClean/currentBranch/headSha reflect real git state", () => {
  const { dir } = initFixtureRepo();
  const runner = createProcessRunner({ repoDir: dir });
  expect(runner.statusClean()).toBe(true);
  expect(runner.currentBranch()).toBe("main");
  expect(runner.headSha()).toMatch(/^[0-9a-f]{40}$/);
});

test("the build prompt lists the target's own gate program, not the constant (041 B-4, 016 D-10's intent)", () => {
  const prompt = buildPrompt({
    specId: "900-x",
    specBody: "# spec body",
    backlogStep: "1. step",
    decisions: { included: [], overflowCount: 0 },
    dropboxDir: "/tmp/dropbox",
    gateCommands: GATE_COMMANDS,
  });
  expect(prompt).toContain("spec-spine check --fail-on-warn");
  expect(prompt).not.toContain("bun run typecheck");
  expect(prompt).not.toContain("bun test");
});

test("createProcessRunner: readFile/writeFile round-trip relative to repoDir", () => {
  const { dir, specId } = initFixtureRepo();
  const runner = createProcessRunner({ repoDir: dir });
  const path = `specs/${specId}/spec.md`;
  const content = runner.readFile(path);
  expect(content).toContain(`id: "${specId}"`);
  runner.writeFile(path, content.replace("implementation: pending", "implementation: in-progress"));
  expect(runner.readFile(path)).toContain("implementation: in-progress");
});

test("createProcessRunner: createBranch is idempotent, reusing an existing branch on the second call", () => {
  const { dir } = initFixtureRepo();
  const runner = createProcessRunner({ repoDir: dir });
  expect(runner.createBranch("feature-x")).toBe(false);
  runner.checkout("main");
  expect(runner.createBranch("feature-x")).toBe(true);
});

test("createProcessRunner: runGate runs a real subprocess and bounds its tails", () => {
  const { dir } = initFixtureRepo();
  const runner = createProcessRunner({ repoDir: dir });
  const result = runner.runGate(["git", "status", "--porcelain"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdoutTail).toBe("");
});

// --- B-1: preflight refusals --------------------------------------------------

test("B-1: refuses with dirty-tree when the target repo's working tree is not clean", async () => {
  const { dir, specId } = initFixtureRepo();
  writeFileSync(join(dir, "untracked.txt"), "dirty");
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runGate: greenGate() };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("refused");
  expect(result.evidence.refusal?.kind).toBe("dirty-tree");
  expect(result.evidence.branch).toBeNull();

  journal.close();
  decisionsChain.close();
});

test("B-1: refuses with wrong-branch when normalization to the default branch fails", async () => {
  const { dir, specId } = initFixtureRepo();
  git(dir, ["checkout", "-q", "-b", "some-other-branch"]);
  // The default branch named to the stage does not exist in this repo, so
  // the clean-tree normalization (checkout + ff pull) cannot succeed and
  // the honest refusal remains.
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runGate: greenGate(),
    checkout: (branch: string) => {
      throw new Error(`fixture: cannot checkout ${branch}`);
    },
  };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("refused");
  expect(result.evidence.refusal?.kind).toBe("wrong-branch");

  journal.close();
  decisionsChain.close();
});

test("B-1: refuses with gate-red-at-base when a gate command is red before starting", async () => {
  const { dir, specId } = initFixtureRepo();
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runGate: () => ({ exitCode: 1, stdoutTail: "", stderrTail: "boom: lint red at base" }),
  };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("refused");
  expect(result.evidence.refusal?.kind).toBe("gate-red-at-base");
  expect(result.evidence.refusal?.message).toContain("boom: lint red at base");

  journal.close();
  decisionsChain.close();
});

test("119 FR-002: refuses with base-unresolved when the default branch resolves neither at origin nor locally", async () => {
  const { dir, specId } = initFixtureRepo();
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runGate: greenGate(),
    resolveBase: (branch: string) => {
      throw new Error(`base "${branch}" resolves neither at origin nor locally: fixture`);
    },
  };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const refused = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });
  expect(refused.outcome).toBe("refused");
  expect(refused.evidence.refusal?.kind).toBe("base-unresolved");
  expect(refused.evidence.refusal?.message).toContain("resolves neither");
  expect(journal.fold().byKind["stage.build.refused"]![0]!.payload).toMatchObject({ kind: "base-unresolved" });

  journal.close();
  decisionsChain.close();
});

test("119 FR-002 (B-3): a stale committed registry is a gate-red-at-base refusal, never a repair", async () => {
  const { dir, specId } = initFixtureRepo();
  const asked: string[][] = [];
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runGate: (cmd) => {
      asked.push([...cmd]);
      if (cmd[1] === "check") return { exitCode: 2, stdoutTail: "spec-registry: stale\n", stderrTail: "  stale: 001-x.json" };
      return { exitCode: 0, stdoutTail: "", stderrTail: "" };
    },
  };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("refused");
  expect(result.evidence.refusal?.kind).toBe("gate-red-at-base");
  expect(result.evidence.refusal?.message).toContain("spec-spine check --fail-on-warn");
  expect(result.evidence.refusal?.message).toContain("exited 2");
  // Nothing regenerated: the floor asked `check`, and no `compile` or
  // `index` ran before the refusal.
  expect(asked.some((cmd) => cmd.join(" ") === "spec-spine compile" || cmd.join(" ") === "spec-spine index")).toBe(false);

  journal.close();
  decisionsChain.close();
});

test("B-1: refuses with spec-not-ready when the injected readiness predicate says no", async () => {
  const { dir, specId } = initFixtureRepo();
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runGate: greenGate() };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => false,
  });

  expect(result.outcome).toBe("refused");
  expect(result.evidence.refusal?.kind).toBe("spec-not-ready");

  journal.close();
  decisionsChain.close();
});

// --- FR-004: the stage is judged by the owning project's contract -------------

// Records every gate command the stage asks for, in order, so a test can say
// what ran in the preflight and what ran after the session rather than only
// what the evidence summarized.
function recordingGate(log: string[][]): Runner["runGate"] {
  return (cmd) => {
    log.push([...cmd]);
    return { exitCode: 0, stdoutTail: "", stderrTail: "" };
  };
}

const MAKE_CI_CONTRACT: GateContract = { commands: [["make", "ci"]], source: "probe", rule: "make-ci" };

test("FR-004: under a `make ci` contract, `make ci` runs in the preflight and again after the session", async () => {
  const { dir, specId } = initFixtureRepo();
  const asked: string[][] = [];
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runGate: recordingGate(asked),
    runSession: fakeWritingSession(dir, specId),
  };
  // 119 B-2: the floor is judged against the base resolved to a commit, which
  // for a fixture with no remote is the local main (119 D-5).
  const baseSha = runner.headSha();
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
    gate: MAKE_CI_CONTRACT,
  });

  expect(result.outcome).toBe("passed");

  // Two full sweeps, plus the bracket's own compile and index regeneration
  // between them (016 D-8), which are not gate commands.
  const suite = gateSuiteFor(MAKE_CI_CONTRACT, baseSha).map((cmd) => cmd.join(" "));
  const sweeps = asked
    .map((cmd) => cmd.join(" "))
    .filter((cmd) => cmd === "make ci" || cmd.startsWith("spec-spine"));
  expect(sweeps.slice(0, suite.length)).toEqual(suite);
  // The preflight's sweep and the post-session evidence both ran it.
  expect(asked.filter((cmd) => cmd.join(" ") === "make ci").length).toBe(2);
  expect(result.evidence.gates.map((g) => g.cmd.join(" "))).toEqual(suite);

  journal.close();
  decisionsChain.close();
});

test("FR-004: the same fixture under a legacy empty contract runs exactly the spec-spine floor", async () => {
  const { dir, specId } = initFixtureRepo();
  const asked: string[][] = [];
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runGate: recordingGate(asked),
    runSession: fakeWritingSession(dir, specId),
  };
  const baseSha = runner.headSha();
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
    gate: LEGACY_GATE_CONTRACT,
  });

  expect(result.outcome).toBe("passed");
  // The fixture repo does carry a tsconfig.json, and 016 D-10 would have run
  // the Bun pair against it. 041 B-3 does not: what a target is judged by is
  // what its chain says, and a chain that says nothing earns the floor.
  expect(result.evidence.gates.map((g) => g.cmd.join(" "))).toEqual(
    gateSuiteFor(LEGACY_GATE_CONTRACT, baseSha).map((cmd) => cmd.join(" "))
  );
  expect(asked.some((cmd) => cmd[0] === "bun")).toBe(false);
  // 119 B-1: the floor is read-only; regeneration is the bracket's alone.
  const floor = asked.filter((cmd) => cmd[0] === "spec-spine").map((cmd) => cmd.join(" "));
  expect(floor.filter((cmd) => cmd === "spec-spine compile" || cmd === "spec-spine index").length).toBe(2);
  expect(floor.some((cmd) => cmd.startsWith("spec-spine check --fail-on-warn"))).toBe(true);
  // 119 B-2: the gate record names the base it judged against.
  const gateRecords = journal.fold().byKind["stage.build.gate"] ?? [];
  expect(gateRecords.length).toBe(1);
  expect((gateRecords[0]!.payload as { baseSha: string }).baseSha).toBe(baseSha);

  journal.close();
  decisionsChain.close();
});

test("FR-004: a red contract command at the base branch refuses the stage by name", async () => {
  const { dir, specId } = initFixtureRepo();
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runGate: (cmd) =>
      cmd[0] === "make"
        ? { exitCode: 1, stdoutTail: "", stderrTail: "make: *** No rule to make target `ci'" }
        : { exitCode: 0, stdoutTail: "", stderrTail: "" },
    runSession: async () => {
      throw new Error("no session may be driven when the gate is red at the base commit");
    },
  };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
    gate: MAKE_CI_CONTRACT,
  });

  // D-3's safety net: a probe that guessed wrong surfaces as a named refusal
  // with the failing command in it, before anything is driven.
  expect(result.outcome).toBe("refused");
  expect(result.evidence.refusal?.kind).toBe("gate-red-at-base");
  expect(result.evidence.refusal?.message).toContain("make ci");

  journal.close();
  decisionsChain.close();
});

test("FR-004: the build prompt promises the session the project's suite, floor included", () => {
  const prompt = buildPrompt({
    specId: "900-x",
    specBody: "# spec body",
    backlogStep: "1. step",
    decisions: { included: [], overflowCount: 0 },
    dropboxDir: "/tmp/dropbox",
    gateCommands: gateSuiteFor(MAKE_CI_CONTRACT),
  });
  for (const cmd of gateSuiteFor(MAKE_CI_CONTRACT)) expect(prompt).toContain(cmd.join(" "));
  expect(prompt).not.toContain("bun run typecheck");
});

// --- AC-2: full fixture flow --------------------------------------------------

test("AC-2: passed with complete evidence when the session writes the file and flips frontmatter", async () => {
  const { dir, specId } = initFixtureRepo();
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runGate: greenGate(),
    runSession: fakeWritingSession(dir, specId),
  };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);
  const dropboxDir = join(journalDir, "decision-dropbox");

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir,
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("passed");
  expect(result.evidence.branch).toBe(specId);
  expect(result.evidence.headSha).toMatch(/^[0-9a-f]{40}$/);
  expect(result.evidence.promptVersion).toBe(BUILD_PROMPT_VERSION);
  expect(result.evidence.frontmatterComplete).toBe(true);
  expect(result.evidence.sessions.length).toBe(1);
  expect(result.evidence.gates.length).toBe(GATE_COMMANDS.length);
  expect(result.evidence.gates.every((g) => g.exitCode === 0)).toBe(true);
  expect(result.evidence.decisions).not.toBeNull();
  expect(result.evidence.refusal).toBeNull();

  // Reflects the real branch actually created by the production Runner.
  expect(runner.currentBranch()).toBe(specId);

  journal.close();
  decisionsChain.close();
});

test("AC-2: a failing lint after the session triggers one remediation, then fails with the lint tail in evidence", async () => {
  const { dir, specId } = initFixtureRepo();
  const state = { sessionCalls: 0 };
  const prompts: string[] = [];
  const runSession: Runner["runSession"] = async (opts) => {
    state.sessionCalls++;
    prompts.push(opts.prompt);
    return fakeWritingSession(dir, specId)(opts);
  };
  const runGate: Runner["runGate"] = (cmd) => {
    // Green before any session has run (preflight + the B-2 compile check);
    // afterwards, lint alone stays red no matter how many sessions run, so
    // remediation is attempted once and then the stage fails honestly.
    if (state.sessionCalls === 0) return { exitCode: 0, stdoutTail: "", stderrTail: "" };
    if (cmd.join(" ").includes("lint")) {
      return { exitCode: 1, stdoutTail: "", stderrTail: "lint: FR-001 style violation in src/example.ts" };
    }
    return { exitCode: 0, stdoutTail: "", stderrTail: "" };
  };
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runGate, runSession };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);
  const dropboxDir = join(journalDir, "decision-dropbox");

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir,
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("failed");
  expect(result.evidence.sessions.length).toBe(2);
  // 123 B-6: the remediation prompt carries the capsule: the red gate and
  // the project, folded from the journal; the first prompt does not.
  expect(prompts[0]).not.toContain("## Handoff capsule");
  expect(prompts[1]).toContain("## Handoff capsule");
  expect(prompts[1]).toContain("`spec-spine lint --fail-on-warn` exited 1");
  expect(prompts[1]).toContain("FR-001 style violation");
  expect(prompts[1]).toContain(`spec: ${specId}`);
  const lintEvidence = result.evidence.gates.find((g) => g.cmd.join(" ").includes("lint"));
  expect(lintEvidence?.exitCode).toBe(1);
  expect(lintEvidence?.stderrTail).toContain("FR-001 style violation");

  journal.close();
  decisionsChain.close();
});

// --- FR-003: reconcile ---------------------------------------------------------

test("FR-003: a branch that already exists from a crashed attempt is reused, not duplicated", async () => {
  const { dir, specId } = initFixtureRepo();

  // Simulate a crashed prior attempt: the branch already exists with the
  // frontmatter already flipped to in-progress, and we are back on main.
  git(dir, ["checkout", "-q", "-b", specId]);
  const specPath = join(dir, "specs", specId, "spec.md");
  writeFileSync(specPath, specFixture(specId, "in-progress"));
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "crashed attempt: flip to in-progress"]);
  git(dir, ["checkout", "-q", "main"]);

  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runGate: greenGate(),
    runSession: fakeWritingSession(dir, specId),
  };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("passed");
  expect(result.evidence.branch).toBe(specId);

  const bracketRecords = journal.fold().byKind["stage.build.bracket"];
  expect(bracketRecords?.length).toBe(1);
  expect((bracketRecords![0]!.payload as Record<string, unknown>).reused).toBe(true);
  // Already in-progress before the stage ran: the bracket itself makes no
  // further commit (flip.changed is false), so only the session's own
  // commit lands on top of the crashed attempt's commit.
  expect((bracketRecords![0]!.payload as Record<string, unknown>).flipped).toBe(false);

  journal.close();
  decisionsChain.close();
});

// --- B-2/D-8: the bracket regenerates the codebase index ----------------------

test("D-8: the flip commit carries a regenerated index (compile, index, then commit)", async () => {
  const { dir, specId } = initFixtureRepo();
  const base = createProcessRunner({ repoDir: dir });
  const ops: string[] = [];
  const runner: Runner = {
    ...base,
    runGate: (cmd) => {
      ops.push(`gate:${cmd.join(" ")}`);
      return { exitCode: 0, stdoutTail: "", stderrTail: "" };
    },
    commit: (message) => {
      ops.push("commit");
      base.commit(message);
    },
    runSession: fakeWritingSession(dir, specId),
  };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("passed");
  // The bracket's own sequence, right before its flip commit: compile, then
  // the index regeneration. The stale-shard defect was the middle step
  // missing, which left the flip commit carrying the pre-flip shard.
  const firstCommit = ops.indexOf("commit");
  expect(ops.slice(firstCommit - 2, firstCommit + 1)).toEqual([
    "gate:spec-spine compile",
    "gate:spec-spine index",
    "commit",
  ]);

  const bracket = journal.fold().byKind["stage.build.bracket"]![0]!.payload as Record<string, unknown>;
  expect(bracket.compileExitCode).toBe(0);
  expect(bracket.indexExitCode).toBe(0);

  journal.close();
  decisionsChain.close();
});

test("D-8: a failing index regeneration fails the bracket with both gate evidences", async () => {
  const { dir, specId } = initFixtureRepo();
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runGate: (cmd) =>
      cmd.join(" ") === "spec-spine index"
        ? { exitCode: 3, stdoutTail: "", stderrTail: "index exploded" }
        : { exitCode: 0, stdoutTail: "", stderrTail: "" },
    runSession: async () => {
      throw new Error("must not spawn a session after a failed bracket");
    },
  };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("failed");
  expect(result.evidence.gates.map((g) => g.cmd.join(" "))).toEqual(["spec-spine compile", "spec-spine index"]);
  expect(result.evidence.gates[1]!.exitCode).toBe(3);
  const bracket = journal.fold().byKind["stage.build.bracket"]![0]!.payload as Record<string, unknown>;
  expect(bracket.indexExitCode).toBe(3);

  journal.close();
  decisionsChain.close();
});

// --- B-4: hook-blocked classification maps to the blocked outcome -----------

test("B-4: a hook-blocked session classification maps the stage outcome to blocked", async () => {
  const { dir, specId } = initFixtureRepo();
  const runSession: Runner["runSession"] = async () =>
    fakeSessionResult("fake-blocked", {
      classification: { kind: "hook-blocked", resetAtMs: null, detail: "fake hook block" },
      exitCode: 2,
    });
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runGate: greenGate(), runSession };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("blocked");
  expect(result.evidence.sessions.length).toBe(1);
  expect(result.evidence.sessions[0]!.classification).toBe("hook-blocked");

  journal.close();
  decisionsChain.close();
});

// --- B-6: decision capture ----------------------------------------------------

test("B-6: decisions dropped in the drop-box during the session are sealed into stage evidence", async () => {
  const { dir, specId } = initFixtureRepo();
  const { journalDir } = openHandles(dir);
  const dropboxDir = join(journalDir, "decision-dropbox");

  const runSession: Runner["runSession"] = async (opts) => {
    mkdirSync(dropboxDir, { recursive: true });
    writeFileSync(
      join(dropboxDir, "d1.json"),
      JSON.stringify({ id: "d-1", specId, scope: [specId], title: "Use X", decision: "We use X", rationale: "r" })
    );
    return fakeWritingSession(dir, specId)(opts);
  };

  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runGate: greenGate(), runSession };
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir,
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("passed");
  expect(result.evidence.decisions?.sealed.map((d) => d.id)).toEqual(["d-1"]);
  expect(result.evidence.decisions?.invalid).toEqual([]);

  journal.close();
  decisionsChain.close();
});

test("flipImplementation: complete toward in-progress is a no-op (resume after a finished attempt)", () => {
  const spec = ["---", 'id: "900-fixture"', "implementation: complete", "---", "", "# body"].join("\n");
  const flip = flipImplementation(spec, "pending", "in-progress");
  expect(flip.changed).toBe(false);
  expect(flip.content).toBe(spec);
});

test("B-1 normalization: a clean tree on a stale feature branch checks out an updated default branch and proceeds (found live)", async () => {
  const gitOut = (d: string, args: string[]): string => {
    const r = Bun.spawnSync(["git", ...args], { cwd: d });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${new TextDecoder().decode(r.stderr)}`);
    return new TextDecoder().decode(r.stdout).trim();
  };
  const { dir: originDir, specId } = initFixtureRepo();

  // Clone the fixture so the local repo has a real upstream, leave the
  // clone on a leftover feature branch, then advance origin's main (the
  // previous spec's remote squash merge).
  const cloneParent = mkdtempSync(join(tmpdir(), "build-stage-clone-"));
  git(cloneParent, ["clone", "-q", originDir, "repo"]);
  const dir = join(cloneParent, "repo");
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  mkdirSync(join(dir, "src"), { recursive: true }); // empty dirs do not survive a clone
  git(dir, ["checkout", "-q", "-b", "leftover-previous-spec"]);
  writeFileSync(join(originDir, "advanced.txt"), "remote moved\n");
  git(originDir, ["add", "-A"]);
  git(originDir, ["commit", "-q", "-m", "chore: origin main advanced"]);
  const originHead = gitOut(originDir, ["rev-parse", "HEAD"]);

  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runGate: greenGate(),
    runSession: fakeWritingSession(dir, specId),
  };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("passed");
  expect(result.evidence.refusal).toBeNull();
  // The spec branch was based on the fast-forwarded default branch, so the
  // advanced origin commit is in its history.
  const mergeBase = gitOut(dir, ["merge-base", specId, originHead]);
  expect(mergeBase).toBe(originHead);

  journal.close();
  decisionsChain.close();
});

// D-11: the drop-box contract in the prompt is typed. Untyped, every session
// on butler-ai guessed `scope` as a bare string and all 25 of its decisions
// were rejected, leaving the project's ledger empty after a full spec build.
test("buildPrompt states the drop-box field types and gives a copyable example with an array scope (D-11)", () => {
  const prompt = buildPrompt({
    specId: "016-stage-build",
    specBody: "body",
    backlogStep: "step",
    decisions: { included: [], overflowCount: 0 },
    dropboxDir: "/tmp/dropbox",
  });

  // The field that was actually getting guessed wrong, named as an array.
  expect(prompt).toContain("ARRAY of strings, never a bare string");
  // The example is built from this spec's own id, so it is copyable as-is.
  expect(prompt).toContain('"specId": "016-stage-build"');
  expect(prompt).toContain('"scope": ["016-stage-build"');
  // The consequence is stated, so a session knows silence is not success.
  expect(prompt).toContain("neither the ledger nor any later session");

  // The example must itself pass the validator it is teaching.
  const example = {
    id: "016-stage-build-d1",
    specId: "016-stage-build",
    scope: ["016-stage-build", "src/some/territory/"],
    title: "one line naming the choice",
    decision: "what was chosen, in full",
    rationale: "why, and what it costs",
  };
  const result = validateDecisionRecord(example, new Set(["016-stage-build"]));
  expect(result.ok).toBe(true);
});

// D-12: butler-ai's 009 sessions concluded "no branch-side fix exists" for a
// coupling violation that one declared extends entry cleared. The prompt now
// names that mechanism, and names the two answers that are not available.
test("buildPrompt tells the session how to couple a change to a unit another spec owns (D-12)", () => {
  const prompt = buildPrompt({
    specId: "016-stage-build",
    specBody: "body",
    backlogStep: "step",
    decisions: { included: [], overflowCount: 0 },
    dropboxDir: "/tmp/dropbox",
  });
  expect(prompt).toContain("extends:");
  expect(prompt).toContain("nature: additive");
  // The coherence guard, restated where it actually bites.
  expect(prompt).toContain("other spec to match code you just wrote");
  // And the dead end that cost butler-ai a session to rule out by experiment.
  expect(prompt).toContain("read only from a PR body");
  // extends must not become a way to declare away a real contradiction.
  expect(prompt).toContain("If the owning spec actually contradicts the change");
});

// --- D-13: the stall signal ---------------------------------------------------

test("D-13: a remediation that changes nothing against an identical gate answer reports stalled", async () => {
  const { dir, specId } = initFixtureRepo();
  const state = { sessionCalls: 0 };
  const runSession: Runner["runSession"] = async (opts) => {
    state.sessionCalls++;
    return fakeWritingSession(dir, specId)(opts);
  };
  // Byte-identical failure both rounds: the same wall, twice.
  const runGate: Runner["runGate"] = (cmd) => {
    if (state.sessionCalls === 0) return { exitCode: 0, stdoutTail: "", stderrTail: "" };
    if (cmd.join(" ").includes("couple")) {
      return { exitCode: 1, stdoutTail: "", stderrTail: "C-001 'Cargo.toml' changed without an authoring edit" };
    }
    return { exitCode: 0, stdoutTail: "", stderrTail: "" };
  };
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runGate, runSession };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("failed");
  expect(result.evidence.sessions.length).toBe(2);
  expect(result.evidence.stalled).toBe(true);

  // FR-002: the judgment is journaled, not only returned.
  const resultRecord = journal.fold().byKind["stage.build.result"]?.at(-1)?.payload as Record<string, unknown>;
  expect(resultRecord.stalled).toBe(true);

  journal.close();
  decisionsChain.close();
});

test("D-13: a remediation that moves the branch head is not stalled, even though the stage still fails", async () => {
  const { dir, specId } = initFixtureRepo();
  const state = { sessionCalls: 0 };
  const runSession: Runner["runSession"] = async (opts) => {
    state.sessionCalls++;
    await fakeWritingSession(dir, specId)(opts);
    // The remediation session actually tries something: a new commit.
    if (state.sessionCalls === 2) {
      writeFileSync(join(dir, "src", "attempt.ts"), "export const attempt = 2;\n");
      git(dir, ["add", "-A"]);
      git(dir, ["commit", "-q", "-m", "remediation attempt"]);
    }
    return fakeSessionResult(`fake-session-${state.sessionCalls}`);
  };
  const runGate: Runner["runGate"] = (cmd) => {
    if (state.sessionCalls === 0) return { exitCode: 0, stdoutTail: "", stderrTail: "" };
    if (cmd.join(" ").includes("lint")) return { exitCode: 1, stdoutTail: "", stderrTail: "still red" };
    return { exitCode: 0, stdoutTail: "", stderrTail: "" };
  };
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runGate, runSession };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("failed");
  expect(result.evidence.stalled).toBe(false);

  journal.close();
  decisionsChain.close();
});

test("D-13: a stage that never needed a remediation reports stalled as null, not false", async () => {
  const { dir, specId } = initFixtureRepo();
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runGate: greenGate(),
    runSession: fakeWritingSession(dir, specId),
  };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("passed");
  // "Not asked" must never read as "asked and not stalled".
  expect(result.evidence.stalled).toBeNull();

  journal.close();
  decisionsChain.close();
});

// --- 121: the candidate and the receipt --------------------------------------

// A session that works wherever the runner points it (the candidate), as a
// driven session does.
function gitOut(cwd: string, args: string[]): string {
  return new TextDecoder().decode(Bun.spawnSync(["git", ...args], { cwd }).stdout).trim();
}

function candidateWritingSession(runner: Runner, specId: string): Runner["runSession"] {
  return async (_options: RunnerSessionOptions) => {
    const dir = runner.workDir();
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "example.ts"), "export const example = 1;\n");
    writeFileSync(join(dir, "Makefile"), "ci:\n\ttrue\n");
    const specPath = join(dir, "specs", specId, "spec.md");
    writeFileSync(specPath, readFileSync(specPath, "utf8").replace("implementation: in-progress", "implementation: complete"));
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "session work"]);
    return fakeSessionResult("fake-candidate-session");
  };
}

test("121 FR-002: with a candidate home the round runs in the worktree, the checkout never moves, and a stable pass mints a receipt", async () => {
  const { dir, specId } = initFixtureRepo();
  const home = mkdtempSync(join(tmpdir(), "build-candidate-home-"));
  const asked: string[][] = [];
  const base = createProcessRunner({ repoDir: dir, candidateHome: home, project: "fixture" });
  const runner: Runner = {
    ...base,
    runGate: (cmd) => {
      asked.push([...cmd]);
      return { exitCode: 0, stdoutTail: cmd[1] === "--version" ? "spec-spine 0.18.0\n" : "", stderrTail: "" };
    },
    runSession: candidateWritingSession(base, specId),
  };
  // The operator's checkout stays dirty and on another branch throughout.
  git(dir, ["checkout", "-q", "-b", "operator-work"]);
  writeFileSync(join(dir, "scratch.txt"), "uncommitted\n");
  const checkoutBefore = { head: gitOut(dir, ["rev-parse", "HEAD"]), status: Bun.spawnSync(["git", "status", "--porcelain"], { cwd: dir }).stdout.toString() };
  const baseSha = gitOut(dir, ["rev-parse", "main"]);
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
    gate: { commands: [["make", "ci"]], source: "cli", rule: null },
    profile: { mode: "guarded", driver: "codex" },
  });

  expect(result.outcome).toBe("passed");
  const candidate = join(home, "candidates", "fixture", specId);
  expect(runner.workDir()).toBe(candidate);
  expect(existsSync(join(candidate, "src", "example.ts"))).toBe(true);
  expect(existsSync(join(dir, "src", "example.ts"))).toBe(false);
  expect(gitOut(dir, ["rev-parse", "HEAD"])).toBe(checkoutBefore.head);
  expect(gitOut(dir, ["branch", "--show-current"])).toBe("operator-work");
  expect(Bun.spawnSync(["git", "status", "--porcelain"], { cwd: dir }).stdout.toString()).toBe(checkoutBefore.status);

  // The receipt names the candidate's head and base, the suite it ran, the
  // policy it ran under, and the one sensitive path the session touched.
  const receipt = result.evidence.receipt;
  expect(receipt).not.toBeNull();
  expect(receipt!.repo.candidateSha).toBe(gitOut(candidate, ["rev-parse", "HEAD"]));
  expect(receipt!.repo.baseSha).toBe(baseSha);
  expect(receipt!.repo.branch).toBe(specId);
  expect(receipt!.suite.commands.map((c) => c.join(" "))).toEqual([
    "spec-spine check --fail-on-warn",
    "spec-spine lint --fail-on-warn",
    `spec-spine couple --base ${baseSha} --head HEAD`,
    "make ci",
  ]);
  expect(receipt!.suite.digest).toBe(suiteDigest(receipt!.suite.commands));
  expect(receipt!.policy.digest).toBe(policyDigest(receipt!.policy.gate, receipt!.policy.profile));
  expect((receipt!.policy.profile as { driver: string }).driver).toBe("codex");
  expect(receipt!.verifier.specSpine).toBe("spec-spine 0.18.0");
  expect(receipt!.sensitivePaths).toEqual(["Makefile"]);
  expect(result.evidence.sensitivePaths).toEqual(["Makefile"]);
  const folded = journal.fold().byKind;
  expect(folded[RECEIPT_KIND]!.length).toBe(1);
  expect(latestReceipt(journal.fold().records, specId)!.receipt).toEqual(receipt!);
  expect(folded["acceptance.sensitive"]![0]!.payload).toEqual({ specId, round: 1, paths: ["Makefile"] });
  expect(folded["acceptance.unstable"]).toBeUndefined();
  expect(folded["stage.build.result"]![0]!.payload).toMatchObject({ stable: true, receipt: true, sensitivePaths: ["Makefile"] });

  // Reopen for the next stage: the same worktree, as it was left.
  const again = base.openCandidate(specId, baseSha);
  expect(again).toEqual({ path: candidate, reused: true });
  base.closeCandidate(specId);
  expect(existsSync(candidate)).toBe(false);

  journal.close();
  decisionsChain.close();
});

test("121 FR-002: a session that leaves the candidate dirty is unstable: no receipt, the round does not pass", async () => {
  const { dir, specId } = initFixtureRepo();
  const home = mkdtempSync(join(tmpdir(), "build-candidate-home-"));
  const base = createProcessRunner({ repoDir: dir, candidateHome: home, project: "fixture" });
  let calls = 0;
  const runner: Runner = {
    ...base,
    runGate: greenGate(),
    runSession: async () => {
      calls++;
      const work = base.workDir();
      const specPath = join(work, "specs", specId, "spec.md");
      writeFileSync(specPath, readFileSync(specPath, "utf8").replace("implementation: in-progress", "implementation: complete"));
      git(work, ["add", "-A"]);
      git(work, ["commit", "-q", "-m", `work ${calls}`]);
      // A writer that outlives the session: the tree is dirty when the gate runs.
      mkdirSync(join(work, "src"), { recursive: true });
      writeFileSync(join(work, "src", "leftover.ts"), `export const late = ${calls};\n`);
      return fakeSessionResult(`s-${calls}`);
    },
  };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("failed");
  expect(result.evidence.receipt).toBeNull();
  const folded = journal.fold().byKind;
  expect(folded[RECEIPT_KIND]).toBeUndefined();
  const unstable = folded["acceptance.unstable"]!;
  expect(unstable.length).toBe(2);
  expect(unstable[0]!.payload).toMatchObject({ specId, round: 1 });
  expect((unstable[0]!.payload as { dirty: string }).dirty).toContain("?? src/");
  expect(folded["stage.build.result"]![0]!.payload).toMatchObject({ stable: false, receipt: false });

  base.closeCandidate(specId);
  journal.close();
  decisionsChain.close();
});

test("121 B-2: a candidate whose branch the operator has checked out is refused as candidate-unavailable", async () => {
  const { dir, specId } = initFixtureRepo();
  const home = mkdtempSync(join(tmpdir(), "build-candidate-home-"));
  git(dir, ["checkout", "-q", "-b", specId]);
  const runner: Runner = { ...createProcessRunner({ repoDir: dir, candidateHome: home, project: "fixture" }), runGate: greenGate() };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);
  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });
  expect(result.outcome).toBe("refused");
  expect(result.evidence.refusal?.kind).toBe("candidate-unavailable");
  journal.close();
  decisionsChain.close();
});


// --- 129: the gate fence, at the stage ---------------------------------------

// A scripted supervisor: the count rises only when the runner is asked to run
// a gate command the script names, which is how a fenced gate that reached for
// `gh` looks from the stage. No process is spawned for the fence itself; the
// real one is proven in gate-fence.test.ts.
function scriptedFence(reaches: (cmd: readonly string[]) => boolean): Pick<Runner, "runGate" | "fenceTally" | "fenceRefusals"> {
  let gh = 0;
  return {
    runGate: (cmd) => {
      if (reaches(cmd)) gh++;
      return { exitCode: 0, stdoutTail: "", stderrTail: "" };
    },
    fenceTally: () => ({ applied: true, refusals: gh, byTool: { gh, ssh: 0 } }),
    fenceRefusals: () => 0,
  };
}

test("129 B-4: a gate whose commands all exit 0 but reached for gh is not accepted, and the remediation prompt quotes the fence", async () => {
  const { dir, specId } = initFixtureRepo();
  const state = { sessionCalls: 0 };
  const prompts: string[] = [];
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    ...scriptedFence((cmd) => state.sessionCalls > 0 && cmd.join(" ").startsWith("spec-spine lint")),
    runSession: async (opts) => {
      state.sessionCalls++;
      prompts.push(opts.prompt);
      return fakeWritingSession(dir, specId)(opts);
    },
  };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("failed");
  expect(result.evidence.gates.every((g) => g.exitCode === 0)).toBe(true);
  expect(result.evidence.gateFence).toEqual({ applied: true, refusals: 1 });
  expect(result.evidence.fenceRefusal).toEqual({ reason: GATE_FENCE_REFUSED, refusals: 1, tools: ["gh"] });
  expect(result.evidence.gates.find((g) => g.cmd[1] === "lint")!.fence).toEqual({ applied: true, refusals: 1 });
  expect(result.evidence.gates.find((g) => g.cmd[1] === "check")!.fence).toEqual({ applied: true, refusals: 0 });
  expect(prompts[1]).toContain(GATE_FENCE_REFUSED);
  expect(prompts[1]).toContain(FENCE_MESSAGES.gh);
  expect(prompts[1]).toContain("(every gate command passed)");
  expect(prompts[0]).not.toContain(GATE_FENCE_REFUSED);
  const folded = journal.fold().byKind;
  expect(folded[FENCE_REFUSED_KIND]!.map((r) => (r.payload as { round: number }).round)).toEqual([1, 2]);
  expect((folded["stage.build.gate"]![0]!.payload as { reason: string | null }).reason).toBe(GATE_FENCE_REFUSED);
  expect((folded["stage.build.result"]!.at(-1)!.payload as { reason: string | null }).reason).toBe(GATE_FENCE_REFUSED);
  expect(folded[RECEIPT_KIND]).toBeUndefined();

  journal.close();
  decisionsChain.close();
});

test("129 B-4: a gate that reaches for gh at the base refuses the stage before any session, naming the fence", async () => {
  const { dir, specId } = initFixtureRepo();
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    ...scriptedFence((cmd) => cmd[1] === "check"),
    runSession: async () => {
      throw new Error("no session may be driven when the gate at the base reached for a fenced tool");
    },
  };
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("refused");
  expect(result.evidence.refusal?.kind).toBe("gate-red-at-base");
  expect(result.evidence.refusal?.message).toContain(GATE_FENCE_REFUSED);
  expect(result.evidence.refusal?.message).toContain("gh");
  expect(result.evidence.gateFence).toEqual({ applied: true, refusals: 1 });

  journal.close();
  decisionsChain.close();
});

test("129 B-3: a runner without a fence (a fixture world) records every gate with an explicit zero, never an absent count", async () => {
  const { dir, specId } = initFixtureRepo();
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runGate: greenGate(),
    runSession: fakeWritingSession(dir, specId),
  };
  delete (runner as { fenceTally?: unknown }).fenceTally;
  const { journalDir } = openHandles(dir);
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([specId]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("passed");
  expect(result.evidence.gateFence).toEqual({ applied: false, refusals: 0 });
  expect(result.evidence.gates.every((g) => g.fence.applied === false && g.fence.refusals === 0)).toBe(true);
  const gateRecord = journal.fold().byKind["stage.build.gate"]![0]!.payload as { fence: unknown; gates: { fence: unknown }[] };
  expect(gateRecord.fence).toEqual({ applied: false, refusals: 0 });
  expect(gateRecord.gates.every((g) => JSON.stringify(g.fence) === JSON.stringify({ applied: false, refusals: 0 }))).toBe(true);

  journal.close();
  decisionsChain.close();
});
