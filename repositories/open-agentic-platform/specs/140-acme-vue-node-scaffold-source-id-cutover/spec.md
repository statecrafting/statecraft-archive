---
id: "140-acme-vue-node-scaffold-source-id-cutover"
slug: acme-vue-node-scaffold-source-id-cutover
title: "acme-vue-node manifest cutover to scaffold_source_id (amendment of 139)"
status: approved
implementation: complete
owner: bart
created: "2026-05-06"
approved: "2026-05-06"
closed: "2026-05-06"
amended: "2026-06-09"
amendment_record: "199-factory-thin-consumer-sync"
kind: amendment
domain: platform
risk: low
amends: ["139-factory-artifact-substrate"]
depends_on:
  - "112-factory-project-lifecycle"  # factory-project-lifecycle (Create/Import flow consumes scaffold readiness)
  - "138-statecraft-create-realised-scaffold"  # statecraft-create-realised-scaffold (introduced template_remote, scaffoldReadiness)
  - "139-factory-artifact-substrate"  # factory-artifact-substrate (§7.2 declared scaffold_source_id replaces template_remote)
code_aliases: ["ACME_VUE_NODE_SCAFFOLD_SOURCE_ID_CUTOVER"]
establishes:
  - unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/types.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/projects/scaffoldReadinessBlocker.ts }
references:
  # Spec 199 amendment (2026-06-09): the thin-consumer cutover deleted the
  # adapter-config constants and the categorical projection; §2.2's
  # manifest-carried scaffold_source_id is partially superseded by 199
  # FR-009 (resolution-at-admission). Historical pointers, non-owning.
  - role: historical
    unit: { kind: file, path: platform/services/statecraft/api/factory/oapNativeAdapters.ts }
  - role: historical
    unit: { kind: file, path: platform/services/statecraft/api/factory/projection.ts }
extends:
  - spec: "139-factory-artifact-substrate"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/factory/translator.ts }
  - spec: "139-factory-artifact-substrate"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/factory/substrateBrowser.ts }
  - spec: "139-factory-artifact-substrate"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/factory/syncWorker.ts }
  - spec: "139-factory-artifact-substrate"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/scheduler.ts }
  - spec: "139-factory-artifact-substrate"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/templateCache.ts }
  - spec: "139-factory-artifact-substrate"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/create.ts }
  - spec: "139-factory-artifact-substrate"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffoldReadiness.ts }
  - spec: "139-factory-artifact-substrate"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.projects.new.tsx }
  - spec: "139-factory-artifact-substrate"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/lib/projects-api.server.ts }
  - spec: "139-factory-artifact-substrate"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/CLAUDE.md }
summary: >
  Spec 139 §7.2 declared `template_remote` is replaced by
  `orchestration_source_id` + `scaffold_source_id`. Phase 2 landed the
  rename for the OAP-native adapters (`next-prisma`, `rust-axum`,
  `encore-react`) via `oapNativeSanitise.ts`, but the synthetic
  `acme-vue-node` adapter that `projection.ts::buildAdapter` emits from
  template-origin substrate rows still carries `template_remote` only.
  Five downstream call sites (scheduler, templateCache, create, types,
  scaffoldReadiness fallback) read that legacy field directly. This
  amendment finishes §7.2 by routing acme-vue-node through
  `factory_upstreams` like every other adapter and dropping the legacy
  field from the read paths.
---

# 140 — acme-vue-node Manifest Cutover to `scaffold_source_id`

> **Amended 2026-06-09 by spec [199](../199-factory-thin-consumer-sync/spec.md)**
> (which also partially supersedes §2.2): the thin-consumer cutover
> deleted `oapNativeAdapters.ts` and `projection.ts`, and the
> manifest-carried flat `scaffold_source_id` is replaced by
> resolution-at-admission from the manifest's org-agnostic
> `scaffold.source.remote` (199 FR-009). The dead-path claims here move
> to non-owning `references: role: historical`.

> **Amendment** of [`139-factory-artifact-substrate`](../139-factory-artifact-substrate/spec.md).
> Spec 139 remains the authoritative substrate design. This spec
> closes the §7.2 rename for the one adapter that didn't get migrated
> in Phase 2.

## 1. Why this amendment

Spec 139 §7.2 says, verbatim:

> The adapter manifest's `template_remote` field (today only set for
> `acme-vue-node`) is replaced by:
>
> ```yaml
> orchestration_source_id: oap-next-prisma
> scaffold_source_id: oap-next-prisma-scaffold
> scaffold_runtime: node-24
> ```

