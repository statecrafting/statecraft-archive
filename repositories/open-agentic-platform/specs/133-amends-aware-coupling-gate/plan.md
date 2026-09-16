# Implementation Plan: Amends-Aware Spec/Code Coupling Gate

**Branch**: `133-amends-aware-coupling-gate` | **Date**: 2026-05-03 | **Spec**: `./spec.md`
**Input**: Feature specification from `specs/133-amends-aware-coupling-gate/spec.md`

## Summary

Spec 127's gate currently resolves a path's "legitimate owners" exclusively
through `implements:` claims. Spec 130 relaxed the strict-all-owners rule
to a primary-owner heuristic but kept the same source. This plan extends
the resolver to also recognise:

- `amends:` (forward link, on the amender's frontmatter)
- `amendment_record:` (reverse link, on the amended spec's frontmatter)

Both produce additional legitimate owners that compose with the existing
`implements:` set. Any one in the diff clears the path. The change is a
strict expansion: no path is rejected that would have passed today.

The investigation begins with a question: does the codebase-indexer
already surface `amends:` / `amendment_record:` in `index.json`? Two
implementation shapes follow:

- **Shape A (data already present):** gate-side change only.
- **Shape B (data absent):** indexer scanner + schema bump + gate change,
  landing as one PR per spec 130's pattern.

## Technical Context

**Language/Version**: Rust 1.95.0 (workspace toolchain)
**Primary Dependencies**: `serde_json` (existing), `clap` (existing); no
new crates expected.
**Storage**: file-system reads of `.derived/codebase-index/index.json` and
`specs/*/spec.md` frontmatter. No persistent state introduced.
**Testing**: `cargo test --manifest-path tools/spec-spine/spec-code-coupling-check/Cargo.toml`
(integration tests under `tests/cli.rs`); spec-compiler integration tests
remain unaffected.
**Target Platform**: CI (Linux runners) + local macOS/Linux dev shells.
**Project Type**: CLI tool (`tools/spec-spine/spec-code-coupling-check/`) consumed
by `make ci-spec-code-coupling` and `.github/workflows/ci-spec-code-coupling.yml`.
**Performance Goals**: gate runtime under 500 ms on a 130-spec corpus;
amend-aware resolution adds at most one additional pass over the index's
mappings array.
**Constraints**: no behavioural regression — every diff that passes
today must pass after the change. Strict expansion only.
**Scale/Scope**: 130-spec corpus today; design accepts at least 10× growth
without requiring index restructuring.

## Constitution Check

*GATE: Must pass before implementation. Re-check before commit.*

- **Principle II — compiled JSON machine truth.** The gate already reads
  `.derived/codebase-index/index.json` through typed deserialisation per
  spec 103. New fields (if added) flow through the same governed
  consumer pattern. ✅
- **Principle: schema version as compile-time const.** If
  `codebase-index.schema.json` gains fields, the indexer's
  `SCHEMA_VERSION` const bumps in lockstep (per the project memory
  preference). ✅
- **CONST-005 — spec/code coherence (spec 131).** This implementation
  IS the spec for itself; no cross-spec drift is introduced. The gate
  fires on its own changes via the standard waiver/owner pattern. ✅
- **No backwards-compat shims** (project memory). The new resolver
  paths replace nothing; the change is additive. No fallback toggles,
  no feature-flag for the new behaviour. ✅
- **Governed-artifact-reads (spec 103).** All reads of `index.json` go
  through the existing typed loader; no `jq`/`python` introduced. ✅

## Project Structure

### Documentation (this feature)

```text
specs/133-amends-aware-coupling-gate/
├── spec.md       # Feature spec
├── plan.md       # This file
└── tasks.md      # Implementation task list
```

No `research.md` / `data-model.md` / `contracts/` are produced — the
underlying data model is already governed by spec 101 (codebase-indexer)
and spec 119 (amends: protocol). This spec composes them.

### Source Code (repository root)

```text
tools/
├── codebase-indexer/
│   ├── src/
│   │   ├── spec_scanner.rs     # MAYBE EDITED: read amends: + amendment_record:
│   │   ├── types.rs            # MAYBE EDITED: add fields to TraceMapping
│   │   └── lib.rs              # MAYBE EDITED: bump SCHEMA_VERSION const
│   └── tests/
│       └── ...                 # MAYBE EDITED: fixture covering new fields
├── spec-code-coupling-check/
│   ├── src/
│   │   ├── lib.rs              # EDITED: extend legitimate_owners() resolver
│   │   └── main.rs             # NO CHANGE
│   └── tests/
│       └── cli.rs              # EDITED: AC-1 through AC-6 fixtures
schemas/
└── codebase-index.schema.json  # MAYBE EDITED: declare new fields
```

**Structure Decision**: a single PR landing the resolver change plus —
if needed — the indexer change. Spec 130 set the precedent for "land
the gate refinement in one cohesive change." Same shape here.

## Implementation Phases

### Phase 0 — Investigation (no edits)

Verify whether `.derived/codebase-index/index.json` already contains
`amends:` and `amendment_record:` for at least one spec mapping.
Specifically check:

```bash
grep -A 2 '"specId": "132-' .derived/codebase-index/index.json
grep -A 2 '"specId": "119-' .derived/codebase-index/index.json
```

Look for `amends` / `amendmentRecord` keys. Outcome decides Shape A vs B.

### Phase 1 — Indexer extension (Shape B only)

If Phase 0 shows missing data:

1. Extend `tools/spec-spine/codebase-indexer/src/spec_scanner.rs` to read both
   fields from frontmatter.
2. Add `amends: Vec<String>` and `amendment_record: Option<String>`
   (or `Vec<String>` if multi-record patterns exist) to the
   `TraceMapping` in `tools/spec-spine/codebase-indexer/src/types.rs`.
3. Update `standards/schemas/spec-spine/codebase-index.schema.json` to declare the new
   fields under `traceability.mappings.items.properties`.
4. Bump `SCHEMA_VERSION` (compile-time const) in `lib.rs` or wherever
   it lives. The `make ci` schema-conformance gate will validate the
   self-consistency.
5. Recompile the index; commit the regenerated `index.json` along with
   the source change.

### Phase 2 — Gate resolver extension (always)

1. Extend the typed `Index` loader in `tools/spec-spine/spec-code-coupling-check/`
   to surface the two new fields.
2. Modify the `legitimate_owners()` resolver per spec §5.2 — three
   owner classes, union semantics, source-tagged for renderer.
3. Update the renderer to label each owner by source class
   (`implements`, `amends`, `amendment_record`).

### Phase 3 — Tests

Add integration test fixtures under `tools/spec-spine/spec-code-coupling-check/tests/cli.rs`
covering AC-1 through AC-6 from the spec. Each fixture builds a synthetic
`index.json` (extending the existing helper `write_synthetic_index`) with
the new fields populated.

### Phase 4 — Cross-references

- Spec 127: append a "Defect log" entry recording the gap closed.
- Spec 130: append an "Amendment record" entry composing with this
  spec.
- Spec 119: optional cross-reference confirming the protocol now has
  enforcement at the gate.

### Phase 5 — Verification

Run the four lighter checks (spec-compiler, spec-lint --fail-on-warn,
codebase-indexer check, ci-spec-code-coupling) plus the gate's own
unit tests. If all green, run the full `make ci` once before commit.

## Complexity Tracking

| Concern | Why Needed | Simpler Alternative Rejected Because |
|---------|------------|---------------------------------------|
| Three resolver classes | Forward + reverse + path-1 amend protocol is genuinely tri-modal per spec 119 | A single "any-amend-link" predicate would conflate forward and reverse semantics; renderer output would be ambiguous. |
| Schema bump on indexer | If Phase 0 shows data is absent, we must surface it | Reading frontmatter ad-hoc from the gate would bypass governed-reads (spec 103). Indexer is the right consumer boundary. |

No constitution violations. Strict expansion of accepted couplings;
no widening of dangerous behaviour.
