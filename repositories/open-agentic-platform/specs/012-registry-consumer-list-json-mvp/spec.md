---
id: "012-registry-consumer-list-json-mvp"
title: "Registry consumer list JSON output"
feature_branch: "012-registry-consumer-list-json-mvp"
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
  Add `list --json` so scripts and tooling receive a stable JSON array of feature
  objects, reusing existing filters and sort order without changing registry schema.
extends:
  - spec: "002-registry-consumer-mvp"
    nature: additive
---

# Feature Specification: Registry consumer list JSON output

**Feature Branch**: `012-registry-consumer-list-json-mvp`  
**Created**: 2026-03-22  
**Status**: Approved  
**Input**: `list` is human-readable only; `status-report --json` already established automation-facing JSON. This feature closes the same gap for feature listing.

## Purpose and charter

- Add `list --json` emitting a pretty-printed JSON array of filtered feature records
- Preserve `--status` and `--id-prefix` behavior
- Preserve lexicographic sort by feature `id`
- No schema or compiler changes

## In scope

- `list --json`
- `list --json --status <value>`
- `list --json --id-prefix <value>`
- Tests and docs

## Out of scope

- Changing `registry.json` schema
- New fields beyond what exists in each feature object
- Changing trust model or exit codes

## Requirements *(mandatory)*

- **FR-001**: `list --json` prints valid JSON: a single array of feature objects.
- **FR-002**: Order is lexicographic by `id` (same as text `list`).
- **FR-003**: `--status` and `--id-prefix` apply identically in JSON and text modes.
- **FR-004**: Without `--json`, text table output is unchanged.
- **FR-005**: Exit semantics match Feature **002** (0 / 1 / 3).

## Success criteria

- **SC-001**: Integration tests cover JSON shape, sort, filters, and unchanged text path.
- **SC-002**: `spec-lint` passes with verification artifact present.

## Clarifications

_None yet._
