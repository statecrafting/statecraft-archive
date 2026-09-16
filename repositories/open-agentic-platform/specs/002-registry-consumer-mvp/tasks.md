# Tasks: Registry consumer MVP

**Input**: `/specs/002-registry-consumer-mvp/` (spec, plan)  
**Prerequisites**: Feature **000** schemas; Feature **001** `spec-compiler` emitting **`.derived/spec-registry/registry.json`**

**Feature status**: **Implemented** — `tools/spec-spine/registry-consumer/` (see crate README).

## Phase 1: Skeleton

- [x] T001 Create `tools/spec-spine/registry-consumer/` with `Cargo.toml`, `src/main.rs`, CLI stub (`clap`), README linking Feature 002 spec
- [x] T002 Document default path `.derived/spec-registry/registry.json` and `--registry-path` in README

## Phase 2: Read & parse

- [x] T003 Load `registry.json` from disk; parse JSON and access the expected top-level keys (`specVersion`, `build`, `features`, `validation`) and each **`features[]`** entry as emitted by Feature **001** (implementation uses `serde_json::Value`—no typed mirror of Feature **000** structs; no schema re-validation in the consumer)
- [x] T004 **Safe-by-default**: if `validation.passed` is false, error unless `--allow-invalid` (exact messaging in spec/plan)

## Phase 3: Queries

- [x] T005 Implement `list` with stable sort order (lexicographic by `id`)
- [x] T006 Implement filters: `--status`, `--id-prefix` (**prefix on `id` only**—no substring)
- [x] T007 Implement `show <feature-id>`: full **featureRecord** JSON on stdout; exit **1** if not found

## Phase 4: Tests & docs

- [x] T008 [P] Integration tests: exit codes **0** / **1** / **3**; `validation.passed: false` refusal; parse/I/O failures; **`show`** JSON matches **featureRecord** shape
- [x] T009 README + root or workspace docs: run **001** `compile`, then **002** `list` / `show`

## Dependencies

- T003 before T005–T007
- T004 before declaring feature complete
