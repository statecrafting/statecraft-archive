---
id: "191-schema-parity-ci-job"
slug: schema-parity-ci-job
title: "Wire ci-schema-parity as an enforcing CI job (bun runtime)"
status: approved
implementation: complete
owner: bart
created: "2026-05-30"
approved: "2026-05-30"
completed: "2026-05-30"
kind: governance
domain: tooling
risk: low
depends_on:
  - "104-makefile-ci-parity-contract"  # makefile-ci-parity-contract (ENFORCING_WORKFLOWS classification + run-mirror)
  - "125-schema-parity-walker-rebuild"  # schema-parity-walker-rebuild (the walker this job runs)
  - "158-workflow-ref-sha-pinning-lint"  # workflow-ref-sha-pinning-lint (the setup-bun ref is SHA-pinned)
  - "177-ci-orchestrator-pr-gate"  # ci-orchestrator-pr-gate (the router this adds a route to)
  - "189-duplex-envelope-version-parity"  # duplex-envelope-version-parity (restored the gate + added the envelope check)
code_aliases:
  - "SCHEMA_PARITY_CI"
establishes:
  - unit: { kind: file, path: .github/workflows/ci-schema-parity.yml }
  - unit: { kind: file, path: tools/oap/ci-parity-check/tests/fixtures/aligned/.github/workflows/ci-schema-parity.yml }
  - unit: { kind: file, path: tools/oap/ci-parity-check/tests/fixtures/divergent/.github/workflows/ci-schema-parity.yml }
extends:
  - spec: "177-ci-orchestrator-pr-gate"
    nature: additive
    unit: { kind: file, path: .github/workflows/ci.yml }
  - spec: "104-makefile-ci-parity-contract"
    nature: additive
    unit: { kind: file, path: tools/oap/ci-parity-check/src/lib.rs }
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
summary: >
  The Rust↔TS schema-parity gate (`make ci-schema-parity`) — restored and
  extended with envelope-version parity by spec 189 — runs only in the local
  `make` loop; no CI workflow enforces it pre-merge (see
  `project_schema_parity_gate_not_in_ci`). This spec adds an enforcing
  reusable workflow `ci-schema-parity.yml` that mirrors the Makefile recipe
  (cargo fingerprint emit + `bun run` walker), routes it from the spec-177
  orchestrator on the files it actually compares, and classifies it in
  `ci-parity-check`'s `ENFORCING_WORKFLOWS` so the Makefile↔CI run-mirror
  covers it. bun is the runtime: the walker imports `.ts` at runtime, bun's
  fast startup + native TS suit a per-PR gate, and mirroring the Makefile's
  `bun run` keeps spec 104 green with no Makefile churn.

---

# 191 — Wire ci-schema-parity as an enforcing CI job

## 1. Problem

