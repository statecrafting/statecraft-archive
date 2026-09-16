# Factory-Encore Sync — Current-State Analysis

> Investigation date: 2026-06-09. Scope: how the statecraft factory
> sync/projection layer operates **today** after the upstream sources were
> repointed to the owned `statecrafting/factory` +
> `template` repos. Lens: the operator's thesis that **statecraft
> should be a thin consumer of owned content, not a translator** — and that
> the "encore" suffix is a greenfield to set an OAP-controlled, future-proof
> open standard. No backward-compat weight; current shapes are baseline,
> not sacred.
>
> This is an analysis artifact, not a spec. File:line citations throughout.
>
> **SUPERSEDED 2026-06-24. Historical snapshot, retained for provenance;
> do not read its findings as current state.** Both axes it analysed have
> since moved: (1) the statecraft projection bugs (synthetic `acme-vue-node`,
> hardcoded origins, dropped `acme-vue-encore`) were fixed by the spec 199
> thin-consumer cutover (`projection.ts` deleted; adapters served by their
> own manifest identity; `adapter-scopes.json` keyed on `acme-vue-encore`),
> verified 2026-06-24; and (2) the section 5 factory-vs-template question
> was resolved by the generator/product split recorded in
> [`acme-vue-encore-generator-product-split.md`](./acme-vue-encore-generator-product-split.md).
>
> **Current successor (2026-06-27):**
> [`factory-system-current-state.md`](./factory-system-current-state.md) is the
> live full current-state map (all three repos, the sync / create / module
> flows, plus the misalignment ledger). Read it instead of this file for
> current state.

---

## 0. One-sentence diagnosis

The GitHub **sources** were switched to the owned factory/template
repos, but the statecraft **translation + projection layer was never moved off
the dead `legacy-factory` layout** — so statecraft is still *translating*
(re-bucketing, synthesizing, hardcoding identities for) content it now *owns*,
against a directory shape that no longer exists, while the verbatim-mirror
substrate that should make all of that translation unnecessary already exists
underneath it.

---

## 1. How the system operates today (end-to-end)

Two independent paths share the `factory_artifact_substrate` table.

### 1.1 Write / ingest path (`Sync now` → substrate)

`sync.ts` (HTTP trigger) → PubSub → `syncWorker.ts` (claim + load config + token)
→ `syncPipeline.ts::runSyncPipeline` → clone both repos (`clone.ts`,
`--depth=1`) → `translator.ts::translateUpstreamsToSubstrate` (walk + classify)
→ merge OAP-self rows (`oapContracts.ts`, `oapNativeIngest.ts`) → one
transactional upsert+prune (`applySubstrateRowsTx`) → counts + last-sync stamp.

Two facts dominate everything downstream:

- **Origin ids are static constants, not derived from the repo.**
  `DEFAULT_FACTORY_ORIGIN = "legacy-factory"`,
  `DEFAULT_TEMPLATE_ORIGIN = "acme-vue-node"`
  (`translator.ts:703-705` ← `oapNativeAdapters.ts:49,53`). Repointing the
  GitHub URL does **not** change the origin written to substrate rows. After a
  factory sync, every row's `origin` still says `legacy-factory`,
  which is now factually wrong but functionally inert (the prune key is
  `(orgId, origin, path)`, so old `Factory Agent/...` paths are retired and new
  `process/…` paths inserted — no corruption, just a lying label).

- **The walk classifies each file into one of 11 `ArtifactKind`s**
  (`translator.ts::classifyArtifactKind:773-860`). For factory the
  predicates that *do* fire correctly: `contract-schema` (suffix match),
  `adapter-manifest` (`adapters/<n>/manifest.yaml`), `pattern`, `invariant`,
  and — notably — `process-stage` via `/^process\/stages\/.+\.md$/` (line 796,
  added prospectively for the new layout). The predicate that **does not** fire:
  `pipeline-orchestrator` — it only matches `Factory Agent/factory-orchestration.md`,
  `orchestration/template-orchestrator.md`, or `factory-orchestration.md`
  (lines 784-788). factory's orchestrator is
  `process/agents/pipeline-orchestrator.md`, which has no `type:` frontmatter,
  so it classifies as `skill`.

