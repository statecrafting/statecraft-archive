---
id: "188-derived-index-merge-serialization"
slug: derived-index-merge-serialization
title: "Derived-index merge serialization — merge driver + merge queue + narrow config-hash gate (broad index demoted to best-effort cache)"
status: approved
implementation: complete
owner: bart
created: "2026-05-29"
amended: "2026-06-18"
amendment_record: |
  amended 2026-06-15 by spec 216 (spec-spine-library-grammar-adoption, Phase 2b): bumped the broad index schema 3.0.0 -> 3.1.0 (additive `traceMapping.supersedes` field for coupling-gate supersession filtering); the narrow config-hash gate and "broad index carries nothing governed" invariant are unchanged.
  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree spec-compiler, codebase-indexer, and spec-code-coupling-check that this spec's index serialization extended were deleted; their edges are stripped (paths deleted). Workstream D also dropped the in-tree codebase-index.schema.json, removing that extends-101 schema edge. Spec 217 adds an amends-188 edge: Workstream D re-commits the sharded index/registry trees (conflict-free per-spec form), restoring present-on-clone (spec 101 SC-06) and superseding this spec's Phase 4b de-commit of the monolithic index.json.
kind: governance
shape: mechanism-add
risk: medium
domain: tooling
authors:
  - "bart"
language: en
code_aliases:
  - oap-index-regen
amends:
  # Phase 3 enacts the amendments spec 188 originally staged as `planned`
  # references. 101 — staleness contract re-homed (broad check → post-merge
  # heal; new narrow `check-config`). 177 — constitutional always-on PR set
  # swaps ci-codebase-index → ci-config-hash. 184 — PR-time blocking
  # guarantee re-homed to the narrow gate (not weakened).
  # Phase 4 deepens the 101/184 amendments: the gated slice is re-homed out
  # of the broad index (`build.claudeConfigHash`, index schema 2.3.0) into
  # its own tracked `config-hash.json` (index schema → 3.0.0). 177 is
  # unaffected by Phase 4 (the ci-config-hash workflow is unchanged).
  - "101-codebase-index-mvp"
  - "177-ci-orchestrator-pr-gate"
  - "184-claude-shared-config-governance"
extends:
  # Mechanical featuregraph-golden refresh required by spec 177
  # ci-orchestrator-pr-gate atomicity contract — appending this spec to
  # the corpus shifts the golden fingerprint. Same precedent as specs
  # 167/168/169 (178 rename), spec 183, and the 186→187 e2e renumber in
  # this change. No semantic change to spec 034's claims.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
  # 217 deleted the in-tree spec-compiler, codebase-indexer, and
  # spec-code-coupling-check; the index serialization / merge / check-config
  # behaviour this spec extended is now in spec-spine-core (sharded by-spec /
  # by-package output; no monolithic index.json). The edges on those deleted paths
  # (codebase-indexer lib + types, spec-compiler lib, coupling-check lib + cli test)
  # are stripped. The surviving edges below carry this spec's live authority.
  # Workstream D additionally dropped the in-tree codebase-index.schema.json, so this
  # spec's extends-101 schema edge is stripped (the schema is now the library shard
  # schemas). 217 adds an amends-188 edge: D re-commits the sharded index/registry
  # trees (conflict-free per-spec form), restoring present-on-clone (spec 101 SC-06)
  # and superseding this spec's Phase 4b de-commit of the monolithic index.json.
  - spec: "104-makefile-ci-parity-contract"
    nature: additive
    unit: { kind: file, path: tools/oap/ci-parity-check/src/lib.rs }
  - spec: "001-spec-compiler-mvp"
    nature: additive
    unit: { kind: file, path: tools/shared/spec-types/src/lib.rs }
establishes:
  - unit: { kind: file, path: .githooks/merge-derived-index.sh }
  - unit: { kind: file, path: .githooks/enable-merge-driver.sh }
  # Phase 4b (2026-06-16) retired the post-merge staleness-report job
  # (cd-index-staleness-report.yml): with the broad index now gitignored,
  # nothing committed remains to report staleness on. Establishes edge removed.
  # ci-parity-check fixture stubs for the ci-config-hash enforcing workflow.
  - unit: { kind: file, path: tools/oap/ci-parity-check/tests/fixtures/aligned/.github/workflows/ci-config-hash.yml }
  - unit: { kind: file, path: tools/oap/ci-parity-check/tests/fixtures/divergent/.github/workflows/ci-config-hash.yml }
  # The re-homed config-hash schema (the config-slice hash the ci-config-hash gate verifies).
  # 217 note: the V-032 duplicate-id test and the check-config test this spec
  # established lived inside the deleted spec-compiler / codebase-indexer crates;
  # those two establishes units are stripped (paths deleted).
  - unit: { kind: file, path: standards/schemas/spec-spine/config-hash.schema.json }
