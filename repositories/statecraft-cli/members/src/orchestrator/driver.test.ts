// Spec 043 FR-001, FR-003, FR-004: the engine's side of the seam against a
// fake driver script. Nothing here spawns a provider; the member side is
// driver-session.test.ts, and the two meet in the profile spawn tests.
import { test, expect } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openJournal } from "./journal";
import {
  DEFAULT_DRIVER_NAME,
  DEGRADED_KIND,
  REFUSED_KIND,
  createProcessDriver,
  createProfileDriver,
  killLiveSession,
  parseDriverEvent,
  resolveDriverCommand,
  toWireRequest,
  type Driver,
  type SessionResult,
} from "./driver";
import type { ExecutionProfile } from "./profile";
import { createBrowserMcpVerifier } from "./stages/verify";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "driver-seam-"));
}

// A driver member stand-in: records the request it was handed, then plays a
// scripted event stream. `--member-manifest` answers with the given tier.
function writeFakeDriver(dir: string, tier: "reference" | "basic", body: string, capabilities?: readonly string[]): string {
  const path = join(dir, "fake-driver.sh");
  // 120 B-2: a manifest may declare its tokens; the pre-120 shape (no
  // field) is read by its tier alone.
  const tokens = capabilities === undefined ? "" : `,"capabilities":${JSON.stringify(capabilities)}`;
  writeFileSync(
    path,
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "--member-manifest" ]; then',
      `  echo '{"schemaVersion":"1","name":"statecraft-driver-fake","version":"0","contract":"042","verbs":["session"],"capabilityTier":"${tier}"${tokens},"exitCodes":{"0":"ok"},"envelope":"ok-data"}'`,
      "  exit 0",
      "fi",
      `printf 'argv:%s\\n' "$*" > "${join(dir, "argv")}"`,
      `cat > "${join(dir, "request.json")}"`,
      body,
    ].join("\n") + "\n"
  );
  chmodSync(path, 0o755);
  return path;
}

const COMPLETED_RESULT: SessionResult = {
  classification: { kind: "completed", resetAtMs: null, detail: "result event: success" },
  exitCode: 0,
  durationMs: 12,
  numTurns: 2,
  costMicroUsd: 12345,
  usage: { input_tokens: 100, output_tokens: 42 },
  sessionId: "sess-1",
  transcriptPath: "/tmp/sess-1.jsonl",
  overflow: { lines: [], truncatedCount: 0 },
  stderrTail: "",
  denials: 0,
  denialSamples: [],
};

const INIT_PAYLOAD = { claudeBin: "claude", repo: "/r", model: "m", maxTurns: null, timeoutMs: 1, sessionId: "sess-1", profile: { mode: "bypass", allowedTools: null, disallowedTools: null, models: null } };
const RESULT_PAYLOAD = { classification: "completed", resetAtMs: null, detail: "result event: success", exitCode: 0 };

function scriptedStream(): string {
  return [
    `echo '${JSON.stringify({ event: "journal", kind: "session.init", payload: INIT_PAYLOAD })}'`,
    `echo '${JSON.stringify({ event: "stream", raw: { type: "system", subtype: "init", session_id: "sess-1" } })}'`,
    `echo '${JSON.stringify({ event: "stream", raw: { type: "assistant" } })}'`,
    "echo 'not an event line'",
    `echo '${JSON.stringify({ event: "journal", kind: "session.result", payload: RESULT_PAYLOAD })}'`,
    `echo '${JSON.stringify({ event: "result", result: COMPLETED_RESULT })}'`,
    "exit 0",
  ].join("\n");
}

// --- FR-001: request out, events in, journal written by the engine ---------

test("FR-001: the request is one JSON object on stdin, argv is `session run`, and stdin is closed", async () => {
  const dir = freshDir();
  const bin = writeFakeDriver(dir, "reference", scriptedStream());
  const driver = createProcessDriver({ driverBin: bin });
  const sink: unknown[] = [];
  const result = await driver.runSession({
    repo: dir,
    prompt: "hello\nworld",
    tier: "strong",
    maxTurns: 4,
    timeoutMs: 5000,
    profile: { mode: "guarded", allowedTools: ["Read"] },
    sink: (e) => sink.push(e),
  });
  expect(readFileSync(join(dir, "argv"), "utf8")).toBe("argv:session run\n");
  const request = JSON.parse(readFileSync(join(dir, "request.json"), "utf8"));
  expect(request).toEqual({
    schemaVersion: "1",
    repo: dir,
    prompt: "hello\nworld",
    tier: "strong",
    model: null,
    maxTurns: 4,
    timeoutMs: 5000,
    mcpConfigPath: null,
    profile: { mode: "guarded", allowedTools: ["Read"], disallowedTools: null, models: null, driver: null, require: null },
    killGraceMs: null,
    // 120 B-3, B-4: the requirements the seam derived, explicit on the wire.
    requirements: { required: [], preferred: ["tool-allowlist", "max-turns", "cost"] },
  });
  // Every stream event reached the sink verbatim; the stray line did not.
  expect(sink).toEqual([{ type: "system", subtype: "init", session_id: "sess-1" }, { type: "assistant" }]);
  expect(result).toEqual(COMPLETED_RESULT);
});