### 1.2 The substrate — the one layer that is already right

`factory_artifact_substrate` stores `upstream_body` verbatim, an optional
per-org `user_body`, and `effective_body = COALESCE(user_body, upstream_body)`
(spec 139 §2.1). It does **not** impose categorical shape — `kind` only labels
the file type. This is exactly the "thin mirror" the thesis wants. Spec 139 §1
explicitly named the old categorical projection as the root cause it set out to
kill: *"The shape we projected into is tightly coupled to the GoA upstream's
specific layout."*

### 1.3 Read / projection path (the tabs)

`browse.ts` (`/api/factory/{adapters,contracts,processes}`) →
`projectForOrg` → `substrateBrowser.ts::loadSubstrateForOrg` (active rows for
factory + template + `oap-self` origins) → `projection.ts::projectSubstrateToLegacy`
→ wire shape.

`projectSubstrateToLegacy` re-buckets the verbatim rows back into the legacy
spec-108 categorical shape:

- **Adapters** = `buildOapNativeAdapters(oapSelfRows)` (only `oap-self`-origin
  `adapter-manifest` rows) **+** one synthetic `buildAdapter(templateRows)`.
- **Processes** = exactly one `buildProcess(factoryRows)`.
- **Contracts** = `buildContracts(factory + template + oap-self schema rows)`,
  dedup by name.

`buildProcess` (`projection.ts:225-325`) re-buckets factory rows using the
**old `Factory Agent/...` path predicates** (`stageId`, `isFactoryControllers`,
`isFactoryReqSystem`, …, lines 35-70). It reads `row.path`, **not** the stored
`kind` — so even though the substrate has correct `process-stage` rows,
`buildProcess` matches none of factory's `process/stages/*.md` and emits
`{ orchestrator: null, stages: [], agents: {all empty}, references: [] }`.

`buildAdapter` (`projection.ts:189-223`) hardcodes `name: "acme-vue-node"`
(line 218) and emits a manifest with **no `schema_version`** (keys:
`entry/orchestrator/skills/orchestration_source_id/scaffold_source_id/scaffold_runtime`).

The real `adapters/acme-vue-encore/manifest.yaml` (which *does* carry
`schema_version: "1.0.0"`) lands under the **factory** origin — and **no adapter
builder reads the factory origin**. `buildOapNativeAdapters` reads only
`oap-self`; `buildAdapter` reads only the template origin. So the real adapter
is stored in the substrate and then **dropped on the floor** by the projection.

### 1.4 Scaffold path (separate from the above)

`POST /api/projects/factory-create` (`create.ts`) → warmup gate
(`templateCache.ts`) → adapter resolution → clone **template** repo → copy a
prebuilt variant → apply extras → write `.factory/pipeline-state.json` seed →
GitHub repo create + commit #1 + push (`gitInitAndPush.ts`).

This path consumes **only template** (clone target resolved via
`scaffold_source_id` → `factory_upstreams(org, source_id)` → `(repo, ref)`,
`scheduler.ts:64-85`). factory contributes **zero bytes** to scaffolding.
The `scaffold_source_id` itself is injected by statecraft at sync time as the
literal `"acme-vue-node"` (`oapNativeSanitise.ts:65` / `translator.ts:336`), not
read from factory's manifest.

### 1.5 Consumers of the projected shape

- `opcBundle.ts:329-365` — `loadAdapter` / `loadLatestProcesses` /
  `loadLatestContracts` all call `loadSubstrateForOrg` + `projectSubstrateToLegacy`
  and ship the result to the **OPC desktop**. `loadAdapter` keys on
  `synthesiseAdapterId(orgId, name) === project.factoryAdapterId` (line 331),
  finds the synthetic `acme-vue-node`, and ships its `schema_version`-less
  manifest + empty process into the bundle. This is precisely the cryptic
  startup failure the `browse.ts:108-124` guard was added to pre-empt — except
  the bundle path has **no such guard**.
