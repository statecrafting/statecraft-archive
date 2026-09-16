# Stage 05: UI Specification

**Sequence:** 5
**Agent:** ui-architect
**Mutation:** read-only (completes and freezes the Build Specification)

## Purpose

Specify every page, bind each to its data sources, define navigation, and close
the traceability loop. When this stage passes, the Build Specification is frozen
and handed to the adapter.

## Inputs

- `.factory/build-spec.yaml` (the `api` section from Stage 4)
- `requirements/sitemap.json`, `requirements/audiences.json`,
  `requirements/journeys/*.json` (Stage 2)

## Outputs

- `.factory/build-spec.yaml`, completed: the `ui` section plus the
  `integrations`, `notifications`, `audit`, and `traceability` sections. Each
  page carries an id, title, path, page type, audience, view type, auth
  requirements, data sources (each naming an operation id), navigation
  placement, and the use cases and test cases it covers.

The orchestrator walks the sitemap in small batches (a few pages at a time) and
runs the per-batch checks below as it goes, rather than producing all pages and
validating once.

## Gates

The Stage 5 gate freezes the Build Specification:

- `S5-001` Every sitemap page has a corresponding Build Spec page.
- `S5-002` Every page `data_source` names an operation id that exists in the
  `api` section.
- `S5-003` No page binds a data source whose stack conflicts with the page's
  audience.
- `S5-004` Every use case is referenced by at least one page.
- `S5-005` Every page carries a test-case reference.
- `S5-006` Navigation covers every page that declares a navigation section
  exactly once.

## Notes

After the gate passes, the Build Specification is immutable for the run. Any
later change requires a new pipeline run, which preserves the frozen artifact for
audit.
