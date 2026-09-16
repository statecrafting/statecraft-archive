---
feature_id: "029-registry-consumer-contract-governance-gate-mvp"
---

# Changeset

Governance/process hardening only: add controlled-extension and normative-surface language in `tools/registry-consumer/README.md`, add doctrine doc `docs/registry-consumer-contract-governance.md`, add `.github/pull_request_template.md` checklist rubric, add explicit contract-subset gate step in `.github/workflows/spec-conformance.yml`, and add the Feature 029 spec spine. No runtime code changes in `tools/registry-consumer/src/`.

## Verification

- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml --all`
- [x] registry-consumer contract subsets gate command path (all fixture-bearing suites)
- [x] `spec-compiler compile`
- [x] `spec-lint`
