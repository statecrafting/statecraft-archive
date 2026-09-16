import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openJournal } from "../journal";
import { createRun, transition } from "../state";
import { latestReceipt } from "../receipt";
import { BrokerRefusedError, type Broker, type BrokerRefusal, type BrokerRequest, type OpenPrRequest } from "../broker";
import { createProcessRunner, type Runner } from "./build";
import type { SessionResult } from "../session";
import {
  runShipStage,
  buildShipPrompt,
  SHIP_PROMPT_VERSION,
  createProcessGitHubClient,
  proposalPath,
  type GitHubClient,
  type GitHubPr,
  type GitHubCommit,
} from "./ship";

// --- fixture repo (real git, never a real `claude` or `gh`) -----------------

function git(dir: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd: dir });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
  }
}

function initFixtureRepo(branch = "900-fixture-ship"): { dir: string; branch: string; headSha: string } {
  const dir = mkdtempSync(join(tmpdir(), "ship-stage-test-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  writeFileSync(join(dir, "README.md"), "fixture\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "chore: fixture base"]);
  git(dir, ["checkout", "-q", "-b", branch]);
  writeFileSync(join(dir, "feature.txt"), "feature work\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "feat: fixture feature"]);
  const headSha = new TextDecoder().decode(Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: dir }).stdout).trim();
  return { dir, branch, headSha };
}

function openHandles(): { journalDir: string } {
  return { journalDir: mkdtempSync(join(tmpdir(), "ship-stage-journal-")) };
}

function fakeSessionResult(overrides: Partial<SessionResult> = {}): SessionResult {
  return {
    classification: { kind: "completed", resetAtMs: null, detail: "fake" },
    exitCode: 0,
    durationMs: 5,
    numTurns: 3,
    costMicroUsd: 4200,
    usage: null,
    sessionId: "fake-ship-session",
    transcriptPath: null,
    overflow: { lines: [], truncatedCount: 0 },
    stderrTail: "",
    denials: 0,
    denialSamples: [],
    ...overrides,
  };
}

function cleanPr(overrides: Partial<GitHubPr> = {}): GitHubPr {
  return {
    number: 42,
    url: "https://github.com/example/example/pull/42",
    headSha: "deadbeef",
    body: "## Summary\n\n- did the thing\n\n## Testing\n\n- bun test\n",
    title: "feat(ship): fixture feature",
    ...overrides,
  };
}

function cleanCommit(overrides: Partial<GitHubCommit> = {}): GitHubCommit {
  return { sha: "deadbeef", message: "feat: fixture feature", ...overrides };
}

interface FakeGhState {
  prForBranchCalls: number;
  commitsForPrCalls: number;
  checksTriggeredCalls: number;
}

function freshFakeGhState(): FakeGhState {
  return { prForBranchCalls: 0, commitsForPrCalls: 0, checksTriggeredCalls: 0 };
}

// A scripted fake GitHubClient (FR-001: no live `gh` in unit tests).
// `prSequence` answers successive `prForBranch` calls in order (the last
// entry repeats once exhausted), so a single fixture can express "no PR yet
// at the idempotency pre-check, a PR by the post-session check" without a
// stateful mock library.
function makeFakeGh(
  params: { prSequence: readonly (GitHubPr | null)[]; commits?: readonly GitHubCommit[]; ciTriggered?: boolean },
  state: FakeGhState
): GitHubClient {
  const commits = params.commits ?? [];
  const ciTriggered = params.ciTriggered ?? true;
  return {
    prForBranch(_branch: string): GitHubPr | null {
      const index = Math.min(state.prForBranchCalls, params.prSequence.length - 1);
      state.prForBranchCalls++;
      return params.prSequence[index] ?? null;
    },
    createPr(_branch: string, _title: string, _body: string): GitHubPr {
      throw new Error("ship.test.ts: createPr is the broker's seam (122), not exercised in the in-place scenarios");
    },
    commitsForPr(_number: number): readonly GitHubCommit[] {
      state.commitsForPrCalls++;
      return commits;
    },
    checksTriggered(_headSha: string): boolean {
      state.checksTriggeredCalls++;
      return ciTriggered;
    },
    // --- shepherd extensions (spec 018): unused by this spec's own
    // scenarios, so these stubs exist only to satisfy the shared
    // GitHubClient shape (see specs/017-stage-ship/spec.md D-7).
    checkRunsForSha(_sha: string) {
      throw new Error("ship.test.ts: checkRunsForSha is a shepherd-stage seam, not exercised here");
    },
    jobLogTail(_runId: number, _maxBytes: number): string {
      throw new Error("ship.test.ts: jobLogTail is a shepherd-stage seam, not exercised here");
    },
    mergePr(_number: number, _method) {
      throw new Error("ship.test.ts: mergePr is a shepherd-stage seam, not exercised here");
    },
    branchContains(_branch: string, _sha: string): boolean {
      throw new Error("ship.test.ts: branchContains is a shepherd-stage seam, not exercised here");
    },
    deleteRemoteBranch(_branch: string): void {
      throw new Error("ship.test.ts: deleteRemoteBranch is a shepherd-stage seam, not exercised here");
    },
  };
}

