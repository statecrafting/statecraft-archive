---
id: "199-factory-thin-consumer-sync"
title: "Thin-Consumer Factory Sync for Owned Sources"
feature_branch: "feat/199-factory-thin-consumer-sync"
status: approved
implementation: complete
kind: platform
domain: platform
created: "2026-06-09"
authors: ["open-agentic-platform"]
language: en
summary: >
  Move the statecraft factory sync off the retired legacy-factory layout
  and make it a thin CONSUMER of the owned factory/template
  sources. Statecraft stores upstream content verbatim in the substrate and
  serves it by kind and by the adapter's own (schema-validated) manifest — it
  stops TRANSLATING content OAP authors and controls. Adapter identity comes
  from the manifest (acme-vue-encore self-declares), substrate origin derives
  from the configured source, and the categorical "7-stage-build" projection —
  a statecraft invention with no contract backing, coupled to the dead
  `Factory Agent/` directory shape — is retired. Process content is served
  opaque by kind; the run's governance lives in the admission envelope
  (spec 198), which this spec consumes. No backward compatibility is preserved;
  factory/template are the baseline.
code_aliases: ["FACTORY_THIN_CONSUMER_SYNC"]
amends: ["075-factory-workflow-engine", "112-factory-project-lifecycle", "124-opc-factory-run-platform-integration", "139-factory-artifact-substrate", "140-acme-vue-node-scaffold-source-id-cutover", "141-acme-vue-node-source-id-template-name-alignment"]
depends_on:
  - "198-factory-governance-envelope"
  - "139-factory-artifact-substrate"
  - "197-factory-contract-open-standard-extensions"
establishes:
  - unit: { kind: file, path: platform/services/statecraft/api/factory/adapterView.ts }
extends:
  - spec: "074-factory-ingestion"
    nature: additive
    unit: { kind: crate, id: factory-contracts }
  # The featuregraph golden snapshots this spec's lifecycle row; the
  # implementation: flip (2026-06-11) regenerates it. Same edge the
  # 187/183/193/202-211 convention uses to keep golden regens
  # coupling-clean without a waiver.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
refines:
  - aspect: "thin-consumer-substrate-reads"
    unit: { kind: file, path: platform/services/statecraft/api/factory/browse.ts }
  - aspect: "thin-consumer-substrate-reads"
    unit: { kind: file, path: platform/services/statecraft/api/factory/substrateBrowser.ts }
  - aspect: "owned-source-classification"
    unit: { kind: file, path: platform/services/statecraft/api/factory/translator.ts }
  - aspect: "binary-ingest-guard"
    unit: { kind: file, path: platform/services/statecraft/api/factory/translator.test.ts }
  - aspect: "binary-ingest-guard"
    unit: { kind: file, path: platform/services/statecraft/api/factory/syncPipeline.ts }
  - aspect: "binary-ingest-guard"
    unit: { kind: file, path: platform/services/statecraft/api/factory/syncWorker.ts }
supersedes:
  - spec: "108-factory-as-platform-feature"
    scope: partial
    note: >
      Retires the categorical factory_{adapters,contracts,processes} projection
      wire shape and its translation layer (projection.ts buildProcess /
      buildAdapter). Storage was already retired by spec 139; this retires the
      read-time translation that 139 kept for compat.
  - spec: "140-acme-vue-node-scaffold-source-id-cutover"
    scope: partial
    note: >
      Retires §2.2's manifest-carried flat scaffold_source_id (injected at
      ingest by the sanitise layer this spec removes). Replaced by
      resolution-at-admission from the manifest's org-agnostic
      scaffold.source.remote (FR-009).
  - spec: "141-acme-vue-node-source-id-template-name-alignment"
    scope: partial
    note: >
      Retires §2.1's scaffold_source_id ↔ template.json::templateName
      alignment doctrine. templateName reverts to the template's own name
      (template); the org-scoped source id is resolved at admission,
      never carried by upstream content.
references:
  - role: consumer
    unit: { kind: crate, id: factory-engine }
  - role: context
    unit: { kind: file, path: platform/services/statecraft/api/projects/opcBundle.ts }
  - role: context
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/scheduler.ts }
  - role: historical
    unit: { kind: file, path: platform/services/statecraft/api/factory/projection.ts }
---

# Feature Specification: Thin-Consumer Factory Sync for Owned Sources

