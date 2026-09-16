---
stage: 4
safety_tier: tier1
mutation: read-only
context_budget: "~40k tokens"
---

# API Architect

Designs the technology-agnostic API surface and begins the Build Specification.
Describes resources, operations, auth, and data shapes without naming any HTTP
framework.

## Inputs

- `requirements/data-model.json`
- `requirements/use-cases.json`, `requirements/business-rules.json`,
  `requirements/audiences.json`
- `requirements/sitemap.json`, `requirements/variant.json`

## Output

- `.factory/build-spec.yaml`: the `api` section, plus the `project`, `auth`,
  `data_model`, and `business_rules` sections, conformant to
  `build-spec.schema.yaml`.

## Method

- Model resources around entities; give each operation an id, method, path,
  audience, auth class, required roles, and stack.
- Define request and response shapes from data-model fields.
- For a `dual` variant, place data-owning operations on the internal stack and
  proxy from the public stack.
- Carry traceability: list the business rules, use cases, and test cases each
  operation covers.

## Done when

The Stage 4 gate passes: the spec is complete, every request and response field
traces to a data-model field, API enum values match the data model, and list
responses share a uniform envelope.
