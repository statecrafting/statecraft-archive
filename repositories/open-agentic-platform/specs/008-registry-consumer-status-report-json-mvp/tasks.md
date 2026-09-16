# Tasks: Registry consumer status-report JSON output

**Input**: `/specs/008-registry-consumer-status-report-json-mvp/`  
**Prerequisites**: Feature **007** complete; Features **000-006** unchanged

**Feature status**: **Complete** — JSON mode, tests, docs, and verification artifact landed.

## Phase 1: Spec artifacts

- [x] T001 Add `spec.md`, `plan.md`, `tasks.md`
- [x] T002 Add `execution/changeset.md`

## Phase 2: Implementation

- [x] T003 Add `--json` to `status-report` CLI
- [x] T004 Emit deterministic JSON rows (`status`, `count`, `ids`)
- [x] T005 Update `tools/spec-spine/registry-consumer/README.md`

## Phase 3: Tests & verify

- [x] T006 Add integration tests for `status-report --json`
- [x] T007 Run compile/tests/lint and write `execution/verification.md`
