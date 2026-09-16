# Tasks: Registry consumer status-report status filter

**Input**: `/specs/011-registry-consumer-status-report-status-filter-mvp/`  
**Prerequisites**: Features **008**, **009**, **010**

**Feature status**: **Complete** — status-filtered report behavior, tests, docs, and verification artifact landed.

## Phase 1: Spec artifacts

- [x] T001 Add `spec.md`, `plan.md`, `tasks.md`
- [x] T002 Add `execution/changeset.md`

## Phase 2: Tests-first + implementation

- [x] T003 Add integration tests for `--status` in text mode
- [x] T004 Add integration tests for `--status` in JSON mode
- [x] T005 Add integration test for unknown status value
- [x] T006 Implement minimal `status-report --status` behavior
- [x] T007 Update README usage and feature list

## Phase 3: Verify

- [x] T008 Run verification command path
- [x] T009 Add `execution/verification.md`
