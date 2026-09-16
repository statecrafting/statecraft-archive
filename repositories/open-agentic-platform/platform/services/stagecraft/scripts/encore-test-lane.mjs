#!/usr/bin/env node
// Spec: 211-encore-test-ci-job
//
// Lane-coverage guard for the encore-test CI lane (FR-003: skip-as-pass
// forbidden). The statecraft suite is partitioned by vite.config.ts into
// two lanes: pure suites run under bare vitest (npm test / ci-statecraft),
// DB-bound suites — excluded under bare vitest — run only under
// `encore test`. This script makes that partition mechanically checkable:
//
//   list                       Derive the DB-bound file set (bare-vitest
//                              exclude minus the universal both-lane
//                              excludes) from vite.config.ts and print one
//                              existing file path per line. A glob that
//                              matches no file on disk is a failure naming
//                              the glob — a deleted/renamed suite cannot
//                              linger as a phantom exclude entry.
//
//   check --report <path>      Cross-check a vitest JSON reporter output
//                              (from the `encore test` run) against the
//                              derived set: every DB-bound file must appear
//                              with at least one executed (non-skipped)
//                              test. A DB-bound file skipped in both lanes
//                              is a failure naming the file.
//
// Both modes also assert the encore-side exclude list is exactly the
// universal set below. Adding an entry there would silently remove a file
// from BOTH lanes (the AC-2 leak); forcing an edit to this allowlist makes
// that a visible, reviewable diff instead.
//
// This parses vite.config.ts as authored text on purpose: the exclude
// list IS the lane assignment (owned by the suites' specs / spec 201),
// and the guard must read the same artifact vitest does, not a copy.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const SERVICE_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const VITE_CONFIG = path.join(SERVICE_ROOT, "vite.config.ts");

// The only entries allowed to be excluded from BOTH lanes (build noise).
// (The Encore template's check.test.ts was removed with the uptime-monitor
// tutorial code, so spec 211 FR-001's "full suite minus check.test.ts"
// framing no longer has a file to exclude.)
const UNIVERSAL_EXCLUDES = [
  "**/node_modules/**",
  "**/dist/**",
];

// Directories never walked when resolving globs to files.
const WALK_SKIP = new Set([
  "node_modules",
  "dist",
  "build",
  "encore.gen",
  ".git",
]);

function fail(msg) {
  console.error(`encore-test-lane: ${msg}`);
  process.exit(1);
}

