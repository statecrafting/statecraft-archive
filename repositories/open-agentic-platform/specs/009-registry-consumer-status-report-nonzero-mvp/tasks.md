# Tasks: Registry consumer status-report nonzero filtering

**Input**: `/specs/009-registry-consumer-status-report-nonzero-mvp/`  
**Prerequisites**: Features **007** and **008**

**Feature status**: **Complete** — nonzero-only filter, tests, docs, and verification artifact landed.

## Phase 1: Spec artifacts

- [x] T001 Add `spec.md`, `plan.md`, `tasks.md`
- [x] T002 Add `execution/changeset.md`

## Phase 2: Implementation

- [x] T003 Add `--nonzero-only` to `status-report` CLI
- [x] T004 Apply nonzero filtering to text and JSON output paths
- [x] T005 Update `tools/spec-spine/registry-consumer/README.md`

## Phase 3: Tests & verify

- [x] T006 Add integration tests for `--nonzero-only` in text and JSON modes
- [x] T007 Run verify commands and write `execution/verification.md`
