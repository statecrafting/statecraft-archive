# Implementation Plan: status-report compact JSON

**Spec**: [spec.md](./spec.md)

## Summary

Add `compact: bool` to `StatusReport` with `conflicts_with` vs `json`. After building row `Vec<Value>`, use `to_string` if compact else `to_string_pretty` if json.
