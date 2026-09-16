// Spec 123 FR-005: the capsule over a fixture journal carries the receipt,
// the decisions in scope, the last red gate, the allowance and the prior
// sessions; the render respects its budget and trims the tails first.

import { test, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openJournal } from "./journal";
import { openDecisionsChain } from "./decisions";
import { createRun, createSpecExec, transition } from "./state";
import { mintReceipt, receiptPayload, RECEIPT_KIND } from "./receipt";
import { buildCapsule, capsulePayload, renderCapsule, CAPSULE_SCHEMA_VERSION } from "./handoff";

const SPEC = "123-x";

function world(): { journalDir: string } {
  return { journalDir: mkdtempSync(join(tmpdir(), "handoff-test-")) };
}

test("B-5: the capsule folds every field from the chains and nothing from a transcript", () => {
  const { journalDir } = world();
  const journal = openJournal(journalDir);
  const decisions = openDecisionsChain(journalDir);
  const run = transition(journal, createRun(journal, "/repo"), "running");
  createSpecExec(journal, run.id, SPEC, "pin-123");
  journal.append("stage.build.bracket", { specId: SPEC, branch: SPEC, reused: false, flipped: true, headSha: "h0", baseSha: "b0" });
  journal.append("session.init", { repo: "/repo", profile: { mode: "guarded", driver: "codex", require: null }, applied: [], degraded: [] });
  journal.append("session.result", { classification: "completed", denials: 2, costMicroUsd: null });
  journal.append("stage.build.gate", {
    specId: SPEC,
    round: 1,
    baseSha: "b0",
    gates: [
      { cmd: ["spec-spine", "check", "--fail-on-warn"], exitCode: 0, stdoutTail: "", stderrTail: "" },
      { cmd: ["make", "ci"], exitCode: 2, stdoutTail: "", stderrTail: "tests: 1 failed\nat x.ts:1" },
    ],
    frontmatterComplete: true,
  });
  journal.append("session.init", { repo: "/repo", profile: { mode: "guarded", driver: "claude", require: null }, applied: [], degraded: [] });
  journal.append("session.result", { classification: "completed", denials: 0, costMicroUsd: 1500 });
  const receipt = mintReceipt({
    specId: SPEC,
    round: 2,
    origin: null,
    baseSha: "b0",
    candidateSha: "h2",
    branch: SPEC,
    suite: [],
    gate: null,
    profile: { mode: "guarded" },
    specSpineVersion: null,
    results: [],
    changedPaths: ["Makefile"],
  });
  const receiptRecord = journal.append(RECEIPT_KIND, receiptPayload(receipt));
  journal.append("stage.build.gate", { specId: SPEC, round: 2, baseSha: "b0", gates: [{ cmd: ["make", "ci"], exitCode: 0, stdoutTail: "", stderrTail: "" }], frontmatterComplete: true });
  decisions.append("decision.sealed", { id: "d-1", specId: SPEC, scope: [SPEC], title: "Use X", decision: "We use X", rationale: "because" });
  decisions.append("decision.sealed", { id: "d-2", specId: "999-other", scope: ["999-other"], title: "Elsewhere", decision: "No", rationale: "no" });

  const capsule = buildCapsule({
    records: journal.fold().records,
    decisions: decisions.fold().records,
    specId: SPEC,
    project: { name: "alpha", origin: "git@example.invalid:o/r.git" },
    ceiling: { perRunMicroUsd: 5_000_000 },
    nowMs: Date.now(),
  });
  journal.close();
  decisions.close();

  expect(capsule.schemaVersion).toBe(CAPSULE_SCHEMA_VERSION);
  expect(capsule.project).toEqual({ name: "alpha", origin: "git@example.invalid:o/r.git" });
  expect(capsule.spec).toEqual({ id: SPEC, pin: "pin-123" });
  // The receipt's candidate sha is the head the capsule names.
  expect(capsule.candidate).toEqual({ branch: SPEC, baseSha: "b0", headSha: "h2" });
  expect(capsule.policy.digest).toBe(receipt.policy.digest);
  expect(capsule.profile).toEqual({ mode: "guarded", driver: "claude", require: null });
  expect(capsule.receipt).toEqual({ hash: receiptRecord.recordHash, candidateSha: "h2", round: 2, sensitivePaths: ["Makefile"] });
  expect(capsule.decisions.map((d) => d.id)).toEqual(["d-1"]);
  // The last gate was green: nothing outstanding.
  expect(capsule.outstanding).toEqual([]);
  expect(capsule.allowance.ceiling).toEqual({ perRunMicroUsd: 5_000_000 });
  expect(capsule.allowance.run).toMatchObject({ knownMicroUsd: 1500, costKnownSessions: 1, costUnknownSessions: 1 });
  expect(capsule.sessions).toEqual([
    { driver: "codex", classification: "completed", denials: 2, costMicroUsd: null },
    { driver: "claude", classification: "completed", denials: 0, costMicroUsd: 1500 },
  ]);
  // The payload is plain JSON.
  expect(JSON.parse(JSON.stringify(capsulePayload(capsule)))).toEqual(capsulePayload(capsule));
});

