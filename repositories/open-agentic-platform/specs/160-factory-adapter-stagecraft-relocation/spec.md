---
id: "160-factory-adapter-statecraft-relocation"
slug: factory-adapter-statecraft-relocation
title: "Factory / adapter relocation into statecraft"
status: approved
implementation: complete
owner: bart
created: "2026-05-22"
kind: platform
domain: platform
risk: medium
depends_on:
  - "074-factory-ingestion"  # factory-ingestion (Rust contract types)
  - "075-factory-workflow-engine"  # factory-workflow-engine (two-phase pipeline)
  - "077-statecraft-factory-api"  # statecraft-factory-api
  - "108-factory-as-platform-feature"  # factory-as-platform-feature
code_aliases: ["FACTORY_STATECRAFT_RELOCATION", "ADAPTERS_IN_STATECRAFT"]
amends:
  - "101-codebase-index-mvp"
extends:
  - spec: "108-factory-as-platform-feature"
    nature: additive
    unit: { kind: directory, path: platform/services/statecraft }
co_authority:
  - with_specs:
      - "102-governed-excellence"
      - "104-makefile-ci-parity-contract"
      - "127-spec-code-coupling-gate"
      - "134-fast-local-ci-mode"
      - "135-fast-ci-as-default"
    unit: { kind: section, file: Makefile, anchor: registry }
references:
  - role: decomposition-source
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md }
  - role: precedent
    unit: { kind: file, path: specs/108-factory-as-platform-feature/spec.md }
  - role: precedent
    unit: { kind: file, path: specs/077-statecraft-factory-api/spec.md }
  - role: precedent
    unit: { kind: file, path: specs/074-factory-ingestion/spec.md }
  - role: load-bearing-fossil
    unit: { kind: file, path: tools/spec-spine/codebase-indexer/src/lib.rs }
summary: >
  Closes out the in-flight migration named in
  `AIDE-VELOCITY-OAP-INTENT.md` §8.1: the canonical
  `factory/` directory (which carried per-adapter
  `manifest.yaml` files plus `factory/process/stages/*`)
  has been removed from this repo as part of relocating
  factory/adapter machinery into statecraft as a
  first-class feature. The relocation is partial — the
  former directory is gone, but no statecraft-resident
  replacement has been declared. The `codebase-indexer`
  still lists `factory/adapters/*/manifest.yaml` and
  `factory/process/stages/*` in its `collect_input_files`
  hash set, which is a fossil that fails closed in
  staleness checks any time those paths are mentioned by
  a hash signature even though they no longer exist.

  This spec establishes the statecraft-resident location
  contract for adapter manifests and process stage
  templates, repoints the codebase-indexer input list at
  the new location, and excises the legacy `factory/`
  references from CLAUDE.md / README.md / Makefile /
  CI workflows. It is a closure spec for an in-flight
  migration, not a redesign of factory primitives — the
  factory contract types (spec 074), the two-phase
  workflow engine (spec 075), and statecraft's
  factory-bridge API (spec 077) remain authoritative
  on their own surfaces; this spec only relocates where
  adapter-manifest authority *lives*.
---

# 160 — Factory / adapter relocation into statecraft

## 1. Problem

The intent doc §8.1 records the current state honestly:

> *"The four registered adapters referenced in `README.md` and `CLAUDE.md`
> (`acme-vue-node`, `next-prisma`, `rust-axum`, `encore-react`) had their
> canonical `manifest.yaml` files in a `factory/` directory that has been
> **removed from this repo**. The removal is part of a refactor that
> relocates the factory / adapter machinery into statecraft as a
> first-class feature. … Consequences: the README's 'Adapters' section is
> partially aspirational against the on-disk state. The codebase-indexer's
> `collect_input_files` list still names `factory/adapters/*/manifest.yaml`
> — this will either get re-routed to the new statecraft-resident
> location or removed in step with the migration."*

A partial migration is not a stable resting state. Today:

