---
id: "175-statecraft-project-dashboard-observability"
slug: statecraft-project-dashboard-observability
title: "Statecraft project dashboard — observability refinement of `_index`"
status: approved
implementation: complete
owner: bart
created: "2026-05-23"
kind: platform
domain: platform
risk: medium
depends_on:
  - "087-unified-workspace-architecture"  # unified-workspace-architecture (project surface; current _index)
  - "102-governed-excellence"  # governed-excellence (governance certificate surface)
  - "115-knowledge-extraction-pipeline"  # knowledge-extraction-pipeline (extraction-run signals feed the risk banner)
  - "124-opc-factory-run-platform-integration"  # opc-factory-run-platform-integration (factory_runs table feeds runs panel)
  - "127-spec-code-coupling-gate"  # spec-code-coupling-gate (gate-fire signals feed the risk banner)
  - "147-spec-kind-grammar"  # spec-kind-grammar (lifecycle counts use this grammar)
  - "163-statecraft-requirements-view"  # statecraft-requirements-view (reuses specRegistry/registryReader)
  - "164-statecraft-development-lifecycle-board"  # statecraft-development-lifecycle-board (pair surface; supplies lifecycle counts shape)
  - "168-per-project-governance-certificate"  # per-project-governance-certificate (the certificate this view surfaces)
code_aliases: ["STATECRAFT_PROJECT_DASHBOARD", "PROJECT_DETAIL_OBSERVABILITY"]
amended: "2026-06-18"
amendment_record: |
  175 (self): implementation-time `establishes:` and `extends:` fill-in.
  amended 2026-06-18 by spec 217 (engine-swap collapse): projectDashboard/dashboard.ts
  was updated to pass the project root to spec 163's spec-registry reader after the
  reader's API moved from `--registry-path <file>` to `--repo <projectRoot>` in the
  engine swap. The dashboard's observability contract is unchanged; only the
  reader-call argument shape moved.
establishes:
  - unit: { kind: file, path: platform/services/statecraft/api/projectDashboard/encore.service.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/projectDashboard/dashboard.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/projectDashboard/dashboardHelpers.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/projectDashboard/dashboard.test.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/projectDashboard/riskAssessor.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/projectDashboard/riskAssessor.test.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/projectDashboard/types.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/project-dashboard-api.server.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/components/ProjectDashboardLifecycle.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/components/ProjectDashboardCertificate.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/components/ProjectDashboardRuns.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/components/ProjectDashboardRiskBanner.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/components/ProjectDashboardAudit.tsx }
refines:
  - aspect: project-dashboard-landing-surface
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId._index.tsx }
extends:
  - spec: "163-statecraft-requirements-view"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/audit/audit.ts }
  # Lifecycle-flip golden refresh: 175's lifecycle state is snapshotted in
  # the featuregraph golden, so flipping draft→approved + pending→complete
  # shifts the golden fingerprint. The additive edge declares that true
  # relationship per the established convention (precedent: specs
  # 165/167/168/169/183/188). No semantic change to spec 034's claims; 175
  # lacking this edge was a latent gap surfaced when the flip moved the
  # golden alone.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
references:
  - role: decomposition-source
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md }
  - role: aide-analogue
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-blueprint-spec.md }
  - role: pair-spec
    unit: { kind: file, path: specs/163-statecraft-requirements-view/spec.md }
  - role: pair-spec
    unit: { kind: file, path: specs/164-statecraft-development-lifecycle-board/spec.md }
  - role: governed-read-discipline
    unit: { kind: file, path: specs/103-init-protocol-governed-reads/spec.md }
summary: >
  Refine `app.project.$projectId._index.tsx` from a six-tile
  navigation grid into the project's observability surface — the
  AIDE `ProjectDetailView` analogue named in
  AIDE-VELOCITY-OAP-INTENT.md §3.3 that was committed in intent
  but never scheduled in the §9 decomposition list.

  Six concrete panels, all backed by data already in statecraft
  (no new tables): (1) project identity rendered by the parent
  layout; (2) current lifecycle posture — counts by spec status
  + implementation state from the project's own spec spine,
  reusing spec 163's `specRegistry/registryReader`; (3) recent
  governance certificate per spec 102 / 168, with hash prefix +
  emission timestamp + verifier exit code; (4) recent factory
  runs — last N rows from `factory_runs` (spec 124) filtered to
  this project, with status / stage / age; (5) risk banner —
  derived from stale extraction runs (spec 115), failed factory
  runs (spec 124), and coupling-gate audit entries (spec 127);
  (6) audit summary — last N rows from `audit_log` scoped to the
  project.

  This spec is **observability-only**: panels render current
  state and link to the owning tabs for action. No editing, no
  CRUD, no lifecycle transitions on this surface — those live in
  Requirements (spec 163), Development (spec 164), Settings, and
  the underlying authoring layer (git + markdown).

  One small additive endpoint — `GET /api/projects/:projectId/
  dashboard` — bundles the six panels into a single typed
  `ProjectDashboardSnapshot` so the route loads in one
  server-side round-trip rather than fanning out from the
  client. All reads honour spec 103 (governed-artifact-reads):
  spec-spine state flows through `registryReader`, never via
  ad-hoc `registry.json` parsing.
