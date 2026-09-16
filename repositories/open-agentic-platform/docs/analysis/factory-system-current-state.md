# Factory System Current-State Map: factory-encore + template-encore + statecraft

> **Date:** 2026-06-27. **Scope:** the full factory pathway across three repos
> (`statecrafting/factory-encore`, `statecrafting/template-encore`, and the
> statecraft service in this repo) for three flows: **sync**, **create
> project**, and **module selection**.
>
> **Purpose:** a single ground-truth inventory of what the system *is* today,
> with every structural misalignment, legacy remnant, and outdated concept
> surfaced so a remediation plan can be devised against it. This project does
> not carry backward-compat weight (no external users), so "kept for compat"
> is recorded as a smell, not a justification.
>
> **Supersedes** the 2026-06-09 `factory-encore-sync-current-state.md` (which
> predates both the spec 199 thin-consumer cutover and the generator-product
> split). **Companion** to `acme-vue-encore-generator-product-split.md` (the
> directional decision) and `governance-envelope-unification.md`.
>
> **Provenance:** assembled from eight read-only investigation agents plus
> three targeted misalignment hunts over the three repos. `file:line`
> citations throughout; verify before acting (some line numbers drift).

---

## 0. Executive summary: the shape of the problem

The factory pathway works in two of its three flows and is **broken in the
third**. More importantly, underneath the break sits a set of structural
misalignments the team has been tolerating, several of which are
"fundamentally wrong" in the sense the owner suspected: the same fact is
declared in multiple places, the place that *executes* honours none of the
declarations, and several authority boundaries are split across competing
gates.

**The four headline structural problems** (detailed in §4.1):

1. **Modules are declared in four places; the generator honours none of
   them.** `scaffold.modules`, `scaffold.profiles[].modules` (both in the
   factory-encore manifest), and statecraft's hardcoded `moduleCatalog.ts`
   all encode "which modules exist / which profile ships which module." The
   real source is the adapter's `modules/` directory. The generator
   (`setup-app.ts`) reads none of the profile-module declarations: it
   composes only what explicit `--with` flags pass. So `--profile internal`
   does **not** ship `user-management` despite three declarations saying it
   should.

2. **Two generators that should be one.** `setup-app.ts` (single) and
   `setup-dual-app.ts` (dual) are separate entry points with copy-pasted CLI
   code, an asymmetric `--with` capability, and a `profile` vs `topology`
   conflation in the manifest schema. "Dual" is a topology, not a profile,
   but the manifest's `args_schema.profile.enum` lists it as a profile.

3. **Adapter-name authority is split across three gates.** The governance
   envelope admission gate (spec 198) is supposed to be the single authority
   for which adapters are admissible, but a static `VALID_ADAPTERS` set in
   `repoInit.ts` and the hardcoded `moduleCatalog.ts` each independently
   gatekeep adapter identity. A newly admitted adapter would pass the
   governance gate and still fail repo-init.

4. **The substrate now mirrors generator source code it never reads.** After
   the generator moved into `adapters/acme-vue-encore/`, the sync walk
   ingests `scripts/*.ts` and `modules/**` into `factory_artifact_substrate`
   as `skill` / `reference-data` rows that no consumer reads.

**The live break** (detailed in §2.2): the create-project warmup runs the
generator scripts from the cloned *template* repo, but the generator moved to
*factory-encore*. Warmup throws, the Create form is disabled. The **spec 112
amendment (2026-06-27, §5.3.1)** defines the fix (clone factory-encore too,
run its manifest-declared entry point with template as `--source`);
implementation is pending.

**Residue volume:** roughly 70 distinct items across the three repos: 1 live
break, ~8 structural/design misalignments, 3 double-source-of-truth
catalogs, 3 declared-but-never-implemented contract fields, ~20 naming
residues, ~18 stale comments referencing deleted concepts, ~8 dead/skipped
tests, 4 cross-repo seams, and 2 duplicated-code clusters.

---

## 1. The three repos and the intended boundary

