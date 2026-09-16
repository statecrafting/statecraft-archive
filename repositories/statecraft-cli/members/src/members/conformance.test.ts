// Spec 124 FR-002: every case passes over the fixture driver; over each
// discoverable real driver with faked binaries (a real driver that cannot
// be discovered is skipped, never failed); and a deliberately broken fixture
// fails exactly the case it breaks, so the suite cannot pass vacuously.

import { test, expect } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";
import { CONFORMANCE_CASE_NAMES, claudeTarget, codexTarget, fixtureTarget, renderReport, runConformance } from "./conformance";
import { FIXTURE_BREAK_ENV } from "./driver-fixture";

const REPO = join(import.meta.dir, "..", "..", "..");
const CLAUDE_BIN = join(REPO, "target", "release", "statecraft-driver-claude");
const CODEX_BIN = join(REPO, "target", "release", "statecraft-driver-codex");

// The fixture driver resolves from source (043 B-5's checkout fallback):
// nothing on PATH, no managed directory, no explicit binary.
function fixtureEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  delete env.STATECRAFT_DRIVER_BIN;
  env.STATECRAFT_MEMBER_DIR = join(REPO, "members", "nonexistent-members");
  env.PATH = "/usr/bin:/bin";
  return env;
}

async function run(cmd: string[]): Promise<number> {
  const proc = Bun.spawn(cmd, { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  return proc.exited;
}

test("the Rust drivers build (release), so the suite runs the binaries the engine ships", async () => {
  expect(await run(["cargo", "build", "--release", "-p", "statecraft-driver-claude", "-p", "statecraft-driver-codex"])).toBe(0);
}, 600_000);

test("B-3: every case passes over the fixture driver", async () => {
  const report = await runConformance(fixtureTarget(fixtureEnv()));
  expect(renderReport(report)).toBe("conformance: fixture: 7 passed, 0 failed");
  expect([...report.passed]).toEqual([...CONFORMANCE_CASE_NAMES]);
}, 60_000);

test("B-3: every case passes over the Claude driver with a faked provider per case", async () => {
  if (!existsSync(CLAUDE_BIN)) {
    console.log("conformance: statecraft-driver-claude not built; skipped");
    return;
  }
  const report = await runConformance(claudeTarget({ ...(process.env as Record<string, string>), STATECRAFT_DRIVER_BIN: CLAUDE_BIN }));
  expect(renderReport(report)).toBe("conformance: claude: 7 passed, 0 failed");
}, 60_000);

test("B-3: every case passes over the Codex driver with a faked provider per case", async () => {
  if (!existsSync(CODEX_BIN)) {
    console.log("conformance: statecraft-driver-codex not built; skipped");
    return;
  }
  const report = await runConformance(codexTarget({ ...(process.env as Record<string, string>), STATECRAFT_DRIVER_BIN: CODEX_BIN }));
  expect(renderReport(report)).toBe("conformance: codex: 7 passed, 0 failed");
}, 60_000);

test("FR-002: a deliberately broken fixture fails exactly the case it breaks", async () => {
  for (const broken of ["denial-retained", "hang-killed", "malformed-stream", "cost-unknown"] as const) {
    const report = await runConformance(fixtureTarget({ ...fixtureEnv(), [FIXTURE_BREAK_ENV]: broken }));
    expect(report.failed.map((f) => f.name)).toEqual([broken]);
    expect(report.passed.length).toBe(CONFORMANCE_CASE_NAMES.length - 1);
  }
}, 120_000);
