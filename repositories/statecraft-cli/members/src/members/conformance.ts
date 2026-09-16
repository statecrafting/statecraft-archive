// Spec 124: provider conformance (doc 04 D56). One negative table every
// driver runs through the engine's own seam (043), so a driver built to the
// contract is admitted by passing it, not by resembling another. A case is a
// request and a predicate over the result and the journal; the harness
// resolves a driver command the way the engine does, runs each case in a
// fresh journal, and reports what passed and what failed with a reason.
//
// The provider behind a real driver is a fake script per case (as the
// parity tests do); the fixture driver is its own provider and takes the
// case as its prompt. Neither touches a live harness: that is qualification
// (B-5), which runs once and is committed.

import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseCapabilityList, tierFor, type Capability } from "../orchestrator/capabilities";
import { createProcessDriver, resolveDriverCommand, type Driver, type DriverSessionRequest } from "../orchestrator/driver";
import { openJournal, type JournalRecord } from "../orchestrator/journal";
import type { ExecutionProfile } from "../orchestrator/profile";
import type { SessionResult } from "../orchestrator/session";
import { FIXTURE_CAPABILITIES_ENV, FIXTURE_MARKER_ENV } from "./driver-fixture";

// --- the table (B-2) ----------------------------------------------------------

export const CONFORMANCE_CASE_NAMES = [
  "manifest-agrees",
  "denial-retained",
  "required-refused",
  "hang-killed",
  "malformed-stream",
  "cost-unknown",
  "records-agree",
] as const;
export type ConformanceCaseName = (typeof CONFORMANCE_CASE_NAMES)[number];

export interface CaseRun {
  readonly result: SessionResult;
  readonly records: readonly JournalRecord[];
  // The marker the provider writes when it actually starts (B-2's
  // `required-refused` observes its absence); null when the target has none.
  readonly providerStarted: boolean | null;
  // The pid of the descendant a hang left, when the target reports one.
  readonly childPid: number | null;
  readonly manifest: ManifestShape;
}

export interface ManifestShape {
  readonly capabilityTier: string;
  readonly capabilities: readonly Capability[] | null;
}

export interface ConformanceCase {
  readonly name: ConformanceCaseName;
  // What the case asks of the driver beyond the target's own prompt.
  readonly request: Partial<DriverSessionRequest> & { readonly profile?: ExecutionProfile };
  // Null when the case passes, else the reason it did not.
  readonly expect: (run: CaseRun) => string | null;
}

const SESSION_RESULT_KEYS = [
  "classification",
  "resetAtMs",
  "detail",
  "exitCode",
  "durationMs",
  "numTurns",
  "costMicroUsd",
  "usage",
  "sessionId",
  "transcriptPath",
  "overflowLineCount",
  "overflowTruncatedCount",
  "stderrTail",
  "resultTextTail",
  "denials",
  "denialSamples",
];

