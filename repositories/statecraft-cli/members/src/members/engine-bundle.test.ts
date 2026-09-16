// Spec 043 FR-005: the compiled engine carries no Claude invocation string,
// and the compiled driver carries all of them, so a string that moves fails
// this test rather than letting it pass vacuously.
import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { DRIVER_MANIFEST, ENGINE_MANIFEST, memberBinaryPath } from "./manifest";

const ROOT = join(import.meta.dir, "..", "..");

const PROVIDER_STRINGS = [
  "stream-json",
  "--dangerously-skip-permissions",
  "--permission-mode",
  "claude-opus",
  "claude-sonnet",
];

// 124 B-4: the Codex invocation strings, and the fixture driver's own
// marker. The engine bundle carries none of them; the Codex driver is a Rust
// binary, checked when it is built. `workspace-write` is not here: it is a
// capability token (120 B-1) both sides carry, as the deny list's names are
// (121 D-6); the Codex flag it maps onto is `--sandbox`.
const CODEX_STRINGS = ["--sandbox", "--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust"];
const FIXTURE_STRINGS = ["STATECRAFT_FIXTURE_MARKER", "STATECRAFT_FIXTURE_BREAK"];

// 121 B-3 (D-6): the environment deny list is the one provider-named thing
// the engine carries, because scrubbing is the engine's to do before the
// member is spawned; the driver carries the same list for its own child.
const DENY_LIST_STRINGS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GH_TOKEN", "GITHUB_TOKEN"];

async function ensureBuilt(script: string, path: string): Promise<void> {
  if (existsSync(path)) return;
  const proc = Bun.spawn(["bun", "run", script], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  expect(await proc.exited).toBe(0);
}

test("FR-005: the engine bundle names no provider; the driver bundle names every one", async () => {
  const engine = join(ROOT, memberBinaryPath(ENGINE_MANIFEST));
  const driver = join(ROOT, memberBinaryPath(DRIVER_MANIFEST));
  await ensureBuilt("build:member:engine", engine);
  await ensureBuilt("build:member:driver", driver);
  const engineBytes = readFileSync(engine).toString("latin1");
  const driverBytes = readFileSync(driver).toString("latin1");
  for (const needle of PROVIDER_STRINGS) {
    expect(engineBytes.includes(needle)).toBe(false);
    expect(driverBytes.includes(needle)).toBe(true);
  }
  for (const needle of DENY_LIST_STRINGS) {
    expect(engineBytes.includes(needle)).toBe(true);
    expect(driverBytes.includes(needle)).toBe(true);
  }
  // 124 B-4: the engine names no Codex string and nothing of the fixture's;
  // the Claude driver bundle names neither either.
  for (const needle of [...CODEX_STRINGS, ...FIXTURE_STRINGS]) {
    expect(engineBytes.includes(needle)).toBe(false);
  }
  for (const needle of CODEX_STRINGS) {
    expect(driverBytes.includes(needle)).toBe(false);
  }
  const codex = join(ROOT, "..", "target", "release", "statecraft-driver-codex");
  if (existsSync(codex)) {
    const codexBytes = readFileSync(codex).toString("latin1");
    for (const needle of CODEX_STRINGS) expect(codexBytes.includes(needle)).toBe(true);
    for (const needle of PROVIDER_STRINGS) expect(codexBytes.includes(needle)).toBe(false);
  }
}, 120_000);
