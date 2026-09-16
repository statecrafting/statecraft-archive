# Process stages

The process layer runs as an ordered pipeline of seven stages plus one optional stage. Each stage has defined inputs, outputs, and a mechanical exit gate.

## Stage-by-stage reference

| Stage | Name | Agent | Inputs | Outputs | Gate |
|-------|------|-------|--------|---------|------|
| 00 | Pre-flight | Pipeline Orchestrator | Business documents, adapter manifest | `.factory/pipeline-state.json`, `.factory/adapter-manifest.yaml` | Manifest conformance, referenced agents/patterns exist, business artifacts readable, pipeline state conformant. |
| 01 | Business Requirements | Business Requirements Analyst | Source business documents | Entities, use cases, business rules (stage-output schemas) | Stage-output artifacts present and schema-conformant. |
| 02 | Service Requirements | Service Designer | Stage 1 outputs, business documents | `service-description.json`, `audiences.json`, journey maps, `future-state.json`, `sitemap.json`, `variant.json` | Phase B-to-C filesystem gate (journeys directory walked), capability validation against adapter. |
| 03 | Data Model | Data Architect | Stage 2 outputs, entities | Entity-relationship model, data model specification | Entity model schema-conformant, relationships consistent. |
| 04 | API Specification | API Architect | Stages 2-3 outputs | API operations, endpoint specifications | Operations cover all entities and use cases. |
| 05 | UI Specification | UI Architect | Stages 2-4 outputs | Page specifications, navigation; **Build Specification frozen** | Build Specification schema-conformant, human approval gate. |
| 06 | Adapter Handoff | Scaffolding Orchestrator | Frozen Build Specification, bound adapter manifest | Scaffolded application (per-feature, verified) | Per-feature compile/test/lint, final validation including traceability and placeholder checks. |
| CD | Client Documentation | Client Documentation Orchestrator | Stages 1-2 outputs | Client-facing summary, charter, optional slide deck | Artifacts present under `requirements/client/`. Never blocks the build. |

## Pre-flight (Stage 00)

Pre-flight proves a run is startable before any analysis begins. It:

- Binds the run to an adapter by snapshotting the adapter manifest.
- Initializes `.factory/pipeline-state.json`.
- Validates that all referenced agents and patterns exist.
- Confirms business artifacts are readable.

Pre-flight does **not** perform capability matching (variant and auth are unknown until Stage 2).

## Service Requirements (Stage 02)

Stage 02 is the richest stage, running in three phases with a hard filesystem gate between Phase B and Phase C:

- **Phase A**: emits `service-description.json` and `audiences.json` with explicit `provisioning_model` per audience.
- **Phase B**: writes one journey map per audience under `requirements/journeys/`.
- **Phase B-to-C gate**: walks the journeys directory to confirm maps exist for every declared audience.
- **Phase C**: emits `future-state.json`, `sitemap.json`, and derived `variant.json`.

After Phase C, capability validation checks `dual_stack` and `supported_auth` against the adapter manifest.

## Adapter Handoff (Stage 06)

The scaffolding orchestrator never writes application code itself. It sequences adapter agents against the frozen Build Specification:

1. Initialize the scaffold from the adapter's source.
2. Per-entity data scaffolding (migrations, models).
3. Per-operation API scaffolding (services, endpoints, tests).
4. Per-page UI scaffolding (views, stores, routes, tests).
5. Configure (cross-cutting concerns).
6. Trim (remove scaffolding artifacts, clean up).
7. Final validation (compile, test, lint, traceability, placeholder checks).

Each feature is scaffolded, verified, and retried individually. Progress is written to pipeline state after each successful feature.

## Client Documentation (Stage CD)

The optional client-documentation stage runs off the critical path and never blocks the seven-stage build. It is the only process agent with `scoped-write` mutation (scope: `requirements/client/**`). It consumes Stage 1 and 2 outputs and produces client-facing documentation.
