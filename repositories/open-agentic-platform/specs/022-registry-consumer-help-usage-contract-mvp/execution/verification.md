# Verification: Help/usage output contract

Date: 2026-03-22  
Feature: `022-registry-consumer-help-usage-contract-mvp`

## Commands

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all
cargo build --release --manifest-path tools/registry-consumer/Cargo.toml
./tools/spec-compiler/target/release/spec-compiler compile
./tools/spec-lint/target/release/spec-lint
```

Focused help-contract subset:

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all help_contract_
```

## Results

- `cargo test --all` passed (75 tests), including four new help/usage contract tests.
- `cargo build --release` completed successfully.
- `spec-compiler compile` completed successfully.
- `spec-lint` completed successfully after adding this artifact.
- Top-level and subcommand help output (`list`, `show`, `status-report`) are now fixture-locked with exact stdout bytes and empty stderr.
