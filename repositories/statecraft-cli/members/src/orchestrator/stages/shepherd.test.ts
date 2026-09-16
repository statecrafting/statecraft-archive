import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openJournal } from "../journal";
import { createRun, transition } from "../state";
import { latestReceipt, mintReceipt, receiptPayload, RECEIPT_KIND } from "../receipt";
import type { Broker, BrokerRequest, MergeRequest } from "../broker";
import { createProcessRunner, type Runner, type RunnerSessionOptions } from "./build";
import { GATE_COMMANDS, gateSuiteFor, type GateContract } from "../gate-contract";
import { MergeRefusedError } from "./ship";
import type { SessionResult } from "../session";
import type { GitHubClient, GitHubPr, GitHubCommit, CheckRun, MergeMethod, MergeOutcome } from "./ship";
import {
  runShepherdStage,
  runWatchLoop,
  buildRemediationPrompt,
  StatuslessAbortError,
  SHEPHERD_PROMPT_VERSION,
  DEFAULT_POLL_BASE_MS,
  DEFAULT_POLL_FACTOR,
  type Clock,
} from "./shepherd";

// --- fixture repo (real git, never a real `claude` or `gh`) -----------------

function git(dir: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd: dir });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
  }
}

function specFixture(specId: string): string {
  return `---
id: "${specId}"
title: "Fixture spec"
status: approved
kind: stage
implementation: in-progress
depends_on: []
establishes:
  - "src/example.ts"
---

# ${specId}: Fixture

Fixture spec body for shepherd stage tests.
`;
}

function initFixtureRepo(specId = "900-fixture-shepherd"): { dir: string; specId: string; branch: string } {
  const dir = mkdtempSync(join(tmpdir(), "shepherd-stage-test-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  mkdirSync(join(dir, "specs", specId), { recursive: true });
  writeFileSync(join(dir, "specs", specId, "spec.md"), specFixture(specId));
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "chore: fixture base"]);
  git(dir, ["checkout", "-q", "-b", specId]);
  return { dir, specId, branch: specId };
}

function openHandles(): { journalDir: string } {
  return { journalDir: mkdtempSync(join(tmpdir(), "shepherd-stage-journal-")) };
}

// --- fake clock (B-1: no real sleeps in unit tests) --------------------------

function makeFakeClock(startMs = 0): Clock {
  let current = startMs;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
  };
}

// --- fake session results ----------------------------------------------------

function fakeSessionResult(overrides: Partial<SessionResult> = {}): SessionResult {
  return {
    classification: { kind: "completed", resetAtMs: null, detail: "fake" },
    exitCode: 0,
    durationMs: 5,
    numTurns: 3,
    costMicroUsd: 900,
    usage: null,
    sessionId: "fake-shepherd-session",
    transcriptPath: null,
    overflow: { lines: [], truncatedCount: 0 },
    stderrTail: "",
    denials: 0,
    denialSamples: [],
    ...overrides,
  };
}

function scriptedSessions(results: readonly SessionResult[]): Runner["runSession"] {
  let calls = 0;
  return async (_options: RunnerSessionOptions) => {
    const result = results[Math.min(calls, results.length - 1)]!;
    calls++;
    return result;
  };
}

// --- fake PR / check-run fixtures --------------------------------------------

function makePr(overrides: Partial<GitHubPr> = {}): GitHubPr {
  return {
    number: 42,
    url: "https://github.com/example/example/pull/42",
    headSha: "sha-a",
    body: "## Summary\n\n- did the thing\n",
    title: "feat(shepherd): fixture feature",
    ...overrides,
  };
}

function checkRun(overrides: Partial<CheckRun> = {}): CheckRun {
  return { id: 1, name: "unit-tests", status: "completed", conclusion: "success", ...overrides };
}

// --- scripted fake GitHubClient (FR-001: no live `gh` in unit tests) --------

interface FakeGhConfig {
  readonly prSequence: readonly (GitHubPr | null)[];
  readonly checkRunsBySha: Readonly<Record<string, readonly (readonly CheckRun[])[]>>;
  readonly logTails?: Readonly<Record<number, string>>;
  readonly mergeSha?: string;
  readonly branchContainsResult?: boolean;
  // 119 B-4: the remote refuses the merge for the named head.
  mergeRefuses?: boolean;
}

