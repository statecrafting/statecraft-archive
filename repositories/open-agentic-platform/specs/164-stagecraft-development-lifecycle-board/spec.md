---
id: "164-statecraft-development-lifecycle-board"
slug: statecraft-development-lifecycle-board
title: "Pipelines → Development rename, lifecycle-state board over spec-spine states"
status: approved
implementation: complete
owner: bart
created: "2026-05-22"
kind: platform
domain: platform
risk: medium
depends_on:
  - "075-factory-workflow-engine"  # factory-workflow-engine (pipeline runs surfaced as execution evidence)
  - "077-statecraft-factory-api"  # statecraft-factory-api (the existing pipelines surface)
  - "102-governed-excellence"  # governed-excellence (certificate emissions surfaced on cards)
  - "127-spec-code-coupling-gate"  # spec-code-coupling-gate (gate fires surfaced as execution evidence)
  - "133-amends-aware-coupling-gate"  # amends-aware coupling gate
  - "147-spec-kind-grammar"  # spec-kind-grammar (lifecycle / status fields)
  - "163-statecraft-requirements-view"  # statecraft-requirements-view (the read-shaped pair)
code_aliases: ["STATECRAFT_DEVELOPMENT_BOARD", "LIFECYCLE_STATE_BOARD"]
establishes:
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId.development.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/spec-registry-board.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/spec-registry-board.test.ts }
extends:
  - spec: "087-unified-workspace-architecture"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/routes.ts }
  - spec: "087-unified-workspace-architecture"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId.tsx }
  - spec: "087-unified-workspace-architecture"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId._index.tsx }
  - spec: "163-statecraft-requirements-view"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/specRegistry/types.ts }
  - spec: "163-statecraft-requirements-view"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/specRegistry/registryReader.ts }
  - spec: "163-statecraft-requirements-view"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/lib/spec-registry-grouping.test.ts }
refines:
  - aspect: project-lifecycle-board
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId.development.tsx }
  - aspect: pipelines-redirect-to-development
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId.pipelines.tsx }
references:
  - role: decomposition-source
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md }
  - role: aide-analogue
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-blueprint-spec.md }
  - role: precedent-route
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId.pipelines.tsx }
  - role: pair-spec
    unit: { kind: file, path: specs/163-statecraft-requirements-view/spec.md }
summary: >
  Rename the existing
  `app.project.$projectId.pipelines.tsx` route to
  `app.project.$projectId.development.tsx`, replace its
  backing model (today: factory-engine pipeline activity)
  with a **lifecycle-state board** whose columns are
  spec-spine lifecycle states from spec 147 grammar:
  `draft → approved → implementation:pending →
  implementation:in-progress → implementation:complete`,
  with separate visual lanes for `superseded` and
  `amended`.

  Cards on the board are individual specs (or grouped
  clusters when grouping is active from spec 163's
  projection). Governance-certificate emissions
  (spec 102), factory run completions (spec 075), and
  coupling-gate fires (spec 127/133) overlay as
  *execution evidence* on the cards — visualising the
  link between authored intent (spec lifecycle) and
  realised execution (run history).

  This is the **honest** AIDE-VelocityView analogue. It
  surfaces the same lifecycle visibility AIDE provides
  via its 8 chess-clock steps, without imposing AIDE's
  "all features go through exactly these 8 states in
  this order or stall" rigidity. The intent doc §5.4
  explicitly rejects the chess-clock primitives;
  spec 164 is the structural alternative.
---

# 164 — Pipelines → Development rename + lifecycle-state board

## 1. Problem

`platform/services/statecraft/web/app/routes/app.project.$projectId.pipelines.tsx`
exists today and renders factory-engine pipeline activity at the
project level. The name and the framing are both wrong for the
work the route should carry:

1. **"Pipelines" is implementation-tier language.** The page is
   read by stakeholders looking at *project development progress*,
   not by operators reading pipeline mechanics. AIDE-VELOCITY's
   `VelocityView` succeeds at this level — it shows project
   progress in stakeholder-legible terms (the 8-step chess clock).
2. **Pipeline activity is execution-evidence, not the primary
   model.** The intent doc §3.3 names the primary model:
   *"columns are spec lifecycle states; cards are individual specs
   (or grouped clusters when grouping is active); governance-
   certificate emission and factory-engine activity are overlaid as
   execution evidence."* The current page inverts the relationship.
