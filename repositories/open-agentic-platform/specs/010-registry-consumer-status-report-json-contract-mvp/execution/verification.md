# Verification: Registry consumer status-report JSON contract tests

Date: 2026-03-22  
Feature: `010-registry-consumer-status-report-json-contract-mvp`

## Commands

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml
cargo build --release --manifest-path tools/registry-consumer/Cargo.toml
./tools/spec-compiler/target/release/spec-compiler compile
./tools/spec-lint/target/release/spec-lint
./tools/registry-consumer/target/release/registry-consumer status-report --json
./tools/registry-consumer/target/release/registry-consumer status-report --json --nonzero-only
```

## Results

- `cargo test` passed (17 tests), including new fixture-style JSON contract tests.
- `cargo build --release` completed successfully.
- `spec-compiler compile` completed successfully.
- `spec-lint` completed successfully after adding this artifact.
- `status-report --json` output matched expected stable shape/order contract.
- `status-report --json --nonzero-only` output preserved contract for filtered rows.
