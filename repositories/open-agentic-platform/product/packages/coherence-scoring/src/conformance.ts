// ── Conformance Kit (spec 063, Phase 6) ─────────────────────────────
// Acceptance test helpers that can be run programmatically (FR-011).

import { computeCoherence, SlidingWindow } from "./scoring.js";
import { scoreToLevel, hasCapability } from "./privileges.js";
import { checkCapability, CapabilityDeniedError, enforceCapability } from "./enforcement.js";
import { ProofChain } from "./proof-chain.js";
import { CoherencePipeline } from "./pipeline.js";
import type { CoherenceResult, PrivilegeChangedEvent } from "./types.js";
import { DEFAULT_WEIGHTS } from "./types.js";

export interface ConformanceResult {
  name: string;
  passed: boolean;
  detail?: string;
}

/** Run all conformance checks. Returns results array. */
export function runConformanceKit(): ConformanceResult[] {
  return [
    testScoreComputation(),
    testScoreBoundaryFull(),
    testScoreBoundaryRestricted(),
    testScoreBoundaryReadOnly(),
    testScoreBoundarySuspended(),
    testRestrictedCapabilities(),
    testReadOnlyCapabilities(),
    testSuspendedCapabilities(),
    testProofChainIntegrity(),
    testProofChainTamperDetection(),
    testScoreRecovery(),
    testPrivilegeTransitionEvent(),
    testSlidingWindowEviction(),
    testEnforcementThrows(),
  ];
}

function testScoreComputation(): ConformanceResult {
  // SC-001: known inputs
  const score = computeCoherence(
    { violationRate: 0.5, reworkFrequency: 0.2, intentDrift: 0.1 },
  );
  const expected = 0.71;
  const passed = Math.abs(score - expected) < 0.001;
  return {
    name: "SC-001: score from known inputs",
    passed,
    detail: passed ? undefined : `expected ${expected}, got ${score}`,
  };
}

function testScoreBoundaryFull(): ConformanceResult {
  const level = scoreToLevel(0.71);
  return { name: "FR-005: score 0.71 → full", passed: level === "full" };
}

function testScoreBoundaryRestricted(): ConformanceResult {
  const level = scoreToLevel(0.7);
  return { name: "FR-005: score 0.7 → restricted", passed: level === "restricted" };
}

function testScoreBoundaryReadOnly(): ConformanceResult {
  const level = scoreToLevel(0.5);
  return { name: "FR-005: score 0.5 → read_only", passed: level === "read_only" };
}

function testScoreBoundarySuspended(): ConformanceResult {
  const level = scoreToLevel(0.3);
  return { name: "FR-005: score 0.3 → suspended", passed: level === "suspended" };
}

function testRestrictedCapabilities(): ConformanceResult {
  // SC-002: restricted can read/write but not delete/push/network
  const result: CoherenceResult = {
    score: 0.6, level: "restricted",
    inputs: { violationRate: 0, reworkFrequency: 0, intentDrift: 0 },
    weights: DEFAULT_WEIGHTS, windowSize: 10, computedAt: new Date().toISOString(),
  };
  const canRead = checkCapability("fileRead", result).allowed;
  const canWrite = checkCapability("fileWrite", result).allowed;
  const canDelete = checkCapability("fileDelete", result).allowed;
  const canPush = checkCapability("gitWrite", result).allowed;
  const canNetwork = checkCapability("networkAccess", result).allowed;
  const passed = canRead && canWrite && !canDelete && !canPush && !canNetwork;
  return { name: "SC-002: restricted capability enforcement", passed };
}

function testReadOnlyCapabilities(): ConformanceResult {
  const result: CoherenceResult = {
    score: 0.4, level: "read_only",
    inputs: { violationRate: 0, reworkFrequency: 0, intentDrift: 0 },
    weights: DEFAULT_WEIGHTS, windowSize: 10, computedAt: new Date().toISOString(),
  };
  const canRead = checkCapability("fileRead", result).allowed;
  const canWrite = checkCapability("fileWrite", result).allowed;
  const canTool = checkCapability("toolUse", result).allowed;
  const passed = canRead && !canWrite && !canTool;
  return { name: "FR-006: read_only capability enforcement", passed };
}

