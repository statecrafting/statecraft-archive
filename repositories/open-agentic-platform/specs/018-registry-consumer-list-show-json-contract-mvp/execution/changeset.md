---
feature_id: "018-registry-consumer-list-show-json-contract-mvp"
---

# Changeset

Test-only hardening; no production code changes (`tests/cli.rs` + README + spec spine).

## Verification

- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `cargo build --release --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `spec-compiler compile`
- [x] `spec-lint`
