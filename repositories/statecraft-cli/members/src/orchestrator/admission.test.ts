// Spec 119 FR-005: the three corrections, driven end to end through the
// stage seams over a real fixture repository: the floor is judged against a
// base resolved to a commit and journaled; a session that was refused once
// and then completed leaves its denial in the evidence beside a completed
// classification; a merge is refused when the head moved after the green
// watch. A fake driver stands in for the harness and a fake GitHub client
// for the remote; git is real.

import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openJournal, type JournalRecord } from "./journal";
import { openDecisionsChain } from "./decisions";
import type { Driver, DriverSessionRequest, SessionResult } from "./driver";
import { createProcessRunner, runBuildStage, type Runner } from "./stages/build";
import { runShepherdStage, type Clock } from "./stages/shepherd";
import { MergeRefusedError, type CheckRun, type GitHubClient, type GitHubPr, type MergeMethod, type MergeOutcome } from "./stages/ship";

function git(dir: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: dir });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
  return new TextDecoder().decode(result.stdout).trim();
}

const SPEC_ID = "900-admission-fixture";

function initFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "admission-test-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  mkdirSync(join(dir, "specs", SPEC_ID), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), "# AGENTS.md\n\n## Working the backlog\n\n1. Build it.\n\n## Other\n");
  writeFileSync(
    join(dir, "specs", SPEC_ID, "spec.md"),
    `---\nid: "${SPEC_ID}"\ntitle: "Fixture"\nstatus: approved\nimplementation: pending\ndepends_on: []\nestablishes:\n  - "src/example.ts"\n---\n\n# ${SPEC_ID}\n`
  );
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "chore: fixture base"]);
  return dir;
}

// A driver that is refused once, finishes its work, and reports both: the
// shape 119 B-5 gives a hook refusal followed by a completed turn.
function denyingDriver(dir: string): Driver {
  return {
    name: "fake",
    tier: async () => "reference",
    async runSession(request: DriverSessionRequest): Promise<SessionResult> {
      writeFileSync(join(dir, "src", "example.ts"), "export const example = 1;\n");
      const specPath = join(dir, "specs", SPEC_ID, "spec.md");
      writeFileSync(specPath, readFileSync(specPath, "utf8").replace("implementation: in-progress", "implementation: complete"));
      git(dir, ["add", "-A"]);
      git(dir, ["commit", "-q", "-m", "feat: fixture work"]);
      request.journal?.append("session.result", { classification: "completed", denials: 1 });
      return {
        classification: { kind: "completed", resetAtMs: null, detail: "result event reported is_error: false" },
        exitCode: 0,
        durationMs: 3,
        numTurns: 2,
        costMicroUsd: 10,
        usage: null,
        sessionId: "sess-denied-once",
        transcriptPath: null,
        overflow: { lines: [], truncatedCount: 0 },
        stderrTail: "",
        denials: 1,
        denialSamples: ["Bash operation blocked by hook: [pr-gate] BLOCKED: stale shards"],
      };
    },
    killLiveSession: () => false,
  };
}

function payloadsOf(records: JournalRecord[] | undefined): Record<string, unknown>[] {
  return (records ?? []).map((r) => r.payload as Record<string, unknown>);
}

