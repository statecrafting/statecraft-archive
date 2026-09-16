---
feature_id: "020-registry-consumer-error-contract-mvp"
---

# Changeset

Test and docs hardening only: add deterministic error fixtures plus expected stderr transcripts under `tools/registry-consumer/tests/fixtures/error_contract/`, add five failure-path contract tests in `tests/cli.rs`, and add a minimal README note for Feature 020. No runtime code changes in `src/`.

## Verification

- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml --all`
- [x] `cargo build --release --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `spec-compiler compile`
- [x] `spec-lint`