1. The README's *Adapters* section describes four adapters as
   "factory-contract validated" but no `factory/adapters/*/manifest.yaml`
   exists anywhere in the repo.
2. The codebase-indexer's input-hash list still includes
   `factory/adapters/*/manifest.yaml` and `factory/process/stages/*` — a
   set whose globs match zero files. Staleness checks still pass (the
   hash of an empty set is stable), but the list reads as truth about
   inputs that no longer exist.
3. CLAUDE.md still references `factory/adapters/*/manifest.yaml` as a
   per-adapter authoring location.
4. Statecraft has a `factory-api.server.ts` shell at
   `platform/services/statecraft/web/app/lib/factory-api.server.ts` and
   factory-tab routes (`app.factory.adapters.tsx`,
   `app.factory.contracts.tsx`, `app.factory.processes.tsx`,
   `app.factory.runs.*`) that point at a statecraft-resident factory
   surface, but no normative location for adapter manifests is declared
   under `platform/services/statecraft/`.

Spec 077 (`statecraft-factory-api`) and spec 108
(`factory-as-platform-feature`) cover the API and platform-side
modelling of factory work, but neither claims the on-disk location
of adapter-manifest authoring. That gap is what this spec closes.

## 2. Decision

Declare the statecraft-resident location contract for the four legacy
factory authoring inputs and migrate the references that still point
at the legacy `factory/` directory.

