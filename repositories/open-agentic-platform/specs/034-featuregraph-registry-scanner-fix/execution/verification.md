# Verification: featuregraph registry scanner fix

**Feature**: `034-featuregraph-registry-scanner-fix`

## Commands

| Check | Command | Result |
|-------|---------|--------|
| Spec compiler | `cargo build --release --manifest-path tools/spec-compiler/Cargo.toml && ./tools/spec-compiler/target/release/spec-compiler compile` | **pass** |
| Featuregraph unit + golden | `cargo test --manifest-path crates/featuregraph/Cargo.toml` | **pass** |
| Desktop | `pnpm -C apps/desktop check` | **pass** |

## Evidence

- **Registry-first**: `crates/featuregraph/src/scanner.rs` loads `build/spec-registry/registry.json` before `spec/features.yaml`; missing both manifests returns an explicit error.
- **Parser**: `crates/featuregraph/src/registry_source.rs` deserializes compiled registry `features[]` (`id`, `title`, `specPath`, `status`).
- **Governance command**: `featuregraph_overview` documented in `apps/desktop/src-tauri/src/commands/analysis.rs` to match Scanner resolution.
- **Golden**: `crates/featuregraph/tests/golden/features_graph.json` regenerated from repo scan using compiled registry.

## Manual smoke

1. From repo root with `build/spec-registry/registry.json` present: open OPC **Governance** → load overview — featuregraph half should not fail solely due to absent `spec/features.yaml`.