interface FakeGhState {
  prForBranchCalls: number;
  checkRunsCalls: { sha: string }[];
  checkRunsCallCountBySha: Record<string, number>;
  jobLogTailCalls: number[];
  mergeCalls: { number: number; method: MergeMethod }[];
  deleteBranchCalls: string[];
  branchContainsCalls: { branch: string; sha: string }[];
  // 119 B-4: the head each merge call named.
  mergeHeads: string[];
}

function freshFakeGhState(): FakeGhState {
  return {
    prForBranchCalls: 0,
    checkRunsCalls: [],
    checkRunsCallCountBySha: {},
    jobLogTailCalls: [],
    mergeCalls: [],
    mergeHeads: [],
    deleteBranchCalls: [],
    branchContainsCalls: [],
  };
}

function makeFakeGh(config: FakeGhConfig, state: FakeGhState): GitHubClient {
  return {
    prForBranch(_branch: string): GitHubPr | null {
      const idx = Math.min(state.prForBranchCalls, config.prSequence.length - 1);
      state.prForBranchCalls++;
      return config.prSequence[idx] ?? null;
    },
    createPr(_branch: string, _title: string, _body: string): GitHubPr {
      throw new Error("shepherd.test.ts: createPr is a ship-stage seam, not exercised here");
    },
    commitsForPr(_number: number): readonly GitHubCommit[] {
      return [];
    },
    checksTriggered(_headSha: string): boolean {
      return true;
    },
    checkRunsForSha(sha: string): readonly CheckRun[] {
      state.checkRunsCalls.push({ sha });
      const seq = config.checkRunsBySha[sha] ?? [[]];
      const count = state.checkRunsCallCountBySha[sha] ?? 0;
      state.checkRunsCallCountBySha[sha] = count + 1;
      const idx = Math.min(count, seq.length - 1);
      return seq[idx] ?? [];
    },
    jobLogTail(runId: number, maxBytes: number): string {
      state.jobLogTailCalls.push(runId);
      const text = config.logTails?.[runId] ?? `log tail for run ${runId}`;
      return text.length > maxBytes ? text.slice(-maxBytes) : text;
    },
    mergePr(number: number, method: MergeMethod, expectedHeadSha: string): MergeOutcome {
      state.mergeCalls.push({ number, method });
      state.mergeHeads.push(expectedHeadSha);
      if (config.mergeRefuses) {
        throw new MergeRefusedError(expectedHeadSha, `HTTP 409: Head branch was modified (fake)`);
      }
      return { mergeSha: config.mergeSha ?? "merged-sha" };
    },
    branchContains(branch: string, sha: string): boolean {
      state.branchContainsCalls.push({ branch, sha });
      return config.branchContainsResult ?? true;
    },
    deleteRemoteBranch(branch: string): void {
      state.deleteBranchCalls.push(branch);
    },
  };
}

// --- buildRemediationPrompt (B-2) --------------------------------------------

test("buildRemediationPrompt embeds the spec body, the failure evidence, the gate list, and the house style rules", () => {
  const prompt = buildRemediationPrompt({
    specBody: "# 900-fixture: Fixture\n\nSpec body text.",
    branch: "900-fixture-shepherd",
    attemptNumber: 1,
    maxRemediations: 2,
    failing: [{ name: "unit-tests", conclusion: "failure", logTail: "AssertionError: expected 1 to be 2" }],
  });
  expect(prompt).toContain("Spec body text.");
  expect(prompt).toContain("900-fixture-shepherd");
  expect(prompt).toContain("unit-tests");
  expect(prompt).toContain("AssertionError: expected 1 to be 2");
  expect(prompt).toContain(`version: ${SHEPHERD_PROMPT_VERSION}`);
  expect(prompt).toContain("attempt 1 of at most 2");
  expect(prompt).toContain("No em dashes");
  expect(prompt).toContain("No AI attribution");
  expect(prompt.indexOf(String.fromCharCode(0x2014))).toBe(-1);
});