The 2026-06-23 decision record split the system along **create-time vs
runtime**. The intended boundary:

| Repo | Role | Owns | Lifecycle |
|---|---|---|---|
| **factory-encore** | the **generator home** + governance content | `adapters/acme-vue-encore/{scripts,modules,orchestration}/`, `contract/schemas/`, `process/`, the adapter `manifest.yaml` | create-time; stack-specific generator + OAP-authored governance |
| **template-encore** | the **lean product baseline** | `apps/`, `packages/`, the runnable reference app, `PLACEHOLDERS.md` credential contract | runtime; the app a produced copy *is* |
| **statecraft** | the **thin consumer** | sync (mirror upstreams to substrate), admission gate, create-project scaffold, browse UI | the control plane; should consume the manifest, not re-declare it |

The **thin-consumer principle** (spec 199): statecraft transforms upstream
content only to *enforce* the standard (validate, content-address,
reconcile), never to *compensate* for a missing standard. Several §4 items
are violations of exactly this principle: statecraft re-declaring the module
catalog, the adapter allowlist, and a categorical "process" shape the
contract never defined.

The split coincides with three real boundaries (create-time/runtime,
stack-agnostic/stack-specific, independent-reuse), which is what justifies
keeping the repos separate. That justification is sound; the problems below
are execution residue, not a reason to recombine.

---

## 2. End-to-end flows as built today

Three independent paths. Sync and module-catalog reads share the
`factory_artifact_substrate` table; the scaffold path is separate.

### 2.1 Sync flow (works)

```
operator "Sync now"
  → sync.ts (HTTP) → PubSub → syncWorker.ts (claim + load config + PAT)
  → syncPipeline.ts::runSyncPipeline
      → clone factory-encore + template-encore (clone.ts, --depth 1)
      → translator.ts::translateUpstreamsToSubstrate (walk + classifyArtifactKind)
      → merge oap-self rows → one transactional upsert+prune (substrate)
      → admission.ts::evaluateAndPersistFromSync (governance-envelope gate)
  → counts + last-sync stamp
```

**Status: functional.** The walk is path-classifier-driven and
version-tolerant, so it correctly mirrors the new factory-encore layout and
admits the 1.1.0 manifest. Residue lives in the classifier and its comments
(§4.3, §4.4, §4.1 item 4), not in the behaviour.

`factory_artifact_substrate` (spec 139) stores `upstream_body` verbatim plus
optional per-org `user_body`, `effective_body = COALESCE(user_body,
upstream_body)`. This is the "thin mirror" the architecture wants; it imposes
no categorical shape.

### 2.2 Create-project flow (BROKEN)

```
POST /api/projects/factory-create (create.ts)
  → warmup gate (templateCache.ts: isTemplateCacheReady)
  → loadFactoryAdapter + loadLatestAdmission → scaffoldResolutions
  → resolveScaffoldUpstream (verify template upstream exists)
  → scaffoldFromPrebuilt (perRequestScaffold.ts):
       copy _prebuilt-<profile> → dest (strip .git, node_modules)
       run add-module.ts per selected extra
  → write .factory/pipeline-state.json seed + .kernel-version stamp
  → GitHub repo create + commit #1 + authed push
```

Warmup (`templateCache.ts`) clones **template-encore** into `_template-cache`
and tries to run `scripts/setup-app.ts` / `setup-dual-app.ts` and `tsx`
**from that clone**. The generator-product split moved all of those to
factory-encore, so:

| Break site | Expects | Reality |
|---|---|---|
| `templateCache.ts:281` | `_template-cache/node_modules/tsx` | tsx is a factory-encore devDep, absent in template |
| `templateCache.ts:289-319` | `_template-cache/scripts/setup-*.ts` | scripts moved to factory-encore adapter |
| `perRequestScaffold.ts:105-106` | `_template-cache/scripts/add-module.ts` | same |