test("FR-001: journal events are appended by the engine with their payloads intact, in order", async () => {
  const dir = freshDir();
  const bin = writeFakeDriver(dir, "reference", scriptedStream());
  const journal = openJournal(dir, "orchestrator");
  try {
    // 124 B-6: judged against an empty evidence directory, so the committed
    // records for the real drivers do not enter this fixture's world.
    const driver = createProcessDriver({ driverBin: bin, env: { ...process.env, STATECRAFT_QUALIFICATION_DIR: join(dir, "no-evidence") } });
    await driver.runSession({ repo: dir, prompt: "hi", journal });
    const records = journal.fold().records.map((r) => ({ kind: r.kind, payload: r.payload }));
    // The fake driver's binary has no qualification record; the seam says so
    // once, after the init, and the session runs.
    expect(records).toEqual([
      { kind: "session.init", payload: INIT_PAYLOAD },
      { kind: "driver.unqualified", payload: { driver: "claude", binaryVersion: null, recorded: null } },
      { kind: "session.result", payload: RESULT_PAYLOAD },
    ]);
  } finally {
    journal.close();
  }
});

test("toWireRequest and parseDriverEvent are inverses of what the member writes", () => {
  const wire = toWireRequest({ repo: "/r", prompt: "p" });
  expect(wire.schemaVersion).toBe("1");
  expect(wire.profile).toBeNull();
  expect(parseDriverEvent("{}")).toBeNull();
  expect(parseDriverEvent("nope")).toBeNull();
  expect(parseDriverEvent('{"event":"stream","raw":1}')).toEqual({ event: "stream", raw: 1 });
  expect(parseDriverEvent('{"event":"journal","kind":"k"}')).toBeNull();
});

// --- FR-003: kill and deadline ----------------------------------------------

test("FR-003: killLiveSession severs the member with SIGTERM and the result is `killed`", async () => {
  const dir = freshDir();
  const bin = writeFakeDriver(
    dir,
    "reference",
    [
      `echo '${JSON.stringify({ event: "journal", kind: "session.init", payload: INIT_PAYLOAD })}'`,
      `trap 'echo signalled > "${join(dir, "signal")}"; kill $child; exit 143' TERM`,
      "sleep 30 & child=$!; wait $child",
    ].join("\n")
  );
  const journal = openJournal(dir, "orchestrator");
  try {
    const driver = createProcessDriver({ driverBin: bin });
    const running = driver.runSession({ repo: dir, prompt: "hi", journal, killGraceMs: 500 });
    // Let the member start and write its init line before severing. Since
    // 120 B-5 the seam reads the manifest first, so wait for the record
    // rather than a fixed interval.
    for (let i = 0; i < 100 && !journal.fold().records.some((r) => r.kind === "session.init"); i++) await Bun.sleep(50);
    expect(killLiveSession()).toBe(true);
    const result = await running;
    expect(result.classification.kind).toBe("killed");
    expect(result.classification.detail).toContain("severed by the engine");
    expect(readFileSync(join(dir, "signal"), "utf8").trim()).toBe("signalled");
    const kinds = journal.fold().records.map((r) => r.kind);
    expect(kinds).toEqual(["session.init", "driver.unqualified", "session.result"]);
    expect(driver.killLiveSession()).toBe(false);
  } finally {
    journal.close();
  }
}, 10_000);

test("FR-003: a member that never writes `result` is killed at the deadline plus grace and classified `crashed`", async () => {
  const dir = freshDir();
  const bin = writeFakeDriver(dir, "reference", "sleep 30 & wait $!");
  const driver = createProcessDriver({ driverBin: bin, deadlineSlackMs: 100 });
  const result = await driver.runSession({ repo: dir, prompt: "hi", timeoutMs: 200, killGraceMs: 100 });
  expect(result.classification.kind).toBe("crashed");
  expect(result.classification.detail).toContain("no result within the deadline");
}, 10_000);