- `runs.ts:255` — filters `projection.processes` for run display.
- `web/app/routes/app.factory.{adapters,processes,contracts}.tsx` — the tabs.
- `web/app/routes/app.projects.new.tsx` — the Create form adapter dropdown.
- `web/app/routes/app.factory.artifacts.tsx` — the **substrate browser**, the
  one UI that already serves rows verbatim (see §4).

---

## 2. The four UI symptoms → mechanism

| Symptom (screenshot) | Mechanism |
|---|---|
| **Processes = 0** in the sync count | `countByLegacyKind` sets `processes = 1` only if a **factory-origin `pipeline-orchestrator`** row exists (`syncPipeline.ts:186-194`). factory's orchestrator is `process/agents/pipeline-orchestrator.md` → classified `skill`, not `pipeline-orchestrator` → P=0. |
| **`7-stage-build` body empty** (orchestrator null, stages `[]`) | `buildProcess` uses old `Factory Agent/...` path predicates (`projection.ts:241-287`); factory's `process/stages/*.md` match none → empty definition. |
| **"Failed to load acme-vue-node" / internal error** | The shown adapter is the synthetic `acme-vue-node` (`projection.ts:218`) with no `schema_version`; `getAdapter` rejects it with `APIError.internal` (`browse.ts:109-124`). The real `acme-vue-encore` manifest is never projected. |
| **Create form shows stale `acme-vue-node`** | Same source — the dropdown lists the only adapter the projection emits, the broken synthetic one. |
| `A 2 / C 23 / P 0` count vs `1 adapter / 14 contracts / 1 process` shown | Count A=2 = template-origin orchestrator (template still has the legacy `orchestration/template-orchestrator.md`) + factory's `acme-vue-encore` manifest. Projection shows 1 (the synthetic), hides the real one. C=23→14 = dedup of factory working-copy schemas vs `oap-self` canonical schemas. |

---

## 3. The unifying structural finding: statecraft translates what it now owns

### 3.1 Translate-vs-mirror ledger

| Step | File | Verdict |
|---|---|---|
| git clone | `clone.ts:44-88` | **mirror** |
| `FACTORY_SOURCE_EXCLUDES` / `TEMPLATE_EXCLUDES` walk filter | `translator.ts:77-107` | **translate** (decides inclusion; written for old layout) |
| `classifyArtifactKind` | `translator.ts:773-860` | **translate** (statecraft vocabulary, load-bearing) |
| body + sha + contentHash | `translator.ts:893-903` | **mirror** |
| origin id assignment | `translator.ts:883-884` | **translate** (static `legacy-factory`/`acme-vue-node`) |
| OAP contract schema ingest | `oapContracts.ts:95-125` | **mirror** |
| OAP-native manifest sanitise (runtime bump, key inject, validation strip) | `oapNativeSanitise.ts:49-96` | **translate** (mutates body) |
| upsert/prune | `syncPipeline.ts:278-351` | mirror/coordination |
| `buildAdapter` synthetic `acme-vue-node` | `projection.ts:189-223` | **full synthesis** |
| `buildProcess` re-bucket | `projection.ts:225-325` | **translate** (old-layout coupled) |
| `buildContracts` dedup | `projection.ts:327-378` | **re-bucket** |
| `effectiveBody`→`upstreamBody` fold | `substrateBrowser.ts:101` | translate (transparent override) |
| `syncedAt = now`, synthesized `id`, version slugs | `browse.ts:61,76`, `projection.ts:219` | **translate** |

Every step from substrate → wire response for an owned source is re-derivation.

### 3.2 The projection invents shape the contract does not define

