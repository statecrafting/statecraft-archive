# Build Specification

The Build Specification is the central artifact of the factory pipeline. It is the process layer's output and the adapter layer's input: a structured, technology-free document that captures everything an adapter needs to scaffold an application, without naming any framework, language, or file path.

## What it captures

The Build Specification (`build-spec.schema.yaml`) describes an application in technology-neutral terms:

| Section | Content |
|---------|---------|
| `project` | Project identity, description, and classification. |
| `auth` | Authentication requirements per audience, provisioning models, service-to-service policies, and session configuration. |
| `data_model` | Entities, their attributes, relationships, and constraints. |
| `business_rules` | Validation rules, authorization rules, and domain logic expressed as predicates. |
| `api` | Operations (CRUD and custom), their inputs, outputs, authorization, and stack assignments. |
| `ui` | Pages, their page types, view types, audience assignments, and navigation structure. |
| `integrations` | External system connections and their implementation status. |
| `notifications` | Notification channels and triggers. |
| `audit` | Audit logging requirements. |
| `security` | Security policies beyond authentication. |
| `traceability` | Mapping from use cases and test cases back to requirements. |

Every section uses technology-neutral vocabulary. The `api` section names operations and resources, not endpoints or HTTP methods. The `ui` section names pages and page types, not components or routes. Technology-specific decisions are the adapter's responsibility.

## Where it freezes

The Build Specification is progressively built through Stages 1 to 5 and **frozen at Stage 5** (UI Specification). Once frozen, the specification is immutable for the remainder of the run. Stage 6 (Adapter Handoff) reads the frozen specification and scaffolds the application against it.

The freeze point is protected by a human approval gate (declared in the governance envelope as the `approval-before-build-spec-freeze` predicate). No automated process may modify the specification after this gate passes.

## The contract examples

The repository includes a worked example under `contract/examples/`: a complete Build Specification for an event-registration portal that exercises most schema sections, including dual audiences with different provisioning models, multiple entity types, business rules, and both public and internal API operations.

## Relationship to the contract

The Build Specification schema is one of the five contract schemas. Its canonical home is the Open Agentic Platform repository; this repository mirrors version 1.1.0. The schema defines the vocabulary the process may express; adapters consume it without modification.
