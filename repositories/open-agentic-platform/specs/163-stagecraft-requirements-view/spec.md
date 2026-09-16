---
id: "163-statecraft-requirements-view"
slug: statecraft-requirements-view
title: "Spec-spine Requirements view in statecraft"
status: approved
implementation: complete
owner: bart
created: "2026-05-22"
kind: platform
domain: platform
risk: medium
depends_on:
  - "087-unified-workspace-architecture"  # unified-workspace-architecture (statecraft project surface)
  - "103-init-protocol-governed-reads"  # init-protocol-governed-reads (registry-consumer is the read surface)
  - "130-spec-coupling-primary-owner"  # spec-coupling-primary-owner (relationship graph projection)
  - "147-spec-kind-grammar"  # spec-kind-grammar (kind / shape / category dimensions for filtering)
  - "152-path-co-authority"  # path-co-authority (section anchors)
  - "154-logical-unit-ownership-grammar"  # logical-unit-ownership-grammar (the unit grammar the view renders)
  - "156-references-edge-provenance-grammar"  # references-edge-provenance-grammar (the provenance badges)
  - "161-knowledge-requirements-provenance-emission"  # knowledge-requirements-provenance-emission (rendering contract)
code_aliases: ["STATECRAFT_REQUIREMENTS_VIEW", "SPEC_SPINE_DASHBOARD"]
amended: "2026-06-18"
amendment_record: |
  amended 2026-06-18 by spec 217 (engine-swap collapse): the spec-registry reader
  this spec establishes (platform/services/statecraft/api/specRegistry/) was
  repointed off the deleted in-tree registry-consumer binary onto the published
  spec-spine CLI. registryReader.ts now invokes `spec-spine registry` with
  `--repo <projectRoot>` (was `--registry-path <file>`) and parses
  `relationships --json` (was a text scrape); resolver.ts checks the by-spec shard
  directory (was registry.json). The Requirements view contract and rendering are
  unchanged; only the underlying read mechanism moved to the library seam.
establishes:
  - unit: { kind: directory, path: platform/services/statecraft/api/specRegistry }
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/spec-registry-api.server.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/spec-registry-grouping.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/spec-registry-grouping.test.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId.requirements.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId.requirements.$specId.tsx }
extends:
  - spec: "087-unified-workspace-architecture"
    nature: additive
    unit: { kind: directory, path: platform/services/statecraft/web/app/routes }
  - spec: "087-unified-workspace-architecture"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/routes.ts }
  - spec: "087-unified-workspace-architecture"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/db/schema.ts }
references:
  - role: decomposition-source
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md }
  - role: aide-analogue
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-blueprint-spec.md }
  - role: governed-read-discipline
    unit: { kind: file, path: specs/103-init-protocol-governed-reads/spec.md }
  - role: pair-spec
    unit: { kind: file, path: specs/164-statecraft-development-lifecycle-board/spec.md }
summary: >
  The net-new `app.project.$projectId.requirements.tsx`
  route. Renders the spec-spine of the project — the
  authored specs that live under `<project>/specs/`
  inside the project repo — as the primary
  stakeholder-visible artifact of OAP's "spec-spine as
  universal representation" thesis (intent doc §2.4).

  Grouping is *derived*: the view walks the relationship
  graph at render time, filtering on `category:` /
  `kind:` / `references:` per spec 130 and spec 147,
  surfacing optional cosmetic group names as decoration
  on the derived groups. There is no `groups.yaml`
  config and no new spec-spine field — everything
  needed is already in authored frontmatter.

  The view surfaces provenance badges per spec 161 for
  any spec derived from Knowledge or xray fingerprints,
  closing the AIDE-VELOCITY "SharePoint document ↔
  requirements.md by operational convention" loop with
  a typed link.

  Spec 163 covers the **rendering** of the spec-spine
  inside statecraft. Editing, approval, and lifecycle
  state transitions are covered by spec 164
  (Development view) and a future review/approve spec;
  spec 163 is read-shaped and is the stakeholder lens
  on project intent.
---

# 163 — Spec-spine Requirements view in statecraft

## 1. Problem

Statecraft's project surface today (per the route inventory at
`platform/services/statecraft/web/app/routes/`) carries Dashboard,
Knowledge, Pipelines, Deploys, Agents, and Settings menus. It does
*not* render the spec-spine. The spec spine is the project's
authored intent — the artifact AIDE-VELOCITY approximates with
SharePoint folders + `requirements.md` + the velocity board's
chess-clock module status.