co_authority:
  # `make setup` runs the merge-driver registration (FR-003). This claims
  # the dedicated `merge-driver` target group of the shared Makefile.
  - unit: { kind: section, file: Makefile, anchor: merge-driver }
  # Phase 3 — the `ci-config-hash` parity-mirror target (FR-008 wiring).
  - unit: { kind: section, file: Makefile, anchor: ci-config-hash }
references:
  - role: precedent
    unit: { kind: file, path: specs/184-claude-shared-config-governance/spec.md }
  - role: precedent
    unit: { kind: file, path: specs/158-workflow-ref-sha-pinning-lint/spec.md }
  - role: pair-spec
    unit: { kind: file, path: specs/127-spec-code-coupling-gate/spec.md }
summary: >
  Multi-PR / multi-agent merge friction in OAP reduces to a single
  serialization point: the committed `.derived/codebase-index/index.json`
  carries one global content hash, and `ci-codebase-index` requires it to
  be byte-fresh against the PR tree on every PR. Each merge to main forces
  every other open PR to rebase and regenerate that one file. This spec
  delivers the low-risk fix now — a deterministic git merge driver
  (Phase 1) that auto-regenerates the index on conflict so the toil per
  rebase drops to zero — and designs, without yet implementing, the two
  structural levers (Phase 2: GitHub merge queue; Phase 3: move index
  freshness from a required PR gate to a post-merge heal on main). Phase 3
  is held because it is in direct tension with spec 184, which landed
  PR-time blocking of `.claude/settings.json` / `.mcp.json` edits days
  ago; that tension is surfaced here and left for an explicit decision
  rather than quietly inverted.
---

# Feature Specification: Derived-index merge serialization

**Feature Branch**: `188-derived-index-merge-serialization`
**Created**: 2026-05-29
**Status**: Approved · implementation **complete** (closed out 2026-05-31).
All code phases are merged: Phase 1 (`oap-index-regen` merge driver +
`make setup` registration), Phase 2 (`merge_group:` trigger + V-032 dup-id
lint), Phase 3 (narrow `ci-config-hash` gate + report-only staleness job;
direct-push heal retired), and Phase 4a (re-home `claudeConfigHash` to its own
tracked `config-hash.json`, index schema → 3.0.0). The §spec-184 tension was
resolved by re-homing, path 1; see §"The spec-184 tension → Resolution".
The Phase 2 **merge-queue ops action** — enabling the GitHub merge queue and
requiring `ci-gate` on `merge_group` — is **done** (enabled in branch
protection 2026-05-31; FR-006's "Phase 2 strictly after Phase 3" ordering was
satisfied once Phase 3 landed, so the previously-inert `merge_group:` trigger is
now live). **Phase 4b** (`.gitignore` the broad `index.json`) was the single
remaining item and is now **implemented (2026-06-16)**: the broad `index.json`
is gitignored and rebuilt on demand, never committed. The motivating driver was
clean merge-queue auto-merge (a committed monolithic index is a per-PR
merge-conflict point that ejects sibling PRs from the queue); it also reverses
spec 101 SC-06's present-on-clone decision (101 carries the amendment) and
retires `cd-index-staleness-report.yml` (nothing committed to report on).

