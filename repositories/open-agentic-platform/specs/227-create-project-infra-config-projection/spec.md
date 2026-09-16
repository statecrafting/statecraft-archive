---
id: "227-create-project-infra-config-projection"
title: "Create Project as an Encore-infra-config projection: derived catalog, two-axis selector, dev-provisioned Redis"
feature_branch: "227-create-project-infra-config-projection"
status: approved
implementation: complete  # Staged implementation, now complete. The design PR (#530) landed only the featuregraph golden node (extends 034); each follow-on stage PR then promoted referenced paths to authoritative relationships and landed code one subsystem at a time. Stage 1 (catalog derivation), Stage 2 (two-axis form + base-app config), Stage 3 (deployd previewRedis), the interim nit PR, Stage 2b (auth-driver axis, spec 229: an independent mock|rauthy selector patched as AUTH_DRIVER), the cron-capability stage (spec 230: cron surfaced as an Application feature submitting its transitive data-postgres requires closure), and Stage 4 (end-to-end Redis wiring: the uses_redis column + migration 4, the create trigger reading the opt-in data-redis selection, the deploy preview_redis trigger, and the chart REDIS_USER injection) have all landed (2026-07-09). FR-004/FR-005/FR-006 satisfied; factory-encore spec 008 (data-redis promotion) is the merged adapter-side dependency.
kind: platform
domain: platform
created: "2026-07-06"
authors: ["open-agentic-platform"]
language: en
summary: >
  The statecraft "Create New Project" surface hand-mirrors the factory
  adapter's module catalog in two independently-maintained hardcoded copies
  (the frontend route and a backend module) that have drifted: they still
  offer a "Redis" module whose factory-encore source is an inert marker with a
  false label (it claims a Redis rate-limit backend that does not exist; the
  baseline limiter is Postgres). The surface also conflates three different
  kinds of thing under one checkbox UI (inert markers, base-app config knobs,
  and the one real feature module) and fuses factory-encore's two orthogonal
  axes (auth profile x topology) into a single "Variant" selector that silently
  drops the default profile. This spec reframes the surface as a projection of
  vocabulary that already exists: feature modules derived from the adapter
  manifest, and infrastructure resources projected from the app's committed
  apps/api/infra.config.json (Encore's infra.schema.json). It splits the form
  into a two-axis selector (auth {public, internal}; topology {single, dual}),
  an Infrastructure section (read-only projection of the baked infra.config
  topology, Postgres default-on, Redis opt-in), an Application-features section
  (real modules only), and Base-app config fields (CORS, BFF knobs). Under
  Option A (topology parity), the infra.config.json is the app-level,
  build-time, read-only topology; per-environment hosts/credentials/secrets are
  runtime env resolved via GitHub Environments (dev owned by OAP/deployd,
  staging/prod by the tenant). It adds a deployd previewRedis dev-only
  provisioning path mirroring previewDatabase so Redis becomes a real
  provisionable resource. Companion to factory-encore spec 008 (data-redis
  promotion, dual module composition, CORS knob), which owns the adapter-side
  changes this surface projects.
code_aliases: ["previewRedis", "MODULE_CATALOG", "ENCORE_INFRA_CONFIG"]
depends_on:
  - "138-statecraft-create-realised-scaffold"  # owns the create/scaffold flow (create.ts, scaffoldFromPrebuilt, pickProfileFromModules) and the moduleCatalog this spec derives instead of hand-mirrors
  - "199-factory-thin-consumer-sync"  # owns the statecraft thin-consumer mirror of the factory manifest; the hand-mirrored MODULE_CATALOG is exactly the drift-prone copy this spec replaces with a derived catalog
  - "160-factory-adapter-statecraft-relocation"  # owns the statecraft-resident adapter surface (adapter-scopes.json) the derived infra/feature vocabulary reads from
  - "213-tenant-repo-image-build"  # owns the seeded oap-build.yml and `encore build docker --config ./infra.config.json`; Option A rides on this single build path
  - "214-tenant-app-chart-supersession"  # owns the acme-vue-encore chart and the previewDatabase dev-provisioning path previewRedis mirrors
  - "225-deployd-selfprovision-rbac"  # owns the current deployd provisioning/RBAC surface previewRedis extends
establishes:
  # Stage 3 (deployd previewRedis) landed this net-new chart template: the
  # dev-only preview-Redis workload (Deployment + Service + generated-password
  # Secret), the redis.yaml mirror of 214's postgres.yaml. Promoted here from
  # the design PR's implied surface as the code landed (spec 227 §6 staging;
  # the 214 `references:planned-establishes -> establishes` precedent).
  - unit: { kind: file, path: platform/charts/acme-vue-encore/templates/redis.yaml }
  # Stage 1 (catalog derivation) landed this net-new endpoint: the org-scoped
  # module-catalog loader + GET /api/factory/module-catalog that projects the
  # feature-module list from the adapter's substrate module manifests, replacing
  # the two hand-mirrored MODULE_CATALOG copies (FR-001).
  - unit: { kind: file, path: platform/services/statecraft/api/factory/moduleCatalog.ts }
  # Interim (post-Stage 1): the two Stage-2-deferred ai-review nits from #533,
  # pulled forward. Net-new files, so they enter establishes directly rather
  # than promoting a references: pointer: the pure per-org catalog cache behind
  # loadModuleCatalogForOrg, and the pure transitive module-selection helper the
  # picker's toggle now delegates to (each with its unit test).
  - unit: { kind: file, path: platform/services/statecraft/api/factory/moduleCatalogCache.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/moduleCatalogCache.test.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/module-selection.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/module-selection.test.ts }
  # Stage 2 (form reframe) landed this net-new pure helper: patchEnvExample
  # plumbs the Base-app config knobs (FR-007) into the scaffolded app's committed
  # apps/api/.env.example.
  - unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/envExample.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/envExample.test.ts }
  # Stage 2 review follow-up: the pure two-axis (Topology x Auth) to variant
  # mapping, extracted from the route so it is unit-testable.
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/create-project-variant.ts }
  - unit: { kind: file, path: platform/services/statecraft/web/app/lib/create-project-variant.test.ts }
  # Stage 4 (end-to-end Redis): net-new migration adding the projects
  # uses_redis column. Under Option A the topology is build-time, so the opt-in
  # Redis selection is fixed at scaffold; the deploy trigger reads the column to
  # auto-provision a dev preview Redis (mirrors the default-on preview Postgres).
  - unit: { kind: file, path: platform/services/statecraft/api/db/migrations/4_project_uses_redis.up.sql }