The intent doc §3.2 declares the menu structure that closes the gap:

```
/app/project/:id
├── Dashboard          (existing _index, refined)
├── Knowledge          (existing — AIDE SharePoint analogue)
├── Requirements       (NEW — spec-spine rendered)
├── Development        (RENAME of pipelines — lifecycle-state board)
├── Deploys            (existing — scope-gated deployment)
├── Agents             (existing — per-project agent catalogue)
└── Settings           (existing — full hierarchy)
```

The *Requirements* menu is the load-bearing addition. Without it:

- Stakeholders cannot read the project's intent without checking
  out the project repo and reading `specs/NNN-*/spec.md` files by
  hand.
- The Knowledge → Requirements lineage that spec 161 specifies
  remains invisible — no surface renders the provenance badges.
- The relationship-graph projection (spec 130 §"Authority as a
  derived property") has no UI; "who establishes path P?" can
  only be answered via `registry-consumer by-authority`.
- The "spec-spine as universal representation" thesis (intent doc
  §2.4) is a statement about authoring discipline with no
  consumer surface beyond CLI tools.

The gap is concrete and specific to statecraft: OPC has dashboards
(governance, inspect, portfolio); statecraft has none for the
spec-spine itself. A project-level reader cannot see the project's
specs anywhere on the platform.

## 2. Decision

Add `platform/services/statecraft/web/app/routes/app.project.$projectId.requirements.tsx`
as a read-shaped surface over the project's local spec-spine. The
surface composes four layers:

### 2.1 Spec list (the inventory)

Default render is a flat list of specs sorted by id, with each row
showing:

- `id` / `slug`
- `title`
- `status` lifecycle (`draft` / `approved` / `superseded` / etc.)
- `implementation` (per spec 147 grammar)
- `kind` (badge, per spec 147)
- `category` (badge if present)
- Provenance badge (per spec 161) if `role: decomposition-origin`
  references are present.

### 2.2 Derived groups (the relationship-graph projection)

The user can switch from flat list to grouped view. Grouping is
*derived* — there is no `groups.yaml` and no new spec field. The
grouping algorithm walks:

- All specs sharing a `category:` tag form one derived group.
- All specs in a `references:` chain (typed as
  `role: precedent` or `role: pair-spec`) form one cluster.
- All specs related by `establishes:` / `extends:` / `refines:` /
  `supersedes:` / `amends:` / `co_authority:` form clusters via
  the spec 130 relationship-graph traversal.

The user can choose the projection dimension (`by-category`,
`by-establishment-chain`, `by-supersession-chain`). The view
exposes the same edges `registry-consumer show-relationships`
exposes, but as a navigable surface.

### 2.3 Custom cosmetic group names

A project owner may attach a custom display name to a derived
group — pure presentation metadata. The custom name has *no*
semantic effect on the spec-spine: it does not change ownership,
authority, or any gate behaviour. It is a label shown to
stakeholders. The custom names live in statecraft's database
(per-project, per-derived-group-identity), not in spec
frontmatter.

### 2.4 Spec detail (single-spec view)

Clicking a spec row opens a detail view that renders the spec's
frontmatter (kind, status, relationships) and a rendered markdown
body. The detail view also surfaces:

- Outgoing relationships (what this spec establishes / extends /
  refines / etc).
- Incoming relationships (which specs cite this one).
- Provenance badges (per spec 161) with clickable resolution to
  the Knowledge item or xray fingerprint snapshot.

## 3. Read-shaped — write surfaces are separate

Spec 163 is **read-shaped**. The user cannot edit a spec's text
or change its lifecycle from this view. The intent doc §3.3 names
review / edit / approval flows but those are owned by:

- **Editing** — direct file edits in the project repo (the
  authoring surface remains git + markdown per the constitution).
- **Lifecycle state transitions** — owned by the Development view
  (spec 164), which presents specs as cards on a lifecycle board
  and exposes transition actions.
- **Approve / reject** — a future spec authoring the
  review-and-approve flow.

Spec 163 strictly renders the current state. This separation keeps
the Requirements view aligned with the constitution's "human
durable truth: markdown files" principle — editing happens at the
authoring layer, not through a statecraft UI.

## 4. Functional Requirements

- **FR-001** A new Remix route at
  `platform/services/statecraft/web/app/routes/app.project.$projectId.requirements.tsx`
  loads the project's spec-spine and renders the inventory
  (§2.1).
- **FR-002** The spec-spine read uses the governed-read
  discipline (spec 103): registry-consumer is the source of
  truth. The route invokes registry-consumer through a typed
  Encore.ts API surface (`platform/services/statecraft/api/...`)
  rather than parsing `.derived/spec-registry/registry.json`
  directly.
- **FR-003** The user can switch between flat list and grouped
  view; the grouped view supports `by-category`,
  `by-establishment-chain`, and `by-supersession-chain`
  projections.
- **FR-004** A project owner can attach a cosmetic display name
  to any derived group. Custom names are persisted in statecraft
  (project-scoped) and rendered as the group's label. Custom
  names have no spec-spine semantic effect.
- **FR-005** Specs with `references:` entries of
  `role: decomposition-origin` (per spec 161) render with a
  provenance badge linking to the originating Knowledge item or
  xray fingerprint snapshot.
- **FR-006** The single-spec detail view renders the markdown
  body plus outgoing and incoming relationship lists.
- **FR-007** The view degrades gracefully when the project's
  spec-spine is empty (e.g., a newly-imported project that has
  not yet run through the decomposition pipeline). The empty
  state offers an explicit "Run decomposition" call-to-action
  pointing at the OPC integration spec 165 covers.
- **FR-008** The view is purely read-shaped: no UI affordance
  triggers a spec edit, lifecycle transition, or approve action.
  Those actions live elsewhere (§3).

## 5. Success Criteria

- **SC-001** Opening `/app/project/<uuid>/requirements` for any
  project with a populated spec-spine displays the inventory
  with non-empty rows.
- **SC-002** Switching to `by-category` grouping clusters specs
  sharing the same `category:` tag and shows category labels.
- **SC-003** Switching to `by-supersession-chain` clusters specs
  related by `supersedes:` edges and renders the chain
  visually.
- **SC-004** A spec carrying a `role: decomposition-origin`
  provenance entry renders the badge; clicking the badge
  navigates to the corresponding Knowledge item.
- **SC-005** A newly-imported project with no specs displays the
  empty-state CTA pointing at the decomposition pipeline.

## 6. Scope

### In scope

- The Remix route file and its API helpers.
- The inventory render, grouping, and custom-name UI.
- The spec detail view (markdown rendering + relationship lists).
- Provenance badge rendering per spec 161.
- Governed-read integration via registry-consumer.

### Out of scope (deferred)

- **Editing specs.** The authoring layer remains git + markdown.
- **Lifecycle state transitions.** Owned by spec 164 (Development
  view).
- **Review / approve flow.** Future spec.
- **Cross-project spec navigation.** Spec 163 is project-scoped.
  Cross-project views (portfolio-level spec aggregation) are
  owned by future portfolio specs.
- **Spec-search.** A free-text search across spec bodies is a
  follow-up; spec 163 supports filter-by-frontmatter dimensions
  only.

## 7. Reading from the project's spec-spine — born-with vs imported

For projects produced by the substrate (per spec 167 — born-with
kernel), the project's `.derived/spec-registry/registry.json` is
generated by the project's own spec-compiler invocation. Spec 163
reads from there.

For projects imported via statecraft's existing
`api/projects/import.ts` path that have not yet run through the
decomposition pipeline (spec 165), the registry may be empty. The
empty-state CTA in FR-007 covers this case.

For projects retrofitted with the spec-spine (the
agent-builder-console pattern per intent doc §6.5), the registry
is populated by the decomposition pipeline's output. Same read
path; the only difference is the `origin: retroactive: true`
marker on the synthesised specs.

## 8. Cross-references

- **INTENT doc** §3.2, §3.3, §3.4.
- **Spec 161** — provenance emission / rendering contract; this
  spec is the rendering consumer.
- **Spec 164** — Development view; the lifecycle-state board
  paired with this Requirements view.
- **Spec 165** — OPC decomposition pipeline; produces the specs
  this view renders.
- **Spec 103** — governed-artifact-reads; the read discipline
  this view honours.
- **Spec 130** — relationship graph; the grouping projection
  source.
- **Spec 147** — kind grammar; the filter dimensions.
- **AIDE-VELOCITY-blueprint-spec.md** — the analogue surface
  (`ProjectDetailView` + SharePoint folder + `requirements.md`)
  this view structurally replaces.
