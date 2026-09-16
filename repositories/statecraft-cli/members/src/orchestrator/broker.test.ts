// Spec 122 FR-001: the broker over a fake GitHub client and a fake git push
// seam. Each method journals intent and outcome; each refusal kind is
// exercised and performs no effect; each `already` path performs no effect
// and answers ok. Plus the production git seam over a real bare remote.

import { test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openJournal, type JournalHandle } from "./journal";
import { createRun, transition } from "./state";
import { mintReceipt, receiptPayload, RECEIPT_KIND } from "./receipt";
import {
  ACTION_KIND,
  BrokerRefusedError,
  createBroker,
  createProcessGitPush,
  holdsLease,
  REFUSED_KIND,
  type GitPush,
} from "./broker";
import type { CheckRun, GitHubClient, GitHubPr, MergeMethod, MergeOutcome } from "./stages/ship";

const SPEC = "122-x";
const HEAD = "b".repeat(40);
const BASE = "a".repeat(40);

interface World {
  readonly journal: JournalHandle;
  readonly runId: string;
  readonly receiptHash: string;
}

// A journal with one live run and one receipt covering HEAD.
function world(): World {
  const dir = mkdtempSync(join(tmpdir(), "broker-test-"));
  const journal = openJournal(dir);
  const run = createRun(journal, "/repo");
  transition(journal, run, "running");
  const receipt = mintReceipt({
    specId: SPEC,
    round: 1,
    origin: null,
    baseSha: BASE,
    candidateSha: HEAD,
    branch: SPEC,
    suite: [["spec-spine", "check", "--fail-on-warn"]],
    gate: null,
    profile: { mode: "bypass" },
    specSpineVersion: null,
    results: [{ cmd: ["spec-spine", "check", "--fail-on-warn"], exitCode: 0 }],
    changedPaths: [],
  });
  const record = journal.append(RECEIPT_KIND, receiptPayload(receipt));
  return { journal, runId: run.id, receiptHash: record.recordHash };
}

interface FakeGh {
  readonly client: GitHubClient;
  readonly created: { branch: string; title: string; body: string }[];
  readonly merges: { number: number; method: MergeMethod; head: string }[];
  pr: GitHubPr | null;
}

function fakeGh(initial: GitHubPr | null = null): FakeGh {
  const fake: FakeGh = {
    pr: initial,
    created: [],
    merges: [],
    client: {
      prForBranch: () => fake.pr,
      createPr: (branch, title, body) => {
        fake.created.push({ branch, title, body });
        fake.pr = { number: 9, url: "https://example.invalid/pr/9", headSha: HEAD, title, body, merged: false };
        return fake.pr;
      },
      commitsForPr: () => [],
      checksTriggered: () => true,
      checkRunsForSha: (): readonly CheckRun[] => [],
      jobLogTail: () => "",
      mergePr: (number: number, method: MergeMethod, head: string): MergeOutcome => {
        fake.merges.push({ number, method, head });
        return { mergeSha: "m".repeat(40) };
      },
      branchContains: () => true,
      deleteRemoteBranch: () => {},
    },
  };
  return fake;
}

interface FakeGit extends GitPush {
  remote: string | null;
  readonly pushes: string[];
}

function fakeGit(remote: string | null, ancestors: readonly string[] = []): FakeGit {
  const git: FakeGit = {
    remote,
    pushes: [],
    remoteHead: () => git.remote,
    isAncestor: (ancestor) => ancestors.includes(ancestor),
    push: (branch) => {
      git.pushes.push(branch);
      git.remote = HEAD;
    },
  };
  return git;
}

function kinds(journal: JournalHandle): string[] {
  return journal.fold().records.map((r) => r.kind);
}

function refusal(journal: JournalHandle): Record<string, unknown> | undefined {
  return journal.fold().byKind[REFUSED_KIND]?.at(-1)?.payload as Record<string, unknown> | undefined;
}