**Feature Branch**: `199-factory-thin-consumer-sync`
**Created**: 2026-06-09
**Status**: Draft
**Input**: After repointing the factory upstreams to the owned
`statecrafting/factory` + `template` repos, the statecraft
Factory UI shows: Processes count `0` with an empty `7-stage-build` body; the
Adapters tab fails to load `acme-vue-node` with an internal (500) error; the
Create New Project adapter dropdown shows a stale `acme-vue-node`. A full
current-state investigation (`docs/analysis/factory-sync-current-state.md`,
2026-06-09) established a single structural cause: statecraft still **translates**
content OAP now **owns**, against the retired `legacy-factory` directory
layout, while the verbatim-mirror substrate that makes that translation
unnecessary already exists underneath it.

This spec is the **consumer half**. Its prior — what makes a factory admissible
at all — is [spec 198, the governance envelope](../198-factory-governance-envelope/spec.md),
on which this spec depends. 199 stops translating and serves verbatim; 198 says
what may be served at all.

## Purpose and charter

Make statecraft a **thin consumer** of the owned factory standard: mirror
upstream bytes verbatim into the substrate, serve them by `kind` and by the
adapter's own schema-validated manifest, and stop inventing categorical shapes
the open standard never defined.

Non-negotiables fixed before drafting (operator decisions, 2026-06-09):

- **No backward compatibility.** factory/template are the
  baseline. Current shapes are baseline, not sacred — streamline freely.
- **Thin consumer, full cutover.** Retire the legacy projection translation
  rather than repointing its predicates.
- **Identity from the manifest + source.** Adapter name / version /
  `schema_version` come from the manifest; substrate origin derives from the
  configured `factory_upstreams` source, not a static constant.
- **Process content opaque; governance via the envelope.** The process body is
  served by kind, uninterpreted; the run's governance obligations are the
  admission envelope (spec 198), never a statecraft-assembled "process" object.
- **The factory↔template split is permanent and domain-correct** (always ≥2).
  Multiple templates are already expressible at the adapter layer (each adapter
  declares its own scaffold source) — this spec adds **no** new mechanism.

## P-1 (refined): conform-by-standard; enforce, don't compensate

"Thin consumer" does not mean "never transform." It means: transform only to
*enforce* the standard (content-address, validate, reconcile — see spec 198),
never to *compensate* for a missing standard. The defect being removed
(`buildProcess` re-bucketing the dead goa layout) is compensation-processing —
it exists only because nothing constrained the input. Define the standard
(spec 197 contract + spec 198 envelope) and it evaporates.

## Problem statement (current state)

Authoritative detail: `docs/analysis/factory-sync-current-state.md`.
Condensed:

1. **Static origin ids.** `DEFAULT_FACTORY_ORIGIN = "legacy-factory"`,
   `DEFAULT_TEMPLATE_ORIGIN = "acme-vue-node"`
   (`translator.ts:703-705` ← `oapNativeAdapters.ts:49,53`) do not track the
   configured source. Repointing the GitHub URL leaves a factually-wrong origin
   label on every substrate row.
2. **Process is a statecraft invention with no contract schema.**
   `projection.ts::buildProcess` (lines 225-325) re-buckets factory rows using
   old `Factory Agent/…` path predicates (reads `row.path`, not stored `kind`).
   factory's `process/stages/*.md` match none → empty
   `{orchestrator:null, stages:[], agents:{…empty}, references:[]}`. The
   `"7-stage-build"` name + shape exist only at `translator.ts:249` and
   `projection.ts:305`.
3. **Real adapter dropped; broken synthetic served.**
   `projection.ts::buildAdapter` hardcodes `name:"acme-vue-node"` and emits a
   manifest with **no `schema_version`** → `getAdapter` rejects with
   `APIError.internal` (`browse.ts:109-124`). The real `acme-vue-encore` manifest
   (which carries `schema_version`) lands under the factory origin, which no
   adapter builder reads. `opcBundle.ts:329-365` ships the broken manifest +
   empty process to the OPC desktop with **no** `schema_version` guard.
4. **Ingest mutates owned content.** `oapNativeSanitise` rewrites manifests on
   ingest; the example-adapter ingest (`oapNativeIngest`) reads a non-existent
   `_tmp/factory/adapters/` (silent no-op; those adapters were retired upstream).
5. **A thin path already exists.** `api/factory/artifacts.ts` already serves
   substrate rows verbatim; only `/adapters`, `/processes`, `/contracts` +
   `opcBundle` still route through the projection.

