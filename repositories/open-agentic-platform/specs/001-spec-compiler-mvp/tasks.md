# Tasks: Spec compiler MVP

**Input**: `/specs/001-spec-compiler-mvp/` (spec, plan, research)  
**Prerequisites**: Feature **000** schemas at `standards/schemas/spec-spine/`

**Feature status**: **Complete** — treat `tools/spec-spine/spec-compiler` and CI `spec-conformance` as the required gate for downstream features unless Feature 000/001 is amended.

## Phase 1: Crate skeleton

- [x] T001 Create `tools/spec-spine/spec-compiler/` with `Cargo.toml`, `src/main.rs`, `src/lib.rs`, workspace-friendly README linking Feature 001 spec
- [x] T002 Add `clap` subcommand `compile`; write `registry.json` + `build-meta.json`
- [x] T003 [P] `rust-version` in `Cargo.toml` (no `rust-toolchain.toml` yet)

## Phase 2: Read & parse

- [x] T004 Implement `specs/*/spec.md` discovery (sorted directory walk)
- [x] T005 Parse YAML frontmatter + markdown; extract H1/H2 headings per [data-model.md](./data-model.md) / [README.md](../../../tools/spec-spine/spec-compiler/README.md)
- [x] T006 Map frontmatter → `FeatureRecord` + `extraFrontmatter` (normalized keys + schema-allowed extras)

## Phase 3: Validation

- [x] T007 **V-001** / **V-002** / **V-003** implementation
- [x] T008 **V-004** repo walk excluding standard vendor dirs per [research.md](./research.md) R6 (+ `.idea`)
- [x] T009 Wire `validation` object and non-zero exit on failure per [research.md](./research.md) R4

## Phase 4: Emit & hash

- [x] T010 Deterministic JSON (`sort_json_value` recursive) for `registry.json`
- [x] T011 `contentHash` per Feature 000 research D2 (spec `spec.md` inputs only per FR-007)
- [x] T012 Emit `build-meta.json` with UTC `builtAt`

## Phase 5: Tests & docs

- [x] T013 [P] Golden integration test: two runs, identical `registry.json` bytes on this repo
- [x] T014 [P] Schema conformance: integration tests (`tests/schema_conformance.rs`) validate emitted JSON against Feature 000 schemas via `jsonschema` (default-features = false); GitHub Actions workflow `.github/workflows/spec-conformance.yml` runs `cargo test` + smoke `compile`
- [x] T015 Root [README.md](../../README.md) with `cargo build --manifest-path` + `compile` run

## Dependencies

- T004–T006 before T010–T012
- T007–T009 can interleave with emit once `ParsedSpec` exists
- T013 depends on T010–T012
