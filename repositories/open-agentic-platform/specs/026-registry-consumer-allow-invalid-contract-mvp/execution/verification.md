# Verification: allow-invalid contract

Date: 2026-03-22  
Feature: `026-registry-consumer-allow-invalid-contract-mvp`

## Commands

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all
cargo build --release --manifest-path tools/registry-consumer/Cargo.toml
./tools/spec-compiler/target/release/spec-compiler compile
./tools/spec-lint/target/release/spec-lint
```

Focused allow-invalid subset:

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all allow_invalid_contract_
```

## Results

- `cargo test --all` passed (88 tests), including five new allow-invalid contract tests.
- `cargo build --release` completed successfully.
- `spec-compiler compile` completed successfully.
- `spec-lint` completed successfully after adding this artifact.
- Contracts now lock: baseline authority failure without `--allow-invalid`; exact success behavior with `--allow-invalid` for list/show/status-report; and boundary that malformed registries still fail even with the flag.
