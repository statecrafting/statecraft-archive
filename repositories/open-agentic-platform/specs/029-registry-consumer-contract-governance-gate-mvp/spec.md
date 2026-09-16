---
id: "029-registry-consumer-contract-governance-gate-mvp"
title: "Registry consumer change classification and contract-governance gate MVP"
feature_branch: "029-registry-consumer-contract-governance-gate-mvp"
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
  Codify controlled-extension governance for registry-consumer via explicit
  stabilization boundary, change classification rubric, reviewer checklist,
  contract baseline definition, and CI validation gate language.
extends:
  - spec: "002-registry-consumer-mvp"
    nature: additive

refines:
  - aspect: "contract-tests"

---

# Feature Specification: Contract governance gate

## Purpose

Institutionalize contract doctrine so future work is evaluated under governance rules rather than implementation drift.

## Requirements

- **FR-001**: README documents registry-consumer as in **controlled extension mode** and states normative contract surfaces.
- **FR-002**: Repository includes a change-classification rubric with required labels: `contract extension`, `internal refactor, no observable change`, `breaking change candidate`.
- **FR-003**: Repository includes a PR/reviewer checklist for observable output, ordering, channel routing, exit behavior, fixture updates, and versioning language.
- **FR-004**: Governance docs define the current fixture corpus as contract baseline for future regression judgment.
- **FR-005**: Main CI path explicitly runs fixture-bearing registry-consumer contract test suites.
- **FR-006**: No runtime behavior changes in `tools/spec-spine/registry-consumer/src/`.

## Out of scope

- New CLI behavior slices
- Reorganizing existing fixture contracts
