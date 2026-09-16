---
feature_id: "026-registry-consumer-allow-invalid-contract-mvp"
---

# Changeset

Test and docs hardening only: add allow-invalid policy fixtures and transcript files under `tools/registry-consumer/tests/fixtures/allow_invalid_contract/`, add five policy-override contract tests in `tests/cli.rs`, and add minimal README feature linkage for 026. No runtime code changes in `src/`.

## Verification

- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml --all`
- [x] `cargo build --release --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `spec-compiler compile`
- [x] `spec-lint`