// --- prompt template (B-1) ----------------------------------------------------

test("buildShipPrompt (in place) carries the operator's standing authorization through /ship's PR checkpoint", () => {
  const prompt = buildShipPrompt({ branch: "017-stage-ship" });
  expect(SHIP_PROMPT_VERSION).toBe(3);
  expect(prompt).toContain("Standing authorization");
  expect(prompt).toContain("do not stop to ask");
  // The authorization is scoped to PR creation: a drift waiver still halts.
  expect(prompt).toContain("waiver");
});

test("122 FR-002: the brokered prompt carries no push and no gh pr create; the session proposes into the drop box", () => {
  const prompt = buildShipPrompt({ branch: "017-stage-ship", proposalPath: "/tmp/dropbox/proposal-017-stage-ship.json" });
  expect(prompt).toContain("/tmp/dropbox/proposal-017-stage-ship.json");
  expect(prompt).toContain("Publication is the engine's");
  expect(prompt).toContain("do not push");
  expect(prompt).not.toContain("Standing authorization");
  expect(prompt).not.toContain("open the pull request through");
  expect(prompt).toContain("waiver");
  expect(prompt.indexOf(String.fromCharCode(0x2014))).toBe(-1);
});

test("buildShipPrompt embeds the branch, the prompt version, and the house style rules", () => {
  const prompt = buildShipPrompt({ branch: "017-stage-ship" });
  expect(prompt).toContain("017-stage-ship");
  expect(prompt).toContain(`version: ${SHIP_PROMPT_VERSION}`);
  expect(prompt).toContain("/ship");
  expect(prompt).toContain("No session-link URLs");
  expect(prompt).toContain("No AI attribution");
  expect(prompt).toContain("No em dashes");
  // The template itself must never contain the character it forbids.
  expect(prompt.indexOf(String.fromCharCode(0x2014))).toBe(-1);
});

// --- createProcessGitHubClient (production seam, fake `gh` script only) -----

function writeFakeGhScript(dir: string, body: string): string {
  const path = join(dir, "fake-gh.sh");
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

test("createProcessGitHubClient: prForBranch parses gh pr view --json output", () => {
  const dir = mkdtempSync(join(tmpdir(), "ship-gh-test-"));
  const script = writeFakeGhScript(
    dir,
    'echo \'{"number":7,"url":"https://github.com/example/example/pull/7","headRefOid":"abc123","body":"## Summary","title":"feat: x"}\''
  );
  const client = createProcessGitHubClient({ repoDir: dir, ghBin: script });
  expect(client.prForBranch("some-branch")).toEqual({
    number: 7,
    url: "https://github.com/example/example/pull/7",
    headSha: "abc123",
    body: "## Summary",
    title: "feat: x",
    merged: false,
  });
});

test("122 B-5: prForBranch reads the merge state and commit when gh reports them", () => {
  const dir = mkdtempSync(join(tmpdir(), "ship-gh-test-"));
  const script = writeFakeGhScript(
    dir,
    'echo \'{"number":7,"url":"u","headRefOid":"abc123","body":"","title":"t","state":"MERGED","mergeCommit":{"oid":"m1"}}\''
  );
  const client = createProcessGitHubClient({ repoDir: dir, ghBin: script });
  expect(client.prForBranch("some-branch")).toMatchObject({ merged: true, mergeSha: "m1" });
});

test("createProcessGitHubClient: prForBranch returns null when gh exits non-zero (no PR for branch)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ship-gh-test-"));
  const script = writeFakeGhScript(dir, ['echo "no pull requests found" 1>&2', "exit 1"].join("\n"));
  const client = createProcessGitHubClient({ repoDir: dir, ghBin: script });
  expect(client.prForBranch("some-branch")).toBeNull();
});

