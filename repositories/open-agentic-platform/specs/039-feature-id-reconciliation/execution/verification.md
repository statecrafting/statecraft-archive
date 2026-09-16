# Verification: Feature 039 (codeAliases)

Date: 2026-03-29

## SC-001 — registry emits `codeAliases`

Confirmed: `spec-compiler compile` output includes `codeAliases` arrays for features that declare `code_aliases` in frontmatter (e.g. `034-featuregraph-registry-scanner-fix`).

## SC-002 — omit when absent

Confirmed: features without `code_aliases` have no `codeAliases` key in compiled JSON.

## SC-003 — V-005

Covered by `tools/spec-compiler/tests/code_aliases.rs` (`v005_duplicate_alias_across_features`).

## SC-004 — scanner resolves `FEATUREGRAPH_REGISTRY`

Confirmed: `featuregraph` scan attributes `// Feature: FEATUREGRAPH_REGISTRY` files to `034-featuregraph-registry-scanner-fix` when using `build/spec-registry/registry.json` produced after frontmatter population. Unit coverage: `scanner::tests::registry_code_aliases_populate_feature_entry`, `registry_source::tests::parses_code_aliases_from_registry`. Golden `crates/featuregraph/tests/golden/features_graph.json` updated accordingly.

## SC-005 — schema conformance

`cargo test -p open_agentic_spec_compiler` — `schema_conformance` tests pass.

## SC-006 — `specVersion` 1.1.0

Confirmed in compiled output and `repo_spec_version_is_1_1_0` test.

## Commands run

```text
cd tools/spec-compiler && cargo test
cd tools/spec-compiler && cargo run --bin spec-compiler -- compile --repo <repo-root>
cd crates/featuregraph && cargo test
```

Note: `build/spec-registry/registry.json` is gitignored; regenerate with `spec-compiler compile` after spec changes.