---

# 175 — Statecraft project dashboard — observability refinement of `_index`

## 1. Problem

The statecraft project page (`/app/project/:id`) today renders a
six-tile navigation grid: Knowledge, Requirements, Imported agents,
Development, Deploys, Settings. Each tile is a `<Link>` carrying a
label and one-line hint. There is no project data on this surface
beyond the project name / slug / description rendered in the
parent layout's header.

The decomposition list in `docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md`
§9 produced 14 specs over the past week (160–174) covering Requirements
(163), Development (164), the OPC decomposition pipeline (165), the
Stop-hook gate chain (166), the born-with kernel (167), per-project
governance certificates (168), tool-schema strictness (169), inter-stage
manifest signing (170), structural-diff plan UI (171), live agent
introspection (172), multi-session orchestrator binding (173), and the
codification gate (174). **One commitment from intent §3.3 never made
the §9 candidate list**: the refinement of the dashboard `_index`
itself.

The intent doc §3.3 frames it explicitly:

> *Dashboard (`_index`) — refines the existing dashboard to fulfil
> AIDE's `ProjectDetailView` role: project identity, current lifecycle
> posture, recent governance certificate, recent factory runs, risk
> banner, audit summary, links into Knowledge / Requirements /
> Development. This is observability, not editing. AIDE renders a
> full CRUD form here; OAP keeps editing in the appropriate sub-view
> and the dashboard is the at-a-glance surface.*

The AIDE blueprint (`docs/owasp/factory/AIDE-VELOCITY-blueprint-spec.md`
§7) describes `ProjectDetailView` as the surface that bears the *risk
banner + audit log + sub-resources*. AIDE owns that surface as full
CRUD; OAP's `ProjectDetailView` analogue is intentionally narrower —
observability only — because edit / approve / lifecycle-transition
actions live in the owning tabs.

Concrete consequences of the unaddressed gap:

- A stakeholder opening a project sees only navigation. They cannot
  answer "is this project healthy?", "what's the latest run?",
  "what's the lifecycle posture?", or "did the last certificate
  verify cleanly?" without traversing four sub-tabs.
- The per-project governance certificate (spec 168) has a write
  surface but no project-page reader; the certificate is invisible
  until a user navigates into the Development tab or the project
  repo.
- The factory-runs panel from spec 124 surfaces in the OPC desktop
  and via `GET /api/factory/runs` but has no project-page summary;
  recent activity is invisible from the dashboard.
- The risk signals already in statecraft (stale extraction runs per
  spec 115, failed factory runs per spec 124, coupling-gate
  failures per spec 127) compose naturally into a project-level
  risk banner, but the composition is never performed because no
  surface owns it.
- The §3.3 intent — that the dashboard is the "at-a-glance surface"
  — remains an aspiration; users still get a router page.

## 2. Decision

Refine `app.project.$projectId._index.tsx` into an observability
landing page composed of six panels. Add a single bundled
dashboard endpoint to keep the route to one server-side
round-trip.

### 2.1 Six panels

The six panels from the intent §3.3, made concrete:

1. **Project identity** (already rendered by the parent layout in
   `app.project.$projectId.tsx`) — name, slug, description, and
   the existing "Open in OPC" button per spec 112 §6.3. The
   dashboard does not duplicate this; it relies on the parent
   layout's header.

2. **Lifecycle posture** — counts of project specs by
   (`status`, `implementation`) keyed by spec 147 grammar:
   `draft`, `approved`, `implementation:pending`,
   `implementation:in-progress`, `implementation:complete`,
   plus `superseded` and `amended` lanes. Reads through
   `api/specRegistry/registryReader.ts` (the same surface spec
   163 uses). Compact card with the counts, plus a link to the
   Development board (spec 164) for the full lifecycle view.