test("createProcessGitHubClient: commitsForPr joins the headline and body into one message", () => {
  const dir = mkdtempSync(join(tmpdir(), "ship-gh-test-"));
  const script = writeFakeGhScript(
    dir,
    'echo \'{"commits":[{"oid":"abc123","messageHeadline":"feat: x","messageBody":"detail line"}]}\''
  );
  const client = createProcessGitHubClient({ repoDir: dir, ghBin: script });
  expect(client.commitsForPr(7)).toEqual([{ sha: "abc123", message: "feat: x\ndetail line" }]);
});

test("createProcessGitHubClient: checksTriggered reads total_count from the check-runs response", () => {
  const dir = mkdtempSync(join(tmpdir(), "ship-gh-test-"));
  const script = writeFakeGhScript(dir, 'echo \'{"total_count":2,"check_runs":[]}\'');
  const client = createProcessGitHubClient({ repoDir: dir, ghBin: script });
  expect(client.checksTriggered("abc123")).toBe(true);
});

test("createProcessGitHubClient: checksTriggered is false when total_count is zero", () => {
  const dir = mkdtempSync(join(tmpdir(), "ship-gh-test-"));
  const script = writeFakeGhScript(dir, 'echo \'{"total_count":0,"check_runs":[]}\'');
  const client = createProcessGitHubClient({ repoDir: dir, ghBin: script });
  expect(client.checksTriggered("abc123")).toBe(false);
});

// --- runShipStage: happy path (B-1, B-3) -------------------------------------

test("happy path: the session runs, the PR verifies clean, and the stage passes", async () => {
  const { dir, branch, headSha } = initFixtureRepo();
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runSession: async () => fakeSessionResult() };
  const state = freshFakeGhState();
  const pr = cleanPr({ headSha });
  const gh = makeFakeGh({ prSequence: [null, pr], commits: [cleanCommit({ sha: headSha })], ciTriggered: true }, state);
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);

  const result = await runShipStage({ runner, gh, specId: branch, journal });

  expect(result.outcome).toBe("passed");
  expect(result.evidence.branch).toBe(branch);
  expect(result.evidence.localHeadSha).toBe(headSha);
  expect(result.evidence.promptVersion).toBe(SHIP_PROMPT_VERSION);
  expect(result.evidence.sessions.length).toBe(1);
  expect(result.evidence.pr).toEqual({ number: 42, url: pr.url, headSha });
  expect(result.evidence.ciTriggered).toBe(true);
  expect(result.evidence.verification?.ok).toBe(true);
  expect(result.evidence.costMicroUsd).toBe(4200);
  // One pre-session idempotency check (finds nothing yet) plus one
  // post-session outside-verification check (finds the PR /ship opened).
  expect(state.prForBranchCalls).toBe(2);

  journal.close();
});

// --- B-2 / AC-2: hook-blocked session ----------------------------------------

test("AC-2: a hook-blocked session yields blocked with the refusal tail in evidence, and outside verification is never attempted", async () => {
  const { dir, branch } = initFixtureRepo();
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runSession: async () =>
      fakeSessionResult({
        classification: {
          kind: "hook-blocked",
          resetAtMs: null,
          detail: 'matched hook-blocked pattern: "[pr-gate] BLOCKED"',
        },
        exitCode: 2,
        stderrTail: "[pr-gate] BLOCKED: gh pr create bypasses /ship's own governed sequence",
      }),
  };
  const state = freshFakeGhState();
  const gh = makeFakeGh({ prSequence: [null] }, state);
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);

  const result = await runShipStage({ runner, gh, specId: branch, journal });

  expect(result.outcome).toBe("blocked");
  expect(result.evidence.sessions.length).toBe(1);
  expect(result.evidence.sessions[0]!.classification).toBe("hook-blocked");
  expect(result.evidence.sessions[0]!.stderrTail).toContain("[pr-gate] BLOCKED");
  expect(result.evidence.verification).toBeNull();
  // Only the B-4 idempotency pre-check ran (found nothing, so the session
  // was driven); once the session came back blocked, no further GitHubClient
  // call was made: no post-session prForBranch, no commitsForPr, no
  // checksTriggered. This is the "no PR-existence check attempted" AC-2
  // requires: outside verification is never attempted in response to a
  // refusal.
  expect(state.prForBranchCalls).toBe(1);
  expect(state.commitsForPrCalls).toBe(0);
  expect(state.checksTriggeredCalls).toBe(0);

  journal.close();
});