test("041 B-4: the remediation prompt lists the project's gate suite, not this repo's", () => {
  const rust: GateContract = {
    commands: [
      ["cargo", "fmt", "--all", "--check"],
      ["cargo", "test", "--workspace", "--locked"],
    ],
    source: "probe",
    rule: "rust",
  };
  const prompt = buildRemediationPrompt({
    specBody: "# 900-fixture: Fixture",
    branch: "900-fixture-shepherd",
    attemptNumber: 1,
    maxRemediations: 2,
    failing: [{ name: "ci", conclusion: "failure", logTail: "error[E0308]: mismatched types" }],
    gateCommands: gateSuiteFor(rust),
  });
  for (const cmd of gateSuiteFor(rust)) expect(prompt).toContain(cmd.join(" "));
  // A Rust target's remediation session is never told to run this repo's bun.
  expect(prompt).not.toContain("bun run typecheck");
  expect(prompt).not.toContain("bun test");
});

test("041 B-3: a remediation prompt with no contract promises only the governance floor", () => {
  const prompt = buildRemediationPrompt({
    specBody: "# 900-fixture: Fixture",
    branch: "900-fixture-shepherd",
    attemptNumber: 1,
    maxRemediations: 2,
    failing: [{ name: "ci", conclusion: "failure", logTail: "boom" }],
  });
  for (const cmd of GATE_COMMANDS) expect(prompt).toContain(cmd.join(" "));
  expect(prompt).not.toContain("bun test");
});

// --- runWatchLoop: backoff + journal-only-on-change (B-1) --------------------

test("runWatchLoop: backs off 15s/22.5s/33.75s and journals only when the observed state changes", async () => {
  const clock = makeFakeClock();
  const state = freshFakeGhState();
  const gh = makeFakeGh(
    {
      prSequence: [null],
      checkRunsBySha: {
        "sha-a": [
          [checkRun({ status: "in_progress", conclusion: null })],
          [checkRun({ status: "in_progress", conclusion: null })],
          [checkRun({ status: "in_progress", conclusion: null })],
          [checkRun({ status: "completed", conclusion: "success" })],
        ],
      },
    },
    state
  );
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);

  const result = await runWatchLoop({
    gh,
    sha: "sha-a",
    clock,
    journal,
    specId: "900-fixture-shepherd",
    round: 1,
    pollBaseMs: DEFAULT_POLL_BASE_MS,
    pollFactor: DEFAULT_POLL_FACTOR,
    pollCapMs: 120_000,
    deadlineMs: 45 * 60_000,
  });

  expect(result.kind).toBe("green");
  // Four polls total (three identical in_progress, one completed): the
  // unchanged middle polls journal nothing, only the first observation and
  // the final change do.
  expect(journal.fold().byKind["stage.shepherd.watch"]?.length).toBe(2);
  // 15000 + 22500 + 33750 = 71250 ms of backed-off sleep between the four polls.
  expect(clock.now()).toBe(71_250);

  journal.close();
});

test("runWatchLoop: a response missing required fields throws a typed statusless-abort error rather than polling forever", async () => {
  const clock = makeFakeClock();
  const state = freshFakeGhState();
  const malformed = [{ id: 1, name: "unit-tests" } as unknown as CheckRun];
  const gh = makeFakeGh({ prSequence: [null], checkRunsBySha: { "sha-a": [malformed] } }, state);
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);

  await expect(
    runWatchLoop({
      gh,
      sha: "sha-a",
      clock,
      journal,
      specId: "900-fixture-shepherd",
      round: 1,
      pollBaseMs: DEFAULT_POLL_BASE_MS,
      pollFactor: DEFAULT_POLL_FACTOR,
      pollCapMs: 120_000,
      deadlineMs: 45 * 60_000,
    })
  ).rejects.toBeInstanceOf(StatuslessAbortError);

  journal.close();
});

// --- runShepherdStage: green-first-try (B-4) ---------------------------------

