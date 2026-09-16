---
id: "063-coherence-scoring"
title: "Coherence Scoring with Privilege Degradation"
feature_branch: "063-coherence-scoring"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Coherence scoring system that computes a 0-1 score from violation rate, rework
  frequency, and intent drift. The score maps to privilege levels: full (>0.7),
  restricted (0.5-0.7), read-only (0.3-0.5), suspended (<0.3). Capabilities
  degrade progressively rather than failing binary pass/fail. Includes a proof
  chain audit trail with cryptographic hash-chained records and a conformance
  kit for acceptance testing of coherence enforcement.
code_aliases:
  - COHERENCE_SCORE
sources:
  - ruflo
establishes:
  - unit: { kind: file, path: crates/policy-kernel/src/coherence.rs }
extends:
  - spec: "036-safety-tier-governance"
    nature: additive
    unit: { kind: crate, id: open_agentic_policy_kernel }
---

# Feature Specification: Coherence Scoring with Privilege Degradation

## Purpose

The platform currently enforces governance through binary gates — an action either passes or fails. This creates a poor experience: a single violation can block all operations, and there is no graduated response that preserves partial productivity while signaling degraded trust. There is also no continuous measure of how well an agent or session is adhering to its intended purpose over time, and no tamper-evident audit trail of governance decisions.

This feature introduces coherence scoring, a continuous metric (0 to 1) that reflects how aligned an agent's behavior is with its stated intent. The score drives progressive privilege degradation: as coherence drops, capabilities are restricted incrementally rather than cut off entirely. A cryptographic proof chain provides a tamper-evident audit trail of all scoring events and governance decisions. A conformance kit provides acceptance tests to verify that coherence enforcement works correctly.

## Scope

### In scope

- **Coherence score computation**: A scoring function that takes violation rate, rework frequency, and intent drift as inputs and produces a 0-1 score.
- **Privilege level mapping**: Four privilege levels — full (>0.7), restricted (0.5-0.7), read-only (0.3-0.5), suspended (<0.3) — with defined capability sets for each.
- **Progressive capability restriction**: As the coherence score drops, capabilities are removed incrementally according to the privilege level.
- **Proof chain audit trail**: Every scoring event, privilege transition, and governance decision is recorded as a hash-chained record, forming a tamper-evident log.
- **Conformance kit**: A suite of acceptance tests that verify coherence scoring, privilege mapping, and degradation behavior.
- **Score recovery**: Mechanism for coherence score to recover over time as behavior improves.

### Out of scope

- **ML-based intent drift detection**: The initial implementation uses heuristic intent drift measures; ML-based detection is a follow-on.
- **Cross-session coherence**: Scores are per-session; aggregating coherence across sessions is deferred.
- **User-facing coherence dashboard**: Visualization of coherence trends is a separate UI concern.
- **Blockchain or distributed ledger**: The proof chain is a local hash chain, not a distributed consensus mechanism.

## Requirements

### Functional

- **FR-001**: The coherence score is a float in [0.0, 1.0] computed from three weighted inputs: violation rate (weight configurable, default 0.4), rework frequency (default 0.3), and intent drift (default 0.3).
- **FR-002**: Violation rate is the ratio of governance violations to total governed actions in a sliding window (configurable, default last 50 actions).
- **FR-003**: Rework frequency is the ratio of actions that were reverted or redone to total actions in the same sliding window.
- **FR-004**: Intent drift is a measure of how far the current action context has diverged from the session's declared intent, computed via embedding similarity or keyword overlap (configurable strategy).
- **FR-005**: The coherence score maps to privilege levels: full (score > 0.7), restricted (0.5 < score <= 0.7), read-only (0.3 < score <= 0.5), suspended (score <= 0.3).
- **FR-006**: Each privilege level defines which capabilities are available:
  - Full: all capabilities enabled.
  - Restricted: no destructive file operations (delete, overwrite outside tracked files), no git push, no external network calls.
  - Read-only: file reads, git log/status/diff only, no writes of any kind.
  - Suspended: no tool use; agent can only produce text responses.
