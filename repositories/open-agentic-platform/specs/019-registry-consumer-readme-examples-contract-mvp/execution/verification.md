# Verification: README examples contract

Date: 2026-03-22  
Feature: `019-registry-consumer-readme-examples-contract-mvp`

## Commands

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all
cargo build --release --manifest-path tools/registry-consumer/Cargo.toml
./tools/spec-compiler/target/release/spec-compiler compile
./tools/spec-lint/target/release/spec-lint
```

README contract subset:

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all readme_
```

## Results

- `cargo test --all` passed (62 tests), including nine CLI transcript assertions and one README marker sync test.
- `cargo build --release` completed successfully.
- `spec-compiler compile` completed successfully.
- `spec-lint` completed successfully after adding this artifact.
- Human-facing vs automation-facing examples are separated in `README.md`; fenced bodies match `tests/fixtures/readme_examples/expected/*.txt`.
