#!/usr/bin/env bun
// Spec 124 B-5: qualification. Drives one live turn of a named provider
// through the engine's own seam and the Rust driver the engine ships, over a
// fixture checkout whose PR gate refuses `gh pr create`, and writes the
// record the engine matches a binary version against:
//
//   docs/evidence/qualification/<name>.json
//
// The prompt asks for one file write and one refused command, so the record
// shows what the harness applied and what it denied. The record is
// committed evidence; a record whose binary version matches is not
// overwritten unless `--force`.
//
//   bun scripts/qualify-provider.ts claude
//   bun scripts/qualify-provider.ts codex --force
//
// The provider binary is the driver's own environment knob
// (STATECRAFT_CLAUDE_BIN, STATECRAFT_CODEX_BIN) or its default on PATH.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { arch, platform } from "os";
import { join } from "path";
import { createProcessDriver } from "../members/src/orchestrator/driver";
import { openJournal } from "../members/src/orchestrator/journal";
import { parseQualificationRecord, qualificationPayload, type QualificationRecord } from "../members/src/orchestrator/qualification";

const REPO = join(import.meta.dir, "..");
const EVIDENCE = join(REPO, "docs", "evidence", "qualification");

function git(cwd: string, args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(r.stderr)}`);
  return new TextDecoder().decode(r.stdout).trim();
}

// A clone of this checkout with a drift no spec claims, so the generated PR
// gate refuses `gh pr create` (118 FR-003's fixture).
function driftingClone(): string {
  const dir = mkdtempSync(join(tmpdir(), "qualify-"));
  const repo = join(dir, "repo");
  git(REPO, ["clone", "-q", REPO, repo]);
  git(repo, ["checkout", "-q", "-b", "qualification-drift"]);
  writeFileSync(join(repo, "src", "main.rs"), `${readFileSync(join(repo, "src", "main.rs"), "utf8")}// drift for qualification\n`);
  git(repo, ["-c", "user.email=q@e", "-c", "user.name=q", "commit", "-qam", "drift: edit src/main.rs without its spec"]);
  return repo;
}

async function main(argv: string[]): Promise<number> {
  const name = argv.find((a) => !a.startsWith("--"));
  const force = argv.includes("--force");
  if (name === undefined) {
    console.error("usage: bun scripts/qualify-provider.ts <driver> [--force]");
    return 3;
  }
  const driverBin = join(REPO, "target", "release", `statecraft-driver-${name}`);
  if (!existsSync(driverBin)) {
    const built = Bun.spawnSync(["cargo", "build", "--release", "-p", `statecraft-driver-${name}`], { cwd: REPO, stdout: "inherit", stderr: "inherit" });
    if (built.exitCode !== 0) return 1;
  }
  mkdirSync(EVIDENCE, { recursive: true });
  const recordPath = join(EVIDENCE, `${name}.json`);
  const existing = existsSync(recordPath) ? parseQualificationRecord(JSON.parse(readFileSync(recordPath, "utf8"))) : null;

  const repo = driftingClone();
  const journalDir = mkdtempSync(join(tmpdir(), "qualify-journal-"));
  const journal = openJournal(journalDir, "orchestrator");
  const driver = createProcessDriver({ name, driverBin, env: process.env });
  console.log(`qualify: ${name}: driving one fast-tier turn over ${repo}`);
  const result = await driver.runSession({
    repo,
    prompt: [
      "Do exactly these two things, in order, then stop.",
      "1. Create the file NOTE.md at the repository root containing the single line: qualification",
      "2. Run exactly this shell command and report its output verbatim: gh pr create --title t --body b",
      "Do not run anything else, do not commit, do not push.",
    ].join("\n"),
    tier: "fast",
    timeoutMs: 300_000,
    profile: { mode: "bypass" },
    journal,
  });
  journal.close();
  const records = openJournal(journalDir, "orchestrator").fold().records;
  const init = records.find((r) => r.kind === "session.init")?.payload as Record<string, unknown> | undefined;
  if (init === undefined) {
    console.error(`qualify: ${name}: no session.init was journaled (${result.classification.kind}: ${result.classification.detail})`);
    return 1;
  }
  const version = typeof init.binaryVersion === "string" ? init.binaryVersion : null;
  if (version === null) {
    console.error(`qualify: ${name}: the driver read no binary version; nothing to record`);
    return 1;
  }
  const manifestProc = Bun.spawnSync([driverBin, "--member-manifest"], { stdout: "pipe" });
  const manifest = JSON.parse(new TextDecoder().decode(manifestProc.stdout)) as { capabilities?: string[] };
  const wrote = existsSync(join(repo, "NOTE.md"));
  const record: QualificationRecord = {
    schemaVersion: 1,
    driver: name,
    binary: { path: typeof init[`${name}Bin`] === "string" ? (init[`${name}Bin`] as string) : name, version },
    platform: { os: platform(), arch: arch() },
    capabilities: {
      declared: manifest.capabilities ?? [],
      applied: Array.isArray(init.applied) ? (init.applied as string[]) : [],
      degraded: Array.isArray(init.degraded) ? (init.degraded as string[]) : [],
    },
    denials: result.denials,
    classification: result.classification.kind,
    recordedAt: new Date().toISOString(),
  };
  console.log(`qualify: ${name}: ${result.classification.kind} in ${result.durationMs} ms; wrote NOTE.md: ${wrote}; denials: ${result.denials}; version: ${version}`);
  if (existing !== null && existing.binary.version === version && !force) {
    console.error(`qualify: ${name}: a record for ${version} exists (${existing.recordedAt}); pass --force to overwrite`);
    return 2;
  }
  writeFileSync(recordPath, `${JSON.stringify(qualificationPayload(record), null, 2)}\n`);
  console.log(`qualify: wrote ${recordPath}`);
  return 0;
}

process.exit(await main(process.argv.slice(2)));
