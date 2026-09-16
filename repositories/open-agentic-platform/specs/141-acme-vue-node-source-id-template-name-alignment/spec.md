---
id: "141-acme-vue-node-source-id-template-name-alignment"
slug: acme-vue-node-source-id-template-name-alignment
title: "Align acme-vue-node scaffold_source_id with template.json::templateName"
status: approved
implementation: complete  # Single-commit amendment landed (0494c36b feat(spec-141): align acme-vue-node scaffold_source_id with template.json::templateName). AC-1 (`oapNativeAdapters.ts:53` literal is `"acme-vue-node"`), AC-2 (migration 37 updates migration-36 substrate row `scaffold_source_id` to `acme-vue-node`), AC-3 (migration 37 inserts sibling `factory_upstreams` row keyed `(org_id, 'acme-vue-node')` from the legacy `legacy-template-mixed` row), AC-5 (no production code path or non-migration-36 test asserts the pre-amendment literal; remaining occurrences are migration-37 SQL WHERE filters, migration-37 test setup commentary, and one inline comment in `oapNativeAdapters.ts:52`) verified from checkout. AC-4 (the `acme-vue-node — needs scaffold source registered` banner on `/app/projects/new` is gone) confirmed on dev cluster 2026-05-17 via the Create Project page rendering `acme-vue-node @ 5cb4921bb80f` cleanly in the Factory Adapter dropdown.
owner: bart
created: "2026-05-06"
approved: "2026-05-06"
amended: "2026-06-09"
amendment_record: "199-factory-thin-consumer-sync"
kind: amendment
domain: platform
risk: low
amends: ["140-acme-vue-node-scaffold-source-id-cutover"]
depends_on:
  - "140-acme-vue-node-scaffold-source-id-cutover"  # acme-vue-node manifest cutover (introduces scaffold_source_id and migration 36)
code_aliases: ["ACME_VUE_NODE_SOURCE_ID_TEMPLATE_NAME_ALIGNMENT"]
establishes:
references:
  # Spec 199 amendment (2026-06-09): the thin-consumer cutover deleted the
  # adapter-config constants and the projection round-trip test; §2.1's
  # templateName alignment doctrine is partially superseded by 199 FR-009.
  # Historical pointers, non-owning.
  - role: historical
    unit: { kind: file, path: platform/services/statecraft/api/factory/oapNativeAdapters.ts }
  - role: historical
    unit: { kind: file, path: platform/services/statecraft/api/factory/projection.test.ts }
extends:
  - spec: "140-acme-vue-node-scaffold-source-id-cutover"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/factory/translator.ts }
  - spec: "140-acme-vue-node-scaffold-source-id-cutover"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/factory/substrateBrowser.ts }
  - spec: "140-acme-vue-node-scaffold-source-id-cutover"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/factory/translator.test.ts }
  - spec: "140-acme-vue-node-scaffold-source-id-cutover"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/factory/artifacts.test.ts }
  - spec: "140-acme-vue-node-scaffold-source-id-cutover"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/scheduler.test.ts }
  - spec: "140-acme-vue-node-scaffold-source-id-cutover"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/scaffold.test.ts }
  - spec: "140-acme-vue-node-scaffold-source-id-cutover"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/vite.config.ts }
summary: >
  Spec 140 §2.1 fixed the canonical scaffold_source_id for acme-vue-node
  as `acme-vue-node-template`. The upstream's own
  `template.json::templateName` is `acme-vue-node`. This amendment aligns
  the code constant, the migration-36 substrate row body, and the
  factory_upstreams source-id key with the upstream's self-declared
  name (one canonical id end-to-end), so the readiness gate resolves
  for orgs whose template upstream is registered via the legacy
  two-row form without re-entering the same repo URL.
---

# 141 — acme-vue-node source-id alignment with `template.json::templateName`

