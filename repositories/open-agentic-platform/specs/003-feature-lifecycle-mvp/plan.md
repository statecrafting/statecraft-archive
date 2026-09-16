# Implementation Plan: Feature lifecycle & status semantics

**Branch**: `003-feature-lifecycle-mvp` | **Date**: 2026-03-22 | **Spec**: [spec.md](./spec.md)

## Summary

Feature **003** is primarily a **normative specification** of **`status`** values and lifecycle conventions. **No** change to Feature **000** JSON Schemas or Feature **001** validation is required for MVP.

Optional follow-up: add a **one-line cross-link** from **`tools/spec-spine/registry-consumer/README.md`** to this spec so operators know what **`--status`** filters mean.

## Technical Context

**Deliverables**: `spec.md` (canonical), this `plan.md`, `tasks.md`.

**Code**: None required for MVP. **002** already supports **`--status`** with the Feature **000** enum.

## Constitution Check

| Gate | Status |
|------|--------|
| Markdown-only authoring | Pass |
| Compiler-owned JSON | Pass — no new hand-edited registry fields |
| Feature 000 precedence | Pass — uses existing enum |

## Project Structure

```text
specs/003-feature-lifecycle-mvp/
├── spec.md
├── plan.md
└── tasks.md
```

## Complexity Tracking

None for MVP. A future feature may add **`supersedes`**-style fields or compiler warnings for missing replacement pointers—that is **out of scope** for **003** MVP.
