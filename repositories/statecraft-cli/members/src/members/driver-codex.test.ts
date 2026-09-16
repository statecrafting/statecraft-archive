// Spec 116 FR-003: the Rust Codex driver answers a fake codex script with
// the events 014 promises for every classification, declares what it gave
// up in session.init, and is driven by 043's seam through
// STATECRAFT_DRIVER_BIN. The binary is built here so the check cannot pass
// against a stale one.
import { test, expect } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createProcessDriver } from "../orchestrator/driver";
import { openJournal } from "../orchestrator/journal";

const REPO = join(import.meta.dir, "..", "..", "..");
const RUST_BIN = join(REPO, "target", "debug", "statecraft-driver-codex");

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
  return mkdtempSync(join(tmpdir(), "driver-codex-"));
}

/// A fake codex that records its argv and the prompt it read from stdin,
/// then plays one of doc 03's streams.
function fakeCodex(dir: string, body: string): string {
  const path = join(dir, "fake-codex.sh");
  writeFileSync(
    path,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${dir}/argv.txt"\ncat > "${dir}/prompt.txt"\n${body}\n`
  );
  chmodSync(path, 0o755);
  return path;
}

const THREAD = "01a08750-bdaa-79f0-90b5-bc60371a2f53";
const started = `echo '{"type":"thread.started","thread_id":"${THREAD}"}'`;
const failed = (message: string): string =>
  `echo '{"type":"error","message":"${message}"}'\necho '{"type":"turn.failed","error":{"message":"${message}"}}'\nexit 1`;

const FIXTURES: Record<string, string> = {
  completed: [
    started,
    `echo '{"type":"turn.started"}'`,
    `echo 'not json at all'`,
    `echo '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"DONE"}}'`,
    `echo '{"type":"turn.completed","usage":{"input_tokens":18242,"cached_input_tokens":12928,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}'`,
    "exit 0",
  ].join("\n"),
  quota: [started, failed("You have hit your usage limit. Try again at 1700060400")].join("\n"),
  auth: [started, failed("Auth: Not logged in. Run codex login.")].join("\n"),
  "hook-blocked": [started, failed("Command blocked by PreToolUse hook: [pr-gate] BLOCKED")].join("\n"),
  transient: [started, failed("stream disconnected before completion")].join("\n"),
  crashed: [started, "echo 'segfault-ish' >&2", "exit 139"].join("\n"),
  timeout: [started, "sleep 30", "exit 0"].join("\n"),
  // 119 B-5 and D-6: what 118 observed live. The refused command's item, the
  // router's line on stderr, the agent quoting the refusal (prose, not
  // counted), then turn.completed: classified completed with two denials
  // (one from the item, one from stderr).
  denied: [
    started,
    `echo '{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"gh pr create","aggregated_output":"Command blocked by PreToolUse hook: [pr-gate] BLOCKED","exit_code":2,"status":"failed"}}'`,
    `echo '2026-09-09T00:00:01Z ERROR codex_core::tools::router: error=Command blocked by PreToolUse hook' >&2`,
    `echo '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Command blocked by PreToolUse hook: [pr-gate] BLOCKED, so I stopped."}}'`,
    `echo '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0}}'`,
    "exit 0",
  ].join("\n"),
};

function request(repo: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: "1",
    repo,
    prompt: "reply DONE",
    tier: "fast",
    maxTurns: 3,
    timeoutMs: 10_000,
    profile: { mode: "guarded", allowedTools: ["Read"], disallowedTools: null, models: null },
    ...extra,
  });
}

interface Event {
  event: string;
  kind?: string;
  payload?: Record<string, unknown>;
  result?: { classification: { kind: string; detail: string; resetAtMs: number | null }; sessionId: string | null; costMicroUsd: number | null; numTurns: number | null; usage: Record<string, number> | null; denials: number; denialSamples: string[] };
}

function events(stdout: string): Event[] {
  return stdout.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l) as Event);
}

test("the Rust Codex driver builds", async () => {
  const built = await run(["cargo", "build", "-p", "statecraft-driver-codex"], {});
  expect(built.code).toBe(0);
}, 600_000);

test("B-8: the manifest declares basic, the two verbs, and models prints the pair", async () => {
  const manifest = await run([RUST_BIN, "--member-manifest"], {});
  const parsed = JSON.parse(manifest.stdout) as { name: string; capabilityTier: string; verbs: string[]; contract: string };
  expect(parsed.name).toBe("statecraft-driver-codex");
  expect(parsed.capabilityTier).toBe("basic");
  expect(parsed.verbs).toEqual(["models", "session"]);
  expect(parsed.contract).toBe("042");
  const models = await run([RUST_BIN, "models", "--json"], {});
  expect(JSON.parse(models.stdout)).toEqual({ ok: true, data: { strong: "gpt-6-astra", fast: "gpt-5.6-luna", stages: { build: "strong", ship: "strong", shepherd: "fast", verify: "fast" } } });
  const stray = await run([RUST_BIN, "models", "--nope"], {});
  expect(stray.code).toBe(3);
  expect(stray.stderr).toContain("usage: statecraft-driver-codex models");
});