extends:
  # A new spec adds a node to the featuregraph golden (same precedent as specs
  # 214, 222, 223, 224, 225, 226); claimed additively against spec 034 so the
  # golden diff carries a 227 authority.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
  # Stage 3 (deployd previewRedis): promoted from references: as the
  # implementation landed. previewRedis mirrors 214's previewDatabase machinery
  # (helm.rs DeployExtras/build_values, routes.rs wire) and adds to 214's
  # acme-vue-encore chart the Redis provisioning path plus the previewDatabase
  # SQL_* env correction (the app resolves ${SQL_HOST}/${SQL_USERNAME}/
  # $env:SQL_PASSWORD, not the POSTGRES_* names the chart previously injected).
  # Additive against 214.
  - spec: "214-tenant-app-chart-supersession"
    nature: additive
    unit: { kind: file, path: platform/services/deployd-api-rs/src/helm.rs }
  - spec: "214-tenant-app-chart-supersession"
    nature: additive
    unit: { kind: file, path: platform/services/deployd-api-rs/src/routes.rs }
  - spec: "214-tenant-app-chart-supersession"
    nature: additive
    unit: { kind: file, path: platform/charts/acme-vue-encore/templates/deployment.yaml }
  - spec: "214-tenant-app-chart-supersession"
    nature: additive
    unit: { kind: file, path: platform/charts/acme-vue-encore/values.yaml }
  - spec: "214-tenant-app-chart-supersession"
    nature: additive
    unit: { kind: file, path: platform/charts/acme-vue-encore/templates/_helpers.tpl }
  - spec: "214-tenant-app-chart-supersession"
    nature: additive
    unit: { kind: file, path: platform/charts/acme-vue-encore/templates/networkpolicy.yaml }
  # Stage 1 (catalog derivation): promoted from references: as the
  # implementation landed. The create-project feature-module catalog is now
  # derived at request time from the adapter's substrate module manifests
  # instead of hand-mirrored in two copies (FR-001, SC-001). Additive against
  # 138 (the create/scaffold surface these paths belong to), 199 (the
  # thin-consumer factory browser whose admission gate the endpoint reuses), and
  # 112 (which owns the scaffold test files).
  - spec: "138-statecraft-create-realised-scaffold"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/moduleCatalog.ts }
  - spec: "138-statecraft-create-realised-scaffold"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/create.ts }
  - spec: "138-statecraft-create-realised-scaffold"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/perRequestScaffold.ts }
  - spec: "138-statecraft-create-realised-scaffold"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.projects.new.tsx }
  - spec: "138-statecraft-create-realised-scaffold"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/web/app/lib/projects-api.server.ts }
  # The #533 review follow-up refreshed the statecraft CLAUDE.md scaffold
  # `moduleCatalog.ts` description to the Stage 1 derived-catalog API this spec
  # introduced, so 227 additively co-authors that doc file (138 already claims
  # it via extends 112).
  - spec: "138-statecraft-create-realised-scaffold"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/CLAUDE.md }
  - spec: "199-factory-thin-consumer-sync"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/factory/browse.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/scaffold.test.ts }
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/perRequestScaffold.test.ts }
  # Stage 4 (end-to-end Redis): promoted from references: as the wiring landed.
  # deploy.ts now has an honest opt-in source (the project's fixed uses_redis
  # selection), so the preview_redis dev-provisioning trigger lands; additive
  # against 215, which refines the deploy trigger.
  - spec: "215-statecraft-deploy-trigger-ux"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/deploy/deploy.ts }
  # The projects table gains the uses_redis column (recording the opt-in Redis
  # selection at create); additive against 114, which establishes schema.ts.
  - spec: "114-async-project-clone-pipeline"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/db/schema.ts }
