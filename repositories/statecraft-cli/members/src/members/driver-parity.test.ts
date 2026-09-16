// Spec 114 FR-003: the Rust driver and the TypeScript driver answer spec
// 014's fixtures identically, and 043's engine cannot tell them apart. The
// Rust binary is built here so the check cannot pass against a stale one.
import { test, expect } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createProcessDriver } from "../orchestrator/driver";
import { openJournal } from "../orchestrator/journal";
import type { JsonValue } from "../orchestrator/journal";

const REPO = join(import.meta.dir, "..", "..", "..");
const MEMBERS = join(REPO, "members");
const RUST_BIN = join(REPO, "target", "debug", "statecraft-driver-claude");
const TS_ENTRY = join(MEMBERS, "src", "members", "driver.ts");

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function run(cmd: readonly string[], env: Record<string, string>, stdin?: string): Promise<Ran> {
  const proc = Bun.spawn([...cmd], {
    cwd: REPO,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", ...env },
  });
  if (stdin !== undefined) proc.stdin.write(stdin);
  await proc.stdin.end();
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

function fresh(): string {
  return mkdtempSync(join(tmpdir(), "driver-parity-"));
}

function fakeClaude(dir: string, body: string): string {
  const path = join(dir, "fake-claude.sh");
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

// Spec 014's fixture set, one per classification path the driver has.
const FIXTURES: Record<string, string> = {
  completed: [
    'echo \'{"type":"system","subtype":"init","session_id":"sess-completed"}\'',
    'echo \'{"type":"assistant","message":{"role":"assistant","content":[]}}\'',
    "echo 'not json at all'",
    'echo \'{"type":"result","subtype":"success","is_error":false,"result":"DONE","total_cost_usd":0.012345,"usage":{"input_tokens":100,"output_tokens":42,"cache_read_input_tokens":3.5},"num_turns":2,"session_id":"sess-completed"}\'',
    "exit 0",
  ].join("\n"),
  quota: [
    'echo \'{"type":"system","subtype":"init","session_id":"sess-quota"}\'',
    'echo \'{"type":"result","subtype":"error_during_execution","is_error":true,"result":"You have hit your usage limit. Resets at 1700000000","session_id":"sess-quota"}\'',
    "exit 1",
  ].join("\n"),
  auth: ["echo 'authentication_error: OAuth token expired' >&2", "exit 1"].join("\n"),
  "max-turns": [
    'echo \'{"type":"system","subtype":"init","session_id":"sess-max"}\'',
    'echo \'{"type":"result","subtype":"error_max_turns","is_error":true,"result":"limit reached","num_turns":5,"session_id":"sess-max"}\'',
    "exit 1",
  ].join("\n"),
  "hook-blocked": ["echo '[pr-gate] BLOCKED: stale shards' >&2", "exit 2"].join("\n"),
  transient: ["echo 'upstream ECONNRESET while talking to the API' >&2", "exit 1"].join("\n"),
  crashed: ["echo 'segfault-ish nonsense' >&2", "exit 139"].join("\n"),
  timeout: ["exec sleep 30"].join("\n"),
  // 119 B-5/B-8: a hook refusal followed by a completed turn. Both drivers
  // classify completed and both count the one denial from the flagged
  // tool_result; the agent's prose quoting it is not counted.
  denied: [
    'echo \'{"type":"system","subtype":"init","session_id":"sess-denied"}\'',
    'echo \'{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","is_error":true,"content":"Bash operation blocked by hook:\\n- [pr-gate] BLOCKED: stale shards"}]}}\'',
    'echo \'{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"the hook blocked it: [pr-gate] BLOCKED"}]}}\'',
    'echo \'{"type":"result","subtype":"success","is_error":false,"result":"DONE","total_cost_usd":0.01,"usage":{"input_tokens":10,"output_tokens":4},"num_turns":2,"session_id":"sess-denied"}\'',
    "exit 0",
  ].join("\n"),
};

function normalize(text: string): unknown[] {
  return text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .map((event) => scrub(event));
}

// ts and durationMs are the two fields that legitimately differ between two
// runs; everything else, the payloads included, must agree as JSON values.
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "ts" || k === "durationMs") continue;
      out[k] = scrub(v);
    }
    return out;
  }
  return value;
}

function request(repo: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: "1",
    repo,
    prompt: "reply DONE",
    tier: "strong",
    maxTurns: 3,
    timeoutMs: 10_000,
    profile: { mode: "guarded", allowedTools: ["Read"], disallowedTools: null, models: null },
    ...extra,
  });
}

test("the Rust driver builds", async () => {
  const built = await run(["cargo", "build", "-p", "statecraft-driver-claude"], {});
  expect(built.code).toBe(0);
}, 600_000);