3. **Recent governance certificate** — per spec 102 / 168, the
   project's most recent `governance-certificate.json`. Surfaces:
   emission timestamp, run id, certificate SHA-256 hash prefix
   (first 16 chars), and the auditor-verifier exit code from the
   last verification attempt (clean / tampered / not-yet-verified).
   No re-verification runs on dashboard load — the verifier exit
   code shown is the last-known result.

4. **Recent factory runs** — last 5 rows from `factory_runs`
   filtered to this project (spec 124's `listRuns` already
   supports project filter). For each: run id, status, current
   stage, last-event-at age, link to the run detail (existing
   route in the Development tab).

5. **Risk banner** — derived signal aggregator. Composes:
   - Stale extraction runs (`knowledge_objects` in `extracting`
     state past `STATECRAFT_EXTRACT_STALE_AFTER_SEC`)
   - Failed factory runs in the last 24h (rows in `factory_runs`
     with `status = failed`)
   - Coupling-gate failures in the last 24h (audit_log rows with
     `action LIKE 'coupling-gate.%' AND payload->>'result' =
     'failed'`)
   - Missing prerequisites — no environments configured, no
     repo bound, no PAT — the same conditions
     `api/projects/scaffoldReadiness.ts` already surfaces

   Three severity levels: `ok` (no signals), `warning` (1–2
   signals, none critical), `critical` (any failed factory run
   in the last hour, or any tamper-verified certificate).
   Banner shows top three signals with explicit counts and links.

6. **Audit summary** — last 5 rows from `audit_log` scoped to
   the project (rows where `target_kind = 'project' AND target_id
   = :projectId`, or where `payload->>'project_id' = :projectId`
   for nested events). Each row: actor, action, target, age,
   `auth_source` (session vs api_key vs m2m).

### 2.2 Footer nav — compact tile strip

The six existing tiles are not removed — they are relegated to a
compact link strip at the bottom of the dashboard. They remain a
fallback navigation affordance but they are no longer the
primary surface area. The dominant content is the six panels
above.

### 2.3 The bundled dashboard endpoint

A new endpoint at `GET /api/projects/:projectId/dashboard`
returns a single typed `ProjectDashboardSnapshot` with six named
fields, one per panel. The route loads via this one endpoint
rather than fanning out to `listProjectSpecs`, `listRuns`, the
certificate reader, the audit lister, etc. separately. This:

- Avoids client-side waterfall fan-out
- Keeps SSR latency predictable
- Lets the server make the read-discipline-correct decisions
  (which registry consumer, which sweeper TTL, which audit scope)
  rather than spreading them across five client-side calls

The endpoint composes existing surfaces internally:

| Panel | Internal source |
|---|---|
| Lifecycle posture | `api/specRegistry/registryReader.ts` |
| Recent certificate | spec 168's per-project certificate read path |
| Recent runs | `api/factory/runs.ts::listRuns` (existing) |
| Risk banner | `riskAssessor.ts` (new — composes 4 existing queries) |
| Audit summary | `api/audit/audit.ts` (small new exposed read; one query) |

The `riskAssessor.ts` module is pure given its inputs — it
composes the four signal queries into a typed `RiskSnapshot` and
applies the three-level severity rule from §2.1. It is
unit-testable without standing up Encore infrastructure.

### 2.4 Governed-read discipline (spec 103)

The lifecycle-posture read flows through `registryReader`, never
via direct `.derived/spec-registry/registry.json` parsing — the
same discipline spec 163 established. The factory-runs and audit
reads use existing Drizzle queries with explicit project scoping.
No new ad-hoc JSON parsers land in this spec.

### 2.5 Implementation layout (landed)

The implementing commit landed the layout below; this section is the
post-implementation record, paired with the `establishes:` blocks in
the frontmatter:

```
platform/services/statecraft/
  api/projectDashboard/
    encore.service.ts
    dashboard.ts                         (GET /api/projects/:id/dashboard)
    dashboardHelpers.ts                  (pure helpers: lastStageId,
                                          pickAuthSource, shortError,
                                          staleExtractionCutoffMs)
    dashboard.test.ts                    (pure-helper coverage)
    riskAssessor.ts                      (pure module — composes signals)
    riskAssessor.test.ts                 (severity rule + ordering)
    types.ts                             (ProjectDashboardSnapshot)
  api/audit/audit.ts                     (additive: listProjectAuditRecords)
  web/app/
    lib/project-dashboard-api.server.ts  (Remix loader helper)
    components/
      ProjectDashboardLifecycle.tsx
      ProjectDashboardCertificate.tsx
      ProjectDashboardRuns.tsx
      ProjectDashboardRiskBanner.tsx
      ProjectDashboardAudit.tsx
    routes/app.project.$projectId._index.tsx   (refined — refines:)
```