Phase 2's success criterion SC-004 ("OAP-native parity") drove the
rename for `next-prisma`, `rust-axum`, `encore-react` via
`oapNativeSanitise.ts:96` (`parsed.scaffold_source_id =
input.config.scaffoldSourceId`). The OAP-native ingest config in
`oapNativeIngest.ts` even includes an `acme-vue-node` entry with
`scaffoldSourceId: "acme-vue-node-template"` — but two structural
factors mean it never takes effect for that adapter:

1. **Two parallel projection paths produce acme-vue-node.**
   `projection.ts::buildAdapter` (line 116) synthesises an adapter
   row from template-origin substrate rows. `buildOapNativeAdapters`
   (line 117) emits adapters from `oap-self` `adapter-manifest`
   rows. The de-dup loop (line 118) keeps the **template-origin** one
   on collision, so the OAP-native acme-vue-node manifest with
   `scaffold_source_id` is silently discarded.

2. **The template-origin builder still emits `template_remote`.**
   `buildAdapter` (lines 215-220) writes
   `manifest.template_remote = input.templateRemote` and never sets
   `scaffold_source_id`. The translator's options carry the same
   field forward at `translator.ts:355-356`.

Result: every acme-vue-node adapter row reaching consumers carries the
legacy field but not the new one. Five consumer sites then read that
legacy field directly:

| File | Lines | Read |
|---|---|---|
| `api/projects/scaffoldReadiness.ts` | 90, 165, 169 | `manifest.template_remote` (legacy fallback for Create-eligibility) |
| `api/projects/scaffold/scheduler.ts` | 67-81, 97 | `manifest.template_remote` for warmup context resolution |
| `api/projects/scaffold/templateCache.ts` | 81 (comment + `WarmupContext.templateRemote`) | passed-through; the field carries the upstream URL into `git clone` |
| `api/projects/scaffold/types.ts` | 27 | `template_remote: string` (required, in `ScaffoldRequest`) |
| `api/projects/create.ts` | 145, 166-175 | `manifest.template_remote` to derive the clone target |

The scaffoldReadiness comment block (lines 33-37, 53-58, 62-64) calls
this a "transition window … so the existing flow doesn't regress."
Spec 139 closed without scheduling the end of that window. This
amendment schedules it.

This is an `amends:` (spec 119 protocol), not a supersession. Spec
139's substrate design, success criteria, and Phase 4/4b cutover all
stand; only the §7.2 rename for acme-vue-node remains incomplete and
is finished here.

## 2. The four changes

### 2.1 Emit-side — projection writes `scaffold_source_id`, not `template_remote`

**Was:** `projection.ts::buildAdapter` (lines 215-220) writes
`manifest.template_remote` (and `template_default_branch`) for the
synthetic acme-vue-node manifest. `translator.ts:355-356` does the same
for direct translator output.

**Is:** Both writers emit the spec 139 §7.2 trio
(`orchestration_source_id`, `scaffold_source_id`, `scaffold_runtime`)
with the canonical acme-vue-node values:

```yaml
orchestration_source_id: acme-vue-node-orchestration   # source_id of the Factory Agent upstream
scaffold_source_id: acme-vue-node-template             # matches OAP_NATIVE_ADAPTERS["acme-vue-node"].scaffoldSourceId
scaffold_runtime: node-24                             # matches spec 112 §10
```

`template_remote` and `template_default_branch` are no longer written
by either path. The substrate's `factory_upstreams` rows (one
`role='orchestration'` and one `role='scaffold'`, both produced by the
existing per-side row decomposition in `factory_upstreams` post-Phase
4b) carry the actual repo URLs and refs.

**Why:** §7.2's "is replaced by" is unambiguous — the manifest carries
ids, not URLs. URLs live in `factory_upstreams` so an org can rotate
upstreams without touching adapter manifests.

### 2.2 Read-side — scaffold layer resolves clone target via `factory_upstreams`

**Was:** `scheduler.ts::resolveWarmupContext` (lines 60-86) walks
adapter manifests, picks the first `template_remote`, treats it as the
clone target. `create.ts:166-175` does the same for per-request
scaffolds.

**Is:** Both read `manifest.scaffold_source_id`, look up the
matching `factory_upstreams` row in the same org (composite-PK on
`(org_id, source_id)` post-Phase 4b), and derive
`(repoUrl, ref)` from that row. The scaffold layer's `WarmupContext`
field renames from `templateRemote` to `scaffoldRepoUrl`; the
`defaultBranch` field becomes `scaffoldRef`. The PAT resolver is
unchanged (still keyed by org id).

`scaffold/types.ts::ScaffoldRequest.template_remote` is dropped
entirely — `ScaffoldRequest` derives the clone target inside the
service from the resolved `factory_upstreams` row.