---

# 227. Create Project as an Encore-infra-config projection

> Provenance: this contract formalizes the agreed direction in
> [`docs/analysis/create-project-encore-config-reframe.md`](../../docs/analysis/create-project-encore-config-reframe.md).
> Companion: factory-encore spec `008-data-redis-promotion-dual-composition`
> owns the adapter-side changes (data-redis promotion, the dual
> module-composition gap, the CORS knob decision) this surface projects.

## 1. Purpose

The "Create New Project" surface is the front door of the factory: it is where
an operator turns a factory adapter + variant + module selection into a
scaffolded tenant repo, a seeded pipeline state, and a first deploy. Today that
surface is enigmatic for three mechanical reasons, and it hides the one
artifact that makes the produced app portable.

### 1.1 The catalog is hand-mirrored and has drifted

The module catalog (list, group labels, prose descriptions) is hardcoded inline
in two independently-maintained copies:

- frontend `platform/services/statecraft/web/app/routes/app.projects.new.tsx`
  (the `MODULE_CATALOG` const)
- backend `platform/services/statecraft/api/projects/scaffold/moduleCatalog.ts`

Nothing reads the adapter manifest at runtime, so the prose rots. It has: the
two copies already diverge in wording, and both still offer a **Redis** module.
In factory-encore that module is an inert marker (`files: {}`, `status: stable`)
whose description claims a Redis rate-limit backend that does not exist. The
baseline rate limiter is a Postgres `UNLOGGED` counter, and no baseline code
reads `REDIS_URL`. So the Redis checkbox scaffolds a real-but-dead module with a
false label. This is the drift-prone hand-copy the spine exists to eliminate
(constitution Principle II).

### 1.2 One checkbox UI conflates three kinds of thing

The "Modules" list presents, at identical visual weight:

- **Inert markers** (`security-core`, `data-postgres`) that ship nothing;
  toggling them is nearly a no-op. `security-core`'s only output is a
  `CORS_ORIGIN` env var that no baseline code reads (CORS is hardcoded static in
  the baseline `encore.app`).
- **A base-app config knob plus a diagnostic page** (`api-gateway`): the BFF
  proxy backend always ships in the baseline; the module contributes real,
  consumed env knobs (`PRIVATE_API_BASE_URL`, `GATEWAY_TIMEOUT_MS`) and one Vue
  `/connectivity` test page.
- **One real feature module** (`user-management`): a new Encore service,
  migration, admin CRUD, and `requireRole`.

Presenting a no-op marker and a real service as the same control is why the
form reads as opaque, and why "opt-in" sits next to "ships in the base app" in
the same description.

### 1.3 Two axes are fused, and the default profile is dropped

factory-encore has two orthogonal axes: an **auth profile** (`minimal` /
`public` / `internal`, the auth-driver axis) and a **topology** (`single` /
`dual`, where dual is explicitly "a topology, not a profile"). The form fuses
them into one three-way "Variant" (`single-public` / `single-internal` /
`dual`) and silently omits `minimal`. At the OAP surface `minimal` (mock auth)
has no product home and is deliberately not offered, but the fusion also means
a user cannot express the axes independently.

Spec 229 later untangled the naming this section conflates: the app-level
**auth driver** (`mock` | `rauthy`) is a SEPARATE axis from the **audience**
(`public` | `internal`). Every real IdP federates inside Rauthy, so the driver
is orthogonal to audience and topology. Stage 2b lands that driver as its own
selector (defaulting to `rauthy`, the production driver), patched into the
scaffolded `apps/api/.env.example` as `AUTH_DRIVER` via the Stage 2
`envExample.ts` mechanism. This does NOT re-introduce the forbidden `minimal`
profile (FR-002): the `mock` DRIVER is a zero-dependency dev identity offered
on top of a public/internal/dual variant, distinct from the barebones
`minimal` PROFILE. The form's former "Auth" selector is relabeled "Audience".

### 1.4 The Encore infra config is already there, and invisible

Every generated app already commits `apps/api/infra.config.json`, an Encore
self-host artifact (`sql_servers` + `secrets`) built via
`encore build docker --config ./infra.config.json` in the seeded oap-build.yml
(spec 213). The portability spine (dockerized Encore app, deployable in OAP
dev, handed to any cloud) is already wired end to end. It is simply not
surfaced, and it currently exercises only 2 of Encore's resource types.

