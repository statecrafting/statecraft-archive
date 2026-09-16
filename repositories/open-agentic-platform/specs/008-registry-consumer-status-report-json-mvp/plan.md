# Implementation Plan: Registry consumer status-report JSON output

**Branch**: `008-registry-consumer-status-report-json-mvp` | **Date**: 2026-03-22 | **Spec**: [spec.md](./spec.md)

## Summary

Add a minimal JSON output mode for `registry-consumer status-report` so CI/scripts can consume lifecycle counts and ids without text parsing.

## Technical Context

- Language: Rust 2021 (`tools/spec-spine/registry-consumer`)
- Reuse existing `status_report()` helper from Feature **007**
- Keep validation/trust model from Feature **002**
- Extend integration tests in `tools/spec-spine/registry-consumer/tests/cli.rs`

## Constitution Check

| Gate | Status |
|------|--------|
| Markdown-first specs | Pass |
| No new machine-truth schema | Pass |
| 001 remains structural gate | Pass |

## Implementation outline

1. Extend `status-report` CLI args with `--json`
2. Serialize report rows into deterministic JSON
3. Keep existing human-readable output path unchanged
4. Add integration tests for JSON structure/order/content
5. Update `tools/spec-spine/registry-consumer/README.md`

## Exit codes

No change from Features **002** and **007**:

- `0`: success
- `1`: not-found / invalid-registry refusal
- `3`: I/O / parse / malformed input for command
