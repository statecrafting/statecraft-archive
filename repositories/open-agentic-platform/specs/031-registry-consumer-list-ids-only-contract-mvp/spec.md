---
id: "031-registry-consumer-list-ids-only-contract-mvp"
title: "Registry consumer list ids-only contract MVP"
feature_branch: "031-registry-consumer-list-ids-only-contract-mvp"
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
  Add a narrow contract extension: `list --ids-only` emits one feature id per
  line while preserving existing filter and deterministic ordering semantics.
extends:
  - spec: "002-registry-consumer-mvp"
    nature: additive

refines:
  - aspect: "contract-tests"

---

# Feature Specification: list --ids-only contract

## Purpose

Provide a minimal, line-oriented id stream for scripting workflows without altering existing list/json/compact semantics.

## Requirements

- **FR-001**: `list --ids-only` emits feature ids only, one id per line.
- **FR-002**: Output ordering matches existing list semantics (lexicographic by id).
- **FR-003**: Existing `--status` and `--id-prefix` filters apply unchanged.
- **FR-004**: `--ids-only` is mutually exclusive with `--json` and `--compact`.
- **FR-005**: Existing list/json/compact/default behaviors remain unchanged.

## Out of scope

- New show/status-report ids-only modes
- Changing existing JSON/text contract outputs
