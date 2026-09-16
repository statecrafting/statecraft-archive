# Implementation Plan: Bootstrap spec system

**Branch**: `000-bootstrap-spec-system` | **Date**: 2026-03-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/000-bootstrap-spec-system/spec.md`

## Summary

Establish the **spec compiler** scaffolding that reads authoritative feature markdown under `specs/` and emits **`.derived/spec-registry/registry.json`** (deterministic) plus **`.derived/spec-registry/build-meta.json`** (ephemeral wall-clock metadata). No product runtime (axiomregent, xray, featuregraph servers) is implemented in this feature; those components will **consume** `registry.json` in later features.

## Technical Context

**Language/Version**: To be selected in implementation; default candidate **Rust** or **Go** for deterministic CLI tooling (NEEDS confirmation in `research.md` — pick one before coding).

**Primary Dependencies**: JSON Schema validation library for the chosen language; markdown + YAML frontmatter parser; SHA-256 for `contentHash`.

**Storage**: File-system inputs only; output `registry.json` + `build-meta.json` under `.derived/spec-registry/`. No database in MVP.

**Testing**: Golden-fixture tests asserting byte-identical JSON output; schema validation of emitted JSON; policy tests for forbidden YAML paths.

**Target Platform**: macOS/Linux developer machines and CI (alignment with primary dev environment).

**Project Type**: CLI library + binary (`spec-compiler` or similar name — fixed in implementation tasks).

**Performance Goals**: Compile full `specs/` tree in under 5 seconds on a typical laptop for fewer than 200 feature folders (order-of-magnitude guardrail).

**Constraints**: No hand-edited machine JSON; no standalone authored YAML; determinism across runs.

**Scale/Scope**: Single repo; MVP registry fields only as per `data-model.md` and `contracts/registry.schema.json`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status |
|-----------|--------|
| Authored truth in markdown only | Pass — see spec FR-002 |
| Machine truth compiler JSON only | Pass — see spec FR-002 |
| No standalone authored YAML | Pass — V-004 |
| Determinism | Pass — spec “Deterministic compiler expectations” |

No violations requiring complexity tracking.

## Project Structure

### Documentation (this feature)

```text
specs/000-bootstrap-spec-system/
├── plan.md                 # This file
├── research.md             # Phase 0 decisions
├── data-model.md           # Registry entities
├── spec.md                 # Constitutional bootstrap spec
├── tasks.md                # Implementation tasks
├── quickstart.md           # How to run compiler / validate
├── clarify.md              # Clarification handoff note
├── contracts/
│   ├── registry.schema.json
│   └── build-meta.schema.json
└── checklists/
    └── requirements.md
```

### Source Code (repository root) — planned, not implemented in this PR unless tasks execute

```text
tools/spec-spine/spec-compiler/        # Or packages/spec-compiler — fixed in tasks
├── src/
└── tests/fixtures/

.derived/spec-registry/        # Gitignored compiler output (generated)
└── registry.json
```

**Structure Decision**: Place the compiler under `tools/spec-spine/spec-compiler/` unless a workspace-wide package convention is introduced later; Feature 000 only **reserves** the path in this plan.

## Complexity Tracking

None.
