---
id: "112-factory-project-lifecycle"
slug: factory-project-lifecycle
title: Factory Project Lifecycle — Create, Import, Open
status: approved
implementation: in-progress
amended: "2026-06-28"
amendment_record: |
  amended by spec 199 (2026-06-11), editorial: factory-project-detect's
  current-protocol test fixtures use the live names (templateName
  "template" for scaffold-only; adapter "acme-vue-encore" in ACP
  pipeline-state). The legacy-detection fixtures intentionally KEEP
  "acme-vue-node": they model real-world enterprise-factory-produced artifacts
  whose template.json genuinely carries that name, and the ACP-precedence
  test's decoy marker now differs from the ACP adapter name, making its
  provenance assertion meaningful. No detection behavior change.
  138-statecraft-create-realised-scaffold (2026-05-04).
  self-amended (2026-06-05) — §6.3 Open-in-OPC handoff refined: the
  statecraft web-UI "Open in OPC" button now resolves its deep link via a
  lightweight GET /api/projects/:id/opc-deep-link endpoint instead of the
  full /opc-bundle, and the project layout route gained a shouldRevalidate
  guard. Motivated by a statecraft-api OOMKill — the full bundle minted a
  GitHub installation token on every project navigation (React Router v7
  single-fetch revalidation), which stacked with bulk-knowledge-upload
  extraction fan-out at the pod's 1Gi limit. Adds a refines: edge over the
  OPC-handoff consumer paths.
  self-amended (2026-06-10) — §5.2 failure-surfacing posture extended from
  pre-flight to mid-flight: scaffold/push and post-push DB failures raise
  typed (non-internal) APIErrors carrying the real cause + the orphaned
  scaffold-job id, because production Encore redacts internal messages to
  a generic 500. §5.3's scaffold-output VCS-free invariant graduated into
  the open standard (one normative sentence in
  standards/schemas/factory/adapter-manifest.schema.yaml `scaffold:`).
  self-amended (2026-06-12) — the Create flow now writes the spec-167
  `.kernel-version` born-with stamp into commit #1. perRequestScaffold.ts
  gained a step-5 write (after the L0 pipeline-state seed, before push) via a
  new sibling helper kernelVersionStamp.ts; create.ts threads adapter identity
  + manifest into it. The helper file is claimed by spec 167 (extends edge,
  the stamp is 167's concept — plan G4); this entry is the narrative record on
  112's side. No project-lifecycle contract change: the stamp is one
  additional commit-#1 artifact alongside `.factory/pipeline-state.json`.
  self-amended (2026-06-27) - §5.3 scaffold topology corrected for the
  factory-encore generator-product split (docs/analysis/
  acme-vue-encore-generator-product-split.md). The create-time generator
  (scripts/) and the module catalog (modules/) moved out of the
  scaffold-source repo (template-encore) into the factory-encore adapter
  (adapters/acme-vue-encore/), and the scaffold-source repo became a lean
  baseline. Warmup now clones BOTH owned upstreams: factory-encore for the
  generator + modules + tsx, template-encore as the --source baseline, and
  runs the adapter's manifest-declared entry_point. New §5.3.1 records the
  two-cache model. Confined to the spec-112-owned scaffold/ directory
  (templateCache.ts, scheduler.ts, perRequestScaffold.ts); no admission or
  DB-schema change, because the factory-encore repo+ref is already resolvable
  from the existing legacy-mixed factory_upstreams row. The six-operation
  decomposition is unchanged; only operations 1 to 3's source topology moves.
owner: bart
created: "2026-04-22"
kind: platform
domain: platform
summary: >
  Defines the contract-anchored lifecycle for factory-produced projects across
  three entry points: (1) OPC opens a local folder and recognises it as a
  factory project via ACP pipeline-state conformance; (2) Statecraft creates
  a new project by scaffolding an adapter and pushing to GitHub; (3)
  Statecraft imports an existing GitHub repo and registers it in the
  workspace. Anchors detection on the ACP contract layer (spec 074) and
  extends the translator (spec 108) to bridge legacy
  `legacy-factory`-shaped manifests. Absorbs the scaffold/push
  capability currently in the external `template-distributor` repo into
  statecraft; template-distributor is discontinued as a separate service.
depends_on:
  - "074-factory-ingestion"  # factory-ingestion (ACP contracts — Build Spec, Adapter Manifest, Pipeline State, Verification)
  - "075-factory-workflow-engine"  # factory-workflow-engine (engine that advances pipeline state)
  - "087-unified-workspace-architecture"  # unified-workspace-architecture (duplex channel, workspace-as-atom)
  - "094-unified-artifact-store"  # unified-artifact-store (where emitted artifacts land)
  - "108-factory-as-platform-feature"  # factory-as-platform-feature (translator, factory_adapters/contracts/processes tables)
  - "109-factory-pat-and-pubsub-sync"  # factory-pat-and-pubsub-sync (resolveProjectToken, project_github_pats, installation broker)
  - "110-statecraft-to-opc-factory-trigger"  # statecraft-to-opc-factory-trigger (run dispatch envelope)
  - "111-org-agent-catalog-sync"  # org-agent-catalog-sync (establishes the workspace-scoped sync pattern reused here)
establishes:
  - unit: { kind: crate, id: factory-project-detect }
  - unit: { kind: file, path: platform/services/statecraft/api/projects/create.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/projects/import.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/projects/opcBundle.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/projects/opcBundleHelpers.ts }
  - unit: { kind: directory, path: platform/services/statecraft/api/projects/scaffold }
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.projects.new.tsx }
  - unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.projects.import.tsx }
  - unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/factory_project.rs }
  - unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/keychain.rs }
  - unit: { kind: file, path: product/apps/opc/src/routes/factory/ProjectCockpit.tsx }
extends:
  - spec: "108-factory-as-platform-feature"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/factory/translator.ts }
  - spec: "108-factory-as-platform-feature"
    nature: additive
    unit: { kind: directory, path: standards/schemas/factory }
refines:
  # §6.3 amendment (2026-06-05) — the statecraft web-UI consumer of the
  # Open-in-OPC handoff needs only the deep link, not the full bundle. This
  # edge tightens the fetch/revalidation behavior of that handoff aspect
  # across the bundle's own test, the web API-client helper, and the project
  # layout route that renders the "Open in OPC" button. opcBundle.ts itself
  # is already established above.
  - aspect: "open-in-opc-handoff"
    unit: { kind: file, path: platform/services/statecraft/api/projects/opcBundle.test.ts }
  - aspect: "open-in-opc-handoff"
    unit: { kind: file, path: platform/services/statecraft/web/app/lib/projects-api.server.ts }
  - aspect: "open-in-opc-handoff"
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.project.$projectId.tsx }
---

# 112 — Factory Project Lifecycle — Create, Import, Open

> **Amended by spec 199 (2026-06-11), editorial.** The
> factory-project-detect current-protocol fixtures use the live names
> (`template`, `acme-vue-encore`); legacy-detection fixtures keep
> `acme-vue-node` deliberately, modelling real enterprise-factory-produced
> artifacts. No detection behavior change.

## 1. Problem

### 1.0 Provenance and end-to-end model

Two upstream repositories produce every project we Import:

- `statecrafting/legacy-factory` — the 5-stage AI factory (mirror
  of `ACME-OLD/the_factory`).
- `statecrafting/template` — the scaffold template the factory writes
  into.

The same two upstreams also feed spec 108's **factory sync** that
populates the org's `factory_adapters` / `factory_contracts` /
`factory_processes` rows. Import and ACP are therefore not parallel
pipelines — they are the same upstream projected twice: once as a
fully-produced Stage-5 project (the Import target, e.g.
`statecrafting/acme-example-portal`),
once as the Adapters/Contracts/Processes (the modular flow the imported
project is re-driven through after import). The lifecycle terminus is a
deployd-api deployment via a future ACP "deploy" stage — out of scope for
this spec (§11).

### 1.1 What none of the prior specs answer

Spec 108 made Factory a first-class platform feature (adapters / contracts /
processes as statecraft-owned entities). Spec 110 wired statecraft-initiated
run dispatch to OPC. Spec 111 established the workspace-scoped catalog
pattern for agents. What none of these specs answer:

**How does a project enter the workspace in the first place?**

Today there are three de-facto paths, none governed:

1. **Hand-rolled local clone.** A user `git clone`s a repo into some folder,
   opens it in OPC, and OPC has no way to recognise whether the repo is
   factory-produced, template-scaffolded, or unrelated. The "Factory" route
   in OPC (spec 076) assumes state it cannot detect.

2. **External `template-distributor` service.** A separate Express app in
   `statecrafting/template-distributor` provides an ad-hoc web UI for
   cloning the `template` repo, applying a profile, creating a GitHub repo,
   and pushing. It is not integrated with statecraft — no workspace binding,
   no policy gate, no audit, no adapter identity beyond the copied
   `template.json`.

3. **`legacy-factory` 5-stage pipeline.** The upstream AI factory
   (`ACME-OLD/the_factory`, mirrored at `statecrafting/legacy-factory`)
   produces `requirements/` + code directly into a template-scaffolded repo.
   Its output shape — `requirements/audit/factory-manifest.json` (5 stages),
   `requirements/audit/working-state.json`, ad-hoc `requirements/{ui,api}/build-spec.json`
   — predates the ACP contract layer and does not conform to
   `pipeline-state.schema.yaml` or `build-spec.schema.yaml`.

Symptoms:

- Opening `acme-vendor-onboarding-portal` in OPC shows
  no factory cockpit even though it is a fully-produced factory project.
- Statecraft cannot list the projects it owns in a workspace until they are
  manually registered.
- A user cannot click "Import Project" in statecraft and have the platform
  detect factory state, bind it to an adapter row, and make it available for
  reconciliation.
- `template-distributor` duplicates OAuth, workspace context, and org
  identity that statecraft already owns, and emits scaffolds that are not
  ACP-native (no `.factory/pipeline-state.json` seeded at generation time).

## 2. Decision

