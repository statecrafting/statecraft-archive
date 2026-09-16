---
id: "017-registry-consumer-shared-json-serialization-helper-mvp"
title: "Registry consumer shared JSON serialization helper"
feature_branch: "017-registry-consumer-shared-json-serialization-helper-mvp"
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
  Consolidate pretty vs compact JSON serialization in one library helper; no CLI
  behavior change.
extends:
  - spec: "002-registry-consumer-mvp"
    nature: additive

refines:
  - aspect: "json-serialization"

---

# Feature Specification: Shared JSON serialization helper

## Purpose

Remove duplicated `serde_json::to_string` / `to_string_pretty` branching in `list`, `show`, and `status-report` by centralizing logic in `serialize_json_compact_or_pretty`.

## Requirements

- **FR-001**: Helper accepts `Serialize` + `compact: bool`.
- **FR-002**: No user-visible output or exit-code changes.
- **FR-003**: Existing integration tests remain the regression suite.

## Out of scope

- Schema, compiler, trust model
