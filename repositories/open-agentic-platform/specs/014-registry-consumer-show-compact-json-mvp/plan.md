# Implementation Plan: Registry consumer show compact JSON

**Branch**: `014-registry-consumer-show-compact-json-mvp` | **Date**: 2026-03-22 | **Spec**: [spec.md](./spec.md)

## Summary

Add `compact: bool` to `Show` with `conflicts_with` on `json`; serialize with `to_string` when compact, else `to_string_pretty`.

## Implementation outline

1. Spec spine + tests-first
2. Extend `Show` and branch serialization
3. README + verification