**Why:** Indirection through `factory_upstreams` is what the substrate
buys. Reading the URL off the manifest defeats the §7.2 contract — it
makes the manifest the source of truth for upstream URLs, which is
exactly the coupling spec 139 set out to remove.

### 2.3 Readiness — drop the legacy fallback

**Was:** `scaffoldReadiness.ts:165-169` evaluates
`createEligible = hasTemplateRemote || scaffoldSourceResolved`. The
`hasTemplateRemote` path exists "so the existing flow doesn't
regress" (lines 33-37, 62-64).

**Is:** `createEligible = scaffoldSourceResolved`. The
`AdapterReadinessVerdict.hasTemplateRemote` field is removed.
`ScaffoldReadinessResponse.hasTemplateRemote` is removed. The
`stale-adapter-manifest` blocker now fires when no adapter declares
`scaffold_source_id` at all (which, post-§2.1, is impossible for
adapters synced after this spec lands — so the blocker becomes a
"please re-sync" prompt for orgs whose substrate predates this
amendment).

The web banner at `app.projects.new.tsx:655-670` simplifies in
parallel — the parenthetical "(§7.2 replaced the legacy
`template_remote`)" added by the spec 139 banner-alignment commit
becomes vestigial and is deleted.

**Why:** The fallback is the visible artifact of the unfinished §7.2.
Once §2.1 + §2.2 land, no acme-vue-node manifest in the substrate
carries `template_remote` (newly synced) or relies on it for
Create-eligibility (existing rows resolve through `scaffold_source_id`
after re-sync).

### 2.4 Migration of existing org substrate

**Constraint:** Existing orgs have acme-vue-node `template-origin`
substrate rows whose `upstream_body` projects to a manifest with
`template_remote` only. The §2.1 emit-side change only affects
manifests written *after* the next sync run.

**Resolution:** Migration 36 (one-shot, idempotent) re-runs the
projection's `buildAdapter` logic against existing template-origin
rows and writes the new manifest shape into a synthetic `oap-self`
`adapter-manifest` substrate row at
`adapters/acme-vue-node/manifest.yaml`. The de-dup priority in
`projection.ts:118` is flipped — when both a template-origin synthetic
and an `oap-self` `adapter-manifest` exist for the same name, the
**`oap-self` row wins** (it carries the canonical §7.2 manifest
shape; the template-origin synthetic is deprecated).

The `buildAdapter` synthetic itself is retained — the template
upstream still produces orchestrator/skills content rendered into
`manifest.skills` and `manifest.orchestrator` for spec 108 wire shape
parity. Only its manifest-id-injection behaviour is dropped.

**Why a migration, not a rerun-of-sync:** sync runs are
operator-triggered. Running migration 36 at deploy time means every
org's acme-vue-node adapter has the §7.2 shape on the next request —
no `/factory-sync` button needs to be pressed first.

## 3. What does NOT change

- Spec 139's substrate design, audit shape, and Phase 4/4b cutover —
  unchanged.
- The `factory_upstreams` composite-PK shape — unchanged.
- The OAP-native ingest path for `next-prisma`, `rust-axum`,
  `encore-react` — unchanged (they already declare
  `scaffold_source_id` per `oapNativeSanitise.ts:96`).
- The spec 108 wire shape on `GET /api/factory/{adapters,…}` — the
  legacy fields surface inside the projection's `manifest` object;
  removing `template_remote` from the manifest is a wire change in
  the same way Phase 4b dropped the four legacy `factory_upstreams`
  per-side columns. External consumers of that endpoint (today: only
  statecraft itself) consume `scaffold_source_id` after this
  amendment.
- The scaffold warmup contract on `GET /api/projects/scaffold-readiness`
  — the response shape's `blocker` enum is unchanged; only the
  internal `hasTemplateRemote` boolean is removed.
- Spec 138's profile catalog and PVC contract — unchanged.

## 4. Risks and follow-ups

- **Migration 36 is one-shot, but the underlying template-origin
  synthetic is retained for non-manifest fields.** A future spec
  could fold orchestrator/skills into the `oap-self` adapter row's
  `__companion` envelope and retire `buildAdapter` entirely. Today's
  amendment intentionally leaves that alone — it's mechanism cleanup
  with no §7.2 contract value.

- **`factory_upstreams` lookup adds a DB round-trip to the
  warmup resolver.** Today's `scheduler.ts::resolveWarmupContext`
  walks adapters in-memory; post-§2.2 it issues one
  `select * from factory_upstreams where org_id = ? and source_id = ?`
  per adapter checked. The warmup resolver runs on a 30-min cron
  plus boot; the additional query is negligible. The per-request
  `create.ts` path issues one such query per project create, also
  negligible.