Spec 189 repaired the schema-parity walker (it had been silently
non-functional since #176) and added the protocol-wide
`ENVELOPE_SCHEMA_VERSION` parity check. But the gate that runs it,
`make ci-schema-parity`, is invoked only by the local `make ci` /
`make registry` / `make ci-strict` flows — **no GitHub Actions workflow
runs it**. A contributor who doesn't run those locally gets no Rust↔TS
parity enforcement before merge. A gate that exists only in the Makefile
can't catch its own breakage (which is how it went dark for so long).

## 2. Decision

Add an **enforcing** reusable workflow `.github/workflows/ci-schema-parity.yml`
dispatched from the spec-177 orchestrator. Three coupled pieces:

### 2.1 The workflow

`ci-schema-parity.yml` (a `workflow_call` reusable, matching the fleet
shape) runs the two commands of the Makefile `ci-schema-parity` recipe,
verbatim, so spec 104's run-mirror is satisfied token-for-token:

1. `cargo test --manifest-path crates/factory-contracts/Cargo.toml --lib -- knowledge::tests::writes_fingerprint_file provenance::tests::writes_provenance_fingerprint_file stakeholder_docs::tests::writes_stakeholder_docs_fingerprint_file`
   — emits the Rust fingerprints into `.derived/schema-parity/`.
2. `bun run tools/oap/schema-parity-check/index.mjs` — the walker:
   envelope-version parity (spec 189), knowledge fingerprint compare,
   provenance/stakeholder reserved-mode.

Toolchains: Rust (`dtolnay/rust-toolchain`, `Swatinem/rust-cache`) and
**bun** via `oven-sh/setup-bun`, SHA-pinned per spec 158. bun is the first
of its kind in CI. The walker's only runtime import,
`platform/services/statecraft/api/knowledge/extractionOutput.ts`, has **no
imports of its own**, so no `npm install` / statecraft dependency step is
needed — bun imports one dependency-free `.ts`.

### 2.2 The route (spec 177)

`ci.yml` gains a `schema_parity` paths-filter scoped to the files the
walker actually compares, a routed job gated on it, and an entry in the
`ci-gate` aggregator's `needs`:

```yaml
schema_parity:
  - 'crates/factory-contracts/**'
  - 'platform/services/statecraft/api/knowledge/**'
  - 'platform/services/statecraft/api/governance/**'
  - 'platform/services/statecraft/api/sync/**'
  - 'product/apps/opc/src-tauri/src/commands/sync_client.rs'
  - 'tools/oap/schema-parity-check/**'
  - '.github/workflows/ci-schema-parity.yml'
```

The `sync/**` and `sync_client.rs` entries are what make the envelope
drift this lineage started with (spec 183 → 189) catchable at PR time:
either side of `ENVELOPE_SCHEMA_VERSION` changing now routes the gate.

### 2.3 The parity classification (spec 104)

`ci-schema-parity.yml` is added to `ENFORCING_WORKFLOWS` in
`tools/oap/ci-parity-check/src/lib.rs` (not `COVERAGE_WORKFLOWS`): it is a
real gate `make ci-strict` already mirrors (the strict target includes
`ci-schema-parity`), so the run-mirror obligation is correct and the
disjointness invariant holds.

## 3. Why bun (not node)

The walker imports `.ts` at runtime, so it needs a TS-capable runtime;
`pnpm`/`npm` are package managers, not runtimes. `node --experimental-strip-types`
(22+) would work, but bun was chosen: its ~4–12 ms startup (vs node's
~60–120 ms) matters for a script a gate runs on many PRs, it imports `.ts`
with no flag, and it keeps the CI command identical to the Makefile's
existing `bun run` — so spec 104 parity holds with zero Makefile churn.
Migrating both sides to node was the considered alternative; bun was kept
deliberately.

## 4. Acceptance

- **AC-1.** `.github/workflows/ci-schema-parity.yml` exists as a
  `workflow_call` reusable that runs the cargo fingerprint-emit and
  `bun run …/index.mjs` steps; all `uses:` refs are SHA-pinned.
- **AC-2.** `ci.yml` routes it: `changes` emits `schema_parity`, a routed
  job is gated on it, and `ci-gate` `needs` it. A PR touching only
  `tools/oap/schema-parity-check/**` (or `…/sync/**`) routes
  `schema_parity == 'true'`.
- **AC-3.** `ci-parity-check` is green with `ci-schema-parity.yml` in
  `ENFORCING_WORKFLOWS`: every workflow `run:` token is present in the
  Makefile, and the enforcing/coverage disjointness unit test passes.
- **AC-4.** `workflow-pins` (spec 158) passes on the new workflow.
- **AC-5.** On its own introduction PR the new job runs (the filter
  matches the new workflow file) and is green — envelope-version OK,
  knowledge OK, provenance/stakeholder reserved.

## 5. Non-goals

- No change to what the walker checks (spec 189 owns that surface).
- No migration of other Makefile gates into CI; this wires the one gate
  spec 189 just restored.
- No `npm install` step — the imported TS is dependency-free; adding one
  would also break the spec-104 run-mirror.

## 6. Cross-references

- Spec 189 — restored the gate + envelope parity; this enforces it in CI.
- Spec 104 — Makefile↔CI run-mirror + ENFORCING/COVERAGE classification.
- Spec 177 — the orchestrator + `ci-gate` aggregator this routes through.
- Spec 158 — the `oven-sh/setup-bun` ref is SHA-pinned per its contract.
