---
id: "020-registry-consumer-error-contract-mvp"
title: "Registry consumer error contract MVP"
feature_branch: "020-registry-consumer-error-contract-mvp"
status: superseded
superseded_by: "217-spec-spine-engine-swap-collapse"
implementation: complete
kind: platform-delivery
domain: tooling
created: "2026-03-22"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Lock key runtime failure-path contracts for registry-consumer by asserting exact
  stderr bytes and exit codes from deterministic fixtures, without changing CLI behavior.
extends:
  - spec: "002-registry-consumer-mvp"
    nature: additive

refines:
  - aspect: "error-shape"

---

# Feature Specification: Error contract tests

## Purpose

Guard high-value failure paths (`load`, `authority`, `shape`, `not-found`) against accidental drift in diagnostics and exit behavior.

## Requirements

- **FR-001**: Add deterministic fixtures under `tools/spec-spine/registry-consumer/tests/fixtures/error_contract/` for failure scenarios.
- **FR-002**: Integration tests assert exact `stderr` bytes and exact exit code for selected failure-path commands.
- **FR-003**: Contracts cover at least one path each for exit **1** and exit **3**.
- **FR-004**: Scope remains runtime-stable: no intentional behavior changes in `src/main.rs` or `src/lib.rs`.

## Out of scope

- Locking Clap parser/help formatting for exit **2** paths
- Changing error wording or introducing structured error output
