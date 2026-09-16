# Implementation Plan: featuregraph registry scanner fix

**Spec**: [spec.md](./spec.md)  
**Feature**: `034-featuregraph-registry-scanner-fix`

## Summary

Introduce a registry-backed ingestion path in **`crates/featuregraph`** (scanner + helpers), then verify **`commands::analysis::featuregraph_overview`** and **`GovernanceSurface`** consume it without requiring `spec/features.yaml` when the compiled registry exists.

## Sequencing

| Phase | Focus |
|-------|--------|
| **1** | Map `registry.json` schema to internal feature list / graph inputs |
| **2** | Switch scanner default resolution order: registry first, yaml fallback if needed |
| **3** | Desktop verification + governance manual smoke |
| **4** | Execution docs + `status: active` when tasks complete |

## Risks

- Schema drift between `registry.json` and legacy yaml — mitigate with explicit adapter tests.
- Large repos: keep registry reads bounded (reuse existing JSON parsing patterns).

## References

- `crates/featuregraph/src/scanner.rs`
- `.derived/spec-registry/registry.json` (output of `tools/spec-spine/spec-compiler`)
- `product/apps/opc/src-tauri/src/commands/analysis.rs`
