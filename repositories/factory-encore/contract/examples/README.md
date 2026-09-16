# Contract examples

Worked, conformant examples of the contract schemas, all in one neutral domain:
a conference **event-registration portal**. They are illustration only and are
not tied to any real organization.

## Files

- `event-registration.build-spec.yaml` is a complete Build Specification
  (`schema_version` 1.1.0) for a `dual` deployment: a public attendee surface
  and an internal organizer admin surface. It exercises most sections of
  `contract/schemas/build-spec.schema.yaml`: project, auth (two audiences with
  different `provisioning_model` values), data model, business rules, API, UI,
  integrations, notifications, audit, security, health checks, error handling,
  and traceability.

- `stage-outputs/` holds the intermediate artifacts a pipeline produces on the
  way to that Build Spec, each conformant to its schema under
  `contract/schemas/stage-outputs/`:
  - `entity-model.json` and `use-cases.json` and `business-rules.json` are
    Stage 1 (business requirements) outputs.
  - `audiences.json` and `sitemap.json` are Stage 2 (service requirements)
    outputs. The sitemap's `variant` is `dual`, derived from its pages'
    `view_type` values.

## How they line up

The same identifiers thread through every file, which is what the verification
layer checks for cross-stage consistency:

- Entities (`Event`, `Session`, `Attendee`, `Registration`) appear in
  `entity-model.json` and in the Build Spec `data_model`.
- Business rules (`BR-001` through `BR-004`) are defined once in
  `business-rules.json` and referenced from entities, operations, and use cases.
- Use cases (`UC-001`, `UC-002`, `UC-004`, `UC-005`) are defined in
  `use-cases.json` and referenced from API operations and UI pages.
- Page `data_sources` name API operation IDs (`list-events`,
  `create-registration`, `decide-registration`, and so on) that exist in the
  Build Spec `api` section.