Amendment record: `dashboardHelpers.ts` was split out from
`dashboard.ts` at implementation time so the pure helpers can be
unit-tested under bare vitest without standing up the Encore /
Drizzle runtime. `dashboard.ts` re-exports the same names so
downstream callers stay unchanged.

### 2.5.1 Certificate panel — surface-area gap (deferred follow-up)

Spec 168's tenant-emit mode writes `governance-certificate.json` to
the tenant's filesystem per factory run. There is no statecraft-side
persistence path today for the certificate's SHA-256 hash or the
auditor verifier's exit code. The dashboard's certificate panel
therefore surfaces what is derivable from `factory_runs` only:

- `emittedAt` — bound to the most recent `status='ok'` run's
  `completed_at`.
- `runId` — that run's UUID, with a link to its detail page.
- `hashPrefix` — `null` today.
- `verifierExitCode` — `null` today.
- `verifierStatus` — `not-yet-verified` until the persistence
  plumbing lands.

FR-004's "MUST NOT re-run the verifier on load" is honoured by
construction: the panel performs no synchronous verifier work.
SC-002 ("displays the certificate hash prefix and a `clean`
verifier badge") is only partially satisfiable until a follow-up
spec adds a write path from tenant-side emission / verification to
statecraft. That follow-up is out of scope here per spec 175 §2's
"no new tables" constraint and the pair-spec depends_on chain
(168 → tenant emission, 175 → reader-side surface).

### 2.6 Read-shaped — no edit surface

This spec is **read-shaped**. No FR commits a write affordance on
the dashboard. Every panel that surfaces actionable state links
out to the owning tab where the action lives:

- Lifecycle posture → Development board (spec 164)
- Recent certificate → certificate detail (spec 102 / 168)
- Recent runs → factory-run detail
- Risk banner signals → the owning surface that resolves the signal
  (Knowledge for stale extraction, Settings for missing prereqs,
  Development for failed runs)
- Audit summary → a future audit-detail view if needed (out of
  scope here; the summary is sufficient at the dashboard layer)

## 3. Functional Requirements

- **FR-001** The dashboard route `app.project.$projectId._index.tsx`
  MUST render the six panels described in §2.1 above the existing
  six-tile nav strip. The nav strip MUST remain present as a
  fallback navigation affordance.
- **FR-002** A new Encore.ts endpoint at
  `GET /api/projects/:projectId/dashboard` MUST return a typed
  `ProjectDashboardSnapshot` containing the six panel payloads in
  a single response. The route MUST load via this endpoint, not
  via client-side fan-out across the underlying APIs.
- **FR-003** The lifecycle posture panel MUST read the project's
  spec spine through `api/specRegistry/registryReader.ts` — the
  same governed-read path spec 163 established. Direct
  `.derived/spec-registry/registry.json` parsing on this route is
  forbidden.
- **FR-004** The recent-certificate panel MUST surface the
  project's most recent governance-certificate emission (per
  spec 168) with: emission timestamp, run id, SHA-256 hash prefix
  (first 16 chars), and the last-known verifier exit code. The
  dashboard MUST NOT re-run the verifier on load — the displayed
  state is the last-known result.
- **FR-005** The recent-runs panel MUST display the last 5 rows
  from `factory_runs` filtered to the project. Each row MUST
  link to the run-detail page in the Development tab.
- **FR-006** The risk banner MUST aggregate the four signal
  sources named in §2.1 (5) and render one of three severity
  levels (`ok`, `warning`, `critical`) per the rules there. The
  banner MUST show the top three contributing signals with
  explicit counts when severity is `warning` or `critical`.
- **FR-007** The audit summary panel MUST display the last 5
  audit_log rows scoped to the project, including actor, action,
  target, age, and `auth_source`.
- **FR-008** The dashboard route MUST degrade gracefully when
  the spec spine is empty (a project that hasn't run decomposition
  yet) — lifecycle posture renders zero counts, runs panel
  renders "no recent runs", and the dashboard remains
  navigable.
- **FR-009** The endpoint MUST honour the same auth and project
  membership checks the existing `getProject` route uses
  (`api/projects/get.ts`). Cross-project leakage is rejected by
  the existing membership guard.
- **FR-010** The `riskAssessor.ts` module MUST be pure given its
  inputs — the severity rule from §2.1 MUST be unit-tested
  without standing up Encore infrastructure.

## 4. Success Criteria

- **SC-001** Opening `/app/project/<uuid>` for any project that
  has at least one spec in its spec spine displays non-zero
  lifecycle posture counts on the dashboard panel.