test("green-first-try: all required checks pass on the first poll, so the stage merges and confirms containment", async () => {
  const { dir, specId, branch } = initFixtureRepo();
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runSession: scriptedSessions([fakeSessionResult()]) };
  const state = freshFakeGhState();
  const pr = makePr({ headSha: "sha-a" });
  const gh = makeFakeGh(
    {
      prSequence: [pr],
      checkRunsBySha: { "sha-a": [[checkRun({ status: "completed", conclusion: "success" })]] },
      mergeSha: "merge-sha-1",
      branchContainsResult: true,
    },
    state
  );
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);
  const clock = makeFakeClock();

  const result = await runShepherdStage({ runner, gh, specId, journal, clock });

  expect(result.outcome).toBe("passed");
  expect(result.evidence.branch).toBe(branch);
  expect(result.evidence.mergeSha).toBe("merge-sha-1");
  expect(result.evidence.branchContainsConfirmed).toBe(true);
  expect(result.evidence.needsHuman).toBe(false);
  expect(result.evidence.watchAttempts.length).toBe(1);
  expect(result.evidence.watchAttempts[0]!.outcome).toBe("green");
  expect(result.evidence.remediations.length).toBe(0);
  expect(state.mergeCalls).toEqual([{ number: pr.number, method: "squash" }]);
  // 119 B-4: the merge named the head the watch followed.
  expect(state.mergeHeads).toEqual(["sha-a"]);
  expect(state.deleteBranchCalls).toEqual([branch]);
  expect(state.branchContainsCalls).toEqual([{ branch: "main", sha: "merge-sha-1" }]);

  journal.close();
});

// --- runShepherdStage: the merge names its head (119 B-4) --------------------

test("119 FR-003: a head that moved after the last green watch is not merged; the refusal is journaled and needs a human", async () => {
  const { dir, specId } = initFixtureRepo();
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runSession: scriptedSessions([fakeSessionResult()]) };
  const state = freshFakeGhState();
  const watched = makePr({ headSha: "sha-a" });
  const moved = makePr({ headSha: "sha-b" });
  const gh = makeFakeGh(
    {
      // The first read is the head the watch follows; the re-read before the
      // merge sees a push nobody watched.
      prSequence: [watched, moved],
      checkRunsBySha: { "sha-a": [[checkRun({ status: "completed", conclusion: "success" })]] },
    },
    state
  );
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);

  const result = await runShepherdStage({ runner, gh, specId, journal, clock: makeFakeClock() });

  expect(result.outcome).toBe("failed");
  expect(result.evidence.needsHuman).toBe(true);
  expect(result.evidence.mergeSha).toBeNull();
  expect(state.mergeCalls).toEqual([]);
  expect(state.deleteBranchCalls).toEqual([]);
  const refused = journal.fold().byKind["stage.shepherd.merge-refused"] ?? [];
  expect(refused.length).toBe(1);
  expect(refused[0]!.payload).toMatchObject({ specId, prNumber: watched.number, watchedSha: "sha-a", currentSha: "sha-b" });

  journal.close();
});

test("119 FR-003: a merge the remote refuses for the named head is journaled, needs a human, and is attempted exactly once", async () => {
  const { dir, specId } = initFixtureRepo();
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runSession: scriptedSessions([fakeSessionResult()]) };
  const state = freshFakeGhState();
  const pr = makePr({ headSha: "sha-a" });
  const gh = makeFakeGh(
    {
      prSequence: [pr],
      checkRunsBySha: { "sha-a": [[checkRun({ status: "completed", conclusion: "success" })]] },
      mergeRefuses: true,
    },
    state
  );
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);

  const result = await runShepherdStage({ runner, gh, specId, journal, clock: makeFakeClock() });

  expect(result.outcome).toBe("failed");
  expect(result.evidence.needsHuman).toBe(true);
  expect(state.mergeCalls.length).toBe(1);
  expect(state.mergeHeads).toEqual(["sha-a"]);
  expect(state.deleteBranchCalls).toEqual([]);
  const refused = journal.fold().byKind["stage.shepherd.merge-refused"] ?? [];
  expect(refused.length).toBe(1);
  expect((refused[0]!.payload as { reason: string }).reason).toContain("409");

  journal.close();
});

// --- runShepherdStage: fail-fix-green (B-2, B-3) -----------------------------

