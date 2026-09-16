---
feature_id: "028-registry-consumer-channel-discipline-contract-mvp"
---

# Changeset

Test and docs hardening only: add five focused channel-discipline tests in `tools/registry-consumer/tests/cli.rs` and add minimal README feature linkage for 028. No runtime code changes in `src/`.

## Verification

- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml --all`
- [x] `cargo build --release --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `spec-compiler compile`
- [x] `spec-lint`