> **Amended 2026-06-09 by spec [199](../199-factory-thin-consumer-sync/spec.md)**
> (which also partially supersedes §2.1): the `scaffold_source_id ↔
> template.json::templateName` alignment doctrine is retired —
> the scaffold source resolves at admission from the manifest's
> org-agnostic `scaffold.source.remote`, and `templateName` reverts to
> the template's own name. The cutover deleted `oapNativeAdapters.ts`
> and `projection.test.ts`; their claims here move to non-owning
> `references: role: historical`.

> **Amendment** of [`140-acme-vue-node-scaffold-source-id-cutover`](../140-acme-vue-node-scaffold-source-id-cutover/spec.md).
> Spec 140's design (one canonical scaffold_source_id; source-id-keyed
> lookup against `factory_upstreams`) is unchanged. Only the literal
> value of that id is refined.

## 1. Background

Spec 140 §2.1 picked `acme-vue-node-template` as the canonical
`scaffold_source_id` for the acme-vue-node adapter, with the implicit
rationale that the orchestration source-id namespace shares the
`factory_upstreams.source_id` table and a `-template` suffix
disambiguates "the scaffold for acme-vue-node" from "the orchestration
for acme-vue-node".

Two pieces of evidence post-dating §2.1's authoring make
`acme-vue-node-template` the wrong choice:

1. **The upstream declares its own name as `acme-vue-node`.** The
   `template.json` at the root of `statecrafting/template`
   carries `templateName: "acme-vue-node"`. The upstream is the
   authoritative source of its own identity; the inventoried
   `-template` suffix is a downstream invention.

2. **No collision exists to defend against.** The orchestration
   source-id for acme-vue-node is `legacy-factory` (named after
   the orchestration upstream repo, not after the adapter). The
   scaffold source-id `acme-vue-node` does not collide with any other
   row in `factory_upstreams`.

Concrete failure mode that motivated the amendment: existing orgs
register the template upstream through the legacy two-row
`POST /api/factory/upstreams` form, which writes
`factory_upstreams.source_id = 'legacy-template-mixed'` (per spec 139
Phase 4b — `upstreams.ts:278`). The readiness gate at
`scaffoldReadiness.ts:131` queries `factory_upstreams WHERE source_id
IN (declaredSourceIds)` with `declaredSourceIds = {'acme-vue-node-template'}`
and finds nothing → `blocker='no-scaffold-source-resolved'` → the
"acme-vue-node — needs scaffold source registered" banner on
`/app/projects/new`. Aligning the canonical id with the upstream's
`templateName` lets a one-shot migration promote
`legacy-template-mixed` to a sibling row keyed `acme-vue-node` cleanly,
without inventing alias-table machinery the spec 140 cutover set out
to retire.

## 2. Resolution

### 2.1 Code constant

Rename
`OAP_NATIVE_ADAPTERS["acme-vue-node"].scaffoldSourceId` from
`"acme-vue-node-template"` to `"acme-vue-node"`. All four spec 140
implementation paths (`projection.ts`, `translator.ts`, `scheduler.ts`,
`scaffoldReadiness.ts`) read `scaffold_source_id` through this
constant or through the manifest field — no other production literal
needs editing.

### 2.2 Migration 37

`37_aim_vue_node_canonical_source_id.up.sql` — idempotent, two effects:

1. **UPDATE** the migration-36 synthetic substrate row(s)
   (`origin = 'oap-self'`, `path = 'adapters/acme-vue-node/manifest.yaml'`)
   replacing `acme-vue-node-template` with `acme-vue-node` in
   `upstream_body` and `frontmatter->>'scaffold_source_id'`.
   Filter `WHERE frontmatter->>'scaffold_source_id' =
   'acme-vue-node-template'` so re-runs are no-ops.

2. **INSERT** a sibling `factory_upstreams` row per org keyed
   `(org_id, source_id='acme-vue-node')`, role `'scaffold'`, copying
   `repo_url` / `ref` / `subpath` from the existing
   `legacy-template-mixed` row. `ON CONFLICT (org_id, source_id) DO
   NOTHING` so the migration is safe to re-run.

