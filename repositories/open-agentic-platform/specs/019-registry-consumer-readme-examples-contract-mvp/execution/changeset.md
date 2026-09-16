---
feature_id: "019-registry-consumer-readme-examples-contract-mvp"
---

# Changeset

Documentation and test coverage only: `tests/fixtures/readme_examples/` (registries + expected stdout), `tests/cli.rs` README contract tests, `tools/registry-consumer/README.md` verified examples with marker-bound fences, and this spec spine. No changes to `src/` or CLI behavior.

## Verification

- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml --all`
- [x] `cargo build --release --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `spec-compiler compile`
- [x] `spec-lint`