## Requirements

### FR-001 — Statecraft is a thin consumer of owned factory content (normative)

For any source registered as an OAP-owned factory/template upstream, the sync
pipeline MUST store upstream bytes verbatim and MUST NOT mutate, re-bucket, or
synthesize content. Permitted derivations: content-addressed identity, `kind`
classification, per-org `user_body` overrides, and the admission validation
defined by spec 198 (enforcement, not compensation — see P-1).

### FR-002 — Adapter identity from the manifest (retire the synthetic `acme-vue-node`)

Adapters served by `/api/factory/adapters` (list + detail) MUST derive from
`adapter-manifest`-kinded substrate rows regardless of origin; `name`,
`version`, and manifest come from the parsed manifest YAML (factory
self-declares `acme-vue-encore` + `schema_version: "1.0.0"`). The synthetic
`acme-vue-node` (`projection.ts::buildAdapter`) and the `name:"acme-vue-node"`
literal (`translator.ts:340`) MUST be removed. `getAdapter`'s `schema_version`
guard stays (it now passes).

### FR-003 — Substrate origin derives from the configured source

`DEFAULT_FACTORY_ORIGIN` / `DEFAULT_TEMPLATE_ORIGIN` MUST stop being static
constants from the legacy scaffold config. The origin written to substrate rows MUST
derive from the configured `factory_upstreams` source; the read path
(`loadSubstrateForOrg`) MUST resolve origins from configuration. The prune key
`(orgId, origin, path)` is already origin-parameterized; this removes the
constants that make a repointed source carry a lying label and would silently
filter a third-party source using a different origin id.

### FR-004 — Retire `buildProcess`; serve process content opaque by kind

The categorical `buildProcess` projection, the `"7-stage-build"` name, and the
`Factory Agent/…` path predicates MUST be removed. Process content
(`process/stages|agents|skills/**`) is served by `kind` from the substrate,
uninterpreted by statecraft. **No process-shape schema is defined here** — the
run's governance is the admission envelope (spec 198), and "what is a process"
is answered by "whatever files a valid envelope," not by a statecraft-assembled
categorical object. (This resolves the design's OQ-1: content opaque here,
contract-defined governance in 198.)

### FR-005 — Serve substrate verbatim by kind (retire the projection translation)

`/api/factory/{adapters,contracts,processes}` MUST be served from the substrate
by `kind` and by the adapter's own manifest, not via
`projection.ts::projectSubstrateToLegacy`. `projection.ts` MUST be removed once
its consumers are migrated. Contracts are served as their schema bodies. The
wire shape MAY change (no backward-compat constraint); web tabs update in
lockstep.

### FR-006 — Migrate every projection consumer; honour the admission gate

`opcBundle.ts` (loadAdapter / loadLatestProcesses / loadLatestContracts) and
`runs.ts` MUST be rewired onto the substrate-direct path. The OPC bundle path
MUST gain the same `schema_version` guard `getAdapter` has, so a malformed
adapter never reaches the desktop engine. The serve/bind path MUST honour the
**spec-198 admission gate**: content from a factory that has not filed a
conformant, reconciled envelope MUST NOT be served or bound (fail-closed). Web
routes (`app.factory.{adapters,processes,contracts}.tsx`, `app.projects.new.tsx`)
render the new shapes.

### FR-007 — Remove ingest mutation and dead code

- `oapNativeSanitise` (manifest mutation on ingest) removed for owned sources
  (P-1 / spec 198 P-1: a manifest field is authored upstream).
- Retired example-adapter ingest (`oapNativeIngest` reading
  `_tmp/factory/adapters/`; `next-prisma`/`rust-axum`/`encore-react` in
  `OAP_NATIVE_ADAPTERS`) removed.
- `moduleCatalog.ts` reconciled against template's actual `modules/`
  (or its staleness documented if kept as a validator).
- `adapter-scopes.json` regenerated as a **derived projection** of the
  admitted `acme-vue-encore` sub-envelope (spec 198 FR-012): identity + Encore
  output layout flow from the manifest's `governance:` section, never from
  hand-editing. (Until the first admission runs, an interim hand-regeneration
  to the `acme-vue-encore` identity is acceptable, marked as such.)
- CLAUDE.md's `api/factory/process-stages/*` reference (never created) removed.

### FR-008 — Classification works for the owned layout without legacy coupling

