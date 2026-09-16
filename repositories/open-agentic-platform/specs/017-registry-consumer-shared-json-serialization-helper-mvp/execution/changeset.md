---
feature_id: "017-registry-consumer-shared-json-serialization-helper-mvp"
---

# Changeset

Internal refactor only; behavior unchanged.

## Verification

- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `cargo build --release --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `spec-compiler compile`
- [x] `spec-lint`
