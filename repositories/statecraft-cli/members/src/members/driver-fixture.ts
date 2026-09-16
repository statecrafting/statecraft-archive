// statecraft-driver-fixture (spec 124 B-1): a driver member whose provider
// is a script, chosen by the request's prompt, so the conformance suite runs
// without any real harness. It speaks the 043 wire exactly as the real
// drivers do (a manifest on `--member-manifest`, one request on stdin,
// `journal`, `stream` and `result` lines on stdout), declares its
// capabilities from the environment, and writes a marker file when a
// session actually starts, so a refusal that must spawn nothing can be
// observed. `STATECRAFT_FIXTURE_BREAK=<case>` makes it misbehave for that
// case, so the suite cannot pass vacuously (FR-002).
//
// The prompt's first line is the script:
//   complete                 init, one turn, a completed result with cost
//   deny-then-complete       one denied tool call, then complete
//   hang <ms> [with-child]   init, then sleep; with a child process holding on
//   malformed                lines that are not events, then exit 0
//   no-cost                  complete, with no cost reported
//   quota <resetMs>          a quota refusal with a reset hint
//   crash <code>             exit with that code and no result
import { writeFileSync } from "fs";
import { CAPABILITIES, isCapability, tierFor, type Capability } from "../orchestrator/capabilities";
import type { JsonValue } from "../orchestrator/journal";
import { MEMBER_CONTRACT, MANIFEST_SCHEMA_VERSION, ENGINE_EXIT_CODES, runMember, type MemberManifest } from "./manifest";
import pkg from "../../package.json";

export const FIXTURE_DRIVER_NAME = "statecraft-driver-fixture";
export const FIXTURE_CAPABILITIES_ENV = "STATECRAFT_FIXTURE_CAPABILITIES";
export const FIXTURE_MARKER_ENV = "STATECRAFT_FIXTURE_MARKER";
export const FIXTURE_BREAK_ENV = "STATECRAFT_FIXTURE_BREAK";
export const FIXTURE_BINARY_VERSION = "fixture 1.0.0";

export function fixtureCapabilities(env: NodeJS.ProcessEnv = process.env): Capability[] {
  const raw = env[FIXTURE_CAPABILITIES_ENV];
  if (raw === undefined) return [...CAPABILITIES];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Capability => isCapability(s));
}

export function fixtureManifest(env: NodeJS.ProcessEnv = process.env): MemberManifest {
  const capabilities = fixtureCapabilities(env);
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    name: FIXTURE_DRIVER_NAME,
    version: pkg.version,
    contract: MEMBER_CONTRACT,
    verbs: ["models", "session"],
    capabilityTier: tierFor(capabilities),
    capabilities,
    exitCodes: ENGINE_EXIT_CODES,
    envelope: "ok-data",
  };
}

function emit(line: Record<string, JsonValue>): void {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

// The result, and the `session.result` record a driver journals with it,
// field for field what session.ts writes (043 B-3).
function result(fields: Record<string, JsonValue>): void {
  const r = {
    classification: { kind: "completed", resetAtMs: null as number | null, detail: "result event reported is_error: false" },
    exitCode: 0 as number | null,
    durationMs: 5,
    numTurns: 1 as number | null,
    costMicroUsd: 1000 as number | null,
    usage: { input_tokens: 10, output_tokens: 2 } as Record<string, number> | null,
    sessionId: "fixture-session",
    transcriptPath: null as string | null,
    overflow: { lines: [] as string[], truncatedCount: 0 },
    stderrTail: "",
    denials: 0,
    denialSamples: [] as string[],
    ...fields,
  } as Record<string, JsonValue> & { classification: { kind: string; resetAtMs: number | null; detail: string }; overflow: { lines: string[]; truncatedCount: number } };
  emit({
    event: "journal",
    kind: "session.result",
    payload: {
      classification: r.classification.kind,
      resetAtMs: r.classification.resetAtMs,
      detail: r.classification.detail,
      exitCode: r.exitCode,
      durationMs: r.durationMs,
      numTurns: r.numTurns,
      costMicroUsd: r.costMicroUsd,
      usage: r.usage,
      sessionId: r.sessionId,
      transcriptPath: r.transcriptPath,
      overflowLineCount: r.overflow.lines.length,
      overflowTruncatedCount: r.overflow.truncatedCount,
      stderrTail: r.stderrTail,
      resultTextTail: null,
      denials: r.denials,
      denialSamples: r.denialSamples,
    },
  });
  emit({ event: "result", result: r });
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Uint8Array);
  return Buffer.concat(chunks).toString("utf8");
}

