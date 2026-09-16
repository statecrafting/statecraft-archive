# Verification: Registry consumer status-report nonzero filtering

Date: 2026-03-22  
Feature: `009-registry-consumer-status-report-nonzero-mvp`

## Commands

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml
cargo build --release --manifest-path tools/registry-consumer/Cargo.toml
./tools/spec-compiler/target/release/spec-compiler compile
./tools/spec-lint/target/release/spec-lint
./tools/registry-consumer/target/release/registry-consumer status-report --nonzero-only
./tools/registry-consumer/target/release/registry-consumer status-report --json --nonzero-only
```

## Results

- `cargo test` passed and includes nonzero-only text/JSON coverage.
- `cargo build --release` completed successfully.
- `spec-compiler compile` completed successfully.
- `spec-lint` completed successfully.
- `status-report --nonzero-only` emitted only nonzero status rows.
- `status-report --json --nonzero-only` emitted only nonzero JSON rows in deterministic order.