test("fail-fix-green: one remediation restarts the watch on the new head sha and then merges", async () => {
  const { dir, specId, branch } = initFixtureRepo();
  const prompts: string[] = [];
  const scripted = scriptedSessions([fakeSessionResult()]);
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runSession: async (options) => {
      prompts.push(options.prompt);
      return scripted(options);
    },
  };
  const state = freshFakeGhState();
  const prA = makePr({ headSha: "sha-a" });
  const prB = makePr({ headSha: "sha-b" });
  const gh = makeFakeGh(
    {
      prSequence: [prA, prB],
      checkRunsBySha: {
        "sha-a": [[checkRun({ status: "completed", conclusion: "failure" })]],
        "sha-b": [[checkRun({ id: 2, status: "completed", conclusion: "success" })]],
      },
      mergeSha: "merge-sha-2",
      branchContainsResult: true,
    },
    state
  );
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);
  const clock = makeFakeClock();

  const result = await runShepherdStage({ runner, gh, specId, journal, clock });

  expect(result.outcome).toBe("passed");
  expect(result.evidence.mergeSha).toBe("merge-sha-2");
  expect(result.evidence.watchAttempts.map((a) => a.sha)).toEqual(["sha-a", "sha-b"]);
  expect(result.evidence.watchAttempts.map((a) => a.outcome)).toEqual(["failed", "green"]);
  expect(result.evidence.remediations.length).toBe(1);
  expect(result.evidence.remediations[0]!.headSha).toBe("sha-a");
  expect(result.evidence.remediations[0]!.failing).toEqual([
    { id: 1, name: "unit-tests", conclusion: "failure", logTailHash: expect.any(String) },
  ]);
  expect(state.jobLogTailCalls).toEqual([1]);
  expect(state.mergeCalls).toEqual([{ number: prB.number, method: "squash" }]);
  // 119 B-4: the merge named the head the second watch went green on.
  expect(state.mergeHeads).toEqual(["sha-b"]);
  // 123 B-6: the remediation prompt carries the capsule.
  expect(prompts.length).toBe(1);
  expect(prompts[0]).toContain("## Handoff capsule");
  expect(prompts[0]).toContain(`spec: ${specId}`);
  // 119 B-2: the remediation's suite was judged against a resolved base,
  // journaled before the prompt went out.
  const base = journal.fold().byKind["stage.shepherd.base"] ?? [];
  expect(base.length).toBe(1);
  const baseSha = (base[0]!.payload as { baseSha: string }).baseSha;
  expect(baseSha).toMatch(/^[0-9a-f]{40}$/);
  expect(baseSha).toBe(runner.resolveBase("main"));

  journal.close();
});

// --- runShepherdStage: flap-then-exhaust (AC-2) ------------------------------

test("flap-then-exhaust: two remediations still fail, so the stage ends failed/needsHuman with no merge and all evidence retained", async () => {
  const { dir, specId, branch } = initFixtureRepo();
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runSession: scriptedSessions([fakeSessionResult({ sessionId: "session-1" }), fakeSessionResult({ sessionId: "session-2" })]),
  };
  const state = freshFakeGhState();
  const prA = makePr({ headSha: "sha-a" });
  const prB = makePr({ headSha: "sha-b" });
  const prC = makePr({ headSha: "sha-c" });
  const gh = makeFakeGh(
    {
      prSequence: [prA, prB, prC],
      checkRunsBySha: {
        "sha-a": [[checkRun({ status: "completed", conclusion: "failure" })]],
        "sha-b": [[checkRun({ status: "completed", conclusion: "failure" })]],
        "sha-c": [[checkRun({ status: "completed", conclusion: "failure" })]],
      },
    },
    state
  );
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);
  const clock = makeFakeClock();

  const result = await runShepherdStage({ runner, gh, specId, journal, clock });

  expect(result.outcome).toBe("failed");
  expect(result.evidence.needsHuman).toBe(true);
  expect(result.evidence.mergeSha).toBeNull();
  expect(result.evidence.remediations.length).toBe(2);
  expect(result.evidence.remediations.map((r) => r.sessionId)).toEqual(["session-1", "session-2"]);
  expect(result.evidence.watchAttempts.length).toBe(3);
  expect(result.evidence.watchAttempts.every((a) => a.outcome === "failed")).toBe(true);
  expect(state.mergeCalls.length).toBe(0);
  expect(state.deleteBranchCalls.length).toBe(0);

  journal.close();
});

// --- runShepherdStage: statusless abort (B-1) --------------------------------

