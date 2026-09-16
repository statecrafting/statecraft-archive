---
feature_id: "034-featuregraph-registry-scanner-fix"
---

# Changeset

## Scope

Registry-first feature manifest for the featuregraph scanner (`034`), plus governance command documentation.

## Files

| Path | Change |
|------|--------|
| `crates/featuregraph/src/registry_source.rs` | **New** — parse `build/spec-registry/registry.json` `features[]` |
| `crates/featuregraph/src/lib.rs` | Export `registry_source` |
| `crates/featuregraph/src/scanner.rs` | Prefer registry JSON, fallback yaml, explicit error if neither |
| `crates/featuregraph/src/preflight.rs` | Messages reference registry or yaml |
| `crates/featuregraph/tests/golden.rs` | Assert registry **or** yaml exists |
| `crates/featuregraph/tests/golden/features_graph.json` | Regenerated |
| `apps/desktop/src-tauri/src/commands/analysis.rs` | Doc comment on `featuregraph_overview` |

## Verification

See [verification.md](./verification.md).