test("B-5: the outstanding diagnostics are the last red gate's failing commands", () => {
  const { journalDir } = world();
  const journal = openJournal(journalDir);
  journal.append("stage.build.gate", {
    specId: SPEC,
    round: 1,
    baseSha: "b0",
    gates: [{ cmd: ["make", "ci"], exitCode: 2, stdoutTail: "", stderrTail: "boom" }],
    frontmatterComplete: false,
  });
  const capsule = buildCapsule({ records: journal.fold().records, specId: SPEC, project: { name: "alpha", origin: null } });
  journal.close();
  expect(capsule.outstanding).toEqual([{ cmd: ["make", "ci"], exitCode: 2, stderrTail: "boom" }]);
  expect(capsule.candidate).toBeNull();
  expect(capsule.receipt).toBeNull();
  expect(capsule.spec.pin).toBeNull();
  const text = renderCapsule(capsule);
  expect(text).toContain("## Handoff capsule");
  expect(text).toContain("candidate: none yet");
  expect(text).toContain("receipt: none");
  expect(text).toContain("`make ci` exited 2");
  expect(text).toContain("boom");
  expect(text).toContain("decisions: none in scope");
});

test("B-5: the render respects its budget, trimming the tails first and the rationales second", () => {
  const { journalDir } = world();
  const journal = openJournal(journalDir);
  const decisions = openDecisionsChain(journalDir);
  const huge = "x".repeat(20_000);
  journal.append("stage.build.gate", { specId: SPEC, round: 1, baseSha: "b0", gates: [{ cmd: ["make", "ci"], exitCode: 1, stdoutTail: "", stderrTail: huge }], frontmatterComplete: false });
  decisions.append("decision.sealed", { id: "d-1", specId: SPEC, scope: [SPEC], title: "Use X", decision: "y".repeat(3000), rationale: "r" });
  const capsule = buildCapsule({ records: journal.fold().records, decisions: decisions.fold().records, specId: SPEC, project: { name: "alpha", origin: null } });
  journal.close();
  decisions.close();
  const full = renderCapsule(capsule, 1_000_000);
  expect(full).toContain(huge);
  const bounded = renderCapsule(capsule);
  expect(bounded.length).toBeLessThanOrEqual(12_000);
  expect(bounded).not.toContain(huge);
  expect(bounded).toContain("`make ci` exited 1");
  expect(bounded).toContain("d-1 (123-x): Use X");
  // Tails go before rationales: the decision text survives at this size.
  expect(bounded).toContain("y".repeat(3000));
  const tight = renderCapsule(capsule, 900);
  expect(tight.length).toBeLessThanOrEqual(900);
  expect(tight).toContain("d-1 (123-x): Use X");
  expect(tight).not.toContain("y".repeat(3000));
});