Define a single, contract-anchored lifecycle with three entry points. All
three converge on the same state representation: a
`pipeline-state.schema.yaml`-conformant document at
`<repo-root>/.factory/pipeline-state.json`, with a workspace-scoped
`projects` / `project_repos` row in statecraft (spec 108) linking to the
`factory_adapters` and `factory_processes` rows used to produce it.

### 2.1 Three entry points

1. **OPC Open** — open a local folder; detect via ACP conformance; surface
   the Factory Cockpit if positive.
2. **Statecraft Create** — pick an adapter, scaffold a new repo
   ACP-natively, push to GitHub, register; OPC claims it when the user
   opens the local checkout.
3. **Statecraft Import** — paste a GitHub URL (or pick from App
   installation); clone server-side, detect, translate legacy → ACP,
   register; OPC claims it on local open. **Scope bound (MVP):** Import
   accepts only fully-executed legacy projects — `LegacyProduced` with
   `legacy_complete == true` (all 5 `legacy-factory` stages marked
   complete). ACP-native (L2) detection is retained for forward
   compatibility but Import does not exercise it as a primary branch in
   this spec; no upstream ACP producers exist in the wild yet (the only
   path to an L2 repo today is re-cloning a project Create just produced
   — see §11). Scaffold-only, in-progress legacy, and non-factory repos
   are rejected (§6.2).

### 2.2 Template-distributor discontinued

The external `template-distributor` service is retired. Its capabilities —
clone the `template` repo, apply a profile via `template/scripts/setup-*.ts`,
create a GitHub repo, push — are absorbed into statecraft under
`api/projects/scaffold/`. Statecraft already owns the GitHub App, OAuth
flow, org identity, and workspace context this code needs. No new OAuth,
no new UI.

## 3. Contracts

### 3.1 Canonical state location

```
<repo-root>/.factory/pipeline-state.json   — conformant to pipeline-state.schema.yaml (spec 074)
```

This file is the single authoritative marker that a directory is a factory
project. It is committed to the repo (it travels with the code). OPC,
statecraft, and the factory engine all read and write it through the
consumer crate (§3.3) — never via ad-hoc JSON parsing (per
`.claude/rules/governed-artifact-reads.md`).

### 3.2 ACP schemas (from spec 074, vendored)

```
standards/schemas/factory/
  adapter-manifest.schema.yaml
  build-spec.schema.yaml
  pipeline-state.schema.yaml
  verification.schema.yaml
```

Schemas are compiled into Rust types with a compile-time `SCHEMA_VERSION`
const per the existing build-time schema rule. At runtime, statecraft
mirrors these schemas into the `factory_contracts` table (spec 108 §3)
per-org for policy-scoped lookups. The schemas themselves are the source
of truth; the DB mirror is an org-scoped projection.

### 3.3 Detection crate

New crate `crates/factory-project-detect/`:

```rust
pub enum DetectionLevel {
    NotFactory,
    ScaffoldOnly,      // L0 — template scaffolded, no pipeline run yet
    LegacyProduced,    // L1 — legacy-factory 5-stage manifest, needs translation
    AcpProduced,       // L2 — pipeline-state.json present and conformant
}

pub struct FactoryProject {
    pub level: DetectionLevel,
    pub pipeline_state: Option<PipelineState>,   // Some for L2; translated value for L1
    pub adapter_ref: Option<AdapterRef>,         // name + version from pipeline-state.adapter
    pub legacy_manifest: Option<serde_json::Value>, // L1 only — raw factory-manifest.json
    pub legacy_complete: Option<bool>,           // L1 only — true iff all 5 legacy stages marked complete
}

pub fn detect(repo_root: &Path) -> FactoryProject;
```

Detection logic:

| Files present | Level |
|---|---|
| `.factory/pipeline-state.json` (schema-conformant) | AcpProduced |
| `requirements/audit/factory-manifest.json` + `requirements/audit/working-state.json` | LegacyProduced |
| Scaffold-only signals (e.g. `template.json` with `templateName`, no pipeline-state, no legacy manifest) | ScaffoldOnly |
| None of the above | NotFactory |

For `LegacyProduced`, the crate also sets `legacy_complete = Some(true)`
iff every stage key in `factory-manifest.json` reports a terminal
completion status (schema: `completed` with a non-null
`completedAt`); otherwise `Some(false)`. Detection reports the state
truthfully; Import enforces the policy gate (§6.2).