test("119 FR-005: a build round judges the floor at a resolved base and keeps the denial beside a completed session", async () => {
  const dir = initFixtureRepo();
  const asked: string[][] = [];
  const process = createProcessRunner({ repoDir: dir, driver: denyingDriver(dir) });
  const runner: Runner = {
    ...process,
    runGate: (cmd) => {
      asked.push([...cmd]);
      return { exitCode: 0, stdoutTail: "", stderrTail: "" };
    },
  };
  const baseSha = git(dir, ["rev-parse", "main"]);
  const journalDir = mkdtempSync(join(tmpdir(), "admission-journal-"));
  const journal = openJournal(journalDir);
  const decisionsChain = openDecisionsChain(journalDir);

  const result = await runBuildStage({
    runner,
    specId: SPEC_ID,
    journal,
    decisionsChain,
    dropboxDir: join(journalDir, "decision-dropbox"),
    knownSpecIds: new Set([SPEC_ID]),
    isSpecReady: () => true,
  });

  expect(result.outcome).toBe("passed");
  // The floor ran read-only, twice (preflight and post-session), against the
  // commit the base resolved to; regeneration appears only in the bracket.
  const couples = asked.filter((cmd) => cmd[1] === "couple");
  expect(couples.length).toBe(2);
  for (const cmd of couples) expect(cmd).toEqual(["spec-spine", "couple", "--base", baseSha, "--head", "HEAD"]);
  expect(asked.filter((cmd) => cmd[1] === "check").length).toBe(2);
  expect(asked.filter((cmd) => cmd.join(" ") === "spec-spine compile").length).toBe(1);
  expect(asked.filter((cmd) => cmd.join(" ") === "spec-spine index").length).toBe(1);

  const folded = journal.fold().byKind;
  expect(payloadsOf(folded["stage.build.bracket"])[0]!.baseSha).toBe(baseSha);
  const gate = payloadsOf(folded["stage.build.gate"]);
  expect(gate.length).toBe(1);
  expect(gate[0]!.baseSha).toBe(baseSha);

  // The denial is evidence, and the classification is untouched.
  const denials = payloadsOf(folded["stage.build.denials"]);
  expect(denials.length).toBe(1);
  expect(denials[0]).toMatchObject({ specId: SPEC_ID, round: 1, sessionId: "sess-denied-once", denials: 1 });
  expect((denials[0]!.samples as string[])[0]).toContain("[pr-gate] BLOCKED");
  expect(result.evidence.sessions.length).toBe(1);
  expect(result.evidence.sessions[0]!.classification).toBe("completed");
  expect(result.evidence.sessions[0]!.denials).toBe(1);
  expect(payloadsOf(folded["stage.build.result"])[0]!.denials).toBe(1);

  journal.close();
  decisionsChain.close();
});

function fakeClock(): Clock {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };
}

test("119 FR-005: shepherd refuses to merge a head that moved after the green watch, and names both shas", async () => {
  const dir = initFixtureRepo();
  git(dir, ["checkout", "-q", "-b", SPEC_ID]);
  const runner: Runner = createProcessRunner({ repoDir: dir, driver: denyingDriver(dir) });
  const journalDir = mkdtempSync(join(tmpdir(), "admission-journal-"));
  const journal = openJournal(journalDir);

  const watched: GitHubPr = { number: 7, url: "https://example.invalid/pr/7", headSha: "sha-watched", title: "feat(900): fixture", body: "" };
  const moved: GitHubPr = { ...watched, headSha: "sha-moved" };
  let reads = 0;
  const mergeCalls: { number: number; method: MergeMethod; head: string }[] = [];
  const gh: GitHubClient = {
    prForBranch: () => (reads++ === 0 ? watched : moved),
    createPr: () => {
      throw new Error("admission test: createPr is not exercised here");
    },
    commitsForPr: () => [],
    checksTriggered: () => true,
    checkRunsForSha: (sha: string): readonly CheckRun[] =>
      sha === "sha-watched" ? [{ id: 1, name: "govern", status: "completed", conclusion: "success", required: true }] : [],
    jobLogTail: () => "",
    mergePr: (number: number, method: MergeMethod, head: string): MergeOutcome => {
      mergeCalls.push({ number, method, head });
      throw new MergeRefusedError(head, "HTTP 409: Head branch was modified. Review and try the merge again.");
    },
    branchContains: () => true,
    deleteRemoteBranch: () => {},
  };

  const result = await runShepherdStage({ runner, gh, specId: SPEC_ID, journal, clock: fakeClock() });

  expect(result.outcome).toBe("failed");
  expect(result.evidence.needsHuman).toBe(true);
  expect(result.evidence.mergeSha).toBeNull();
  // The head moved between the green watch and the merge: refused before
  // any merge call.
  expect(mergeCalls).toEqual([]);
  const refused = payloadsOf(journal.fold().byKind["stage.shepherd.merge-refused"]);
  expect(refused.length).toBe(1);
  expect(refused[0]).toMatchObject({ specId: SPEC_ID, prNumber: 7, watchedSha: "sha-watched", currentSha: "sha-moved" });

  journal.close();
});
