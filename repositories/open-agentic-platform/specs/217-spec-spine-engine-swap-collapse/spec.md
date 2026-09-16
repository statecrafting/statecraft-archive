---
id: "217-spec-spine-engine-swap-collapse"
title: "Spec-Spine Engine Swap and Collapse: replace OAP's in-tree generic engine with the published spec-spine library"
feature_branch: "feat/217-spec-spine-engine-swap-collapse"
status: approved
implementation: complete
kind: migration
domain: tooling
created: "2026-06-15"
approved: "2026-06-24"
authors: ["open-agentic-platform"]
language: en
summary: >
  Delete OAP's in-tree generic spec-spine engine (spec-compiler,
  registry-consumer, codebase-indexer, spec-code-coupling-check, and the
  generic half of spec-lint) and replace it with the published external
  spec-spine library (spec-spine-types, spec-spine-core, spec-spine-cli).
  OAP retains only its overlay: the 16-kind enum, shape/category, compliance,
  factory/OWASP machinery, capability/registry/profile, statecraft://
  provenance, and the OAP-domain lint codes. The engine swap is mechanical
  and corpus-governance work, not a research problem: the library compiled
  OAP's full 217-spec corpus with zero errors on 2026-06-15. A supersession
  and amendment wave retires the establishing specs for the deleted crates
  and repoints the surviving overlay specs to the library seam. Done when
  OAP's own coupling gate is spec-spine couple (green in CI), compile/
  lint/index run via the library, and zero generic engine code remains in-tree.
depends_on:
  - "216-spec-spine-library-grammar-adoption"
  - "130-spec-coupling-primary-owner"
  - "133-amends-aware-coupling-gate"
  - "154-logical-unit-ownership-grammar"
  - "155-logical-unit-resolution-semantics"
  - "101-codebase-index-mvp"
  - "127-spec-code-coupling-gate"
  - "152-path-co-authority"
  - "181-registry-consumer-unit-grammar-authority"
code_aliases: ["SPEC_SPINE_ENGINE_SWAP_COLLAPSE"]
# Implementation-PR frontmatter. The Phase 5 supersession + amendment WAVE
# (documented in section 6) is NOW declared below, atomically with the binary
# deletion (Phase 3) and the predecessor status flips. The four in-tree engine
# crates are deleted, so the supersessions have taken effect: the spine asserts
# current truth, not intent (CONST-005). 217 establishes spec-spine.toml (Phase 0
# root config), owns its featuregraph golden row (extends 034), depends on 216,
# supersedes the six engine-establishing specs + the 007-031 contract series, and
# amends the surviving overlay specs whose deleted-crate units were re-homed.
establishes:
  - unit: { kind: file, path: spec-spine.toml }
extends:
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
# Phase 5 corpus-governance wave (section 6). These edges land in THIS
# implementation PR, atomically with the binary deletion (Phase 3) and the
# predecessor status flips, so the spine never asserts an un-effected supersession.
# The four in-tree engine crates are now deleted, so the supersessions have taken
# effect. supersedes = the six full-supersede specs (section 6.1) + the 007-031
# registry-consumer contract series (section 6.4). amends = the surviving overlay
# specs whose dangling deleted-crate units were stripped and re-homed to the library
# (sections 6.2/6.3/6.4 + the empirically-derived gap set recorded in section 6.5).
supersedes:
  - spec: "001-spec-compiler-mvp"
    scope: full
  - spec: "002-registry-consumer-mvp"
    scope: full
  - spec: "006-conformance-lint-mvp"
    scope: full
  - spec: "133-amends-aware-coupling-gate"
    scope: full
  - spec: "176-amends-aware-section-satisfaction-parity"
    scope: full
  - spec: "181-registry-consumer-unit-grammar-authority"
    scope: full
  - spec: "007-registry-consumer-status-report-mvp"
    scope: full
  - spec: "008-registry-consumer-status-report-json-mvp"
    scope: full
  - spec: "009-registry-consumer-status-report-nonzero-mvp"
    scope: full
  - spec: "010-registry-consumer-status-report-json-contract-mvp"
    scope: full
  - spec: "011-registry-consumer-status-report-status-filter-mvp"
    scope: full
  - spec: "012-registry-consumer-list-json-mvp"
    scope: full
  - spec: "013-registry-consumer-show-json-mvp"
    scope: full
  - spec: "014-registry-consumer-show-compact-json-mvp"
    scope: full
  - spec: "015-registry-consumer-list-compact-json-mvp"
    scope: full
  - spec: "016-registry-consumer-status-report-compact-json-mvp"
    scope: full
  - spec: "017-registry-consumer-shared-json-serialization-helper-mvp"
    scope: full
  - spec: "018-registry-consumer-list-show-json-contract-mvp"
    scope: full
  - spec: "019-registry-consumer-readme-examples-contract-mvp"
    scope: full
  - spec: "020-registry-consumer-error-contract-mvp"
    scope: full
  - spec: "021-registry-consumer-field-shape-invariants-contract-mvp"
    scope: full
  - spec: "022-registry-consumer-help-usage-contract-mvp"
    scope: full
  - spec: "023-registry-consumer-flag-conflict-argument-validation-contract-mvp"
    scope: full
  - spec: "024-registry-consumer-version-banner-contract-mvp"
    scope: full
  - spec: "025-registry-consumer-default-path-contract-mvp"
    scope: full
  - spec: "026-registry-consumer-allow-invalid-contract-mvp"
    scope: full
  - spec: "027-registry-consumer-sorting-order-contract-mvp"
    scope: full
  - spec: "028-registry-consumer-channel-discipline-contract-mvp"
    scope: full
  - spec: "029-registry-consumer-contract-governance-gate-mvp"
    scope: full
  - spec: "030-registry-consumer-internal-output-exit-refactor-mvp"
    scope: full
  - spec: "031-registry-consumer-list-ids-only-contract-mvp"
    scope: full
amends:
  - "003-feature-lifecycle-mvp"
  - "039-feature-id-reconciliation"
  - "091-registry-enrichment"
  - "101-codebase-index-mvp"
  - "102-governed-excellence"
  - "103-init-protocol-governed-reads"
  - "118-workflow-spec-traceability"
  - "127-spec-code-coupling-gate"
  - "128-spec-lint-default-fail-on-warn"
  - "129-granular-package-oap-metadata"
  - "130-spec-coupling-primary-owner"
  - "132-constitutional-invariant-freeze"
  - "147-spec-kind-grammar"
  - "152-path-co-authority"
  - "154-logical-unit-ownership-grammar"
  - "155-logical-unit-resolution-semantics"
  - "156-references-edge-provenance-grammar"
  - "159-v004-lint-fixture-exemption"
  - "161-knowledge-requirements-provenance-emission"
  - "179-domain-frontmatter-field"
  - "182-claude-skills-migration"
  - "184-claude-shared-config-governance"
  - "188-derived-index-merge-serialization"
---

# Feature Specification: Spec-Spine Engine Swap and Collapse

**Feature Branch**: `feat/217-spec-spine-engine-swap-collapse`
**Created**: 2026-06-15
**Status**: Approved (implementation complete; engine deleted in PR #387, lifecycle reconciled 2026-06-24)
**Predecessor**: spec 216 (grammar adoption), which completed the grammar-convergence
prerequisite; this spec initiates the mechanical deletion and call-site rewiring.

---

## 1. Overview

OAP maintains a large in-tree generic spec-spine engine:
`spec-compiler`, `registry-consumer`, `codebase-indexer`,
`spec-code-coupling-check`, and the generic half of `spec-lint` (all
under `tools/spec-spine/`). The standalone `spec-spine` library
(crates.io: `spec-spine-types`, `spec-spine-core`, `spec-spine-cli`)
provides the same generic capability as a versioned, externally-tested
dependency. Running both is redundancy, not defence in depth: OAP has
been converging grammar onto the library since spec 216, and a
2026-06-15 dry run confirmed that the published 0.4.0 binary compiled
OAP's full 217-spec corpus with zero errors or warnings using the
`spec-spine.toml` config already at the repo root.

**Correction (2026-06-17 Phase 0 dry run on 0.5.0).** The 2026-06-15
result validated `compile` (the registry) ONLY; it never ran the index.
On the sharded 0.5.0 release, `spec-spine index` emits 116 error
diagnostics that the in-tree indexer never produced, because the in-tree
indexer never validated unit existence at all. The "mechanical,
zero-error" premise holds for the registry, not the index. The 116 split
into three tracks documented in section 1.5: a `spec-spine.toml` config
correction (Track 1, landed; clears 16), a spec-spine 0.6.0 library change
(Track 3; the unified severity rule plus three resolver defects), and
opportunistic references-edge hygiene (Track 2; non-blocking under
decision A). FR-000 is not relaxed; its zero-ERROR bar stands, and the
path to it is Track 1 (done) plus pinning 0.6.0.

This spec governs the deletion of the in-tree generic engine and the
migration of all consumers to the library. OAP retains an overlay: the
16-kind enum, shape/category, compliance, factory/OWASP machinery,
capability/registry/profile, `statecraft://` provenance, and the
OAP-domain lint codes. The overlay is not generic spec-spine; it is
OAP-specific typed modelling layered on `spec-spine-types` primitives.

**The overlay binary that replaces `registry-consumer`** for
authority-resolver queries is `oap-registry-enrich` (already at
`tools/oap/oap-registry-enrich`). The OAP-specific authority verbs land
there, reading the registry via `spec-spine-core::load_committed_registry`.
Generic verbs (`list`, `show`, `status-report`, `relationships`) are
served by `spec-spine registry`.

**Verb-home reconciliation (2026-06-24, implementation).** The original
five-verb enumeration collapsed once measured against what the library
already serves and what the corpus actually calls. The delivered surface:
`by-authority` and `validate-graph` are implemented in
`oap-registry-enrich`; `show-relationships` is served by the library's
generic `spec-spine registry relationships`; `show-supersession-chain`
and `show-constraints-on` are retired (zero callers across the governed
surface, and the supersession / constraint data is readable via
`spec-spine registry show`). `validate-graph` is kept as the explicit,
registry-reading restatement of the dangling-reference rejection that
`spec-spine compile` already performs (the pre-PR check the architect
workflow recommends), plus a supersession-cycle guard; exit 0 when the
graph is well-formed, 1 otherwise.

**The gate is a confirmed drop-in.** `spec-spine couple` replicates OAP's
gate's exit-code contract (0=clean, 1=drift; no branching on any other
code), its waiver mechanism (`Spec-Drift-Waiver:` in PR body),
dependency-only auto-waive, amends-awareness, section-matching, and
claim-precedence (spec 216 FR-002 validation). The CI workflow
(`.github/workflows/ci-spec-code-coupling.yml`) survives with its
binary invocation changed.

