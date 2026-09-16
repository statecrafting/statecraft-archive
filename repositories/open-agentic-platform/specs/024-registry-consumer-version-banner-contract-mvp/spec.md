---
id: "024-registry-consumer-version-banner-contract-mvp"
title: "Registry consumer version/banner contract MVP"
feature_branch: "024-registry-consumer-version-banner-contract-mvp"
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
  Lock top-level `--version` output for registry-consumer with fixture-backed
  transcript tests, including exit code and stderr expectations.
extends:
  - spec: "002-registry-consumer-mvp"
    nature: additive

refines:
  - aspect: "contract-tests"

---

# Feature Specification: Version/banner contract

## Purpose

Prevent drift in operator/agent version introspection behavior by asserting exact `--version` output and success-path process semantics.

## Requirements

- **FR-001**: Fixture transcript under `tools/spec-spine/registry-consumer/tests/fixtures/version_contract/expected/` defines source-of-truth `--version` stdout.
- **FR-002**: Integration test asserts exact stdout bytes and exit code `0` for `registry-consumer --version`.
- **FR-003**: Integration test asserts stderr is empty for `--version` success path.
- **FR-004**: No intentional runtime behavior changes in `src/main.rs` or `src/lib.rs`.

## Out of scope

- Locking build metadata beyond currently emitted clap version text
- Version contracts for other project binaries
