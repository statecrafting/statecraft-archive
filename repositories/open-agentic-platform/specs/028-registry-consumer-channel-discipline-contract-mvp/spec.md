---
id: "028-registry-consumer-channel-discipline-contract-mvp"
title: "Registry consumer stderr/stdout channel discipline contract MVP"
feature_branch: "028-registry-consumer-channel-discipline-contract-mvp"
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
  Lock channel discipline invariants so success-path data/help/version output is
  emitted on stdout while diagnostics remain on stderr for argument and runtime
  failures.
extends:
  - spec: "002-registry-consumer-mvp"
    nature: additive

refines:
  - aspect: "contract-tests"

---

# Feature Specification: Channel discipline contract

## Purpose

Prevent stream-channel drift that can silently break piping and automation.

## Requirements

- **FR-001**: Success-path data output for representative commands is asserted on stdout with empty stderr.
- **FR-002**: Success-path `--help` and `--version` are asserted on stdout with empty stderr.
- **FR-003**: Representative argument-layer failures are asserted with empty stdout and non-empty, exact stderr.
- **FR-004**: Representative runtime failures are asserted with empty stdout and non-empty, exact stderr.
- **FR-005**: Representative `--allow-invalid` success path preserves stdout/stderr discipline (stdout data, empty stderr).
- **FR-006**: No intentional runtime behavior changes in `src/main.rs` or `src/lib.rs`.

## Out of scope

- Reworking message wording already covered by prior contract slices
- Channel contracts for other binaries
