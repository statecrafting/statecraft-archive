---
feature_id: "031-registry-consumer-list-ids-only-contract-mvp"
---

# Changeset

Contract extension: add `list --ids-only` in `tools/registry-consumer/src/main.rs` as a one-id-per-line output mode that preserves existing filter and ordering semantics; add fixture-backed ids-only tests; refresh list help fixture to include the new flag; and update README/spec spine.

## Verification

- [x] Full registry-consumer contract subset gate command path (including `ids_only_contract_`)
- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml --all`
- [x] `spec-compiler compile`
- [x] `spec-lint`
