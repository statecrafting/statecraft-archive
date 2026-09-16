# Verification: List/show JSON contract tests

Date: 2026-03-22  
Feature: `018-registry-consumer-list-show-json-contract-mvp`

## Commands

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all
cargo build --release --manifest-path tools/registry-consumer/Cargo.toml
./tools/spec-compiler/target/release/spec-compiler compile
./tools/spec-lint/target/release/spec-lint
```

Focused contract tests (optional; subset of the integration suite):

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all list_json_contract_has_stable_array_shape_and_order
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all list_compact_contract_matches_expected_serialization
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all show_json_contract_has_stable_object_shape
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all show_compact_contract_matches_expected_serialization
```

## Results

- `cargo test --all` passed (52 tests), including the four new fixture-style list/show JSON and compact contract tests.
- `cargo build --release` completed successfully.
- `spec-compiler compile` completed successfully.
- `spec-lint` completed successfully after adding this artifact.
- Parsed JSON shape and key order for `list --json` and `show --json` match committed fixtures.
- `list --compact` and `show --compact` match exact `serde_json::to_string` lines for the same expected values.