// --- B-3: verification mismatch ----------------------------------------------

test("verification mismatch: a PR whose head sha differs from the local branch head fails with the diff in evidence", async () => {
  const { dir, branch, headSha } = initFixtureRepo();
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runSession: async () => fakeSessionResult() };
  const state = freshFakeGhState();
  const mismatchedPr = cleanPr({ headSha: "0000000000000000000000000000000000dead" });
  const gh = makeFakeGh(
    { prSequence: [null, mismatchedPr], commits: [cleanCommit({ sha: mismatchedPr.headSha })], ciTriggered: true },
    state
  );
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);

  const result = await runShipStage({ runner, gh, specId: branch, journal });

  expect(result.outcome).toBe("failed");
  expect(result.evidence.verification?.ok).toBe(false);
  expect(result.evidence.verification?.diff.some((d) => d.includes(headSha) && d.includes("does not match"))).toBe(
    true
  );

  journal.close();
});

// --- B-4: idempotency, pre-existing matching PR -------------------------------

test("idempotency: a pre-existing matching PR passes without driving a session", async () => {
  const { dir, branch, headSha } = initFixtureRepo();
  let sessionCalls = 0;
  const runner: Runner = {
    ...createProcessRunner({ repoDir: dir }),
    runSession: async () => {
      sessionCalls++;
      return fakeSessionResult();
    },
  };
  const state = freshFakeGhState();
  const pr = cleanPr({ headSha });
  const gh = makeFakeGh({ prSequence: [pr], commits: [cleanCommit({ sha: headSha })], ciTriggered: true }, state);
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);

  const result = await runShipStage({ runner, gh, specId: branch, journal });

  expect(result.outcome).toBe("passed");
  expect(result.evidence.sessions).toEqual([]);
  expect(result.evidence.promptVersion).toBeNull();
  expect(sessionCalls).toBe(0);
  expect(state.prForBranchCalls).toBe(1);

  journal.close();
});

// --- B-3: AI attribution in a commit message ----------------------------------

test("attribution violation: a commit message carrying Co-Authored-By: Claude fails verification", async () => {
  const { dir, branch, headSha } = initFixtureRepo();
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runSession: async () => fakeSessionResult() };
  const state = freshFakeGhState();
  const pr = cleanPr({ headSha });
  const badCommit = cleanCommit({
    sha: headSha,
    message: "feat: fixture feature\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
  });
  const gh = makeFakeGh({ prSequence: [null, pr], commits: [badCommit], ciTriggered: true }, state);
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);

  const result = await runShipStage({ runner, gh, specId: branch, journal });

  expect(result.outcome).toBe("failed");
  expect(result.evidence.verification?.diff.some((d) => d.includes("Co-Authored-By"))).toBe(true);

  journal.close();
});

// --- B-3: session-link URL in the PR body --------------------------------------

test("session-link violation: a PR body carrying a claude.ai/code/session URL fails verification", async () => {
  const { dir, branch, headSha } = initFixtureRepo();
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runSession: async () => fakeSessionResult() };
  const state = freshFakeGhState();
  const pr = cleanPr({ headSha, body: "## Summary\n\nSee https://claude.ai/code/session_abc123 for detail.\n" });
  const gh = makeFakeGh({ prSequence: [null, pr], commits: [cleanCommit({ sha: headSha })], ciTriggered: true }, state);
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);

  const result = await runShipStage({ runner, gh, specId: branch, journal });

  expect(result.outcome).toBe("failed");
  expect(result.evidence.verification?.diff.some((d) => d.includes("session-link"))).toBe(true);

  journal.close();
});

// --- B-3: CI not triggered -------------------------------------------------------