The crate is consumed by OPC (via a Tauri command) and by statecraft (via
a Node addon or by shelling the crate's CLI bin — see §6.2). Both paths
read through the crate — no component parses the JSON directly.

### 3.4 Legacy translation

Legacy detection (L1) routes through statecraft's existing
`platform/services/statecraft/api/factory/translator.ts` (spec 108),
extended with:

```ts
export function translateLegacyManifest(
  legacy: GoaSoftwareFactoryManifest,    // 5-stage shape
  workingState: GoaWorkingState,
  orgAdapters: FactoryAdapter[],
): PipelineState;                        // pipeline-state.schema.yaml-conformant
```

Stage remapping table (legacy → ACP):

| Legacy stage | ACP stage id |
|---|---|
| `stage1_businessRequirements` | `business-requirements` |
| `stage2_serviceRequirements` | `service-requirements` |
| `stage3_databaseDesign` | `data-model` |
| `stage4_apiControllers` | `api-specification` |
| `stage5_clientInterface` | `ui-specification` |
| *(implicit)* | `pre-flight` (synthesised as `completed`) |
| *(implicit)* | `adapter-handoff` (synthesised from `fileOwnership` if present) |

`build-spec` production is deferred: legacy `requirements/{ui,api}/build-spec.json`
stays in place as informational artifacts until the project's next factory
run emits a unified ACP-conformant Build Spec. Detector does not demand
Build Spec conformance at L1.

### 3.5 Adapter identity

Scaffold-only projects (L0) must carry a minimal adapter reference so the
lifecycle can advance. The scaffold writer (§4.2) writes:

```json
// .factory/pipeline-state.json (L0 seed)
{
  "schema_version": "1.0.0",
  "pipeline": {
    "id": "<uuid>",
    "factory_version": "<semver>",
    "started_at": null,
    "status": "pending",
    "adapter": { "name": "acme-vue-node", "version": "3.0.0", "source_sha": "..." },
    "build_spec": { "path": null, "hash": null }
  },
  "stages": {}
}
```

`template.json` is **not** the adapter identity. It stays as a local
scaffold config (module inventory, `fileOwnership`) consumed by the
template's own `add-module.ts` / `remove-module.ts` tooling. Detection
does not read it except as a hint when `.factory/pipeline-state.json` is
absent.

## 4. OPC Open Path

### 4.1 Detection on folder open

When OPC opens a directory (via existing recents menu, File → Open, or
workspace sync from statecraft):

1. `product/apps/opc/src-tauri/src/commands/factory_project.rs` invokes
   `factory_project_detect.detect(path)` from the crate.
2. If `NotFactory`: no cockpit; standard editor view only.
3. If `ScaffoldOnly` / `LegacyProduced` / `AcpProduced`: surface the
   **Factory Cockpit** panel at `product/apps/opc/src/routes/factory/ProjectCockpit.tsx`.

### 4.2 Factory Cockpit

The cockpit reads pipeline-state (translated for L1) and shows:

- **Pipeline status** — running / paused / completed / failed / cancelled.
- **Stage timeline** — the 7 ACP stages with per-stage status, duration,
  artifact count. For L1 projects, stages are rendered from the translated
  view with a "legacy" badge; the two synthesised stages (`pre-flight`,
  `adapter-handoff`) are marked as such.
- **Adapter identity** — name + version from `pipeline.adapter`; links to
  the `factory_adapters` row in statecraft (via workspace context).
- **Drift indicator** — compares `pipeline.build_spec.hash` against the
  current Build Spec on disk (if present) and the adapter `source_sha`
  against the workspace's current adapter version in `factory_adapters`.
- **Actions** (each dispatches to the factory engine via the existing
  spec 110 envelope):
  - **Run next ACP stage** *(headline for imported L1 projects)* —
    advance pipeline from the current cursor. For a freshly-imported
    project, this is the first action the cockpit invites; it begins
    the modular ACP flow from the earliest non-completed translated
    stage and progresses toward the deployd-api terminus (§11).
  - *Reconcile* — spec-088-style drift reconciliation, incremental re-run
    from earliest dirty stage.
  - *Run Stage N* — explicit per-stage advance (power-user form of
    Run-next, retained for diagnosis and out-of-order replay).
  - *Re-extract artifacts* — run the prestart extractor on `.artifacts/raw/`
    (see §4.3); no-op when raw inputs are absent (common for imported
    legacy projects — see §10 risk).
  - *Register with workspace* — if the project is not yet bound to a
    statecraft `projects` row, create the binding and dual-write. Edge
    case — Import already binds; relevant only for OPC Open of a
    never-imported repo.

### 4.3 Artifact extraction as a birth-time step

The existing `.artifacts/extract_artifacts.py` script (raw → extracted)
is replaced by a Rust binary `crates/factory-artifacts/src/bin/extract.rs`
(matching the scripts-to-binaries direction of spec 105) and invoked
**at project birth on statecraft** (§5.2), not as an OPC pre-flight step.
Rationale: the extractor needs only the uploaded raw documents and
produces deterministic output; running it at Create time means the
repo's first commit already contains `.artifacts/extracted/`, so the
cockpit and the ACP engine never see a repo in a "raw-but-not-extracted"
intermediate state.

Storage split:

- **Raw uploads** live in statecraft's workspace-scoped bucket
  (audit-durable, re-runnable). Binary originals do not enter git.
- **Extracted outputs** live in the repo under `.artifacts/extracted/`
  and travel with the code. An `.artifacts/extracted/manifest.json`
  records the bucket-object-id → extracted-file mapping so Re-extract
  (§4.2) can re-run deterministically from bucket state.

The cockpit's **Re-extract** action runs the same binary locally on OPC
against any raw content added post-birth (e.g. a new business doc
dropped into a local `.artifacts/raw/` the user creates by hand) and
commits the updated `.artifacts/extracted/` entries.

Legacy prompt files (`prestart-prompt.txt`, `start-prompt.txt`,
`reconciliation-prompt.txt`) are **not generated** by the Create path
and are **not consumed** by the ACP engine. The `factory/` ACP
specification is the sole execution target (§11 Non-Goals). Imported
legacy projects retain their copies as historical artifacts; the engine
ignores them.

## 5. Statecraft Create Path

> **Amended 2026-05-04 (record: 138-statecraft-create-realised-scaffold).**
> When the absorbed scaffold subflow landed, four refinements settled
> details this section had deferred to "the production implementation":
> (1) the prebuild profile set is statecraft-owned, not adapter-driven
> (§5.3 row 2 below + spec 138 §2.1); (2) the Create transaction also
> inserts an `environments` row (§5.2 step 7 + spec 138 §2.2); (3) the
> form gates on a new `GET /api/projects/scaffold-readiness` endpoint
> (§5.1.1 + spec 138 §2.3); (4) the workspace dir is backed by an RWO
> PVC (§5.3 deployment note + spec 138 §2.4). See the
> `## Amendment record` section at the bottom of this spec for full
> rationale; spec 138 carries the audit trail.

### 5.1 UI — `/app/projects/new`

Form fields:

- **Workspace** (pre-selected from context).
- **Adapter** — dropdown of `factory_adapters` rows for the current org.
  Each shows name, version, and a short capability summary from the
  adapter manifest (dual-stack, auth methods, etc.).
- **Variant** — enum from `build-spec.schema.yaml` `project.variant`:
  `single-public`, `single-internal`, `dual`. The adapter manifest's
  `capabilities` gates which variants are offered (e.g. an adapter without
  `dual_stack: true` hides the `dual` option).
- **Project identity** — name (slug), display name, description, GitHub
  owner (from the user's App installations; private-by-default).
- **Seed inputs (optional)** — multifile upload of business documents
  (individual files, or a `.artifacts/raw/`-shaped directory archive).
  Raw uploads land in the workspace-scoped bucket; statecraft runs the
  extractor (§4.3) server-side; extracted outputs are written into
  `.artifacts/extracted/` in the generated tree and committed in commit
  #1. Binary originals remain in the bucket, not in git.

### 5.1.1 Scaffold-readiness gate

> Added by amendment 2026-05-04 (record: 137).

The form's loader fetches `GET /api/projects/scaffold-readiness`
alongside the adapter list and gates submit on its `canCreate` field.
The endpoint's response shape is contract-frozen here:

```json
{
  "ready": boolean,
  "step": "idle" | "cloning" | "cache-installing" |
          "building-minimal" | "building-public" |
          "building-internal" | "building-dual" |
          "ready" | "error",
  "progress": 0,                   // integer 0-100
  "error": string | null,
  "hasFactoryAdapter": boolean,    // org has at least one factory_adapters row
  "hasUpstreamPat": boolean,       // org has factory_upstream_pats configured
  "canCreate": boolean,            // = ready && hasFactoryAdapter && hasUpstreamPat
  "blocker": "warming-up" | "warmup-error" |
             "no-factory-adapter" | "no-upstream-pat" | null
}
```

`blocker` resolves in priority order (`no-factory-adapter` →
`no-upstream-pat` → `warmup-error` → `warming-up`) so the UI can pick
banner copy without re-deriving precedence. The endpoint is read-only
and idempotent; OPC may consume it for the same gate via the duplex
channel in a future spec.

### 5.2 Backend — `api/projects/create.ts`

Flow:

1. Validate form against `build-spec.schema.yaml` `project` + `auth`
   sub-schemas (workspace-scoped policy bundle enforces org rules).
2. Resolve the adapter's scaffold source (e.g. a git ref in the `template`
   repo, pinned by the `factory_adapters.source_sha` column) and clone
   into a per-request temp dir.
3. Run the adapter's scaffold entry point with the chosen variant and
   module profile. **Runtime scope (MVP):** statecraft executes only
   Node-24 entry points shaped like the `template` repo's
   `scripts/setup-app.ts` / `scripts/setup-dual-app.ts` (see §5.3 for
   the concrete absorbed surface). Adapters declaring a
   `scaffold.runtime` other than `node-24` are not Create-eligible via
   the web UI; a later spec may lift this by dispatching non-Node-24
   scaffolds to OPC over the spec 110 envelope.
4. **Seed ACP state**: write `.factory/pipeline-state.json` at L0 shape
   per §3.5, with `pipeline.adapter` populated from the `factory_adapters`
   row. Statecraft is the sole author of this file; OPC never writes
   commit #1.
5. **Extract seed inputs (if any)**: store raw uploads in the
   workspace-scoped bucket, invoke `factory-artifacts extract` against
   them server-side, and write the extractor's output under
   `.artifacts/extracted/` in the generated tree (plus an
   `.artifacts/extracted/manifest.json` mapping bucket object ids to
   extracted files). Raw binaries are **not** written into the repo.
6. Create the GitHub repo via the org's App installation and push the
   generated tree with a single initial commit. Commit author is the
   statecraft service identity; co-author is the user.
7. Insert rows into `projects`, `project_repos`, `project_members`, and
   `environments` (spec 108) within a single DB transaction. The
   `projects` row carries `factory_adapter_id`; the `environments` row
   is `kind=development` with `k8s_namespace=oap-{orgSlug}-{projectSlug}-dev`,
   so subsequent deploy paths land on a pre-existing env row instead of
   one path lazy-creating and the other not. No K8s namespace is
   created at Create time; the deployd-api dispatch itself remains
   §11 non-goal. Emit a `project.created` audit event with
   `devEnvironmentId` in the metadata. *(amends 2026-05-04 — environments
   row added per spec 138 §2.2.)*
8. Return `{ project_id, repo_url, clone_url }` for the UI to link to.

**Failure surfacing (amended 2026-06-10):** the pre-flight posture —
actionable `APIError.failedPrecondition` with the real cause, never the
Encore-wrapped generic 500 — extends to mid-flight failures. Scaffold/push
failures (between repo creation and commit #1) and post-push DB failures
raise **typed, non-internal** errors (`aborted`) carrying the underlying
message (already token-redacted by the subprocess wrappers) plus the
orphaned `scaffold_jobs` row id, because production Encore redacts
`internal` messages — the user would otherwise retry blind against a
cause only visible in pod logs, while `scaffold_jobs.error_message`
already held the truth.

### 5.3 What is absorbed from template-distributor

Statecraft's server-side scaffold scope is **exactly** the six operations
that `template-distributor/src/server.ts` performs today. Line references
point at the canonical implementation at the time this spec was drafted;
the absorbing PR rewrites these in statecraft idioms, it does not import
the code.

| # | Template-distributor capability | Reference | Lands in statecraft as |
|---|---|---|---|
| 1 | Template cache clone + `npm install` + upstream-SHA refresh | `ensureTemplateCache`, server.ts:329-375 | `api/projects/scaffold/templateCache.ts` (per-workspace cache, keyed on `factory_adapters.source_sha`) |
| 2 | Profile prebuilds (minimal/public/internal/dual) | `ensurePrebuilts`, server.ts:377-446 | `api/projects/scaffold/templateCache.ts` (warm-on-startup; profile set is **statecraft-owned**, mirroring template-distributor's hardcoded set in `moduleCatalog.ts` — amends 2026-05-04 per spec 138 §2.1. Manifest §8 `scaffold.profiles` remains forward-compat for non-template adapters) |
| 3 | Per-request scaffold: copy prebuilt + run `setup-*.ts` + `add-module.ts` for extras | server.ts:613-760 | `api/projects/scaffold/perRequestScaffold.ts` (Node-24 subprocess in a per-request temp dir, concurrency-bounded) |
| 4 | Create GitHub repo + grant team admin (with retry) | `createRepo` + `teams.addOrUpdateRepoPermissionsInOrg`, server.ts:865-897 | `api/projects/scaffold/githubRepoCreate.ts` |
| 5 | Initial git commit + authed push to `main` | server.ts:899-927 | `api/projects/scaffold/githubPushInitial.ts` — uses the existing App installation token via `authedGitUrl` pattern (server.ts:285-300) |
| 6 | Post-push cleanup of server-side working tree | server.ts:929-931 | Inlined in the scaffold handler; temp dir is dropped after successful push |

**Net additions** (statecraft-owned, not in template-distributor):

- L0 `.factory/pipeline-state.json` seed written into the tree before
  commit #1 (§5.2 step 4).
- Server-side artifact extraction from bucket uploads into
  `.artifacts/extracted/` (§5.2 step 5).
- Server-side codebase-index regeneration over the FINAL scaffold tree
  before commit #1 (spec 220 AC-2). The generator (factory-encore
  `born-with.ts`) strips the template's `.derived/` precisely because it
  must be recomputed against the produced tree, which differs from the
  template (seeded specs, born-with `Makefile` + `tools/lint`, the added
  `.github/workflows/oap-build.yml`, per-profile modules). `create.ts` runs
  the pinned `spec-spine compile` + `index` + `index check` over the tree
  (`regenerateProducedIndex` in `perRequestScaffold.ts`, the
  `regenerate-index` job step) so commit #1 ships a fresh, committed index.
  Fail-closed: a scaffold that cannot produce a fresh index orphans the job
  rather than pushing a red-on-arrival repo. Without it, every produced
  app's own born-with `spec-spine index check` gate exits 3 on its first
  commit, which also blocks the spec 220 certificate emission.
- `scaffold_jobs` table replacing the Express app's in-memory map
  (concurrency-safe, multi-tenant, audit-traceable).
- `opc://` deep-link on the success response (§5.4).

**Scaffold-output invariant (amended 2026-06-09, template
cutover):** the tree operation 3 hands to operation 5 is **VCS-free** —
repository initialization belongs exclusively to operation 5
(`gitInitAndPush` owns commit #1 on a tree with no prior git state).
Template generators MAY run `git init` in their own output for
manual/developer use (the legacy template did so at the destination root;
template's `setup-dual-app.ts` does so per variant directory), so
the per-request copy strips `.git` entries at **any depth**, alongside
`node_modules`. Failure mode this guards: a per-variant `git init` plants
an embedded commit-less repository inside the project tree, and operation
5's `git add -A` hard-fails with `'<dir>/' does not have a commit checked
out` — the 2026-06-09 production create failure under the dual profile.
The legacy single-profile case only worked by coincidence (the carried
`.git` sat at the root, where operation 5's own `git init` reused it).
*(Graduated 2026-06-10 into the open standard: the normative VCS-free
sentence now also lives in
`standards/schemas/factory/adapter-manifest.schema.yaml` under
`scaffold:`, so third-party adapter authors inherit the obligation —
statecraft's strip-at-any-depth remains the defensive enforcement.)*

**Net drops:**

- The standalone web UI (`template-distributor/public/*`) — statecraft
  `/app/projects/new` owns the UX.
- OAuth login / session middleware (template-distributor server.ts:90-512) —
  statecraft already owns identity.
- ZIP download (`/api/download-project`, server.ts:789-825) — statecraft
  does not offer a "download tree" path; the GitHub repo is the handoff.

OAP does not import code from `template-distributor` — the absorbing
PR rewrites the six operations above in statecraft idioms. The
external repo lives outside this project's control; §9 Phase 9
describes what OAP retires on its side, not the upstream repo's fate.

**Deployment** *(amends 2026-05-04 per spec 138 §2.4)*: the absorbed
scaffold subflow is mounted at `${STATECRAFT_WORKSPACE_DIR}` (default
`/var/statecraft/workspace`). The path is backed by a `ReadWriteOnce`
`PersistentVolumeClaim` declared in
`platform/charts/statecraft/templates/workspace-pvc.yaml` (default
10Gi, cluster-default `StorageClass`). Persistence is togglable via
`workspace.persistence.enabled` for dev clusters without a CSI driver;
the chart fails at `helm install/upgrade` time when `replicaCount > 1`
while persistence is enabled because RWO is incompatible with horizontal
scaling. Per-cloud `StorageClass` overrides land in
`platform/charts/statecraft/values-{azure,aws,gcp,do,hetzner}.yaml`;
Hetzner uses the `hcloud-volumes` cluster-default and needs no override.

### 5.3.1 Generator-product split: the two-cache warmup *(amended 2026-06-27, refined 2026-06-28)*

After the 2026-05-04 and 2026-06-11 amendments, the owned upstreams executed
the **generator-product split** recorded in
`docs/analysis/acme-vue-encore-generator-product-split.md`. The create-time
generator (`scripts/`) and the module catalog (`modules/`) moved out of the
scaffold-source repo (`template-encore`) into the **factory-encore adapter**
at `adapters/acme-vue-encore/`; `template-encore` became a lean, runnable
baseline carrying no generator machinery. This invalidates the §5.3
assumption (rows 1 to 3) that the generator scripts and `tsx` live inside the
cloned scaffold-source tree. The six-operation decomposition is unchanged;
only the **source topology** of operations 1 to 3 changes.

**Two caches, not one.** Warmup clones both owned upstreams into the workspace:

| Cache | Repo (`factory_upstreams` row) | Carries | Role |
|---|---|---|---|
| `_factory-cache` | factory-encore (`source_id = legacy-mixed`, role `mixed`) | `adapters/acme-vue-encore/{scripts,modules}/` + `tsx` devDep | the generator + module catalog |
| `_template-cache` | template-encore (`source_id = legacy-template-mixed`, role `scaffold`) | lean `apps/`, `packages/` baseline | the `--source` baseline the generator composes onto |

Operations 1 to 3 of §5.3 are re-bound accordingly:

| §5.3 op | Was | Now |
|---|---|---|
| 1 (cache clone + `npm install`) | clone scaffold-source only | clone **both** upstreams; `npm install` in each (`tsx` resolves from `_factory-cache`) |
| 2 (profile prebuilds) | run `_template-cache/scripts/setup-*.ts` | run `_factory-cache/adapters/acme-vue-encore/scripts/setup-*.ts --source _template-cache` |
| 3 (per-request module compose) | run `_template-cache/scripts/add-module.ts` | run `_factory-cache/.../scripts/add-module.ts` with `ROOT=<dest>` |

**Factory-encore coordinates need no new admission fact.** The adapter's
`scaffold.source.remote` continues to resolve template-encore into
`admission.scaffoldResolutions` (spec 199 FR-009). The factory-encore
repo+ref is a configuration fact read directly from the `legacy-mixed`
`factory_upstreams` row via
`resolveScaffoldUpstream(orgId, LEGACY_SINGLETON_SOURCE_ID)`; the admission
record and DB schema are unchanged. `WarmupContext` gains `factoryRepoUrl` /
`factoryRef`, and an unconfigured factory upstream surfaces as a
`no-factory-source` warmup-resolution failure (a sibling of the existing
warmup blockers, not a new admission gate).

**Entry-point dispatch is manifest-declared.** The generator exposes two
entry points, both declared in the adapter manifest's
`governance.scaffold_execution.entry_points_from` (a field owned by spec 198,
not re-authored here): the single-app `scaffold.entry_point`
(`scripts/setup-app.ts`, for the `minimal` / `public` / `internal` profiles)
and the dual-app `dual_stack.generator` (`scripts/setup-dual-app.ts`, for
`dual`, which takes no `--profile`). The prebuild step selects the entry
point by profile, exactly as it did when both scripts lived in the template
repo.

**Profile module sets become manifest-authoritative** *(this supersedes the
2026-06-11 "empty profile built-ins" stance for the template adapter)*. The
adapter manifest's `profiles[].modules` is the authority for which modules a
profile ships by default (today: `internal` ships `["user-management"]`, all
others `[]`). **The generator reads this authority directly.** `setup-app.ts`
parses the adapter manifest (factory-encore `lib/adapter-manifest.ts`) and
composes a profile's declared modules together with any `--with` extras,
dependency-ordered and deduped, in addition to setting `AUTH_DRIVER`. So warmup
runs `setup-app.ts --profile <name> --source _template-cache` with **no module
translation of its own**: an `internal` prebuild contains `user-management`
because the generator composed it from the manifest, not because warmup passed
`--with`. An earlier draft of this amendment had warmup translate
`profiles[].modules` into `--with` flags; that is superseded by the
generator-side reading, which keeps the generator self-contained (it produces a
correct app run standalone, with no orchestrator that must know the
profile-default set) and avoids two places computing the same set. User-selected
extras still compose per-request via operation 3 (`add-module.ts`); in
factory-encore `setup-app` and `add-module` share one `install-module` path, so
prebuild and per-request composition are identical. Reading the default set from
the manifest rather than from a statecraft-side table is the thin-consumer
posture (spec 199): the manifest is the authority, the generator and statecraft
consume it. `moduleCatalog.ts` remains the UI display/ordering catalog only (its
module ids still mirror the adapter's `modules/`); the profile-default authority
is the manifest read by the generator, not a statecraft table.

**VCS-free output is preserved automatically.** Operations 2 and 3 already run
under `NO_INSTALL=true`, which in the moved generator implies `--no-git`
(suppressing the per-variant `git init` for both single and dual profiles).
The §5.3 strip-`.git`-at-any-depth defense in operation 3's copy is retained
as belt-and-suspenders, so the 2026-06-09 dual-profile `git add -A` exit-128
failure mode cannot recur.

**Cache invalidation spans both upstreams, and prebuilds are immutable
snapshots.** The prebuilt cache key combines the resolved template-encore and
factory-encore SHAs (a new module or a generator-script change in factory-encore
invalidates the prebuilds), and the background refresher polls both repos'
branch HEADs. Prebuilds are materialised under a **SHA-stamped, immutable**
directory (`_prebuilt/<combined-sha>/<profile>`) behind an atomically-swapped
`current` pointer: the refresher writes a new sha-dir and flips the pointer with
`rename` (the same temp-then-rename discipline the cache clone already uses),
and an old sha-dir is removed only after in-flight requests referencing it have
drained. This replaces the in-place `rm`-then-regenerate of the prior
implementation, which could expose a half-written tree to a per-request copy
already in flight when a refresh begins.

**Concurrency and isolation.** Concurrent creates do not interfere: each request
copies its chosen prebuilt into a unique per-request temp dir
(`create.ts` `mkdtemp`), reading the immutable sha-stamped prebuilt read-only, so
two operators creating different profiles at the same time (e.g. `public` and
`dual`) never share a tree. Warmup is single-pod by construction: the workspace
PVC is `ReadWriteOnce` and the chart fails to render with `replicaCount > 1` when
persistence is enabled (`platform/charts/statecraft/templates/workspace-pvc.yaml`),
so no second replica mutates the shared prebuilts; a single-flight guard prevents
the startup warmup and the 30-minute refresher from regenerating concurrently
in-pod. (Horizontal scaling requires `persistence.enabled=false`, in which case
each pod self-warms its own ephemeral workspace and the same isolation holds.)

**Freshness posture.** Prebuilds are keyed by the SHAs warmup recorded for the
admitted scaffold refs, so create scaffolds from the content the warmup
materialised, never from an arbitrary live `main`. Three freshness cases: no
admission at all is a hard pre-flight block (`create.ts` `failedPrecondition`,
"run factory-sync"); an admission that advanced past the local prebuild
auto-rebuilds the prebuild via the SHA cache-key mismatch (no operator action);
and an upstream `main` that has moved ahead of the admitted content is an
**advisory** ("updates available, re-sync to admit"), not a hard create gate,
because creating from admitted-but-not-latest content is the governed,
reproducible behaviour. Freezing the exact admitted SHA *at admission time*
(so `ScaffoldResolution` records a SHA, not only a `ref`, and warmup clones that
SHA rather than the branch tip) is a stronger governance posture tracked
separately under specs 198/199; this amendment does not change the admission
contract.

**Diff surface (pending implementation).** The implementation will be
confined to the spec-112-owned `scaffold/`
directory: `templateCache.ts` (second clone, repointed script/`tsx` paths,
`--source`, `--profile` only with no warmup-side module translation, SHA-stamped
immutable prebuilds + atomic `current`-pointer swap, single-flight warmup,
combined cache key, dual-repo poll), `scheduler.ts` (resolve the
`legacy-mixed` row into the context, `no-factory-source` variant), and
`perRequestScaffold.ts` (repointed `add-module.ts` path, copy from the
sha-stamped snapshot). `admission.ts`, `upstreams.ts`, `create.ts`, and
`moduleCatalog.ts` are unchanged (the profile-default authority is the manifest,
read by the generator, so statecraft needs no module-translation table).

### 5.4 Statecraft–OPC boundary

This spec establishes a crisp temporal boundary between the two planes:

- **Statecraft owns repo birth.** Template clone/cache, profile prebuild,
  module composition, Node-24 adapter scaffold, L0 pipeline-state seed,
  server-side artifact extraction, GitHub repo creation with team
  grants, initial commit + authed push. Post-push, statecraft deletes
  its working copy.
- **OPC owns everything else.** Open, claim, cockpit actions (Run Stage
  N, Reconcile, Re-extract, Register-with-workspace), all ACP engine
  runs, all writes to `.factory/pipeline-state.json` after commit #1.
  Dispatch from statecraft uses the spec 110 envelope
  (`factory.run.request` / `factory.run.ack`).

Consequence: the **GitHub repo is the source-of-truth handoff**. After
push, statecraft returns `{ project_id, repo_url, clone_url,
opc_deep_link }`. The `opc_deep_link` is an
`opc://project/open?url=<clone_url>&project_id=<id>` URI that, when
clicked on a machine with OPC installed, clones the repo locally and
activates the Factory Cockpit (§4). The success page renders (a) the
GitHub URL, (b) the deep link, and (c) an "install OPC" affordance
visible when the user agent is not OPC and the deep link fails to
resolve.

No ongoing lifecycle operation executes on statecraft. "Birth on
statecraft, life on OPC" is the invariant; a future spec may dispatch
non-Node-24 births to OPC but will not move post-birth execution onto
statecraft.

The clone-token mechanics described in §6.4 apply identically to the
Create path: the success page's `opc_deep_link` resolves a fresh clone
token at the moment OPC fetches the bundle (not at deep-link emission
time), and OPC threads that token into the local clone subprocess and
the factory engine launch. Create is in fact the easier case — for a
just-created repo, the org's GitHub App installation is guaranteed
present, so token resolution always lands on the installation-token
branch (never the project-PAT fallback).

## 6. Statecraft Import Path

### 6.1 UI — `/app/projects/import`

Form fields:

- **Workspace** (pre-selected).
- **Source** — either (a) pick from GitHub App installation repos, or (b)
  paste a GitHub URL (the server validates App access before proceeding).
- **Import mode** — auto-detected after clone; form confirms the detected
  level (§3.3) and, for L1, shows the translator's preview (which ACP
  stages the legacy manifest will become).

### 6.2 Backend — `api/projects/import.ts`

Flow:

1. Validate App installation access to the target repo.
2. Clone into a per-request temp dir at the default branch HEAD.
3. Invoke the detection crate (via a small Rust CLI bin
   `factory-project-detect inspect <path> --json`) and parse its
   structured output. This is a governed consumer read per
   `.claude/rules/governed-artifact-reads.md` — no ad-hoc JSON parsing on
   the Node side.
4. Branch on detection level:
   - **NotFactory**: reject with "not a factory project". Import is for
     factory-produced repos only. Adopting an unrelated repo as a
     factory project belongs to a future "Adopt" spec with its own UX
     and policy gates.
   - **ScaffoldOnly**: reject. Scaffold-only is a transient birth state
     owned by Create (§5); importing an unrun scaffold has nothing to
     translate or register meaningfully. The user should Create fresh
     or run the legacy pipeline upstream to completion before
     importing.
   - **LegacyProduced**: enforce `legacy_complete == true` (all 5
     `legacy-factory` stages marked complete in
     `factory-manifest.json`). If incomplete, reject with a message
     identifying which stages are incomplete and instructing the user
     to finish the legacy run upstream before re-importing. If
     complete, run `translateLegacyManifest` (§3.4), preview the
     translated pipeline-state to the user, and on confirm open a PR
     against the source repo adding `.factory/pipeline-state.json`
     alongside the legacy manifest files (which stay — they are never
     deleted by this flow).
   - **AcpProduced**: *(forward-compat path; not the primary Import shape
     — see §11.)* validate pipeline-state schema version, confirm adapter
     binding, register without translation.
5. Insert `projects` / `project_repos` rows. Emit `project.imported`
   audit event including the detection level and (for L1) the translator
   version.
6. Return `{ project_id, detection_level, deep_link }` where `deep_link`
   is an `opc://` URI the user can click to hand off to OPC (which clones
   locally and surfaces the Factory Cockpit).

### 6.3 Open-in-OPC handoff

Once an Import succeeds, the statecraft project menu surfaces an
**Open in OPC** action. Clicking it does not move data over the wire —
it triggers a resolution on OPC against state statecraft already owns.
The same handoff is what Create's deep link (§5.4) drives; Import simply
reuses it once the imported project has a `projects` row and a
translated `.factory/pipeline-state.json` in the source repo.

1. **Deep link.** Statecraft emits
   `opc://project/open?project_id=<id>&workspace_id=<ws>&clone_url=<url>`.
   The success page renders this link plus an "install OPC" affordance
   for users without OPC installed.

2. **Bundle fetch.** OPC fetches the bundle from
   `GET /api/projects/:projectId/opc-bundle` *before* attempting any
   clone. The bundle response carries (a) the four resolved entities
   listed in step 3, and (b) a short-lived `clone_token` resolved per
   §6.4. Fetching the bundle first means OPC never has to retry the
   clone after a 401; the token is already in hand when the subprocess
   spawns.

3. **Local clone.** OPC clones `clone_url` locally if not already
   present, injecting the bundle's `clone_token` into the subprocess
   per §6.4. The cloned repo carries `.factory/pipeline-state.json`
   written by the Import PR (§6.2 step 4). Post-clone, OPC sets the
   recorded `git remote origin` URL back to the bare HTTPS form so the
   token does not sit in `.git/config`.

4. **Bundle resolution.** OPC binds the local checkout to the workspace
   via the existing duplex channel (spec 087) using the four entities
   already retrieved in step 2 — none of which travel on the wire as a
   new payload; they are reads against state statecraft already maintains:

   - **Adapter** — the `factory_adapters` row referenced by
     `projects.factory_adapter_id` (set by Import per §6.2 step 5 from
     the translator's adapter resolution, or by Create per §5.2 step 7).
   - **Contracts** — the org's `factory_contracts` rows synced via spec
     108. OPC pulls them through the existing catalog envelope; no
     per-project mirror.
   - **Processes** — the org's `factory_processes` rows, same path.
   - **Agents** — the workspace-scoped agent catalog from spec 111. The
     set of agents bound to this project is the workspace catalog
     filtered by the adapter's declared agent compatibility. Per-project
     agent overrides are out of scope here; a future spec may introduce
     them.

5. **Cockpit activation.** OPC opens Factory Cockpit (§4.2) with the
   L1-translated `pipeline-state.json` and the resolved bundle. The
   cockpit's headline action for a freshly-imported project is **Run
   next ACP stage** (§4.2) — the modular ACP flow begins from the
   earliest non-completed translated stage.

6. **First run dispatch.** When the user clicks Run next ACP stage, the
   cockpit dispatches via the existing spec 110 `factory.run.request`
   envelope. The factory engine subprocess inherits a `GITHUB_TOKEN`
   environment variable holding the current clone token (§6.4). The
   spec 110 envelope payload itself does not carry the token — token
   threading is an OPC-local concern. Knowledge bundles and business
   docs continue to materialise per spec 110 §2.3.

The deep link is therefore deliberately small on the wire (identifiers
only — never a token), and the bundle response is large (adapter +
contracts + processes + agents pulled from the catalog the workspace
already syncs, plus a short-lived clone token derived from spec 109
state). The authority invariant from spec 087 holds: the GitHub repo
is the source-of-truth handoff for project content; statecraft is the
source-of-truth handoff for governance state, including the
authoritative long-lived PAT; OPC composes the two, holds only
short-lived derived credentials, and runs.

> **Amendment (2026-06-05) — web-UI deep-link split (`/opc-deep-link`).**
> Steps 2–6 above describe **OPC-the-desktop-client's** consumption of the
> handoff: it legitimately needs the full bundle (adapter + contracts +
> processes + agents + a short-lived clone token, §6.4) to clone and run.
> The **statecraft web UI** is a *second, lighter* consumer of the same
> handoff: the project layout header renders the `opc://` deep link as an
> "Open in OPC" button and needs only the deep-link string and the adapter's
> display name — never the catalog payload, never a clone token.
>
> Wiring that header to `GET /api/projects/:projectId/opc-bundle` was a
> defect. Under React Router v7 single-fetch the project layout loader
> (`web/app/routes/app.project.$projectId.tsx`) revalidates on every
> navigation within a project, so each tab hop re-ran the full bundle —
> minting a fresh GitHub **installation token** (§6.4.1) per navigation and
> loading the org substrate three times for data the header never reads.
> During a bulk knowledge-directory upload this per-navigation churn stacked
> with the extraction fan-out (spec 115) and OOMKilled the `statecraft-api`
> pod at its 1Gi limit.
>
> Resolution (two parts, both reflected in the `refines:` edge in
> frontmatter):
>
> 1. **`GET /api/projects/:projectId/opc-deep-link`** (`getProjectOpcDeepLink`
>    in `api/projects/opcBundle.ts`) — a lightweight sibling returning only
>    `{ deepLink, adapterName }`. It reuses `buildOpcBundle` so the deep-link
>    derivation stays byte-identical to the full endpoint, but mints **no**
>    clone token and loads **no** contracts/processes/agents. The web header
>    consumes this; OPC-the-client keeps using the full `/opc-bundle`
>    unchanged — its contract in steps 2–6 is not altered.
> 2. **`shouldRevalidate`** on the project layout route — the deep link is
>    invariant while the user stays within one project, so the loader is not
>    re-run on plain navigation between child tabs (it still revalidates on
>    project change, on mutations, and on same-URL revalidations).

### 6.4 Bundle authentication and pipeline token threading

The handoff bundle (Create §5.4 success page, Import §6.3 Open-in-OPC)
is the only path by which OPC obtains the GitHub credentials it needs
to (a) clone a private project repo, and (b) run the factory pipeline
against GitHub-backed adapters/contracts. This subsection specifies
how the credential travels — short-lived, derived, never the
authoritative PAT.

#### 6.4.1 Token shape and source

The bundle carries a **clone token**, not a PAT. The clone token is
whatever spec 109's `resolveProjectToken(orgId, projectId,
targetGithubOrgLogin, { contents: "read", metadata: "read" })`
returns — either:

- A GitHub App **installation token** (TTL ~1h, revocable at the org
  level, audited via spec 109 §8). Preferred path; always taken when
  the target GitHub org has an active App installation for the OAP
  org.
- A **project PAT** loaded from `project_github_pats` (long-lived,
  org-encrypted, used only when the target org has no App
  installation — typically external-org imports). The PAT itself is
  what the bundle returns in this branch; OAP cannot mint a derived
  short-lived form of an arbitrary PAT.
- `null` for public repos. OPC clones anonymously; the factory engine
  runs with no `GITHUB_TOKEN` set and falls back to anonymous calls
  (rate-limited).

The bundle response surfaces both fields: `clone_token.value` and
`clone_token.source` (one of `github_installation` |
`project_github_pat` | `null`). OPC's refresh logic (§6.4.4) only
fires for `github_installation` — PATs do not expire on a schedule.

#### 6.4.2 Bundle endpoint extension

`platform/services/statecraft/api/projects/opcBundle.ts` is extended:

```ts
type OpcBundle = {
  // existing fields: adapter, contracts, processes, agents, ...
  clone_token: {
    value: string;
    source: "github_installation" | "project_github_pat";
    expires_at: string | null;  // ISO-8601; null for project_github_pat
  } | null;
};
```

Implementation: the handler resolves `targetGithubOrgLogin` from the
`project_repos.github_org` row, then calls `resolveProjectToken` with
`{ contents: "read", metadata: "read" }`. On resolution failure (App
broker timeout, PAT decrypt error), the bundle handler returns 503
with an actionable error rather than degrading to `null` — silent
degradation would surface as "private repo, anonymous clone failed"
deep in the OPC subprocess.

A separate **refresh endpoint** `GET /api/projects/:projectId/clone-token`
returns just the `clone_token` field with the same resolution logic.
OPC calls this when the cached token is within a refresh window
(§6.4.4); fetching the full bundle on every refresh is wasteful.

#### 6.4.3 OPC-side clone injection

`product/apps/opc/src-tauri/src/commands/factory_project.rs::clone_project_from_bundle`:

- `CloneProjectRequest` gains a `github_token: Option<String>` field.
- Before invoking `Command::new("git")`, the `clone_url` is rewritten
  to `https://x-access-token:<token>@github.com/<owner>/<repo>.git`
  for the subprocess only. The original `clone_url` is preserved.
- The token MUST NOT be passed via `git config` or any persistent
  state. Token-bearing URL is local to the `Command::new("git")` args
  vector for one invocation.
- Post-clone, `git remote set-url origin <bare_clone_url>` runs to
  guarantee the token is not written into `.git/config` by the clone
  itself. (Modern git does not write the URL back, but the explicit
  reset is a belt-and-braces invariant.)
- Error output from the subprocess MUST be scrubbed of any token
  substring before logging or surfacing to the UI.

#### 6.4.4 OPC-side persistence and refresh

The clone token (NOT the long-lived PAT, even when the resolution
source is `project_github_pat`) is stored in the OS keychain via the
existing `product/apps/opc/src-tauri/src/commands/keychain.rs` abstraction
under the slot `github-clone-token:<project_id>`. Stored alongside is
the `expires_at` value as a separate keychain entry
`github-clone-token-expiry:<project_id>`, or as a JSON-encoded blob
under one slot — implementation-defined.

Refresh policy:

- **Installation tokens** (1h TTL): OPC fetches a fresh token from
  the refresh endpoint when the cached token has less than 5 minutes
  of remaining TTL, or on any 401 response from a GitHub call made
  through this token.
- **Project PATs** (no TTL): OPC re-fetches only on 401. PATs that
  fail are flagged in the cockpit with a "PAT may be invalid or
  rotated" actionable error pointing the user at statecraft's
  `/app/project/:id/settings/github-pat` page.
- **Workspace switch / OPC restart**: cached tokens persist across
  restarts but are re-validated on first GitHub call after restart.

The long-lived PAT NEVER crosses the Statecraft → OPC boundary.
When `clone_token.source == "project_github_pat"`, OPC holds a copy
of the same long-lived secret that lives in
`project_github_pats` — this is an explicit MVP compromise (§10).

#### 6.4.5 Factory pipeline threading

`crates/axiomregent/src/github/client.rs:9-31` already accepts
`GITHUB_TOKEN` from the environment as a bearer token, with the
existing precedence: `PLATFORM_GITHUB_TOKEN_URL` (broker URL) →
`GITHUB_TOKEN` (raw token) → anonymous. No engine change is needed.

When OPC launches the factory engine subprocess (per spec 110
`factory.run.request` dispatch), it sets:

```
GITHUB_TOKEN=<clone_token.value>
```

in the subprocess environment, scoped to that subprocess only.
`crates/factory-engine/` does not touch `GITHUB_TOKEN` directly; the
engine launches axiomregent and inherits the env. Adapters (e.g.
`acme-vue-node`) that shell out to `git` for sub-operations get the
same env via standard subprocess inheritance.

For long-running pipelines whose total runtime may exceed the
installation-token TTL, OPC re-resolves the token between sequential
factory-stage subprocesses. A single stage that exceeds 1h is out of
scope for MVP (§10); the factory's seven ACP stages are designed to
be sub-1h units, and adapters are expected to fan out work
accordingly.

#### 6.4.6 Audit and observability

- **Statecraft side**: every `resolveProjectToken` call already emits
  the spec 109 §8 audit event (`project.token.resolved`) with
  `{ orgId, projectId, source, requestor }`. OPC bundle fetches
  reuse this — no new event type is introduced.
- **OPC side**: token fetches and refreshes do not emit local audit
  events. The Statecraft-side trail is the authoritative record of
  who minted what, when. OPC's only token-related observability is a
  cockpit indicator showing the current token's source and (for
  installation tokens) time-to-refresh.
- **Token-bearing log scrubbing** is a workflow MUST: OPC log
  formatters strip any `x-access-token:` URL fragment and any
  `Authorization: Bearer …` header before persistence.

#### 6.4.7 Public-repo path

For repos with no installation and no PAT (`clone_token == null`),
OPC clones anonymously. The factory engine runs without
`GITHUB_TOKEN` and is rate-limited per GitHub's anonymous-API rules.
The cockpit surfaces a banner inviting the user to register a PAT or
install the OAP App if rate-limit errors begin to surface. This is
the only path that a Statecraft 503 (token resolution hard failure)
must NOT be confused with — `null` is a valid resolution; 503 means
the resolver itself failed.

## 7. State Authority and Sync

This spec inherits the workspace-as-atom authority model from spec 087:

- **Authoritative state** for project identity, adapter binding, audit
  trail: statecraft Postgres (`projects`, `project_repos`,
  `factory_adapters`, `scaffold_jobs`, `audit_events`).
- **Authoritative state** for pipeline progress: `.factory/pipeline-state.json`
  in the repo working tree (committed). Statecraft caches the latest
  known state per-project for list views, but on conflict the repo wins.
- **OPC** sees projects via the duplex channel sync (reuses spec 111's
  catalog envelope pattern). A new `ServerEnvelope::project.catalog.upsert`
  variant carries the `projects` row to connected desktops. OPC displays
  the list in a "Projects" panel and lets the user open any entry; opening
  clones the repo locally if not present and activates the cockpit.

**Snapshot terminator (added 2026-05-25).** The handshake replay emits a
companion `ServerEnvelope::project.catalog.snapshot.complete` frame
immediately after the per-row `project.catalog.upsert` pass — including
the zero-projects case where no upsert frames went out. The terminator
carries `{ orgId, entryCount, generatedAt }`; payload is informational
(the desktop reconciles by `projectId` regardless). The terminator lets
the desktop's Projects panel distinguish "still connecting" from
"connected; the org has zero projects" without an arbitrary client-side
timeout. Statecraft emission lives in
`api/sync/projectCatalogRelay.ts::sendProjectCatalogSnapshot`; the
desktop dispatches it in `commands::project_catalog_sync` and the
frontend store (`projectCatalogStore.ts`) flips `hydrated=true` on the
first arriving event of either kind. This is a backward-compatible
extension — desktops that pre-date the terminator simply ignore the
unknown kind under their schema guard.

No new duplex envelope variants for scaffold jobs — statecraft's existing
job-stream SSE (or the spec 109 PubSub pattern) is used for create/import
progress.

## 8. Adapter Manifest Extension

To support §5.2, `adapter-manifest.schema.yaml` gains:

```yaml
scaffold:
  entry_point: string          # Relative path to scaffold entry script (e.g. "scripts/setup.ts")
  runtime: string              # Execution runtime (e.g. "node-24", "deno-2")
  args_schema: object          # JSON schema for --args accepted by the entry point
  profiles:                    # Declared variant/profile combinations
    - name: string             # e.g. "dual-saml-postgres"
      variant: string          # Matches build-spec project.variant
      modules: [string]        # Module names activated for this profile
      default: boolean
  emits:                       # What scaffold produces, relative to project root
    - path: string             # e.g. "template.json", "apps/", ".factory/pipeline-state.json"
```

Existing manifest `build_commands` / `validation` / `directory_conventions`
sections are unchanged. This is a backward-compatible addition (new
optional top-level key).

## 9. Implementation Phases

Each phase is independently mergeable and ends in a runnable state.

**Phase 1 — Detection crate.**
- Land `crates/factory-project-detect/` with the detection algorithm and
  a CLI bin for external consumers.
- Unit tests over three fixture repos: AcpProduced, LegacyProduced (use
  acme-vendor-onboarding as reference), ScaffoldOnly.
- Exit criteria: `factory-project-detect inspect <path> --json` returns
  correct level for all three fixtures.

**Phase 2 — Translator extension.**
- Extend `platform/services/statecraft/api/factory/translator.ts` with
  `translateLegacyManifest`.
- Integration test reads the example repo via a fixture and verifies the
  output conforms to `pipeline-state.schema.yaml`.
- Exit criteria: translator round-trips example manifest → pipeline-state
  without loss of stage completion timestamps or artifact references.

**Phase 3 — OPC Open path.**
- Wire `product/apps/opc/src-tauri/src/commands/factory_project.rs` to invoke
  the detection crate.
- Build `product/apps/opc/src/routes/factory/ProjectCockpit.tsx` with the
  timeline and action buttons. Actions dispatch via the existing spec 110
  envelope.
- Exit criteria: opening acme-vendor-onboarding in OPC shows a populated
  cockpit.

**Phase 4 — Adapter manifest scaffold extension.**
- Extend `adapter-manifest.schema.yaml` per §8.
- Update the `acme-vue-node` adapter manifest to declare `scaffold.*`
  fields pointing at its `setup-app.ts` / `setup-dual-app.ts`.
- Exit criteria: `registry-consumer show acme-vue-node` (or equivalent)
  shows the new scaffold block and validates.

**Phase 5 — Statecraft Create.**
- **Sequencing:** depends on spec 108 Phase 2 (schema landed,
  `factory_adapters` table populated by a prior sync run). The
  `projects` row references `factory_adapter_id`, and the adapter
  scaffold source is resolved by joining on this table. Phase 5 must
  not merge before 108 Phase 2 has shipped.
- Land `api/projects/create.ts`, `api/projects/scaffold/*`, and the
  `/app/projects/new` route.
- Absorb the six template-distributor operations listed in §5.3.
- Exit criteria: creating a new project via the web UI produces a
  GitHub repo whose **commit #1** contains (a)
  `.factory/pipeline-state.json` at L0 shape with adapter identity
  resolved from `factory_adapters`, (b) `.artifacts/extracted/`
  populated from server-side extraction when the user supplied seed
  inputs (plus the `manifest.json` bucket mapping), and (c) **no**
  legacy prompt files (`prestart-prompt.txt`, `start-prompt.txt`,
  `reconciliation-prompt.txt`). The API response includes
  `{ project_id, repo_url, clone_url, opc_deep_link }` and the
  `projects` row references the correct `factory_adapter_id`. Raw
  uploads are retrievable from the workspace bucket.

**Phase 6 — Bundle authentication and pipeline token threading.**
- **Sequencing:** depends on spec 109 (already shipped — `resolveProjectToken`,
  `project_github_pats`, installation broker). Lands before Phase 7
  (Statecraft Import) because external-org Imports cannot clone
  without a working PAT path; Create (Phase 5) can ship before this
  phase only because the immediate post-Create clone of a just-pushed
  repo runs in the same App-installation context that already exists.
- Extend `platform/services/statecraft/api/projects/opcBundle.ts` per
  §6.4.2: bundle response gains `clone_token`; new
  `GET /api/projects/:projectId/clone-token` refresh endpoint.
- Extend `product/apps/opc/src-tauri/src/commands/factory_project.rs`:
  `CloneProjectRequest` gains `github_token: Option<String>`; URL
  rewrite per §6.4.3; post-clone `git remote set-url` reset; log
  scrubbing.
- Extend `product/apps/opc/src-tauri/src/commands/keychain.rs` with
  `github-clone-token:<project_id>` slots and TTL handling.
- OPC factory-engine launch path threads `GITHUB_TOKEN=<clone_token>`
  into the subprocess env (§6.4.5).
- Exit criteria: (a) cloning a private external-org repo with a
  configured `project_github_pat` succeeds via the bundle path; (b)
  `.git/config` contains no token after clone; (c) clone-subprocess
  log output is scrubbed of token substrings; (d) factory engine
  subprocess inherits `GITHUB_TOKEN`; (e) installation-token refresh
  fires within 5 min of expiry; (f) on PAT 401, the cockpit surfaces
  the actionable error pointing at
  `/app/project/:id/settings/github-pat`.

**Phase 7 — Statecraft Import.**
- Land `api/projects/import.ts` and the `/app/projects/import` route.
- Exit criteria: importing acme-vendor-onboarding (fully executed — all 5
  legacy stages marked complete) via the web UI produces a `projects`
  row with `detection_level = "legacy_produced"` and a PR opened
  against the example repo adding `.factory/pipeline-state.json`. Importing
  an in-progress legacy project (any stage incomplete) is rejected at
  step 4 with an actionable error naming the incomplete stages.
  Importing a scaffold-only or non-factory repo is rejected. Importing
  an L2 AcpProduced project registers without a PR.

**Phase 8 — Workspace sync and OPC project list.**
- Add `project.catalog.upsert` envelope variant; reuse the spec 111 sync
  pattern.
- Add a "Projects" panel in OPC showing workspace projects with local
  clone state.
- Exit criteria: creating or importing in statecraft updates a connected
  OPC's project list without a restart.

**Phase 8a — Snapshot terminator (added 2026-05-25).**
- Add `project.catalog.snapshot.complete` envelope variant emitted by
  `sendProjectCatalogSnapshot` after the per-row upsert pass, even when
  the org has zero projects.
- Desktop dispatches via `commands::project_catalog_sync` and flips
  `hydrated=true` on the first event of either kind in
  `projectCatalogStore.ts`.
- Exit criteria: opening the OPC Projects panel against a statecraft org
  with zero projects renders the "No projects open" empty state rather
  than spinning on "Connecting to statecraft…" indefinitely. Backward
  compatible — pre-Phase-8a desktops ignore the unknown kind under the
  envelope schema guard.

**Phase 9 — template-distributor retirement (OAP-side). Delivered.**
The OAP-side work absorbed the six scaffold operations into
`api/projects/scaffold/` (Phase 5) and there are no remaining call
sites or links to the external `template-distributor` service in
this repo. Surviving mentions in `crates/factory-contracts/`,
`platform/services/statecraft/CLAUDE.md`, `api/projects/create.ts`,
and `api/db/schema.ts` are historical notes documenting the
retirement — they describe what was absorbed, not active usage.
Anything still living in the external `template-distributor`
GitHub repo is outside this spec's scope; OAP does not own or
control it, so this phase has nothing further to ship in-tree.

**Phase 10 — Legacy prompt-file retirement. Delivered.**
Phase 5's exit criteria already require new factory projects to
ship without `prestart-prompt.txt`, `start-prompt.txt`, or
`reconciliation-prompt.txt`, and that path is the only in-tree
project-creation surface. The remaining bullet — updating the
upstream `template` repo's `scripts/setup-*.ts` to stop emitting
the three files — lives in a repository this spec does not govern,
and is tracked there. Imported legacy projects keep their copies
as inert historical artefacts; no adapter, process, or engine in
this tree reads them.

## 10. Risks and Open Questions

- **Build Spec unification** (§3.4). Legacy projects carry split
  `requirements/{ui,api}/build-spec.json` that are not schema-conformant.
  This spec defers unification to a later spec. Risk: the unified Build
  Spec emitted by the ACP pipeline may diverge enough from the legacy
  split artifacts that reconciliation cannot treat them as equivalent.
  Mitigation: the translator preserves the legacy files verbatim; the
  next factory run emits a new conformant Build Spec alongside them; the
  cockpit marks the legacy files as historical.

- **Adapter scaffold entry-point portability.** *Resolved.*
  Statecraft-side scaffold is Node-24-only and uses the `template`
  repo's `setup-*.ts` shape (§5.2 step 3, §5.3, §5.4). Adapters
  declaring any other `scaffold.runtime` are not Create-eligible via
  the web UI. Non-Node-24 adapter outputs can still reach the platform
  via Import of a fully-executed repo (§6.2). A future spec may lift
  this bound by dispatching non-Node-24 scaffolds to OPC through the
  spec 110 envelope without disturbing the post-birth invariant.

- **Detection crate embedding in statecraft.** §6.2 step 3 proposes a CLI
  invocation of the detection crate from Node. Alternative: build a
  statecraft-owned Node-native detector that reads the same YAML schemas.
  The CLI approach preserves one source of truth and matches spec 105;
  the Node rewrite risks drift. Recommendation: CLI for MVP, revisit if
  latency is a problem.

- **`.factory/` vs. existing `factory/` confusion.** Spec 108 deletes the
  repo-root `factory/` directory. This spec introduces a **per-project**
  `.factory/` directory with one file (`pipeline-state.json`). The
  leading dot, the different location (inside a user project, not the
  platform repo), and the single file make collision unlikely; Phase 1
  tests will include a fixture that validates detection against a repo
  that contains neither.

- **Legacy projects without `.artifacts/raw/`.** Not every legacy
  project has raw inputs on disk — some were produced from transcripts
  pasted into a prompt. Import accepts this: detection does not require
  `.artifacts/`, and the cockpit's "Re-extract" action is a no-op when
  `.artifacts/raw/` is absent. Imported projects are historical; new
  extraction is only relevant after the user adds raw content post-
  import.

- **Orphan-repo recovery on partial Create failure.** If
  `githubRepoCreate` succeeds but `githubPushInitial` fails, an empty
  repo is left in the target org. The `scaffold_jobs` row captures the
  partial state; statecraft must implement an explicit policy —
  preferred: automatic retry of the push (bounded), then on terminal
  failure either delete the orphan repo or mark it `orphaned` with a
  reclaim action in the admin UI. The Express predecessor leaves
  orphans silently; this regression must be closed in Phase 5.

- **Long-lived PAT crossing the Statecraft → OPC boundary.** When
  the resolution source is `project_github_pat` (external-org Import
  with no App installation), §6.4.4 acknowledges OPC holds a copy of
  the same long-lived secret that lives in `project_github_pats`.
  This is an explicit MVP compromise — short-lived derivation of an
  arbitrary user-supplied PAT is not possible without a GitHub API
  affordance that does not exist. Mitigation: OPC keeps the PAT only
  in OS keychain, never in plaintext config; rotation in Statecraft's
  `/app/project/:id/settings/github-pat` invalidates the OPC copy on
  next 401. A future spec MAY introduce a Statecraft-mediated
  short-lived clone proxy (Statecraft proxies git operations using
  the PAT internally, returning a SAS-like URL to OPC) — out of
  scope for MVP given the operational complexity.

- **Token expiry mid-pipeline-stage.** Installation tokens have a 1h
  TTL; a single factory-stage subprocess running close to or past
  that boundary will see 401 responses from GitHub mid-flight.
  §6.4.5 mitigates by re-resolving between sequential stages, which
  covers the common case (sub-1h stages). Adapters that internally
  perform multi-hour git operations are out of scope; a future spec
  may add a token-refresh sidecar (file-watched token rotation, or a
  SIGUSR1-style signal) so a long-running subprocess can pick up a
  fresh token without restart.

- **Token leak surface.** The token-bearing URL (`https://x-access-token:<t>@…`)
  is the highest-risk artifact in this flow. §6.4.3 mandates that it
  exists only in the `Command::new("git")` args vector for one
  invocation. The Phase 6+ implementation MUST include unit tests
  asserting (a) `.git/config` contains no token after clone, (b) any
  log line generated by the clone subprocess is scrubbed of token
  substrings, (c) the token field is not written to OPC's IndexedDB
  state, only OS keychain. A regression on any of these is a
  security incident.

## 11. Non-Goals

- **Multi-repo / monorepo projects.** One project = one repo in this
  spec. Multi-repo coordination is deferred.
- **Local-only projects (no GitHub).** Create and Import both assume a
  GitHub remote. A "pure local" mode is plausible but not in scope.
- **Cross-adapter migration.** Moving a project from one adapter to
  another (e.g. `acme-vue-node` → `rust-axum`) is not addressed. The
  pipeline-state's `adapter` field is informational; migration would be
  a separate spec.
- **Factory run execution changes.** Runs continue to dispatch per spec
  110. This spec only adds lifecycle entry points, not runtime behaviour.
- **Partial legacy imports.** Projects with an incomplete
  `factory-manifest.json` (any of the 5 stages not marked complete)
  are not importable. Users must finish the legacy run upstream in
  `legacy-factory` before importing. Rationale: translation of a
  partial manifest produces a pipeline-state with holes the ACP engine
  cannot reconcile from, and the platform has no interest in resuming
  legacy execution.
- **Single-prompt factory execution.** The legacy
  `prestart-prompt.txt` / `start-prompt.txt` / `reconciliation-prompt.txt`
  flow is not supported on any created or imported project. All
  factory runs use the ACP 7-stage engine via the cockpit (§4.2) and
  the spec 110 envelope. The `factory/` ACP specification is the sole
  execution target; legacy prompt files, if present in imported repos,
  are historical artifacts only.
- **Adopt-unrelated-repo via Import.** Import accepts factory-produced
  repos only (`LegacyProduced` with `legacy_complete == true`, or
  `AcpProduced`). `NotFactory` and `ScaffoldOnly` are rejected.
  Adopting an unrelated repo as a factory project belongs to a future
  "Adopt" spec with its own UX and policy gates.

- **Wide L2 Import.** Detection recognises `AcpProduced` (L2) and §6.2
  registers it without translation, but L2 is not a primary Import
  shape in this spec because no upstream ACP producers exist yet. The
  only current path to an L2 repo is re-cloning a project Create just
  produced — a corner case, not a use case. A future spec will widen
  L2 Import once ACP producers are in the wild (e.g. organisations
  publishing ACP-native templates, or downstream forks of projects
  Create produced).

- **Deployd-api terminal stage.** The lifecycle described here begins
  at Import and ends when the cockpit hands the user a live ACP run
  loop (§4.2, §6.3). The terminal **deploy** stage that pushes a
  promoted build to `deployd-api-rs` infrastructure is referenced by
  §1.0 as the lifecycle terminus but is not specified here — it
  belongs in a follow-up spec that defines (a) the `deploy` ACP stage
  identifier and contract, (b) the deployd-api dispatch envelope, and
  (c) the promotion gate that decides when an imported project is
  deploy-eligible.

## 12. Glossary

- **ACP** — Adapter / Contract / Process, the three-layer model defined
  in `factory/README.md` and spec 074.
- **L0 / L1 / L2** — Detection levels: ScaffoldOnly / LegacyProduced /
  AcpProduced.
- **Legacy factory manifest** — `requirements/audit/factory-manifest.json`
  produced by `legacy-factory` (5 stages).
- **ACP pipeline-state** — `.factory/pipeline-state.json` conformant to
  `pipeline-state.schema.yaml` (7 stages).
- **Scaffold** — the act of materialising an adapter's base template into
  a new empty project directory. Does not run the factory pipeline.
- **Produce** — the act of running the factory pipeline against a
  scaffolded project, advancing stage state and emitting artifacts.

## Amendment record

**Amendment 2026-06-28 (record: §5.3.1 refinement, generator-reads + concurrency).**
Refines the 2026-06-27 §5.3.1 amendment after the factory-encore STRUCT-1/2/3
change shipped. Two corrections: (1) profile-default modules are read by the
**generator** (`setup-app.ts` parses the manifest's `profiles[].modules` via
factory-encore `lib/adapter-manifest.ts` and composes them through the shared
`lib/install-module.ts`), so warmup runs `setup-app.ts --profile --source` with
no `--with` translation of its own; the earlier "warmup translates to `--with`"
wording is superseded (the prior text claimed `setup-app.ts` composes no profile
modules, which the shipped generator contradicts). (2) Prebuilds are materialised
as SHA-stamped immutable snapshots behind an atomically-swapped `current`
pointer, with a single-flight warmup, so the 30-minute refresher cannot expose a
half-written tree to an in-flight per-request copy; concurrent creates stay
isolated via per-request `mkdtemp`, and the chart enforces single-pod warmup
(RWO PVC, `replicaCount=1`). Adds a freshness posture (no-admission is a hard
block, admission-advance auto-rebuilds, main-ahead is advisory) and records that
freezing the admitted SHA at admission time is a separate specs-198/199 posture
not changed here. No contract change to §5.3's six operations or the admission
record.

**Amendment 2026-06-27 (record: factory-encore generator-product split).**
§5.3's scaffold topology is corrected for the executed generator-product
split (`docs/analysis/acme-vue-encore-generator-product-split.md`): the
generator (`scripts/`) and module catalog (`modules/`) moved from the
scaffold-source repo into the factory-encore adapter, and the scaffold-source
repo became a lean baseline. New §5.3.1 records the resulting two-cache
warmup: clone factory-encore (`_factory-cache`: generator + modules + `tsx`)
and template-encore (`_template-cache`: baseline), run the adapter's
manifest-declared `setup-app.ts` / `setup-dual-app.ts` with
`--source _template-cache`, and compose modules from the factory cache. Three
consequences worth flagging: (1) factory-encore coordinates are resolvable
from the existing `legacy-mixed` `factory_upstreams` row, so no admission or
DB-schema change is needed; (2) profile module sets become
manifest-authoritative (`profiles[].modules` drives `--with` at prebuild),
superseding the 2026-06-11 "empty profile built-ins" stance for the template
adapter; (3) the contract decomposition of §5.3's six operations is
unchanged, only operations 1 to 3's source topology. Confined to the
spec-112-owned `scaffold/` directory; the
`governance.scaffold_execution` / `dual_stack.generator` manifest fields are
owned by spec 198 and only referenced here.

**Amendment 2026-06-11 (record: 138 audit trail, spec 199 FR-007).**
The §5.3 module catalog this spec established was cut over from the
retired template-distributor shape to template's real `modules/`
directory — five opt-in modules, empty profile built-ins/presets
(profiles select AUTH_DRIVER; auth is not a module), `detectProfile`
removed. Full rationale and the module descriptors live in spec 138's
audit trail (2026-06-11 entry); the helper tests in
`scaffold.test.ts` follow the new catalog.

**Amendment 2026-05-04 (record: 138-statecraft-create-realised-scaffold).**
Four refinements to §5 settled when the absorbed scaffold subflow
landed. None contradicts the original design — each is a load-bearing
detail this section had deferred to "the production implementation".

- **§5.3 row 2 — profile-set ownership.** The original wording had the
  prebuild profile set declared by the adapter manifest (§8). The
  landed code holds the four profiles (`minimal`, `public`, `internal`,
  `dual`) in statecraft's own `moduleCatalog.ts`, mirroring
  `template-distributor/src/server.ts:108-232`. Profiles are properties
  of the *template repo's* `setup-{app,dual-app}.ts` scripts (§5.3 row
  3 already binds the per-request scaffold to that shape via §10), so
  the adapter manifest's `scaffold.profiles` is correctly understood as
  forward-compat metadata for non-template adapters that do not yet
  exist. §8's manifest schema is unchanged.

- **§5.2 step 7 — environments row in the Create transaction.** The
  original step listed `projects` + `project_repos`. The landed code
  also inserts a `kind=development` `environments` row in the same
  transaction so that `POST /api/projects/:id/factory/deploy` and the
  PR webhook's `findOrCreatePreviewEnv` path target the same row
  instead of one path lazy-creating and the other not. §11's
  deployd-api non-goal is preserved — only the row is provisioned;
  the dispatch envelope and deploy gate remain a follow-up spec.

- **§5.1.1 (new) — scaffold-readiness endpoint.** The original
  contract did not specify the form's gate against warmup state /
  adapter presence / PAT presence. The new section freezes the
  `GET /api/projects/scaffold-readiness` response shape so the UI's
  banner copy is governed.

- **§5.3 deployment note — workspace PVC.** The original §5.3 said
  warmup runs on statecraft startup; storage backing was unspecified.
  The new note records that `${STATECRAFT_WORKSPACE_DIR}` (default
  `/var/statecraft/workspace`) is backed by an RWO PVC declared in
  `platform/charts/statecraft/templates/workspace-pvc.yaml`, with
  per-cloud `StorageClass` overrides and a `replicaCount > 1`
  template-render guard.

Spec 137 (`statecraft-create-realised-scaffold`) carries the full
rationale, the audit trail, and the `implements:` mapping for the
landed code paths.
