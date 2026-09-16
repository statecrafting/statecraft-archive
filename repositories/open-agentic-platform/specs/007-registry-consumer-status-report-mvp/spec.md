---
id: "007-registry-consumer-status-report-mvp"
title: "Registry consumer status reporting UX"
feature_branch: "007-registry-consumer-status-report-mvp"
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
  Deliver a small user-facing registry-consumer improvement focused on lifecycle/status
  reporting: add a status summary command with counts and optional ids, keep current
  trust/exit semantics, and verify behavior with integration tests.
extends:
  - spec: "002-registry-consumer-mvp"
    nature: additive
# 217 deleted the in-tree registry-consumer crate (open_agentic_spec_registry_reader).
# The crate-unit is stripped (its contracted verbs now live in spec-spine registry /
# oap-registry-enrich); the 002 spec-lineage is retained. Superseded by 217.
---

# Feature Specification: Registry consumer status reporting UX

**Feature Branch**: `007-registry-consumer-status-report-mvp`  
**Created**: 2026-03-22  
**Status**: Approved  
**Input**: The governance spine now defines lifecycle semantics (**003**), execution (**004**), and verification (**005**). `registry-consumer` already supports `list` and `show` from **002**, but does not provide a compact status report for operators or CI logs.

## Purpose and charter

Deliver a **small, finishable** improvement to `registry-consumer` that makes lifecycle status easier to inspect:

- Add a `status-report` subcommand that summarizes features by status
- Preserve existing read-only trust model and exit semantics from **002**
- Keep output human-readable for quick operator use

## In scope

- `registry-consumer status-report` command
- Deterministic ordering of statuses in output (`draft`, `active`, `superseded`, `retired`)
- Count per status
- Optional per-status feature id listing (`--show-ids`)
- Tests covering expected output and behavior

## Out of scope

- Changing `registry.json` schema (Feature **000**)
- Changing compiler validation behavior (Feature **001**)
- JSON output mode for list/report
- New meta/governance features

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Add CLI subcommand **`status-report`** to `registry-consumer`.
- **FR-002**: `status-report` reads the same source and applies the same trust model as other commands (default requires `validation.passed == true`, unless `--allow-invalid`).
- **FR-003**: Output includes one line per known status (`draft`, `active`, `superseded`, `retired`) with deterministic order and counts.
- **FR-004**: `--show-ids` appends id lists per status, sorted lexicographically.
- **FR-005**: Existing commands and exit codes from **002** remain unchanged.

### Key Entities

- **Status report**: Human-readable summary grouped by feature status from `features[]`.

## Success Criteria *(mandatory)*

- **SC-001**: A contributor can run one command and see status distribution quickly.
- **SC-002**: Tests verify deterministic report ordering and `--show-ids`.
- **SC-003**: Existing `list` / `show` tests continue to pass.

## Clarifications

_None yet._
