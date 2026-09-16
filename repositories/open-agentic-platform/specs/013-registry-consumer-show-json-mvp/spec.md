---
id: "013-registry-consumer-show-json-mvp"
title: "Registry consumer show JSON contract"
feature_branch: "013-registry-consumer-show-json-mvp"
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
  Add explicit `show --json <id>` for single-feature retrieval with a stable
  pretty-printed JSON object contract, without changing default show output or trust semantics.
extends:
  - spec: "002-registry-consumer-mvp"
    nature: additive
---

# Feature Specification: Registry consumer show JSON contract

**Feature Branch**: `013-registry-consumer-show-json-mvp`  
**Created**: 2026-03-22  
**Status**: Approved  
**Input**: Feature **012** added `list --json`. This feature aligns `show` with an explicit automation-facing JSON flag while preserving current default behavior.

## Purpose and charter

- Add `show <feature_id> --json` as the explicit JSON retrieval path
- Emit one pretty-printed JSON object (feature record from `features[]`)
- Preserve default `show <feature_id>` output when `--json` is absent
- No schema, compiler, or trust-model changes

## In scope

- `show` subcommand gains optional `--json`
- Integration tests for object shape, parity with default show, and error paths
- README and verification artifacts

## Out of scope

- Alternate human-readable default for `show` (unless future feature)
- New fields in emitted JSON beyond the registry feature object

## Requirements *(mandatory)*

- **FR-001**: `show <id> --json` prints valid JSON: one object.
- **FR-002**: Object content matches the feature record in `registry.json` (no extra transformation).
- **FR-003**: `show <id>` without `--json` behaves exactly as before Feature **013**.
- **FR-004**: Exit codes unchanged: **0** success, **1** not found or non-authoritative registry, **3** I/O/parse errors as applicable.

## Success criteria

- **SC-001**: Contract tests lock JSON shape and default-show parity.
- **SC-002**: Verification path passes.

## Clarifications

_None yet._
