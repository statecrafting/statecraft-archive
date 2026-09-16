// Spec 124 FR-004: the fold over the evidence directory, the verdict, the
// once-per-driver journal record from the seam, and the render.

import { test, expect } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openJournal } from "./journal";
import { createProcessDriver } from "./driver";
import { renderProfile } from "./profile";
import {
  QUALIFICATION_DIR_ENV,
  parseQualificationRecord,
  qualificationFor,
  qualificationPayload,
  readQualifications,
  renderQualification,
  type QualificationRecord,
} from "./qualification";

function record(overrides: Partial<QualificationRecord> = {}): QualificationRecord {
  return {
    schemaVersion: 1,
    driver: "claude",
    binary: { path: "/usr/local/bin/claude", version: "2.1.220 (Claude Code)" },
    platform: { os: "darwin", arch: "arm64" },
    capabilities: { declared: ["tool-allowlist", "max-turns", "mcp-config", "cost", "hook-enforcement"], applied: ["cost", "hook-enforcement"], degraded: [] },
    denials: 1,
    classification: "completed",
    recordedAt: "2026-09-09T00:00:00.000Z",
    ...overrides,
  };
}

test("B-6: the fold reads one record per driver and ignores what does not parse", () => {
  const dir = mkdtempSync(join(tmpdir(), "qualification-"));
  writeFileSync(join(dir, "claude.json"), JSON.stringify(qualificationPayload(record()), null, 2));
  writeFileSync(join(dir, "codex.json"), JSON.stringify(qualificationPayload(record({ driver: "codex", binary: { path: "/x/codex", version: "codex-cli 0.153.4" } }))));
  writeFileSync(join(dir, "broken.json"), "{not json");
  writeFileSync(join(dir, "stale.json"), JSON.stringify({ schemaVersion: 0, driver: "old" }));
  writeFileSync(join(dir, "README.md"), "# evidence\n");
  const all = readQualifications(dir);
  expect([...all.keys()]).toEqual(["claude", "codex"]);
  expect(all.get("codex")!.binary.version).toBe("codex-cli 0.153.4");
  expect(parseQualificationRecord({ ...qualificationPayload(record()), denials: "one" })).toBeNull();
  expect(readQualifications(join(dir, "missing")).size).toBe(0);
});

test("B-6: qualified when the record names this binary version; an unknown version never matches", () => {
  const dir = mkdtempSync(join(tmpdir(), "qualification-"));
  writeFileSync(join(dir, "claude.json"), JSON.stringify(qualificationPayload(record())));
  expect(qualificationFor("claude", "2.1.220 (Claude Code)", dir)).toEqual({ qualified: true, record: record() });
  expect(qualificationFor("claude", "2.1.221 (Claude Code)", dir).qualified).toBe(false);
  expect(qualificationFor("claude", null, dir).qualified).toBe(false);
  expect(qualificationFor("codex", "codex-cli 0.153.4", dir)).toEqual({ qualified: false, record: null });
  expect(renderQualification({ qualified: true, record: record() })).toBe("");
  expect(renderQualification({ qualified: false, record: null })).toBe(" (unqualified)");
  expect(renderQualification(null)).toBe("");
  // The posture cell (032) takes the verdict.
  expect(renderProfile({ mode: "bypass", legacy: false, driver: "codex" }, { qualified: false, record: null })).toBe("bypass via codex (unqualified)");
  expect(renderProfile({ mode: "bypass", legacy: false, driver: "codex" }, { qualified: true, record: record() })).toBe("bypass via codex");
  expect(renderProfile({ mode: "bypass", legacy: false })).toBe("bypass");
});

test("B-6: the seam journals driver.unqualified once per driver when no record matches the binary the init named, and not at all when one does", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qualification-seam-"));
  const evidence = mkdtempSync(join(tmpdir(), "qualification-evidence-"));
  const bin = join(dir, "fake-driver.sh");
  writeFileSync(
    bin,
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "--member-manifest" ]; then',
      `  echo '{"schemaVersion":"1","name":"statecraft-driver-fake","version":"0","contract":"042","verbs":["session"],"capabilityTier":"reference","capabilities":["tool-allowlist","max-turns","mcp-config","cost","hook-enforcement"],"exitCodes":{"0":"ok"},"envelope":"ok-data"}'`,
      "  exit 0",
      "fi",
      "cat > /dev/null",
      `echo '{"event":"journal","kind":"session.init","payload":{"repo":"/r","binaryVersion":"fake 9.9"}}'`,
      `echo '{"event":"journal","kind":"session.result","payload":{"classification":"completed"}}'`,
      `echo '{"event":"result","result":{"classification":{"kind":"completed","resetAtMs":null,"detail":"ok"},"exitCode":0,"durationMs":1,"numTurns":1,"costMicroUsd":null,"usage":null,"sessionId":"s","transcriptPath":null,"overflow":{"lines":[],"truncatedCount":0},"stderrTail":"","denials":0,"denialSamples":[]}}'`,
    ].join("\n") + "\n"
  );
  chmodSync(bin, 0o755);
  const env = { ...process.env, [QUALIFICATION_DIR_ENV]: evidence } as Record<string, string>;

  // No record: journaled once across two sessions of the same driver.
  const journal = openJournal(dir, "orchestrator");
  const driver = createProcessDriver({ driverBin: bin, env });
  await driver.runSession({ repo: dir, prompt: "hi", journal });
  await driver.runSession({ repo: dir, prompt: "again", journal });
  const kinds = journal.fold().records.map((r) => r.kind);
  expect(kinds.filter((k) => k === "driver.unqualified").length).toBe(1);
  const unq = journal.fold().byKind["driver.unqualified"]![0]!.payload;
  expect(unq).toEqual({ driver: "claude", binaryVersion: "fake 9.9", recorded: null });
  journal.close();

  // A record for this version: nothing journaled.
  writeFileSync(join(evidence, "claude.json"), JSON.stringify(qualificationPayload(record({ binary: { path: bin, version: "fake 9.9" } }))));
  const dir2 = mkdtempSync(join(tmpdir(), "qualification-seam-"));
  const journal2 = openJournal(dir2, "orchestrator");
  await createProcessDriver({ driverBin: bin, env }).runSession({ repo: dir2, prompt: "hi", journal: journal2 });
  expect(journal2.fold().records.map((r) => r.kind)).toEqual(["session.init", "session.result"]);
  journal2.close();
});