test("a member that exits without a result is `crashed` with its exit code and stderr in the record", async () => {
  const dir = freshDir();
  const bin = writeFakeDriver(dir, "reference", "echo 'boom' >&2\nexit 1");
  const driver = createProcessDriver({ driverBin: bin });
  const result = await driver.runSession({ repo: dir, prompt: "hi" });
  expect(result.classification.kind).toBe("crashed");
  expect(result.classification.detail).toContain("exited 1 without a result");
  expect(result.stderrTail).toContain("boom");
});

// --- FR-004: degradation ------------------------------------------------------

test("FR-004: a basic driver is never spawned for an mcp-config request; the degradation is journaled", async () => {
  const dir = freshDir();
  const bin = writeFakeDriver(dir, "basic", scriptedStream());
  const journal = openJournal(dir, "orchestrator");
  try {
    const driver = createProcessDriver({ driverBin: bin });
    expect(await driver.tier()).toBe("basic");
    const result = await driver.runSession({ repo: dir, prompt: "hi", mcpConfigPath: "/x/mcp.json", journal });
    expect(result.classification.kind).toBe("crashed");
    expect(result.classification.detail).toContain("mcp-config");
    let spawned = true;
    try {
      readFileSync(join(dir, "request.json"));
    } catch {
      spawned = false;
    }
    expect(spawned).toBe(false);
    const records = journal.fold().records.map((r) => ({ kind: r.kind, payload: r.payload }));
    expect(records[0]).toEqual({ kind: DEGRADED_KIND, payload: { driver: "claude", tier: "basic", feature: "mcp-config" } });
    // 120 B-5: the refusal record names what was required and what was
    // missing; the session result follows.
    expect(records[1]).toEqual({ kind: REFUSED_KIND, payload: { driver: "claude", tier: "basic", required: ["mcp-config"], unsupported: ["mcp-config"] } });
    expect(records[2]?.kind).toBe("session.result");
  } finally {
    journal.close();
  }
});

test("FR-004: the browser verifier reports a degraded assertion as not passed, naming the feature", async () => {
  const dir = freshDir();
  const bin = writeFakeDriver(dir, "basic", scriptedStream());
  const verifier = createBrowserMcpVerifier({
    repo: dir,
    driver: createProcessDriver({ driverBin: bin }),
    profile: { mode: "bypass" },
  });
  const verdict = await verifier.assert("http://127.0.0.1:1/", "the page says hello");
  expect(verdict.pass).toBe(false);
  expect(verdict.detail).toContain("mcp-config");
});

// --- B-5: discovery --------------------------------------------------------------

test("B-5: STATECRAFT_DRIVER_BIN wins, then the managed directory, then PATH, then the checkout", () => {
  const dir = freshDir();
  const managed = join(dir, "managed");
  const onPath = join(dir, "path");
  for (const d of [managed, onPath]) {
    Bun.spawnSync(["mkdir", "-p", d]);
  }
  const explicit = resolveDriverCommand("claude", { STATECRAFT_DRIVER_BIN: "/x/driver", PATH: "" });
  expect(explicit).toEqual({ argv: ["/x/driver"], location: "explicit" });

  const managedBin = join(managed, "statecraft-driver-claude");
  writeFileSync(managedBin, "#!/bin/sh\n");
  chmodSync(managedBin, 0o755);
  const pathBin = join(onPath, "statecraft-driver-claude");
  writeFileSync(pathBin, "#!/bin/sh\n");
  chmodSync(pathBin, 0o755);
  expect(resolveDriverCommand("claude", { STATECRAFT_MEMBER_DIR: managed, PATH: onPath })).toEqual({
    argv: [managedBin],
    location: "managed",
  });
  expect(resolveDriverCommand("claude", { STATECRAFT_MEMBER_DIR: join(dir, "empty"), PATH: onPath })).toEqual({
    argv: [pathBin],
    location: "path",
  });
  // Nothing installed: from this checkout the member entrypoint runs under bun.
  const source = resolveDriverCommand("claude", { STATECRAFT_MEMBER_DIR: join(dir, "empty"), PATH: "" });
  expect(source?.location).toBe("source");
  expect(source?.argv[1]).toEndWith("src/members/driver.ts");
  expect(resolveDriverCommand("nonesuch", { STATECRAFT_MEMBER_DIR: join(dir, "empty"), PATH: "" })).toBeNull();
});

// --- spec 117 B-3: the driver follows the profile ---------------------------

