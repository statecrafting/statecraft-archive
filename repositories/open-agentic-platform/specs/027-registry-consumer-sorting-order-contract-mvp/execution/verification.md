# Verification: Sorting-order contract

Date: 2026-03-22  
Feature: `027-registry-consumer-sorting-order-contract-mvp`

## Commands

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all
cargo build --release --manifest-path tools/registry-consumer/Cargo.toml
./tools/spec-compiler/target/release/spec-compiler compile
./tools/spec-lint/target/release/spec-lint
```

Focused sorting-contract subset:

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all sorting_contract_
```

## Results

- `cargo test --all` passed (91 tests), including three new sorting-order contract tests.
- `cargo build --release` completed successfully.
- `spec-compiler compile` completed successfully.
- `spec-lint` completed successfully after adding this artifact.
- Contracts now explicitly lock list ordering by feature id, status-report row order by status sequence, and sorted ids within rows, including an `--allow-invalid` scenario.