test("statusless abort: a check-runs response missing required fields fails the stage needsHuman without remediation or merge", async () => {
  const { dir, specId } = initFixtureRepo();
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runSession: scriptedSessions([fakeSessionResult()]) };
  const state = freshFakeGhState();
  const pr = makePr({ headSha: "sha-a" });
  const malformed = [{ id: 1, name: "unit-tests", status: "completed" } as unknown as CheckRun]; // conclusion has the wrong type below
  const badRun = { ...malformed[0]!, conclusion: 12345 } as unknown as CheckRun;
  const gh = makeFakeGh({ prSequence: [pr], checkRunsBySha: { "sha-a": [[badRun]] } }, state);
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);
  const clock = makeFakeClock();

  const result = await runShepherdStage({ runner, gh, specId, journal, clock });

  expect(result.outcome).toBe("failed");
  expect(result.evidence.needsHuman).toBe(true);
  expect(result.evidence.statuslessAbort).not.toBeNull();
  expect(result.evidence.remediations.length).toBe(0);
  expect(state.mergeCalls.length).toBe(0);
  expect(journal.fold().byKind["stage.shepherd.statusless-abort"]?.length).toBe(1);

  journal.close();
});

// --- runShepherdStage: stale-sha ignore (B-3) --------------------------------

test("stale-sha ignore: after a remediation push, the loop never re-polls the pre-push sha again", async () => {
  const { dir, specId, branch } = initFixtureRepo();
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runSession: scriptedSessions([fakeSessionResult()]) };
  const state = freshFakeGhState();
  const prA = makePr({ headSha: "sha-a" });
  const prB = makePr({ headSha: "sha-b" });
  const gh = makeFakeGh(
    {
      prSequence: [prA, prB],
      checkRunsBySha: {
        // A trailing "green" entry baits a bug that keeps polling the stale
        // sha after the push; the loop must never reach it.
        "sha-a": [
          [checkRun({ status: "in_progress", conclusion: null })],
          [checkRun({ status: "completed", conclusion: "failure" })],
          [checkRun({ status: "completed", conclusion: "success" })],
        ],
        "sha-b": [
          [checkRun({ id: 2, status: "in_progress", conclusion: null })],
          [checkRun({ id: 2, status: "completed", conclusion: "success" })],
        ],
      },
      mergeSha: "merge-sha-3",
      branchContainsResult: true,
    },
    state
  );
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);
  const clock = makeFakeClock();

  const result = await runShepherdStage({ runner, gh, specId, journal, clock });

  expect(result.outcome).toBe("passed");
  expect(result.evidence.mergeSha).toBe("merge-sha-3");
  expect(result.evidence.watchAttempts.map((a) => a.sha)).toEqual(["sha-a", "sha-b"]);
  // Exactly two polls of sha-a (in_progress, then failure): the bait's third
  // entry (a spurious "success") is never consumed.
  expect(state.checkRunsCallCountBySha["sha-a"]).toBe(2);
  expect(state.checkRunsCalls.filter((c) => c.sha === "sha-a").length).toBe(2);
  expect(state.checkRunsCalls.every((c, i) => (i < 2 ? c.sha === "sha-a" : c.sha === "sha-b"))).toBe(true);

  journal.close();
});

// --- runShepherdStage: quota remediation reports quota (B-5) ----------------

test("quota remediation: a remediation session classified quota reports outcome quota, not a park, and stops without merging", async () => {
  const { dir, specId } = initFixtureRepo();
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runSession: scriptedSessions([
      fakeSessionResult({
        classification: { kind: "quota", resetAtMs: 1_800_000, detail: "matched quota pattern" },
        sessionId: "quota-session",
      }),
    ]),
  };
  const state = freshFakeGhState();
  const pr = makePr({ headSha: "sha-a" });
  const gh = makeFakeGh(
    { prSequence: [pr], checkRunsBySha: { "sha-a": [[checkRun({ status: "completed", conclusion: "failure" })]] } },
    state
  );
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);
  const clock = makeFakeClock();

  const result = await runShepherdStage({ runner, gh, specId, journal, clock });

  expect(result.outcome).toBe("quota");
  expect(result.evidence.needsHuman).toBe(false);
  expect(result.evidence.remediations.length).toBe(1);
  expect(result.evidence.remediations[0]!.sessionId).toBe("quota-session");
  expect(result.evidence.remediations[0]!.classification).toBe("quota");
  expect(state.mergeCalls.length).toBe(0);
  // No second gh.prForBranch call: quota stops before re-resolving the head sha.
  expect(state.prForBranchCalls).toBe(1);

  journal.close();
});