The intent doc §8.1 explicitly leaves the **shape** of the new
location to the relocation work; this spec commits to the location
contract and to the migration of consumer references. The detailed
schema of the new manifests (whether they are YAML, JSON, or
database rows; whether they live in a directory tree or in
statecraft's Postgres) is owned by spec 077 / 108 refinements that
follow this spec, not by spec 160 itself.

## 3. Functional Requirements

- **FR-001** A canonical statecraft-resident location for adapter
  manifests is declared and recorded in the codebase-indexer's
  `collect_input_files` list, replacing the legacy
  `factory/adapters/*/manifest.yaml` entry. The declared path lives
  under `platform/services/statecraft/` (exact subpath owned by
  spec 077 / 108 refinement, not by this spec).
- **FR-002** A canonical statecraft-resident location for process
  stage templates is declared and recorded in the same input list,
  replacing the legacy `factory/process/stages/*` entry.
- **FR-003** Every consumer reference to the legacy `factory/`
  directory in `README.md`, `CLAUDE.md`, the root `Makefile`, and
  `.github/workflows/*` is either updated to point at the new
  location or removed if the reference is no longer load-bearing.
- **FR-004** The codebase-indexer staleness check after this spec
  lands does not list any legacy `factory/...` glob as a tracked
  input. The hash of the input set continues to be stable across
  recompiles.
- **FR-005** The four adapters named in the README (`acme-vue-node`,
  `next-prisma`, `rust-axum`, `encore-react`) are either represented
  at the new statecraft-resident location with their manifest content
  reconstructed, **or** the README is amended to reflect their
  retired-pending-relocation status with no aspirational claims.
- **FR-006** The factory-tab routes already present at
  `platform/services/statecraft/web/app/routes/app.factory.adapters.tsx`
  and `app.factory.contracts.tsx` read from the new location, not
  from an external `factory/` checkout.

## 4. Success Criteria

- **SC-001** `git ls-files | grep '^factory/'` returns zero rows
  after this spec's implementation lands.
- **SC-002** `codebase-indexer compile` succeeds with an updated
  input set whose hash is recorded against the new location.
- **SC-003** Running `grep -rln 'factory/adapters' README.md
  CLAUDE.md docs/ .github/workflows/` returns zero matches that are
  authoritative claims (annotated historical references in
  research or migration docs are exempt).
- **SC-004** The README's *Adapters* section either lists the four
  adapters with valid statecraft-resident paths, or is rewritten to
  reflect honest current state.

## 5. Scope

### In scope (this spec)

- Declaring the statecraft-resident location for adapter manifests
  and process stage templates.
- Updating the codebase-indexer input list, README, CLAUDE.md,
  Makefile, and CI workflow references.
- A migration note capturing the move and its rationale
  (intent doc §8.1).

### Out of scope (and intentionally so)

- The schema of statecraft-resident adapter manifests. Owned by
  spec 077 / 108 refinement, possibly by a new spec authoring the
  detailed manifest grammar.
- Re-validating the four adapters as factory-contract conformant
  under the new location. Spec 074 (`factory-ingestion`) governs
  the Rust contract types; spec 160 only relocates *where* the
  conformance check reads from.
- Cross-tenant adapter sharing or marketplace concerns. Out of
  scope by directive; this spec only addresses on-disk location.
- The two-phase pipeline engine (spec 075) and its stage grammar.
  Spec 075 retains authority on stage semantics; this spec only
  relocates where stage template files are read from.

## 6. Relationship to existing factory specs

- **Spec 074 (`factory-ingestion`)** — retains authority on the
  Rust contract types in `crates/factory-contracts`. Spec 160 does
  not modify the contract; it relocates the on-disk authoring
  location whose content the contract validates.
- **Spec 075 (`factory-workflow-engine`)** — retains authority on
  the two-phase pipeline mechanics in `crates/factory-engine`. Spec
  160 does not modify pipeline semantics; it relocates where stage
  templates are read from.
- **Spec 077 (`statecraft-factory-api`)** — owns the statecraft API
  surface that drives factory work. Spec 160 declares the on-disk
  location that spec 077's API consumes.
- **Spec 108 (`factory-as-platform-feature`)** — owns the
  conceptual move from per-clone factory to platform-feature
  factory. Spec 160 is the on-disk closure of that move.

## 7. Acceptance posture

Spec 160 is a *closure spec for an in-flight migration*. Acceptance
is operational: the migration is complete when the legacy
`factory/` directory has zero remaining authoritative references
in this repo, the codebase-indexer's input list reflects the new
location, and a future contributor reading README + CLAUDE.md gets
an honest picture of where adapter manifests live today.

This spec does not require new factory functionality to ship. If
the relocation reveals that the legacy manifests cannot be
reconstructed (because they were never committed before removal),
the honest closure is the *README rewrite* arm of FR-005, not the
synthetic recreation of manifests for adapters that never had them.

## 8. Cross-references

- **INTENT doc** §8.1 — the framing source.
- **Spec 077** — statecraft-factory-api; consumer.
- **Spec 108** — factory-as-platform-feature; rationale.
- **Spec 074** — factory-ingestion; contract types.
- **Spec 075** — factory-workflow-engine; pipeline mechanics.
- **`tools/spec-spine/codebase-indexer/src/lib.rs`** — the
  `collect_input_files` list that names the legacy paths today;
  the load-bearing fossil this spec excises.

## Amendments received

**Amendment 2026-06-11 (record: spec 198 FR-012 derivation cutover).**
The statecraft-resident snapshot this spec relocated
(`platform/services/statecraft/api/factory/adapter-scopes.json`) is no
longer hand-regenerated: its content is now the derived projection of the
admitted adapter sub-envelope (manifest `governance:` section), produced
by `adapter-scopes-compiler` (spec 105, amended same date) from the
factory source checkout. First derivation ran against the sealed
`acme-vue-encore` admission (manifest sha `57f43e1a…`). This spec's
residence and indexer-hashing posture are unchanged — only the snapshot's
provenance upgrades from authored to materialised.

**Amendment 2026-06-29 (record: clean-slate reset-prep housekeeping).**
Housekeeping inside the relocated `platform/services/statecraft` tree this
spec claims, with no change to 160's factory/adapter design:
- The Encore uptime-monitor starter scaffolding (`api/monitor/`, `api/site/`)
  was removed. It was template code that happened to live under the relocated
  tree, never part of this spec's surface; `api/slack/slack.ts` drops the
  `uptime-transition` subscription that depended on it.
- The two per-cloud Encore infra configs were unified into a single
  `infra.config.json` (the deleted `infra.config.hetzner.json` differed only by
  a cluster-internal metrics URL), and the application database was renamed
  `auth` to `statecraft`. `scripts/docker-build.sh`,
  `scripts/encore-test-lane.mjs`, `encore.app`, and the CI/CD encore-build
  `--config` are repointed to match.

None of this alters the relocation contract (§2, §FR); it is recorded here so
the changed paths couple to an authoring edit.

**Amendment 2026-06-29 (record: factory-upstream UI + PAT-optional scaffold).**
Post-reset polish plus a deliberate behavior change on the factory surface (no
change to the relocation contract):
- Upstream Repository inputs accept a full GitHub URL and lowercase it
  (`api/factory/upstreams.ts::validateRepo`); the source placeholders show
  `factory`/`template` instead of the retired `legacy-factory`; a
  configured-but-never-run upstream renders as idle ("Not synced yet") rather
  than a misleading "pending" (`web/app/routes/app.factory._index.tsx`); and the
  Create page drops the undefined "ACP" acronym for plain "factory pipeline
  state" (`web/app/routes/app.projects.new.tsx`).
- The factory upstream PAT is now OPTIONAL for project creation. The scaffold
  clone already falls back to an anonymous clone (`buildCloneUrl`), which works
  for public template repos, so the `no-upstream-pat` readiness block, the
  `create.ts` PAT precondition, and the warmup scheduler's no-PAT skip were
  relaxed (`scaffoldReadinessBlocker.ts`, `scaffoldReadiness.ts`, `create.ts`,
  `scaffold/scheduler.ts`, with the test updated). A private template without a
  PAT now surfaces a clear clone error at scaffold time instead of a preemptive
  block. This relaxes spec 140 §2.3 blocker bullet 4 and spec 199 FR-009
  create-eligibility; flagged for a formal amendment to those.

## 9. Amendment to spec 101 (codebase-index-mvp)

Spec 101 §2.2 *Layer 3 — Factory Adapter Inventory* and §FR-07
*Factory Adapter Scanning* both declare that the indexer reads
adapter manifests from `factory/adapters/*/manifest.yaml` and
process stage templates from `factory/process/stages/*.md`. Those
locations have been removed from the repo as part of the spec 108
relocation. This spec amends spec 101's input-set declaration in
place: the indexer reads adapter manifests from the
statecraft-resident location
`platform/services/statecraft/api/factory/adapter-scopes.json`
(the static fallback snapshot retained per spec 108's drop of the
`factory_adapters` table). Process stage templates have no
file-backed representation in statecraft today — the substrate is
DB-resident per spec 139 — so the indexer's process-stage walk
points at
`platform/services/statecraft/api/factory/process-stages/` (a
forward-compatible directory walk that hashes empty until a future
refinement of spec 077 / 108 lands stage-template files there).

Spec 101's broader design (four-layer model, manifest parsing,
spec-frontmatter scanning, cross-reference engine, JSON Schema
validation, staleness check) stays operative. Only the on-disk
locations cited in §2.2 / §FR-07 are amended. Layer 3 is no longer
emitted by the generic indexer (Cut D W-07c moved factory /
infrastructure / workflow scanning into
`tools/oap/oap-code-index-enrich`); the input-hash walk is the only
remaining surface where these paths are named, and that is what
this spec repoints.


## Security hardening amendment (2026-07-02)

Closed authorization gaps across the statecraft API surface: the admin agent-policy endpoints now require an admin role and derive actorUserId from the authenticated identity; getToken verifies org ownership before brokering a GitHub App token and gates its env fallback to non-production; isAgentAuthorized requires authentication and a per-org id instead of a hardcoded default org; audit ingestion validates and binds its attribution fields; getPolicyBundle and getGrants validate and bind their identifiers; and oidcDiscover is rate-limited.

Recorded during the cross-subsystem security-hardening sweep; couples the security fixes in the code paths this spec authors to their owning spec per the spec 127 coupling gate.