Warmup throws into `initStatus.error`; `scaffoldReadiness.ts` surfaces a
`warmup-error` blocker; the Create form is permanently disabled. Module
**selection** (the dropdown) still renders; module **composition** fails on
the missing `add-module.ts`.

**Fix** (spec 112 §5.3.1, amended 2026-06-27, implementation pending): clone
factory-encore into `_factory-cache` as well, run its
manifest-declared entry point with `--source _template-cache`. The
factory-encore repo+ref is already resolvable via
`resolveScaffoldUpstream(orgId, "legacy-mixed")`; no admission/DB-schema
change. VCS-free output is automatic because warmup runs under
`NO_INSTALL=true`, which the moved generator treats as implying `--no-git`.

### 2.3 Module-selection flow (catalog valid, composition broken)

```
web/app/routes/app.projects.new.tsx (Create form)
  → adapter dropdown (from admitted manifest)
  → module checkboxes (from moduleCatalog.ts MODULE_CATALOG, static)
  → pickProfileFromModules(variant, selected) → profile
  → scaffoldFromPrebuilt → add-module.ts per extra  [BROKEN, see §2.2]
```

The five module ids in `moduleCatalog.ts` (`security-core`, `api-gateway`,
`data-postgres`, `data-redis`, `user-management`) still match factory-encore's
`modules/`, so selection-by-id is valid. But the catalog is a **static
hand-maintained mirror** of a directory in another repo (§4.2), and the
composition step it feeds is the broken `add-module.ts` call.

---

## 3. Contract surface and version matrix

The factory contract (`standards/schemas/factory/` canonical, mirrored to
factory-encore `contract/schemas/`) defines the schemas below. The Rust twins
live in `crates/factory-contracts/src/`.

| Schema | factory-encore | OAP Rust crate | statecraft TS | Aligned? |
|---|---|---|---|---|
| adapter-manifest | 1.1.0 | 1.1.0 (accepts 1.0.0 + 1.1.0) | admits exactly 1.1.0 | yes |
| build-spec | 1.1.0 | 1.1.0 | not name-validated | yes |
| pipeline-state | 1.0.0 | 1.0.0 | emits 1.0.0 | yes |
| verification | 1.0.0 | no pinned const | not name-validated | tolerable |
| **governance-envelope** | **1.0.0** | **1.1.0** (spec 202) | **requires exactly 1.0.0** | **NO** |

The governance-envelope row is a **live latent break** (§4.7 SEAM-3): OAP's
Rust crate emits 1.1.0 (spec 202 added `budgets:`), but statecraft admission
rejects anything other than 1.0.0, and factory-encore's process still files
1.0.0. The current factory-to-statecraft flow is unblocked only because
factory-encore happens to still emit 1.0.0.

There is also **no contract schema for a "process" / "pipeline definition"
shape**. The categorical `{adapters, contracts, processes}` and
`"7-stage-build"` shape that older statecraft code emits is a pure
statecraft invention coupled to the retired goa layout (§4.3 / §4.1 item 4).

---

## 4. Misalignment ledger

Organized by theme. Each item: location(s), why it is wrong, suggested
direction. IDs are stable for cross-reference in a remediation plan.

### 4.1 Structural / design misalignments (the load-bearing ones)

**STRUCT-1: Modules declared in four places; generator honours none.**
`scaffold.modules` (factory-encore `manifest.yaml:181-184`),
`scaffold.profiles[].modules` (`manifest.yaml:216-236`), statecraft
`moduleCatalog.ts` (static), and the real `modules/` directory all describe
modules. `setup-app.ts:339-344` composes only `--with` flags and ignores
every profile-module declaration, so `--profile internal` does not ship
`user-management`. *Direction:* make ONE source authoritative (the manifest
`profiles[].modules`), have the generator read it, and have statecraft
consume it rather than re-declare it. Delete `scaffold.modules` and
`moduleCatalog.ts`'s catalog.