test("B-4: holdsLease is true for the project's running or paused run and false for any other run id", () => {
  const dir = mkdtempSync(join(tmpdir(), "broker-lease-"));
  const journal = openJournal(dir);
  const run = createRun(journal, "/repo");
  expect(holdsLease(journal.fold().records, run.id)).toBe(false);
  const running = transition(journal, run, "running");
  expect(holdsLease(journal.fold().records, run.id)).toBe(true);
  expect(holdsLease(journal.fold().records, "run-elsewhere")).toBe(false);
  const paused = transition(journal, running, "paused");
  expect(holdsLease(journal.fold().records, run.id)).toBe(true);
  transition(journal, transition(journal, paused, "running"), "completed");
  expect(holdsLease(journal.fold().records, run.id)).toBe(false);
  journal.close();
});

test("push: journals intent and outcome, pushes once, and answers already on a retry", () => {
  const w = world();
  const gh = fakeGh();
  const git = fakeGit(null);
  const broker = createBroker({ journal: w.journal, gh: gh.client, git });
  const request = { runId: w.runId, specId: SPEC, branch: SPEC, headSha: HEAD, receiptHash: w.receiptHash };

  expect(broker.push(request)).toEqual({ status: "done" });
  expect(git.pushes).toEqual([SPEC]);
  const actions = w.journal.fold().byKind[ACTION_KIND]!.map((r) => r.payload as Record<string, unknown>);
  expect(actions.map((a) => a.phase)).toEqual(["intent", "outcome"]);
  expect(actions[0]).toMatchObject({ action: "push", target: SPEC, headSha: HEAD, receiptHash: w.receiptHash, runId: w.runId });
  expect(actions[1]).toMatchObject({ action: "push", ok: true, detail: "pushed" });

  // A retry after a lost response: the remote is already at the head.
  expect(broker.push(request)).toEqual({ status: "already" });
  expect(git.pushes).toEqual([SPEC]);
  const again = w.journal.fold().byKind[ACTION_KIND]!.at(-1)!.payload as Record<string, unknown>;
  expect(again).toMatchObject({ phase: "outcome", ok: true, detail: "already" });
  expect(kinds(w.journal).filter((k) => k === REFUSED_KIND)).toEqual([]);
  w.journal.close();
});

test("push: a remote head that is an ancestor is pushed over; a diverged one is refused remote-diverged with no effect", () => {
  const w = world();
  const request = { runId: w.runId, specId: SPEC, branch: SPEC, headSha: HEAD, receiptHash: w.receiptHash };
  const ancestor = fakeGit(BASE, [BASE]);
  createBroker({ journal: w.journal, gh: fakeGh().client, git: ancestor }).push(request);
  expect(ancestor.pushes).toEqual([SPEC]);

  const diverged = fakeGit("c".repeat(40), []);
  const broker = createBroker({ journal: w.journal, gh: fakeGh().client, git: diverged });
  expect(() => broker.push(request)).toThrow(BrokerRefusedError);
  expect(diverged.pushes).toEqual([]);
  expect(refusal(w.journal)).toMatchObject({ action: "push", reason: "remote-diverged", headSha: HEAD });
  w.journal.close();
});

test("every action refuses lease-lost, no-receipt and receipt-mismatch before any effect", () => {
  const w = world();
  const gh = fakeGh();
  const git = fakeGit(null);
  const broker = createBroker({ journal: w.journal, gh: gh.client, git });
  const good = { runId: w.runId, specId: SPEC, branch: SPEC, headSha: HEAD, receiptHash: w.receiptHash };

  // Another run.
  expect(() => broker.push({ ...good, runId: "run-other" })).toThrow(/lease-lost/);
  expect(refusal(w.journal)).toMatchObject({ action: "push", reason: "lease-lost" });
  // A spec with no receipt.
  expect(() => broker.openPr({ ...good, specId: "122-y", title: "t", body: "" })).toThrow(/no-receipt/);
  expect(refusal(w.journal)).toMatchObject({ action: "openPr", reason: "no-receipt" });
  // A receipt hash that is not the newest.
  expect(() => broker.merge({ ...good, receiptHash: "stale", prNumber: 1, method: "squash" })).toThrow(/receipt-mismatch/);
  expect(refusal(w.journal)).toMatchObject({ action: "merge", reason: "receipt-mismatch" });
  // A head the receipt does not cover.
  expect(() => broker.push({ ...good, headSha: "d".repeat(40) })).toThrow(/receipt-mismatch/);
  expect(refusal(w.journal)).toMatchObject({ action: "push", reason: "receipt-mismatch" });

  expect(git.pushes).toEqual([]);
  expect(gh.created).toEqual([]);
  expect(gh.merges).toEqual([]);
  expect(kinds(w.journal).filter((k) => k === ACTION_KIND)).toEqual([]);
  w.journal.close();
});

