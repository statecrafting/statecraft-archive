# Implementation Plan: Registry consumer list JSON output

**Branch**: `012-registry-consumer-list-json-mvp` | **Date**: 2026-03-22 | **Spec**: [spec.md](./spec.md)

## Summary

Add `list --json` that serializes the same filtered, sorted feature vector as pretty-printed JSON.

## Technical context

- `tools/spec-spine/registry-consumer/src/main.rs`: extend `Command::List` with `json: bool`
- Reuse `features_sorted()` and `filter_features()`
- Render: text → `print_list_table`, json → `serde_json::to_string_pretty`

## Constitution check

| Gate | Status |
|------|--------|
| Markdown-first specs | Pass |
| No new machine-truth schema | Pass |
| 001 remains structural gate | Pass |

## Implementation outline

1. Add spec spine and tests
2. Add `json` flag to `list` subcommand
3. Branch output after filter
4. Update README
5. Verify and record `execution/verification.md`

## Exit codes

Unchanged from Feature **002**.
