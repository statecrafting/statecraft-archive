# Implementation Plan: Registry consumer status-report JSON contract tests

**Branch**: `010-registry-consumer-status-report-json-contract-mvp` | **Date**: 2026-03-22 | **Spec**: [spec.md](./spec.md)

## Summary

Treat `status-report --json` as a stable automation contract by adding fixture-based tests for row shape/order/content and documenting the contract in README.

## Technical Context

- Language: Rust 2021 (`tools/spec-spine/registry-consumer`)
- Test target: `tools/spec-spine/registry-consumer/tests/cli.rs`
- No expected runtime changes to `src/main.rs`

## Constitution Check

| Gate | Status |
|------|--------|
| Markdown-first specs | Pass |
| No new machine-truth schema | Pass |
| 001 remains structural gate | Pass |

## Implementation outline

1. Add 010 spine artifacts
2. Add contract tests for default and `--nonzero-only` JSON modes
3. Update README to state stable JSON automation contract
4. Run verification commands and record results

## Exit codes

No change:

- `0`: success
- `1`: not-found / invalid-registry refusal
- `3`: I/O / parse / malformed input for command