`classifyArtifactKind` MUST classify factory's 3-layer layout correctly
without `Factory Agent/…` dependence; the orchestrator
(`process/agents/pipeline-orchestrator.md`) MUST be recognizable as the pipeline
orchestrator. `FACTORY_SOURCE_EXCLUDES` / `TEMPLATE_EXCLUDES` MUST be reviewed
against the owned repos and stripped of dead org-specific entries.

**Amendment (2026-06-29): `website/` exclusion and binary-content guard.**
The owned repos now carry a Docusaurus documentation site under `website/`
whose static assets (`favicon.ico`, fonts, social-card images) are binary.
The substrate body columns (`upstream_body` / `user_body` / `effective_body`)
are UTF-8 `text`; a NUL byte (`0x00`) in a binary file is rejected by Postgres
("invalid byte sequence for encoding UTF8: 0x00"), which aborts the ingest
transaction. Because the failure message embeds the offending payload, the
`failRun` write that should record the failure ALSO fails on the same NUL byte,
so the run never leaves `running` and is NSQ-requeued into a permanent stuck
state (observed in production 2026-06-27). FR-008 therefore additionally
requires:

1. `website/` is documentation, never factory or template content, and MUST be
   excluded by both `FACTORY_SOURCE_EXCLUDES` and `TEMPLATE_EXCLUDES`.
2. The upstream walker MUST skip any file whose body contains a NUL byte
   (defense-in-depth for binary content the path excludes miss), surfacing the
   skipped paths (`skippedBinaryPaths`) on the translation result so they are
   logged rather than silently dropped.
3. The sync worker's failure-recording path (`failRun`) MUST sanitize the error
   string (strip NUL bytes, cap length) before writing it to the `text`
   columns, so recording a failure can never itself throw. Recording a failure
   is the recovery path and must always succeed.

### FR-009 — Preserve the factory↔template split; scaffold source resolved at admission

The two-source model is preserved. No new multi-template abstraction:
additional templates are expressed by an adapter declaring its own scaffold
source **in its manifest** — `scaffold.source.{kind, remote, default_ref}`,
which is org-agnostic and open-standard. At admission (spec 198), statecraft
resolves `scaffold.source.remote` against the org's `factory_upstreams` rows
by normalized repo URL and records the resolved `source_id` + pinned ref on
the admission record; the create path and the scaffold scheduler read the
admission record. The flat `scaffold_source_id` manifest field (spec 140
§2.2 — injected at ingest by the sanitise layer FR-007 removes) is
**retired**; an unresolvable remote is an admission failure with the existing
actionable error UX ("register the upstream at /app/factory/upstreams").
Resolution-at-admission is enforcement, not compensation (P-1): the
org-scoped id is org configuration and never enters the open contract (spec
197 principle). This is the partial supersession of specs 140 §2.2 and 141
§2.1 declared in frontmatter.

## Acceptance criteria

- **AC-1 (empty process).** Process content served reflects factory's
  actual `process/**` by kind; no empty `7-stage-build`, no `Factory Agent/`
  dependence. (FR-004, FR-008)
- **AC-2 (adapter 500).** `GET /api/factory/adapters/acme-vue-encore` returns the
  parsed manifest (with `schema_version`), 200; no `acme-vue-node` served.
  (FR-002, FR-005)
- **AC-3 (stale dropdown).** The Create dropdown lists `acme-vue-encore`
  (manifest-sourced). (FR-002, FR-006)
- **AC-4 (origin honesty).** Substrate rows carry an origin derived from the
  configured source; a repoint updates it; a third-party origin id is not
  silently filtered. (FR-003)
- **AC-5 (desktop integrity + admission).** The OPC bundle never ships a
  manifest lacking `schema_version`; content from a non-admitted factory (per
  spec 198) is not served/bound. (FR-006)
- **AC-6 (no translation remains).** `git grep` for `acme-vue-node`,
  `7-stage-build`, `Factory Agent/` in statecraft source returns only history;
  `projection.ts` translation, the synthetic adapter, `oapNativeSanitise`, and
  the dead example-adapter ingest are gone. (FR-001/004/005/007)
- **AC-7 (split preserved).** factory and template remain two sources; no new
  multi-template abstraction; scaffold resolves its template via the
  manifest's declared `scaffold.source`, resolved at admission against
  `factory_upstreams` by repo URL; no code path injects or requires a flat
  manifest `scaffold_source_id`. (FR-009)
- **AC-8 (parity gates).** `make ci` / schema-parity / coupling gate pass; index
  + featuregraph golden regenerated.

