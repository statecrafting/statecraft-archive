# Verification: Channel discipline contract

Date: 2026-03-22  
Feature: `028-registry-consumer-channel-discipline-contract-mvp`

## Commands

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all
cargo build --release --manifest-path tools/registry-consumer/Cargo.toml
./tools/spec-compiler/target/release/spec-compiler compile
./tools/spec-lint/target/release/spec-lint
```

Focused channel-contract subset:

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml --all channel_contract_
```

## Results

- `cargo test --all` passed (96 tests), including five new channel-discipline contract tests.
- `cargo build --release` completed successfully.
- `spec-compiler compile` completed successfully.
- `spec-lint` completed successfully after adding this artifact.
- Representative invariants are now explicit: success/help/version use stdout with empty stderr; argument/runtime failures use stderr with empty stdout; allow-invalid success path preserves stdout-only data channel.
