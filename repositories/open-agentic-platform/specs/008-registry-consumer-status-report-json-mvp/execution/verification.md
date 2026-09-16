# Verification: Registry consumer status-report JSON output

Date: 2026-03-22  
Feature: `008-registry-consumer-status-report-json-mvp`

## Commands

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml
cargo build --release --manifest-path tools/registry-consumer/Cargo.toml
./tools/spec-compiler/target/release/spec-compiler compile
./tools/spec-lint/target/release/spec-lint
./tools/registry-consumer/target/release/registry-consumer status-report --json
```

## Results

- `cargo test` passed (12 integration tests; includes new `status-report --json` tests).
- `cargo build --release` completed successfully.
- `spec-compiler compile` completed successfully.
- `spec-lint` completed successfully after adding this verification artifact.
- `status-report --json` produced valid JSON rows in deterministic status order.
