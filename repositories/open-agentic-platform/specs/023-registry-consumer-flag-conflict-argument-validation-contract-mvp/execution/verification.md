# Verification: Flag-conflict and argument-validation contract

Date: 2026-03-22  
Feature: `023-registry-consumer-flag-conflict-argument-validation-contract-mvp`

## Commands

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all
cargo build --release --manifest-path tools/registry-consumer/Cargo.toml
./tools/spec-compiler/target/release/spec-compiler compile
./tools/spec-lint/target/release/spec-lint
```

Focused argument-contract subset:

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all arg_contract_
```

## Results

- `cargo test --all` passed (80 tests), including five new argument-layer contract tests.
- `cargo build --release` completed successfully.
- `spec-compiler compile` completed successfully.
- `spec-lint` completed successfully after adding this artifact.
- Contracts now lock exact stderr and exit-code behavior for: list/show/status-report `--json` + `--compact` conflicts, missing `show <FEATURE_ID>`, and invalid `status-report --status` value.
