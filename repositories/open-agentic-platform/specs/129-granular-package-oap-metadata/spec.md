---
id: "129-granular-package-oap-metadata"
slug: granular-package-oap-metadata
title: "Granular [package.metadata.oap] — file-level spec annotation via comment headers"
status: approved
implementation: complete
owner: bart
created: "2026-05-02"
approved: "2026-05-02"
amended: "2026-06-18"
amendment_record: |
  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree codebase-indexer that parsed file-level `// Spec:` headers was deleted; that logic is now in spec-spine-core. The codebase-indexer crate-unit is stripped (path deleted); the spec re-anchors onto the surviving OAP overlay schema codebase-index-oap.schema.json (the in-tree codebase-index.schema.json was dropped by Workstream D).
kind: governance
domain: tooling
risk: medium
depends_on:
  - "101-codebase-index-mvp"  # codebase-index-mvp (the schema being extended)
  - "118-workflow-spec-traceability"  # workflow-spec-traceability (the `# Spec:` precedent)
code_aliases: ["GRANULAR_OAP_METADATA"]
# 217 deleted the in-tree codebase-indexer; file-level `// Spec:` header parsing is
# now in spec-spine-core. The codebase_indexer crate-unit is stripped (deleted).
# Workstream D dropped the in-tree codebase-index.schema.json (the TraceSource grammar
# this spec extended now lives in the library shard schemas), so this edge re-anchors
# onto the surviving OAP overlay schema codebase-index-oap.schema.json. Amended by 217.
extends:
  - spec: "101-codebase-index-mvp"
    nature: additive
    unit: { kind: file, path: standards/schemas/spec-spine/codebase-index-oap.schema.json }
summary: >
  Crate-level `[package.metadata.oap].spec` is too coarse — adding a 500-
  line module to an already-tagged crate carries no traceability friction.
  This spec adds file-level annotation via `// Spec: specs/NNN-slug/spec.md`
  comment headers (matching the existing convention used in 50+ files),
  parsed by `codebase-indexer` at compile time. Precedence is file > module
  (reserved) > crate. Schema bumps `1.1.0` → `1.2.0`; `TraceSource` is
  extended with `cargo-metadata-crate` (renamed from `cargo-metadata`),
  `cargo-metadata-module` (reserved), `comment-header` (new), and
  `multiple` (replacing the legacy `both`).
---

# 129 — Granular `[package.metadata.oap]`

## 1. Problem Statement

Spec 101 (codebase-index-mvp) emits Layer 2 traceability mappings keyed
by `(spec_id, implementing_path)`. Two source channels populate it:

- Spec frontmatter `implements:` — declarative, by the spec author.
- Cargo `[package.metadata.oap].spec` — passive, on the crate root.

Both are crate-coarse. Adding a new module to `crates/factory-engine/` —
whose `[package.metadata.oap].spec = "075-factory-workflow-engine"` —
inherits that ownership silently, even when the new module is plausibly
the implementation of a different spec (e.g. spec 094 unified-artifact-
store, or spec 098 governance-enforcement-stitching).

The drift surface is asymmetric: the CI gate added by spec 127
(spec/code coupling) fires on spec 075 for a change that should have
routed through 094. The friction lands on the wrong door.

The repo already has a working precedent: 50+ source files carry
`// Spec: specs/NNN-slug/spec.md` doc-comment headers, but no tool
parses them — they are advisory annotations only. This spec promotes
the convention to a first-class indexer input.

## 2. Goals

- **File-level granularity** without churn on crates that don't need it.
  The crate-level annotation remains the default; comment headers refine.
- **Match the existing convention.** The header form is exactly what is
  already in 50+ files, including `crates/factory-engine/src/governance_certificate.rs`,
  so the rollout is documentation-then-enforce, not migration.
- **Precedence rule:** file > module > crate. A file-level annotation
  overrides what the file would inherit from its enclosing module/crate.
  (Module-level annotations are reserved for a future schema; spec 129
  declares the variant but does not yet emit it.)