**Index storage is sharded, and this swap supersedes spec 188 Phase 4b.** Two
things changed since this spec was drafted, and they retarget its index
handling. (1) OAP spec 188 Phase 4b de-committed the broad monolithic
`index.json` (gitignored, rebuilt on demand) to get clean merge-queue
auto-merge, trading away present-on-clone (spec 101 SC-06). (2) spec-spine
landed per-spec index sharding (its spec 024): `compile` and `index` emit
disjoint per-unit shards (`.derived/spec-registry/by-spec/`,
`.derived/codebase-index/by-spec/` + `by-package/`), schema MAJOR 1.0.0, with
the aggregate computed on read; the `spec-spine-core` loaders
(`load_committed_index`, `load_committed_registry`, `couple_with`) assemble
from the shards transparently, with unchanged signatures and exit codes. So
this swap MUST target a spec-spine release that includes sharding (NOT 0.4.0,
which is monolithic), and it COMMITS the sharded trees: that re-commit restores
present-on-clone in a conflict-free form (disjoint per-spec files cannot
collide), superseding Phase 4b's de-commit. Open item for implementation:
confirm OAP's overlay artifacts (`oap-code-index-enrich` / `oap-registry-enrich`
output) are gitignored and regenerated, not a new committed monolithic
serialization point; shard them too if committed.

---

## 1.5 Phase 0 dry-run findings: the three-track split (2026-06-17)

The 0.5.0 Phase 0 dry run (config = committed `spec-spine.toml`) produced
116 index error diagnostics where the in-tree indexer produced zero. A
root-cause investigation (a config experiment applied, measured, and
reverted) split them into three independent tracks.

**Track 1: OAP `spec-spine.toml` config correction (16 diagnostics; in
this spec's scope).** The config this spec establishes carries two wrong
path conventions. (a) `standalone_rust_workspaces` lists `Cargo.toml`
FILES; the library joins `member + "Cargo.toml"`, producing
`.../Cargo.toml/Cargo.toml`, so the `opc` and `deployd-api-rs` crates are
undiscovered and their symbols never resolve (I-005 x4). They must be
DIRECTORIES. (b) `npm_workspaces` points at `product/pnpm-workspace.yaml`,
whose `["apps/*","packages/*"]` globs the library resolves against
repo-root rather than `product/`, so ALL 25 npm packages are undiscovered
(I-003 x12). Workaround without a library release: enumerate via
`standalone_npm_packages = ["product/packages/*", "product/apps/*", ...]`
(repo-root-relative globs resolve correctly). Measured: both corrections
take 116 -> 101 and clear I-003 and I-005 entirely (packages discovered
38 -> 63). This is a CONST-005-clean correction of config this spec owns;
it lands in Phase 1.

**Track 2: references-edge hygiene (95 diagnostics: I-004 x80, I-007 x15;
OPPORTUNISTIC, not blocking).** A falsification pass confirmed all 95 are
`references:` edges, and that every one of the 984 owning-edge units
(establishes/extends/refines/co_authority) across the corpus resolves:
zero authority drift. The code-authority graph is intact; only provenance
pointers drifted (code absorbed into `@opc/*` packages, retired
`tenant-hello` / `factory/` paths, moved docs, the spec 178 `/tmp/...`
stray). Under decision A (below), spec-spine 0.6.0 downgrades unresolved
`references:` units to counted `W-0xx` warnings, which FR-000 accepts. So
this is NOT a blocking prerequisite and requires NO supersessions or
authority changes (correcting this section's first draft, which
over-framed it as lifecycle surgery): it is opportunistic hygiene (inline
the relevant extract, repoint, or drop the stale pointer) done as the
owning specs are next touched, not a gating 55-spec edit.

**Track 3: spec-spine 0.6.0 library changes (upstream; owned by a
spec-spine-rooted agent, not OAP).** Two specs, confirmed against current
spec-spine `main`: (i) a severity-policy spec (amends spec-spine 004)
implementing the unified severity tier (decision A + P2 below); (ii) a
defects spec covering Defect 1 foreign-YAML `# region:` dispatch routed to
`ci_job_sections` instead of `region_sections` (`sections.rs:42-46`;
amends spec-spine 022 and retires its stale "D4 deferred" note; clears the
5 I-006 on specs 137/146/151), Defect 2 the Makefile `## tag:` overwrite
(`sections.rs:142`; clears the 1 I-006 on spec 134), and Defect 3 the
npm/Cargo glob base-resolution underlying Track 1 (OAP already works
around it via config). The release is 0.6.0 (not 0.5.1) to signal the new
severity behaviour; the on-disk schema is unchanged (stays 1.0.0). OAP
re-pins 0.6.0 and re-runs FR-000.

**Command-name correction.** `spec-spine index compile` is not a 0.5.0
subcommand. Building the index is bare `spec-spine index`; the `index`
subcommands are `check` / `render` / `orphans`. Every `index compile`
reference in this spec and its execution plan repoints to `spec-spine
index`.

### Policy decisions (resolve the cross-repo boundary)

**P1 (decision A): severity follows authority.** An unresolved
`references:` unit (spec 156, the one non-owning edge the coupling gate
already ignores) is a counted `W-0xx` warning, never a hard error. The
0.5.0 resolver hard-errored on it exactly as hard as a broken
`establishes:` claim; that is a coherence bug independent of OAP, since
authority cannot flow through a non-owning edge (no laundering vector:
you cannot hide an owning-grade claim behind `references:`). Truth still
lives inline in the spec and the reference stays supplementary; cleaning a
stale reference (inline the extract, repoint, or drop) is opportunistic
hygiene, not a blocking gate. Strictness is preserved as an opt-in policy:
an adopter (or spec-spine on its own corpus) may choose to fail on the
references `W-code` via its self-governance gate (spec-spine's own
references all resolve today, so nothing breaks now).

**P2: draft/pending units warn, never skip.** The indexer MUST surface
unbuilt units declared by `draft` / `implementation: pending` specs as
WARNINGS; it MUST NOT silently skip them. Skipping is an
authority-laundering and invisible-drift vector: a perpetual-draft spec
could `establishes:` a path whose units are never validated and whose
authority the coupling gate never sees. Two corollaries: (a) the
coupling/authority layer still treats a draft spec's `establishes:`
claims as LIVE for gating, so draft status creates no authority hole; (b)
FR-000's zero-warning bar is read as "zero errors plus zero un-accepted
warnings", where the enumerated draft-unit and references warnings are
accepted, not silenced. P2's warn-not-error behaviour ships in spec-spine
0.6.0 (Track 3); the in-tree indexer silently tolerated unresolved units
(which P2 forbids).

**Unified rule (P1 + P2, one mechanism).** An unresolved unit is a hard
`I-0xx` error only if it is an OWNING edge
(establishes/extends/refines/co_authority) AND its owning spec is
`approved` and implemented; otherwise it is a counted `W-0xx` warning.
Two axes (edge-ownership and lifecycle), keyed off the owning flag already
threaded into the resolver's units list, so it is a one-branch change at a
single call site.

---

## 1.6 Phase-1 seam correction (2026-06-18): the overlay keeps OAP types, it does not re-export library primitives

The original Phase 1 plan (FR-101 below, as first drafted) said the
generic primitives (`split_frontmatter_*`, `LogicalUnit`, `ProvenanceKind`,
`RESOLVER_EXCLUSIONS`, `FrontmatterError`) "move to `spec-spine-types`
imports" via re-export, and that downstream crates "recompile without
call-site changes." A 2026-06-18 empirical comparison of the published
`spec-spine-types` 0.6.0 public API against OAP's `open_agentic_spec_types`
falsified that premise for four of the five named primitives. The library
models specs differently (typed `Frontmatter` / `Unit` via serde) than
OAP's in-tree types (`serde_yaml::Value`-based helpers plus a hand-rolled
`LogicalUnit`), so a `pub use ... as ...` re-export does not compile OAP's
call sites.

