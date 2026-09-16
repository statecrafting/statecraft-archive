---
id: "026-registry-consumer-allow-invalid-contract-mvp"
title: "Registry consumer allow-invalid contract MVP"
feature_branch: "026-registry-consumer-allow-invalid-contract-mvp"
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
  Lock policy-override behavior for --allow-invalid by asserting exact outcomes
  with and without the flag, including boundaries where malformed registries
  remain hard failures.
extends:
  - spec: "002-registry-consumer-mvp"
    nature: additive

refines:
  - aspect: "contract-tests"

---

# Feature Specification: allow-invalid contract

## Purpose

Stabilize the authorization/override policy surface for non-authoritative registries so operators and agents can rely on predictable behavior.

## Requirements

- **FR-001**: Integration tests assert baseline behavior without `--allow-invalid` for validation-failed registry remains exact (exit code + stderr).
- **FR-002**: Integration tests assert with `--allow-invalid`, validation-failed registry succeeds for `list`, `show`, and `status-report` with exact stdout contracts.
- **FR-003**: Integration tests assert malformed registry shape still fails even with `--allow-invalid` (override bypasses authority gate only, not structural requirements).
- **FR-004**: Failure-path assertions include exact stderr bytes and empty stdout.
- **FR-005**: No intentional runtime behavior changes in `src/main.rs` or `src/lib.rs`.

## Out of scope

- Changing `--allow-invalid` semantics
- Extending override policy to parser/argument-layer errors
