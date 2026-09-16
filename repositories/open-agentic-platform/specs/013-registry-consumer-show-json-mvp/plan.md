# Implementation Plan: Registry consumer show JSON contract

**Branch**: `013-registry-consumer-show-json-mvp` | **Date**: 2026-03-22 | **Spec**: [spec.md](./spec.md)

## Summary

Add optional `--json` to `show` for explicit automation contract; keep default `show` output byte-for-byte behavior identical to pre-013 (pretty-printed feature JSON).

## Technical context

- `Command::Show`: add `json: bool`
- Rendering: both paths use `serde_json::to_string_pretty(&rec)` today; keep that for default and for `--json`

## Constitution check

| Gate | Status |
|------|--------|
| Markdown-first specs | Pass |
| No new machine-truth schema | Pass |

## Implementation outline

1. Spec spine + tests-first
2. Extend `Show` with `--json`
3. README + verification
