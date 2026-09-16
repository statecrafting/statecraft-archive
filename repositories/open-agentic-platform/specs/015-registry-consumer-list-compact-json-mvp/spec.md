---
id: "015-registry-consumer-list-compact-json-mvp"
title: "Registry consumer list compact JSON"
feature_branch: "015-registry-consumer-list-compact-json-mvp"
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
  Add `list --compact` for single-line compact JSON array output, mutually exclusive
  with `list --json`, mirroring Feature 014 for `show`.
extends:
  - spec: "012-registry-consumer-list-json-mvp"
    nature: additive
---

# Feature Specification: Registry consumer list compact JSON

**Feature Branch**: `015-registry-consumer-list-compact-json-mvp`  
**Created**: 2026-03-22  
**Status**: Approved  
**Input**: Feature **012** added `list --json` (pretty); Feature **014** added `show --compact`. This feature completes list/show symmetry for compact bulk output.

## Requirements *(mandatory)*

- **FR-001**: `list --compact` emits a valid JSON array on one line (`serde_json::to_string`).
- **FR-002**: Parsed compact output equals parsed `list --json` output for the same filters.
- **FR-003**: `--json` and `--compact` are mutually exclusive.
- **FR-004**: `--status` and `--id-prefix` apply identically to compact and pretty JSON paths.
- **FR-005**: Default text `list` unchanged; `list --json` pretty output unchanged.

## Out of scope

- Schema/compiler/trust changes
