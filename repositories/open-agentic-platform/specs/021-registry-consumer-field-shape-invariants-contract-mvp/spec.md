---
id: "021-registry-consumer-field-shape-invariants-contract-mvp"
title: "Registry consumer field-shape invariants contract MVP"
feature_branch: "021-registry-consumer-field-shape-invariants-contract-mvp"
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
  Lock object-shape invariants for list/show/status-report JSON outputs: required
  keys, no unexpected keys, null omission behavior, and stable key ordering where
  current serialization implies it.
extends:
  - spec: "002-registry-consumer-mvp"
    nature: additive

refines:
  - aspect: "contract-tests"

---

# Feature Specification: Field-shape invariants contract

## Purpose

Guard JSON object-shape drift in automation-facing outputs by asserting key presence, key absence, null omission semantics, and key-order expectations.

## Requirements

- **FR-001**: Integration tests assert exact key set for feature objects emitted by `list --json` and `show --json`.
- **FR-002**: Integration tests assert exact key set for row objects emitted by `status-report --json`.
- **FR-003**: Integration tests assert omission of optional feature keys when absent in source registry data (no implicit `null` insertion).
- **FR-004**: Integration tests assert stable key ordering for parsed feature and status-report row objects where current serialization preserves it.
- **FR-005**: No intentional runtime behavior changes in `src/main.rs` or `src/lib.rs`.

## Out of scope

- Schema migrations for registry producer output
- Introducing explicit versioned JSON schemas in the CLI
