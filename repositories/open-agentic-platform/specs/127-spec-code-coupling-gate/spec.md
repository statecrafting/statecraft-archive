---
id: "127-spec-code-coupling-gate"
slug: spec-code-coupling-workflow
title: "Spec/Code Coupling Workflow — CI job, make target, contributor flow"
status: approved
implementation: complete
owner: bart
created: "2026-05-02"
approved: "2026-05-19"
amended: "2026-06-18"
amendment_record: |
  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree spec-code-coupling-check binary was deleted; the gate algorithm is now spec-spine-core::couple_with, invoked as `spec-spine couple`. The crate-unit is stripped (path deleted); the CI workflow and Makefile coupling section this spec governs survive, with only the binary invocation changed.
kind: governance
domain: tooling
risk: medium
depends_on:
  - "103-init-protocol-governed-reads"
  - "104-makefile-ci-parity-contract"
  - "118-workflow-spec-traceability"
  - "130-spec-coupling-primary-owner"
  - "133-amends-aware-coupling-gate"
code_aliases: ["SPEC_CODE_COUPLING_WORKFLOW"]
establishes:
  - unit: { kind: file, path: .github/workflows/ci-spec-code-coupling.yml }
# 217 deleted the in-tree spec-code-coupling-check; the gate algorithm is now
# spec-spine-core::couple_with, invoked as `spec-spine couple`. The crate-unit is
# stripped (deleted). The CI workflow and the Makefile coupling section this spec
# governs survive; only the binary invocation changed. Amended by 217.
co_authority:
  - with_specs:
      - "102-governed-excellence"
      - "104-makefile-ci-parity-contract"
      - "116-supply-chain-policy-gates"
      - "128-spec-lint-default-fail-on-warn"
      - "134-fast-local-ci-mode"
      - "135-fast-ci-as-default"
    unit: { kind: section, file: Makefile, anchor: spec-code-coupling }
summary: >
  The CI job, make target, exit-code contract, and contributor-facing
  affordances of the spec/code coupling check. Defines what `make pr-prep`
  does, what the gate's exit codes mean, how PRs interact with the gate,
  and what the operator sees when the gate fails or passes. The derivation
  logic lives in spec 133 (coupling-gate); the relationship-field
  semantics live in spec 130 (spec-relationship-graph); section matching
  lives in spec 152 (path-co-authority).
---

# 127 — Spec/Code Coupling Workflow

## 1. The workflow contract

`make pr-prep` is the pre-PR / pre-commit gate. It rebuilds the
codebase index and runs the coupling-check binary against
`origin/main` — the same two checks that fail first in CI when
forgotten. Contributors run it locally before `git commit` on PRs.

The gate is also invoked by `.github/workflows/ci-spec-code-coupling.yml`
at PR time: every diff path's current authority spec must be touched
in the same PR, or a `Spec-Drift-Waiver:` line must appear in the PR
body.

The gate's derivation logic — what counts as "current authority", how
supersession resolves, how co-authority sections match — is owned by
spec 133. This spec owns the *workflow surface*: the make targets, the
workflow YAML, the exit codes, and the human-readable output that
contributors and reviewers see.

## 2. Make targets

### 2.1 `make pr-prep`

```
pr-prep: index ci-fast-spec-coupling
```

Two phases:

1. **`index`** — rebuild `.derived/codebase-index/index.json` so the gate
   reads the current spec corpus. The codebase index is the
   spec-compiler's projection of `implements:` (now derived from the
   relationship graph per spec 130) into a path-to-claimants mapping.
2. **`ci-fast-spec-coupling`** — build the coupling-check binary if
   needed, then invoke it with the diff against `origin/main`.

