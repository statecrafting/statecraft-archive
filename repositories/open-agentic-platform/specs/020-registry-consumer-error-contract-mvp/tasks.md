# Tasks: Error contract tests

**Input**: `/specs/020-registry-consumer-error-contract-mvp/`  
**Prerequisites**: Features **002**, **010**, **018**, **019**.

**Feature status**: **Complete**

## Phase 1: Spec artifacts

- [x] T001 Add `spec.md`, `plan.md`, `tasks.md`
- [x] T002 Add `execution/changeset.md`

## Phase 2: Fixtures and tests

- [x] T003 Add `tests/fixtures/error_contract/` registries and expected stderr files
- [x] T004 Add failure-path stderr+exit contract tests in `tests/cli.rs`
- [x] T005 Add minimal README note describing error-contract coverage

## Phase 3: Verification

- [x] T006 Run verification command path
- [x] T007 Add `execution/verification.md`
