# Tasks: Spec-to-execution bridge

**Input**: `/specs/004-spec-to-execution-bridge-mvp/`  
**Prerequisites**: Features **000–003**

**Feature status**: **Complete** (MVP protocol + example changeset; optional **`standards/spec/contract.md`** expansion deferred until task-state convention is chosen).

## Phase 1: Authoring

- [x] T001 Add `spec.md` (execution unit, spec/plan/tasks, task lifecycle, approval, verification, outputs, non-goals)
- [x] T002 Add `plan.md` and `tasks.md`

## Phase 2: Example *(optional)*

- [x] T003 Add `execution/changeset.md` under **this** feature directory as a **non-normative** template/example (references **004** task ids)

## Phase 3: Cross-links

- [x] T004 Link from root [README.md](../../README.md) to Feature **004** for discoverability; [`standards/spec/contract.md`](../../standards/spec/contract.md) may be updated later when task-state notation is repo-wide

## Phase 4: Verify

- [x] T005 Run **`spec-compiler compile`**; confirm **`004-spec-to-execution-bridge-mvp`** in **`registry.json`**

## Dependencies

- T001–T002 before T005
- T003–T004 optional
