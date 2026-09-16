---
description: "Task list for spec 133 — amends-aware coupling gate"
---

# Tasks: Amends-Aware Spec/Code Coupling Gate

**Input**: `specs/133-amends-aware-coupling-gate/spec.md` + `plan.md`
**Prerequisites**: `plan.md` (required), `spec.md` (required for FR/AC mapping)

**Tests**: included — the gate is a CI-critical tool; new resolver paths
ship with integration test coverage matching AC-1 through AC-6.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Maps to user story / FR cluster
- File paths in descriptions are exact

## Path Conventions

- Indexer: `tools/spec-spine/codebase-indexer/`
- Gate: `tools/spec-spine/spec-code-coupling-check/`
- Schemas: `schemas/`

---

## Phase 1: Setup

- [ ] T001 Confirm spec 133 frontmatter compiles cleanly: run
  `./tools/spec-spine/spec-compiler/target/release/spec-compiler compile` and
  verify exit 0 + spec 133 appears in `.derived/spec-registry/registry.json`.

---

## Phase 2: Investigation (Foundational — blocks all later phases)

**Purpose**: Phase 0 of the plan. Decide Shape A (gate-only) vs
Shape B (indexer + gate). All subsequent tasks depend on this outcome.

- [ ] T002 [Foundational] Inspect `.derived/codebase-index/index.json` for
  `amends` and `amendmentRecord` fields under any spec mapping. Use:
  ```bash
  ./tools/spec-spine/codebase-indexer/target/release/codebase-indexer compile
  python3 -c 'import json,sys; \
    d=json.load(open(".derived/codebase-index/index.json")); \
    m=[x for x in d["traceability"]["mappings"] if x["specId"].startswith("132")]; \
    print(json.dumps(m,indent=2))' \
    || true   # ad-hoc inspection only; not an orchestrated workflow read
  ```
  Document outcome in a comment on T003. **Note:** this `python` use is
  one-shot debugging per the governed-reads exception, not a
  workflow step.
- [ ] T003 [Foundational] Decide implementation shape (A or B) based on
  T002. Record decision in this tasks.md as a comment line.

## Decision (T003): Shape B — index.json does NOT carry `amends:` or
## `amendmentRecord:` today. The codebase-indexer's `TraceMapping`
## struct (`tools/spec-spine/codebase-indexer/src/types.rs`) only surfaces
## `specId`, `specStatus`, `dependsOn`, and `implementingPaths`; the
## scanner reads no amend frontmatter. Phase 3 therefore includes the
## indexer extension (T020-T024) plus the gate change (T030-T032),
## landing as one cohesive PR per the plan's Shape B branch.

**Checkpoint**: shape decided. Phase 3 (Shape A path) or Phase 3+4
(Shape B path) proceed.

---

## Phase 3: User Story 1 — Amender's edit clears the gate (Priority: P1) 🎯 MVP

**Goal**: When a contributor lands a spec amendment via spec 119's
protocol, the gate accepts the amender's `spec.md` edit as covering the
amended spec's `spec.md` path. No waiver required.

**Independent Test**: AC-1 / AC-6 fixtures in `tests/cli.rs` exit 0.

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation.**

- [ ] T010 [P] [US1] Add test `amends_link_clears_amended_spec_path` in
  `tools/spec-spine/spec-code-coupling-check/tests/cli.rs`: build synthetic index
  with mapping `{specId: "B", amends: ["A"]}` plus path `specs/A/spec.md`
  + `specs/B/spec.md` in diff, assert exit 0. Maps to spec AC-1.
- [ ] T011 [P] [US1] Add test `amendment_record_clears_amended_spec_path`
  in same file: synthetic mapping where spec A carries
  `amendmentRecord: "D"`, paths `specs/A/spec.md` + `specs/D/spec.md`,
  assert exit 0. Maps to AC-3.
- [ ] T012 [P] [US1] Add regression test
  `non_spec_path_unaffected_by_amends_extension`: a diff with no
  `specs/*/spec.md` paths exits 0 identically to today. Maps to AC-4.

