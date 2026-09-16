---
id: "222-registry-shard-freshness-gate"
title: "Registry-shard freshness gate (PR-time staleness block for committed by-spec shards)"
feature_branch: "feat/222-registry-shard-freshness-gate"
status: approved
implementation: complete
kind: governance
domain: tooling
created: "2026-06-24"
authors: ["open-agentic-platform"]
language: en
summary: >
  The committed per-spec registry shards
  (.derived/spec-registry/by-spec/*.json) are machine truth derived from
  specs/*/spec.md, but CI runs `spec-spine compile` only as a smoke test:
  it proves the registry can be emitted, never that the committed shards
  match a fresh compile. So a spec.md can be refined while its shard is
  left describing an earlier draft, and the drift merges silently (spec
  208 did exactly this in PR #422, fixed reactively in #423). This spec
  adds a PR-time freshness gate to spec-conformance.yml: recompile, then
  `git diff --exit-code` the by-spec shard tree, failing the run on any
  drift. It is deliberately modelled on spec 184's narrow claude-config
  slice (a conflict-free PR-time block on a committed artifact), not on
  the broad codebase-index gate that spec 188 moved post-merge: spec 217
  re-committed the registry as conflict-free per-spec shards, each a pure
  function of its own spec.md, so a per-shard gate does not reintroduce
  the O(N-squared) merge-serialization tension that drove 188.
code_aliases: ["REGISTRY_SHARD_FRESHNESS_GATE"]
depends_on:
  - "217-spec-spine-engine-swap-collapse"
  - "188-derived-index-merge-serialization"
extends:
  # Additive: a new gate step inside the conformance workflow spec 177 owns.
  - spec: "177-ci-orchestrator-pr-gate"
    nature: additive
    unit: { kind: file, path: .github/workflows/spec-conformance.yml }
  # Same precedent as specs 208, 196, 194, 193, 187, 183: a new spec adds a
  # row to the featuregraph golden, regenerated from the registry shards.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
references:
  - role: precedent
    unit: { kind: file, path: specs/184-claude-shared-config-governance/spec.md }
  - role: context
    unit: { kind: file, path: specs/188-derived-index-merge-serialization/spec.md }
  - role: context
    unit: { kind: file, path: specs/217-spec-spine-engine-swap-collapse/spec.md }
---

# Feature Specification: Registry-shard freshness gate

## Purpose

The committed per-spec registry shards under
`.derived/spec-registry/by-spec/*.json` are compiler-owned machine truth:
each is a deterministic projection of one `specs/NNN-slug/spec.md` (its
section headings, summary, declared relationship edges, and a
`shardHash`). Constitution Principle II makes them authoritative, and
spec 217 (Workstream D) committed them in conflict-free per-spec form so
they are present on clone (spec 101 SC-06).

But CI never checks they are *fresh*. `spec-conformance.yml` runs
`spec-spine compile` as a **smoke test** (the step is literally named
"Emit registry (compile smoke)"): it proves the registry emits without
error, then discards the result. Nothing compares the freshly emitted
shards to the committed ones. There is also no native check verb to lean
on: the `spec-spine registry` consumer surface is read-only
(`list` / `show` / `status-report` / `relationships`), and `spec-spine
compile` has no `--check` flag (only `spec-spine index` ships a
staleness `check`).

The consequence is a silent-drift hole. A `spec.md` can be refined while
its shard is left describing an earlier draft, and because no gate
compares them, the stale shard merges. This is not hypothetical: spec
208's refinement merged in PR #422 with a shard generated from an
earlier draft (stale `shardHash`, "sketch" section headings, an em-dash
summary the spec body no longer used); the drift was caught only by eye
afterward and fixed reactively in PR #423.

## Design model: extend the narrow PR-time block, not the broad index gate

The obvious objection is that spec 188 deliberately moved committed-index
freshness **out** of required PR gating. That precedent does not transfer,
and the difference is the whole design:

- **What 188 fixed was a *monolithic* artifact.** The old
  `.derived/codebase-index/index.json` carried one global content hash,
  so every branch that regenerated it conflicted with every sibling
  (O(N-squared) conflicts and staleness re-runs across N open PRs). Moving
  that gate post-merge removed a genuine merge-serialization point.
- **The registry is no longer monolithic.** Spec 217 Workstream D
  re-committed it as disjoint per-spec shards (`by-spec/NNN-*.json`).
  Each shard is a pure function of its own `spec.md`: its `record`
  carries only the **outbound** edges that spec declares
  (`extends` / `refines` / `references`), with no inbound backlinks from
  other specs. Two branches editing different specs touch different shard
  files and never collide; two branches editing the *same* spec already
  conflict on `spec.md` itself. The `oap-index-regen` merge driver
  (`.gitattributes`, spec 188 re-homed by 217) resolves the rare
  same-shard case deterministically.
- **So a per-shard freshness gate is the registry analogue of spec
  184's slice gate, not of 188's broad gate.** Spec 184 kept a *narrow,
  conflict-free* PR-time block alive (`spec-spine index check --slice
  claude-config` over `.claude/settings.json` + `.mcp.json`) precisely so
  a quiet edit to a committed governance artifact cannot merge
  unacknowledged. This spec extends that same posture to the committed
  registry shards.

### Mechanism: recompile, then diff

Because no native check verb exists, the gate is recompile-then-diff,
run immediately after the existing compile step:

```bash
spec-spine compile                                   # regenerate shards in place
git diff --exit-code -- .derived/spec-registry/by-spec/
```

`spec-spine compile` is deterministic, and the checkout already contains
the committed shards, so the working-tree-versus-HEAD diff is exact: a
non-empty diff means a committed shard does not match its own `spec.md`,
and the step fails. This is a git-layer content-equality check, **not**
ad-hoc JSON parsing: it does not read the shard shape, so it stays within
`governed-artifact-reads.md` (no `python` / `jq` / `awk` / `sed` over
`.derived/**/*.json`). The diff is scoped to `by-spec/` so the gitignored
aggregate (`registry.json`) and the overlay (`registry-oap.json`) cannot
make it spuriously red or green.

## Functional requirements

### FR-001: By-spec shard freshness gate

`spec-conformance.yml` MUST fail the run when any committed
`.derived/spec-registry/by-spec/*.json` shard differs from a fresh
`spec-spine compile`. The check runs immediately after the existing
compile step and is scoped to the `by-spec/` tree.

### FR-002: Gate at PR time and in the merge queue

The gate MUST run both at PR time and on the merge queue, so a stale
shard can neither enter nor pass the queue. This is satisfied by placing
it in `spec-conformance.yml`, which `ci.yml` dispatches on both `pull_request`
and `merge_group` (spec 177 §2.2 constitutional carve-out).

### FR-003: Actionable failure message

On failure the step MUST name the remedy: run `spec-spine compile` and
commit `.derived/spec-registry/by-spec/`. A bare `git diff` non-zero exit
is not enough; the message is the fix.

### FR-004: Scope discipline

The diff MUST be scoped to `.derived/spec-registry/by-spec/` only. The
gitignored aggregate and the `registry-oap.json` overlay are out of the
gate's scope (overlay emission is already smoked by `oap-registry-enrich`).

## Acceptance criteria

- **AC-1.** A PR that refines a `spec.md` without regenerating its shard
  fails `spec-conformance` with a message naming the fix. This is the
  spec 208 / PR #422 failure mode, now caught at PR time. (FR-001, FR-003)
- **AC-2.** A PR that regenerates and commits the shard alongside the
  `spec.md` passes. This very PR is the witness: it adds spec 222, its
  `by-spec` shard, and the regenerated featuregraph golden row, and the
  gate is green on it. (FR-001)
- **AC-3.** A PR touching no `spec.md` leaves the gate green: a fresh
  compile reproduces the committed shards byte-for-byte. (FR-001, FR-004)
- **AC-4.** The gate runs on both the `pull_request` and `merge_group`
  instances of `spec-conformance.yml`. (FR-002)
- **AC-5.** `spec-spine compile` (smoke), `spec-lint --fail-on-warn`
  (006/128), and the spec-code coupling gate (127) continue to pass; the
  featuregraph golden carries the new spec 222 row. (cross-cutting)

## Out of scope

- A native `spec-spine compile --check` / `spec-spine registry check`
  verb. That belongs to the published `spec-spine-cli` and would let the
  gate drop the `git diff` shim; the recompile-then-diff form is the
  governed equivalent available today. When such a verb ships, a
  follow-up may swap the mechanism without changing this contract.
- Codebase-index shard freshness. The per-spec index shards
  (`.derived/codebase-index/by-spec/` + `by-package/`) are committed too
  (spec 217 restored them after spec 188 gitignored the monolithic
  `index.json`), and could drift the same way. They are deliberately left
  out: their input set is **broad** (every `Cargo.toml`, `package.json`,
  `.github/workflows/**`, `.claude/**`, schema, and the adapter-scopes
  snapshot, per `spec-spine.toml` `extra_hashed_inputs`), so a PR-time
  gate over them would fire on the majority of PRs and reintroduce the
  very serialization churn spec 188 moved post-merge. Registry shards are
  safe to gate precisely because their **only** input is the owning
  `spec.md`, which the PR author is already editing. Index-shard freshness
  stays under spec 188's posture; the one index input group judged worth a
  PR-time block is the narrow `claude-config` slice (spec 184), which is
  already gated. This is the exact boundary that makes a registry gate
  cheap and an index gate costly.
- `registry-oap.json` overlay freshness. The overlay is a separate
  OAP-owned artifact; its emission is smoked by `oap-registry-enrich`.

## Dependencies and sequencing

- **217** (`spec-spine-engine-swap-collapse`) committed the conflict-free
  per-spec sharded registry this gate guards, and established
  `spec-spine.toml` as config authority.
- **188** (`derived-index-merge-serialization`) is the freshness-enforcement
  model; this gate is the registry analogue of its narrow PR-time slice,
  and inherits its `oap-index-regen` merge driver for same-shard conflicts.
- **177** (`ci-orchestrator-pr-gate`) owns `spec-conformance.yml`
  orchestration; this spec adds one step to it.
- **184** (`claude-shared-config-governance`) is the precedent: a narrow,
  conflict-free PR-time freshness block on a committed governance artifact.

No sequencing constraint: the spec, its shard, the golden row, and the
workflow step land together in one PR, and the gate validates its own PR.


## Security hardening amendment (2026-07-02)

Acknowledging the 2026-07-02 security-hardening amendment to spec 184 (claude-shared-config-governance). Narrowing the settings.json execute allowlist changes a hashed input, and the regenerated codebase index shards remain fresh under this freshness gate; the note satisfies the spec 127 coupling gate for the co-authored spec.md path.
