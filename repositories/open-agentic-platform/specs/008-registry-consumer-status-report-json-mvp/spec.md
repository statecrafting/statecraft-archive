---
id: "008-registry-consumer-status-report-json-mvp"
title: "Registry consumer status-report JSON output"
feature_branch: "008-registry-consumer-status-report-json-mvp"
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
  Add machine-readable JSON output to `registry-consumer status-report` so scripts and
  CI can consume lifecycle/status distribution without parsing human-formatted text.
extends:
  - spec: "007-registry-consumer-status-report-mvp"
    nature: additive
---

# Feature Specification: Registry consumer status-report JSON output

**Feature Branch**: `008-registry-consumer-status-report-json-mvp`  
**Created**: 2026-03-22  
**Status**: Approved  
**Input**: Feature **007** delivered human-readable status reporting through the 000-006 governance spine. This feature treats **007** as the new baseline and adds machine-readable output for operational automation.

## Milestone baseline

- Feature **007** is the first fully delivered user-facing slice through Features **000-006**.
- Feature **008** compounds **007** by preserving existing semantics and adding JSON output mode only.

## Purpose and charter

Deliver a **small, finishable** enhancement to `registry-consumer`:

- Add `--json` output mode to `status-report`
- Keep trust model, schema contract, and exit codes unchanged
- Preserve deterministic ordering for stable machine consumption

## In scope

- `registry-consumer status-report --json`
- Deterministic JSON array output in known status order (`draft`, `active`, `superseded`, `retired`)
- Include status, count, and sorted ids for each known status
- Tests and docs for JSON mode

## Out of scope

- Any `registry.json` schema change
- Any compiler behavior changes
- Changes to `list` / `show` command contracts
- New statuses or lifecycle policy changes

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Add `--json` flag to `status-report`.
- **FR-002**: `status-report --json` emits valid JSON to stdout and does not include human-formatted table lines.
- **FR-003**: JSON output uses fixed status ordering: `draft`, `active`, `superseded`, `retired`.
- **FR-004**: Each JSON row includes `status`, `count`, and `ids` (sorted lexicographically).
- **FR-005**: Existing trust model and exit semantics remain unchanged.

### Key Entities

- **Status report row**: `{ "status": string, "count": number, "ids": string[] }`

## Success Criteria *(mandatory)*

- **SC-001**: Scripts can parse `status-report --json` with standard JSON tooling.
- **SC-002**: Integration tests cover JSON validity and deterministic ordering/content.
- **SC-003**: Existing command tests continue to pass unchanged.

## Clarifications

_None yet._
