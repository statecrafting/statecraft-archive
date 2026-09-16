---
id: "025-registry-consumer-default-path-contract-mvp"
title: "Registry consumer default-path contract MVP"
feature_branch: "025-registry-consumer-default-path-contract-mvp"
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
  Lock behavior when --registry-path is omitted by asserting default-path success
  and missing-path failure semantics from controlled current working directories.
extends:
  - spec: "002-registry-consumer-mvp"
    nature: additive

refines:
  - aspect: "contract-tests"

---

# Feature Specification: Default-path contract

## Purpose

Stabilize implicit filesystem convention behavior around the default registry location `.derived/spec-registry/registry.json`.

## Requirements

- **FR-001**: Integration tests invoke `registry-consumer` without `--registry-path` from controlled working directories.
- **FR-002**: Success contract: when `.derived/spec-registry/registry.json` exists and is valid, command succeeds with expected stdout.
- **FR-003**: Failure contract: when default path is missing, command exits nonzero with exact stderr transcript and empty stdout.
- **FR-004**: Tests cover at least one core command path (`list`) for both success and missing-default-path failure.
- **FR-005**: No intentional runtime behavior changes in `src/main.rs` or `src/lib.rs`.

## Out of scope

- Changing default path constant or lookup strategy
- Default-path contracts for other binaries