// --- runShepherdStage: hook-blocked remediation (adversarial-prompt-refusal) -

test("hook-blocked remediation: a refused remediation session yields outcome blocked, not a self-approved fix", async () => {
  const { dir, specId } = initFixtureRepo();
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runSession: scriptedSessions([
      fakeSessionResult({
        classification: { kind: "hook-blocked", resetAtMs: null, detail: '[pr-gate] BLOCKED' },
        exitCode: 2,
      }),
    ]),
  };
  const state = freshFakeGhState();
  const pr = makePr({ headSha: "sha-a" });
  const gh = makeFakeGh(
    { prSequence: [pr], checkRunsBySha: { "sha-a": [[checkRun({ status: "completed", conclusion: "failure" })]] } },
    state
  );
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);
  const clock = makeFakeClock();

  const result = await runShepherdStage({ runner, gh, specId, journal, clock });

  expect(result.outcome).toBe("blocked");
  expect(result.evidence.needsHuman).toBe(false);
  expect(state.mergeCalls.length).toBe(0);

  journal.close();
});

// --- runShepherdStage: no PR found (defensive, see Resolved decisions) ------

test("no PR found: shepherding a branch with no open PR fails needsHuman without polling any checks", async () => {
  const { dir, specId } = initFixtureRepo();
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runSession: scriptedSessions([fakeSessionResult()]) };
  const state = freshFakeGhState();
  const gh = makeFakeGh({ prSequence: [null], checkRunsBySha: {} }, state);
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);
  const clock = makeFakeClock();

  const result = await runShepherdStage({ runner, gh, specId, journal, clock });

  expect(result.outcome).toBe("failed");
  expect(result.evidence.needsHuman).toBe(true);
  expect(result.evidence.watchAttempts.length).toBe(0);
  expect(state.checkRunsCalls.length).toBe(0);

  journal.close();
});

// --- 122: the merge and the remediation push go through the broker ----------

interface RecordingBroker extends Broker {
  readonly pushes: BrokerRequest[];
  readonly merges: MergeRequest[];
}

function recordingBroker(): RecordingBroker {
  const b: RecordingBroker = {
    pushes: [],
    merges: [],
    push(request) {
      b.pushes.push(request);
      return { status: "done" };
    },
    openPr() {
      throw new Error("shepherd.test.ts: openPr is ship's");
    },
    merge(request) {
      b.merges.push(request);
      return { status: "done", mergeSha: "merge-via-broker" };
    },
  };
  return b;
}

// A journal with a live run and a receipt covering `headSha` for the spec.
function brokeredJournal(specId: string, headSha: string | null): { journal: ReturnType<typeof openJournal>; runId: string; receiptHash: string | null } {
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);
  const run = createRun(journal, "/repo");
  transition(journal, run, "running");
  let receiptHash: string | null = null;
  if (headSha !== null) {
    const receipt = mintReceipt({
      specId,
      round: 1,
      origin: null,
      baseSha: "base",
      candidateSha: headSha,
      branch: specId,
      suite: [],
      gate: null,
      profile: { mode: "bypass" },
      specSpineVersion: null,
      results: [],
      changedPaths: [],
    });
    receiptHash = journal.append(RECEIPT_KIND, receiptPayload(receipt)).recordHash;
  }
  return { journal, runId: run.id, receiptHash };
}

test("122 FR-003: the green merge goes through the broker with the receipt covering the PR head", async () => {
  const { dir, specId } = initFixtureRepo();
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runSession: scriptedSessions([fakeSessionResult()]) };
  const state = freshFakeGhState();
  const pr = makePr({ headSha: "sha-a" });
  const gh = makeFakeGh({ prSequence: [pr], checkRunsBySha: { "sha-a": [[checkRun({ status: "completed", conclusion: "success" })]] } }, state);
  const { journal, runId, receiptHash } = brokeredJournal(specId, "sha-a");
  const broker = recordingBroker();

  const result = await runShepherdStage({ runner, gh, specId, journal, clock: makeFakeClock(), broker, runId });

  expect(result.outcome).toBe("passed");
  expect(result.evidence.mergeSha).toBe("merge-via-broker");
  expect(broker.merges).toEqual([{ runId, specId, branch: specId, headSha: "sha-a", receiptHash: receiptHash!, prNumber: pr.number, method: "squash" as const }]);
  // The seam's own mergePr was never called: the broker owns the effect.
  expect(state.mergeCalls).toEqual([]);
  journal.close();
});

