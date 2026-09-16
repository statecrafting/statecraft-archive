# Verification: Error contract tests

Date: 2026-03-22  
Feature: `020-registry-consumer-error-contract-mvp`

## Commands

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all
cargo build --release --manifest-path tools/registry-consumer/Cargo.toml
./tools/spec-compiler/target/release/spec-compiler compile
./tools/spec-lint/target/release/spec-lint
```

Focused error-contract subset:

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all error_contract_
```

## Results

- `cargo test --all` passed (67 tests), including five new stderr+exit contract tests for key failure paths.
- `cargo build --release` completed successfully.
- `spec-compiler compile` completed successfully.
- `spec-lint` completed successfully after adding this artifact.
- Failure-path diagnostics are fixture-locked for: missing file, invalid JSON parse, non-authoritative registry, show-not-found, and malformed registry shape for status-report.
