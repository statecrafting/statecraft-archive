# Tasks: Conformance lint

**Input**: `/specs/006-conformance-lint-mvp/`  
**Prerequisites**: Features **001** (tree layout), **003–005** (rules to approximate)

**Feature status**: **Implemented** — `tools/spec-spine/spec-lint/` + spec/plan.

## Phase 1: Spec

- [x] T001 `spec.md` / `plan.md` / `tasks.md` for **006**

## Phase 2: Tool

- [x] T002 Create **`tools/spec-spine/spec-lint/`** with **`spec-lint`** binary, **`README.md`** (heuristics + exit codes)
- [x] T003 Implement **W-002** / **W-003** ( **`spec.md`** frontmatter **`status`** + body heuristics)
- [x] T004 Implement **W-001** / **W-004** / **W-005** ( **`tasks.md`** + **`execution/`** paths)
- [x] T005 **`--fail-on-warn`**, default exit **0** with warnings on stderr
- [x] T006 Integration tests with minimal fixtures

## Phase 3: Repo & CI

- [x] T007 Root [README.md](../../README.md) link to **006**; [`.gitignore`](../../.gitignore) exception for **`tools/spec-spine/spec-lint/Cargo.lock`**
- [x] T008 [`.github/workflows/spec-conformance.yml`](../../.github/workflows/spec-conformance.yml): run **`spec-lint`** (non-blocking)

## Phase 4: Verify

- [x] T009 **`spec-compiler compile`** includes **006** in **`registry.json`**
