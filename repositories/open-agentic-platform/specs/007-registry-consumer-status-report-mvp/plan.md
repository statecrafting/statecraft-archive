# Implementation Plan: Registry consumer status reporting UX

**Branch**: `007-registry-consumer-status-report-mvp` | **Date**: 2026-03-22 | **Spec**: [spec.md](./spec.md)

## Summary

Implement a small `registry-consumer` enhancement: add `status-report` for lifecycle/status visibility (counts by status, optional ids) without changing schema/compiler contracts.

## Technical Context

- Language: Rust 2021 (`tools/spec-spine/registry-consumer`)
- Reuse existing JSON `Value` access pattern from Feature **002**
- Keep trust model + exit behavior unchanged
- Add integration tests in `tools/spec-spine/registry-consumer/tests/cli.rs`

## Constitution Check

| Gate | Status |
|------|--------|
| Markdown-first specs | Pass |
| No new machine-truth schema | Pass |
| 001 remains structural gate | Pass |

## Implementation outline

1. Add `status-report` subcommand in `src/main.rs`
2. Add helper(s) in `src/lib.rs` to compute counts and sorted ids by status
3. Print deterministic report lines
4. Extend integration tests
5. Update `tools/spec-spine/registry-consumer/README.md`

## Exit codes

No change from Feature **002**:

- `0`: success
- `1`: not-found / invalid-registry refusal
- `3`: I/O / parse / malformed input for command
