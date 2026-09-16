# Tasks: List/show JSON contract tests

**Input**: `/specs/018-registry-consumer-list-show-json-contract-mvp/`  
**Prerequisites**: List/show JSON and compact modes (**012**–**015**) and shared serialization helper (**017**); mirrors **010** for status-report.

**Feature status**: **Complete** — fixture contract tests for `list`/`show` JSON and compact, README note, and verification artifact.

## Phase 1: Spec artifacts

- [x] T001 Add `spec.md`, `plan.md`, `tasks.md`
- [x] T002 Add `execution/changeset.md`

## Phase 2: Tests and docs

- [x] T003 Add fixture-based JSON contract tests (`list --json`, `show --json`)
- [x] T004 Add fixture-based compact contract tests (`list --compact`, `show --compact`)
- [x] T005 Update README to note automation contracts for list/show

## Phase 3: Verification

- [x] T006 Run verification command path
- [x] T007 Add `execution/verification.md`
