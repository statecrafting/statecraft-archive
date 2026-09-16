# Tasks: Internal output/exit refactor

**Input**: `/specs/030-registry-consumer-internal-output-exit-refactor-mvp/`  
**Prerequisites**: Feature **029** governance gate.

**Feature status**: **Complete**

## Phase 1: Spec artifacts

- [x] T001 Add `spec.md`, `plan.md`, `tasks.md`
- [x] T002 Add `execution/changeset.md`

## Phase 2: Refactor

- [x] T003 Introduce helper(s) for prefixed error/exit emission
- [x] T004 Introduce helper(s) for JSON print-or-exit behavior
- [x] T005 Keep observable behavior unchanged (no fixture changes)

## Phase 3: Verification

- [x] T006 Run full registry-consumer contract gate path
- [x] T007 Add `execution/verification.md`
