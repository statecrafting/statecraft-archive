# Tasks: Feature lifecycle & status semantics

**Input**: `/specs/003-feature-lifecycle-mvp/`  
**Prerequisites**: Feature **000** (`status` enum); Feature **001** (frontmatter → registry); Feature **002** (`--status` filter)

**Feature status**: **Complete** (MVP: normative spec + README cross-links; no schema/compiler change).

## Phase 1: Authoring

- [x] T001 Add `specs/003-feature-lifecycle-mvp/spec.md` with definitions, transitions, FRs, success criteria
- [x] T002 Add `plan.md` and `tasks.md` (this file)

## Phase 2: Cross-references (optional, low churn)

- [x] T003 Link **`tools/spec-spine/registry-consumer/README.md`** “Usage” / **`--status`** section to [spec.md](./spec.md) (one or two sentences)
- [x] T004 Optional: one line in root [README.md](../../README.md) under the registry-consumer block pointing to lifecycle semantics for **`status`**

## Phase 3: Verify

- [x] T005 Run **`spec-compiler compile`**; confirm **`003-feature-lifecycle-mvp`** appears in **`registry.json`** with expected **`status`**

## Dependencies

- T001 before T005
- T003–T004 optional and independent