test("CI not triggered: a matching PR with no checks yet fails verification", async () => {
  const { dir, branch, headSha } = initFixtureRepo();
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runSession: async () => fakeSessionResult() };
  const state = freshFakeGhState();
  const pr = cleanPr({ headSha });
  const gh = makeFakeGh({ prSequence: [null, pr], commits: [cleanCommit({ sha: headSha })], ciTriggered: false }, state);
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);

  const result = await runShipStage({ runner, gh, specId: branch, journal });

  expect(result.outcome).toBe("failed");
  expect(result.evidence.verification?.diff.some((d) => d.includes("CI was not triggered"))).toBe(true);

  journal.close();
});

// --- B-3: no PR at all after the session -----------------------------------------

test("no PR opened: the session ran but no PR exists afterward, so the stage fails", async () => {
  const { dir, branch } = initFixtureRepo();
  const runner: Runner = { ...createProcessRunner({ repoDir: dir }), runSession: async () => fakeSessionResult() };
  const state = freshFakeGhState();
  const gh = makeFakeGh({ prSequence: [null, null] }, state);
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);

  const result = await runShipStage({ runner, gh, specId: branch, journal });

  expect(result.outcome).toBe("failed");
  expect(result.evidence.pr).toBeNull();
  expect(result.evidence.verification?.diff.some((d) => d.includes("no pull request found"))).toBe(true);

  journal.close();
});

// --- 122: the engine publishes -------------------------------------------------

// A fixture whose spec.md reads complete, so the ship stage's own gate can
// mint a receipt over the head the session left (122 D-5).
function initBrokeredFixture(specId: string): { dir: string; headSha: string } {
  const { dir } = initFixtureRepo(specId);
  mkdirSync(join(dir, "specs", specId), { recursive: true });
  writeFileSync(join(dir, "specs", specId, "spec.md"), `---\nid: "${specId}"\nimplementation: complete\n---\n`);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", `chore(${specId}): spec`]);
  const headSha = new TextDecoder().decode(Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: dir }).stdout).trim();
  return { dir, headSha };
}

interface RecordingBroker extends Broker {
  readonly pushes: BrokerRequest[];
  readonly opened: OpenPrRequest[];
}

function recordingBroker(refuse?: BrokerRefusal): RecordingBroker {
  const b: RecordingBroker = {
    pushes: [],
    opened: [],
    push(request) {
      if (refuse !== undefined) throw new BrokerRefusedError("push", refuse, `broker: push refused (${refuse})`);
      b.pushes.push(request);
      return { status: "done" };
    },
    openPr(request) {
      b.opened.push(request);
      return {
        status: "done",
        pr: { number: 77, url: "https://example.invalid/pr/77", headSha: request.headSha, title: request.title, body: request.body },
      };
    },
    merge() {
      throw new Error("ship.test.ts: merge is shepherd's");
    },
  };
  return b;
}

function brokeredWorld(specId: string): { dir: string; headSha: string; journal: ReturnType<typeof openJournal>; runId: string; dropboxDir: string } {
  const { dir, headSha } = initBrokeredFixture(specId);
  const { journalDir } = openHandles();
  const journal = openJournal(journalDir);
  const run = createRun(journal, dir);
  transition(journal, run, "running");
  const dropboxDir = mkdtempSync(join(tmpdir(), "ship-dropbox-"));
  return { dir, headSha, journal, runId: run.id, dropboxDir };
}

function greenRunner(dir: string, session: Runner["runSession"]): Runner {
  return {
    ...createProcessRunner({ repoDir: dir }),
    runGate: () => ({ exitCode: 0, stdoutTail: "", stderrTail: "" }),
    runSession: session,
  };
}

