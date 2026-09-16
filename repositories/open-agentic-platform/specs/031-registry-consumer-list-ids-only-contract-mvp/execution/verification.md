# Verification: list --ids-only contract

Date: 2026-03-22  
Feature: `031-registry-consumer-list-ids-only-contract-mvp`

## Commands

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all ids_only_contract_

cargo test --manifest-path tools/registry-consumer/Cargo.toml --all readme_
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all error_contract_
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all shape_contract_
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all help_contract_
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all arg_contract_
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all version_contract_
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all default_path_contract_
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all allow_invalid_contract_
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all sorting_contract_
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all channel_contract_

cargo test --manifest-path tools/registry-consumer/Cargo.toml --all
cargo build --release --manifest-path tools/spec-compiler/Cargo.toml
./tools/spec-compiler/target/release/spec-compiler compile
cargo build --release --manifest-path tools/spec-lint/Cargo.toml
./tools/spec-lint/target/release/spec-lint
```

## Results

- `ids_only_contract_` subset passed (3 tests).
- All registry-consumer contract subsets passed after intentionally updating the `list --help` fixture for the new flag.
- `cargo test --all` passed (99 tests).
- `spec-compiler compile` completed successfully.
- `spec-lint` completed successfully.