The legacy `legacy-template-mixed` row stays in place — the legacy
two-row UI form continues to read/write it for the singleton compat
path (`upstreams.ts:152-153`). Only the source-id-keyed lookup uses
the new sibling.

### 2.3 Test + jsdoc updates

Five test files assert on the literal `acme-vue-node-template`:

- `platform/services/statecraft/api/factory/translator.test.ts`
- `platform/services/statecraft/api/factory/projection.test.ts`
- `platform/services/statecraft/api/factory/artifacts.test.ts`
- `platform/services/statecraft/api/projects/scaffold/scheduler.test.ts`
- `platform/services/statecraft/api/projects/scaffold/scaffold.test.ts`

Updated to assert `acme-vue-node`. Two jsdoc comment references
(`translator.ts:701`, `translator.ts:725`, `substrateBrowser.ts:27`)
updated in lockstep.

The migration-36 idempotence test
(`36_aim_vue_node_manifest_cutover.test.ts`) is **not** updated. It
runs migration 36 in isolation against an existing schema and asserts
the immediate post-migration-36 state, which still contains
`acme-vue-node-template` from the immutable migration-36 SQL.
Migration 37 has its own isolated test
(`37_aim_vue_node_canonical_source_id.test.ts`) covering the
post-amendment state.

### 2.4 Migration 36 immutability

Migration 36 SQL is **not** edited. Per repo convention and the
runner's version-only tracking (`scripts/migrate.mjs`), an applied
migration's body must not change. Migration 36 continues to insert
`acme-vue-node-template`; migration 37 forward-migrates that value to
`acme-vue-node` in the same transaction sequence on every cluster.

## 3. Acceptance criteria

- **AC-1** — `OAP_NATIVE_ADAPTERS["acme-vue-node"].scaffoldSourceId`
  is the literal `"acme-vue-node"`.
- **AC-2** — Migration 37 applied: each migration-36 synthetic
  substrate row carries `frontmatter.scaffold_source_id =
  "acme-vue-node"` and the same string in its `upstream_body` YAML.
- **AC-3** — Migration 37 applied: every org with a
  `legacy-template-mixed` row also has a sibling row keyed
  `(org_id, 'acme-vue-node')` with `role='scaffold'` and matching
  `repo_url` / `ref` / `subpath`.
- **AC-4** — The Create Project page no longer shows the
  `acme-vue-node — needs scaffold source registered` banner for orgs
  whose template upstream is registered via the legacy two-row form.
- **AC-5** — No production code path or non-migration-36 test
  asserts on the literal `"acme-vue-node-template"`. Migration 36
  SQL and its isolated test remain frozen at the pre-amendment
  state.

## 4. Out of scope

- A source-id input on the upstream-config UI form — the legacy
  two-row form continues to be the only writer, and migration 37
  bridges its output to the canonical key. A source-id-aware UI is
  tracked separately under spec 139's "N-per-org source endpoints"
  surface.
- Renaming the orchestration source-id for acme-vue-node from
  `legacy-factory` — orthogonal, not motivated by any current
  failure.

## 5. Provenance

- **2026-05-06** — Cluster failure observed:
  `Scaffold source not resolved. acme-vue-node — needs scaffold
  source registered` banner on `/app/projects/new` immediately
  after migration 36 deployed.
- **Upstream evidence** — `template.json::templateName =
  "acme-vue-node"` in `statecrafting/template@main` (predates
  spec 140's authoring).
- **CONST-005 framing** — Spec 140 was authored without sight of
  the upstream's `template.json`. Per
  `.claude/rules/adversarial-prompt-refusal.md` "What this rule
  does NOT do": "It does not block legitimate amendments —
  refining a spec's narrative to clarify or extend is welcome."
  The §2.1 literal is refined here, not retroactively justified;
  spec 140's design (one canonical id, source-id-keyed lookup) is
  preserved verbatim.
