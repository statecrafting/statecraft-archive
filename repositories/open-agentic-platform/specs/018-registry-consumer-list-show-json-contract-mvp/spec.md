---
id: "018-registry-consumer-list-show-json-contract-mvp"
title: "Registry consumer list/show JSON contract tests"
feature_branch: "018-registry-consumer-list-show-json-contract-mvp"
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
  Lock stable automation contracts for list and show JSON modes (pretty and compact)
  with fixture-based tests, mirroring Feature 010 for status-report.
extends:
  - spec: "002-registry-consumer-mvp"
    nature: additive

refines:
  - aspect: "contract-tests"

---

# Feature Specification: List/show JSON contract tests

## Purpose

Guard `list --json`, `list --compact`, `show --json`, and `show --compact` against accidental output drift.

## Requirements

- **FR-001**: Integration tests assert exact parsed JSON for representative fixtures.
- **FR-002**: Compact mode additionally asserts exact serialized line matches `serde_json::to_string` of the expected value.
- **FR-003**: No runtime or CLI behavior changes beyond test coverage.

## Out of scope

- Schema/compiler changes
