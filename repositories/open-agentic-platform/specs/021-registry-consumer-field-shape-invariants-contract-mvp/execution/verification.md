# Verification: Field-shape invariants contract

Date: 2026-03-22  
Feature: `021-registry-consumer-field-shape-invariants-contract-mvp`

## Commands

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all
cargo build --release --manifest-path tools/registry-consumer/Cargo.toml
./tools/spec-compiler/target/release/spec-compiler compile
./tools/spec-lint/target/release/spec-lint
```

Focused shape-contract subset:

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all shape_contract_
```

## Results

- `cargo test --all` passed (71 tests), including four new field-shape invariant tests.
- `cargo build --release` completed successfully.
- `spec-compiler compile` completed successfully.
- `spec-lint` completed successfully after adding this artifact.
- Contracts now lock exact object key sets, key order, and optional-field omission behavior for list/show/status-report JSON outputs.
