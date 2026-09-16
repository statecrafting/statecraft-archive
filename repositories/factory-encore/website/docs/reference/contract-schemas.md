# Contract schemas

The contract layer defines five formal schemas that govern the boundary between the process and adapter layers. These schemas are an open standard; their canonical home is the [Open Agentic Platform](https://github.com/stagecraft-ing/open-agentic-platform) repository. This repository mirrors specific versions so the process and any adapter can be developed against a stable interface.

## Version pins

| Schema | Version | File |
|--------|---------|------|
| Build Specification | 1.1.0 | `contract/schemas/build-spec.schema.yaml` |
| Adapter Manifest | 1.1.0 | `contract/schemas/adapter-manifest.schema.yaml` |
| Verification Contract | 1.0.0 | `contract/schemas/verification.schema.yaml` |
| Pipeline State | 1.0.0 | `contract/schemas/pipeline-state.schema.yaml` |
| Governance Envelope | 1.0.0 | `contract/schemas/governance-envelope.schema.yaml` |

The schemas are mirrored, not forked. Do not edit them locally; mirror the canonical version from OAP.

## Build Specification (`build-spec.schema.yaml`)

The factory's primary output. It captures what an application needs in technology-neutral terms:

- **Project**: identity, description, classification.
- **Auth**: per-audience authentication requirements, provisioning models, service-to-service policies, session configuration.
- **Data model**: entities, attributes, relationships, constraints.
- **Business rules**: validation, authorization, and domain logic as predicates.
- **API**: operations (CRUD and custom), inputs, outputs, authorization, stack assignments.
- **UI**: pages, page types, view types, audience assignments, navigation.
- **Integrations, notifications, audit, security, health checks, error handling, file storage, traceability.**

The Build Specification is frozen at Stage 5 and consumed by the adapter at Stage 6.

## Adapter Manifest (`adapter-manifest.schema.yaml`)

What an adapter declares about itself:

- **Identity**: name, display name, version, description.
- **Stack**: language, runtime, backend framework, frontend framework, database support.
- **Capabilities**: dual-stack support, auth methods, module system, file uploads, background jobs, etc.
- **Commands**: install, compile, test, lint, dev, format check, type check, feature verify.
- **Directory conventions**: where API services, controllers, models, views, stores, migrations, and tests live.
- **Patterns**: locations of code-generation patterns for API, UI, data, and page types.
- **Agents**: the focused code-generation agents the scaffolding orchestrator invokes.
- **Scaffold**: source repository, entry point, profiles, setup commands, emitted paths.
- **Governance sub-envelope** (1.1.0): max tier, file write scope, denied paths, allowed commands, scaffold execution constraints.
- **Validation invariants**: grep-absent and command-succeeds checks with severity levels.

## Verification Contract (`verification.schema.yaml`)

Defines what must pass at each pipeline gate. Separates factory-owned checks (cross-stage consistency, spec completeness) from adapter-owned checks (compile, test, lint, architecture invariants). The verification harness reads this contract and executes checks automatically.

Sections include pre-flight checks, per-stage gates, scaffolding gates, and final validation.

## Pipeline State (`pipeline-state.schema.yaml`)

Durable execution state written to disk after every successful step. Enables crash recovery: read state, skip completed work, continue from the last checkpoint.

Written to `{project-root}/.factory/pipeline-state.json`, it records:

- Pipeline identity (UUID, factory version, timestamps, status).
- Adapter binding.
- Per-stage progress and verification results.
- Scaffolding status per feature.
- An audit trail.

## Governance Envelope (`governance-envelope.schema.yaml`)

The admission contract a factory files for OAP to admit it. It declares obligations that hold (predicates), never pipeline topology:

- **Objective class**: what the factory does.
- **Ceilings**: maximum safety tier and mutation level across all agents.
- **Gate predicates**: human-in-the-loop guarantees.
- **Emitted artifact kinds**: what the pipeline produces.

OAP validates the envelope two ways: schema conformance, and independent recomputation of the aggregate from agent frontmatter to confirm the declared ceilings bound it.

## Stage-output schemas

In addition to the five primary schemas, the contract includes stage-output schemas under `contract/schemas/stage-outputs/`:

| Schema | Stage | Content |
|--------|-------|---------|
| `audiences.schema.json` | 2 | Audience definitions with provisioning models. |
| `business-rules.schema.json` | 1 | Business rules extracted from source documents. |
| `entity-model.schema.json` | 3 | Entity-relationship model. |
| `sitemap.schema.json` | 2 | Page structure and navigation. |
| `use-cases.schema.json` | 1 | Use cases derived from business requirements. |

## Worked examples

The `contract/examples/` directory contains a complete worked example for an event-registration portal, including a full Build Specification and stage-output examples that demonstrate the schema in practice.