const SESSION_INIT_KEYS = ["repo", "model", "maxTurns", "timeoutMs", "sessionId", "profile", "applied", "degraded", "binaryVersion"];

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export const CONFORMANCE_CASES: readonly ConformanceCase[] = [
  {
    name: "manifest-agrees",
    request: {},
    expect: ({ manifest }) => {
      if (manifest.capabilities === null) return "the manifest declares no capabilities (120 B-2)";
      const derived = tierFor(manifest.capabilities);
      return derived === manifest.capabilityTier ? null : `capabilityTier ${manifest.capabilityTier} disagrees with its tokens (${derived})`;
    },
  },
  {
    name: "denial-retained",
    request: {},
    expect: ({ result }) => {
      if (result.classification.kind !== "completed") return `expected completed, got ${result.classification.kind}`;
      if (result.denials !== 1) return `expected denials 1 beside completed, got ${result.denials}`;
      if (result.denialSamples.length !== 1) return `expected one denial sample, got ${result.denialSamples.length}`;
      return null;
    },
  },
  {
    name: "required-refused",
    request: {},
    expect: ({ result, records, providerStarted }) => {
      if (result.classification.kind !== "crashed") return `expected crashed, got ${result.classification.kind}`;
      if (!records.some((r) => r.kind === "driver.refused")) return "no driver.refused record";
      if (providerStarted === true) return "the provider started for a session the seam refused";
      if (records.some((r) => r.kind === "session.init")) return "a session.init was journaled for a refused session";
      return null;
    },
  },
  {
    name: "hang-killed",
    request: { timeoutMs: 700, killGraceMs: 200 },
    expect: ({ result, childPid }) => {
      if (result.classification.kind !== "timeout") return `expected timeout, got ${result.classification.kind} (${result.classification.detail})`;
      if (childPid !== null && pidAlive(childPid)) return `the provider's descendant ${childPid} survived the deadline`;
      return null;
    },
  },
  {
    name: "malformed-stream",
    request: {},
    expect: ({ result }) => {
      if (result.classification.kind !== "crashed") return `expected crashed, got ${result.classification.kind}`;
      return result.classification.detail.length === 0 ? "no detail for the malformed stream" : null;
    },
  },
  {
    name: "cost-unknown",
    request: {},
    expect: ({ result }) => {
      if (result.classification.kind !== "completed") return `expected completed, got ${result.classification.kind}`;
      return result.costMicroUsd === null ? null : `cost must be null when unreported, got ${result.costMicroUsd}`;
    },
  },
  {
    name: "records-agree",
    request: {},
    expect: ({ result, records }) => {
      const init = records.find((r) => r.kind === "session.init");
      const last = [...records].reverse().find((r) => r.kind === "session.result");
      if (init === undefined) return "no session.init record";
      if (last === undefined) return "no session.result record";
      const initKeys = Object.keys(init.payload as object);
      const missingInit = SESSION_INIT_KEYS.filter((k) => !initKeys.includes(k));
      if (missingInit.length > 0) return `session.init lacks ${missingInit.join(", ")}`;
      const resultKeys = Object.keys(last.payload as object);
      const missingResult = SESSION_RESULT_KEYS.filter((k) => !resultKeys.includes(k));
      if (missingResult.length > 0) return `session.result lacks ${missingResult.join(", ")}`;
      const journaled = (last.payload as { classification: string }).classification;
      return journaled === result.classification.kind ? null : `session.result says ${journaled}, the result says ${result.classification.kind}`;
    },
  },
];

// --- the targets (B-3) --------------------------------------------------------

// What one case needs from a target: the environment the driver runs under,
// the prompt, and where the provider's marker and descendant pid land.
export interface CasePreparation {
  readonly env: Record<string, string>;
  readonly prompt: string;
  readonly profile?: ExecutionProfile;
  readonly markerPath: string | null;
  readonly childPidPath: string | null;
}

export interface ConformanceTarget {
  // The driver name the seam resolves (fixture, claude, codex).
  readonly name: string;
  // The base environment: the member directory, the driver binary.
  readonly env: Record<string, string>;
  prepare(caseName: ConformanceCaseName, dir: string): CasePreparation;
}

export interface ConformanceReport {
  readonly driver: string;
  readonly passed: readonly ConformanceCaseName[];
  readonly failed: readonly { readonly name: ConformanceCaseName; readonly detail: string }[];
}

async function readManifest(name: string, env: Record<string, string>): Promise<ManifestShape> {
  const resolved = resolveDriverCommand(name, env);
  if (resolved === null) throw new Error(`conformance: no driver member for "${name}"`);
  const proc = Bun.spawn([...resolved.argv, "--member-manifest"], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env });
  const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) throw new Error(`conformance: ${name} --member-manifest exited ${code}`);
  const parsed = JSON.parse(text) as { capabilityTier: string; capabilities?: unknown };
  return {
    capabilityTier: parsed.capabilityTier,
    capabilities: parsed.capabilities === undefined || parsed.capabilities === null ? null : parseCapabilityList(parsed.capabilities, "manifest"),
  };
}

// A token the manifest does not declare, for `required-refused`; null when
// it declares all six (the fixture narrows its own through the environment).
export function unsupportedTokenOf(manifest: ManifestShape): Capability | null {
  const all: Capability[] = ["tool-allowlist", "max-turns", "mcp-config", "cost", "workspace-write", "hook-enforcement"];
  const supported = manifest.capabilities ?? [];
  return all.find((c) => !supported.includes(c)) ?? null;
}

