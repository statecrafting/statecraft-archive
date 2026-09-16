---
feature_id: "014-registry-consumer-show-compact-json-mvp"
title: "Show --compact JSON output"
---

# Changeset: Registry consumer show compact JSON

## Scope

- `show <id> --compact` single-line JSON; `--json` and `--compact` mutually exclusive.

## Verification checklist

- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `cargo build --release --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `spec-compiler compile`
- [x] `spec-lint`
