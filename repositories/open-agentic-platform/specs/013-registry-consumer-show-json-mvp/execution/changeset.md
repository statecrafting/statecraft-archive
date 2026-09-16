---
feature_id: "013-registry-consumer-show-json-mvp"
title: "Show --json explicit contract"
---

# Changeset: Registry consumer show JSON contract

## Scope

- Optional `--json` on `show` for explicit automation contract; default `show` unchanged.

## References

- **Spec:** [../spec.md](../spec.md)

## Verification checklist

- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `cargo build --release --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `spec-compiler compile`
- [x] `spec-lint`
