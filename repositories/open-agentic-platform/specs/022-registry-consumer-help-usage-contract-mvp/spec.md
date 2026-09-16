---
id: "022-registry-consumer-help-usage-contract-mvp"
title: "Registry consumer help/usage output contract MVP"
feature_branch: "022-registry-consumer-help-usage-contract-mvp"
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
  Lock top-level and subcommand help output for registry-consumer using fixture
  transcripts and integration tests, preventing silent ergonomics drift.
extends:
  - spec: "002-registry-consumer-mvp"
    nature: additive

refines:
  - aspect: "contract-tests"

---

# Feature Specification: Help/usage output contract

## Purpose

Stabilize human/operator-facing CLI guidance by asserting exact `--help` output for key command surfaces.

## Requirements

- **FR-001**: Fixture transcripts under `tools/spec-spine/registry-consumer/tests/fixtures/help_contract/expected/` define source-of-truth help output.
- **FR-002**: Integration tests assert exact stdout bytes and zero exit code for `registry-consumer --help`.
- **FR-003**: Integration tests assert exact stdout bytes and zero exit code for `list --help`, `show --help`, and `status-report --help`.
- **FR-004**: Help-contract tests assert stderr remains empty for success-path help output.
- **FR-005**: No intentional runtime behavior changes in `src/main.rs` or `src/lib.rs`.

## Out of scope

- Locking shell-completion output
- Version string contracts (`--version`) or clap error formatting contracts
