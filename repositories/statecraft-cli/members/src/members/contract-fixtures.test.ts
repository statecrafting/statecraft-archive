// Spec 111 B-5: every fixture the contract crate's tests write is parsed here
// through the TypeScript codecs and round-tripped. The Rust side fails first
// when a shape moves (its fixture test compares bytes); this side fails when
// the TypeScript codecs no longer read what Rust writes, which is the
// cross-language check the merge was for until the members are Rust.
import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { parseDriverEvent, type SessionResult } from "../orchestrator/driver";
import { parseRequest } from "./driver-session";
import { DRIVER_MANIFEST, MEMBER_MANIFESTS, type MemberManifest } from "./manifest";
import { CAPABILITIES, tierFor, type Capability } from "../orchestrator/capabilities";

const FIXTURES = join(import.meta.dir, "..", "..", "..", "crates", "statecraft-contract", "fixtures");

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as T;
}

test("every fixture file is claimed by a test below", () => {
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".json")).sort();
  expect(files).toEqual([
    "capabilities.json",
    "child-env-deny.json",
    "driver-events.json",
    "envelope-error-status.json",
    "envelope-error.json",
    "envelope-ok.json",
    "exit-codes.json",
    "manifest-driver-codex.json",
    "manifest-driver.json",
    "manifest-engine.json",
    "manifest-sensor.json",
    "session-request-minimal.json",
    "session-request.json",
    "session-result-completed.json",
    "session-result-quota.json",
  ]);
});

test("the three manifests the crate writes equal the three this repository declares, modulo version", () => {
  for (const declared of MEMBER_MANIFESTS) {
    const suffix = declared.name.replace("statecraft-", "").split("-")[0];
    const written = fixture<MemberManifest>(`manifest-${suffix}`);
    expect({ ...written, version: declared.version }).toEqual(declared);
  }
});

test("the exit codes agree with what the umbrella reserves and what the engine declares", () => {
  const codes = fixture<{ floor: number; memberNotFound: number; manifestRefused: number; contractSkew: number; unknownSubverb: number; d4: Record<string, string> }>("exit-codes");
  expect(codes).toEqual({
    floor: 64,
    memberNotFound: 64,
    manifestRefused: 65,
    contractSkew: 66,
    unknownSubverb: 67,
    d4: { "0": "ok", "1": "operational", "2": "unreachable", "3": "usage" },
  });
  for (const m of MEMBER_MANIFESTS) {
    for (const code of Object.keys(m.exitCodes)) expect(Number(code)).toBeLessThan(codes.floor);
  }
});

test("the envelope fixtures are the family's {ok, data|error} shape", () => {
  expect(fixture<unknown>("envelope-ok")).toEqual({ ok: true, data: { members: [] } });
  expect(fixture<unknown>("envelope-error")).toEqual({ ok: false, error: { kind: "unreachable", message: "no daemon at http://127.0.0.1:1" } });
  expect(fixture<unknown>("envelope-error-status")).toEqual({ ok: false, error: { kind: "api", message: "tenants not enabled on this control plane", status: 404 } });
});

test("the session requests parse through the driver member's request codec", () => {
  const full = parseRequest(JSON.stringify(fixture("session-request")), {});
  expect(full.options.repo).toBe("/work/target");
  expect(full.options.maxTurns).toBe(40);
  expect(full.options.timeoutMs).toBe(1_800_000);
  // 117 B-5: the driver rides in the profile on both sides of the seam;
  // 120 B-4: so does the require list.
  expect(full.options.profile).toEqual({ mode: "guarded", allowedTools: ["Read", "Bash(git:*)"], driver: "codex", require: ["workspace-write"] });
  // 120 B-3: the requirements parse, and absence reads as none (D-4).
  expect(full.options.requirements).toEqual({ required: ["workspace-write"], preferred: ["cost"] });
  // A strong tier with no explicit id resolves to the driver's default.
  expect(full.options.model).toBe("claude-opus-5");
  const minimal = parseRequest(JSON.stringify(fixture("session-request-minimal")), {});
  expect(minimal.options.model).toBeUndefined();
  expect(minimal.options.profile).toBeUndefined();
  expect(minimal.options.requirements).toBeUndefined();
});

test("120 B-1, B-2: the vocabulary and the manifests' tokens agree across the seam", () => {
  expect(fixture<string[]>("capabilities")).toEqual([...CAPABILITIES]);
  const claude = fixture<{ capabilityTier: string; capabilities: string[] }>("manifest-driver");
  expect(claude.capabilities).toEqual([...DRIVER_MANIFEST.capabilities]);
  expect(tierFor(claude.capabilities as Capability[])).toBe(claude.capabilityTier as "reference" | "basic");
  const codex = fixture<{ capabilityTier: string; capabilities: string[] }>("manifest-driver-codex");
  expect(codex.capabilities).toEqual(["workspace-write", "hook-enforcement"]);
  expect(tierFor(codex.capabilities as Capability[])).toBe("basic");
  expect(codex.capabilityTier).toBe("basic");
  for (const name of ["manifest-engine", "manifest-sensor"] as const) {
    expect(fixture<{ capabilities: string[] }>(name).capabilities).toEqual([]);
  }
});

test("the session results carry every field session.ts produces, and the events parse", () => {
  const completed = fixture<SessionResult>("session-result-completed");
  expect(Object.keys(completed).sort()).toEqual(
    ["classification", "costMicroUsd", "denialSamples", "denials", "durationMs", "exitCode", "numTurns", "overflow", "sessionId", "stderrTail", "transcriptPath", "usage"].sort()
  );
  expect(completed.classification.kind).toBe("completed");
  // 119 B-6: a completed result with a denial is still completed.
  expect(completed.denials).toBe(1);
  expect(completed.denialSamples.length).toBe(1);
  const quota = fixture<SessionResult>("session-result-quota");
  expect(quota.classification.kind).toBe("quota");
  expect(quota.classification.resetAtMs).toBe(1_700_000_000_000);
  expect(quota.overflow.lines).toEqual(["not json"]);

  const events = fixture<unknown[]>("driver-events");
  const parsed = events.map((e) => parseDriverEvent(JSON.stringify(e)));
  expect(parsed.map((e) => e?.event)).toEqual(["stream", "journal", "result"]);
  const result = parsed[2];
  if (result?.event !== "result") throw new Error("expected a result event");
  expect(result.result).toEqual(completed);
});
