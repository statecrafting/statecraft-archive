---
id: "016-registry-consumer-status-report-compact-json-mvp"
title: "Registry consumer status-report compact JSON"
feature_branch: "016-registry-consumer-status-report-compact-json-mvp"
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
  Add `status-report --compact` for single-line JSON array output, mutually exclusive
  with `--json`, completing compact symmetry with list and show.
extends:
  - spec: "008-registry-consumer-status-report-json-mvp"
    nature: additive
---

# Feature Specification: Registry consumer status-report compact JSON

## Requirements

- **FR-001**: `status-report --compact` emits one line of compact JSON (array of report rows).
- **FR-002**: Parsed output equals `status-report --json` for the same flags (`--status`, `--nonzero-only`).
- **FR-003**: `--json` and `--compact` mutually exclusive.
- **FR-004**: Text mode and `--show-ids` behavior unchanged when neither JSON flag is set.
- **FR-005**: Exit semantics unchanged (Feature **002**).

## Out of scope

- Schema/compiler/trust changes
