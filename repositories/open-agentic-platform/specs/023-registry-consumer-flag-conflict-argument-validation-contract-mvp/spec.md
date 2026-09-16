---
id: "023-registry-consumer-flag-conflict-argument-validation-contract-mvp"
title: "Registry consumer flag-conflict and argument-validation contract MVP"
feature_branch: "023-registry-consumer-flag-conflict-argument-validation-contract-mvp"
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
  Lock argument-layer behavior contracts for registry-consumer by asserting exact
  exit codes and stderr transcripts for flag conflicts, missing required args,
  and invalid enum values.
extends:
  - spec: "002-registry-consumer-mvp"
    nature: additive

refines:
  - aspect: "contract-tests"

---

# Feature Specification: Flag-conflict and argument-validation contract

## Purpose

Prevent drift in CLI argument-handling behavior that operators and agents rely on for predictable diagnostics and nonzero signaling.

## Requirements

- **FR-001**: Fixture transcripts under `tools/spec-spine/registry-consumer/tests/fixtures/arg_contract/expected/` define source-of-truth stderr output for selected argument-layer failures.
- **FR-002**: Integration tests assert exact exit code and stderr bytes for `--json` + `--compact` conflicts on `list`, `show`, and `status-report`.
- **FR-003**: Integration tests assert exact exit code and stderr bytes for missing required positional argument on `show` (missing `<FEATURE_ID>`).
- **FR-004**: Integration tests assert exact exit code and stderr bytes for invalid enum value on `status-report --status`.
- **FR-005**: Tests assert stdout remains empty for these argument-layer failures.
- **FR-006**: No intentional runtime behavior changes in `src/main.rs` or `src/lib.rs`.

## Out of scope

- Success-path JSON/output contracts (covered by Features 010/018/021)
- Runtime data-load failures (covered by Feature 020)
