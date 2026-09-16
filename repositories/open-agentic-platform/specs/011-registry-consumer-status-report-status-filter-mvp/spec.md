---
id: "011-registry-consumer-status-report-status-filter-mvp"
title: "Registry consumer status-report status filter"
feature_branch: "011-registry-consumer-status-report-status-filter-mvp"
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
  Add `--status <value>` to `status-report` so operators and scripts can request a
  single lifecycle row in text or JSON mode while preserving existing defaults.
extends:
  - spec: "007-registry-consumer-status-report-mvp"
    nature: additive
---

# Feature Specification: Registry consumer status-report status filter

**Feature Branch**: `011-registry-consumer-status-report-status-filter-mvp`  
**Created**: 2026-03-22  
**Status**: Approved  
**Input**: Features **008-010** established JSON output, nonzero filtering, and contract tests. This feature adds focused single-status projection for automation and CI.

## Purpose and charter

Deliver a **small, finishable** enhancement:

- Add `status-report --status <value>` for single lifecycle status selection
- Support text and JSON modes
- Preserve current output when flag is absent

## In scope

- `status-report --status <value>`
- `status-report --json --status <value>`
- Interactions with `--nonzero-only` and `--show-ids`
- Tests, docs, and verification artifact

## Out of scope

- Schema/compiler changes
- Trust model or exit code changes
- New lifecycle states

## Requirements *(mandatory)*

- **FR-001**: Add optional `--status` filter to `status-report`.
- **FR-002**: Text mode prints only the selected status row when present.
- **FR-003**: JSON mode returns only the selected status row when present.
- **FR-004**: Unknown status values are rejected with non-zero exit behavior.
- **FR-005**: Without `--status`, existing behavior remains unchanged.

## Success Criteria *(mandatory)*

- **SC-001**: Scripts can query one lifecycle row directly via JSON.
- **SC-002**: Existing default contract tests remain passing.
- **SC-003**: New tests cover text mode, JSON mode, and unknown status handling.

## Clarifications

_None yet._