- **FR-007**: When the coherence score crosses a privilege level boundary, the system emits a `coherence:privilege_changed` event and adjusts the capability set immediately.
- **FR-008**: Coherence score recovers toward 1.0 as clean actions accumulate in the sliding window. The recovery rate is configurable (default: each clean action shifts the window, naturally improving the ratios).
- **FR-009**: Every coherence score computation, privilege level transition, and governance decision is recorded as a `ProofRecord` in a hash-chained audit trail. Each record contains the data payload, a SHA-256 hash of the payload, and the hash of the previous record.
- **FR-010**: The proof chain can be verified by recomputing hashes from the first record forward. Any tampering breaks the chain at the tampered record.
- **FR-011**: A conformance kit provides at least 10 acceptance tests covering: score computation from known inputs, privilege level mapping at boundary values, capability restriction enforcement at each level, proof chain integrity verification, and score recovery over a sequence of clean actions.

### Non-functional

- **NF-001**: Coherence score computation completes in < 5ms for a sliding window of 50 actions.
- **NF-002**: Proof chain append operation completes in < 2ms per record.
- **NF-003**: Proof chain verification of 1000 records completes in < 500ms.
- **NF-004**: The conformance kit runs in < 30 seconds with no external dependencies.

## Architecture

### Coherence score computation

```typescript
interface CoherenceInputs {
  violationRate: number;   // 0-1: violations / total actions in window
  reworkFrequency: number; // 0-1: reworks / total actions in window
  intentDrift: number;     // 0-1: 0 = perfectly aligned, 1 = fully diverged
}

interface CoherenceWeights {
  violationRate: number;   // default 0.4
  reworkFrequency: number; // default 0.3
  intentDrift: number;     // default 0.3
}

interface CoherenceResult {
  score: number;           // 0-1
  level: PrivilegeLevel;
  inputs: CoherenceInputs;
  weights: CoherenceWeights;
  windowSize: number;
  computedAt: string;      // ISO 8601
}

type PrivilegeLevel = "full" | "restricted" | "read_only" | "suspended";

function computeCoherence(inputs: CoherenceInputs, weights: CoherenceWeights): number {
  // score = 1 - weighted sum of negative signals
  return Math.max(0, Math.min(1,
    1 - (
      inputs.violationRate * weights.violationRate +
      inputs.reworkFrequency * weights.reworkFrequency +
      inputs.intentDrift * weights.intentDrift
    )
  ));
}
```

### Privilege level capabilities

```typescript
interface CapabilitySet {
  fileRead: boolean;
  fileWrite: boolean;
  fileDelete: boolean;
  gitRead: boolean;       // log, status, diff
  gitWrite: boolean;      // commit, push, branch
  networkAccess: boolean;
  toolUse: boolean;
  agentSpawn: boolean;
}

const PRIVILEGE_CAPABILITIES: Record<PrivilegeLevel, CapabilitySet> = {
  full:       { fileRead: true,  fileWrite: true,  fileDelete: true,  gitRead: true,  gitWrite: true,  networkAccess: true,  toolUse: true,  agentSpawn: true },
  restricted: { fileRead: true,  fileWrite: true,  fileDelete: false, gitRead: true,  gitWrite: false, networkAccess: false, toolUse: true,  agentSpawn: false },
  read_only:  { fileRead: true,  fileWrite: false, fileDelete: false, gitRead: true,  gitWrite: false, networkAccess: false, toolUse: false, agentSpawn: false },
  suspended:  { fileRead: false, fileWrite: false, fileDelete: false, gitRead: false, gitWrite: false, networkAccess: false, toolUse: false, agentSpawn: false },
};
```

### Proof chain