test("117 FR-002: the profile driver resolves the name per call and keeps one driver per name", async () => {
  const made: string[] = [];
  const calls: string[] = [];
  const fake = (name: string): Driver => {
    made.push(name);
    return {
      name,
      tier: async () => (name === "codex" ? "basic" : "reference"),
      runSession: async (request) => {
        calls.push(`${name}:${request.prompt}`);
        return { classification: { kind: "completed", detail: "", resetAtMs: null }, exitCode: 0, durationMs: 0, numTurns: null, costMicroUsd: null, usage: null, sessionId: null, transcriptPath: null, overflow: { lines: [], truncatedCount: 0 }, stderrTail: "", denials: 0, denialSamples: [] };
      },
      killLiveSession: () => name === "codex",
    };
  };
  let profile: ExecutionProfile = { mode: "bypass" };
  const driver = createProfileDriver({ profile: () => profile, make: fake });
  // Nothing is built until a call asks; the default name is the seam's.
  expect(made).toEqual([]);
  expect(driver.name).toBe(DEFAULT_DRIVER_NAME);
  expect(await driver.tier()).toBe("reference");
  await driver.runSession({ repo: "/r", prompt: "one", profile });
  // The profile set mid-flight decides the next call, not the next construction.
  profile = { mode: "guarded", driver: "codex" };
  expect(driver.name).toBe("codex");
  expect(await driver.tier()).toBe("basic");
  await driver.runSession({ repo: "/r", prompt: "two", profile });
  profile = { mode: "bypass" };
  await driver.runSession({ repo: "/r", prompt: "three", profile });
  expect(calls).toEqual(["claude:one", "codex:two", "claude:three"]);
  // One process driver per name, kept: the second claude call reused the first.
  expect(made).toEqual(["claude", "codex"]);
  // The kill reaches every driver built so far.
  expect(driver.killLiveSession()).toBe(true);
  // An absent source is the default profile, so the default driver.
  expect(createProfileDriver({ profile: undefined, make: fake }).name).toBe("claude");
});

// --- 120 FR-003: the capability decision before spawn ------------------------

test("120 FR-003: a required token the manifest lacks refuses the session with driver.refused and no spawn", async () => {
  const dir = freshDir();
  const bin = writeFakeDriver(dir, "basic", scriptedStream(), ["workspace-write", "hook-enforcement"]);
  const journal = openJournal(dir, "orchestrator");
  try {
    const driver = createProcessDriver({ driverBin: bin });
    const result = await driver.runSession({
      repo: dir,
      prompt: "hi",
      profile: { mode: "bypass", require: ["tool-allowlist"] },
      journal,
    });
    expect(result.classification.kind).toBe("crashed");
    expect(result.classification.detail).toBe('driver "claude" does not support required capabilities: tool-allowlist');
    expect(existsSync(join(dir, "request.json"))).toBe(false);
    const records = journal.fold().records.map((r) => ({ kind: r.kind, payload: r.payload }));
    expect(records.map((r) => r.kind)).toEqual([DEGRADED_KIND, REFUSED_KIND, "session.result"]);
    expect(records[1]!.payload).toEqual({ driver: "claude", tier: "basic", required: ["tool-allowlist"], unsupported: ["tool-allowlist"] });
  } finally {
    journal.close();
  }
});

test("120 FR-003: a preferred token the manifest lacks is journaled as degraded and the session runs; a supported required one is silent", async () => {
  const dir = freshDir();
  const bin = writeFakeDriver(dir, "basic", scriptedStream(), ["workspace-write", "hook-enforcement"]);
  const journal = openJournal(dir, "orchestrator");
  try {
    const driver = createProcessDriver({ driverBin: bin });
    const result = await driver.runSession({
      repo: dir,
      prompt: "hi",
      maxTurns: 2,
      profile: { mode: "guarded", require: ["workspace-write"] },
      journal,
    });
    expect(result.classification.kind).toBe("completed");
    expect(existsSync(join(dir, "request.json"))).toBe(true);
    const request = JSON.parse(readFileSync(join(dir, "request.json"), "utf8")) as { requirements: unknown };
    expect(request.requirements).toEqual({ required: ["workspace-write"], preferred: ["tool-allowlist", "max-turns", "cost"] });
    const kinds = journal.fold().records.map((r) => r.kind);
    expect(kinds.slice(0, 3)).toEqual([DEGRADED_KIND, DEGRADED_KIND, DEGRADED_KIND]);
    expect(journal.fold().records.slice(0, 3).map((r) => (r.payload as { feature: string }).feature)).toEqual(["tool-allowlist", "max-turns", "cost"]);
    expect(kinds).not.toContain(REFUSED_KIND);
  } finally {
    journal.close();
  }
});

test("120 B-2: a manifest whose tier disagrees with its tokens is refused by the seam", async () => {
  const dir = freshDir();
  const bin = writeFakeDriver(dir, "reference", scriptedStream(), ["workspace-write"]);
  const driver = createProcessDriver({ driverBin: bin });
  await expect(driver.tier()).rejects.toThrow(/declares capabilityTier reference but its capabilities derive basic/);
});

