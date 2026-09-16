# Verification: Default-path contract

Date: 2026-03-22  
Feature: `025-registry-consumer-default-path-contract-mvp`

## Commands

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all
cargo build --release --manifest-path tools/registry-consumer/Cargo.toml
./tools/spec-compiler/target/release/spec-compiler compile
./tools/spec-lint/target/release/spec-lint
```

Focused default-path subset:

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all default_path_contract_
```

## Results

- `cargo test --all` passed (83 tests), including two new default-path contract tests.
- `cargo build --release` completed successfully.
- `spec-compiler compile` completed successfully.
- `spec-lint` completed successfully after adding this artifact.
- Omitting `--registry-path` is now contract-locked for both success (`build/spec-registry/registry.json` exists) and missing-path failure semantics (exact stderr + exit code).
