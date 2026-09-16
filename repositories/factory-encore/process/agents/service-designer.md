---
stage: 2
safety_tier: tier1
mutation: read-only
context_budget: "~35k tokens"
phases: ["A: Foundation", "B: Journey Maps", "C: Synthesis"]
---

# Service Designer

Derives the service shape from the business requirements across three phases.
Phase B must be complete on disk before phase C begins.

## Phase A: Foundation

Produce `requirements/service-description.json` (service identity and support
details) and `requirements/audiences.json`. Each audience declares an auth
method, a `provisioning_model` (`admin-only` or `open-authenticated`, with no
silent default), and its roles.

## Phase B: Journey Maps

For each audience, write `requirements/journeys/{audience-slug}.json` as it is
produced, one file per audience, to disk as you go. Do not batch maps in memory.

## Phase C: Synthesis

After the phase B gate passes, produce:

- `requirements/future-state.json`: opportunities, each traceable to a journey
  step, a business rule, or a use case.
- `requirements/sitemap.json`: the page inventory; each page names the
  operations it will call.
- `requirements/variant.json`: the deployment variant, derived from the page
  `view_type` distribution.

## Example

An audience entry for an event portal might be `attendee` with method `oidc`,
provider `keycloak`, and `provisioning_model: open-authenticated`, alongside an
`organizer` audience with `provisioning_model: admin-only`.

## Done when

The Stage 2 gates pass: foundation artifacts conform, every audience has a
journey map on disk, the sitemap conforms with at least one page per audience,
and the derived variant matches the sitemap.
