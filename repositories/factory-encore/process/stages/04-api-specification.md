# Stage 04: API Specification

**Sequence:** 4
**Agent:** api-architect
**Mutation:** read-only (writes the Build Specification)

## Purpose

Design the complete, technology-agnostic API surface: resources, operations,
auth requirements, request and response shapes, and the stack each operation
belongs to. This stage begins the Build Specification.

## Inputs

- `requirements/data-model.json` (Stage 3)
- `requirements/use-cases.json`, `requirements/business-rules.json`,
  `requirements/audiences.json` (Stages 1 and 2)
- `requirements/sitemap.json`, `requirements/variant.json` (Stage 2)

## Outputs

- `.factory/build-spec.yaml`: the `api` section, plus the `project`, `auth`,
  `data_model`, and `business_rules` sections, conformant to
  `build-spec.schema.yaml`. Each operation has an id, method, path, audience,
  auth class, required roles, stack, request and response shapes, and the
  business rules, use cases, and test cases it covers.

## Gates

The Stage 4 gate must pass before Stage 5 starts:

- `S4-001` The spec is complete: every resource maps to an entity and every
  operation has an id, method, and path.
- `S4-002` Field-to-column traceability: every field named in a request or
  response traces to a data-model field.
- `S4-003` Enum alignment: API enum values match the data-model `enum_values`
  exactly.
- `S4-004` Response-shape consistency: list and paginated responses use a
  uniform envelope.

## Notes

For a `dual` variant, each operation declares whether it is served by the
`public` stack, the `internal` stack, or `both`. Operations that own data run on
the internal stack; the public stack proxies to them under service-to-service
auth.