test("openPr: forbidden text is refused with no effect; a clean proposal opens the PR once and is already on a retry; a moved PR head is refused", () => {
  const w = world();
  const gh = fakeGh();
  const broker = createBroker({ journal: w.journal, gh: gh.client, git: fakeGit(HEAD) });
  const base = { runId: w.runId, specId: SPEC, branch: SPEC, headSha: HEAD, receiptHash: w.receiptHash };

  expect(() => broker.openPr({ ...base, title: "feat: x", body: "Generated with a robot" })).toThrow(/forbidden-text/);
  expect(gh.created).toEqual([]);
  expect(() => broker.openPr({ ...base, title: "feat: x https://claude.ai/code/session_1", body: "" })).toThrow(/forbidden-text/);

  const opened = broker.openPr({ ...base, title: "feat(122): x", body: "## Summary\n\n- x\n" });
  expect(opened.status).toBe("done");
  expect(opened.pr.number).toBe(9);
  expect(gh.created).toEqual([{ branch: SPEC, title: "feat(122): x", body: "## Summary\n\n- x\n" }]);
  const outcome = w.journal.fold().byKind[ACTION_KIND]!.at(-1)!.payload as Record<string, unknown>;
  expect(outcome).toMatchObject({ action: "openPr", phase: "outcome", target: "#9", ok: true, detail: "opened" });

  const again = broker.openPr({ ...base, title: "feat(122): x", body: "" });
  expect(again.status).toBe("already");
  expect(gh.created.length).toBe(1);

  gh.pr = { ...gh.pr!, headSha: "e".repeat(40) };
  expect(() => broker.openPr({ ...base, title: "feat(122): x", body: "" })).toThrow(/pr-head-mismatch/);
  expect(gh.created.length).toBe(1);
  w.journal.close();
});

test("merge: consumes the receipt at the PR head, merges once with the named head, is already when merged, and refuses a moved head or a missing PR", () => {
  const w = world();
  const gh = fakeGh({ number: 4, url: "u", headSha: HEAD, title: "t", body: "", merged: false });
  const broker = createBroker({ journal: w.journal, gh: gh.client, git: fakeGit(HEAD) });
  const request = { runId: w.runId, specId: SPEC, branch: SPEC, headSha: HEAD, receiptHash: w.receiptHash, prNumber: 4, method: "squash" as const };

  const merged = broker.merge(request);
  expect(merged).toEqual({ status: "done", mergeSha: "m".repeat(40) });
  expect(gh.merges).toEqual([{ number: 4, method: "squash", head: HEAD }]);
  const outcome = w.journal.fold().byKind[ACTION_KIND]!.at(-1)!.payload as Record<string, unknown>;
  expect(outcome).toMatchObject({ action: "merge", phase: "outcome", target: "#4", ok: true });

  gh.pr = { ...gh.pr!, merged: true, mergeSha: "m".repeat(40) };
  expect(broker.merge(request)).toEqual({ status: "already", mergeSha: "m".repeat(40) });
  expect(gh.merges.length).toBe(1);

  gh.pr = { ...gh.pr!, merged: false, headSha: "e".repeat(40) };
  expect(() => broker.merge(request)).toThrow(/pr-head-mismatch/);
  gh.pr = null;
  expect(() => broker.merge(request)).toThrow(/pr-missing/);
  expect(gh.merges.length).toBe(1);
  w.journal.close();
});

test("a failed effect journals a failed outcome and rethrows", () => {
  const w = world();
  const git = fakeGit(null);
  git.push = () => {
    throw new Error("remote: permission denied");
  };
  const broker = createBroker({ journal: w.journal, gh: fakeGh().client, git });
  expect(() => broker.push({ runId: w.runId, specId: SPEC, branch: SPEC, headSha: HEAD, receiptHash: w.receiptHash })).toThrow(/permission denied/);
  const outcome = w.journal.fold().byKind[ACTION_KIND]!.at(-1)!.payload as Record<string, unknown>;
  expect(outcome).toMatchObject({ phase: "outcome", ok: false });
  expect((outcome.detail as string).includes("permission denied")).toBe(true);
  w.journal.close();
});