3. **AIDE's chess-clock 8-step machine is not the right answer
   either.** The intent doc §5.4 explicitly rejects porting the
   chess-clock grammar ("requirements → planning → architecture →
   prototyping → development → user_testing → user_acceptance →
   deployment"), `current_actor ∈ {ai, human}` turn tracking,
   `velocity_turn` ledger, and the gamification surface
   (leaderboards, Reaper, `cheating_violation`). OAP's substitute
   is the spec-spine's own lifecycle grammar (per spec 147), which
   is iterative-by-default rather than feature-complete-or-halt.

The right answer is a lifecycle-state board whose columns are
spec lifecycle states and whose cards are specs (or clusters of
specs). Execution evidence — factory runs, certificate
emissions, gate fires — overlays on the cards.

## 2. Decision

Rename the route. Replace the backing model.

### 2.1 Rename

`app.project.$projectId.pipelines.tsx` →
`app.project.$projectId.development.tsx`. The route id moves; the
URL changes; internal links in statecraft (navigation, breadcrumbs,
deep links) are updated.

A redirect from `/app/project/<uuid>/pipelines` to
`/app/project/<uuid>/development` is honored for one release cycle,
then removed. External agents bookmarking `pipelines` get a
permanent redirect; internal links are migrated.

### 2.2 The lifecycle-state board

Columns (left to right), per spec 147 grammar:

1. **`draft`** — specs captured but not yet approved.
2. **`approved`** — specs accepted as intent.
3. **`implementation: pending`** — approved, work not yet
   started.
4. **`implementation: in-progress`** — actively being implemented.
5. **`implementation: complete`** — implemented and merged.

Separate visual lanes (below the main columns, or as filter
toggles):

- **`superseded`** — specs replaced by a direction-change
  successor (`supersedes:` edge). Rendered with `superseded_by:`
  link.
- **`amended`** — specs patched without supersession
  (`amends:` edge from a successor).

### 2.3 Cards

Default: one card per spec, showing id / title / kind / status /
provenance badges (per spec 161).

When grouping is active (chosen from the Requirements view's
projection — `by-category`, `by-establishment-chain`,
`by-supersession-chain`), cards represent clusters: each cluster
card shows the dominant lifecycle state of its member specs and
exposes a drilldown.

### 2.4 Execution evidence overlay

On each card, optional badges/sparklines surface execution
evidence:

- **Factory run badges** — most recent run id + status (per
  spec 075). Clicking the badge opens the run detail.
- **Governance certificate badge** — most recent certificate
  emission (per spec 102) for the spec's code path. Clicking
  opens the certificate verifier view.
- **Gate fire indicators** — coupling-gate fires (per spec 127 /
  133) attributed to the spec's authored paths. Hover shows the
  gate's diagnostic; clicking opens the PR / commit that
  triggered it.

Execution evidence is *informational overlay* — it does not
mutate spec state, does not trigger transitions. The lifecycle
column placement is driven entirely by the spec's frontmatter
(`status:` + `implementation:`).

## 3. Functional Requirements

- **FR-001** The route at
  `platform/services/statecraft/web/app/routes/app.project.$projectId.pipelines.tsx`
  is renamed to
  `app.project.$projectId.development.tsx`. Project-level
  navigation links are updated to "Development".
- **FR-002** A redirect from
  `/app/project/<uuid>/pipelines` to
  `/app/project/<uuid>/development` is in place for one release
  cycle from landing.
- **FR-003** The board's columns are
  `draft → approved → implementation:pending →
  implementation:in-progress → implementation:complete`, in this
  fixed left-to-right order.
- **FR-004** `superseded` and `amended` specs render in
  dedicated lanes/views distinct from the main columns. They
  are accessible from the same route, not hidden.
- **FR-005** Cards default to one-per-spec; when the user has
  active grouping (chosen in the Requirements view per spec
  163's projection), cards represent clusters with dominant-state
  placement.
- **FR-006** Each card surfaces execution evidence overlays:
  factory run badge (latest run id + status), governance
  certificate badge (latest emission), and coupling-gate fire
  indicators. Overlays are read-only and link to the underlying
  artifacts.
- **FR-007** The board is read-shaped: cards are not
  drag-droppable across columns. Lifecycle transitions happen
  by spec frontmatter edits in the project repo, not by UI
  drag.
- **FR-008** Filters: by `kind:` (per spec 147), by `category:`,
  by `risk:`, by `owner:`, by execution-evidence presence
  (e.g., "show only specs with a failing gate fire in the last
  N runs").

## 4. Success Criteria

- **SC-001** `/app/project/<uuid>/development` renders the
  five-column board with non-empty cards reflecting the
  project's spec-spine lifecycle distribution.
- **SC-002** A spec moved from `status: draft` to
  `status: approved` in the project repo migrates to the
  `approved` column on the next statecraft refresh of the
  registry data.
- **SC-003** Execution evidence overlays update in real time as
  factory runs complete and governance certificates emit (via
  the existing pipelines event surface, repurposed).
- **SC-004** `/app/project/<uuid>/pipelines` returns a permanent
  redirect to `/app/project/<uuid>/development`.
- **SC-005** No card responds to drag-drop; lifecycle changes
  only flow from spec frontmatter edits.

## 5. Scope

### In scope

- The route rename.
- The lifecycle-state board UI.
- The execution evidence overlay surfaces.
- Filters and read-only navigation.
- The redirect path for the old URL.

### Out of scope (deferred)

- **Editing specs from the board.** Authoring remains git +
  markdown.
- **Lifecycle transition actions in the UI.** Frontmatter edits
  in the project repo remain the only way to change state.
- **Chess-clock semantics.** Explicitly rejected by intent doc
  §5.4; no port of `current_actor`, `velocity_turn`,
  gamification, Reaper, leaderboards, `If-Match` /
  `Idempotency-Key` (the latter two may land as endpoint-level
  primitives where useful, but are not project-lifecycle
  primitives per intent §5.4).
- **AIDE-style "send back" loopback semantics.** OAP's
  refinement model is `amends:` and `refines:` per spec 130; the
  loopback equivalent is "a successor spec amends or refines the
  predecessor," not a "send back" action that mutates the
  predecessor's state.

## 6. Cross-references

- **INTENT doc** §3.2, §3.3, §5.3, §5.4.
- **Spec 163** — Requirements view; the read-shaped pair.
  Grouping choice in 163 controls card-shape in 164.
- **Spec 147** — kind grammar; column / lane mapping derives
  from `status:` + `implementation:`.
- **Spec 075** — factory-workflow-engine; produces the run
  badges.
- **Spec 102** — governed-excellence; produces the certificate
  badges.
- **Spec 127 / 130 / 133** — coupling gates; produce the gate
  fire indicators.
- **AIDE-VELOCITY-blueprint-spec.md** — `VelocityView`
  analogue; structural reference, not implementation model.
- **`app.project.$projectId.pipelines.tsx`** — the existing
  route this spec renames.