## 2. The reframe

Stop authoring a bespoke prose catalog. Make the create-project surface a
**projection** of vocabulary that already exists:

- **Feature modules** are derived from the factory adapter manifest (the single
  source of truth), not hand-mirrored. Drift like the retired-Redis label
  becomes impossible by construction.
- **Infrastructure resources** are projected from Encore's `infra.schema.json`
  vocabulary and the app's committed `apps/api/infra.config.json` topology.

The surface splits into four honest regions:

```
Topology     ( ) Single      ( ) Dual
Auth         ( ) Public      ( ) Internal          [minimal not offered at OAP surface]

INFRASTRUCTURE  (read-only projection of the app's baked infra.config topology)
  [x] PostgreSQL     default-on, read-only          -> sql_servers  (OAP-provisioned in dev)
  [ ] Redis / cache  opt-in                          -> redis        (OAP-provisioned in dev)
  ( object_storage, pubsub, metrics: same pattern, later )
  > view generated apps/api/infra.config.json (read-only)

APPLICATION FEATURES  (real code modules, derived from the adapter manifest)
  [x] User / Role Management   (auto for Internal; opt-in for Public)

BASE-APP CONFIG  (knobs, as fields not toggles)
  CORS origin: [___]        BFF private-backend URL: [___]   timeout: [___]
  [ ] /connectivity diagnostic page
```

### 2.1 Option A: topology parity (the environment model)

`encore build docker --config` bakes the infra config file into the image at
build time; only the `{"$env": "VAR"}` markers resolve at container start from
runtime env (confirmed by the OAP chart at
`platform/charts/acme-vue-encore/templates/deployment.yaml`: "Encore resolves
the `$env` markers in its baked infra.config.json at start; no mounted Encore
config"). One image therefore serves dev/staging/prod **only when the resource
topology is identical** across them.

This spec adopts **Option A (topology parity)**, which the baseline already
lives on:

- "Which resources my app uses" is a **build-time, app-level** property, fixed
  by the Infrastructure resources selected at scaffold. The `infra.config.json`
  file (topology) is therefore **read-only across all environments**.
- "Where those resources live" is a **runtime, environment-level** property
  (hosts, credentials, secrets), authored per environment via GitHub
  Environments: OAP owns dev's values (deployd injects them), the tenant owns
  staging/prod values in their GitHub Environment or target cloud. This follows
  the existing seeded oap-build.yml + baseline `deploy-{dev,staging,prod}.yml`
  pattern (spec 213).

No per-environment config files and no per-environment image builds are
introduced. Option B (per-environment topology divergence, N images per commit)
is explicitly out of scope; if a future need requires dev to stay leaner than
prod, it is a separate spec.

## 3. Requirements

### Functional Requirements

- **FR-001**: The create-project feature-module catalog MUST be **derived from
  the factory adapter manifest** (the statecraft-resident adapter surface,
  spec 160) rather than hardcoded. The two hand-mirrored `MODULE_CATALOG`
  copies (`app.projects.new.tsx`, `moduleCatalog.ts`) MUST be eliminated so a
  drift like the retired-Redis label cannot recur.
- **FR-002**: The form MUST present orthogonal selectors: an **audience**
  {`public`, `internal`}, a **topology** {`single`, `dual`}, and (Stage 2b,
  spec 229) an app-level **auth driver** {`mock`, `rauthy`} defaulting to
  `rauthy`. The `minimal` PROFILE MUST NOT be offered at the OAP surface (it
  remains a valid factory-encore generator profile for the factory-e2e harness
  only); this is distinct from the `mock` DRIVER, which IS offered as a
  zero-dependency dev identity per spec 229.
- **FR-003**: The **Infrastructure** section MUST be a projection of Encore's
  `infra.config.json` resource vocabulary. PostgreSQL MUST be default-on and
  read-only. The generated `apps/api/infra.config.json` topology MUST be
  surfaced **read-only** in the form (viewable, not editable), because under
  Option A the topology is fixed by the selected resources and is identical
  across environments.
- **FR-004**: **Redis** MUST be an opt-in Infrastructure resource. Selecting it
  MUST add a `redis` block to the app's `infra.config.json` topology, paired
  with the factory-encore 008 promotion of `data-redis` from inert marker to a
  real resource. It MUST NOT be presented as (or scaffold) a rate-limit backend
  claim, because the baseline limiter is Postgres.
- **FR-005**: deployd MUST provision Redis in **development only**, via a
  `previewRedis` flag mirroring the existing `previewDatabase` path (a
  `DeployExtras` flag, a `redis.yaml` StatefulSet template, and injected
  `REDIS_*` runtime env matching the baked `redis` block), gated by the same
  `envKind === "development"` check. Non-development environments MUST supply an
  external Redis endpoint as runtime env; deployd MUST NOT provision Redis for
  them.
- **FR-006**: Under Option A, the `infra.config.json` (topology) MUST be
  read-only across environments; per-environment hosts, credentials, and
  secrets MUST be runtime env resolved via GitHub Environments (dev by
  OAP/deployd; staging/prod by the tenant), following the existing oap-build.yml
  + baseline `deploy-*.yml` pattern. No per-environment config files and no
  per-environment image builds may be introduced by this spec.
- **FR-007**: The inert base-app knobs MUST leave the "Modules" checkbox list.
  `api-gateway`'s consumed env knobs (`PRIVATE_API_BASE_URL`,
  `GATEWAY_TIMEOUT_MS`) MUST be presented as **Base-app config fields**; its
  `/connectivity` diagnostic page MUST be an opt-in dev aid. `security-core`'s
  `CORS_ORIGIN` MUST be presented as a config field **only if factory-encore 008
  wires it**; if 008 drops the knob, the CORS field MUST be omitted rather than
  offered as an inert control. Security posture (CSP/HSTS, rate-limit, logging)
  MUST be shown as always-on, not as a toggle.
