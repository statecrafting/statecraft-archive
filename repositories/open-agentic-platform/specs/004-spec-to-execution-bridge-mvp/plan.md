# Implementation Plan: Spec-to-execution bridge

**Branch**: `004-spec-to-execution-bridge-mvp` | **Date**: 2026-03-22 | **Spec**: [spec.md](./spec.md)

## Summary

Feature **004** is a **protocol and documentation** feature: it defines **changeset** layout, **spec/plan/tasks** roles, **task lifecycle**, **approval** and **verification**, and **markdown output** conventions. **No** Rust crate is required for MVP; **no** **`registry.json`** schema change.

Optional follow-up (later features): a **linter** or **template** under **`standards/spec/templates/`** for **`execution/changeset.md`**; parsers for **`tasks.md`** task states.

## Technical Context

**Deliverables**: `spec.md`, `plan.md`, `tasks.md`; optional **`execution/`** subtree under this feature directory as an **example** only.

**Code**: None required for MVP conformance.

## Constitution Check

| Gate | Status |
|------|--------|
| Markdown-first execution records | Pass |
| No standalone YAML | Pass |
| Registry JSON unchanged | Pass — no execution payload in `registry.json` for MVP |

## Project Structure

```text
specs/004-spec-to-execution-bridge-mvp/
├── spec.md
├── plan.md
├── tasks.md
└── execution/           # optional example only (see tasks)
    └── changeset.md
```

## Task state convention (recommended for repo-wide use)

In **`tasks.md`**, encode task state with an explicit suffix on the task line, e.g.:

- `- [ ] T001 (pending) …`
- `- [x] T002 (complete) …`

Alternatively, group tasks under **`### Pending`**, **`### In progress`**, etc. Pick **one** convention per repository when this spec is adopted; document the choice in root **README** or **`standards/spec/contract.md`** in a follow-up edit.

## Complexity Tracking

| Item | Reason |
|------|--------|
| Example `execution/changeset.md` | Illustrates FRs without being normative for other features |
