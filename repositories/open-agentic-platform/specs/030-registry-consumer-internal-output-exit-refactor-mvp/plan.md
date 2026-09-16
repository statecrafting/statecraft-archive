# Implementation Plan: Internal output/exit refactor

**Spec**: [spec.md](./spec.md)

## Summary

Introduce small helper functions in `tools/spec-spine/registry-consumer/src/main.rs` to reduce duplicated error/exit and JSON-printing branches, then verify no observable behavior drift via the full contract suite.
