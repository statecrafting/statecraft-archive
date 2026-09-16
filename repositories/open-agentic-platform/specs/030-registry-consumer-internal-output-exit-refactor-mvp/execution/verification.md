# Verification: Internal output/exit refactor

Date: 2026-03-22  
Feature: `030-registry-consumer-internal-output-exit-refactor-mvp`

## Commands

```bash
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

- All contract subset suites passed.
- `cargo test --all` passed (96 tests).
- `spec-compiler compile` completed successfully.
- `spec-lint` completed successfully.
- No fixture files changed; observable contract behavior preserved.
