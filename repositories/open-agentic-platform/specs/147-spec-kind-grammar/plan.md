# Implementation plan — Spec-kind grammar amendment (147)

## Overview

This plan sequences the implementation of amendment 147 across four
phases, each independently shippable and revertible. Each phase
preserves the invariant that the existing 147-spec corpus continues
to compile cleanly.

The ordering principle: **all new validation begins at warning
severity, promotes to error only after backfill is complete**. This
avoids any moment where the corpus is invalid.

## Phase 1 — Grammar additions, warnings only

**Goal:** spec-compiler accepts new fields; emits diagnostics
without failing. Schema bumps to 1.5.0.

### Changes

1. `tools/spec-spine/spec-compiler/src/lib.rs`
   - Extend `KNOWN_KEYS` (around line 31–51) with the new field
     names: `shape`, `category`, `supersedes`, `superseded_by`,
     `retirement_rationale`, `provides`, `selectable_by`,
     `selector`, `default`, `production_forbidden`,
     `member_contract`, `identity`, `selects`, `policy`,
     `composition`.
   - The `composition:` key holds a nested object with optional
     keys `requires`, `soft_requires`, `conflicts`. Parsing
     follows the existing nested-object pattern used for
     `provides:` and `identity:`. No new parser machinery is
     required.
   - `changeset_kind:` is not added — `shape:` covers
     amendment-shape classification using the `kind: amendment`
     row of the (kind, shape) table.
   - Define `VALID_KINDS` constant (the 16-value enum from spec
     §Grammar additions).
   - Define `SHAPE_TABLE` constant (the (kind, shape) lookup).
   - Add parsing for each new field on `FeatureRecord` struct
     (`tools/spec-spine/spec-compiler/src/lib.rs:368` area).
   - Implement V-012 through V-019 violation emission at warning
     severity (use `severity: "warning"` field on Violation).
   - Disambiguate `implements:` shape: parse as `String` if YAML
     scalar, as `Vec<ImplementsItem>` if YAML list. Add
     `ImplementsItem { path: String, primary: Option<bool> }`.
   - Serialize `implements:` to registry output (currently silently
     consumed per Agent 1 finding).

2. `tools/spec-spine/spec-compiler/src/lib.rs` — bump `SPEC_VERSION` constant
   from 1.4.0 to 1.5.0.

3. `standards/schemas/spec-spine/registry.schema.json`
   - Bump `$id` version to 1.5.0.
   - Add field declarations per `contracts/registry.schema.json.patch`.

4. `standards/schemas/spec-spine/build-meta.schema.json`
   - Bump expected `spec_version` to match 1.5.0.

5. **Test fixtures.**
   - Update `tools/spec-spine/spec-compiler/tests/schema_conformance.rs` to
     reflect the new schema version.
   - Update `crates/featuregraph/tests/golden/features_graph.json`
     after the first compile (sidecar regeneration commit).

6. **Spec 000 amendment record.**
   - Append `147-spec-kind-grammar` to spec 000's
     `amendment_record:` field.
   - Update spec 000's body section "Amendment frontmatter
     convention" to reference this amendment as the third in
     sequence.

### Acceptance check

```bash
make registry          # compiles cleanly with 1.5.0 schema
make spec-lint         # no errors; warnings for V-012..V-019 fires
make index             # codebase-indexer accepts new fields
```

### Revert path

Revert `tools/spec-spine/spec-compiler/src/lib.rs` and the schema bump.
Existing specs continue to compile under 1.4.0.

## Phase 2 — `kind:` backfill and V-012 promotion

**Goal:** the 28 specs without `kind:` are backfilled; V-012
promotes from warning to error.

### Changes

1. **Survey the 28 unkinded specs** (list to be produced by
   `tools/spec-spine/registry-consumer status-report --filter no-kind --json`,
   added as a tooling subcommand in Phase 1).

2. **Assign a kind to each.** Most will resolve to existing values
   (`platform`, `governance`, etc.) based on content review. Author
   the kind assignments as a single PR.

3. **Promote V-012 to error severity** in spec-compiler.

### Acceptance check

```bash
make registry
# All 147 specs declare a valid kind; V-012 enforced.
```

### Revert path

Demote V-012 to warning. Specs retain their kind values without
enforcement.

## Phase 3 — Capability/registry/profile authoring proving ground

**Goal:** at least one capability, one registry, and one profile
spec land in the corpus, exercising V-013, V-014, V-015, V-017 at
warning severity. Validator promotion to error severity is
deferred to a separate follow-on amendment after a critical mass
of new-kind specs has tested the contract against unforeseen
cases. Phase 3 here lands the proving ground only; contract
enforcement is a distinct constitutional act.

### Changes

1. Author three specs (numbered next-available, kind = capability,
   registry, profile respectively). Initial candidates:
   - One registry spec for the auth-driver concept (drawn from
     acme-vue-node analysis).
   - One capability spec for the SAML auth driver implementation.
   - One profile spec for a generic example tenant (no
     jurisdictional content).

