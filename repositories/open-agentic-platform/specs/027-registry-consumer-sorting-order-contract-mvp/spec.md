---
id: "027-registry-consumer-sorting-order-contract-mvp"
title: "Registry consumer sorting-order contract MVP"
feature_branch: "027-registry-consumer-sorting-order-contract-mvp"
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
  Lock deterministic sorting-order behavior for list and status-report outputs,
  including feature-id ordering, status row ordering, and sorted ids within rows.
extends:
  - spec: "002-registry-consumer-mvp"
    nature: additive

refines:
  - aspect: "contract-tests"

---

# Feature Specification: Sorting-order contract

## Purpose

Prevent accidental drift in ordering semantics that operators and automation rely on for stable output comparison.

## Requirements

- **FR-001**: Integration tests assert `list` output order remains lexicographic by feature id.
- **FR-002**: Integration tests assert `status-report` row order remains fixed as `draft`, `active`, `superseded`, `retired`.
- **FR-003**: Integration tests assert `status-report` ids remain sorted lexicographically within each status row.
- **FR-004**: Contracts include at least one `--allow-invalid` scenario to prove ordering behavior is unchanged when authority gate is bypassed.
- **FR-005**: No intentional runtime behavior changes in `src/main.rs` or `src/lib.rs`.

## Out of scope

- Changing sorting behavior or introducing configurable sort options
- Ordering contracts for other binaries