export async function runFixtureSession(): Promise<number> {
  const text = await readStdin();
  let request: Record<string, unknown>;
  try {
    request = JSON.parse(text) as Record<string, unknown>;
  } catch {
    console.error("request: stdin is not JSON");
    return 3;
  }
  if (request.schemaVersion !== "1" || typeof request.prompt !== "string") {
    console.error("request: expected schemaVersion 1 and a prompt");
    return 3;
  }
  const marker = process.env[FIXTURE_MARKER_ENV];
  if (marker !== undefined) writeFileSync(marker, `${Date.now()}\n`);
  const broken = process.env[FIXTURE_BREAK_ENV] ?? "";
  const [script, ...args] = request.prompt.split("\n")[0]!.trim().split(/\s+/);
  const profile = (request.profile ?? { mode: "bypass" }) as JsonValue;
  const supported = fixtureCapabilities();
  const applied = supported.filter((c) => c !== "cost" || script !== "no-cost");
  emit({
    event: "journal",
    kind: "session.init",
    payload: {
      fixtureBin: "fixture",
      repo: String(request.repo ?? ""),
      model: null,
      maxTurns: null,
      timeoutMs: typeof request.timeoutMs === "number" ? request.timeoutMs : 0,
      sessionId: "fixture-session",
      profile,
      applied: [...applied],
      degraded: supported.filter((c) => !applied.includes(c)),
      binaryVersion: FIXTURE_BINARY_VERSION,
    },
  });
  emit({ event: "stream", raw: { type: "system", subtype: "init", session_id: "fixture-session" } });

  switch (script) {
    case "complete":
      result({});
      return 0;
    case "deny-then-complete": {
      emit({ event: "stream", raw: { type: "tool_refused", detail: "[pr-gate] BLOCKED: fixture" } });
      // Broken for this case: the denial is forgotten.
      const denials = broken === "denial-retained" ? 0 : 1;
      result({ denials, denialSamples: denials === 0 ? [] : ["[pr-gate] BLOCKED: fixture"] });
      return 0;
    }
    case "hang": {
      // A provider that hangs, as a driver sees it: the driver's deadline
      // (the request's timeoutMs) ends the session as `timeout` and reaches
      // the provider's descendants. Broken for this case, the descendant is
      // left alive.
      const ms = Number(args[0] ?? "30000");
      const deadline = typeof request.timeoutMs === "number" ? request.timeoutMs : ms;
      let child: ReturnType<typeof Bun.spawn> | null = null;
      if (args[1] === "with-child") {
        child = Bun.spawn(["sleep", String(Math.ceil(ms / 1000) + 30)], { stdout: "ignore", stderr: "ignore" });
        if (marker !== undefined) writeFileSync(`${marker}.child`, `${child.pid}\n`);
      }
      if (ms <= deadline) {
        await Bun.sleep(ms);
        child?.kill();
        result({});
        return 0;
      }
      await Bun.sleep(deadline);
      if (broken !== "hang-killed") child?.kill("SIGKILL");
      result({ classification: { kind: "timeout", resetAtMs: null, detail: "driver killed the process after it exceeded its configured deadline" }, exitCode: null, numTurns: null, costMicroUsd: null });
      return 0;
    }
    case "malformed":
      process.stdout.write("this is not an event\n{\"event\":\"nope\"}\n");
      if (broken === "malformed-stream") {
        result({});
      }
      return 0;
    case "no-cost":
      result({ costMicroUsd: broken === "cost-unknown" ? 0 : null });
      return 0;
    case "quota": {
      const resetAtMs = Number(args[0] ?? "0");
      result({ classification: { kind: "quota", resetAtMs, detail: "usage limit reached" }, exitCode: 1 });
      return 0;
    }
    case "crash":
      console.error("fixture: crashing on request");
      return Number(args[0] ?? "7");
    default:
      console.error(`fixture: unknown script "${script}"`);
      return 3;
  }
}

function cmdModels(args: readonly string[]): void {
  const data = { strong: "fixture-strong", fast: "fixture-fast" };
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ ok: true, data })}\n`);
    return;
  }
  console.log(`models:  ${data.strong} / ${data.fast} (fixture)`);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv[0] === "--version") {
    console.log(FIXTURE_BINARY_VERSION);
  } else if (argv[0] === "session" && !argv.includes("--member-manifest")) {
    process.exit(await runFixtureSession());
  } else {
    await runMember(fixtureManifest(), argv, { models: cmdModels });
  }
}
