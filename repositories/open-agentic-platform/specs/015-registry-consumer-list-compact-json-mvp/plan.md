# Implementation Plan: Registry consumer list compact JSON

**Branch**: `015-registry-consumer-list-compact-json-mvp` | **Date**: 2026-03-22 | **Spec**: [spec.md](./spec.md)

## Summary

Extend `Command::List` with `compact: bool`, `conflicts_with` vs `json`; serialize with `to_string` when compact, else existing branches.