2. **Validators stay at warning.** V-013, V-014, V-015, V-017
   continue emitting warnings against the new-kind specs in
   Phase 3. Diagnostics surface contract drift; tooling consumes
   the new fields; no severity promotion ships in this
   amendment. Promotion is the subject of a separate follow-on
   amendment with its own scrutiny.

3. **Tooling additions.**
   - `tools/spec-spine/registry-consumer` gains `--kind`, `--shape`,
     `--category` filter flags.
   - `crates/featuregraph` adds queries for capability ↔ registry
     resolution and profile selection traversal.

### Acceptance check

```bash
make registry          # three new specs compile, V-013..V-017 fire as warnings
registry-consumer list --kind capability
registry-consumer list --kind registry
registry-consumer list --kind profile
```

### Revert path

Retract the three proving-ground specs. Tooling additions to
registry-consumer and featuregraph are independently revertible.
V-013..V-017 stay at warning severity throughout this amendment,
so no severity demotion is needed.

## Phase 4 — W-rewire and V-018/V-019 promotion

**Goal:** W-002 and W-003 are rewired from prose scans to
frontmatter-presence checks; V-018 and V-019 are promoted to
error severity.

### Changes

1. **Verify Phase 1's KNOWN_KEYS promotion routed `superseded_by:`
   from `extraFrontmatter` to the top-level `FeatureRecord` field
   for specs 038, 040, 044, 088.** No source-spec edits are
   required — the four specs already carry `superseded_by:`
   today; the compiler routing changes when KNOWN_KEYS is
   extended in Phase 1. The "backfill" in earlier drafts of
   this plan was a no-op; what looks like backfill is actually
   auto-promotion via routing.

2. **Rewire W-002 and W-003** in `tools/spec-spine/spec-lint/src/lib.rs`:
   - Remove `superseded_pointer_ok(body)` prose scan helper.
   - Remove `retired_rationale_ok(body)` prose scan helper.
   - Replace W-002 check with: `status == "superseded" && superseded_by.is_none()`.
   - Replace W-003 check with: `status == "retired" && retirement_rationale.is_none()`.

3. **Promote V-018, V-019 to error severity.**

### Acceptance check

```bash
make spec-lint         # W-002 and W-003 fire from frontmatter; prose scans deleted
make registry          # V-018, V-019 enforced
```

### Revert path

Restore prose scans; demote V-018, V-019 to warning.

## Cross-phase concerns

### Backward compatibility with codebase-index

`tools/spec-spine/codebase-indexer` consumes `implements:` via its existing
spec-frontmatter scan. The Phase 1 promotion of `implements:` to
registry-serialized adds a new consumption path for
`crates/featuregraph` (which today goes through codebase-index).
The codebase-index continues to function unchanged.

`tools/spec-spine/codebase-indexer/src/xref.rs:19` (`build_traceability`)
needs to consume the `primary: true` flag in implements items.
This change ships in Phase 1 alongside the parsing.

### Featuregraph golden file

`crates/featuregraph/tests/golden/features_graph.json` requires
regeneration after Phase 1 lands (new fields appear in the
graph). This is a routine sidecar-chore commit per the existing
`UPDATE_GOLDEN=1` workflow.

### Migration tooling

A one-shot migration tool (`tools/spec-migrate-147/`) may be
authored to assist Phase 2 and Phase 4 backfills. Optional; the
backfill is small enough to do by hand if preferred.

### CI parity

`tools/oap/ci-parity-check` rules need no change; the amendment does
not introduce new producer/consumer artifact dependencies.

## Risk register

| Risk | Mitigation |
|---|---|
| Phase 1 lands but Phase 2 backfill stalls; V-012 stuck at warning | Phase 1 is independently valuable; warning severity is fine indefinitely |
| Capability/registry/profile authoring proves the contract is wrong | Phase 3 specs are the contract proving ground; refine the contract before promoting validators |
| `primary:` flag uniqueness conflicts with existing implements claims | V-016 activates immediately at error; pre-Phase-1 dry run identifies conflicts |
| Spec 000 amendment record edit conflicts with concurrent amendments | Sequence the edit as the final commit in Phase 1; rebase on conflict |
| Featuregraph golden file regeneration introduces drift | Use `UPDATE_GOLDEN=1` per existing convention; diff review at PR time |

## Out of scope for this plan

- Authoring the actual capability/registry/profile specs absorbed
  from legacy-factory and acme-vue-node. That is downstream
  work enabled by this amendment, not the amendment itself.
- Implementing the codebase-indexer's primary-owner UI surface.
  Spec 130's UI implications are unchanged; this amendment only
  promotes the data model.
- Documentation generators for the new fields. Tooling work to
  render typed kind contracts is deferred.

## Timeline (estimate)

- Phase 1: ~3–5 days of focused work (compiler, schema, tests, spec 000 edit).
- Phase 2: ~1–2 days (28-spec backfill + V-012 promotion).
- Phase 3: ~1 week (three new specs + tooling additions).
- Phase 4: ~1 day (KNOWN_KEYS auto-promotion verification + W-rewire + V-018/V-019 error promotion).

Total: ~2–3 weeks elapsed, parallelizable across phases 2 and 3.
