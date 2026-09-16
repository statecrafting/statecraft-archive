---
id: "014-registry-consumer-show-compact-json-mvp"
title: "Registry consumer show compact JSON"
feature_branch: "014-registry-consumer-show-compact-json-mvp"
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
  Add `show <id> --compact` for single-line compact JSON feature output, mutually
  exclusive with `--json`, without changing default or pretty `--json` behavior.
extends:
  - spec: "013-registry-consumer-show-json-mvp"
    nature: additive
---

# Feature Specification: Registry consumer show compact JSON

**Feature Branch**: `014-registry-consumer-show-compact-json-mvp`  
**Created**: 2026-03-22  
**Status**: Approved  
**Input**: Feature **013** added explicit `show --json` (pretty). This feature adds compact output for pipelines and diffs.

## Purpose and charter

- `show <id> --compact`: one-line `serde_json::to_string` output
- `show <id>` and `show <id> --json`: unchanged pretty output
- `--compact` and `--json` mutually exclusive at parse time

## Requirements *(mandatory)*

- **FR-001**: `--compact` emits valid JSON object on one line (no pretty indentation).
- **FR-002**: Parsed compact output equals parsed pretty output for the same feature.
- **FR-003**: `--json` cannot be combined with `--compact`.
- **FR-004**: Exit semantics unchanged from Feature **002**.

## Out of scope

- Schema/compiler/trust changes
- `list --compact` (future slice)

## Clarifications

_None yet._
