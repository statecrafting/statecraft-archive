# Stage 02: Service Requirements

**Sequence:** 2
**Agent:** service-designer
**Mutation:** read-only (writes requirement artifacts)

## Purpose

Derive the shape of the service from the business requirements: who uses it, how
they authenticate, the journeys they follow, the pages they need, and the
resulting deployment variant. This stage runs in three phases with a hard gate
between phase B and phase C.

## Phase A: Foundation

Outputs under `requirements/`:

- `service-description.json`: the service identity and support details.
- `audiences.json`: the audience groups, each with an auth method, a
  `provisioning_model` (`admin-only` or `open-authenticated`, required, no
  silent default), and roles. Conforms to `stage-outputs/audiences.schema.json`.

Gate `S2-001` / `S2-002`: both artifacts conform and audience names are unique.

## Phase B: Journey Maps

For each audience, write `requirements/journeys/{audience-slug}.json` as it is
produced. Maps are written to disk as they are made, not held in memory.

Gate `S2-003` is mechanical: the verification harness walks
`requirements/journeys/` and confirms a file exists for every audience slug in
`audiences.json`. If any are missing, the pipeline halts before phase C. This
gate is checked against the filesystem, not against an agent's claim.

## Phase C: Synthesis

Begins only after the phase B gate passes. Outputs under `requirements/`:

- `future-state.json`: opportunities, each traceable to a journey step, a
  business rule, or a use case.
- `sitemap.json`: the page inventory, conformant to
  `stage-outputs/sitemap.schema.json`. Each page carries an id, path,
  `page_type`, audience, `view_type`, and the operations it will call.
- `variant.json`: the deployment variant (`single-public`, `single-internal`,
  or `dual`) derived mechanically from the distribution of page `view_type`
  values.

Gate `S2-004` / `S2-005`: the sitemap conforms, every audience has at least one
page, and the derived variant matches the sitemap's view types.

## Capability validation

Once the variant is known, check it against the bound adapter (the check that
pre-flight could not run yet):

- If the variant is `dual` but the adapter does not declare `dual_stack`, stop.
- If any audience auth method is not in the adapter's `supported_auth`, stop.

## Notes

Page types come from a fixed catalog (see `sitemap.schema.json`): landing,
dashboard, list, detail, form, content, help, profile, login, error. The
catalog is technology-neutral; an adapter maps each type onto its own
components.