for (const [name, body] of Object.entries(FIXTURES)) {
  test(`FR-003: the ${name} fixture classifies as ${name} and session.init declares the degradations`, async () => {
    const dir = fresh();
    const codex = fakeCodex(dir, body);
    // A second, not 300 ms: under a loaded machine the fake has to print its
    // first line before the deadline, or the init record is never journaled.
    const extra = name === "timeout" ? { timeoutMs: 1000, killGraceMs: 100 } : {};
    const rs = await run([RUST_BIN, "session", "run"], { STATECRAFT_CODEX_BIN: codex }, request(dir, extra));
    expect(rs.code).toBe(0);
    const all = events(rs.stdout);
    const init = all.find((e) => e.event === "journal" && e.kind === "session.init");
    expect(init).toBeDefined();
    expect(init!.payload!.codexBin).toBe(codex);
    expect(init!.payload!.degraded).toEqual(["tool-allowlist", "max-turns", "cost"]);
    expect(init!.payload!.sessionId).toBe(THREAD);
    expect(init!.payload!.model).toBe("gpt-5.6-luna");
    const result = all.at(-1)!;
    expect(result.event).toBe("result");
    expect(result.result!.classification.kind).toBe(name === "denied" ? "completed" : name);
    expect(result.result!.denials).toBe(name === "denied" ? 2 : 0);
    if (name === "denied") {
      expect(result.result!.denialSamples.length).toBe(2);
      expect(result.result!.denialSamples.every((s) => s.includes("blocked by PreToolUse hook"))).toBe(true);
    }
    expect(result.result!.costMicroUsd).toBeNull();
    expect(result.result!.numTurns).toBeNull();
    if (name === "quota") expect(result.result!.classification.resetAtMs).toBe(1_700_060_400_000);
    if (name === "completed") expect(result.result!.usage).toEqual({ input_tokens: 18242, cached_input_tokens: 12928, cache_write_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0 });
    // B-2, D35: the posture, the model, the prompt on stdin, never on argv.
    const argv = (await Bun.file(join(dir, "argv.txt")).text()).trim().split("\n");
    expect(argv).toEqual(["exec", "--json", "--color", "never", "--sandbox", "workspace-write", "--dangerously-bypass-hook-trust", "-m", "gpt-5.6-luna", "-"]);
    expect(await Bun.file(join(dir, "prompt.txt")).text()).toBe("reply DONE");
  }, 30_000);
}

test("B-2: a bypass profile passes the bypass flag and no sandbox", async () => {
  const dir = fresh();
  const codex = fakeCodex(dir, FIXTURES.completed!);
  const rs = await run([RUST_BIN, "session", "run"], { STATECRAFT_CODEX_BIN: codex }, request(dir, { profile: { mode: "bypass" }, maxTurns: undefined }));
  expect(rs.code).toBe(0);
  const argv = (await Bun.file(join(dir, "argv.txt")).text()).trim().split("\n");
  expect(argv).toEqual(["exec", "--json", "--color", "never", "--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust", "-m", "gpt-5.6-luna", "-"]);
  const init = events(rs.stdout).find((e) => e.kind === "session.init")!;
  expect(init.payload!.degraded).toEqual(["cost"]);
});

test("a request that does not parse is usage (3)", async () => {
  const rs = await run([RUST_BIN, "session", "run"], { STATECRAFT_CODEX_BIN: "/nonexistent" }, "not json");
  expect(rs.code).toBe(3);
  expect(rs.stdout).toBe("");
});

test("FR-003: 043's seam drives the Codex driver to journaled init and result records", async () => {
  const dir = fresh();
  const codex = fakeCodex(dir, FIXTURES.completed!);
  const root = fresh();
  const journal = openJournal(root, "orchestrator");
  try {
    const driver = createProcessDriver({
      name: "codex",
      env: { ...process.env, STATECRAFT_CODEX_BIN: codex, STATECRAFT_DRIVER_BIN: RUST_BIN },
    });
    expect(await driver.tier()).toBe("basic");
    const result = await driver.runSession({
      repo: dir,
      prompt: "reply DONE",
      tier: "fast",
      timeoutMs: 10_000,
      profile: { mode: "bypass" },
      journal,
    });
    expect(result.classification.kind).toBe("completed");
    expect(result.sessionId).toBe(THREAD);
    const records = journal.fold().records.map((r) => ({ kind: r.kind, payload: r.payload as Record<string, unknown> }));
    // 120 B-5: the seam journals the preferred token the manifest lacks
    // before spawning; the driver's own init then says what it applied.
    // 124 B-6: a fake codex has no qualification record, so the seam says so
    // once, after the init that named the binary version.
    expect(records.map((r) => r.kind)).toEqual(["driver.degraded", "session.init", "driver.unqualified", "session.result"]);
    expect(records[0]!.payload).toEqual({ driver: "codex", tier: "basic", feature: "cost" });
    expect(records[1]!.payload.degraded).toEqual(["cost"]);
    expect(records[1]!.payload.applied).toEqual(["hook-enforcement"]);
    expect(records[1]!.payload.codexBin).toBe(codex);
    // The fake codex answers `--version` with its first stream line, which is
    // no version the committed record names.
    expect(records[2]!.payload).toMatchObject({ driver: "codex" });
    expect((records[2]!.payload as { binaryVersion: string }).binaryVersion).not.toBe("codex-cli 0.153.4");
  } finally {
    journal.close();
  }
});
