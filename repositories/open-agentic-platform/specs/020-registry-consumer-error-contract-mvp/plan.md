# Implementation Plan: Error contract tests

**Spec**: [spec.md](./spec.md)

## Summary

Add `tests/fixtures/error_contract/` registries and expected `stderr` transcripts, then extend `tests/cli.rs` with failure-path contract tests that assert exact diagnostics + exit codes for key command families.
