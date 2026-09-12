// Spec 123: the lifecycle policy (doc 04 D53). What a project will schedule
// (which statuses, whether a named draft may build), how it merges, which
// paths are policy-sensitive and what a receipt touching them does, and
// where a human gate stands. Registry state on the projects chain beside the
// gate contract (041), probed once from an optional file at registration and
// settable by verb; a fold is a pure function of the chain and never reads
// the file (041 D-2), so a candidate cannot change the policy that judges it
// by editing the file. Absent, the defaults are the loop's behavior before
// this spec.

import * as fs from "fs";
import { join } from "path";
import type { JsonValue } from "./journal";
import { POLICY_SENSITIVE_PREFIXES } from "./receipt";
import type { Stage } from "./state";

const STAGES: readonly Stage[] = ["build", "ship", "shepherd", "verify"];

export const MERGE_METHODS = ["squash", "merge", "rebase"] as const;
export type PolicyMergeMethod = (typeof MERGE_METHODS)[number];

export const ON_TOUCH = ["record", "human"] as const;
export type OnTouch = (typeof ON_TOUCH)[number];

export interface LifecyclePolicy {
  readonly schedulable: {
    // The spec statuses the scheduler will pick (012 B-1's `approved`).
    readonly statuses: readonly string[];
    // Whether a draft the operator names through run/start may build
    // (spec-spine's own lifecycle builds a named draft, then ratifies).
    readonly namedDraft: boolean;
  };
  readonly merge: { readonly method: PolicyMergeMethod };
  readonly sensitive: {
    // Repository-relative prefixes (a trailing slash matches beneath).
    readonly prefixes: readonly string[];
    // What a receipt whose sensitive paths are non-empty does: recorded,
    // or the spec is put at the human gate before ship.
    readonly onTouch: OnTouch;
  };
  // A stage every spec pauses before, or none.
  readonly humanGate: Stage | null;
}

// The policy sources, as the gate contract's are (041 B-2): where this
// record came from.
export const POLICY_SOURCES = ["default", "file", "cli", "api"] as const;
export type PolicySource = (typeof POLICY_SOURCES)[number];

export interface RecordedLifecyclePolicy extends LifecyclePolicy {
  readonly source: PolicySource;
  // True for a chain that predates this spec: the default, read as such.
  readonly legacy: boolean;
}

export const DEFAULT_LIFECYCLE_POLICY: LifecyclePolicy = {
  schedulable: { statuses: ["approved"], namedDraft: false },
  merge: { method: "squash" },
  sensitive: { prefixes: POLICY_SENSITIVE_PREFIXES, onTouch: "record" },
  humanGate: null,
};

export const LEGACY_LIFECYCLE_POLICY: RecordedLifecyclePolicy = { ...DEFAULT_LIFECYCLE_POLICY, source: "default", legacy: true };

// The file a registration probes, once, read-only (B-2). A literal, not
// `join(...)` at load: the web UI's bundle reaches this module through
// api-client.ts's `policyPayload`, and in a browser `path` is an empty stub, so
// a call here at module load stopped the page before it rendered (128 D-15).
// Members are unix-only (108 D-10), so the separator is the one `join` gave.
export const POLICY_FILE = ".statecraft/policy.json";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringList(value: unknown, field: string, label: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new Error(`policy: ${label} expected a string list for "${field}"`);
  }
  return [...(value as string[])];
}

function refuseUnknown(obj: Record<string, unknown>, known: readonly string[], where: string, label: string): void {
  for (const key of Object.keys(obj)) {
    if (!known.includes(key)) throw new Error(`policy: ${label} has an unknown key "${key}" in ${where}`);
  }
}

