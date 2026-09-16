---
id: "231-reusable-primitive-reconsumption"
title: "Reusable-primitive re-consumption (policy-kernel delegates to the extracted Apache-2.0 cores)"
feature_branch: "231-reusable-primitive-reconsumption"
status: approved
implementation: complete
kind: capability
domain: platform
created: "2026-07-14"
authors: ["open-agentic-platform"]
language: en
summary: >
  Four domain-neutral primitives were extracted from crates/policy-kernel into
  standalone Apache-2.0 crates and published to crates.io: canonical-keysort-json
  (the key-sorted JSON serializer), attest-ledger (the hash-linked record + audit
  chains), trust-window (the rolling-window trust scorer), and action-gate (the
  pluggable decision gate). This spec re-consumes them: policy-kernel becomes a
  thin OAP-specific shim over the shared cores, exactly as OAP already consumes
  the external spec-spine CLI. The re-consumption keeps every OAP public SHAPE
  (ProofRecord, ProofChainAnchor, CoherenceScheduler, PrivilegeLevel,
  ToolCallContext, PolicyBundle, PolicyDecision, evaluate) byte-identical for its
  seven consumers and its two verifier binaries, and delegates only the
  internals: canonical_json_sorted -> canonical-keysort-json; link_record_hash /
  sha256_hex -> attest-ledger-core; CoherenceScheduler -> a trust-window
  WindowScorer (DegradeOnly); evaluate() -> an action-gate Gate whose six checks
  are OAP's six domain checks. Hash and signature parity is guaranteed by a
  byte-equality parity test and the crate's existing proof-chain, audit-chain,
  coherence, and evaluate test suites, all of which pass unchanged.
code_aliases: ["REUSABLE_PRIMITIVE_RECONSUMPTION", "PRIMITIVE_RECONSUMPTION"]
depends_on:
  - "047-governance-control-plane"
refines:
  # canonical_json_sorted now delegates to canonical-keysort-json; evaluate()
  # now runs an action-gate Gate over OAP's six checks. Behavior preserved.
  - aspect: "reconsume-canonical-json-and-action-gate"
    unit: { kind: file, path: crates/policy-kernel/src/lib.rs }
  # link_record_hash / sha256_hex delegate to attest-ledger-core (byte-identical).
  - aspect: "reconsume-attest-ledger-hashing"
    unit: { kind: file, path: crates/policy-kernel/src/proof_chain.rs }
  # CoherenceScheduler reimplemented over a trust-window WindowScorer (DegradeOnly).
  - aspect: "reconsume-trust-window-scorer"
    unit: { kind: file, path: crates/policy-kernel/src/coherence.rs }
  # The manifest gains the four extracted-crate dependencies.
  - aspect: "add-extracted-primitive-dependencies"
    unit: { kind: file, path: crates/policy-kernel/Cargo.toml }
extends:
  # Additive: spec 231 adds one feature-graph node. Regenerated golden per the
  # featuregraph-golden precedent specs 196/194/193/187/183/209/219 follow.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
references:
  - { unit: { kind: file, path: crates/policy-kernel/src/audit.rs }, role: context }
---

# 231: Reusable-primitive re-consumption

## 1. Purpose

`policy-kernel` fused six separable concerns behind one crate: a decision gate,
a signed hash-linked ledger, a rotating audit chain, a rolling-window trust
scorer, OAP's own six domain checks, and an unwired permission-runtime family.
The reusable cores of the first four were extracted into standalone Apache-2.0
crates (the same open-core pattern `tenant-emit` / `tenant-tail` follow) and
published to crates.io. This spec closes the loop: OAP becomes **consumer-zero**
of the extracted crates, the direct analog of OAP already consuming the external
`spec-spine` CLI rather than a vendored compiler.

The extracted crates and their published versions:

| Crate | crates.io | From | Delegated here |
|---|---|---|---|
| `canonical-keysort-json` | 0.1.0 | `crates/canonical-json` | `canonical_json_sorted` |
| `attest-ledger-core` | 0.1.0 | `proof_chain.rs` + pure `audit.rs` | `link_record_hash`, `sha256_hex` |
| `trust-window` | 0.1.0 | `coherence.rs` | `CoherenceScheduler` internals |
| `action-gate-core` | 0.1.0 | `lib.rs` (`evaluate`) | `evaluate()` gate machinery |