The factory **contract** (`standards/schemas/factory/`, canonical; mirrored into
factory's `contract/schemas/` working copy) defines nine schemas:
`build-spec` (1.1.0), `adapter-manifest` (1.0.0), `pipeline-state` (1.0.0),
`verification` (1.0.0), and five `stage-outputs/*`. The Rust twins live in
`crates/factory-contracts/src/` (`build_spec.rs` pins `BUILD_SPEC_SCHEMA_VERSION
= "1.1.0"`).

**There is no schema for a "process" / "pipeline definition" / "7-stage-build"
shape.** `pipeline-state.schema.yaml` uses an open-ended `<stage_id>` map — it
is deliberately agnostic about which stages exist. The
`{orchestrator, stages[], agents.{controllers, client_interface,
requirements.{system,service,client}, database, other}, references}` structure
that `buildProcess` emits is a **pure statecraft invention** with zero contract
backing, named `"7-stage-build"` hardcoded at `projection.ts:305` (the only two
emission sites in the whole tree are `translator.ts:249` and `projection.ts:305`).

Of the 11 `ArtifactKind`s, only **2** map to a contract schema
(`adapter-manifest`, `contract-schema`). The other 9 are statecraft-internal
classification vocabulary over verbatim files.

So the projection layer is authority for a shape that the open standard never
defined — and that shape is coupled to a directory layout (`Factory Agent/…`)
that no owned repo will ever have again.

---

## 4. The thin-consumer path already exists

`web/app/routes/app.factory.artifacts.tsx` + `api/factory/artifacts.ts` are a
**substrate browser** that serves rows verbatim (`upstreamBody` / `effectiveBody`
directly, no re-bucketing). This is the shape the thesis wants. The gap is that
the three legacy endpoints (`/adapters`, `/processes`, `/contracts`) and the OPC
bundle still consume the *projection* instead of the substrate + the adapter's
own (schema-validated) manifest.

A thin-consumer target, stated structurally:

- **Adapters**: serve the `adapter-manifest` substrate row's parsed YAML
  verbatim (it already carries `schema_version` and the full spec-074 shape).
  Drop `buildAdapter`'s synthesis and the hardcoded `acme-vue-node`.
- **Processes**: either (a) drop the categorical process entirely and let the
  OPC factory engine read `process/**` rows by `kind` + manifest, or (b) if a
  "process" wire object is still wanted, define it in the **contract** and
  derive it from `kind`, not from `Factory Agent/…` path regex.
- **Contracts**: already close to verbatim (already serving schema bodies).

---

## 5. The factory ↔ template question (can they merge?)

- **Scaffolding needs only template.** The entire Create flow (warmup,
  prebuild, per-request copy, commit #1) reads template; factory
  contributes nothing (§1.4). If template were the only repo, the
  scaffold path is unchanged.
- **The pipeline-run path needs factory.** `process/{stages,agents,skills}`
  + `adapters/<n>/manifest.yaml` + `contract/schemas` are consumed at pipeline
  execution time by the **OPC desktop factory engine** (via the substrate /
  bundle), not by statecraft's scaffold path.
- **Therefore the split is load-bearing only for pipeline execution**, and even
  there the boundary is "process/contract/adapter content (factory)" vs
  "the app skeleton that gets cloned (template)." Merging is *possible*
  (one repo with a `process/` + `contract/` + `adapters/` tree alongside an
  `app/` skeleton), but the two have genuinely different lifecycles:
  factory is OAP-authored governance content; template is a
  full buildable app (Cargo/npm workspace, specs, CI). Collapsing them couples
  a governance-standard repo to an app's build graph. **Open design question,
  not a forced move.**

---

## 6. Consumer / blast-radius inventory

Confirmed (deep traces), highest blast radius first:

| Site | Reads | Failure under factory |
|---|---|---|
| `projection.ts::buildProcess` | factory rows by old paths | empty process (root cause of empty `7-stage-build`) |
| `projection.ts::buildAdapter` + `browse.ts::getAdapter` guard | synthetic `acme-vue-node`, no `schema_version` | adapter detail 500; real `acme-vue-encore` dropped |
| `opcBundle.ts:329-365` | same projection, **no schema_version guard** | ships hollow process + invalid manifest to OPC desktop → engine startup failure |
| `substrateBrowser.ts` / `loadSubstrateForOrg` | static `DEFAULT_*_ORIGIN` | a future template repo using a different origin id is silently filtered out |
| `countByLegacyKind` | factory `pipeline-orchestrator` | P=0 (informational only) |
| `runs.ts:255` | `projection.processes` | empty process context in run display |
| `web` factory tabs + `app.projects.new.tsx` | the projected lists | show the stale/broken adapter + empty process |

Stale/dead surfaced (lower stakes):

- `oapNativeAdapters.ts` still registers `next-prisma`/`rust-axum`/`encore-react`
  and `oapNativeIngest.ts` reads them from `_tmp/factory/adapters/` — **that dir
  does not exist** in the repo, so the ingest is a silent no-op. upstream-map
  v3.0.0 says these example adapters were **removed**.
- `moduleCatalog.ts` (`MODULE_CATALOG`, `PROFILE_MODULES`, `PRESETS`) is a legacy
  Express artifact; several listed modules (`auth-saml`, `auth-entra-id`,
  `session-store-*`, `service-auth`, `api-docs`) **don't exist** in
  template's `modules/` (which has `api-gateway`, `data-postgres`,
  `data-redis`, `security-core`, `user-management`). Inert today because
  `extrasFor` filters profile built-ins before `add-module.ts` runs, but
  misleading.
- `adapter-scopes.json` keyed on `acme-vue-node` with `file_write_scope`
  including `scripts/` (not an Encore output dir).
- CLAUDE.md references `api/factory/process-stages/*` — **never created**.
- The naming divergence `acme-vue-node` (everything statecraft injects/hardcodes)
  vs `acme-vue-encore` (factory's actual adapter name) is live and
  pervasive.
- Rust test fixtures (`run_replay.rs`, `kernel_emission_integration.rs`,
  `integration_078_e2e.rs`, `virtual_root.rs`) hardcode `acme-vue-node` / old
  origins — will need fixture updates on cutover.

---

## 7. Implications for an OAP-controlled open standard (analysis)

Surfaced for discussion — not decisions:

1. **The contract should own shape; statecraft should consume.** Today the
   projection owns a process shape the contract never defined. A future-proof
   standard would either (a) add a contract schema for "process/pipeline
   definition" (so any third-party factory declares its stages explicitly), or
   (b) decide the process is *not* a statecraft concern at all and is read
   directly by the execution engine from `kind`-classified substrate rows.
   The fact that `pipeline-state.schema.yaml` already uses open-ended stage keys
   suggests the standard *intends* (a)-style openness.

2. **Origin identity should track the source, not a constant.** If a third party
   registers their own factory repo, the substrate origin should derive from the
   `factory_upstreams` source, not from the legacy scaffold config. The
   `(orgId, origin, path)` prune key is already origin-parameterized — only the
   default constants are the problem.

3. **Adapter identity should come from the manifest, not from statecraft.** The
   manifest already declares `adapter.name: acme-vue-encore` and `schema_version`.
   Statecraft hardcoding `acme-vue-node` is the single largest source of the
   user-visible breakage.

4. **"Owned source" ⇒ no sanitise step.** `oapNativeSanitise` mutates manifests
   on ingest (runtime bump, key injection, validation strip). For an owned,
   standard-conformant source, ingest should be pure mirror — if the manifest
   needs those fields, they belong in the manifest, authored upstream.

5. **factory vs template merge** is a real open question (§5) with a genuine
   lifecycle tradeoff; it does not need to be resolved to fix the symptoms.

---

## 8. Appendix — agent investigation provenance

Five read-only investigators (write path, read/projection path, consumer sweep,
contract layer, scaffold subflow) plus targeted grep confirmation. The broad
consumer sweep's quantitative claims ("11 locations hardcode 7-stage-build")
were **not** corroborated — the actual emission sites are two
(`translator.ts:249`, `projection.ts:305`); treat that agent's line numbers as
approximate and the deep-trace agents (write/read/contract/scaffold) as the
authoritative cites here.