| OAP type | Library reality | Verdict |
|---|---|---|
| `LogicalUnit` | `unit::Unit` has the SAME six variants/fields but NONE of `kind_str` / `from_yaml` / `from_json` / `to_json`, and `LogicalUnitParseError` does not exist | INCOMPATIBLE |
| `split_frontmatter_required` / `_optional` | `frontmatter::split_frontmatter` returns `(String, String)` (raw YAML text), not `(serde_yaml::Value, String)`; no `_optional`; different error type | INCOMPATIBLE |
| `ProvenanceKind` / `ProvenanceParseError` | library has only the raw `edges::Provenance{kind,ref}` struct; URI schemes are config-driven (`[provenance.uri_schemes]`), not a compiled typed enum | INCOMPATIBLE (genuinely OAP-specific) |
| `RESOLVER_EXCLUSIONS` | no exported const; `IndexConfig` default is bare dir-names (`"target"`) not globs (`"target/**"`) | INCOMPATIBLE |
| `Severity` | `registry::Severity` is identical except it lacks the `Hash` derive | ALIASABLE (but OAP's own `Severity` has zero external consumers) |

`ViolationCode` (the `&'static str` newtype) and its ~30 `V_` / `W_` / `L_`
const instances have no library equivalent (the library's `Violation.code`
is a `String`) and are dead in OAP: zero external consumers, and spec-lint
emits string-literal codes.

**Corrected seam.** `open_agentic_spec_types` survives as the OAP overlay
types crate. It does NOT re-export generic primitives from the library. It
KEEPS the OAP-specific types its surviving consumers use (the vocabularies
`VALID_KINDS`, `SHAPE_TABLE`, `VALID_DOMAINS`, `CONVENTIONAL_CATEGORIES`,
`KNOWN_KEYS`, plus `split_frontmatter_*`), and deletes verified-dead code
(`ViolationCode` and the `V_` / `W_` / `L_` const registry, the unused
`Severity`, and `LogicalUnit` / `RESOLVER_EXCLUSIONS` once the in-tree
engine crates that are their only consumers are deleted in Phase 3). The
`spec-spine-core` / `spec-spine-types` dependency is added to the Phase-2
CONSUMER crates (where they read `Registry` / `CodebaseIndex` via
`load_committed_registry` / `load_committed_index`), not to the types crate
for re-export.

This correction does not relax the engine swap: the four generic engine
binaries are still deleted (Phase 3) and consumers still repoint to the
library engine (Phase 2). It corrects only the mechanism by which
`spec-types` becomes the overlay (deletion of dead generics plus retention
of OAP-specific types, instead of re-export of incompatible library types).
Under the corrected seam, AC-101's "downstream crates compile without
modification" HOLDS precisely because the OAP types are kept, not swapped.

---

## 1.7 Phase-1 lint seam correction (2026-06-18): library-lint gating defers to the wave

FR-102 (as first drafted) said the OAP overlay lint would "invoke
`spec-spine-core::lint` for the generic pass and append its own OAP codes,"
with the generic codes (`W-001..007`, `V-020`, `L-001..004`) "removed from
the in-tree crate." A 2026-06-18 empirical comparison of the library lint
against OAP's `spec-lint` falsified that split.

**Library lint emits a different code namespace.** `spec_spine_core::lint`
emits exactly five codes, `L-001..L-005`, not OAP's `W-`/`V-` scheme:
`L-001` (no ownership edge, warn), `L-002` (`domains.allowed` set + no
`domain`, warn), `L-003` (`kind.allowed` set + no `kind`, warn), `L-004`
(relationship names a non-existent target, warn), `L-005` (stub spec, no
body sections, INFO). OAP's lint emits `W-001..007` (workflow + lifecycle
enums; OAP-specific; no library equivalent), `W-130/131/132`, `V-030/031`,
`W-161` (OAP-domain; no library equivalent), `V-020`, and its own `L-005`.

**Three findings break the FR-102 split:**
1. Most of OAP's "generic" `W-001..007` are OAP-specific (the `tasks.md` /
   `verification.md` / `changeset.md` Spec-Kit workflow and the OAP status /
   implementation enums); the library does not emit them. Removing them
   would lose checks, not delegate them.
2. Only `V-020` is close to `L-001` and `V-031` is close to `L-002`. OAP's
   `L-005` (workspace-migration, error) COLLIDES on the string with the
   library's `L-005` (stub-spec, info).
3. **The library's `L-001` is stricter than OAP's `V-020`.** `V-020` is
   satisfied by the 7 owning edges plus `references:`, `superseded_by:`,
   `composition.requires:`, `selects:`, or `origin: retroactive`; `L-001`
   accepts only the 7 owning edges plus `origin: retroactive`. As a result
   `spec-spine lint --fail-on-warn` fails (exit 1) on 8 legitimately
   non-owning specs (superseded 038/040/088; profile 150; reference /
   plan-only / approved-unbuilt 066/081/148/149). Annotating them to pass
   would be CONST-005 drift (making the spine claim ownership it does not
   have to satisfy a gate), which this spec refuses.

**Decision (2026-06-18): library-lint gating defers to the Phase 3+5
bundle.** No `spec-spine lint` step is wired in Phase 1. The integration
lands with the wave, where: (a) spec 006 (which establishes `spec-lint`)
is superseded, making the overlay edit coupling-clean; (b) the `V-020` /
`L-001` semantic gap is reconciled (library config-driven exemptions, or a
deliberate corpus annotation pass that is honest per spec); and (c) OAP's
obsolete `L-005` workspace-migration advisory is retired (its migration is
complete) so the library's `L-005` string is unambiguous. Until then OAP's
existing `spec-lint --fail-on-warn` remains the lint gate (AC-102 holds: it
exits 0 on the current corpus, unchanged).

**Update (2026-06-19, after Workstreams F + D landed):** the corpus-governance
wave (Phase 5/F) and the shard-commit (Workstream D) landed as spec.md and
artifact changes only. The library-lint *merge* itself (folding the generic
`L-001..L-004` pass into the OAP gate, dropping the now-redundant `V-020`/`V-031`,
and retiring OAP's obsolete `L-005`) was NOT wired in the bundle, because the
`V-020`/`L-001` reconciliation in (b) above is a behavior-and-corpus change that
warrants its own focused pass rather than a tail-end addition to the engine-swap
PR. It is now a tracked post-217 follow-up. AC-102 continues to hold unchanged:
OAP's `spec-lint --fail-on-warn` is the lint gate and exits 0 on the current
corpus; the OAP-domain codes (W-130/131/132, V-030/031, W-161, L-005) stay
exercised by their fixture tests.

**Consequence for the phase model.** This is the third Phase-1 element
(after the spec-types re-export and the lint code-split) whose clean
standalone landing dissolved on contact with the library's stricter or
different semantics and OAP's coupling governance. The realistic landing is
therefore a consolidated Phase 2-5 bundle (consumer repoints, engine
deletion, and the supersession / amendment wave together), not a series of
thin per-phase PRs. Phase 1's coupling-clean deliverable is this spec
amendment itself: the reality-aligned plan plus the FR-000 green result.

---

## 1.8 Phase-2 dependency-resolution reality and the library pin (2026-06-18)

Three facts emerged from the first executed consumer repoint (featuregraph,
consumer 1 of the 8 in Phase 2) that refine, but do not change, the plan.

**The pin is spec-spine 0.7.0, not 0.6.0.** spec-spine shipped 0.7.0
(crates.io) carrying its spec 027: a default-on `symbol-resolution` Cargo
feature that gates tree-sitter symbol/module resolution behind an optional
dependency. 0.6.0 (the FR-000 pin in Phase 0) pulled tree-sitter
unconditionally; 0.7.0 makes it opt-out. The engine swap pins 0.7.0. FR-000
remains met: the schema versions are unchanged (registry 1.0.0, index 1.1.0),
so the 0.6.0-generated committed shards read identically under 0.7.0.

**Why the feature gate is load-bearing: the tree-sitter `links` conflict.**
`spec-spine-core`'s `symbol-resolution` pins `tree-sitter = "=0.25.10"`. OAP's
`xray` crate pins `tree-sitter = "0.26"` (Dependabot, behind its
`analysis-structure` feature), activated workspace-wide by `axiomregent` and
`opc-decomposition-pipeline` (`analysis-call-graph`). `tree-sitter` declares
`links = "tree-sitter"`, so cargo permits exactly one version per dependency
graph, and `=0.25.10` and `^0.26` are disjoint. Because cargo resolves the
workspace as one lockfile, adding `spec-spine-core` anywhere makes resolution
fail before compilation. The resolution: **every consumer crate deps
`spec-spine-core` with `default-features = false`.** The committed-shard read
path (`load_committed_registry` / `load_committed_index`), `compile`, and
`couple` are all symbol-resolution-free: tree-sitter is used only by the
`index()` symbol resolver, whose resolved-unit line-spans are computed once
when `spec-spine index` runs (via the CLI, which keeps the feature) and read
back from the committed shards. This constraint is added to FR-201: no
consumer enables `symbol-resolution`. (Boundary note: the feature gate was
requested of, and shipped by, the spec-spine-rooted CC; OAP does not write
into spec-spine.)

**Function-name correction to the Phase 2 / overview tables.** The
committed-shard readers are `spec-spine-core::load_committed_registry` and
`load_committed_index` (they assemble the `by-spec` / `by-package` shard
trees). The bare `load_registry` / `load_index` names are the in-memory
bytes-parsers, not the path loaders; this spec's tables name the committed
variants (`load_committed_registry` / `load_committed_index`) throughout. The
gate uses `couple` (IO + freshness-guarded) or `couple_with` (pure).

**Consumer 1 of 8 is verified green.** featuregraph was repointed end to end
on 0.7.0: `registry_source` to `load_committed_registry`, `index_bridge` to
`load_committed_index` (deleting its hand-rolled mirror structs, FR-203
satisfied), with `default-features = false`. `cargo test -p featuregraph`
passes 22/22, `cargo build -p axiomregent` (a downstream consumer) is clean,
and `cargo tree -i tree-sitter` shows only xray's 0.26 (spec-spine-core
contributes none). The Phase 2 seam is confirmed on real code, not just the
2026-06-15 compile dry run. The remaining 7 consumers follow the same
template; the enrichers (`oap-registry-enrich`, `oap-code-index-enrich`) need
no library API change. (Repoint reality, verified: they cannot keep a raw-JSON
passthrough, because the library emits no monolithic registry/index to read
back. Each instead serializes the typed library DTO (`Registry` / `CodebaseIndex`)
as the base layer and overlays the OAP-specific layers on top.)