// Reads a policy out of a payload. Every key is optional and defaults; an
// unknown key, an empty status list, an unknown merge method, touch rule or
// stage refuses (B-1): a policy that cannot be read is not one anyone
// should be driven under.
export function parseLifecyclePolicy(value: unknown, label: string): LifecyclePolicy {
  if (!isRecord(value)) throw new Error(`policy: ${label} expected a JSON object`);
  refuseUnknown(value, ["schedulable", "merge", "sensitive", "humanGate"], "the policy", label);

  let schedulable = DEFAULT_LIFECYCLE_POLICY.schedulable;
  if (value.schedulable !== undefined) {
    if (!isRecord(value.schedulable)) throw new Error(`policy: ${label} expected an object for "schedulable"`);
    refuseUnknown(value.schedulable, ["statuses", "namedDraft"], '"schedulable"', label);
    const statuses = value.schedulable.statuses === undefined ? [...schedulable.statuses] : stringList(value.schedulable.statuses, "schedulable.statuses", label);
    if (statuses.length === 0) throw new Error(`policy: ${label} "schedulable.statuses" must name at least one status`);
    const namedDraft = value.schedulable.namedDraft ?? schedulable.namedDraft;
    if (typeof namedDraft !== "boolean") throw new Error(`policy: ${label} expected a boolean for "schedulable.namedDraft"`);
    schedulable = { statuses, namedDraft };
  }

  let merge = DEFAULT_LIFECYCLE_POLICY.merge;
  if (value.merge !== undefined) {
    if (!isRecord(value.merge)) throw new Error(`policy: ${label} expected an object for "merge"`);
    refuseUnknown(value.merge, ["method"], '"merge"', label);
    const method = value.merge.method ?? merge.method;
    if (typeof method !== "string" || !(MERGE_METHODS as readonly string[]).includes(method)) {
      throw new Error(`policy: ${label} "merge.method" must be one of ${MERGE_METHODS.join(", ")}, got ${JSON.stringify(method)}`);
    }
    merge = { method: method as PolicyMergeMethod };
  }

  let sensitive = DEFAULT_LIFECYCLE_POLICY.sensitive;
  if (value.sensitive !== undefined) {
    if (!isRecord(value.sensitive)) throw new Error(`policy: ${label} expected an object for "sensitive"`);
    refuseUnknown(value.sensitive, ["prefixes", "onTouch"], '"sensitive"', label);
    const prefixes = value.sensitive.prefixes === undefined ? [...sensitive.prefixes] : stringList(value.sensitive.prefixes, "sensitive.prefixes", label);
    const onTouch = value.sensitive.onTouch ?? sensitive.onTouch;
    if (typeof onTouch !== "string" || !(ON_TOUCH as readonly string[]).includes(onTouch)) {
      throw new Error(`policy: ${label} "sensitive.onTouch" must be one of ${ON_TOUCH.join(", ")}, got ${JSON.stringify(onTouch)}`);
    }
    sensitive = { prefixes, onTouch: onTouch as OnTouch };
  }

  let humanGate: Stage | null = DEFAULT_LIFECYCLE_POLICY.humanGate;
  if (value.humanGate !== undefined) {
    if (value.humanGate === null) humanGate = null;
    else if (typeof value.humanGate === "string" && (STAGES as readonly string[]).includes(value.humanGate)) humanGate = value.humanGate as Stage;
    else throw new Error(`policy: ${label} "humanGate" must be one of ${STAGES.join(", ")} or null, got ${JSON.stringify(value.humanGate)}`);
  }

  return { schedulable, merge, sensitive, humanGate };
}

export function policyPayload(policy: LifecyclePolicy, source: PolicySource): Record<string, JsonValue> {
  return {
    policy: {
      schedulable: { statuses: [...policy.schedulable.statuses], namedDraft: policy.schedulable.namedDraft },
      merge: { method: policy.merge.method },
      sensitive: { prefixes: [...policy.sensitive.prefixes], onTouch: policy.sensitive.onTouch },
      humanGate: policy.humanGate,
    },
    source,
  };
}

// The chain's record back out: the whole policy and its source.
export function parseRecordedPolicy(payload: Record<string, unknown>, label: string): RecordedLifecyclePolicy {
  const source = payload.source;
  if (typeof source !== "string" || !(POLICY_SOURCES as readonly string[]).includes(source)) {
    throw new Error(`policy: ${label} carries an unknown source ${JSON.stringify(source)}`);
  }
  return { ...parseLifecyclePolicy(payload.policy, label), source: source as PolicySource, legacy: false };
}

// B-2: the one read of the target's file, at registration. Absent is the
// default; present and malformed refuses the registration with the reason,
// because a policy the operator wrote and the engine misread is worse than
// none.
export function probeLifecyclePolicy(repoDir: string): { policy: LifecyclePolicy; source: PolicySource } {
  const path = join(repoDir, POLICY_FILE);
  let text: string;
  try {
    text = fs.readFileSync(path, "utf8");
  } catch {
    return { policy: DEFAULT_LIFECYCLE_POLICY, source: "default" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`policy: ${path} is not JSON: ${(err as Error).message}`);
  }
  return { policy: parseLifecyclePolicy(parsed, path), source: "file" };
}

// The detail view's block (B-2).
export function renderPolicy(policy: RecordedLifecyclePolicy): string[] {
  const from = policy.legacy ? "default (no policy record on the chain)" : policy.source;
  return [
    `policy:  ${from}`,
    `         schedules: ${policy.schedulable.statuses.join(", ")}${policy.schedulable.namedDraft ? " (a named draft may build)" : ""}`,
    `         merges: ${policy.merge.method}`,
    `         sensitive: ${policy.sensitive.prefixes.length} prefix(es), on touch ${policy.sensitive.onTouch}`,
    `         human gate: ${policy.humanGate ?? "none"}`,
  ];
}