- **FR-008**: The OAP surface MUST reflect the composition capability the
  adapter actually exposes for the chosen topology. Because the `dual` topology
  composes no feature modules today, the form MUST NOT offer feature-module
  selection for `dual` that the generator cannot honor. If factory-encore 008
  closes the dual module-composition gap, the surface MUST project the newly
  supported composition rather than assume it.

### Key Entities

- **Feature module** (derived): an adapter-manifest module that composes real
  code (today only `user-management`). Displayed in the Application-features
  section.
- **Infrastructure resource** (projected): an Encore `infra.config.json` resource
  block (`sql_servers`, `redis`, and future `object_storage` / `pubsub` /
  `metrics`). Postgres default-on; Redis opt-in.
- **Base-app knob**: a consumed env var over always-present baseline behavior
  (`PRIVATE_API_BASE_URL`, `GATEWAY_TIMEOUT_MS`, and `CORS_ORIGIN` if wired).
- **previewRedis**: the deployd dev-only Redis provisioning flag mirroring
  `previewDatabase`.

## 4. Success Criteria

- **SC-001**: No hardcoded feature-module catalog remains in statecraft; the
  catalog matches the adapter manifest by construction. A regression like the
  retired-Redis false label is structurally impossible (there is no hand-copy to
  drift).
- **SC-002**: A project created with Redis selected deploys in OAP dev with a
  live Redis instance and a matching `redis` block in its
  `apps/api/infra.config.json`.
- **SC-003**: The same built image deploys to dev and (given external endpoints
  supplied as runtime env) to staging/prod, with only runtime env differing and
  no rebuild for a topology change.
- **SC-004**: The create-project form presents auth and topology as independent
  selectors, offers only `public`/`internal` auth, and shows each option under a
  section whose meaning (infrastructure / feature / base-app knob) is
  unambiguous.

## 5. Relationships and coupling posture

This is a **design-only** contract PR. It establishes no code path. The paths it
governs are listed under `references:` and are promoted to authoritative
`establishes`/`extends`/`refines` edges by the follow-on implementation PRs, so
the coupling gate is satisfied one subsystem at a time (the 214/222/223/224/225/226
new-spec precedent). The only in-PR code change is the featuregraph golden node,
claimed additively against spec 034.

`depends_on` edges cite the specs that own the surfaces this spec reframes:
138 (create/scaffold + moduleCatalog), 199 (the thin-consumer mirror the
derived catalog replaces), 160 (the statecraft-resident adapter surface),
213 (the single build path Option A rides on), 214 (the chart + previewDatabase
that previewRedis mirrors), and 225 (the deployd provisioning surface
previewRedis extends).

## 6. Implementation staging

Each stage is a separate PR that promotes the relevant `references:` paths to
authoritative relationships:

1. **Catalog derivation** (statecraft): replace both `MODULE_CATALOG` copies
   with a derivation from the adapter manifest; refines 138/199. Satisfies
   FR-001 and removes the false Redis label at the source.
2. **Form reframe** (statecraft): the two-axis selector, the Infrastructure
   projection (read-only infra.config view), the Application-features section,
   and Base-app config fields; refines 138. Satisfies FR-002, FR-003, FR-007,
   FR-008.
3. **deployd previewRedis** (deployd + chart): the `previewRedis` flag, the
   `redis.yaml` StatefulSet, and the `REDIS_*` injection; extends 214/225.
   Satisfies FR-005.
4. **Redis Infrastructure resource end to end**: wiring the opt-in Redis
   selection through to the baked `redis` block; depends on factory-encore 008
   landing the adapter-side promotion. Satisfies FR-004, and FR-006 falls out of
   Option A with no per-env files.