```typescript
interface ProofRecord {
  sequence: number;
  timestamp: string;          // ISO 8601
  eventType: "score_computed" | "privilege_changed" | "governance_decision" | "action_recorded";
  payload: unknown;           // The event data
  payloadHash: string;        // SHA-256 of JSON.stringify(payload)
  previousHash: string;       // Hash of the previous ProofRecord (empty string for first record)
  recordHash: string;         // SHA-256 of (sequence + timestamp + eventType + payloadHash + previousHash)
}

interface ProofChain {
  append(eventType: ProofRecord["eventType"], payload: unknown): ProofRecord;
  verify(): { valid: boolean; brokenAtSequence?: number };
  records(from?: number, to?: number): ProofRecord[];
  length: number;
}
```

### Integration flow

```
Agent action arrives
  |
  v
Governance engine evaluates action
  |
  +---> Record action outcome (violation / clean / rework) in sliding window
  |
  +---> Compute coherence score from window
  |       |
  |       +---> violation rate = violations / window size
  |       +---> rework frequency = reworks / window size
  |       +---> intent drift = drift measure from intent tracker
  |       +---> score = 1 - weighted sum
  |
  +---> Map score to privilege level
  |       |
  |       +---> If level changed: emit coherence:privilege_changed event
  |       +---> Update active capability set
  |
  +---> Append ProofRecord to proof chain
  |
  +---> Enforce capability set on current action
          |
          +---> Allow if capability enabled at current level
          +---> Reject with descriptive message if capability disabled
```

## Implementation approach

1. **Phase 1 — score computation**: Implement `computeCoherence()`, sliding window tracker, and `CoherenceResult` type. Unit tests for boundary values and weight configurations.
2. **Phase 2 — privilege level mapping**: Implement `PrivilegeLevel` mapping from score ranges and `CapabilitySet` definitions per level.
3. **Phase 3 — capability enforcement**: Wire coherence scoring into the governance engine so that the active capability set is checked before every governed action.
4. **Phase 4 — proof chain**: Implement `ProofChain` with SHA-256 hash chaining, append, and verify operations.
5. **Phase 5 — integration**: Connect the scoring pipeline to the governance engine's action recording, emit `coherence:privilege_changed` events on the event bus (Feature 060).
6. **Phase 6 — conformance kit**: Build the acceptance test suite covering all scoring, mapping, enforcement, and proof chain scenarios.

## Success criteria

- **SC-001**: Given known violation rate (0.5), rework frequency (0.2), and intent drift (0.1) with default weights, the computed score equals 0.67, mapping to privilege level "restricted".
- **SC-002**: An agent at privilege level "restricted" can read and write files but cannot delete files, push to git, or make network calls.
- **SC-003**: An agent whose coherence drops from 0.8 to 0.4 over a sequence of violations transitions from "full" to "read_only" with a `coherence:privilege_changed` event emitted at each boundary crossing.
- **SC-004**: A proof chain of 100 records verifies successfully. Modifying any single record's payload causes verification to report the exact broken sequence number.
- **SC-005**: After 20 consecutive clean actions following a period of violations, the coherence score recovers above 0.7 and the agent regains "full" privileges.
- **SC-006**: The conformance kit passes all acceptance tests in a clean environment with no external dependencies.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 035-agent-governed-execution | Coherence scoring plugs into the governance engine that evaluates every agent action |
| 036-safety-tier-governance | Safety tiers define which actions are governed; coherence adds progressive restriction within tiers |
| 060-panel-event-bus | `coherence:privilege_changed` events are emitted on the event bus |

## Risk

- **R-001**: Intent drift measurement is inherently fuzzy and may produce false positives that unfairly degrade privileges. Mitigation: intent drift weight is configurable and defaults to a conservative 0.3; operators can reduce or zero it.
- **R-002**: Proof chain storage grows unboundedly over long sessions. Mitigation: configurable maximum chain length with optional compaction (summarize and restart chain with a checkpoint record).
- **R-003**: Progressive degradation may confuse agents that lose capabilities mid-execution. Mitigation: capability restriction is announced via events before enforcement, giving the agent a chance to adjust its plan.
- **R-004**: Hash chain verification is O(n) in chain length. Mitigation: periodic checkpoint records allow partial verification from the last checkpoint.