**STRUCT-2: Two generators that should be one.** `setup-app.ts` (single) and
`setup-dual-app.ts` (dual) are separate entry points. `parseSingleFlag` and
`confirm` are copy-pasted verbatim between them
(`setup-app.ts:207,277` vs `setup-dual-app.ts:104,115`). `--with` works in
single but not dual, undocumented. *Direction:* collapse into one generator
parameterized by `topology: single|dual`; extract shared CLI helpers to
`scripts/lib/cli-utils.ts`.

**STRUCT-3: `profile` vs `topology` conflation in the manifest schema.**
`args_schema.profile.enum` includes `"dual"` (`manifest.yaml:197-200`), but
`setup-app.ts` rejects `--profile dual` at runtime; dual routes to a
different entry point that takes no `--profile`. *Direction:* remove `dual`
from the profile enum; model topology as its own field.

**STRUCT-4: Adapter-name authority split across three gates.** The spec 198
governance gate is meant to be the sole adapter-admission authority, but
`repoInit.ts:146` (`VALID_ADAPTERS = {"acme-vue-encore"}`) and
`moduleCatalog.ts` each independently gatekeep. A newly admitted adapter
passes the gate and still fails repo-init (`MB-002`/`DSOT-3`). *Direction:*
derive valid adapters from the admitted `adapter-manifest` substrate rows;
delete the static set.

**STRUCT-5: Substrate accumulates generator source it never reads.** Since
the generator moved into `adapters/acme-vue-encore/`, the sync walk ingests
`scripts/*.ts` and `modules/**` into the substrate as `skill` /
`reference-data` rows (`translator.ts::classifyArtifactKind`). No consumer
reads them. *Direction:* decide whether the substrate should mirror generator
source at all; if not, add `adapters/**/scripts` + `adapters/**/modules` to
`FACTORY_EXCLUDES`; if yes, document the consumer.

**STRUCT-6: "legacy-*" source_ids are permanent, not legacy.**
`LEGACY_SINGLETON_SOURCE_ID = "legacy-mixed"` and
`LEGACY_TEMPLATE_SOURCE_ID = "legacy-template-mixed"`
(`upstreams.ts:30-33`) are the live operational source_ids for every org, yet
named as if pending replacement. Several call sites hardcode `"legacy-mixed"`
(`syncPipeline.ts:269`), which silently skips orgs whose factory source_id
differs (spec 139 permits multiple upstreams). *Direction:* rename to
`DEFAULT_FACTORY_SOURCE_ID` / `DEFAULT_TEMPLATE_SOURCE_ID`; replace hardcoded
literals with org-scoped queries; confirm whether the singleton assumption
still holds under spec 139.

**STRUCT-7: A categorical "process" shape the contract never defined.**
`countByLegacyKind` (`syncPipeline.ts:103-106`) and the `7-stage-build`
fixtures (`opcBundle.test.ts:52,165,288`) carry the retired spec 108
`{adapters, contracts, processes}` shape on the wire. `pipeline-state` schema
uses open-ended stage keys; the categorical shape is a statecraft invention.
*Direction:* either define a contract schema for a process/pipeline shape, or
serve substrate rows by `kind` and drop the categorical projection.

### 4.2 Double-source-of-truth catalogs and allowlists

| ID | Location | Why wrong | Direction |
|---|---|---|---|
| DSOT-1 | factory-encore `manifest.yaml:181-184` vs `:230` | `scaffold.modules.single-internal` and `profiles[internal].modules` encode the same `[user-management]` twice; no check they agree | keep `profiles[].modules`, drop `scaffold.modules` |
| DSOT-2 | statecraft `moduleCatalog.ts` (whole file) | static snapshot of factory-encore `modules/`; silently drifts on any upstream module change | read modules from substrate/manifest at runtime; delete static file |
| DSOT-3 | statecraft `repoInit.ts:146` | `VALID_ADAPTERS` static set duplicates governance-gate authority | derive from admitted manifest rows |

### 4.3 Declared but never implemented