function testSuspendedCapabilities(): ConformanceResult {
  const result: CoherenceResult = {
    score: 0.1, level: "suspended",
    inputs: { violationRate: 0, reworkFrequency: 0, intentDrift: 0 },
    weights: DEFAULT_WEIGHTS, windowSize: 10, computedAt: new Date().toISOString(),
  };
  const canRead = checkCapability("fileRead", result).allowed;
  const canTool = checkCapability("toolUse", result).allowed;
  const passed = !canRead && !canTool;
  return { name: "FR-006: suspended capability enforcement", passed };
}

function testProofChainIntegrity(): ConformanceResult {
  const chain = new ProofChain({ now: () => new Date().toISOString() });
  for (let i = 0; i < 100; i++) {
    chain.append("action_recorded", { i });
  }
  const result = chain.verify();
  return { name: "SC-004: 100-record proof chain verifies", passed: result.valid };
}

function testProofChainTamperDetection(): ConformanceResult {
  const chain = new ProofChain({ now: () => new Date().toISOString() });
  for (let i = 0; i < 100; i++) {
    chain.append("action_recorded", { i });
  }
  // Tamper with record 42
  const records = chain.records();
  (records[42] as any).payload = { tampered: true };
  const result = chain.verify();
  const passed = !result.valid && result.brokenAtSequence === 42;
  return {
    name: "SC-004: tamper detection at exact sequence",
    passed,
    detail: passed ? undefined : `expected broken at 42, got ${result.brokenAtSequence}`,
  };
}

function testScoreRecovery(): ConformanceResult {
  // SC-005: recovery after 20 clean actions
  const p = new CoherencePipeline({ windowSize: 20 });
  for (let i = 0; i < 20; i++) p.recordAction("violation");
  const degradedLevel = p.level;

  for (let i = 0; i < 20; i++) p.recordAction("clean");
  const passed = p.score > 0.7 && p.level === "full" && degradedLevel !== "full";
  return { name: "SC-005: score recovery after 20 clean actions", passed };
}

function testPrivilegeTransitionEvent(): ConformanceResult {
  // SC-003: transition events emitted at boundary crossings
  const events: PrivilegeChangedEvent[] = [];
  const p = new CoherencePipeline({ windowSize: 5 });
  p.onPrivilegeChanged((e) => events.push(e));

  for (let i = 0; i < 5; i++) p.recordAction("violation");
  const passed = events.length > 0 && events[0].previousLevel === "full";
  return {
    name: "SC-003: privilege_changed event at boundary",
    passed,
    detail: passed ? undefined : `events: ${events.length}`,
  };
}

function testSlidingWindowEviction(): ConformanceResult {
  const w = new SlidingWindow({ windowSize: 5 });
  for (let i = 0; i < 5; i++) w.record("violation");
  for (let i = 0; i < 5; i++) w.record("clean");
  const passed = w.size === 5 && w.violationRate === 0;
  return { name: "FR-008: sliding window eviction enables recovery", passed };
}

function testEnforcementThrows(): ConformanceResult {
  const result: CoherenceResult = {
    score: 0.6, level: "restricted",
    inputs: { violationRate: 0, reworkFrequency: 0, intentDrift: 0 },
    weights: DEFAULT_WEIGHTS, windowSize: 10, computedAt: new Date().toISOString(),
  };
  let passed = false;
  try {
    enforceCapability("gitWrite", result);
  } catch (e) {
    passed = e instanceof CapabilityDeniedError && e.capability === "gitWrite";
  }
  return { name: "FR-007: enforceCapability throws on denied", passed };
}
