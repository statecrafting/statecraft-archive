---
id: "019-registry-consumer-readme-examples-contract-mvp"
title: "Registry consumer README examples contract MVP"
feature_branch: "019-registry-consumer-readme-examples-contract-mvp"
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
  Keep README command examples aligned with verified fixture output: human-facing
  text vs automation JSON/compact, with integration tests that assert CLI output
  and README fenced blocks match committed transcripts.
extends:
  - spec: "002-registry-consumer-mvp"
    nature: additive

refines:
  - aspect: "contract-tests"

---

# Feature Specification: README examples contract

## Purpose

Reduce documentation drift for `list`, `show`, and `status-report` by treating README examples as contracts: the same transcripts used in tests appear in the README behind explicit markers.

## Requirements

- **FR-001**: Committed registry fixtures under `tools/spec-spine/registry-consumer/tests/fixtures/readme_examples/` drive documented commands.
- **FR-002**: Integration tests assert CLI stdout for those commands matches committed expected-output files (byte-for-byte after normalizing line endings for tests if needed).
- **FR-003**: Integration tests assert README fenced blocks between `readme-contract` markers match the same expected-output files.
- **FR-004**: README separates **human-facing** (default text table / pretty JSON where shown for readability) from **automation-facing** (JSON and compact one-line) examples.
- **FR-005**: No change to production CLI behavior beyond what is required to keep examples accurate (prefer none).

## Out of scope

- Generating README from templates at build time
- Broad documentation rewrites outside `tools/spec-spine/registry-consumer/README.md`
