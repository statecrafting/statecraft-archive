# Implementation Plan: Registry consumer status-report nonzero filtering

**Branch**: `009-registry-consumer-status-report-nonzero-mvp` | **Date**: 2026-03-22 | **Spec**: [spec.md](./spec.md)

## Summary

Add a tiny UX enhancement for automation/readability by allowing `status-report` to omit zero-count status buckets via `--nonzero-only` in text and JSON modes.

## Technical Context

- Language: Rust 2021 (`tools/spec-spine/registry-consumer`)
- Reuse existing `status_report()` output from Features **007/008**
- Keep trust model and exit codes unchanged (Feature **002**)
- Extend integration tests in `tools/spec-spine/registry-consumer/tests/cli.rs`

## Constitution Check

| Gate | Status |
|------|--------|
| Markdown-first specs | Pass |
| No new machine-truth schema | Pass |
| 001 remains structural gate | Pass |

## Implementation outline

1. Add `--nonzero-only` flag to `status-report` CLI
2. Filter computed report rows by `count > 0` when enabled
3. Apply same filtered rows to text and JSON output
4. Add integration tests for text + JSON filtering and default stability
5. Update `tools/spec-spine/registry-consumer/README.md`

## Exit codes

No change from prior features:

- `0`: success
- `1`: not-found / invalid-registry refusal
- `3`: I/O / parse / malformed input for command