function extractExcludeArrays(source) {
  // Matches the conditional exclude in vite.config.ts:
  //   exclude: hasEncoreRuntime ? [ ...encore lane... ] : [ ...bare lane... ]
  const m = source.match(
    /exclude:\s*hasEncoreRuntime\s*\?\s*\[([\s\S]*?)\]\s*:\s*\[([\s\S]*?)\]/,
  );
  if (!m) {
    fail(
      "could not locate `exclude: hasEncoreRuntime ? [...] : [...]` in vite.config.ts — " +
        "the lane structure changed; update scripts/encore-test-lane.mjs to match",
    );
  }
  const strings = (s) => [...s.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  return { encoreLane: strings(m[1]), bareLane: strings(m[2]) };
}

function assertLanePartition(encoreLane) {
  const extra = encoreLane.filter((g) => !UNIVERSAL_EXCLUDES.includes(g));
  const missing = UNIVERSAL_EXCLUDES.filter((g) => !encoreLane.includes(g));
  if (extra.length > 0) {
    fail(
      `encore-lane exclude list contains non-universal entries: ${extra.join(", ")}.\n` +
        "  Excluding a file under `encore test` removes it from BOTH lanes — " +
        "a DB-bound suite would silently stop running anywhere (spec 211 AC-2).\n" +
        "  If a file genuinely belongs in neither lane, add it to UNIVERSAL_EXCLUDES " +
        "in scripts/encore-test-lane.mjs with its rationale, in the same change.",
    );
  }
  if (missing.length > 0) {
    fail(
      `encore-lane exclude list lost universal entries: ${missing.join(", ")} — ` +
        "vite.config.ts and scripts/encore-test-lane.mjs disagree on the universal set",
    );
  }
}

function dbBoundGlobs() {
  const source = fs.readFileSync(VITE_CONFIG, "utf8");
  const { encoreLane, bareLane } = extractExcludeArrays(source);
  assertLanePartition(encoreLane);
  const globs = bareLane.filter((g) => !UNIVERSAL_EXCLUDES.includes(g));
  if (globs.length === 0) {
    fail("derived zero DB-bound globs from vite.config.ts — parse drift?");
  }
  for (const g of globs) {
    if (!g.startsWith("**/") || /[*?[\]{}]/.test(g.slice(3))) {
      fail(
        `unsupported exclude glob shape: ${g} — this guard only understands ` +
          "`**/<literal-path-suffix>` entries; extend it before using richer globs",
      );
    }
  }
  return globs;
}

function walkTestFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!WALK_SKIP.has(entry.name)) walkTestFiles(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith(".test.ts")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function resolveGlobs(globs) {
  const all = walkTestFiles(SERVICE_ROOT, []);
  const resolved = new Map(); // glob -> relative file paths
  const phantoms = [];
  for (const g of globs) {
    const suffix = g.slice(2); // "**/x" -> "/x"
    const hits = all
      .filter((f) => f.endsWith(suffix))
      .map((f) => path.relative(SERVICE_ROOT, f));
    if (hits.length === 0) phantoms.push(g);
    else resolved.set(g, hits);
  }
  if (phantoms.length > 0) {
    fail(
      `exclude-list globs match no file on disk:\n  ${phantoms.join("\n  ")}\n` +
        "  The suite was deleted or renamed without updating the vite.config.ts " +
        "exclude list — fix the list (and this lane) in the same change.",
    );
  }
  return resolved;
}

function cmdList() {
  const resolved = resolveGlobs(dbBoundGlobs());
  const files = [...resolved.values()].flat().sort();
  for (const f of files) console.log(f);
  console.error(`encore-test-lane: ${files.length} DB-bound files resolved`);
}

function cmdCheck(reportPath) {
  if (!reportPath) fail("check requires --report <vitest-json-report>");
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch (e) {
    fail(`cannot read report ${reportPath}: ${e.message}`);
  }
  if (!Array.isArray(report.testResults)) {
    fail(`report ${reportPath} has no testResults[] — not a vitest JSON report?`);
  }
  const executedByFile = new Map(); // relative path -> executed (non-skipped) count
  const failedFiles = [];
  for (const tr of report.testResults) {
    const rel = path.relative(SERVICE_ROOT, tr.name);
    const executed = (tr.assertionResults ?? []).filter(
      (a) => a.status !== "skipped" && a.status !== "pending" && a.status !== "todo",
    ).length;
    executedByFile.set(rel, executed);
    if (tr.status !== "passed") failedFiles.push(rel);
  }

  const resolved = resolveGlobs(dbBoundGlobs());
  const missing = [];
  const skippedOnly = [];
  let covered = 0;
  for (const [glob, files] of resolved) {
    for (const f of files) {
      if (!executedByFile.has(f)) missing.push(`${f}  (from ${glob})`);
      else if (executedByFile.get(f) === 0) skippedOnly.push(f);
      else covered += 1;
    }
  }
  const problems = [];
  if (missing.length > 0) {
    problems.push(`DB-bound files never executed in the encore lane:\n  ${missing.join("\n  ")}`);
  }
  if (skippedOnly.length > 0) {
    problems.push(
      `DB-bound files ran zero non-skipped tests (hook failure or skip-as-pass):\n  ${skippedOnly.join("\n  ")}`,
    );
  }
  if (failedFiles.length > 0) {
    problems.push(`files failed in the encore lane:\n  ${failedFiles.join("\n  ")}`);
  }
  if (report.success !== true) {
    problems.push(`report.success is ${report.success} — the encore test run did not pass`);
  }
  if (problems.length > 0) fail(problems.join("\n"));
  console.log(
    `encore-test-lane: coverage OK — ${covered} DB-bound files all executed in the encore lane`,
  );
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "list":
    cmdList();
    break;
  case "check": {
    const i = rest.indexOf("--report");
    cmdCheck(i >= 0 ? rest[i + 1] : undefined);
    break;
  }
  default:
    fail("usage: encore-test-lane.mjs <list | check --report <json>>");
}
