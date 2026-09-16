# Verification: Registry consumer show JSON contract

Date: 2026-03-22  
Feature: `013-registry-consumer-show-json-mvp`

## Commands

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml
cargo build --release --manifest-path tools/registry-consumer/Cargo.toml
./tools/spec-compiler/target/release/spec-compiler compile
./tools/spec-lint/target/release/spec-lint
```

## Results

- `cargo test` passed including new `show --json` integration tests.
- `cargo build --release` completed successfully.
- `spec-compiler compile` completed successfully.
- `spec-lint` completed successfully.