### Implementation for User Story 1

#### Shape A or B branch (depending on T003)

**If Shape B (indexer change required):**

- [ ] T020 [US1] Add `amends: Vec<String>` and
  `amendment_record: Option<String>` (or `Vec<String>` if multi-record
  evidence found) to `TraceMapping` in
  `tools/spec-spine/codebase-indexer/src/types.rs`. Mark `#[serde(default)]` for
  backwards-compat with old indexes.
- [ ] T021 [US1] Extend `tools/spec-spine/codebase-indexer/src/spec_scanner.rs` to
  populate the new fields from spec frontmatter.
- [ ] T022 [US1] Update `standards/schemas/spec-spine/codebase-index.schema.json` to declare
  `amends` (array of strings) and `amendmentRecord` (string or array)
  under `traceability.mappings.items.properties`.
- [ ] T023 [US1] Bump indexer `SCHEMA_VERSION` compile-time const (e.g.
  `1.2.0` → `1.3.0`). Add a one-line CHANGELOG comment in `types.rs`
  or wherever the const lives.
- [ ] T024 [US1] Re-run `codebase-indexer compile` and commit the
  refreshed `.derived/codebase-index/index.json`.

**Always (Shape A and B):**

- [ ] T030 [US1] In `tools/spec-spine/spec-code-coupling-check/src/lib.rs`,
  extend `legitimate_owners()` (or equivalent named function) to merge
  three sources: `implements:` claimants (existing), `amends:` (per
  spec 133 FR-001), `amendment_record:` (per FR-002). Return tagged
  source per FR-004.
- [ ] T031 [US1] Update the typed `Index` loader (same crate) to
  surface the new fields from `index.json`. If T024 already wrote
  the data, this is a deserialisation extension; otherwise add fall-
  back to empty per FR-005.
- [ ] T032 [US1] Confirm tests T010 / T011 / T012 now pass:
  `cargo test --manifest-path tools/spec-spine/spec-code-coupling-check/Cargo.toml`.

**Checkpoint**: User Story 1 complete. The 2026-05-02 false-positive
class no longer fires.

---

## Phase 4: User Story 2 — Reviewer sees source-labelled owners (Priority: P2)

**Goal**: When the gate reports a violation, each candidate owner is
labelled by source so reviewers can audit which class of coupling
applies and whether the right owner was edited.

**Independent Test**: AC-2 fixture exits 1 with rendered output
showing `implements:` / `amends:` / `amendment_record:` columns.

### Tests for User Story 2

- [ ] T040 [P] [US2] Add test
  `violation_renderer_labels_owner_sources` in `tests/cli.rs`:
  synthetic index where path is claimed by one `implements:` spec and
  `amends:`-linked from another; only one is in the diff (insufficient
  to clear); assert stderr contains both source labels. Maps to AC-2.

### Implementation for User Story 2

- [ ] T041 [US2] Update the renderer in
  `tools/spec-spine/spec-code-coupling-check/src/lib.rs` (or `render.rs` if
  separate) to print per-class subsections under each violated path,
  per spec §"FR-004". Format example in spec body §4.
- [ ] T042 [US2] Confirm T040 passes.

**Checkpoint**: User Story 2 complete. Reviewers have visibility into
all three coupling classes.

---

## Phase 5: User Story 3 — Codebase-index renders amend links (Priority: P3, Shape B only)

**Goal**: `CODEBASE-INDEX.md` shows amend relationships in the
traceability layer, making the protocol surface visible to humans
without reading JSON.

**Independent Test**: regenerated `CODEBASE-INDEX.md` shows `amends:`
column or row entries for spec 132 (which amends 000), spec 119 (which
amends 000/087/092/094/099 historically).

### Implementation

- [ ] T050 [US3] Update the markdown renderer in
  `tools/spec-spine/codebase-indexer/src/render.rs` (or wherever rendering lives)
  to surface `amends:` / `amendment_record:` non-empty values. Maps to AC-5.
- [ ] T051 [US3] Run `codebase-indexer render` and visually verify
  the output. Commit the regenerated markdown.

