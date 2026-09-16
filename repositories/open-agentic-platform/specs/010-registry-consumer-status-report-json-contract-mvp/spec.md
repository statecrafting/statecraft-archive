---
id: "010-registry-consumer-status-report-json-contract-mvp"
title: "Registry consumer status-report JSON contract tests"
feature_branch: "010-registry-consumer-status-report-json-contract-mvp"
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
  Declare and verify `status-report --json` as a stable automation interface using
  fixture-based contract tests, without changing runtime behavior.
extends:
  - spec: "008-registry-consumer-status-report-json-mvp"
    nature: additive

refines:
  - aspect: "contract-tests"

---

# Feature Specification: Registry consumer status-report JSON contract tests

**Feature Branch**: `010-registry-consumer-status-report-json-contract-mvp`  
**Created**: 2026-03-22  
**Status**: Approved  
**Input**: Features **008** and **009** added machine-readable JSON output and nonzero filtering. This feature hardens that output as a stable contract for automation consumers.

## Purpose and charter

Deliver a **small, finishable** hardening slice:

- Document `status-report --json` as a stable interface for automation
- Add fixture-based tests that lock output shape/order/content
- Keep implementation behavior unchanged unless tests expose drift

## In scope

- Contract tests for `status-report --json` output shape and deterministic ordering
- Contract tests for `status-report --json --nonzero-only`
- README language that marks JSON mode as automation-facing contract

## Out of scope

- Any schema/compiler/runtime behavior change
- Additional output fields beyond current contract
- Versioned API negotiation

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Contract tests assert each JSON row has exactly keys: `status`, `count`, `ids`.
- **FR-002**: Contract tests assert deterministic row ordering (`draft`, `active`, `superseded`, `retired`) for default JSON mode.
- **FR-003**: Contract tests assert `--nonzero-only` returns only nonzero rows while preserving ordering among remaining rows.
- **FR-004**: Contract tests assert deterministic id ordering in `ids`.
- **FR-005**: Existing trust model and exit semantics remain unchanged.

## Success Criteria *(mandatory)*

- **SC-001**: CI fails if JSON row shape drifts unexpectedly.
- **SC-002**: CI fails if row ordering or ids ordering regresses.
- **SC-003**: No runtime behavior changes required for passing tests.

## Clarifications

_None yet._