- **SC-002** A project with a recent successful factory run (and
  its emitted governance-certificate per spec 168) displays the
  certificate hash prefix and a `clean` verifier badge on the
  recent-certificate panel.
- **SC-003** A project with at least one row in `factory_runs`
  displays that row on the recent-runs panel within 5 seconds of
  page load.
- **SC-004** A project with a `knowledge_object` stuck in
  `extracting` past `STATECRAFT_EXTRACT_STALE_AFTER_SEC` displays
  a `warning` severity risk banner naming "stale extraction
  runs" with the count.
- **SC-005** A project with a `factory_runs` row in `failed`
  state in the last hour displays a `critical` severity risk
  banner.
- **SC-006** A project with an empty spec spine renders the
  dashboard without errors, with lifecycle posture showing
  `0 specs` and an empty-state hint linking to the Requirements
  tab's decomposition CTA (spec 163 FR-007).
- **SC-007** The dashboard route loads in a single
  `GET /api/projects/:projectId/dashboard` round-trip — verifiable
  by inspecting the network panel; no fan-out fetches fire from
  the route loader.

## 5. Scope

### In scope

- The `_index.tsx` refinement (the six panels + the footer nav
  strip).
- The `api/projectDashboard/` Encore service: the dashboard
  endpoint, the snapshot type, the risk assessor.
- The four panel components under
  `web/app/components/ProjectDashboard*.tsx`.
- A small additive read endpoint on the existing audit service
  to support the audit summary (`listProjectAuditRecords` or
  equivalent — exact name set during implementation, governed by
  the existing `api/audit/audit.ts` conventions).
- Unit tests for `riskAssessor.ts` and integration tests for the
  dashboard endpoint.

### Out of scope (deferred)

- **Editing on the dashboard.** The dashboard is observability-only.
  Editing remains in the owning tabs.
- **Re-running the certificate verifier on dashboard load.** The
  dashboard surfaces the last-known result. Re-verification is a
  separate user action covered by spec 102 / 168's existing
  affordances.
- **Realtime SSE / WebSocket on the dashboard.** AIDE-VELOCITY
  pushes velocity-board updates via SSE; the OAP dashboard is
  request-response. A realtime refinement is a future spec.
- **Charts / time-series.** The dashboard surfaces current state,
  not historical trend lines. A trends/portfolio surface lives in
  OPC (`PortfolioPanel`, spec 096) or a future statecraft
  portfolio view, not on the per-project dashboard.
- **Cross-project aggregates.** Per-project surface; portfolio
  aggregation is owned by future portfolio specs.
- **Speech-to-text / PWA / theme system** from AIDE-VELOCITY
  blueprint §7. Out of OAP scope (intent §1 non-goals).

## 6. Edge cases

- **Empty spec spine** — handled by FR-008 / SC-006.
- **No factory runs ever** — recent-runs panel renders an empty
  state with a CTA linking to the Development tab.
- **No governance certificate ever emitted** — recent-certificate
  panel renders an empty state explaining the project has not
  yet completed a factory run.
- **Project membership lost mid-session** — the existing
  membership guard on `getProject` returns 403; the route returns
  the existing error response. No dashboard-specific handling.
- **Statecraft DB unreachable** — the route surfaces the standard
  Encore error envelope. No dashboard-specific fallback.
- **Project belongs to a different org than the caller** — the
  existing org / project membership guard rejects.
- **A panel's underlying data is partially unavailable** (e.g.
  audit query fails but specs load) — the dashboard endpoint MUST
  return the available panels with the unavailable one's payload
  marked `{ available: false, reason: <short string> }`. The
  panels render placeholder states without breaking the page.

## 7. Cross-references

- **INTENT doc** §3.3 — the source commitment this spec
  back-fills.
- **AIDE-VELOCITY-blueprint-spec.md** §7 — the `ProjectDetailView`
  analogue.
- **Spec 087** — establishes the project surface; this spec
  refines its `_index.tsx`.
- **Spec 102 / 168** — governance certificate surface this
  dashboard reads.
- **Spec 115** — extraction pipeline; stale runs feed the risk
  banner.
- **Spec 124** — factory runs; `listRuns` feeds the recent-runs
  panel.
- **Spec 127** — coupling gate; gate-fire audit entries feed the
  risk banner.
- **Spec 147** — lifecycle / status grammar used by the lifecycle
  posture panel.
- **Spec 163** — Requirements view; reuses
  `specRegistry/registryReader`.
- **Spec 164** — Development board; the lifecycle posture panel
  links here.
- **Spec 103** — governed-artifact-reads discipline.
