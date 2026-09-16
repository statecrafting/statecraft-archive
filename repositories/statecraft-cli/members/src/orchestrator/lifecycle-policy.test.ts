// Spec 123 FR-001: the policy parses and refuses as B-1 says; the legacy
// fold is the default; the registration probe reads the target's file once
// and the fold never reads it; the set verb journals and re-folds.

import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  DEFAULT_LIFECYCLE_POLICY,
  LEGACY_LIFECYCLE_POLICY,
  POLICY_FILE,
  parseLifecyclePolicy,
  parseRecordedPolicy,
  policyPayload,
  probeLifecyclePolicy,
  renderPolicy,
} from "./lifecycle-policy";
import { openProjectsChain, registerProject, setProjectPolicy, foldProjects, PROJECT_KINDS } from "./projects";
import { POLICY_SENSITIVE_PREFIXES } from "./receipt";

test("B-1: every key is optional and defaults; the whole policy round-trips through its payload", () => {
  expect(parseLifecyclePolicy({}, "t")).toEqual(DEFAULT_LIFECYCLE_POLICY);
  expect(DEFAULT_LIFECYCLE_POLICY.sensitive.prefixes).toEqual(POLICY_SENSITIVE_PREFIXES);
  const full = parseLifecyclePolicy(
    {
      schedulable: { statuses: ["approved", "draft"], namedDraft: true },
      merge: { method: "rebase" },
      sensitive: { prefixes: ["Makefile", "ci/"], onTouch: "human" },
      humanGate: "ship",
    },
    "t"
  );
  expect(full).toEqual({
    schedulable: { statuses: ["approved", "draft"], namedDraft: true },
    merge: { method: "rebase" },
    sensitive: { prefixes: ["Makefile", "ci/"], onTouch: "human" },
    humanGate: "ship",
  });
  const payload = policyPayload(full, "cli");
  expect(parseRecordedPolicy(payload, "t")).toEqual({ ...full, source: "cli", legacy: false });
  // A partial object keeps the defaults for what it does not name.
  expect(parseLifecyclePolicy({ merge: { method: "merge" } }, "t")).toEqual({ ...DEFAULT_LIFECYCLE_POLICY, merge: { method: "merge" } });
});

test("B-1: an unknown key, an empty status list, an unknown merge method, touch rule or stage refuses", () => {
  expect(() => parseLifecyclePolicy({ schedule: {} }, "t")).toThrow(/unknown key "schedule"/);
  expect(() => parseLifecyclePolicy({ schedulable: { statuses: [] } }, "t")).toThrow(/at least one status/);
  expect(() => parseLifecyclePolicy({ schedulable: { drafts: true } }, "t")).toThrow(/unknown key "drafts"/);
  expect(() => parseLifecyclePolicy({ merge: { method: "fast-forward" } }, "t")).toThrow(/merge.method/);
  expect(() => parseLifecyclePolicy({ sensitive: { onTouch: "refuse" } }, "t")).toThrow(/sensitive.onTouch/);
  expect(() => parseLifecyclePolicy({ humanGate: "deploy" }, "t")).toThrow(/humanGate/);
  expect(() => parseLifecyclePolicy("squash", "t")).toThrow(/expected a JSON object/);
  expect(() => parseRecordedPolicy({ policy: {}, source: "web" }, "t")).toThrow(/unknown source/);
});

test("B-2: the legacy fold is the default, flagged; a set record replaces it whole", () => {
  expect(LEGACY_LIFECYCLE_POLICY).toEqual({ ...DEFAULT_LIFECYCLE_POLICY, source: "default", legacy: true });
  const home = mkdtempSync(join(tmpdir(), "policy-chain-"));
  const chain = openProjectsChain(home);
  try {
    const target = mkdtempSync(join(tmpdir(), "policy-target-"));
    registerProject({ chain, name: "alpha", repoDir: target, qualification: { qualified: true, checks: [], warnings: [] }, source: "cli" });
    let alpha = foldProjects(chain.fold().records).get("alpha")!;
    // No file at the target: the default, sourced as such, not legacy.
    expect(alpha.policy).toEqual({ ...DEFAULT_LIFECYCLE_POLICY, source: "default", legacy: false });

    setProjectPolicy({ chain, name: "alpha", policy: { ...DEFAULT_LIFECYCLE_POLICY, humanGate: "verify" }, source: "api" });
    alpha = foldProjects(chain.fold().records).get("alpha")!;
    expect(alpha.policy.humanGate).toBe("verify");
    expect(alpha.policy.source).toBe("api");
    expect(chain.fold().records.filter((r) => r.kind === PROJECT_KINDS.policySet).length).toBe(2);
  } finally {
    chain.close();
  }
});

test("B-2: registration probes the target's policy file once; the fold never reads it", () => {
  const target = mkdtempSync(join(tmpdir(), "policy-target-"));
  mkdirSync(join(target, ".statecraft"));
  writeFileSync(join(target, POLICY_FILE), JSON.stringify({ schedulable: { statuses: ["approved", "draft"], namedDraft: true }, merge: { method: "merge" } }));
  expect(probeLifecyclePolicy(target)).toEqual({
    policy: { ...DEFAULT_LIFECYCLE_POLICY, schedulable: { statuses: ["approved", "draft"], namedDraft: true }, merge: { method: "merge" } },
    source: "file",
  });

  const home = mkdtempSync(join(tmpdir(), "policy-chain-"));
  const chain = openProjectsChain(home);
  try {
    registerProject({ chain, name: "beta", repoDir: target, qualification: { qualified: true, checks: [], warnings: [] }, source: "cli" });
    const before = foldProjects(chain.fold().records).get("beta")!.policy;
    expect(before.source).toBe("file");
    expect(before.merge.method).toBe("merge");
    // The file changes after registration: the fold is a function of the
    // chain and does not follow it (041 D-2).
    writeFileSync(join(target, POLICY_FILE), JSON.stringify({ merge: { method: "rebase" } }));
    expect(foldProjects(chain.fold().records).get("beta")!.policy).toEqual(before);
  } finally {
    chain.close();
  }

  // A malformed file refuses the registration with the reason.
  writeFileSync(join(target, POLICY_FILE), "{not json");
  expect(() => probeLifecyclePolicy(target)).toThrow(/is not JSON/);
  writeFileSync(join(target, POLICY_FILE), JSON.stringify({ humanGate: "deploy" }));
  expect(() => probeLifecyclePolicy(target)).toThrow(/humanGate/);
});

test("B-2: the detail block names the source, the statuses, the merge, the sensitive rule and the gate", () => {
  const lines = renderPolicy({ ...DEFAULT_LIFECYCLE_POLICY, schedulable: { statuses: ["approved", "draft"], namedDraft: true }, humanGate: "ship", source: "file", legacy: false });
  expect(lines[0]).toBe("policy:  file");
  expect(lines[1]).toContain("approved, draft (a named draft may build)");
  expect(lines[2]).toContain("squash");
  expect(lines[3]).toContain("on touch record");
  expect(lines[4]).toContain("human gate: ship");
  expect(renderPolicy(LEGACY_LIFECYCLE_POLICY)[0]).toBe("policy:  default (no policy record on the chain)");
});