> **Amendment 2026-06-15 (spec 216 Phase 2b).** Phase 4a set the broad index
> schema to 3.0.0. Spec 216 Phase 2b bumps it 3.0.0 -> 3.1.0 (additive:
> `traceMapping.supersedes`, an optional partial-supersession edge array the
> coupling gate reads for `authorities(P)` filtering). This is a minor,
> backward-compatible bump (the gate's compatibility check is major-only); the
> version assertion in this spec's `spec188_check_config.rs` test moves to
> 3.1.0 accordingly. The narrow `config-hash` gate and the "broad index carries
> nothing governed" invariant this spec established are unchanged: the new
> field is best-effort cache data, not a gated value.

## Problem

OAP commits exactly **one** derived artifact: `.derived/codebase-index/index.json`
(`.gitignore:308-310` re-includes only this file; `registry.json` and
`CODEBASE-INDEX.md` are gitignored and regenerated ephemerally). That one
file carries a single global content hash (`build.contentHash`), and the
`ci-codebase-index` staleness gate — dispatched unconditionally from
`ci.yml` and required via the terminal `ci-gate` aggregator
(`ci.yml:168-190`) — fails any PR whose committed hash does not match a
fresh recompute of the input set (`codebase-indexer check`,
`tools/spec-spine/codebase-indexer/src/lib.rs:383-406`).

Because nearly every PR touches a hashed input (a `spec.md`, a
`Cargo.toml`, a workflow, `.claude/**`, and — since spec 184 —
`.claude/settings.json` / `.mcp.json`), the committed index is a **merge
serialization point**:

| Pain | Mechanism | Cost with N open PRs |
|------|-----------|----------------------|
| (i) Textual conflict | Two branches rewrote the same JSON (hash line + inventory); git cannot auto-merge | O(N²) manual conflict resolutions |
| (ii) Semantic staleness | After rebasing onto a merged PR, the committed hash no longer matches the new input union → `check` fails | O(N²) `make registry` re-runs |

Both share one root: the index is **carried in the PR** and **required
fresh by a per-PR gate**. With multiple agents opening PRs concurrently,
every merge invalidates every sibling's committed index.

### What is *not* the problem in OAP (corrected from the transplanted analysis)

A diagnosis transplanted from a sibling project framed this as three
committed, globally-hashed artifacts and proposed making the coupling
gate build the index ephemerally. Verified against OAP's actual wiring,
two of those premises do not hold here:

1. **Only one artifact is committed**, not three (`.gitignore:308-310`).
   `registry.json` is gitignored and recompiled fresh by the
   spec-compiler in `ci-featuregraph-golden.yml` / `ci-crates.yml`;
   `CODEBASE-INDEX.md` is never committed. Neither is a serialization
   point.
2. **The coupling gate is already ephemeral.** `ci-spec-code-coupling.yml:47-48`
   runs `codebase-indexer compile` *before* the coupling check, so the
   coupling gate (spec 127) reads a freshly-built index from the PR tree
   and never depends on the committed copy. The "make the coupling gate
   ephemeral" fix is already in place here.

The residual, after that correction, is exactly one gate
(`ci-codebase-index`) requiring one committed file (`index.json`) to be
byte-fresh. That is the whole serialization surface, and it is what this
spec targets.

## User Scenarios & Testing

### User Story 1 — Rebase auto-heals the index (Priority: P1) — *Phase 1, implemented*

A contributor or agent rebases a branch onto a `main` that merged a PR
touching a hashed input. Git reports a conflict only on
`.derived/codebase-index/index.json`. With the merge driver registered,
git resolves it automatically: the index is regenerated from the merged
working tree and taken as the result. No JSON is hand-edited; no separate
"remember to `make registry`" step is needed.

**Why this priority**: it eliminates the day-to-day toil the user
reported ("regenerate codebase index … cumbersome") with zero governance
change, and it benefits autonomous agents — worktrees share the main
clone's git config, so one registration covers every agent worktree.

**Independent Test**: create two branches that each edit a different
`spec.md` and regenerate the index; merge one to `main`; rebase the
other. With the driver registered the rebase completes with no conflict
markers in `index.json` and `codebase-indexer check` passes; without it,
the same rebase leaves a conflict.

**Acceptance Scenarios**:

1. **Given** the driver is registered and the indexer binary is built,
   **When** a rebase conflicts only on `index.json`, **Then** the file is
   regenerated from the merged tree, staged, and `check` passes.
2. **Given** the indexer binary is **not** built, **When** the driver is
   invoked, **Then** it fails closed (exit 1, conflict left in place) with
   a one-line remediation, never producing a wrong-but-clean index.

**Known limitation (observed 2026-06-02; amends AS-2).** AS-2's "never
produces a wrong-but-clean index" guarantee holds for the *binary-not-built*
path (fail-closed). It does **not** hold universally: during the spec-183
boot-gate rebase the driver regenerated `index.json` from the working tree
mid-rebase and committed a **stale content hash** (it did not match a
post-rebase `codebase-indexer compile`) — a wrong-but-clean index. The CI
staleness gate (`codebase-indexer check`) and the local `make pr-prep` mirror
caught it and the index was regenerated by hand: the documented backstop
worked, and the live merge queue (User Story 2) makes the rebase-onto-merged-PR
path rare. The driver regenerates from the *working tree*, so it is only as
complete as the tree at git's driver-invocation moment, and it cannot
self-detect this case (a `check` immediately after `compile` agrees with that
same tree). The auto-heal is therefore **best-effort over the conflict** —
consistent with the driver's fail-closed docstring — and the staleness gate,
not the driver, remains the freshness source of truth. Confirming the precise
trigger (incomplete working tree vs. indexer-binary skew within a session)
needs a reproduction harness and is tracked as a follow-up; it does not change
the gate contract.

### User Story 2 — Concurrent agent PRs are serialized and logical conflicts are caught (Priority: P2) — *Phase 2, IMPLEMENTED in code 2026-05-30 (queue enablement = ops step)*

Multiple agents open PRs concurrently. A GitHub merge queue serializes
the merges and tests each PR against the *speculative* merged result, so
a green PR cannot be silently invalidated by the one ahead of it, and
conflicts that pass alone but break together are caught before they reach
`main`.

**Why this priority**: this is the multi-agent correctness lever, not
just a toil lever. **Evidence it is needed:** the corpus carried — and
this change resolves — a silent logical divergence no per-PR gate caught.
Two PRs independently allocated spec id 186: `sandbox-k8s-backend` (#245)
and `opc-e2e-test-harness` (#246). Each was green in isolation, and
because the spec-compiler keys on the full directory slug the build did
not hard-fail; the corpus simply ended up with two specs sharing one
numeric id, surfaced only by eyeballing the id list. Resolving it required
a manual renumber (the e2e harness was moved to 187, ahead of this spec at
188) plus a registry/golden/index recompile — exactly the after-the-fact
toil a merge queue would have pre-empted by testing the speculative merge
of #245 and #246 together. A duplicate-numeric-id registry lint is the
complementary cheap guard.

**Independent Test**: open two PRs that each add a spec claiming the same
id; confirm both pass their own CI; confirm the merge queue's speculative
build fails the second.

### User Story 3 — Index stays fresh on main without per-PR serialization (Priority: P3) — *Phase 3, IMPLEMENTED 2026-05-30*

The committed `index.json` remains a fresh, reviewable, present-on-clone
cache on `main`, but its freshness is enforced **post-merge** (a `main`
push job regenerates and commits it) rather than by a required per-PR
gate, so rebasing no longer forces a regenerate-and-recommit cycle.

**Why this priority**: it is the only lever that removes the
serialization at its source, and Phase 2 (merge queue) is not safe
without it (see FR-006). It is P3, not P1, because it is **in tension
with spec 184** (see §"The spec-184 tension") and must not be implemented
until that tension is resolved.

### Edge Cases

- **Indexer binary absent** during merge → driver fails closed; the
  conflict is left for `make registry` + manual stage. CI's `check`
  remains the source of truth.
- **Working tree not fully merged when the driver runs** → for the common
  case (only `index.json` conflicts; all source merged cleanly) the tree
  is complete and the regenerated index is correct. If a sibling input is
  not yet materialized, the regenerated index may be momentarily off; the
  downstream `check` (pre-commit hook / CI) catches the residual. The
  driver is a convenience over the conflict, not a replacement for the
  gate.
- **Merge queue without Phase 3** → a queued PR rebased onto the one ahead
  has a stale committed index → `ci-codebase-index check` fails → PR
  ejected. Phase 2 therefore depends on Phase 3 (FR-006).

## Requirements

### Functional Requirements — Phase 1 (implemented in this change)

- **FR-001**: A git merge driver named `oap-index-regen` MUST be assigned
  to `.derived/codebase-index/index.json` via committed `.gitattributes`,
  and implemented by a committed script
  (`.githooks/merge-derived-index.sh`) that, on conflict, regenerates the
  index from the merged working tree (`codebase-indexer compile`) and
  hands the result back to git as the merge resolution.
- **FR-002**: The driver MUST fail closed — exit non-zero, leaving the
  conflict unresolved — when the `codebase-indexer` release binary is not
  built or `compile` fails. It MUST NOT emit a clean-but-wrong index.
- **FR-003**: `make setup` MUST register the driver, so the standard
  clone-bootstrap step is all that is required — no separate per-clone
  command. The registration is performed by a committed, idempotent
  enabler (`.githooks/enable-merge-driver.sh`) which `setup` invokes and
  which also stands alone for clones bootstrapped before this change
  (a contributor who keeps multiple clones runs `make setup`, or the
  enabler directly, in each). Driver config lives in per-clone
  `.git/config`; git worktrees inherit it from the common clone, so one
  registration covers every agent worktree under that clone. This differs
  deliberately from the pre-commit hook (spec 158), which stays *manually*
  opt-in because it adds per-commit friction: the merge driver adds none —
  it fires only on an `index.json` merge conflict and only ever yields the
  deterministic-correct index, so registering it by default is pure
  benefit. The path→driver assignment (`.gitattributes`) and the driver
  script travel with the repo; only the registration is per-clone.
- **FR-004**: Phase 1 MUST NOT change the `ci-codebase-index` staleness
  contract (spec 101 / 184) or the coupling gate contract (spec 127). It
  is additive local ergonomics only: the committed `index.json` stays
  fresh and reviewable exactly as today; the driver only changes how a
  *conflict* on it is resolved.

### Functional Requirements — Phase 2 (IMPLEMENTED in code 2026-05-30 — merge-queue *enablement* is the one remaining ops step)

- **FR-005**: A GitHub merge queue SHOULD be introduced by adding a
  `merge_group:` trigger to `ci.yml` and requiring `ci-gate` on
  `merge_group`, so merges are serialized and each PR is tested against
  the speculative merged tree (catching the spec-id-collision class of
  logical conflict; see User Story 2). The workflow edit carries spec
  188's `# Spec:` header per spec 118 traceability.
- **FR-006**: Phase 2 MUST NOT ship before Phase 3. With the staleness
  gate still required and reading the committed artifact, the queue's
  speculative rebase produces a stale `index.json` and ejects the PR —
  amplifying churn instead of reducing it. This ordering constraint is a
  hard dependency, not a preference.
- **FR-006a** *(implemented)*: The complementary cheap guard from User
  Story 2 — a duplicate-numeric-id registry lint — is implemented as
  spec-compiler **V-032** (error severity, flips `validation.passed`). It
  flags any leading numeric prefix (`NNN`) claimed by two or more specs, so
  the spec-id-186 collision class hard-fails the build (and, once the queue
  is enabled, the speculative merge of the two colliding PRs) rather than
  shipping a corpus with a duplicate handle. Resolution status of FR-005's
  `merge_group:` trigger: **the trigger is added to `ci.yml`** (the routed
  suite runs full on the speculative tree); *requiring* `ci-gate` on
  `merge_group` is the branch-protection ops step, intentionally left to an
  admin so FR-006's ordering holds (the trigger is inert until then).

### Functional Requirements — Phase 3 (IMPLEMENTED 2026-05-30 — §spec-184 tension resolved by re-homing, path 1)

- **FR-007** *(amended 2026-05-30 — heal retired)*: Index freshness moves
  off the required per-PR gate. The broad committed `index.json` is a
  **best-effort, regenerable cache** — *not* kept byte-fresh on `main`.
  > **Why the originally-specified direct-push heal was retired.** FR-007
  > first proposed a `push: main` job that ran `make registry` and committed
  > the regenerated `index.json` back under a bot identity. When the GitHub
  > merge queue was enabled, `main` gained **PR-required + signed-commits**
  > branch protection (the queue's prerequisite). A direct bot push is
  > rejected twice over by that protection (no PR; unsigned commit), and the
  > only way to keep the design — a bypass actor with unreviewed `main`
  > write — is an attack surface and an ideological self-own on a governance
  > platform. So the heal is **retired**, not bypassed. Replacement:
  > `cd-index-staleness-report.yml` runs `codebase-indexer check` on `main`
  > and **reports** broad staleness (a `::warning::` annotation + a single
  > auto-managed tracking issue) so the SC-06 agent-orientation cost stays
  > visible; it **never pushes and never fails the run**. The cache is
  > refreshed opportunistically: config-touching PRs carry a regenerated
  > `index.json` into their squash, and any contributor can land a refresh
  > PR via the queue. The *intended end state* is the Phase 4 re-homing
  > below, which dissolves the need to heal at all.
- **FR-008**: The per-PR `codebase-indexer check` (broad) drops from a
  required blocking gate; PRs no longer need to carry a fresh broad
  `index.json`. This is the edit that removes pains (i) and (ii) at the
  source. The remaining required per-PR check is the narrow `check-config`
  (`ci-config-hash`), not the broad `check`.
- **FR-009**: Phase 3 MUST preserve, or explicitly re-home, the PR-time
  blocking property that spec 184 installed for `.claude/settings.json`
  and `.mcp.json`. It MUST NOT be implemented until that tension is
  resolved by an explicit decision and the corresponding amendments to
  specs 101, 177, and 184 are authored. Phase 3 changes the *enforcement
  timing* of the self-governance loop; it must not silently weaken it.
  > **Satisfied, and strengthened by the heal retirement.** The guarantee
  > is re-homed to the narrow `check-config` / `ci-config-hash` gate
  > (PR-time + `merge_group`). The earlier "fail-loud config guard" existed
  > so the *direct-push heal* could not silently absorb config drift. With
  > the heal retired (FR-007), that back door is closed **by construction**:
  > nothing on `main` regenerates-and-commits the index, so there is no
  > healer that could absorb config drift — `cd-index-staleness-report.yml`
  > only reads (`check`) and reports, never writes.

## The spec-184 tension *(load-bearing — read before implementing Phase 3)*

Spec 184 (`status: approved`, landed at commit `1982edf2`) added
`.claude/settings.json` and `.mcp.json` to the indexer's hashed input set
specifically so that "any edit to either file trips the codebase-index
staleness gate … editing the PostToolUse hook glob in
`.claude/settings.json` now itself trips the gate" (spec 184 summary).
The value 184 delivers is **PR-time blocking**: a quiet config edit
cannot merge without the staleness gate forcing acknowledgement.

Phase 3 (FR-007/FR-008) moves index-freshness enforcement to *post-merge*.
That weakens 184's blocking property: the `settings.json` edit is still
directly visible in the PR diff, but it would no longer be *gated* at PR
time. This is a genuine design conflict between a one-week-old approved
spec and the principled fix, and it is exactly the spec/code-coherence
class the project's adversarial-prompt-refusal rule (CONST-005) says to
surface rather than quietly invert.

**Non-destructive resolution paths** (to be chosen when Phase 3 is
decided, not now):

1. **Re-home the block.** Keep a *narrow* required PR check that hashes
   only `.claude/settings.json` + `.mcp.json` (184's actual concern),
   while the *broad* whole-index freshness moves post-merge. Preserves
   184's intent without re-serializing on the broad input set.
2. **Amend 184 explicitly.** If post-merge healing of the config-input
   surface is judged acceptable, amend 184 to record that its enforcement
   moved from PR-time to post-merge, with rationale — a deliberate,
   citeable change, not a silent inversion.

This spec does **not** enact either. It records the trade so the decision
is informed.

### Resolution (enacted 2026-05-30, Phase 3)

**Path 1 (re-home the block) was chosen.** The decision: preserve spec 184's
PR-time blocking property on a *narrow* surface while the *broad* index
freshness moves post-merge.

Mechanism, as implemented:

1. **Narrow sub-hash.** The index gains `build.claudeConfigHash` — a SHA-256
   over ONLY `.claude/settings.json` + `.mcp.json` — independent of the broad
   `contentHash` (schema 2.2.0 → 2.3.0, additive). *(Phase 4a later re-homed
   this slice out of the broad index into its own tracked
   `config-hash.json`, index schema 2.3.0 → 3.0.0; `check-config` now reads
   that file. Same hash, same gate — only the storage moved. See §Phase 4.)*
   A new `codebase-indexer check-config` subcommand verifies just that slice
   (spec 101 FR-12). Wired as the constitutional `ci-config-hash.yml` PR
   workflow, it runs on `pull_request` **and** `merge_group`. Because the
   slice depends only on the two files a config PR controls, it is
   merge-queue-safe (FR-006): an unrelated code PR ahead of it in the queue
   cannot make it stale. *Why a sub-hash and not "run the broad check on
   `pull_request` only": the broad hash depends on every other queued PR's
   inputs, so it would re-introduce the speculative-rebase ejection FR-006
   exists to eliminate, precisely for the trust-critical config path.*

2. **Broad freshness → best-effort cache + reporting** *(amended 2026-05-30)*.
   The broad committed `index.json` is a best-effort, regenerable cache; it
   is no longer kept byte-fresh on `main`. The originally-specified
   direct-push heal (`cd-index-heal.yml`) was **retired** when the merge
   queue brought PR-required + signed-commits protection to `main` — a bot
   that pushes around that protection is rejected (no PR; unsigned) and the
   only "fix" (a bypass actor) is an attack surface, not a design.
   `cd-index-staleness-report.yml` replaces it: it runs `check` on `main`
   and **reports** broad staleness (annotation + auto-managed tracking
   issue) so the SC-06 cost stays visible, but never pushes and never fails.

3. **Back-door corollary (FR-009) — now closed by construction.** The worry
   was that a healer could *silently* regenerate-and-commit a drifted config
   slice — "healed quietly", the exact thing 184 was built to stop. With the
   heal retired, **there is no healer that writes**: nothing on `main`
   regenerates-and-commits the index, so config drift cannot be silently
   absorbed. Config remains *impossible to merge dirty* (the narrow
   `ci-config-hash` gate blocks it at PR time + in the queue), which is
   strictly stronger than *impossible to persist dirty*.

This satisfies SC-005 ("preserved"): the guarantee is unchanged; only the
enforcement mechanism narrowed. Specs 101, 177, and 184 carry the
corresponding amendments (spec 188 `amends:` all three). The originally-feared
envelope-version / schema-parity ripple (specs 189/190/191) does **not**
apply: those gate the OPC↔statecraft WebSocket duplex protocol version, not
the codebase-index schema, which lives in a separate validation system.

## Success Criteria

- **SC-001**: With the Phase 1 driver registered, a rebase whose only
  conflict is `index.json` completes with zero manual edits and a passing
  `codebase-indexer check`. *(Phase 1 — verifiable now.)*
- **SC-002**: Merging N PRs that each touch a hashed input requires zero
  manual `index.json` conflict resolutions across the set (down from
  O(N²)). *(Phase 1.)*
- **SC-003**: A pair of PRs that each add a spec claiming the same id is
  blocked before reaching `main`. *(Phase 2 — satisfied two ways: V-032
  hard-fails the spec-compiler build on any shared numeric prefix
  (implemented + tested now); and once the merge queue is enabled, its
  speculative build of the two PRs together fails the second.)*
- **SC-004** *(amended 2026-05-30 — heal retired; clarified 2026-05-30 —
  Phase 4 split)*: ~~After a merge to `main`, the committed `index.json`
  matches a fresh recompute.~~ The broad committed `index.json` is a
  **best-effort regenerable cache** with no per-PR freshness obligation; its
  broad `contentHash` MAY lag on `main`. The narrow `claudeConfigHash` slice
  stays correct on its own (now in its own `config-hash.json`; config PRs
  regenerate that file). The byte-fresh-on-`main` invariant was dropped with
  the direct-push heal (FR-007); the SC-06 agent-orientation cost of a stale
  cache is recovered as *visibility* via `cd-index-staleness-report.yml`,
  not as an enforced invariant. **Phase 4a (re-home) did not by itself restore
  this invariant.** Phase 4b (2026-06-16) does: the broad `index.json` is now
  gitignored and rebuilt on demand, so it cannot be stale-on-disk, the
  staleness-report job is retired, and concurrent PRs no longer collide on it
  (clean merge-queue auto-merge). *(Phase 3 / 4a / 4b.)*
- **SC-005**: The PR-time guarantee that a `.claude/settings.json` /
  `.mcp.json` edit cannot merge unacknowledged is preserved (or
  explicitly and documentedly re-homed). *(Phase 3 / FR-009 — satisfied:
  preserved, re-homed to the narrow `check-config` / `ci-config-hash` gate.
  With the heal retired, the back door is closed by construction — no
  healer writes, so config drift cannot be silently absorbed.)*

## Phased delivery

| Phase | Scope | Status | Risk |
|-------|-------|--------|------|
| 1 | `oap-index-regen` merge driver + `.gitattributes` + `make setup` registration | **Implemented in this change** | low |
| 2 | GitHub merge queue (`merge_group:` trigger) + duplicate-id lint (V-032) | **Complete** — code landed 2026-05-30; merge-queue *enablement* done in branch protection 2026-05-31 | low–medium |
| 3 | Broad staleness → best-effort cache + narrow `check-config` PR gate; staleness-report job (heal retired) | **Implemented 2026-05-30** (re-homing, path 1; FR-007/008/009) | medium |
| 4a | Re-home `claudeConfigHash` to its own tracked `config-hash.json` (index schema 2.3.0 → 3.0.0); `check-config` reads it | **Implemented 2026-05-30** — dissolves the cache/contract tension (the cache now carries nothing governed) | low |
| 4b | `.gitignore` the broad `index.json` (pure rebuilt-on-demand artifact) | **Implemented (2026-06-16)**: clean merge-queue auto-merge; reverses spec 101 SC-06 (present-on-clone, amended); retires cd-index-staleness-report.yml | low-medium |

Phase 1 landed first. Phase 3 (and Phase 2, code-safe alongside it) landed
in PR #262. The direct-push heal originally specified for Phase 3 was
**retired** in the follow-up once the merge queue brought PR-required +
signed-commits protection to `main`: a healer cannot push to a protected
branch, and a bypass actor is a non-starter on a governance platform. The
broad index became a best-effort cache (FR-007 amended) with a
report-only staleness job. Phase 4 was then **split**: 4a (re-home the
slice) landed; 4b (`.gitignore` the broad index) was held as a separable
decision because it reverses SC-06 and is not required to close the
cache/contract tension that motivated Phase 4.

### Phase 4 — dissolve the cache/contract tension (split: 4a implemented, 4b deferred)

The whole Phase-3 tension exists because the load-bearing `claudeConfigHash`
*contract* lived **inside** the broad `index.json` *cache*, dragging the
cache under signed-commit branch protection. Phase 4 separates them in two
independently-landable steps:

- **4a — Re-home the contract (IMPLEMENTED 2026-05-30).** `compile` emits
  `claudeConfigHash` to its own small **tracked** file
  `.derived/codebase-index/config-hash.json` (re-included from `.gitignore`,
  self-validated against `config-hash.schema.json`); `check_config` reads
  that file instead of `build.claudeConfigHash`. The broad index schema
  bumps 2.3.0 → 3.0.0 (the field is removed; major bump under
  `additionalProperties:false`). Behavior is bit-for-bit unchanged — same
  slice, same hash, same PR-time blocking — only the storage location moved.
  **This is the step that dissolves the tension:** once the gated value is
  outside `index.json`, the broad index carries nothing governed, so it no
  longer drags a contract under branch protection. Config PRs become a
  one-line `config-hash.json` diff rather than carrying the whole
  regenerated index.

- **4b: `.gitignore` the broad `index.json` (IMPLEMENTED 2026-06-16).** The
  broad index is now a pure rebuilt-on-demand artifact (never committed), which
  restores SC-004's freshness invariant structurally (it cannot be
  stale-on-disk if it is always rebuilt). The motivating driver was clean
  merge-queue auto-merge: a committed monolithic index was a per-PR
  merge-conflict point that ejected sibling PRs from the queue, so de-committing
  it lets the queue form clean speculative stacks. It **reverses spec 101
  SC-06** (the present-on-clone decision; 101 carries the amendment) with the
  blast radius noted: the `/init` read path degrades gracefully (reports "not
  built" when absent; recompiles via `make setup`/`registry`/`ci`), the README
  "Try it" and Makefile `index`/`pr-prep` consumers regenerate on demand, and
  `cd-index-staleness-report.yml` is retired (nothing committed to report on).
  The committed-but-conflict-free successor is per-spec index sharding
  (spec-spine, planned), which restores present-on-clone and supersedes this
  reversal.

So after 4a the only governed, tracked artifact that needs a gate is the
tiny `config-hash.json`; the broad index is an ungoverned cache. That is the
honest contract-vs-cache separation Phase 4 set out to make. 4b is the
remaining structural cleanup, scheduled separately.

## Relationships

- **References spec 127** (`pair-spec`): the coupling gate already
  recompiles the index ephemerally (`ci-spec-code-coupling.yml:48`), which
  is why the residual serialization is confined to `ci-codebase-index`.
- **References spec 184 / 158** (`precedent`): 184 for the self-governance
  rationale Phase 3 must preserve; 158 for the opt-in `.githooks` /
  `git config` registration pattern Phase 1 mirrors.
- **References specs 177 and 101** (`planned`): Phases 2–3 will amend the
  CI orchestrator (add `merge_group` + a post-merge heal job) and the
  codebase-index staleness contract respectively. These amendments are
  *planned*, not enacted by this spec.
- `.gitattributes` and `CLAUDE.md` are edited by Phase 1 but are
  empty-authority-by-rule (spec 152 §3.2, lines 160 & 167), so no
  co-authority claim is required for them.

## Amendment — 2026-06-10: check-config re-homed into spec-conformance

The narrow config-hash gate this spec installed (Phase 3) and re-homed
to `config-hash.json` (Phase 4a) moved CI residence a second time: the
standalone `.github/workflows/ci-config-hash.yml` (established above) is
**deleted**, and its `check-config` run-block now executes as a step
inside `spec-conformance.yml` — placed *before* that workflow's
`codebase-indexer compile` smoke step, so it still validates the
COMMITTED `config-hash.json` rather than a freshly regenerated one. The
guarantee is bit-for-bit unchanged: same binary, same subcommand, same
constitutional always-on coverage (pull_request, merge_group, AND
push-to-main via spec-conformance's unconditional dispatch), still
blocking through `ci-gate`. Motivation: the standalone job paid ~3
minutes of runner spin-up per run for a 50ms check; spec-conformance
already builds the indexer. `ENFORCING_WORKFLOWS` in
`tools/oap/ci-parity-check/src/lib.rs` drops the deleted file
(spec-conformance.yml was already in the list); `make ci-config-hash`
remains the unchanged local mirror. The fixture copies of
ci-config-hash.yml under `tools/oap/ci-parity-check/tests/fixtures/`
remain as test fixtures — they model a generic enforcing workflow, not
the live file. The frontmatter `establishes:` entry for the deleted
live file is removed (a dangling `establishes:` is an indexer I-008
error); the fixture entries stay because those files exist.