**Skip this phase entirely if Shape A was selected** — there are no
indexer changes to render.

---

## Phase 6: Cross-references and spec hygiene

- [ ] T060 [P] In `specs/127-spec-code-coupling-gate/spec.md`, append
  a defect-log entry referencing spec 133.
- [ ] T061 [P] In `specs/130-spec-coupling-primary-owner/spec.md`,
  append an amendment-record-style entry naming spec 133 as the
  amends-aware extension. Use `amends: ["130"]` if appropriate
  (run V-011 mental check first per spec 132).
- [ ] T062 [P] Re-run the spec-compiler to refresh `registry.json`
  with the cross-reference edits.

---

## Phase 7: Verification (Polish)

- [ ] T070 Run `./tools/spec-spine/spec-compiler/target/release/spec-compiler compile`
  → exit 0.
- [ ] T071 Run `./tools/spec-spine/spec-lint/target/release/spec-lint --fail-on-warn`
  → exit 0.
- [ ] T072 Run `./tools/spec-spine/codebase-indexer/target/release/codebase-indexer check`
  → exit 0.
- [ ] T073 Run `GITHUB_PR_BODY="<commit body draft>" make ci-spec-code-coupling`
  → exit 0.
- [ ] T074 Run `make ci` (full local CI parity) → exit 0.
- [ ] T075 Update spec 133 frontmatter: `status: approved`,
  `implementation: complete`, set `approved:` and `closed:` to today.
- [ ] T076 Final compile + commit. Suggested commit:
  `feat(spec-133): amends-aware spec/code coupling gate`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: prerequisite for all.
- **Phase 2 (Investigation)**: blocks Phase 3+. Outcome decides Shape.
- **Phase 3 (US1)**: MVP — closes the FR-001/FR-002 case.
- **Phase 4 (US2)**: depends on Phase 3 (renderer needs the resolved
  owner set with source tags).
- **Phase 5 (US3)**: only relevant in Shape B; can run parallel with
  Phase 4 once Phase 3 lands.
- **Phase 6 (Cross-refs)**: parallel to Phase 4/5; only needs Phase 3
  to be land-ready.
- **Phase 7 (Verification)**: terminal — depends on all earlier phases.

### Within Each User Story

- Tests first, fail before implementing (T010-T012 before T020-T032).
- Indexer change before gate change if Shape B (T020-T024 before
  T030-T032).
- Cross-references after the implementation lands (T060-T062 after
  T032 / T042 / T051).

### Parallel Opportunities

- T010, T011, T012 (test scaffolds) — different test functions in
  the same file; sequential write but logically independent.
- T020 + T021 + T022 are different files — parallelisable.
- T040 (US2 test) and T060 / T061 / T062 (cross-references) are
  fully parallelisable once Phase 3 completes.

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 (T001).
2. Phase 2 (T002, T003) — decide shape.
3. Phase 3 (tests + impl + verification).
4. **STOP and VALIDATE**: AC-1, AC-3, AC-4, AC-6 fixtures all green.
5. Optional stop point — the MVP is a real improvement; US2 and US3
   add polish.

### Incremental Delivery

1. Phase 1 + 2 → ready to choose path.
2. Phase 3 → MVP gate-side fix lands → run on a real branch with a
   spec-000-amend pattern to confirm the false-positive class is closed.
3. Phase 4 → renderer improvements land → reviewers benefit.
4. Phase 5 (Shape B only) → markdown rendering lands.
5. Phase 6 + 7 → cross-references and verification finalise the spec.

---

## Notes

- The gate's own behaviour is governed by spec 127. Changes to the
  resolver in this spec must be cross-referenced back per Phase 6
  (T060) so spec 127 readers find this extension.
- This spec amends spec 130 implicitly (the primary-owner heuristic
  now composes with two additional sources). T061 records the
  amendment formally.
- Stop at any phase boundary if the investigation outcome (T002)
  changes the implementation shape or surfaces a deeper problem
  with the amend protocol's data flow. Halt and surface rather
  than improvising.