**The pin advances to 0.8.0 (provenance `derived_at`).** The
`opc-decomposition-pipeline` compile-path repoint (a Phase-3 prerequisite,
since Phase 3 deletes the in-tree `spec-compiler`) surfaced a second
consumer-driven reality. Its stage-6 synthesizer emits a `references:` edge
whose `provenance:` block carries `kind: code-fingerprint`, `ref`, and
`derived_at` (`crates/opc-decomposition-pipeline/src/stages/synthesis.rs`),
because spec 161 FR-007 requires `provenance.derived_at` on every
`decomposition-origin` reference; the `code-fingerprint` scheme itself is
already configured in the repo-root `spec-spine.toml`. The 0.7.0 library
`Provenance` type (`spec-spine-types`, `deny_unknown_fields`, fields
`kind`/`ref` only) rejected the unknown `derived_at` field, so an in-process
`spec_spine_core::compile` of a freshly-staged spec failed validation
(V-002) and wrote zero shards. spec-spine 0.8.0 (crates.io) adds optional
`derived_at` to `Provenance`, so the generated spec's `{ kind, ref,
derived_at }` provenance now parses, the project-registry shards are
written, and validation passes; the target test
`promotes_staged_spec_and_recompiles_registry` is green on 0.8.0. The
repointed consumers (`featuregraph`, `factory-engine`, `oap-registry-enrich`,
`oap-code-index-enrich`, `opc/src-tauri`, `opc-decomposition-pipeline`)
therefore pin `0.8.0`, still
`default-features = false` (the symbol-resolution / tree-sitter-`links`
constraint above is unchanged); the remaining Phase-2 consumers pin the same
when repointed. FR-000 remains met: the registry and index schema MAJOR
versions are unchanged, so OAP's committed shards read identically under
0.8.0 (the green `featuregraph` and `factory-engine` committed-shard reader
tests confirm it). (Boundary note: the `derived_at` provenance extension was
requested of, and shipped by, the spec-spine-rooted CC; OAP does not write
into spec-spine.)

**Subsequent advance to 0.10.0 (2026-07-08).** The pin later advanced from
0.8.0 to 0.10.0 across every site 217 governs, in lockstep so the installed
build tool and the linked library never skew: the `spec-spine-cli` install
version (`Makefile` `SPEC_SPINE_VERSION`, the four CI workflows that install
it, and the `make setup` / docs / rules / githook install instructions) AND
the six library consumers' `spec-spine-core` / `spec-spine-types` crate deps
(`featuregraph`, `factory-engine`, `oap-registry-enrich`,
`oap-code-index-enrich`, `opc/src-tauri`, `opc-decomposition-pipeline`). The
motivation is the library's cargo + GitHub-Actions dependency auto-waiver,
which lands at 0.10.0: dependabot cargo and workflow bumps self-clear without
a human Spec-Drift-Waiver, and a `Cargo.toml` dependency bump no longer
stales the codebase index because the dependency table is stripped from the
hashed governance projection (mirroring the existing `package.json`
treatment). This directly reduces OAP's recurring dependabot friction. FR-000
still holds: the registry and index schema MAJOR versions are unchanged
between 0.8.0 and 0.10.0 (both remain `1.1.0`) and the grammar is unchanged,
so OAP's committed shards read identically. The one deterministic, one-time
effect is that the 0.10.0 index-hash projection recomputes the committed
codebase index once (same class as the spec 188 config-hash rehome, not a
regression); it is regenerated and committed in the bump PR after a local
recompile + index + coupling + featuregraph-golden pass across the corpus.

---

## 2. Phased Delivery Plan

The implementation follows the phase sequence proven by the WS-B plan.
Each phase is independently deployable (CI stays green at each phase
boundary).

### Phase 0: Prerequisites and the config gate

- Spec 216 implementation complete (grammar-convergence prerequisite).
- `spec-spine.toml` config at repo root. CORRECTION (2026-06-17): the
  committed config mis-declares manifest paths (section 1.5 Track 1).
  Phase 1 lands the fix (`standalone_rust_workspaces` as directories;
  npm packages via `standalone_npm_packages` globs).
- spec-spine 0.5.0 (sharded per spec-spine spec 024, plus the spec 023
  ledger seal) confirmed published to crates.io and npm on 2026-06-17 and
  used for the Phase 0 dry run. The engine swap ultimately pins 0.6.0
  (Track 3), which carries the unified severity rule and the resolver
  defect fixes that take FR-000 to zero net errors. The earlier 0.4.0 dry
  run was monolithic and registry-only.

**FR-000 (gate), revised 2026-06-17.** Before Phase 1's deletion work,
`spec-spine compile` AND `spec-spine index` (bare, not `index compile`)
run against the repo root with the committed `spec-spine.toml`, on the
pinned SHARDED release, and exit 0 with zero ERRORS and zero UN-ACCEPTED
warnings (per the unified rule, the enumerated draft-unit and references
warnings are accepted) on the full corpus, emitting a sane shard set (one
`by-spec/<id>.json` per spec, plus `by-package/<slug>.json`). The
2026-06-17 dry run did NOT pass (116 diagnostics, section 1.5). With
Track 1 landed (116 -> 101) and spec-spine 0.6.0 pinned (the unified
severity rule downgrades the 95 `references:` units to accepted `W-0xx`
warnings; the three defects clear the 6 I-006), FR-000 reaches zero net
errors. Track 2 references hygiene is opportunistic, NOT a gating
condition. The zero-error bar is not relaxed.

**VERIFIED GREEN (2026-06-18).** With `spec-spine-cli` 0.6.0 installed from
crates.io and the committed `spec-spine.toml`, run from the OAP repo root:
`spec-spine compile` exits 0 (220 specs, 0 warnings) and `spec-spine index`
exits 0 with 0 ERROR diagnostics. `spec-spine index render` surfaces 94
`W-002` unresolved-file-unit warnings (accepted under the unified rule:
surfaced not skipped per P2, downgraded to warnings not errors per P1). The
count is 94 (not the predicted 95) and the code is a single `W-002` (not
0.5.0's `I-004`/`I-007` split) because the corpus grew to 220 specs since
2026-06-17 and 0.6.0 consolidated the diagnostic codes; the gate contract
(zero errors, warnings surfaced) holds. FR-000 is met.

**AC-000.** CI job (or local equivalent) confirms FR-000 at zero net
errors. The committed `spec-spine.toml` is the corrected (Track 1) config,
not the original mis-declared one.

### Phase 1: Build the OAP overlay layer (no deletion yet)

Slim `tools/shared/spec-types` to the OAP overlay types crate. CORRECTION
(2026-06-18, section 1.6): the overlay does NOT re-export generic
primitives from `spec-spine-types` (their shapes are incompatible). It
KEEPS the OAP-specific typed modelling its surviving consumers use (the
16-value `kind` enum, `VALID_KINDS`, `shape`/`SHAPE_TABLE`, `category`/
`CONVENTIONAL_CATEGORIES`, `VALID_DOMAINS`, capability/registry/profile
fields, `statecraft://` provenance via `ProvenanceKind`, legacy
`implements`, and `split_frontmatter_*`), and deletes verified-dead code
(`ViolationCode` plus the `V_`/`W_`/`L_` const registry, the unused
`Severity`, and `LogicalUnit`/`RESOLVER_EXCLUSIONS` once their only
consumers, the in-tree engine crates, are deleted in Phase 3). The
`spec-spine-core`/`spec-spine-types` dependency is added to the Phase-2
consumer crates (registry/index reads), NOT to the types crate.