5. **Cron capability** (statecraft): surface the factory-encore `cron` module
   (OAP spec 230, factory-encore spec 009) as an Application feature whose
   transitive `data-postgres` requires closure is submitted with the scaffold
   request. The Small (Postgres atomic-claim) tier is active; the large-scale
   Redis lock rides the Redis Infrastructure resource (Stage 4). Refines 138.

### Implementation log

**Stage 4 landed (2026-07-09).** Redis Infrastructure resource end to end
(FR-004/FR-005/FR-006). The opt-in Redis selection now flows from the form to a
provisioned dev instance, closing the last stage:

- **Opt-in selector (`app.projects.new.tsx`).** The Infrastructure "Redis /
  cache" row is a live checkbox (single topology only; dual keeps the disabled
  "Single only" row, mirroring the feature-module composition guard, FR-008). It
  submits `data-redis` as a `modules` value via its own `redis` state (distinct
  from the `selectedModules` toggle state the cron stage's transitive
  infra-requires closure uses, so there is no double-submit). The scaffold then
  composes the factory-encore `data-redis` module (promoted from inert marker by
  factory-encore spec 008) and bakes a `redis` block into the app's
  `apps/api/infra.config.json`.
- **Fixed at create (`create.ts`, `schema.ts`, migration 4).** The projects
  table gains a `uses_redis` column (default false), set at create from
  `selectedModules.includes("data-redis")`. Under Option A the topology is
  build-time, so the selection is fixed at scaffold.
- **Deploy trigger (`deploy.ts`).** `loadDeployEnvContext` selects `uses_redis`;
  `buildTriggerDeploydBody` sets `preview_redis = usesRedis && previewDatabase`,
  so Redis auto-provisions only when opted in AND only in the same dev/preview
  kinds that already auto-provision Postgres. Non-development environments supply
  an external Redis as runtime env; deployd never provisions it for them
  (FR-005). Opt-in, so no hard refusal when off (the app boots without Redis).
- **Chart env (`deployment.yaml`, `values.yaml`).** The preview-Redis app
  container now injects `REDIS_USER` (default `default`, the built-in Redis ACL
  user the `--requirepass` preview workload authenticates as) alongside the
  Stage 3 `REDIS_HOST`/`REDIS_PASSWORD`, matching the exact
  `${REDIS_HOST}`/`${REDIS_USER}`/`$env:REDIS_PASSWORD` triple the app's baked
  `redis` block resolves (the typed topology block, not a `REDIS_URL`), the same
  shape as the Stage 3 `SQL_HOST`/`SQL_USERNAME`/`SQL_PASSWORD` correction.

`deploy.ts` is promoted from `references:` to `extends 215` and `schema.ts` to
`extends 114`; migration 4 enters `establishes`. FR-006 falls out of Option A
with no per-environment files. `implementation:` flips to `complete` and
`status` to `approved`: all four stages plus the cron capability have landed.

**Cron capability stage landed (2026-07-08).** The OAP consumer of factory-encore
spec 009 (OAP spec 230 section 6): create-project surfaces the `cron` module as
an Application feature.

- **Presentation (`moduleCatalog.ts`).** `cron` gains a PRESENTATION overlay
  entry (`displayName: "Cron Scheduler"`, `category: "Application"`) so it renders
  in the Application-features section; its `description`/`requires`/`status`
  derive from the admitted manifest (`requires: ["data-postgres"]`,
  `optionalPeers: ["data-redis"]`).
- **Transitive requires submission (`app.projects.new.tsx`).** Selecting cron
  pulls `data-postgres` into the selection via `applyModuleToggle`, but infra
  modules are not rendered feature checkboxes and so would not submit. The form
  now emits the transitive infra-requires closure as hidden `modules` inputs (the
  same closure-as-hidden-inputs pattern the /connectivity gateway uses), so the
  scaffold composes `data-postgres` ahead of `cron` and the generator's requires
  check is satisfied.
- **Scale tiers.** The Small (Postgres atomic-claim lock) tier is active. The
  large-scale Redis distributed lock rides `REDIS_URL`, provisioned by the Redis
  Infrastructure resource, which is Stage 4 (the Infrastructure Redis row stays
  "Planned"). The cron manifest description states both tiers honestly.

The end-to-end composition activates once factory-encore #20 merges and the org
substrate admits the cron module manifest (the catalog derives from the
substrate). `deploy.ts` and the Redis end-to-end path stay Stage 4;
`implementation:` stays `pending`.

**Stage 2 landed (2026-07-08).** Create-project form reframe (FR-002/003/007/008):

- **Two-axis selector (FR-002).** The single 3-way Variant radio is replaced by
  independent Topology {single, dual} and Auth {public, internal} selectors,
  mapped to the Build Spec `variant` wire (single+public to single-public,
  single+internal to single-internal, dual to dual). `minimal` (mock auth) is not
  offered; Auth is fixed for dual.