- **Schema-versioned contract.** Extending `TraceSource` is a schema
  change; the indexer's compile-time `SCHEMA_VERSION` constant moves
  `1.1.0` → `1.2.0`. Consumers that hardcode `1.1.0` (none today
  outside the indexer's own self-test) need a coordinated bump.

## 3. Scope

### In scope

- New `comment_scanner` module in `tools/spec-spine/codebase-indexer/` that walks
  `.rs` files inside discovered package directories and extracts the
  leading-block `// Spec: specs/NNN-slug/spec.md` annotation (or short
  form `// Spec: NNN-slug`, or doc-comment `//! Spec: …`).
- `xref` engine extended to merge file-level claims into the
  `implementingPaths` array. A path claimed by 2+ sources gets
  `source: "multiple"`; previously this was the bespoke `both`.
- `TraceSource` enum extended in `tools/spec-spine/codebase-indexer/src/types.rs`:
  `cargo-metadata` → `cargo-metadata-crate`; new variants
  `cargo-metadata-module` (reserved) and `comment-header`; `both` →
  `multiple`.
- `schemaVersion` const bumped to `1.2.0`. The JSON Schema's `source`
  enum updated to match.
- The mechanism only — parser, schema bump, types, xref merge.
- Demonstration deferred (see §7) — picking representative files in
  busy crates over-fires the spec 127 coupling gate (every spec that
  broadly claims `crates/<name>` cascades into the violation block,
  not just the file-specific owner). Spec 129b will land per-file
  demos paired with a gate refinement that handles multi-claim paths
  with a "primary owner" rule.

### Out of scope

- Backfilling all 50+ existing `// Spec:` comments into the index — this
  spec promotes the mechanism; the rollout is opportunistic.
- Module-level annotation (`[lib.metadata.oap]` or similar). The variant
  is reserved; no parser emits it. A future spec defines the wire form.
- Changing how `spec-code-coupling-check` (spec 127) consumes the index.
  Adding `comment-header` entries to `implementingPaths` increases the
  surface the gate covers, but the gate's algorithm is unchanged.

## 4. Functional Requirements

- **FR-001 — leading-block recognition.** The scanner reads the first N
  lines of each `.rs` file. Comment lines (`//`, `///`, `//!`) are
  inspected for a `Spec:` keyword (case-sensitive) followed by a spec
  identifier. The scan stops at the first non-comment non-blank line.
- **FR-002 — accepted forms.**
  - `// Spec: specs/NNN-slug/spec.md` (canonical)
  - `// Spec: specs/NNN-slug/spec.md — FR-001 through FR-007` (qualifier
    discarded)
  - `// Spec: NNN-slug` (short)
  - `//! Spec: …` (doc comment)
  All extract the same `NNN-slug` token. The first matching line wins.
- **FR-003 — spec ID validation.** The extracted token must match
  `^\d{3}-[a-z][a-z0-9-]+$`. Invalid IDs are silently dropped (the
  scanner is best-effort; bad IDs surface in normal `I-101` diagnostics
  if the path pretends to claim them).
- **FR-004 — directory exclusions.** `target/`, `node_modules/`, `.git/`,
  `tests/`, `benches/` are skipped during traversal. Test fixtures and
  scratch builds are noise for traceability.
- **FR-005 — index emission.** Each accepted (file_path, spec_id) pair
  becomes a new `ImplementingPath` under the matching `TraceMapping`.
  If the same path is already claimed by another source, the entry's
  `source` is upgraded to `multiple` (replacing the legacy `both`).
- **FR-006 — schema bump.** `SCHEMA_VERSION = "1.2.0"`; the schema JSON's
  `schemaVersion.const` matches; the `source` enum lists the five new
  variants.
- **FR-007 — precedence (advisory).** When a file declares one spec and
  its enclosing crate's `[package.metadata.oap].spec` declares another,
  both claims are emitted (file is more specific; crate is broader).
  Consumers that need a single owner per file should prefer the
  comment-header source; this spec does not change consumer behaviour.

## 5. Acceptance

- **AC-1 — schema version visible.** Running `codebase-indexer compile`
  produces `index.json` with `"schemaVersion": "1.2.0"`.
- **AC-2 — comment header surfaces.** A focused unit test in
  `tools/spec-spine/codebase-indexer/src/comment_scanner.rs::tests` verifies that
  a synthetic file with `// Spec: specs/044-multi-agent-orchestration/spec.md`
  produces the expected `ImplementingPath` entry with
  `source: "comment-header"`. Real-corpus demonstration is deferred
  (see §7).
- **AC-3 — schema conformance.** `cargo test --manifest-path
  tools/spec-spine/codebase-indexer/Cargo.toml` continues to pass; the
  `schema_conformance` and `golden` tests cover the new schema.
- **AC-4 — `make ci` exits 0.** The `tools/spec-spine/codebase-indexer/tests/`
  unit and integration tests cover the parser; the spec-coupling gate
  (spec 127) accepts the broader `implementingPaths` set without
  spurious violations.
- **AC-5 — existing convention not regressed.** `governance_certificate.rs`'s
  pre-existing `// Spec: specs/102-governed-excellence/spec.md` header
  is now picked up automatically. The cascade effect (every existing
  `// Spec:` header in the corpus becomes an index entry) is what
  forces the §7 follow-up — the spec 127 gate amplifies the friction
  beyond what most cross-cutting changes can reasonably absorb.

## 7. Halt finding — gate over-fires on multi-claim paths

A demo that adds `// Spec:` headers to three files in
`crates/axiomregent/` and `crates/orchestrator/` triggers 20 spec
violations under spec 127's gate. The cascade arises because:

- 12 specs declare `implements: crates/orchestrator` at the crate level.
- 7 specs declare `implements: crates/axiomregent` at the crate level.
- The gate treats every owner equally (FR-003 of spec 127): each owner's
  `spec.md` must appear in the diff.
- Adding a comment-header claim is additive — it never reduces ownership.

The strict semantics is correct in principle, but the current corpus
of `implements:` declarations is broad-by-design (specs declare
"includes this crate" rather than "is the primary owner of this
crate"). For shared infrastructure, every cross-cutting change demands
a fan-out of cosmetic spec amendments that don't add governance value.

**Resolution paths (deferred):**

1. **Spec 129b — primary-owner heuristic in the gate.** When `>1` spec
   claims a path, treat any one of their `spec.md` edits as covering
   the path. Strict-but-not-cascading.
2. **Spec 129c — refine `implements:` declarations.** Tighten broad
   crate claims to subdirectory or file paths so the gate's per-owner
   rule selects the right reviewer. High effort.
3. **Spec 129d — supplemental `primary: true` flag in `implements:`.**
   Extend the schema so each spec declares one primary owner per claimed
   path; the gate fires only on the primary's spec.md.

Spec 129 lands the mechanism. The demo step and gate refinement are
follow-up work that should be scoped explicitly rather than absorbed
into this PR.

## 6. Risks and Mitigations

- **Risk:** False positives on test fixture files containing `// Spec:`
  text as part of a parser test.
  **Mitigation:** `tests/` and `benches/` directories are excluded from
  the walk (FR-004).

- **Risk:** A file lists the wrong spec ID (typo); the spec doesn't
  exist; the file's claim becomes a phantom mapping.
  **Mitigation:** `xref` already emits `I-101` diagnostics for
  unresolvable paths. A future amendment can add `I-102` for
  comment-header claims pointing at unknown spec IDs; deferred to
  keep this PR small.

- **Risk:** Precedence rule contradicts the gate's strictness.
  Adding a file-level claim to a crate that already has crate-level
  ownership doubles the claim count.
  **Mitigation:** The xref engine emits `source: "multiple"` for any
  path with 2+ overlapping sources, so reviewers can see the duplication.
  The gate (spec 127) treats any `implementingPath` as authoritative —
  duplication does not change correctness, only verbosity.


## Amendments received

**Amendment 2026-05-24 (record: 178-opc-directory-rename).**
Spec 178 (opc-directory-rename, 2026-05-24): mechanical path rename
`product/apps/desktop/*` → `product/apps/opc/*`. No semantic change
to this spec's claims; owned paths inherit the new prefix.