for (const [name, body] of Object.entries(FIXTURES)) {
  test(`FR-003: the ${name} fixture yields the same event stream from both drivers`, async () => {
    const dir = fresh();
    const claude = fakeClaude(dir, body);
    // A second, not 300 ms: under a loaded machine the fake has to print its
    // first line before the deadline, or the init record is never journaled.
    const extra = name === "timeout" ? { timeoutMs: 1000, killGraceMs: 100 } : {};
    const req = request(dir, extra);
    const env = { STATECRAFT_CLAUDE_BIN: claude };
    const [ts, rs] = await Promise.all([
      run(["bun", TS_ENTRY, "session", "run"], env, req),
      run([RUST_BIN, "session", "run"], env, req),
    ]);
    expect(rs.code).toBe(ts.code);
    expect(ts.code).toBe(0);
    const tsEvents = normalize(ts.stdout);
    const rsEvents = normalize(rs.stdout);
    expect(rsEvents).toEqual(tsEvents);
    const result = tsEvents.at(-1) as { event: string; result: { classification: { kind: string }; denials: number; denialSamples: string[] } };
    expect(result.event).toBe("result");
    const expectedKind = name === "timeout" ? "timeout" : name === "denied" ? "completed" : name;
    expect(result.result.classification.kind).toBe(expectedKind);
    expect(result.result.denials).toBe(name === "denied" ? 1 : 0);
    if (name === "denied") expect(result.result.denialSamples[0]).toContain("[pr-gate] BLOCKED");
  }, 30_000);
}

test("FR-003: a request that does not parse is usage (3) for both", async () => {
  const env = { STATECRAFT_CLAUDE_BIN: "/nonexistent" };
  const [ts, rs] = await Promise.all([
    run(["bun", TS_ENTRY, "session", "run"], env, "not json"),
    run([RUST_BIN, "session", "run"], env, "not json"),
  ]);
  expect([ts.code, rs.code]).toEqual([3, 3]);
  expect(ts.stdout).toBe("");
  expect(rs.stdout).toBe("");
});

test("B-4: the engine's seam drives the Rust driver to the same journal records as the TypeScript one", async () => {
  const dir = fresh();
  const claude = fakeClaude(dir, FIXTURES.completed!);
  const records = async (driverBin: string | undefined): Promise<unknown[]> => {
    const root = fresh();
    const journal = openJournal(root, "orchestrator");
    try {
      const driver = createProcessDriver({
        env: {
          ...process.env,
          STATECRAFT_CLAUDE_BIN: claude,
          ...(driverBin === undefined ? { STATECRAFT_MEMBER_DIR: join(root, "none"), PATH: "/usr/bin:/bin" } : { STATECRAFT_DRIVER_BIN: driverBin }),
        },
      });
      const result = await driver.runSession({
        repo: dir,
        prompt: "reply DONE",
        tier: "strong",
        maxTurns: 3,
        timeoutMs: 10_000,
        profile: { mode: "guarded", allowedTools: ["Read"] },
        journal,
      });
      expect(result.classification.kind).toBe("completed");
      // 124 B-6: the seam's own qualification record is about the evidence,
      // not the driver; the drivers' records are what parity compares.
      return journal
        .fold()
        .records.filter((r) => r.kind !== "driver.unqualified")
        .map((r) => scrub({ kind: r.kind, payload: r.payload as JsonValue }));
    } finally {
      journal.close();
    }
  };
  const viaTypescript = await records(undefined);
  const viaRust = await records(RUST_BIN);
  expect(viaRust).toEqual(viaTypescript);
  expect((viaRust[0] as { kind: string }).kind).toBe("session.init");
  expect((viaRust[1] as { kind: string }).kind).toBe("session.result");
});

test("FR-004: the manifest equals spec 111's driver fixture modulo version, and models prints what the TypeScript verb prints", async () => {
  const manifest = await run([RUST_BIN, "--member-manifest"], {});
  const fixture = JSON.parse(readFileSync(join(REPO, "crates", "statecraft-contract", "fixtures", "manifest-driver.json"), "utf8")) as { version: string };
  expect({ ...(JSON.parse(manifest.stdout) as object), version: fixture.version }).toEqual(fixture);
  const [ts, rs] = await Promise.all([run(["bun", TS_ENTRY, "models"], {}), run([RUST_BIN, "models"], {})]);
  expect(rs.stdout).toBe(ts.stdout);
  const [tsJson, rsJson] = await Promise.all([run(["bun", TS_ENTRY, "models", "--json"], {}), run([RUST_BIN, "models", "--json"], {})]);
  expect(JSON.parse(rsJson.stdout)).toEqual(JSON.parse(tsJson.stdout));
});
