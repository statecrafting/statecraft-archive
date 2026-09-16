# Implementation Plan: Registry consumer status-report status filter

**Branch**: `011-registry-consumer-status-report-status-filter-mvp` | **Date**: 2026-03-22 | **Spec**: [spec.md](./spec.md)

## Summary

Add `--status <value>` filtering to `status-report` for focused text/JSON output while preserving all existing defaults and contracts.

## Technical Context

- Language: Rust 2021 (`tools/spec-spine/registry-consumer`)
- Minimal CLI/output change in `src/main.rs`
- Reuse `status_report()` data and known lifecycle statuses from library constants
- Extend integration tests in `tools/spec-spine/registry-consumer/tests/cli.rs`

## Constitution Check

| Gate | Status |
|------|--------|
| Markdown-first specs | Pass |
| No new machine-truth schema | Pass |
| 001 remains structural gate | Pass |

## Implementation outline

1. Add `--status` argument to `status-report`
2. Validate value against known statuses and filter report rows
3. Apply filtered rows to text and JSON output paths
4. Add integration tests for text/JSON + invalid status
5. Update README and verification artifacts