Slim `tools/spec-spine/spec-lint` to the OAP-domain lint codes only
(W-130/131/132 category/kind/shape, V-030/031 domain, W-161
decomposition-origin, L-005 workspace-migration). Generic codes
(W-001..007, V-020, L-001..004) are removed from the in-tree crate; the
OAP overlay lint invokes `spec-spine-core::lint` for the generic pass
and appends its own OAP codes.

Neither the producing binary (spec-compiler) nor the consuming binaries
(registry-consumer, codebase-indexer, spec-code-coupling-check) are
deleted in this phase. Build remains green.

**FR-101 (overlay types).** `open_agentic_spec_types` survives as the OAP
overlay types crate (section 1.6): its public API for OAP-specific types is
unchanged and downstream crates recompile without call-site changes. It
retains the OAP-specific types its surviving consumers use and drops only
verified-dead code; it does not re-export generic `spec-spine-types`
primitives (whose shapes are incompatible). The library dependency lands in
the Phase-2 consumer crates, not here.

**FR-102 (overlay lint).** CORRECTION (section 1.7): library-lint
integration defers to the Phase 3+5 bundle. The library lint's `L-001` is
stricter than OAP's `V-020`, so `spec-spine lint --fail-on-warn` cannot
gate the current corpus without CONST-005 drift, and `spec-lint` is
established by spec 006, which the wave supersedes. OAP's existing
`spec-lint --fail-on-warn` remains the Phase 1 lint gate and exits 0
against the current corpus, unchanged. The merge of the library's generic
`L-001..L-004` pass, the dropping of the now-redundant `V-020`/`V-031`, and
the retirement of OAP's obsolete `L-005` all land in the wave.

**AC-101.** `cargo build --manifest-path tools/shared/spec-types/Cargo.toml`
succeeds. All downstream crates that `path`-depend on spec-types compile
without modification.

**AC-102.** OAP's existing in-tree `spec-lint --fail-on-warn` exits 0 (the
library-lint integration defers to the wave per section 1.7). The
OAP-domain codes (W-130/131/132, V-030/031, W-161, L-005) are still
exercised by their existing fixture tests.

### Phase 2: Repoint the 8 consumer crates to the library

Each of the 8 crates that hold path-dependencies on the generic
in-tree crates is repointed:

| Consumer crate | Old dep | New dep |
|---|---|---|
| `oap-registry-enrich` | `registry-consumer` + `spec-types` | `spec-spine-core::load_committed_registry` + overlay types |
| `oap-code-index-enrich` | `codebase-indexer` + `spec-types` | `spec-spine-core::load_committed_index` + overlay types |
| `policy-compiler` | `spec-types` | overlay types |
| `spec-code-coupling-check` | both + `spec-types` | `spec-spine-core::couple_with` + overlay types |
| `featuregraph` | `registry-consumer` | `spec-spine-core::load_committed_registry` (index_bridge.rs also moves from hand-rolled JSON to `load_committed_index`) |
| `factory-engine` | `registry-consumer` | `spec-spine-core::load_committed_registry` |
| `opc-decomposition-pipeline` | `spec-compiler` + `spec-lint` | `spec-spine-core::compile` (caller writes) + overlay lint |
| `product/apps/opc/src-tauri` | `registry-consumer` | `spec-spine-core::load_committed_registry` |

The one raw artifact reader (`crates/featuregraph/src/index_bridge.rs`)
moves from hand-rolled `serde_json::from_str` to
`spec-spine-core::load_committed_index`. `opc-decomposition-pipeline/promotion.rs`
moves from `spec_compiler::compile_and_write` to
`spec_spine_core::compile` plus a caller-side write (the library returns
`CompileOutcome`).

The `spec-code-coupling-check` crate's internal logic is replaced by a
thin shim that delegates to `spec-spine-core::couple_with`; the binary
itself will be deleted in Phase 3.

**FR-201 (library seam).** Every consumer crate listed above compiles
against the library seam. No consumer retains a direct path-dep on an
in-tree generic engine crate after this phase.

**FR-202 (compile API shape).** `opc-decomposition-pipeline/promotion.rs`
calls `spec_spine_core::compile` and writes the `CompileOutcome` to
disk. The in-tree `spec_compiler::compile_and_write` entry point is no
longer called.

**FR-203 (raw-reader elimination).** `crates/featuregraph/src/index_bridge.rs`
uses `spec-spine-core::load_committed_index` exclusively. Zero direct
`serde_json::from_str` calls against `.derived/**/*.json` remain in any
consumer crate (governed-reads principle, spec 103).

**AC-201.** `cargo build --workspace` (excluding the in-tree generic
engine crates themselves) succeeds with no path-dep compilation errors.

**AC-202.** The featuregraph golden test passes (registry compiled first
per `feedback_golden_after_registry`).

**AC-203.** `spec-spine compile` exits 0 on the full corpus; the
generated registry is byte-identical to the in-tree spec-compiler's
output.

### Phase 3: Delete the generic engine

Remove the four generic binaries and the now-redundant generic
spec-lint crate:

- `tools/spec-spine/spec-compiler` (pkg `open_agentic_spec_compiler`)
- `tools/spec-spine/registry-consumer` (pkg `open_agentic_spec_registry_reader`)
- `tools/spec-spine/codebase-indexer` (pkg `open_agentic_codebase_indexer`)
- `tools/spec-spine/spec-code-coupling-check` (pkg `open_agentic_spec_code_coupling_check`)
- The generic half of `tools/spec-spine/spec-lint` (the OAP overlay
  lint crate remains; only the generic codes are removed, having moved
  to the library in Phase 1).

Drop each from `[workspace] members` in the root `Cargo.toml`. The
`.derived/codebase-index/` and `.derived/spec-registry/` artifacts (now the
SHARDED per-unit trees, spec-spine spec 024) and the CI workflow
`ci-spec-code-coupling.yml` **survive** (only the producing and enforcing
binaries change). OAP's overlay
`standards/schemas/spec-spine/codebase-index.schema.json` (monolithic, 3.1.0)
is DROPPED in favour of spec-spine's shard schemas (1.0.0); the OAP overlay
enrich reads via `load_committed_index`.

`oap-registry-enrich` absorbs the OAP-specific authority-resolver verbs
previously in `registry-consumer`. The `by-authority` and
`validate-graph` subcommands are implemented there, reading via
`spec-spine-core::load_committed_registry`. `show-relationships` is served
by the library's generic `spec-spine registry relationships`;
`show-supersession-chain` and `show-constraints-on` are retired (zero
callers; the data is readable via `spec-spine registry show`). See the
verb-home reconciliation in section 1.

**FR-301 (deletion).** All four generic engine crates are deleted from
`tools/spec-spine/`. No `Cargo.toml` in the workspace retains a
`path = "tools/spec-spine/<name>"` dependency after this phase.

**FR-302 (oap-registry-enrich authority verbs).** `oap-registry-enrich`
exposes `by-authority <path>` and `validate-graph` subcommands, reading
the registry via `spec-spine-core::load_committed_registry`. The spec-181
authority logic is re-implemented behind `by-authority` (exit codes and
output format preserved, so callers are unaffected). `validate-graph`
reports dangling relationship references and supersession cycles (exit 0
well-formed, 1 otherwise). The three remaining verbs of the original
enumeration are reconciled per section 1: `show-relationships` is served
by the library's `spec-spine registry relationships`;
`show-supersession-chain` and `show-constraints-on` are retired (zero
callers, data readable via `spec-spine registry show`).

**FR-303 (codebase-index artifact is the committed shard tree).** `spec-spine
index` emits the per-unit index shard tree (`by-spec/<id>.json` +
`by-package/<slug>.json`, schema 1.0.0) and `spec-spine compile` emits the
registry shard tree (`by-spec/<id>.json`). This phase COMMITS those shard trees
and re-includes them in `.gitignore` (the monolithic `index.json` /
`registry.json` are never emitted again). Committing the shards restores
present-on-clone (spec 101 SC-06) in a conflict-free form, superseding spec 188
Phase 4b's de-commit: disjoint per-spec files cannot textually collide, so the
merge queue forms clean speculative stacks. The implementation PR carries the
`amends: 188` edge and the spec 101 SC-06 restoration (effected, not merely
declared).

**AC-301.** `cargo build --workspace` succeeds with the deleted crates
absent. No dangling `path` or `crate` dependencies remain.

**AC-302.** `oap-registry-enrich by-authority <path>` produces output
consistent with the pre-deletion `registry-consumer by-authority` for
the same path (authority set preserved).

**AC-303.** `spec-spine index check` exits 0 (fresh index). `spec-spine
couple` exits 0 (coupling gate clean). The CI coupling workflow passes
locally.