| ID | Location | Why wrong | Direction |
|---|---|---|---|
| NIMP-1 | factory-encore `manifest.yaml:241-243` | `scaffold.emits` lists `.factory/pipeline-state.json` but no generator writes it (the process layer does) | remove from `scaffold.emits` (process owns it) |
| NIMP-2 | `manifest.yaml:238-240` | `scaffold.emits` lists `template.json` but only `add-module.ts` writes it, not `setup-app.ts` | have `setup-app.ts` seed an empty `template.json`, or drop from emits |
| NIMP-3 | `manifest.yaml:230` + `setup-app.ts:339-344` | `profiles[internal].modules` declared but never auto-composed (= STRUCT-1) | resolve via STRUCT-1 |

### 4.4 Naming residue

Canonical adapter name is **acme-vue-encore**. Cross-repo name table:

| Name | Where | Verdict |
|---|---|---|
| `acme-vue-encore` | all three repos, active paths | canonical |
| `template-encore` / `factory-encore` | repo names | correct (repo, not adapter id) |
| `acme-vue-node` | factory-encore `adapter-manifest.schema.yaml:32-33` (comment); statecraft `factory-project-detect/src/lib.rs:292,299`, migration-38 test constant | dead residue (live in comments/fixtures) |
| `aim-vue-node` / `goa-software-factory` / `GovAlta-Pronghorn` | statecraft migrations 36-38 + tests | migration history (immutable, OK) |
| `next-prisma` / `rust-axum` / `encore-react` | statecraft `relay.test.ts`, `translator.test.ts:267`, `adapter_registry.rs:450-487` | retired example adapters (dead fixtures) |
| `legacy-factory` | statecraft web placeholders, conflict/artifact/substrate test fixtures, `import.ts:379` user error | misleading residue |

Live-misalignment naming items (worth fixing):

| ID | Location | Why wrong | Direction |
|---|---|---|---|
| NAME-1 | statecraft `Makefile:649` | clone URL `statecrafting/factory.git` (old repo) | point at `factory-encore` (or read `UPSTREAM_FACTORY_SOURCE`) |
| NAME-2 | web `app.factory._index.tsx:131,139,153`, `app.factory.upstreams.tsx:171` | UI placeholders show `statecrafting/legacy-factory` / `statecrafting/template`; `"(acme-vue-encore today)"` inline status | update placeholders; enumerate adapters from substrate |
| NAME-3 | factory-encore `adapter-manifest.schema.yaml:32-33` | schema example uses `acme-vue-node` / `ACME Vue+Node Template` | update to acme-vue-encore + real display name |
| NAME-4 | template-encore `template-json.ts:13` | `templateName` defaults to repo name `template-encore`, not adapter name | default to `acme-vue-encore` or drop the field (identity seam, SEAM-2) |
| NAME-5 | statecraft `import.ts:379`, `upstreams.ts:429` | user-facing/error strings say `legacy-factory` / cite retired spec 108 | rephrase to operational language |

### 4.5 Stale comments referencing deleted concepts

The spec 199 cutover deleted `projection.ts`, `projectSubstrateToLegacy`,
`translateUpstreams`, the flat `scaffold_source_id` field, and the dual-write
to legacy tables. Many comments still describe them.