- **Infrastructure projection (FR-003).** A read-only Infrastructure section:
  PostgreSQL default-on, Redis a disabled "planned" row (its end-to-end wiring is
  Stage 4), plus a read-only note that the app bakes its infra.config topology.
- **Base-app config as fields (FR-007).** api-gateway's env knobs
  (PRIVATE_API_BASE_URL, GATEWAY_TIMEOUT_MS) leave the module checkboxes and
  become Base-app config fields, plumbed through create to perRequestScaffold via
  the new `patchEnvExample` into the produced app's committed
  apps/api/.env.example (the knobs are born-with baseline env). The /connectivity
  page is an opt-in checkbox (the api-gateway module). Security posture is shown
  always-on. The CORS field is omitted: factory-encore 008 is design-only, so per
  FR-007 no inert control is offered until it wires the knob.
- **Composition guard (FR-008).** The feature-module picker stays hidden for dual
  (the adapter composes no feature modules for it today).
- **Profile defaults derived (auto for Internal).**
  `deriveProfileDefaultsFromView` projects the adapter manifest's
  `scaffold.profiles[]`; the module-catalog endpoint now returns a
  `{ modules, profiles }` bundle from one cached OrgView. The internal profile's
  `["user-management"]` is surfaced pre-checked/read-only, and `extrasFor` takes
  the derived built-ins (the static empty `PROFILE_MODULES`/`PRESETS` constants
  are removed).

`deploy.ts` stays under `references:`: the `preview_redis` dev-provisioning
trigger has no honest opt-in source until Redis is wired end to end (Stage 4).
`implementation:` stays `pending` (Stage 4 remains).

Adversarial review fixes (same PR): the BFF URL is validated server-side (http(s)
shape, no control chars) and `patchEnvExample` strips CR/LF, closing an env-line
injection vector; the /connectivity checkbox is gated to single topology with the
gateway module present (no silent dual no-op) and emits the transitive `requires`
closure via `applyModuleToggle`; the per-org cache is keyed by `(namespace, org)`;
the Topology/Auth-to-variant mapping (`create-project-variant.ts`) and the
`scaffold.profiles` parse (`parseScaffoldProfiles`) are extracted into pure,
unit-tested seams; the Base-app knobs are recorded in the create audit + scaffold
job metadata; and statecraft/CLAUDE.md is refreshed to the Stage 2 API.

**Interim (post-Stage 1, 2026-07-08).** #533 ai-review follow-ups (the findings
the Stage 1 PR adjudicated non-blocking), before the Stage 2 form reframe:

- **Single substrate load per create.** `createFactoryProject` loaded the org
  substrate twice: `loadModuleCatalogForOrg` (via `loadOrgView`) and
  `loadFactoryAdapter` (via `loadSubstrateForOrg`). It now loads one `OrgView`,
  derives the catalog via the new exported `deriveModuleCatalogFromView`, and
  threads that substrate into `loadFactoryAdapter`. The per-org cache
  (`moduleCatalogCache.ts`) now serves the read endpoint / page loader; create
  loads once and threads.
- **Prototype-safe presentation lookup.** The `PRESENTATION` overlay in the pure
  `moduleCatalog.ts` is a `Map`, so an externally-authored module named
  `__proto__`/`constructor` misses cleanly rather than resolving to a truthy
  prototype value (which had left `displayName`/`category` undefined).
- **extrasFor test kept, not loosened.** The #533 review flagged its exact-order
  assertion as fragile; a local adversarial review re-derived `deriveInstallOrder`
  and confirmed the order is a deterministic alphabetical-within-level contract,
  so the exact assertion is correct and is retained with a comment documenting
  the guarantee.
- **statecraft/CLAUDE.md** `moduleCatalog.ts` description refreshed to the
  derived Stage 1 API (the stale `MODULE_CATALOG`/`INSTALL_ORDER` listing).

A direct unit test for the new `deriveModuleCatalogFromView` seam is deferred: it
is exported from an Encore endpoint module, so exercising it needs the
`encore test` runtime lane (or a pure extraction of `servableRows`); the
extraction is behavior-preserving and stays transitively covered by
`deriveModuleCatalog`'s pure tests. These are refinements to already-claimed
paths (no new `establishes:` entries); `implementation:` stays `pending`.

**Interim (post-Stage 1, 2026-07-07).** The two Stage-2-deferred ai-review nits
from #533, pulled forward into a standalone PR ahead of the full form reframe:

