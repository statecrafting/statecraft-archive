---
id: "009-registry-consumer-status-report-nonzero-mvp"
title: "Registry consumer status-report nonzero filtering"
feature_branch: "009-registry-consumer-status-report-nonzero-mvp"
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
  Add `--nonzero-only` to `registry-consumer status-report` so automation consumers can
  omit empty lifecycle buckets in both human-readable and JSON output modes.
extends:
  - spec: "007-registry-consumer-status-report-mvp"
    nature: additive
---

# Feature Specification: Registry consumer status-report nonzero filtering

**Feature Branch**: `009-registry-consumer-status-report-nonzero-mvp`  
**Created**: 2026-03-22  
**Status**: Approved  
**Input**: Feature **007** added status reporting and Feature **008** added JSON output. This feature compounds both with a minimal automation-focused filter.

## Purpose and charter

Deliver a **small, finishable** enhancement to `registry-consumer`:

- Add `--nonzero-only` to `status-report`
- Apply it to text and `--json` output paths
- Preserve fixed lifecycle ordering among remaining rows

## In scope

- `status-report --nonzero-only`
- `status-report --show-ids --nonzero-only`
- `status-report --json --nonzero-only`
- Integration tests for filtering behavior and deterministic ordering

## Out of scope

- `registry.json` schema changes
- `spec-compiler` behavior changes
- Trust model or exit code changes
- New lifecycle statuses

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Add `--nonzero-only` flag to `status-report`.
- **FR-002**: In text mode, `--nonzero-only` omits any status row with `count == 0`.
- **FR-003**: In JSON mode, `--nonzero-only` omits rows with `count == 0`.
- **FR-004**: Remaining rows keep deterministic order (`draft`, `active`, `superseded`, `retired`).
- **FR-005**: Without `--nonzero-only`, output remains unchanged from Features **007** and **008**.

### Key Entities

- **Status report row**: tuple `(status, count, ids)` projected as text or JSON output.

## Success Criteria *(mandatory)*

- **SC-001**: Operators can hide empty statuses in text mode without losing ordering.
- **SC-002**: Scripts can consume compact `--json --nonzero-only` output directly.
- **SC-003**: Existing output and semantics are unchanged when the new flag is absent.

## Clarifications

_None yet._