test("122 FR-003: a PR head without a receipt is failed with needsHuman and no merge call", async () => {
  const { dir, specId } = initFixtureRepo();
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runSession: scriptedSessions([fakeSessionResult()]) };
  const state = freshFakeGhState();
  const pr = makePr({ headSha: "sha-a" });
  const gh = makeFakeGh({ prSequence: [pr], checkRunsBySha: { "sha-a": [[checkRun({ status: "completed", conclusion: "success" })]] } }, state);
  const { journal, runId } = brokeredJournal(specId, null);
  const broker = recordingBroker();

  const result = await runShepherdStage({ runner, gh, specId, journal, clock: makeFakeClock(), broker, runId });

  expect(result.outcome).toBe("failed");
  expect(result.evidence.needsHuman).toBe(true);
  expect(broker.merges).toEqual([]);
  expect(state.mergeCalls).toEqual([]);
  const refused = journal.fold().byKind["stage.shepherd.merge-refused"]!.at(-1)!.payload as { reason: string };
  expect(refused.reason).toContain("no-receipt");
  journal.close();
});

test("122 FR-003: a remediation commit is gated, receipted and pushed by the engine, then watched at its new head", async () => {
  const { dir, specId } = initFixtureRepo();
  // The remediation session commits a fix and flips the spec complete so the
  // engine's own gate can receipt it (122 D-5).
  const fixingSession: Runner["runSession"] = async (_options: RunnerSessionOptions) => {
    writeFileSync(join(dir, "fix.txt"), "fixed\n");
    const specPath = join(dir, "specs", specId, "spec.md");
    writeFileSync(specPath, new TextDecoder().decode(Bun.spawnSync(["cat", specPath]).stdout).replace("implementation: in-progress", "implementation: complete"));
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "fix: remediation"]);
    return fakeSessionResult();
  };
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runGate: () => ({ exitCode: 0, stdoutTail: "", stderrTail: "" }),
    runSession: fixingSession,
  };
  const state = freshFakeGhState();
  const prA = makePr({ headSha: "sha-a" });
  const gh = makeFakeGh(
    {
      // After the engine pushes, the PR head is the fixed commit; the fake
      // answers prA first and then whatever head the runner has.
      prSequence: [prA],
      checkRunsBySha: { "sha-a": [[checkRun({ status: "completed", conclusion: "failure" })]] },
    },
    state
  );
  const { journal, runId } = brokeredJournal(specId, "sha-a");
  const broker = recordingBroker();
  let fixedHead = "";
  const original = gh.prForBranch.bind(gh);
  let reads = 0;
  gh.prForBranch = (branch: string) => {
    reads++;
    if (reads === 1) return original(branch);
    fixedHead = runner.headSha();
    return makePr({ headSha: fixedHead });
  };
  const withFixed: GitHubClient = {
    ...gh,
    checkRunsForSha: (sha: string) =>
      sha === "sha-a" ? [checkRun({ status: "completed", conclusion: "failure" })] : [checkRun({ id: 2, status: "completed", conclusion: "success" })],
  };

  const result = await runShepherdStage({ runner, gh: withFixed, specId, journal, clock: makeFakeClock(), broker, runId });

  expect(result.outcome).toBe("passed");
  expect(broker.pushes.length).toBe(1);
  expect(broker.pushes[0]!.headSha).toBe(fixedHead);
  const receipt = latestReceipt(journal.fold().records, specId)!;
  expect(receipt.receipt.repo.candidateSha).toBe(fixedHead);
  expect(receipt.receipt.round).toBe(4);
  expect(broker.pushes[0]!.receiptHash).toBe(receipt.hash);
  expect(broker.merges.length).toBe(1);
  expect(broker.merges[0]!.headSha).toBe(fixedHead);
  expect(broker.merges[0]!.receiptHash).toBe(receipt.hash);
  expect(result.evidence.watchAttempts.map((a) => a.outcome)).toEqual(["failed", "green"]);
  journal.close();
});