### Phase 4: Rewire call sites

Every invocation of the deleted binaries is replaced:

- **Makefile**: `make registry`, `make ci`, `make ci-strict`,
  `make pr-prep`, `make setup`, and all spec-compiler/indexer/coupling-
  check/registry-consumer invocations repoint to `spec-spine compile`,
  `spec-spine index`, `spec-spine index check`, `spec-spine
  couple`, `spec-spine registry list`, etc., plus `oap-registry-enrich`
  for the OAP authority verbs. The Makefile section co-authority owners
  (~8 specs) whose sections are edited are in the diff per their
  `co_authority` declarations.
- **CI workflow** `ci-spec-code-coupling.yml`: binary invocation
  changes to `spec-spine index check && spec-spine couple`. The file
  path and workflow structure survive.
- **`release-tools.yml`**: the `oap-tools-*.tar.gz` bundle drops the
  generic engine binaries; the release artifact now bundles only OAP
  overlay binaries plus the `spec-spine` binary (distributed separately
  or bundled per the crates.io release model).
- **`.claude/rules/governed-artifact-reads.md`**: the consumer table is
  repointed (spec 103 co-authority; amend record in 103's spec.md).
  `registry-consumer` becomes `spec-spine registry` (for list/show/
  status-report) and `oap-registry-enrich` (for authority verbs).
  `codebase-indexer` becomes `spec-spine index`. The bad-pattern
  examples are updated.
- **`.claude/skills/`** (init, setup, cleanup): tool invocations
  referencing the deleted binaries are updated.
- **`.githooks/pre-commit`** and the `oap-index-regen` merge driver: the
  hardcoded in-tree-indexer binary paths are updated, AND the merge-driver
  `.gitattributes` globs re-point from `index.json` / `registry.json` to the
  shard paths (`.derived/**/by-spec/*.json`, `by-package/*.json`), mirroring
  spec-spine's `.gitattributes`. With disjoint shards the driver becomes a rare
  same-shard fallback rather than the common path.
- **`platform/services/statecraft/`**: `REGISTRY_CONSUMER_BIN` and
  its fallback logic repoints to `spec-spine registry` or
  `oap-registry-enrich` as appropriate (WS-B risk item R5).
- **`AGENTS.md`** and **`CLAUDE.md`**: binary name references updated.
- **`docs/`**: developer and architecture docs updated.

**FR-401 (Makefile rewire).** All Makefile targets that invoke the
deleted binaries use `spec-spine` subcommands or `oap-registry-enrich`.
`make ci` and `make pr-prep` execute successfully against the
post-deletion repo.

**FR-402 (governed-reads rule update).** `.claude/rules/governed-artifact-reads.md`
consumer table reflects the new consumer binaries. The rule's
enforcement logic and examples are accurate.

**FR-403 (statecraft binary).** `REGISTRY_CONSUMER_BIN` in statecraft
resolves to `spec-spine registry` or `oap-registry-enrich`; the service
starts without referencing a deleted binary.

**FR-404 (zero dead references).** A grep of the repo for the deleted
binary package names (`open_agentic_spec_compiler`,
`open_agentic_spec_registry_reader`, `open_agentic_codebase_indexer`,
`open_agentic_spec_code_coupling_check`) finds zero references outside
of spec.md files and git history. A grep for the deleted binary filenames
(`spec-compiler`, `registry-consumer`, `codebase-indexer`,
`spec-code-coupling-check`) in Makefile, workflows, `.claude/`, and
`AGENTS.md` / `CLAUDE.md` finds zero references.

**AC-401.** `make registry` exits 0 (calls `spec-spine compile`).

**AC-402.** `make pr-prep` exits 0 (calls `spec-spine index check` +
`spec-spine couple`).

**AC-403.** `make ci` exits 0 (full local validation suite, post-deletion).

**AC-404.** FR-404 grep check passes.

### Phase 5: Corpus governance wave

The supersession and amendment wave lands in the same PR as the
deletion (Phase 3) so the coupling gate never goes red: the wave is the
mechanism by which the gate knows to accept the deletion. Each
disposition is documented in section 6 (Supersession and Amendment Wave).

The bulk lifecycle migration of the 002-031 registry-consumer contract
series lands here. Each spec in the series carries an `extends` or
`refines` edge targeting `kind: crate, id: open_agentic_spec_registry_reader`;
that crate no longer exists. The migration:

- Sets `status: superseded` and `superseded_by: "217-spec-spine-engine-swap-collapse"`
  on each spec in the 003-031 series (002 is handled by the full
  supersede in this spec's frontmatter above).
- Strips the `open_agentic_spec_registry_reader` crate-unit from each
  spec's `extends`/`refines` edges (crate-unit with an unknown crate id
  yields an I-003 diagnostic in the library indexer; these are not
  live code claims and must be removed).
- For spec 029 (which also references a CI-path note about the
  registry-consumer binary path), updates that reference to
  `spec-spine registry`.

**FR-501 (wave integrity).** Every spec in the 003-031 series either
(a) carries `status: superseded, superseded_by: "217-spec-spine-engine-swap-collapse"`, or
(b) has its crate-unit stripped if it established only behavioural
contracts on the crate (no surviving code authority). The library
indexer reports zero I-003 diagnostics for `open_agentic_spec_registry_reader`
after the wave.

**FR-502 (wave is honest).** Each supersession and amendment disposition
reflects a genuine capability move or binary deletion. No spec is
superseded or amended purely to satisfy the gate. The auditor test is:
"would this disposition be correct even if the coupling gate did not
exist?"

**AC-501.** `spec-spine lint` (and the OAP overlay lint) exit 0 on the
post-wave corpus. No I-003 diagnostics for the deleted crate IDs.

**AC-502.** `spec-spine couple` exits 0 on the wave PR diff: every
edited path has its authority spec in the diff or a `Spec-Drift-Waiver:`
line in the PR body.

### Phase 6: Verify

Full CI pass on the combined deletion + wave PR:

- `spec-spine compile` exits 0; registry byte-identical to pre-deletion
  (same grammar, same corpus, same library version).
- `spec-spine index` + `spec-spine index check` exit 0; fresh
  index shards committed.
- `spec-spine couple` exits 0 on the PR diff.
- `spec-spine lint` exits 0 (OAP overlay lint appends clean).
- `oap-registry-enrich enrich` (compliance/OWASP report) emits; the
  report output is non-empty and structurally valid.
- Featuregraph golden regenerated (registry compiled first; per session
  memory pattern `feedback_golden_after_registry`).
- OPC reads the registry via `spec-spine-core::load_committed_registry`; the
  desktop app starts and governs correctly.

---

## 3. Functional Requirements Summary

| ID | Phase | Requirement |
|---|---|---|
| FR-000 | 0 | Library 0.5.0 compile + index, zero net errors (revised 2026-06-17; see section 1.5) |
| FR-101 | 1 | Overlay types crate compiles against spec-spine-types |
| FR-102 | 1 | Overlay lint compiles; OAP-domain codes preserved |
| FR-201 | 2 | All 8 consumer crates compile against library seam |
| FR-202 | 2 | opc-decomposition-pipeline uses spec-spine-core::compile |
| FR-203 | 2 | featuregraph index_bridge uses spec-spine-core::load_committed_index |
| FR-210 | 2 | oap-registry-enrich by-authority reads via load_committed_registry |
| FR-301 | 3 | All four generic engine crates deleted from workspace |
| FR-302 | 3 | oap-registry-enrich exposes authority-resolver verbs |
| FR-303 | 3 | .derived/codebase-index/ artifact shape preserved |
| FR-401 | 4 | Makefile rewired to spec-spine subcommands |
| FR-402 | 4 | governed-reads rule consumer table updated |
| FR-403 | 4 | statecraft REGISTRY_CONSUMER_BIN repointed |
| FR-404 | 4 | Zero dead references to deleted binary names |
| FR-501 | 5 | 003-031 wave: status superseded + crate-units stripped |
| FR-502 | 5 | Wave is honest (capability-moved rationale per spec) |
| FR-BLAST | 6 | Before/after authorities(P) diff shows zero paths lose all live owners |

---

## 4. Acceptance Criteria Summary

| ID | Phase | Criterion |
|---|---|---|
| AC-000 | 0 | spec-spine compile exits 0 on full corpus |
| AC-101 | 1 | spec-types overlay crate builds; downstream crates compile |
| AC-102 | 1 | spec-lint --fail-on-warn exits 0 |
| AC-201 | 2 | Workspace build succeeds (generic crates excluded) |
| AC-202 | 2 | Featuregraph golden passes (registry compiled first) |
| AC-203 | 2 | spec-spine compile output byte-identical to in-tree compiler |
| AC-301 | 3 | Workspace build succeeds post-deletion |
| AC-302 | 3 | oap-registry-enrich by-authority preserves authority output |
| AC-303 | 3 | spec-spine index check exits 0; spec-spine couple exits 0 |
| AC-401 | 4 | make registry exits 0 |
| AC-402 | 4 | make pr-prep exits 0 |
| AC-403 | 4 | make ci exits 0 |
| AC-404 | 4 | Dead-reference grep passes |
| AC-501 | 5 | spec-spine lint exits 0; zero I-003 for deleted crate IDs |
| AC-502 | 5 | spec-spine couple exits 0 on wave PR diff |
| AC-BLAST | 6 | Authorities diff confirms zero paths lose all live owners |

---

## 5. Authority-Preservation Gate (Blast Radius)

The **before/after `authorities(P)` corpus diff** is the landing gate
for this migration. The corpus diff is computed by running
`spec-spine couple --report-authorities` (or equivalent) against the
pre-deletion and post-deletion states and diffing the output.

**The mission halts** if any path in the OAP corpus unexpectedly loses
all live owners after the wave. A path losing a superseded predecessor
is expected (spec 216 Phase 2b already implemented supersession
filtering). A path losing its only live owner is a defect.

The pre-deletion baseline authority set must be verified for the three
change classes:

1. **Full-supersession deletions** (001, 002, 006, 133, 176, 181):
   every path previously owned by these specs must have a live
   alternative owner after the wave. In practice: the library's own
   claim on its API surfaces replaces the deleted specs' claims, or
   OAP overlay specs (via `extends`/`refines` edges) remain live owners.
2. **002-031 bulk migration**: the `kind: crate, id:
   open_agentic_spec_registry_reader` units are not physical paths; no
   `authorities(P)` path is affected. The migration is a metadata
   operation, not a code-authority operation.
3. **Amend targets** (103, 127, 128, 130, 184): the amended specs
   remain live owners of their edited paths. Amending a spec's spec.md
   does not remove its code authority.

**FR-BLAST.** A before/after `authorities(P)` diff is generated in the
verification phase (Phase 6). The diff shows zero paths where the
post-deletion authority set is empty and the pre-deletion set was
non-empty (excluding paths whose predecessor was already superseded by
spec 216 Phase 2b).

**AC-BLAST.** The authorities diff confirms: (a) zero paths lose all
live owners, (b) paths previously owned solely by a deleted spec have a
live alternative owner declared via an OAP overlay `extends`/`refines`
edge or the library's own claim surface.

---

## 6. Supersession and Amendment Wave

This section is the authoritative record of each affected spec's
disposition. The "honest rationale" column states why the disposition is
correct independent of gate mechanics. CONST-005 applies: every row
must survive the auditor test ("would this disposition be correct even
if the coupling gate did not exist?").

**When these edges land.** This wave is a PLAN. The `supersedes:` edges
on spec 217 and the `superseded_by:` / `status: superseded` flips on the
predecessors below are added by the implementation PR (Phase 5),
atomically with the binary deletion. They are deliberately absent from
this draft's frontmatter: until the in-tree binaries are actually
deleted, 001/002/006/133/176/181 remain approved and authoritative over
their still-present code, and the spine must not assert a supersession
that has not yet taken effect. Likewise the `amends:` edges to
103/127/128/130/184 land when their spec.md files are actually edited in
the implementation PR.

### 6.1 Full supersession by spec 217

| Spec | Title (abbreviated) | Disposition | Honest rationale |
|---|---|---|---|
| 001-spec-compiler-mvp | spec-compiler binary | FULL-SUPERSEDE | In-tree binary deleted; compile capability is now spec-spine-core::compile |
| 002-registry-consumer-mvp | registry-consumer binary | FULL-SUPERSEDE | In-tree binary deleted; authority-resolver verbs move to oap-registry-enrich; list/show/status-report move to spec-spine registry |
| 006-conformance-lint-mvp | spec-lint (generic) | FULL-SUPERSEDE | Generic lint codes move to spec-spine lint; in-tree binary deleted; OAP overlay lint is a separate crate not established by 006 |
| 133-amends-aware-coupling-gate | coupling-gate derivation algorithm | FULL-SUPERSEDE | The in-tree coupling-check binary is deleted; its algorithm is now in spec-spine-core::couple_with (confirmed drop-in); the CI workflow survives under spec 127 |
| 176-amends-aware-section-satisfaction-parity | section-satisfaction bug-fix | FULL-SUPERSEDE | Closed amendment on a deleted binary; the section-aware amends satisfaction it fixed is now in spec-spine-core; no in-tree subject remains |
| 181-registry-consumer-unit-grammar-authority | authority-resolver unit-grammar | FULL-SUPERSEDE | The refined binary (registry-consumer) is deleted; the unit-grammar authority resolver is re-implemented in oap-registry-enrich under its own ownership; spec 181's refines subject no longer exists in-tree |

### 6.2 Amendment (repoint to library/overlay; artifact or workflow survives)

These specs survive because their established artifacts or workflows
are not deleted. Their spec.md is amended to document the binary or
seam change.

| Spec | Title (abbreviated) | Disposition | What survives | Honest rationale |
|---|---|---|---|---|
| 101-codebase-index-mvp | codebase-indexer | AMEND | `.derived/codebase-index/` artifact, `codebase-index.schema.json`, `spec-spine index` subcommand replaces the binary | The artifact and schema survive unchanged; only the producing binary is deleted and replaced by the library indexer. Spec 101 continues to govern the artifact contract. |
| 127-spec-code-coupling-gate | CI workflow + make target | AMEND | `ci-spec-code-coupling.yml`, `make pr-prep`, contributor flow | The CI workflow and Makefile target survive; only the binary invocation changes from `spec-code-coupling-check` to `spec-spine couple`. Spec 127 governs the workflow, not the binary. |
| 130-spec-coupling-primary-owner | relationship graph + spec-types | AMEND | `tools/shared/spec-types/src/lib.rs` (as overlay), `standards/schemas/spec-spine/registry.schema.json` | Spec 130 establishes both files; the spec-types file survives as the OAP overlay crate (its established identity changes from full-types to overlay-types); the schema file is unchanged. |
| 132-constitutional-invariant-freeze | invariant-freeze mechanism | AMEND | `standards/schemas/spec-spine/registry.schema.json` (frozen), V-011 migrates to library | Spec 132's frozen schema invariant survives; V-011 moves to spec-spine-core. Amend 132 to record that V-011 is now a library-validated code. |
| 147-spec-kind-grammar | kind grammar + V-012..V-019 | AMEND | OAP overlay types (16-kind enum, VALID_KINDS, SHAPE_TABLE, W-130/131/132) | The OAP-domain validation codes and the kind enum survive in the overlay; the generic V-012..V-019 codes move to the library. Amend 147 to record which codes moved and which remain in the overlay. |
| 152-path-co-authority | named-anchor sectioning | AMEND | Section-matching logic moves to spec-spine-core | Spec 152's spec.md and the CI behaviour it governs survive; the code it established in the coupling-check binary is superseded by the library's section-matching. Amend 152 to record the re-homing. |
| 154-logical-unit-ownership-grammar | unit grammar + indexer | AMEND | Unit-grammar field definitions in overlay spec-types, `codebase-index.schema.json` | Spec 154's value (the unit grammar and the index schema) survives; only the producing binary is deleted. Amend 154 to record that the indexer source is now spec-spine-core. |
| 155-logical-unit-resolution-semantics | unit resolution precision | AMEND | V-024 and the unit-resolution fixes move to spec-spine-types | The precision fixes (V-024, module/directory/symbol resolution rules) are in the library. Amend 155 to record the re-homing; the spec's design rationale remains valid. |
| 161-knowledge-requirements-provenance-emission | W-161 decomposition-origin lint | AMEND | W-161 survives in OAP overlay lint | The W-161 code is an OAP-domain code (decomposition-origin provenance); it stays in the overlay lint. Amend 161 to record that its in-tree lint surface is now the overlay binary. |
| 179-domain-frontmatter-field | domain field + V-030/V-031 | AMEND | V-030/V-031 survive in OAP overlay; domain field grammar survives in overlay types | The domain field and OAP-domain validation codes are OAP-specific; they stay in the overlay. The `registry-consumer --domain` list filter has no `spec-spine registry list` equivalent (zero callers); a `--domain` filter would be added to `oap-registry-enrich` if a consumer needs it. Amend 179 to record the filter's retirement. |

### 6.3 Minor amendment (binary name change only)

| Spec | Title | Disposition | Rationale |
|---|---|---|---|
| 128-spec-lint-default-fail-on-warn | spec-lint strict posture | AMEND (minor) | The strict posture policy survives; only the Makefile invocation changes from `spec-lint` to `spec-spine lint` (generic) + `oap-spec-lint` (OAP overlay). Amend 128 to repoint its Makefile section authority annotation. |

### 6.4 Bulk lifecycle migration: 003-031 registry-consumer contract series

Specs 003-031 (excluding 006, already in the full-supersede table)
extend or refine `kind: crate, id: open_agentic_spec_registry_reader`.
That crate is deleted. These specs are behavioural contracts on a
deleted binary; the contracts are absorbed by the library's own contract
surface (`spec-spine registry` verbs).

**Disposition for each spec in 003-031 (excluding 006):**
- `status: superseded`
- `superseded_by: "217-spec-spine-engine-swap-collapse"`
- Strip the `open_agentic_spec_registry_reader` crate-unit from
  `extends:`/`refines:` edges (these are not live code claims and
  would yield I-003 diagnostics on a non-existent crate).

Exception: spec 029 additionally references a CI-path note about the
registry-consumer binary path. Update that reference to `spec-spine
registry` before marking superseded.

**Why this is honest:** these specs wrote behavioural contracts for a
binary that no longer exists. Their contractual intent (the output
format, the exit codes, the field shapes) is honoured by the library.
The contracts are not violated; their subject has moved. Marking them
superseded is accurate status, not gate-appeasement.

### 6.5 Implementation-PR reconciliation (empirically derived, 2026-06-18)

Executing this wave against the post-deletion corpus (spec-spine 0.8.0
`spec-spine index`) surfaced 107 hard error diagnostics (56 I-004 file-unit,
45 I-003 crate-unit, 4 I-006 section-unit, 2 I-007 directory-unit), every one
pointing inside the four deleted crates. Reconciling that empirical set against
sections 6.1-6.4 produced three corrections, recorded here so the wave's scope is
the diagnostic truth rather than the prose enumeration:

1. **The clearing mechanism is unit-stripping, not status.** A hard I-0xx fires on
   any owning-edge unit (`establishes`/`extends`/`refines`/`co_authority`) whose
   owning spec carries `implementation: complete`, independent of `status`. Flipping
   a spec to `superseded` does NOT downgrade its dangling-unit errors (verified:
   superseding 001 left both I-004 errors intact); only removing the unit (the file
   is genuinely deleted) clears the diagnostic. So every wave spec, superseded and
   amended alike, has its deleted-crate units physically stripped; the supersession
   flips are the honest lifecycle disposition layered on top, not the gate mechanism.
   (`references:` edges are the exception: they degrade to W-002 warnings regardless
   of status.)

2. **Section 6.4's "003-031" range is corrected to 002 + 007-031.** Only 002 and
   007-031 carry the `open_agentic_spec_registry_reader` crate-unit. Spec 003
   (feature-lifecycle-mvp) carries no crate-unit; it dangles file-units on the deleted
   spec-compiler/registry-consumer and is the authored lifecycle-status model (which
   survives), so it is reclassified to amend. Specs 004 (spec-to-execution-bridge) and
   005 (verification-reconciliation) claim NO deleted-crate units and emit zero
   diagnostics; superseding them would FAIL the FR-502 honesty test (their subjects
   are not deleted), so they are excluded from the wave.

3. **Gap-amend set (erroring specs unenumerated in 6.1-6.4).** Ten specs carry dangling
   deleted-crate owning-units that section 6 did not list. Each survives approved with
   authority elsewhere; each has its deleted-crate units stripped and is amended by 217:
   003 (lifecycle model), 039 (codeAliases; keeps registry.schema.json), 091 (enrichment;
   keeps featuregraph readers), 102 (governed-excellence; keeps factory-engine,
   tool-registry, policy-kernel, orchestrator), 118 (workflow traceability; keeps the
   `.github/workflows` refines), 129 (granular metadata; codebase-index schema edge
   re-anchored to the overlay schema by Workstream D), 156 (references-edge provenance;
   keeps spec-types, registry schema, golden), 159 (V-004 fixture
   exemption; authority is its amends-000 refinement), 182 (claude-skills; keeps the
   `.claude/skills` establishes), 188 (index merge serialization; keeps githooks,
   ci-parity, config-hash).

4. **Workstream D: monolithic schema drop (FR-301/FR-303).** D drops the in-tree
   `standards/schemas/spec-spine/codebase-index.schema.json` (monolithic 3.1.0) in
   favour of the spec-spine library's per-unit shard schemas (1.0.0). Five specs claimed
   it on owning edges and are reconciled: 101 (establishes) and 129 (extends-101)
   re-anchor onto the surviving OAP overlay schema `codebase-index-oap.schema.json`
   (the L1-5 enriched superset emitted by `oap-code-index-enrich`, itself tagged spec
   101); 154, 156, and 188 strip the schema edge and retain their other owning units.
   The drop produced exactly five I-004 file-unit errors before reconciliation (verified
   empirically); after, `spec-spine index` reports zero. Honest per FR-502: the generic
   schema genuinely moved to the library, so each stripped or re-anchored edge points at
   a genuinely-absent or genuinely-relocated file.

**Residuals (Workstream D/G; not blocking this wave's index + lint gates):**
- The surviving `tools/spec-spine/spec-lint` crate's `[package.metadata.oap] spec`
  still names the now-superseded 006. The crate source is owned by live specs (147/179
  via units); only the package-level primary-spec pointer is stale, and no diagnostic
  fires. Repointing it to a live spec (147 established the spec-lint kind-grammar
  surface) is a one-line Cargo.toml edit folded into the same PR.
- `product/apps/opc/src-tauri/Cargo.lock` couples to spec 178's directory ownership
  (see Workstream A3); the PR body carries a scoped `Spec-Drift-Waiver`.

**6.5 honesty test (FR-502).** Every disposition above clears the auditor test
("correct even if the gate did not exist?"): the four crates are genuinely deleted,
each stripped unit points at a genuinely-absent file, and every surviving unit is
retained. 004 and 005 are left untouched precisely because that test fails for them.

---

## 7. Coupling: How Spec 217's Own Edits Are Coupling-Clean

This spec edits a large surface. Each edit class is accounted for:

**Spec 217 spec.md itself** (this file): no coupling rule applies to
spec.md files (they are not `implements` claimants).

**`spec-spine.toml`** (new file, established by this spec's
`establishes:` edge): no predecessor owner; the edge is authoritative.

**Featuregraph golden** (`crates/featuregraph/tests/golden/features_graph.json`):
governed by the `extends: {spec: "034-featuregraph-registry-scanner-fix", nature: additive}` edge in this spec's frontmatter.

**Makefile sections**: each section is governed by its section's
co-authority owner set. This spec's implementing PR edits those
sections and includes the respective owner specs in the diff (or carries
Spec-Drift-Waiver for any section owner that is superseded by this
spec in the same PR).

**`ci-spec-code-coupling.yml`**: established by spec 127. This spec's
`amends: ["127-spec-code-coupling-gate"]` edge confers co-authority; spec
127's spec.md is in the diff (the amendment record is added to it).

**`.claude/rules/governed-artifact-reads.md`**: owned by spec 103. This
spec's `amends: ["103-init-protocol-governed-reads"]` edge confers
co-authority; spec 103's spec.md is in the diff.

**`tools/shared/spec-types/src/lib.rs`**: established by spec 130. This
spec's `amends: ["130-spec-coupling-primary-owner"]` edge confers
co-authority; spec 130's spec.md is in the diff.

**Deleted source files** (the four generic engine crates): deletion of
a file that is `establishes`-claimed by a superseded spec is coupling-
clean once the establishing spec's frontmatter carries
`superseded_by: "217-spec-spine-engine-swap-collapse"` in the same PR.
The coupling gate excludes superseded specs from `legitimate_owners(P)`
per spec 216 Phase 2b (FR-011). The wave lands in the same PR as the
deletion, so the gate sees the superseded status before evaluating the
deleted paths.

**CLAUDE.md and AGENTS.md**: amended by spec 184-claude-shared-config-governance / spec 103 edges
declared above.

**Spec 217 is the superseder, not an amender, for 001/002/006/133/176/181.**
For each of those specs, the implementation PR carries that spec's
spec.md with `superseded_by: "217-spec-spine-engine-swap-collapse"`.
That is the coupling-clean path for a superseding spec deleting the
established files of a fully-superseded predecessor.

---

## 8. Success Criteria

**SC-001 (zero generic engine).** After the landing PR, no source file
under `tools/spec-spine/` belongs to any of the four deleted crate
packages. The directory `tools/spec-spine/` contains only the OAP
overlay lint crate (if not moved to `tools/oap/`) and any non-crate
artifacts (test fixtures that are now governed by the library).

**SC-002 (gate is the library).** OAP's CI coupling gate is
`spec-spine couple`. The `ci-spec-code-coupling.yml` workflow invokes
no in-tree binary. Exit codes 0/1 are preserved.

**SC-003 (overlay survives).** The OAP overlay (16-kind enum,
shape/category, compliance, factory/OWASP report, capability/registry/
profile, statecraft:// provenance, W-130/131/132, V-030/031, W-161,
L-005) is intact and tested. No OAP-specific typed modelling is lost.

**SC-004 (authority preservation).** The before/after `authorities(P)`
corpus diff confirms zero paths lose all live owners (FR-BLAST /
AC-BLAST).

**SC-005 (wave is honest).** Every superseded spec has a
`superseded_by:` pointer to 217. Every amended spec has an
`amendment_record:` entry naming 217 and a prose callout documenting
what changed. No spec is superseded or amended without an honest
rationale that is independent of gate mechanics.

**SC-006 (featuregraph golden).** The featuregraph golden test passes
against the library-compiled registry. The golden is regenerated in the
landing commit with the registry compiled first.

**SC-007 (OPC desktop app).** The OPC desktop app builds and reads the
registry via `spec-spine-core::load_committed_registry`. The governance panel
hydrates correctly from the library-produced registry.
