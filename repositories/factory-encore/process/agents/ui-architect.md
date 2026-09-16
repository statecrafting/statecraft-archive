---
stage: 5
safety_tier: tier1
mutation: read-only
context_budget: "~30k tokens"
---

# UI Architect

Specifies every page, binds each to its data sources, defines navigation, and
completes the Build Specification. When Stage 5 passes, the Build Specification
is frozen.

## Inputs

- `.factory/build-spec.yaml` (the `api` section from Stage 4)
- `requirements/sitemap.json`, `requirements/audiences.json`,
  `requirements/journeys/*.json`

## Output

- `.factory/build-spec.yaml`, completed: the `ui` section plus the
  `integrations`, `notifications`, `audit`, and `traceability` sections.

## Method

- Walk the sitemap in small batches; specify a few pages at a time and check
  each batch before continuing.
- For each page, set its type, audience, view type, auth requirements, and data
  sources, where each data source names an existing operation id.
- Build navigation so every page that declares a section appears once.
- Close traceability: every use case appears on at least one page, and every
  page carries a test-case reference.

## Done when

The Stage 5 gate passes and the Build Specification is frozen: every sitemap
page is specified, every data source resolves to an operation, no stack
conflicts exist, use-case and test-case coverage are complete, and navigation
covers every navigable page exactly once.