test("122 FR-002: a session that proposes yields one push, one PR opened by the engine, and evidence naming the receipt", async () => {
  const specId = "900-brokered-ship";
  const w = brokeredWorld(specId);
  const runner = greenRunner(w.dir, async () => {
    writeFileSync(proposalPath(w.dropboxDir, specId), JSON.stringify({ title: `feat(900): fixture`, body: "## Summary\n\n- x\n\n## Testing\n\n- y\n" }));
    return fakeSessionResult();
  });
  const broker = recordingBroker();
  const state = freshFakeGhState();
  // The PR the broker "opened" is what gh reads back for verification.
  const pr = cleanPr({ number: 77, headSha: w.headSha, title: "feat(900): fixture", body: "## Summary\n\n- x\n" });
  const gh = makeFakeGh({ prSequence: [null, pr], commits: [cleanCommit({ sha: w.headSha })], ciTriggered: true }, state);

  const result = await runShipStage({ runner, gh, specId, journal: w.journal, broker, runId: w.runId, dropboxDir: w.dropboxDir });

  expect(result.outcome).toBe("passed");
  expect(broker.pushes.length).toBe(1);
  expect(broker.opened.length).toBe(1);
  expect(broker.pushes[0]).toMatchObject({ runId: w.runId, specId, branch: specId, headSha: w.headSha });
  expect(broker.opened[0]).toMatchObject({ title: "feat(900): fixture", headSha: w.headSha });
  const receipt = latestReceipt(w.journal.fold().records, specId)!;
  expect(receipt.receipt.repo.candidateSha).toBe(w.headSha);
  expect(receipt.receipt.round).toBe(3);
  expect(broker.pushes[0]!.receiptHash).toBe(receipt.hash);
  expect(result.evidence.pr).toEqual({ number: 77, url: "https://example.invalid/pr/77", headSha: w.headSha, receiptHash: receipt.hash, brokered: true });
  expect(result.evidence.promptVersion).toBe(SHIP_PROMPT_VERSION);
  const resultRecord = w.journal.fold().byKind["stage.ship.result"]!.at(-1)!.payload as Record<string, unknown>;
  expect(resultRecord).toMatchObject({ outcome: "passed", prNumber: 77, receiptHash: receipt.hash });
  w.journal.close();
});

test("122 FR-002: no proposal is failed with the reason and no effect; a red gate is failed no-receipt with no effect", async () => {
  const specId = "900-brokered-ship";
  const w = brokeredWorld(specId);
  const broker = recordingBroker();
  const gh = makeFakeGh({ prSequence: [null] }, freshFakeGhState());

  const silent = greenRunner(w.dir, async () => fakeSessionResult());
  const noProposal = await runShipStage({ runner: silent, gh, specId, journal: w.journal, broker, runId: w.runId, dropboxDir: w.dropboxDir });
  expect(noProposal.outcome).toBe("failed");
  expect(noProposal.evidence.verification?.diff[0]).toContain("no proposal");
  expect(broker.pushes).toEqual([]);

  const red: Runner = {
    ...greenRunner(w.dir, async () => {
      writeFileSync(proposalPath(w.dropboxDir, specId), JSON.stringify({ title: "feat: x", body: "" }));
      return fakeSessionResult();
    }),
    runGate: (cmd) => ({ exitCode: cmd[1] === "lint" ? 1 : 0, stdoutTail: "", stderrTail: "L-001" }),
  };
  const redResult = await runShipStage({ runner: red, gh, specId, journal: w.journal, broker, runId: w.runId, dropboxDir: w.dropboxDir });
  expect(redResult.outcome).toBe("failed");
  expect(redResult.evidence.verification?.diff[0]).toContain("no-receipt");
  expect(redResult.evidence.verification?.diff[0]).toContain("spec-spine lint --fail-on-warn");
  expect(broker.pushes).toEqual([]);
  expect(broker.opened).toEqual([]);
  expect(latestReceipt(w.journal.fold().records, specId)).toBeNull();
  w.journal.close();
});

test("122 FR-002: a broker refusal fails the stage with the refusal in evidence", async () => {
  const specId = "900-brokered-ship";
  const w = brokeredWorld(specId);
  const runner = greenRunner(w.dir, async () => {
    writeFileSync(proposalPath(w.dropboxDir, specId), JSON.stringify({ title: "feat: x", body: "" }));
    return fakeSessionResult();
  });
  const broker = recordingBroker("lease-lost");
  const gh = makeFakeGh({ prSequence: [null] }, freshFakeGhState());
  const result = await runShipStage({ runner, gh, specId, journal: w.journal, broker, runId: w.runId, dropboxDir: w.dropboxDir });
  expect(result.outcome).toBe("failed");
  expect(result.evidence.verification?.diff[0]).toContain("lease-lost");
  expect(broker.opened).toEqual([]);
  w.journal.close();
});

