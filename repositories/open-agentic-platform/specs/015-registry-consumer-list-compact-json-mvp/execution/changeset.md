---
feature_id: "015-registry-consumer-list-compact-json-mvp"
title: "List --compact JSON output"
---

# Changeset: Registry consumer list compact JSON

## Verification checklist

- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `cargo build --release --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `spec-compiler compile`
- [x] `spec-lint`