export async function runConformance(target: ConformanceTarget, options: { readonly only?: readonly ConformanceCaseName[] } = {}): Promise<ConformanceReport> {
  const passed: ConformanceCaseName[] = [];
  const failed: { name: ConformanceCaseName; detail: string }[] = [];
  const manifest = await readManifest(target.name, target.env);
  for (const c of CONFORMANCE_CASES) {
    if (options.only !== undefined && !options.only.includes(c.name)) continue;
    const dir = mkdtempSync(join(tmpdir(), `conformance-${target.name}-${c.name}-`));
    const prep = target.prepare(c.name, dir);
    const env = { ...target.env, ...prep.env };
    const journal = openJournal(join(dir, "journal"), "orchestrator");
    try {
      let driver: Driver;
      let result: SessionResult;
      try {
        driver = createProcessDriver({ name: target.name, env });
        const required = c.name === "required-refused" ? unsupportedTokenOf(await readManifest(target.name, env)) : null;
        if (c.name === "required-refused" && required === null) {
          failed.push({ name: c.name, detail: "the manifest declares every token; nothing to refuse" });
          continue;
        }
        result = await driver.runSession({
          repo: dir,
          prompt: prep.prompt,
          timeoutMs: 10_000,
          ...c.request,
          profile: { ...(prep.profile ?? { mode: "bypass" }), ...(required === null ? {} : { require: [required] }) },
          journal,
        });
      } catch (err) {
        failed.push({ name: c.name, detail: `threw: ${(err as Error).message}` });
        continue;
      }
      const childPid = prep.childPidPath !== null && existsSync(prep.childPidPath) ? Number(readFileSync(prep.childPidPath, "utf8").trim()) : null;
      // Give a killed descendant a moment to be reaped before it is checked.
      if (childPid !== null) await Bun.sleep(200);
      const run: CaseRun = {
        result,
        records: journal.fold().records,
        providerStarted: prep.markerPath === null ? null : existsSync(prep.markerPath),
        childPid,
        manifest,
      };
      const detail = c.expect(run);
      if (detail === null) passed.push(c.name);
      else failed.push({ name: c.name, detail });
    } finally {
      journal.close();
    }
  }
  return { driver: target.name, passed, failed };
}

// --- the fixture target (B-1, B-3) ---------------------------------------------

// The fixture driver is its own provider: the case is the prompt.
export function fixtureTarget(env: Record<string, string>): ConformanceTarget {
  return {
    name: "fixture",
    env,
    prepare(caseName, dir) {
      const markerPath = join(dir, "started");
      const base = { [FIXTURE_MARKER_ENV]: markerPath };
      switch (caseName) {
        case "denial-retained":
          return { env: base, prompt: "deny-then-complete", markerPath, childPidPath: null };
        case "required-refused":
          // The fixture declares five tokens for this case, so there is one
          // to require and refuse.
          return {
            env: { ...base, [FIXTURE_CAPABILITIES_ENV]: "tool-allowlist,max-turns,mcp-config,cost,hook-enforcement" },
            prompt: "complete",
            markerPath,
            childPidPath: null,
          };
        case "hang-killed":
          return { env: base, prompt: "hang 30000 with-child", markerPath, childPidPath: `${markerPath}.child` };
        case "malformed-stream":
          return { env: base, prompt: "malformed", markerPath, childPidPath: null };
        case "cost-unknown":
          return { env: base, prompt: "no-cost", markerPath, childPidPath: null };
        default:
          return { env: base, prompt: "complete", markerPath, childPidPath: null };
      }
    },
  };
}

// --- the real drivers over fake providers (B-3) --------------------------------

