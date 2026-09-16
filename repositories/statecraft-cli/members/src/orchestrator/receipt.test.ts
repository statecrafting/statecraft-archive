// Spec 121 FR-003: the receipt's digests are stable under key order, the
// policy-sensitive filter is a prefix match, the newest passing receipt per
// spec folds back, and coverage is a sha equality.

import { test, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openJournal } from "./journal";
import {
  latestReceipt,
  mintReceipt,
  parseReceipt,
  policyDigest,
  receiptCovers,
  receiptPayload,
  RECEIPT_KIND,
  sensitivePathsOf,
  suiteDigest,
  type MintReceiptInput,
} from "./receipt";

function input(overrides: Partial<MintReceiptInput> = {}): MintReceiptInput {
  return {
    specId: "121-x",
    round: 1,
    origin: "git@example.invalid:o/r.git",
    baseSha: "a".repeat(40),
    candidateSha: "b".repeat(40),
    branch: "121-x",
    suite: [
      ["spec-spine", "check", "--fail-on-warn"],
      ["make", "ci"],
    ],
    gate: { commands: [["make", "ci"]], source: "probe", rule: "make-ci" },
    profile: { mode: "guarded", allowedTools: null, disallowedTools: null, models: null, driver: "codex", require: null },
    specSpineVersion: "spec-spine 0.18.0",
    results: [
      { cmd: ["spec-spine", "check", "--fail-on-warn"], exitCode: 0 },
      { cmd: ["make", "ci"], exitCode: 0 },
    ],
    changedPaths: ["src/a.ts", "Makefile", ".github/workflows/ci.yml", "docs/x.md", "scripts/gen.py"],
    ...overrides,
  };
}

test("B-5: the digests are stable under key order and change with content", () => {
  expect(policyDigest({ a: 1, b: 2 }, { mode: "bypass" })).toBe(policyDigest({ b: 2, a: 1 }, { mode: "bypass" }));
  expect(policyDigest({ a: 1 }, { mode: "bypass" })).not.toBe(policyDigest({ a: 1 }, { mode: "guarded" }));
  expect(suiteDigest([["a"], ["b"]])).not.toBe(suiteDigest([["b"], ["a"]]));
  const r = mintReceipt(input());
  expect(r.suite.digest).toBe(suiteDigest(input().suite));
  expect(r.policy.digest).toBe(policyDigest(input().gate, input().profile));
});

test("B-5: sensitivePaths filters by the policy-sensitive prefixes", () => {
  expect(sensitivePathsOf(input().changedPaths)).toEqual(["Makefile", ".github/workflows/ci.yml", "scripts/gen.py"]);
  expect(sensitivePathsOf(["Makefile.bak", "src/Makefile", "standards/spec/x.md", "spec-spine.toml"])).toEqual([
    "standards/spec/x.md",
    "spec-spine.toml",
  ]);
  expect(mintReceipt(input()).sensitivePaths).toEqual(["Makefile", ".github/workflows/ci.yml", "scripts/gen.py"]);
});

test("B-5: a red command mints no receipt", () => {
  expect(() => mintReceipt(input({ results: [{ cmd: ["make", "ci"], exitCode: 2 }] }))).toThrow(/red command mints no receipt/);
});

test("B-6: the payload round-trips through parseReceipt; a malformed record is null", () => {
  const r = mintReceipt(input());
  expect(parseReceipt(receiptPayload(r))).toEqual(r);
  expect(parseReceipt({ schemaVersion: 1, specId: "x" })).toBeNull();
  expect(parseReceipt("nope")).toBeNull();
  expect(parseReceipt({ ...receiptPayload(r), passing: false })).toBeNull();
});

test("B-6: latestReceipt picks the newest receipt per spec by chain order, and receiptCovers is a sha equality", () => {
  const dir = mkdtempSync(join(tmpdir(), "receipt-journal-"));
  const journal = openJournal(dir);
  const first = mintReceipt(input({ round: 1, candidateSha: "1".repeat(40) }));
  const other = mintReceipt(input({ specId: "121-y", candidateSha: "9".repeat(40) }));
  const second = mintReceipt(input({ round: 2, candidateSha: "2".repeat(40) }));
  journal.append(RECEIPT_KIND, receiptPayload(first));
  journal.append(RECEIPT_KIND, receiptPayload(other));
  journal.append("stage.build.result", { specId: "121-x" });
  journal.append(RECEIPT_KIND, receiptPayload(second));
  const records = journal.fold().records;
  journal.close();

  const latest = latestReceipt(records, "121-x");
  expect(latest).not.toBeNull();
  expect(latest!.receipt).toEqual(second);
  expect(latest!.hash).toBe(records.at(-1)!.recordHash);
  expect(latestReceipt(records, "121-y")!.receipt).toEqual(other);
  expect(latestReceipt(records, "121-z")).toBeNull();
  expect(receiptCovers(second, "2".repeat(40))).toBe(true);
  expect(receiptCovers(second, "1".repeat(40))).toBe(false);
});