| ID | Location | Stale reference | Direction |
|---|---|---|---|
| STALE-1 | `translator.ts:21` | `upstream-map.yaml` is mirrored (file never existed in factory-encore) | delete sentence |
| STALE-2 | `translator.ts:537` | "mirrors `translateUpstreams`" (deleted by 199) | delete cross-ref |
| STALE-3 | `syncPipeline.ts:8,247` | `projectSubstrateToLegacy` read path (deleted) | rewrite for substrate-only reads |
| STALE-4 | `syncPipeline.ts:211,229-271` (`applyDualWrite`) | "dual-write + legacy projection" but only one write happens (migration 34 dropped legacy tables) | rename `applySubstrateWrite`; strip dual-write prose (= DEAD via DSOT) |
| STALE-5 | `scaffoldReadinessBlocker.ts:18,31`, `scaffoldReadiness.ts:57`, `syncWorker.ts:146`, `create.ts:150-151`, `scaffoldReadiness.test.ts` | `scaffold_source_id` flat field (retired by 199 FR-009; real check is `manifest.scaffold.source`) | update comments/labels/tests to spec 199 shape |
| STALE-6 | `moduleCatalog.ts:5-6`, `scaffold.test.ts:75` | "template's real modules/ directory" (now factory-encore's) | re-attribute to factory-encore adapter |
| STALE-7 | `Makefile:226-227` | indexes `api/factory/process-stages/*` (never created) | delete comment |
| STALE-8 | `substrateBrowser.ts:63-66` | docstring claims it loads `user-authored` origin but the filter excludes it (= MB-001) | fix filter or docstring |
| STALE-9 | factory-encore `ci-lockstep.yml:8-9,65`, `check.ts:10-14`, `check.test.ts:108` | "Phase 3 deferred" framing (pin is active since 2026-06-24); sparse-checkout still fetches template `modules/` no longer read | update to "active (2026-06-24)"; drop `modules` from sparse-checkout |
| STALE-10 | template-encore `PLACEHOLDERS.md:64-65,141-142` | ghost links `docs/SECURITY.md`, `TEMPLATE-GUIDE.md` (do not exist) | fix to `SECURITY.md`; delete TEMPLATE-GUIDE line |
| STALE-11 | template-encore `website/.../overview.md:27` | claims `@template/api` package exists (apps/api is excluded from workspaces) | list the three real packages |
| STALE-12 | template-encore `encore-cd.yml.example:78` | cites spec 021 (docs-website) for action-pinning; correct spec is 015 | fix to spec 015 |

### 4.6 Dead code (skipped tests, vacuous excludes, phantom guards)

| ID | Location | Why dead | Direction |
|---|---|---|---|
| DEAD-1 | statecraft `translator.ts:39-40` | `TEMPLATE_EXCLUDES` for `modules/` + `scripts/` never fire (gone from template) | delete predicates |
| DEAD-2 | `integration_078_e2e.rs` (whole file) | guards on `adapters/acme-vue-node` in a non-existent in-tree `factory/`; always skips | delete; open fixture spec if coverage wanted |
| DEAD-3 | `preflight.rs:440-458` | `../factory/adapters/acme-vue-node` existence-guarded; always skips | delete or add committed fixture |
| DEAD-4 | `validation.rs:648-706` | references non-existent `../../factory/contract/examples/acme-vue-node...yaml` | delete or commit fixture |
| DEAD-5 | `adapter_registry.rs:450-487` | expects 4 retired adapter names from non-existent `../../factory` | delete or replace with acme-vue-encore fixture |
| DEAD-6 | factory-encore `born-with.ts:31-38` | `GENERATOR_ARTIFACT_TOP_LEVEL` lists `scripts`/`modules`/`orchestration` now absent from template baseline | prune to `tools`; comment why |
| DEAD-7 | factory-encore `test-helpers.ts:109-114` | `ALL_MODULE_NAMES` omits `user-management` (the only real module) | rename to `CROSS_CUTTING_MODULE_NAMES` or add it |
| DEAD-8 | factory-encore `process/agents/pipeline-orchestrator.md:1-6` | missing `stage:` frontmatter every other agent has | add `stage: coordinator` or schema exception |

### 4.7 Cross-repo seams

| ID | Location | Seam | Direction |
|---|---|---|---|
| SEAM-1 | factory-encore `baseline.lock.json:4` | lockstep `pinnedRef` = `c7603ee`, template-encore HEAD = `0ede6dc` (2 commits ahead). 001/002 invariant hashes verified unchanged across the gap, so the gate still passes, but the pin lags | bump `pinnedRef` to current HEAD under the spec 031 deliberate-bump gate |
| SEAM-2 | template-encore `template-json.ts:13` | produced-app `template.json::templateName` defaults to repo name `template-encore`, diverging from adapter identity `acme-vue-encore` | align default to adapter name, or retire `templateName` in favour of `adapter.name` |
| SEAM-3 | governance-envelope version split (factory 1.0.0 / Rust 1.1.0 / admission requires 1.0.0) | the only version mismatch that blocks a real code path (spec 202 `budgets:`) | pick canonical version; make all three agree |
| SEAM-4 | factory-encore `manifest.yaml:327` (`internal.env_example: ".env.internal.example"`) | declares a file no generator writes (generator writes `apps/api/.env.example`) | fix the declared path or implement the file |

### 4.8 Duplicated code

| ID | Location | Duplication | Direction |
|---|---|---|---|
| DUP-1 | statecraft `synthesiseId` copied in `runs.ts:38`, `create.ts:580`, `import.ts:905`, `opcBundle.ts:570` (canonical `browse.ts:376`) | 4 verbatim copies with "must match browse.ts" comments | import from `browse.ts` or a shared `factory/ids.ts` |
| DUP-2 | factory-encore `parseSingleFlag` + `confirm` in both generators (= STRUCT-2) | verbatim copy-paste | extract to `scripts/lib/cli-utils.ts` |

### 4.9 Open behavioural questions (owner to confirm)

- **OAP-native adapter workflow** (`createOapNative.test.ts`): the test
  exercises a retired `scaffold_source_id` JSONB probe and the `next-prisma`
  adapter. No spec explicitly retiring the "OAP-native adapter" concept was
  found. **Confirm:** is this workflow still alive (then rewrite for the spec
  199 / `scaffold.source.remote` shape) or retired (then delete the test
  file)?
- **Substrate scope** (STRUCT-5): should the substrate mirror generator
  source code at all? This is a design decision, not a cleanup.
- **Sandboxed scaffold execution:** spec 198 declares
  `scaffold_execution.isolation: sandbox-required`, but warmup runs the
  generator in-pod. Deferred-with-trigger when a sandbox backend is
  scheduled.

---

## 5. Themes for a remediation plan

The ~70 items cluster into a small number of work-streams. Rough grouping
(the owner sequences):

1. **Make the manifest the single module authority.** Resolves STRUCT-1,
   DSOT-1, DSOT-2, NIMP-3. Generator reads `profiles[].modules`; statecraft
   consumes the manifest/substrate; delete `scaffold.modules` and the static
   `moduleCatalog.ts`. Needs a small factory-encore spec edit + the spec 112
   warmup work (already amended).

2. **Collapse the two generators.** Resolves STRUCT-2, STRUCT-3, DUP-2,
   SEAM-4. One generator parameterized by topology; shared CLI lib; fix the
   profile/topology schema. factory-encore-side; coordinates with the spec
   112 entry-point dispatch.

3. **Governance gate as the sole adapter authority.** Resolves STRUCT-4,
   DSOT-3. Derive valid adapters from admitted manifest rows; delete
   `VALID_ADAPTERS`.

4. **Decide substrate scope + retire the categorical process shape.**
   STRUCT-5, STRUCT-7. Design decisions, not mechanical.

5. **Version reconciliation.** SEAM-3 (governance-envelope) is the live one;
   needs a coordinated bump across three repos + spec 202.

6. **Naming + comment sweep.** All of §4.4 and §4.5; mostly mechanical, but
   STRUCT-6 (rename `legacy-*` source_ids) touches behaviour and call sites.

7. **Dead-test cleanup.** §4.6; delete or fixture-back the skipped Rust tests
   and vacuous excludes.

8. **Cross-repo hygiene.** SEAM-1 (bump lockstep pin), SEAM-2 (template.json
   identity), DUP-1 (synthesiseId).

Mechanical (comment/naming/dead-code) items can land as low-risk sweeps;
STRUCT-1 through STRUCT-7 and the SEAM/version items are the ones that need
design decisions and likely spec amendments (factory-encore specs for the
generator/module changes; OAP specs 112/198/199/202 for the consumer side).
The one live break (§2.2) is already addressed by the pending spec 112
implementation and does not depend on any of the above.