function fakeScript(dir: string, name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

// The Claude stream, per case, as the parity fixtures write it.
export function claudeTarget(env: Record<string, string>): ConformanceTarget {
  return {
    name: "claude",
    env,
    prepare(caseName, dir) {
      const markerPath = join(dir, "started");
      const childPidPath = join(dir, "child.pid");
      const started = `[ "$1" = "--version" ] && { echo "fake-claude 0.0.0"; exit 0; }\ntouch "${markerPath}"\n`;
      const init = `echo '{"type":"system","subtype":"init","session_id":"s"}'`;
      const done = `echo '{"type":"result","subtype":"success","is_error":false,"result":"DONE","total_cost_usd":0.001,"usage":{"input_tokens":1,"output_tokens":1},"num_turns":1,"session_id":"s"}'`;
      const doneNoCost = `echo '{"type":"result","subtype":"success","is_error":false,"result":"DONE","usage":{"input_tokens":1,"output_tokens":1},"num_turns":1,"session_id":"s"}'`;
      const denied = `echo '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t","is_error":true,"content":"Bash operation blocked by hook: [pr-gate] BLOCKED"}]}}'`;
      const bodies: Record<ConformanceCaseName, string> = {
        "manifest-agrees": `${started}${init}\n${done}\nexit 0`,
        "denial-retained": `${started}${init}\n${denied}\n${done}\nexit 0`,
        "required-refused": `${started}${init}\n${done}\nexit 0`,
        "hang-killed": `${started}${init}\nsleep 30 & echo $! > "${childPidPath}"; wait $!`,
        "malformed-stream": `${started}echo 'not json'\necho 'still not'\nexit 0`,
        "cost-unknown": `${started}${init}\n${doneNoCost}\nexit 0`,
        "records-agree": `${started}${init}\n${done}\nexit 0`,
      };
      const bin = fakeScript(dir, "fake-claude.sh", bodies[caseName]);
      return { env: { STATECRAFT_CLAUDE_BIN: bin }, prompt: "reply DONE", markerPath, childPidPath: caseName === "hang-killed" ? childPidPath : null };
    },
  };
}

// The Codex stream, per case, as doc 03 recorded it.
export function codexTarget(env: Record<string, string>): ConformanceTarget {
  return {
    name: "codex",
    env,
    prepare(caseName, dir) {
      const markerPath = join(dir, "started");
      const childPidPath = join(dir, "child.pid");
      const started = `[ "$1" = "--version" ] && { echo "codex-cli 0.0.0"; exit 0; }\ntouch "${markerPath}"\ncat > /dev/null\n`;
      const thread = `echo '{"type":"thread.started","thread_id":"01a08750-bdaa-79f0-90b5-bc60371a2f53"}'`;
      const message = `echo '{"type":"item.completed","item":{"id":"i","type":"agent_message","text":"DONE"}}'`;
      const done = `echo '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'`;
      const denied = `echo '{"type":"item.completed","item":{"id":"c","type":"command_execution","command":"gh pr create","aggregated_output":"Command blocked by PreToolUse hook: [pr-gate] BLOCKED","exit_code":2,"status":"failed"}}'`;
      const bodies: Record<ConformanceCaseName, string> = {
        "manifest-agrees": `${started}${thread}\n${message}\n${done}\nexit 0`,
        "denial-retained": `${started}${thread}\n${denied}\n${message}\n${done}\nexit 0`,
        "required-refused": `${started}${thread}\n${done}\nexit 0`,
        "hang-killed": `${started}${thread}\nsleep 30 & echo $! > "${childPidPath}"; wait $!`,
        "malformed-stream": `${started}echo 'not json'\nexit 0`,
        "cost-unknown": `${started}${thread}\n${message}\n${done}\nexit 0`,
        "records-agree": `${started}${thread}\n${message}\n${done}\nexit 0`,
      };
      const bin = fakeScript(dir, "fake-codex.sh", bodies[caseName]);
      return {
        env: { STATECRAFT_CODEX_BIN: bin },
        prompt: "reply DONE",
        // Guarded, so the profile's list is a token Codex lacks: the
        // required-refused case names tool-allowlist.
        profile: { mode: "guarded", driver: "codex" },
        markerPath,
        childPidPath: caseName === "hang-killed" ? childPidPath : null,
      };
    },
  };
}

export function renderReport(report: ConformanceReport): string {
  const lines = [`conformance: ${report.driver}: ${report.passed.length} passed, ${report.failed.length} failed`];
  for (const f of report.failed) lines.push(`  FAIL ${f.name}: ${f.detail}`);
  return lines.join("\n");
}
