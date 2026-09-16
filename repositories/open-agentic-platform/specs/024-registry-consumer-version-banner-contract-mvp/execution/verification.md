# Verification: Version/banner contract

Date: 2026-03-22  
Feature: `024-registry-consumer-version-banner-contract-mvp`

## Commands

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all
cargo build --release --manifest-path tools/registry-consumer/Cargo.toml
./tools/spec-compiler/target/release/spec-compiler compile
./tools/spec-lint/target/release/spec-lint
```

Focused version-contract subset:

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all version_contract_
```

## Results

- `cargo test --all` passed (81 tests), including one new version/banner contract test.
- `cargo build --release` completed successfully.
- `spec-compiler compile` completed successfully.
- `spec-lint` completed successfully after adding this artifact.
- Top-level `--version` output is fixture-locked with exact stdout bytes, exit code `0`, and empty stderr.