// Spec 129 FR-010, B-7: the push carries the one credential the broker holds,
// so no repository hook runs beside it. The control first proves the hook is
// live: a plain push runs it and is blocked by it.
test("129 FR-010: a tracked pre-push hook that exits 1 blocks a plain push, and the broker's push seam neither runs it nor is blocked", () => {
  const remote = mkdtempSync(join(tmpdir(), "broker-hooked-remote-"));
  Bun.spawnSync(["git", "init", "-q", "--bare", remote]);
  const repo = mkdtempSync(join(tmpdir(), "broker-hooked-repo-"));
  const marker = join(mkdtempSync(join(tmpdir(), "broker-hooked-marker-")), "pre-push-ran.txt");
  const g = (args: string[]): { exitCode: number; stdout: string } => {
    const r = Bun.spawnSync(["git", ...args], { cwd: repo });
    return { exitCode: r.exitCode, stdout: new TextDecoder().decode(r.stdout).trim() };
  };
  const must = (args: string[]): string => {
    const r = g(args);
    if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`);
    return r.stdout;
  };
  must(["init", "-q", "-b", "main"]);
  must(["config", "user.email", "t@example.com"]);
  must(["config", "user.name", "t"]);
  must(["remote", "add", "origin", remote]);
  mkdirSync(join(repo, ".githooks"), { recursive: true });
  writeFileSync(join(repo, ".githooks", "pre-push"), `#!/bin/sh
env > ${JSON.stringify(marker)}
exit 1
`, { mode: 0o755 });
  writeFileSync(join(repo, "a.txt"), "a\n");
  must(["add", "-A"]);
  must(["commit", "-q", "-m", "one"]);
  must(["config", "core.hooksPath", ".githooks"]);
  must(["checkout", "-q", "-b", "129-x"]);
  const head = must(["rev-parse", "HEAD"]);

  // The control: the hook runs, records its environment, and blocks the push.
  expect(g(["push", "-q", "origin", "129-x"]).exitCode).not.toBe(0);
  expect(existsSync(marker)).toBe(true);
  rmSync(marker);

  const seam = createProcessGitPush(() => repo);
  expect(seam.remoteHead("129-x")).toBeNull();
  seam.push("129-x");
  expect(existsSync(marker)).toBe(false);
  expect(seam.remoteHead("129-x")).toBe(head);
});

test("B-3: the production git seam pushes to a real bare remote and reads its head back", () => {
  const remote = mkdtempSync(join(tmpdir(), "broker-remote-"));
  Bun.spawnSync(["git", "init", "-q", "--bare", remote]);
  const repo = mkdtempSync(join(tmpdir(), "broker-repo-"));
  const g = (args: string[]): string => {
    const r = Bun.spawnSync(["git", ...args], { cwd: repo });
    if (r.exitCode !== 0) throw new Error(new TextDecoder().decode(r.stderr));
    return new TextDecoder().decode(r.stdout).trim();
  };
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.email", "t@example.com"]);
  g(["config", "user.name", "t"]);
  g(["remote", "add", "origin", remote]);
  writeFileSync(join(repo, "a.txt"), "a\n");
  g(["add", "-A"]);
  g(["commit", "-q", "-m", "one"]);
  const first = g(["rev-parse", "HEAD"]);
  g(["checkout", "-q", "-b", "122-x"]);
  const seam = createProcessGitPush(() => repo);
  expect(seam.remoteHead("122-x")).toBeNull();
  seam.push("122-x");
  expect(seam.remoteHead("122-x")).toBe(first);
  writeFileSync(join(repo, "b.txt"), "b\n");
  g(["add", "-A"]);
  g(["commit", "-q", "-m", "two"]);
  const second = g(["rev-parse", "HEAD"]);
  expect(seam.isAncestor(first, second)).toBe(true);
  expect(seam.isAncestor(second, first)).toBe(false);
  seam.push("122-x");
  expect(seam.remoteHead("122-x")).toBe(second);
});