## Out of scope

- The **governance envelope, admission validation, and ASI mapping** — spec 198
  (this spec consumes it).
- The OPC desktop factory **engine's** stage execution (spec 075).
- Scaffold prebuild/variant mechanics beyond manifest-sourced identity (FR-009).
- GoA-specific contract concepts (rejected by spec 197 FR-005).
- The factory↔template **merge** (declined; the split is permanent).

## Phasing (proposed; refine in plan.md)

0. **Spec 198 lands first** (envelope schema + admission gate). This spec
   consumes it.
1. **Ingest cleanup.** Origin-from-source (FR-003); strip `oapNativeSanitise`
   + dead example-adapter ingest (FR-007); generalize classification (FR-008).
2. **Read cutover.** Serve adapters/contracts/process from substrate by kind +
   manifest (FR-002, FR-005); delete `projection.ts`.
3. **Consumer migration.** Rewire `opcBundle` (+ guard + admission gate) and
   `runs`; update web tabs + Create form (FR-006).
4. **Hygiene.** `adapter-scopes.json`, `moduleCatalog`, CLAUDE.md
   `process-stages`, Rust test fixtures (FR-007); regenerate index.

## Cross-repo coordination

- **factory** ships the `acme-vue-encore` manifest with `schema_version`
  AND files a conformant governance envelope (spec 198) — the latter is the
  admission precondition this spec's serve/bind path enforces. Closes spec
  197's deferred adapter rename (`acme-vue-node` → `acme-vue-encore`) on the
  statecraft side.
- **template**: the adapter's manifest-declared scaffold source points
  at it (FR-009), and its `template.json::templateName` reverts to its own
  true name `template` (plus the matching zod default in
  `scripts/lib/template-json.ts`) — the spec-141 alignment doctrine is retired
  by this spec. Authoring dispatched 2026-06-09; merge-safe anytime (nothing
  in statecraft runtime-reads `templateName`).
- Sequencing (migration memory `project-template-lineage-research`): lands after
  the factory POC finalize + Windows handoff settle the owned-repo shape.

## Implementation log

- **2026-06-11 — FR-007 module-catalog cutover; implementation: complete.**
  The last FR-007 hygiene item lands: statecraft's `moduleCatalog.ts` (and
  the Create form's inline mirror) now reflect template's real
  `modules/` catalog — five modules, manifest-truthful descriptions,
  empty profile built-ins/presets (profiles select AUTH_DRIVER; modules
  are opt-in `--with` composition), retired `auth-*`/`session-store-*`/
  `service-auth`/`api-docs` ids rejected by `isKnownModule`. Riding the
  same change, `factory.ts` retires the `DEFAULT_SCOPE` fallback: an
  adapter absent from the adapter-scopes enforcement snapshot now refuses
  pipeline init fail-closed (spec 198 FR-012 enforcement) instead of
  inheriting a broader invented allowlist. With AC-1..AC-7 evidenced
  in this log (sealed ADMIT + UI verification, entries below), AC-8
  holding by this change's own gate run (`make pr-prep` coupling OK,
  index regenerated), and FR-007 fully closed, `implementation:` flips
  to `complete`.