## 2. The invariant: keep the shapes, swap the internals

The re-consumption is a refactor, not a behavior change. Every public type and
function `policy-kernel`'s seven consumers and two verifier binaries touch is
preserved byte-identically:

- **Hashing.** OAP keeps `ProofRecord` (flat fields) and its anchor signing;
  only `link_record_hash` / `sha256_hex` / `canonical_json_sorted` delegate to
  the extracted primitives. Because `canonical-keysort-json` produces
  byte-identical canonical JSON to the previous in-tree sorter (pinned by the
  `spec231_canonical_json_parity_with_extracted_crate` parity test across
  scalars, nesting, arrays, unicode, and a real `ProofRecord`), every existing
  proof-chain and audit-chain hash is unchanged. The `audit.rs` file writer and
  rotation are OAP persistence choices and are **not** extracted.
- **Trust scoring.** `CoherenceScheduler` and `PrivilegeLevel` keep their API;
  the scheduler now wraps a `trust-window` `WindowScorer` in `DegradeOnly` mode.
  A boolean action is a `Sample::aligned`, so the scoring math is identical.
- **Decision gate.** `evaluate`, `ToolCallContext`, `PolicyBundle`,
  `PolicyDecision`, and `PolicyOutcome` are unchanged. `evaluate()` now builds an
  `action-gate` `Gate` whose six checks are OAP's six domain checks (secrets,
  destructive-op, allowlist, spec-status, spec-risk, diff-size) in the original
  order; the code-governance-shaped context maps to a domain-neutral
  `ActionContext` with OAP's typed extras in `attributes`, and the generic
  `Decision` maps back to `PolicyDecision` (OAP's bundle-derived rule ids ride in
  the gate's `check_ids`). Reason codes, rule ids, degrade-vs-deny outcomes, and
  first-match short-circuit order are preserved.

The regression guard is the crate's own test suite: the proof-chain,
audit-chain, coherence, and all fifteen `evaluate` tests pass unchanged.

## 3. Provenance and the relicensing vend

Each extracted file carried an `AGPL-3.0-or-later` SPDX header in OAP.
Relicensing the extracted source to Apache-2.0 is the prerogative of the sole
copyright holder (Bartek Kus) and is an explicit, authorized act, recorded in
each extracted repo's `NOTICE`. The extractions are domain-neutral by
construction: the OAP-specific proof-record fields, the `PolicyBundle` config
model, and OAP's six domain checks stayed in OAP. This spec is the OAP-side
record of the vend, analogous to spec 219 for tenant-tail. The interim design
record is `chancery/docs/preliminary/00..05` in the chancery repository.

## 4. Scope

In scope: the four delegations above and the manifest dependency additions.

Out of scope: the `audit.rs` file writer / rotation (OAP persistence, not
extracted); the spec-068 permission-runtime family (`permission`, `merge`,
`settings`, `denial`, `watcher`), which is unwired and stays in OAP;
`provenance_policy.rs` (spec 121, OAP-specific). No consumer API changes; no
wasm-target change (the pre-existing `getrandom` wasm posture is unaffected).

## 5. Success criteria

- **SC-1.** `canonical_json_sorted` delegates to `canonical-keysort-json` and the
  parity test confirms byte-identical output.
- **SC-2.** `link_record_hash` and `sha256_hex` delegate to `attest-ledger-core`;
  all proof-chain and audit-chain tests pass.
- **SC-3.** `CoherenceScheduler` wraps a `trust-window` `WindowScorer`; all four
  coherence tests pass.
- **SC-4.** `evaluate()` runs an `action-gate` `Gate` over OAP's six checks; all
  fifteen `evaluate` tests pass with identical outcomes, reasons, and rule ids.
- **SC-5.** All seven consumers compile against the unchanged public API; the two
  verifier binaries build.
