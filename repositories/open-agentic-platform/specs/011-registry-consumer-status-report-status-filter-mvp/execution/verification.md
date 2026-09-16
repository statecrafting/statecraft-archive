# Verification: Registry consumer status-report status filter

Date: 2026-03-22  
Feature: `011-registry-consumer-status-report-status-filter-mvp`

## Commands

```bash
cargo test --manifest-path tools/registry-consumer/Cargo.toml
cargo build --release --manifest-path tools/registry-consumer/Cargo.toml
./tools/spec-compiler/target/release/spec-compiler compile
./tools/spec-lint/target/release/spec-lint
./tools/registry-consumer/target/release/registry-consumer status-report --status active
./tools/registry-consumer/target/release/registry-consumer status-report --json --status active
```

## Results

- `cargo test` passed including new `--status` filter tests for text/JSON and invalid status handling.
- `cargo build --release` completed successfully.
- `spec-compiler compile` completed successfully.
- `spec-lint` completed successfully.
- Text status filter output includes only the selected status row.
- JSON status filter output includes only the selected status row and preserves existing row schema.