- **Banner copy churn.** The `stale-adapter-manifest` banner at
  `app.projects.new.tsx:655-670` was just updated (spec 139
  banner-alignment commit) to mention `scaffold_source_id` with a
  parenthetical pointing at the legacy `template_remote`. Once §2.3
  lands, the parenthetical is deleted; the spec 139 reference
  remains. Copy is updated in the same commit as the readiness
  rewrite.

## 5. Test scenarios

| Scenario | Pre-amendment | Post-amendment |
|---|---|---|
| New org, fresh `/factory-sync` | acme-vue-node manifest carries `template_remote` only | acme-vue-node manifest carries `scaffold_source_id` only; `template_remote` absent |
| Existing org, post-deploy (migration 36 ran) | acme-vue-node row in substrate has `template_remote` only; readiness resolves via legacy fallback | acme-vue-node has both a template-origin row (orchestrator/skills only) and an `oap-self` `adapter-manifest` row (manifest with `scaffold_source_id`); projection's de-dup picks `oap-self`; readiness resolves via `scaffold_source_id` |
| Org with no factory_upstreams row matching `acme-vue-node-template` | n/a (clone target read off manifest) | `scaffoldReadiness` reports `blocker='no-scaffold-source-resolved'`; the per-adapter list shows acme-vue-node as needing the upstream registered; banner directs to `/app/factory/upstreams` |
| Create flow, project create | `create.ts` reads `manifest.template_remote`, clones | `create.ts` reads `manifest.scaffold_source_id`, resolves `factory_upstreams`, clones |
| Warmup resolver | picks first adapter with `template_remote`; logs reference spec 138 | picks first adapter with `scaffold_source_id` resolving to a `factory_upstreams` row; logs reference spec 139 §7.2 |

Test files affected (non-exhaustive — golden updates expected):
- `api/factory/translator.test.ts`
- `api/factory/projection.test.ts`
- `api/projects/scaffold/scaffold.test.ts`
- (new) `api/projects/scaffold/scheduler.test.ts` covering the
  `factory_upstreams` lookup branch.

## 6. Acceptance criteria

- **AC-1:** No production code under `platform/services/statecraft/`
  reads `manifest.template_remote`. (`grep -r template_remote
  platform/services/statecraft --include='*.ts' --exclude='*.test.ts'`
  returns only schema/migration historical comments.)

- **AC-2:** `oapNativeIngest.ts::OAP_NATIVE_ADAPTERS["acme-vue-node"]`
  is the single source of truth for the acme-vue-node `scaffoldSourceId`
  value. `projection.ts::buildAdapter` and `translator.ts` import that
  constant rather than duplicating the string literal.

- **AC-3:** `scaffoldReadiness` API response no longer carries
  `hasTemplateRemote` (top-level or per-adapter). The response shape's
  TypeScript type is updated in
  `web/app/lib/projects-api.server.ts`.

- **AC-4:** Migration 36 (`36_aim_vue_node_manifest_cutover.up.sql`)
  exists, is idempotent, and at least one Encore test asserts that
  re-running it on an already-migrated row is a no-op.

- **AC-5:** A fresh `/factory-sync` against a legacy-factory +
  acme-vue-node-template upstream pair produces acme-vue-node adapter
  rows whose projected manifest contains
  `scaffold_source_id: "acme-vue-node-template"` and does NOT contain
  `template_remote`.

- **AC-6:** The web `app.projects.new.tsx` Create form, with a
  newly-synced org, gates on `scaffold_source_id` resolution alone;
  the `stale-adapter-manifest` banner copy no longer references
  `template_remote`.

- **AC-7:** Spec/code coupling gate (spec 127/130/133) passes against
  this amendment's `implements:` list with no warnings.

## 7. Out of scope

- Retiring `projection.ts::buildAdapter` entirely (orchestrator/skills
  re-homing). See §4 follow-up.
- OAP-native ingest auto-running for acme-vue-node at sync time. Today
  the OAP-native adapter source dir is walked separately; making the
  acme-vue-node source consistent with that walk is mechanism cleanup
  with no §7.2 contract value.
- Multi-tenant warmup cache (§2.4 in spec 138's risks). Independent.

---

> **Authorship note:** The investigation that surfaced this gap began
> with a UI banner ("Adapter manifest needs refreshing … lack the
> `template_remote` field") that still cited the spec 138 field name
> after spec 139 closed. The banner copy was patched directly; this
> amendment captures why that patch alone was insufficient and what
> the rest of the cutover requires. See the
> `139-factory-artifact-substrate/spec.md` §11 post-close fixes
> section for the precedent of capturing residual work without
> re-opening the parent spec.