- **2026-06-11 — first real (and first sealed) ADMIT; runtime-AC evidence.**
  After the FR-014 signing cutover (spec 198 implementation log, same date),
  an org re-sync produced a sealed `admitted` record (0 violations) for
  `statecrafting/factory` at sha `cc1139f…`. Evidence against the
  runtime ACs: **AC-1** — the factory origin's substrate carries
  `governance-envelope` (1), `process-stage` (8), `adapter-manifest` (1),
  agents (14 digests in the seal), all served by kind; no synthetic
  projection. **AC-4** — origins are `legacy-mixed` / `legacy-template-mixed`
  (source-derived); the stale post-rename source row
  `acme-vue-node → statecrafting/template` was deleted (audited
  `factory.source.deleted`), leaving exactly the two configured sources.
  **AC-7** — the admission's `scaffold_resolutions` binds `acme-vue-encore`
  to `legacy-template-mixed` / `statecrafting/template @ main`,
  resolved at admission; no flat `scaffold_source_id` involved. **AC-5** —
  a sealed admission now exists for the serve/bind gate to honour
  (unevaluated/unsealed refusal verified during the cutover window).
  **AC-2/AC-3** — operator-verified in the deployed UI (2026-06-11): the
  Adapters tab serves the parsed `acme-vue-encore` manifest at source sha
  `cc1139f…` (200, no synthetic adapter), the Create dropdown lists
  `acme-vue-encore @ 1.0.0`, and an end-to-end Create succeeded
  (test-project-01, commit #1 with seeded pipeline-state). **FR-007
  partial**: the interim hand-regenerated `adapter-scopes.json` is replaced
  by the spec-198 FR-012 derived projection (`adapter-scopes-compiler`,
  spec 105 amended 2026-06-11; re-derivation byte-identical) — but the
  same UI verification surfaced the remaining FR-007 hygiene item:
  `moduleCatalog.ts` still mirrors the retired template-distributor
  catalog (10 entries incl. express-session-era `session-store-*` and
  module-shaped `auth-*` ids) while template's real `modules/`
  catalog has 5 (`api-gateway`, `data-postgres`, `data-redis`,
  `security-core`, `user-management`; auth is the `AUTH_DRIVER` profile
  axis, not a module). A Create selecting a phantom module would fail at
  `add-module.ts`. (`implementation:` stayed `in-progress` until the
  catalog cutover — landed same day, entry above.)
- **2026-06-10 — AC-6 hygiene closure.** The live legacy remnants the
  AC-6 negative grep still caught after the main cutover PR (#313) are
  retired: `translator.ts::selectAdapter` no longer fabricates
  `acme-vue-node@0.0.0` for an adapter-less org (it throws; `import.ts`
  already guards that case with `failedPrecondition` before translating),
  `syncPipeline.ts::countByLegacyKind` stops counting the retired
  synthetic template-orchestrator adapter, and `repoInit.ts`'s
  `VALID_ADAPTERS` carries only the manifest-declared `acme-vue-encore`.
  Test fixtures, doc-comment examples, the statecraft CLAUDE.md
  read-path/scheduler narratives, the factory web index tile, root
  README's adapter section, and `docs/factory/{how-to,architecture}.md`
  (historical banners) follow. Remaining matches in statecraft source are
  history by construction: migrations 36/37, retirement notes, and the
  explicitly historical `adapter-agent-examples.md`. Runtime ACs (AC-1..AC-5) stay gated on the
  first real ADMIT after the Statecraft-side envelope merge + org re-sync —
  `implementation:` stays `in-progress`.
- **2026-06-11 — Rust-side fixture sweep (phasing item 4, FR-007).**
  The "Rust test fixtures" hygiene tail lands for `factory-engine` and
  `factory-contracts`: every LIVE test fixture, doc comment, and CLI
  help string carrying `acme-vue-node` (or the retired example adapters
  `next-prisma`/`rust-axum`/`encore-react` as arbitrary names) now uses
  the manifest-declared `acme-vue-encore`; the synthetic
  `acme-vue-node-template` origin fixtures become `template`
  (its true post-spec-141-retirement name); one capability-gap fixture
  uses the neutral `single-stack-example` since it deliberately models
  an incompatible adapter. Zero production-code occurrences existed
  (classification sweep, 2026-06-11): the only compiled-surface hits
  were the `factory_run` CLI help list and lib doc comments. Dead tests
  guarded on the spec-108-retired repo-root `factory/` directory
  (`preflight.rs::preflight_real_examples`,
  `integration_078_e2e.rs`, `adapter_registry.rs` discovery trio,
  `validation.rs` contract-example pair) are left verbatim as history
  by construction, per the AC-6 standard; their deletion is a separate
  decision tied to the dead-suite repair backlog. Remaining Rust-side
  matches outside this spec's crates (`factory-project-detect` unit
  fixtures, `factory-platform-client` mock responses) are live-fixture
  leftovers owed to specs 112/124 follow-ups.
- **2026-06-11 — specs 112/124 fixture follow-up closed.** The owed
  leftovers land: `factory-platform-client` wire mocks use
  `acme-vue-encore` + a neutral `second-adapter`;
  `factory-project-detect` current-protocol fixtures use the live
  names (`template` scaffold-only, `acme-vue-encore` ACP), while
  its legacy-detection fixtures KEEP `acme-vue-node` deliberately (they
  model real enterprise-factory-produced artifacts; the ACP-precedence test's
  decoy now differs from the ACP adapter name, making the provenance
  assertion meaningful). With this, `git grep acme-vue-node crates/`
  returns only history: dead factory/-guarded tests and the
  legacy-modelling detect fixtures.