- **Transitive module selection.** The Create-project picker's `toggleModule`
  resolved only *direct* dependents on uncheck (`m.requires.includes(id)`), so
  an `A -> B -> C` chain left `A` checked after unchecking `C`. Now that
  `requires` is adapter-derived (Stage 1), multi-hop chains are plausible.
  Extracted a pure, tested `applyModuleToggle`
  (`web/app/lib/module-selection.ts`) that closes over the requires DAG in both
  directions: checking pulls the full `requires` closure, unchecking drops the
  full dependent closure, and a newly-present module's declared conflicts are
  dropped (a requirement always wins over a conflicting entry).
- **Per-org catalog cache.** `loadModuleCatalogForOrg` ran a full substrate
  load + admission check on every call (once per create POST). Added a pure
  60s-TTL per-org cache (`api/factory/moduleCatalogCache.ts`) behind it; the
  catalog only changes on a factory-origin re-sync, and the signature is
  unchanged so `create.ts` is untouched.

Both are net-new files, so they enter `establishes:` directly. `implementation:`
stays `pending` (the Stage 2 form reframe and Stage 4 end-to-end wiring remain
outstanding); this PR does not touch the form's regions or `deploy.ts`.

**Stage 3 landed (2026-07-07).** deployd + chart preview-Redis provisioning:

- deployd `DeployExtras.preview_redis` + `build_values` `previewRedis.enabled`
  branch (`helm.rs`), the `preview_redis: Option<bool>` request wire field
  (`routes.rs`), the embedded `templates/redis.yaml` register, and unit +
  `helm template` render tests. Mirrors the `preview_database` path 1:1.
- Chart: net-new `templates/redis.yaml` (single-replica, no-persistence Redis
  Deployment + Service + generated-password Secret, gated on
  `previewRedis.enabled`); `previewRedis` values block; `redisName` helper;
  `REDIS_HOST`/`REDIS_PASSWORD` app-container env; NetworkPolicy egress 6379.
- **previewDatabase env correction (rode along).** A verification pass found
  the existing preview Postgres was unreachable by the app: the chart injected
  `POSTGRES_HOST`/`POSTGRES_USER`/`POSTGRES_PASSWORD`, but the generated app's
  baked `infra.config.json` resolves `${SQL_HOST}` (host:port), `${SQL_USERNAME}`,
  and `$env:SQL_PASSWORD`. The app container now receives the `SQL_*` names
  (the postgres pod/Secret keep the `POSTGRES_*` keys the image itself needs).
  Redis follows the corrected convention (`REDIS_HOST`/`REDIS_PASSWORD`).

The statecraft trigger (`deploy.ts`) that sets `preview_redis` from a project's
opt-in Redis selection, gated by `envKind`, lands with the Stage 2 form reframe
and the Stage 4 end-to-end wiring (it has no honest opt-in source until the
Infrastructure section exists), so `deploy.ts` stays under `references:`.

**Stage 1 landed (2026-07-07).** Catalog derivation (FR-001, SC-001):

- The two hand-mirrored `MODULE_CATALOG` copies are gone. `api/projects/scaffold/moduleCatalog.ts`
  is now pure: `deriveModuleCatalog(rows)` maps the adapter's module
  `manifest.json` bodies to descriptors, `deriveInstallOrder` topo-sorts over
  `requires`, and `isKnownModule`/`extrasFor` take the derived catalog.
  `id`/`description`/`requires`/`conflicts`/`status` come from the manifest; a
  thin transitional `PRESENTATION` overlay supplies `displayName`/`category`
  (no upstream source), which Stage 2's re-sectioning reworks.
- New `api/factory/moduleCatalog.ts`: `loadModuleCatalogForOrg` + the
  admission-gated `GET /api/factory/module-catalog`, reusing `browse.ts`'s
  `loadOrgView`/`servableRows` (single admission gate). Module manifests land in
  the catch-all `reference-data` kind, so they are selected by path regex.
- `create.ts` loads the derived catalog per-org; the frontend route deletes its
  hand-copy const and consumes the endpoint via its loader (a rejected/empty
  fetch degrades to an empty picker, not a 500).
- Out of scope for Stage 1 (deferred to Stage 2): `PROFILE_MODULES`/`PRESETS`
  are left empty; the adapter manifest's `scaffold.profiles[].modules` declares
  per-profile defaults (`internal` ships `user-management`) that Stage 2's form
  reframe derives and surfaces as "auto for Internal". The runtime dedupe in
  `perRequestScaffold.readInstalledModules` keeps composition correct meanwhile,
  so behavior is unchanged. The false `data-redis` label is corrected by
  factory-encore 008 at the manifest source; Stage 1 removes the hand-copy so
  statecraft cannot drift from it.

## 7. Out of scope

- Option B (per-environment topology divergence, per-environment builds).
- The adapter-side changes (data-redis promotion payload, dual
  module-composition, CORS knob wire-or-drop): owned by factory-encore spec 008.
- The additional Encore resource types (`object_storage`, `pubsub`, `metrics`):
  the Infrastructure section is designed to hold them, but they are separate
  future increments.