A drifted `.derived/codebase-index/index.json` (from spec edits that
weren't followed by `make index`) is detected and reported as a
follow-up message; the gate itself does not fail on index staleness
(that's `codebase-indexer check`'s job, invoked separately by CI).

### 2.2 `make ci-spec-code-coupling`

The pre-merge mirror under `make ci-strict`. Identical recipe; the
difference is the role: `pr-prep` is the contributor's loop;
`ci-spec-code-coupling` is the parity-strict mirror.

## 3. The CI workflow

`.github/workflows/ci-spec-code-coupling.yml` runs on every pull
request and on workflow dispatch. The job structure:

1. Checkout with `fetch-depth: 0` (the gate diff is `BASE...HEAD`).
2. Install the pinned Rust toolchain.
3. Build `tools/spec-spine/codebase-indexer` and emit `index.json`.
4. Build `tools/spec-spine/spec-code-coupling-check`.
5. Run the gate with the PR's base and head SHAs and the PR body.

The job has the same step shape as the local make target: divergence
between the two is caught by `tools/oap/ci-parity-check` (spec 104).

## 4. Exit codes

The coupling-check binary follows the standard tool exit contract:

- **0** — all edited paths satisfied authority (or a waiver is present).
- **1** — at least one path has no satisfied authority (the gate's
  normal failure mode).
- **2** — invocation error (missing index, bad arguments, git diff
  failure, unparseable PR body file). Reserved for operator-facing
  fault, not authoring drift.
- **3** — constraint violation (a `constrains:` spec's invariant was
  violated by the diff). Distinct from authority failure because the
  remediation is different: the contributor must either revert the
  constraint-violating edit or amend the constraining spec to widen
  the invariant.

CI's red/green badge maps `0 → green` and any non-zero to red. The
exit code distinguishes operator-facing causes from authoring causes
in CI log inspection.

## 5. Output format

The gate writes its output to stdout in three modes:

- **Silent success.** When every path is satisfied, the gate emits one
  summary line and exits 0.
- **Authority failure.** Per failing path: the current authority set
  (typically 1–3 specs), the section if applicable, the rule that fired
  (`establishes`, `extends`, `refines`, `co_authority`,
  `empty-authority-by-rule`), and a one-line prescribed action.
- **Constraint failure.** Per violation: the constraining spec, the
  invariant kind, the path(s), and what specifically was violated.

The old "claimed by N specs" multi-claim noise is gone. The output is
small, precise, and prescribes action.

## 6. Contributor flow

When the gate fails locally on `make pr-prep`, the contributor sees:

```
spec-code-coupling-check: 1 path requires authority touch.

  tools/factory-engine/src/lib.rs
    current authority: 075-factory-engine-mvp (establishes)
    section: (whole-file)
    fix: edit specs/075-factory-engine-mvp/spec.md
```

For co-authority sections:

```
spec-code-coupling-check: 1 section requires authority touch.

  Makefile#supply-chain (lines 565–610)
    current authority: 116-supply-chain-policy-gates
    fix: edit specs/116-supply-chain-policy-gates/spec.md
```

For constraint failures:

```
spec-code-coupling-check: 1 constraint violation.

  registry.schema.json:152 (field removal)
    constraint: 132-constitutional-invariant-freeze (invariant-freeze)
    violation: the field `supersededBy` is frozen; removal requires
               amending spec 132 to retire the freeze.
```

The contributor edits the named spec, re-runs `make pr-prep`, and
proceeds.

## 7. PR-body waiver mechanism

When the authority spec exists but cannot be edited in the same PR
(reviewer is fixing a typo in a vendored file, etc.), the PR body may
include a one-line waiver:

```
Spec-Drift-Waiver: vendored-grammar update from upstream tarball
```

The gate surfaces the waiver text in CI logs but does not fail. The
mechanism is intentionally lightweight; abuse is caught by reviewer
attention, not by the gate.

Waivers are last-resort. Most drift is better fixed by an
`empty-authority-by-rule` pattern (spec 152 §3) than by a per-PR
waiver — patterns are durable; waivers are ephemeral.

## 8. Governed-read discipline (spec 103)

The gate consumes `.derived/codebase-index/index.json` through the typed
deserialization shared with `codebase-indexer`, not via ad-hoc
parsing. This is the spec-103 governed-read pattern: compiled
artifacts are read through their designated consumer types.

The coupling-check binary's library API (spec 133 §6) exposes
`authorities(P)` and `authorities(P, S)` so downstream consumers
(registry-consumer's `--by-authority` query verb, future audit tools)
can ask the same questions the gate asks, with the same answers.

## 9. Relationship to other workflow gates

- **`spec-conformance.yml`** (spec 001) — validates the spec registry
  itself. Runs before this gate logically; if specs are malformed,
  this gate is meaningless.
- **`ci-codebase-index.yml`** (spec 101) — staleness gate on
  `index.json`. Runs in parallel with this gate; both must pass for a
  PR to merge.
- **`ci-parity.yml`** (spec 104) — verifies the Makefile mirrors every
  enforcing workflow. Catches drift between this spec's `make`
  recipe and its CI workflow.

## 10. Cross-references

- Spec 130 — relationship-graph field semantics
- Spec 133 — coupling-gate algorithm
- Spec 152 — path-co-authority (section matching, empty-authority patterns)
- Spec 103 — governed-artifact reads
- Spec 104 — makefile-ci-parity-contract
- Spec 118 — workflow-spec-traceability (the `# Spec:` header convention)
