# Create New Project: reframing the module catalog onto Encore's infra config

> Directional decision record. Lives in `docs/analysis/` for now.
> Date: 2026-07-06. Companion to
> [`acme-vue-encore-generator-product-split.md`](./acme-vue-encore-generator-product-split.md)
> and [`factory-encore-sync-current-state.md`](./factory-encore-sync-current-state.md),
> which established the generator/product split and the current-state
> mechanics this record acts on.
>
> Status: **agreed direction, specs committed.** Decisions below are
> locked. The contracts are now committed: OAP spec 227
> (`227-create-project-infra-config-projection`) and factory-encore spec
> 008 (`008-data-redis-promotion-dual-composition`). This record is their
> design provenance. Implementation is handed to the working sessions in
> `statecrafting/factory-encore`, `statecrafting/template-encore`, and
> the statecraft + deployd surfaces in this repo.

---

## Goal

Two coupled aims, resolved as one move:

1. **Surface the Encore infra config** that the generated app already
   ships, instead of leaving it invisible behind a bespoke module list.
2. **Straighten out the "Create New Project" options**, which read as
   enigmatic because they hand-mirror a manifest that has since drifted
   and conflate three different kinds of thing under one checkbox UI.

The reframe: the create-project surface stops being a hand-typed prose
catalog and becomes a **projection** of vocabulary that already exists
(the adapter manifest for feature modules, Encore's `infra.schema.json`
for infrastructure resources). This applies constitution Principle II
(compiler-owned truth, no drifting hand copies) to the one surface
currently exempt from it.

## Decisions (locked)

- **Auth profile = `public` / `internal` only.** `minimal` is removed
  from the OAP create-project surface (it has no product home). It stays
  valid at the factory-encore generator level for the factory-e2e
  harness; OAP just never offers it.
- **Topology = `single` / `dual`** as a separate selector. Two axes,
  not one fused "Variant" that silently drops `minimal`.
- **Infrastructure section = a projection of the app's
  `apps/api/infra.config.json`.** Postgres default-on, surfaced
  read-only.
- **Option A (topology parity).** One built image serves dev / staging /
  prod; the resource topology is identical across environments, and only
  hosts / credentials / secrets differ as runtime env. Chosen over
  per-environment topology divergence (Option B).
- **deployd provisions dev only.** OAP stands up dev infra (Postgres
  today, Redis next); staging / prod target the external cloud.
- **Redis is promoted, not retired.** The inert `data-redis` marker
  becomes a real provisionable resource wired through the infra config.
- **Feature modules stay driven by the adapter manifest.** The markers
  and knobs leave the "Modules" checkbox list.

## The load-bearing Encore fact

`encore build docker --config ./infra.config.json` **bakes the config
file into the image at build time.** Only the `{"$env": "VAR"}` markers
resolve at container start from runtime env. OAP's own chart states this:
`platform/charts/acme-vue-encore/templates/deployment.yaml:43-48`
("Encore resolves the `$env` markers in its baked infra.config.json at
start; no mounted Encore config").

Consequence: one image serves multiple environments **only when the
resource topology is identical** across them. A different topology per
environment means a different build and a different image.

**Option A follows from this and from the baseline.** template-encore
already lives on it: `apps/api/infra.config.json` uses `${SQL_HOST}` and
`{"$env":"SQL_PASSWORD"}`, and `deploy-{dev,staging,prod}.yml` are thin
callers pinned to GitHub Environments, all building with the same config
(`encore-build` action, `infra-config` defaults to `./infra.config.json`).
OAP's deployd already injects dev values this way (`previewDatabase` when
`envKind==development`; production refused, "supply an external DSN").

The clean separation Option A enforces:

- **"Which resources my app uses"** is a build-time, app-level property.
  It is fixed by the Infrastructure resources picked at scaffold, and it
  is the same in every environment. The `infra.config.json` file is
  therefore **read-only always**.
- **"Where those resources live"** is a runtime, environment-level
  property (hosts, credentials, secrets). This is what is **authorable
  per environment**: OAP owns dev's values (deployd injects them), the
  tenant owns staging / prod values in their GitHub Environments or
  target cloud.

This reframes the earlier "config read-only for dev, modifiable for
staging/prod" intent: the config *file* (topology) is read-only
everywhere; what is authorable per environment is the runtime *values*,
following the baseline's existing `deploy-*.yml` + GitHub Environments
pattern, not per-environment config files.

Option B (per-environment topology divergence, per-environment builds,
N images per commit) remains the escape hatch if dev must ever stay
leaner than prod. Not chosen.

## Module reality (grounded)

Five modules exist in `factory-encore/adapters/acme-vue-encore/modules/`
today (`data-redis` is present, not retired: PR #17 never finished).

| Module | True nature | Evidence | Honest home |
|---|---|---|---|
| **security-core** | Inert. `files:{}`; its only output is a `CORS_ORIGIN` env var **nothing reads** (CORS is hardcoded static in `encore.app:9-16`; grep `CORS_ORIGIN` in template-encore = 0 hits). All real security (CSP/HSTS, Postgres rate-limit, logger) always ships. Only ever appears as api-gateway's `requires` dep. | `modules/security-core/manifest.json:15,18-24`; `template-encore/apps/api/lib/security-headers.ts:9-42`; `manifest.yaml:174-177` | Not a toggle. Wire the CORS knob and present it as a config field, or drop it and show security as an always-on badge. |
| **api-gateway** | Hybrid: real consumed env knobs + one diagnostic page. Backend BFF proxy always ships in baseline. Module adds one Vue `/connectivity` view + two consumed env vars (`PRIVATE_API_BASE_URL` gates a 503, `GATEWAY_TIMEOUT_MS` sets the proxy timeout). Meaningful only in single topology. | `modules/api-gateway/manifest.json:15-19`; `template-encore/apps/api/gateway/proxy.ts:73,133-152`; `apps/api/lib/env.ts:48,52` | Env vars to config fields; the test page to an opt-in dev-aid checkbox. Not infra, not a feature module. |
| **data-postgres** | Marker for the always-present `SQLDatabase("app")`. | `modules/data-postgres/manifest.json:15`; `template-encore/apps/api/db/db.ts:12` | The default-on, read-only Infrastructure resource (the one `sql_servers` block). |
| **data-redis** | Inert marker with a false label. `status:stable`, `files:{}`, claims a Redis rate-limit backend that does not exist (baseline limiter is Postgres: `rate-limit.ts:34-53`). | `modules/data-redis/manifest.json:5,15` | Promote to a real Infrastructure resource (`redis` block + OAP dev provisioning). Not delete. |
| **user-management** | The one real feature. New Encore service, migration (`app_role`/`user_role`, seeded), `/admin/users*` + `/admin/roles*`, `requireRole`. Auto-composed for `internal`. | `modules/user-management/manifest.json:10-23`; `files/user-management/users.ts:40-141`; `manifest.yaml:233` | The Application feature group. |

## The reframed surface

```
Topology     ( ) Single      ( ) Dual
Auth         ( ) Public      ( ) Internal          [minimal removed from OAP surface]

INFRASTRUCTURE  (projection of Encore infra.config vocabulary; drives the baked topology)
  [x] PostgreSQL     default-on, read-only          -> sql_servers  (OAP-provisioned in dev)
  [ ] Redis / cache  opt-in                          -> redis        (OAP-provisioned in dev)
  ( object_storage, pubsub, metrics: same pattern, later )
  > view generated apps/api/infra.config.json (read-only)

APPLICATION FEATURES  (real code modules, from the adapter manifest)
  [x] User / Role Management   (auto for Internal; opt-in for Public)

BASE-APP CONFIG  (knobs, as fields not toggles)
  CORS origin: [___]        BFF private-backend URL: [___]   timeout: [___]
  [ ] /connectivity diagnostic page
```

Three sections, three distinct meanings (what infra / what code / what
knobs), each derived from a real source so it cannot rot by
hand-mirroring.

## Catalog derivation (kills the enigma at the root)

Today the catalog is hardcoded in two hand-maintained copies that
already diverge and are stale against the 5-module adapter:

- frontend `platform/services/statecraft/web/app/routes/app.projects.new.tsx:65-111`
- backend `platform/services/statecraft/api/projects/scaffold/moduleCatalog.ts:26-84`

Nothing reads a manifest at runtime, so the prose descriptions rot. The
statecraft Redis checkbox currently succeeds into the inert `data-redis`
knob (add-module does not error, because the module exists), producing a
scaffold with a dead `REDIS_URL` and a false-labeled feature.

Fix: derive the app-feature module list from the adapter manifest and the
infra-resource list from Encore's `infra.schema.json` plus the scaffold's
actual `infra.config.json`. Delete both hardcoded copies.

## Redis stand-up (dev-only provisioning)

The pattern to mirror already exists for Postgres:

- statecraft `deploy.ts:698-712` sets `previewDatabase` when
  `envKind==="development"` (else refuses).
- deployd `DeployExtras` (`helm.rs:376-381`) carries the flag; the chart
  renders an in-namespace Postgres StatefulSet (`postgres.yaml`) and
  injects `POSTGRES_*` env (`deployment.yaml:49-74`).

Redis mirrors it 1:1: a `previewRedis` flag, a `redis.yaml` StatefulSet
template, inject `REDIS_*` env matching a `redis` block in the baked
config, gated to dev by the same `envKind` check. Staging / prod supply
their own Redis endpoint as runtime env. This is the smallest real proof
that the infra config expansion generalizes past Postgres.

## Open items / flags

1. **Dual composes no modules** (`manifest.yaml:217-218`;
   `setup-dual-app.ts` only clones + wires the second SPA). A dual
   product that needs staff roles (`user-management`) hits this
   immediately: dual cannot compose the one real feature module into its
   internal clone. This is the "dual falsifies the generator" signal;
   it is adjacent to the refresh-kernel / module-composition thread and
   is real factory-encore work the fixture initiative surfaces.
2. **security-core's CORS knob is dead.** Deployed tenant apps carry
   hardcoded `localhost` CORS origins. Possibly moot if the SPA is always
   served same-origin from the api service; confirm, because "Public" and
   "Internal" apps at real domains are where a dead CORS origin would
   bite. This is the concrete "fix the marker or drop it" decision.

## Per-repo handoff

- **statecraft (this repo):** replace the two hardcoded `MODULE_CATALOG`
  copies with a derived catalog; split the form into the three sections
  + two-axis selector; render `infra.config.json` read-only; author the
  Base-app config fields.
- **factory-encore:** promote `data-redis` from inert marker to a real
  `redis` infra-config resource; decide the CORS knob (wire or drop);
  address dual module-composition if the dual fixture needs roles.
- **template-encore:** the baseline already ships the single
  `infra.config.json` (topology) and the `deploy-{dev,staging,prod}.yml`
  + GitHub Environments pattern Option A rides on. Add the `redis` block
  when the resource is offered.
- **deployd (this repo):** add the `previewRedis` dev-only provisioning
  path mirroring `previewDatabase`.

## Contracts committed

This record's direction is now committed as two coupled contracts: OAP
spec `227-create-project-infra-config-projection` (the statecraft surface
and the deployd `previewRedis` path) and factory-encore spec
`008-data-redis-promotion-dual-composition` (the adapter-side data-redis
promotion, dual composition, and CORS knob). Both are design-only draft
specs; the code lands across the follow-on implementation PRs each spec
stages.

## Session addendum (2026-07-07): parity scope verified, cron dropped, encore.app resolved

The "final analysis before work begins" pass resolved two things this
record left open: how far the Infrastructure projection reaches beyond
Redis, and how `encore.app` becomes a first-class config object.

### Belief-check: what OAP actually provisions for tenants today

Local `encore run` gives a developer five backing primitives; the aim is
to match them in the statecraft-deployed dev environment. Verified against
deployd-api-rs, the acme-vue-encore chart, the tenant baseline
(`template-encore/apps/api/infra.config.json`), and the cluster charts:

| Primitive | `infra.config` key | Provisioned for tenants in OAP dev today | Verdict |
|---|---|---|---|
| SQL (Postgres) | `sql_servers` | yes (`previewDatabase` renders `postgres.yaml`) | real |
| Redis / cache | `redis` | no | the work (this spec) |
| Pub/Sub (NSQ) | `pubsub` (nsq) | no (cluster `nsqd` serves statecraft's own app only) | not wired for tenants |
| Cron | none (absent from the schema) | no; a no-op under self-host regardless | dropped (see below) |
| Object storage | `object_storage` (s3/gcs) | no (no cluster MinIO/S3 backing) | not wired for tenants |

Only SQL is real for tenants today. The "we already have NSQ / cron /
object storage" reading came from statecraft's *own* infra config
(`platform/services/statecraft/infra.config.json`, a mature 4-resource
file), which the tenant scaffold and deployd's per-tenant path share none
of.

### Parity roadmap (scope decision)

- **Redis first (this spec).** A clean `previewDatabase` mirror, the
  smallest real proof the infra-config expansion generalizes past Postgres.
  Blocked only on factory-encore 008 promoting `data-redis` to a real
  `redis` block.
- **Object storage, then Pub/Sub (NSQ): sibling specs.** Object storage
  needs a net-new cluster MinIO backing plus an `object_storage` type-`s3`
  block plus `S3_*` env. NSQ needs a shared-cluster-nsqd vs per-tenant
  decision. Both are the same "project an infra.config resource, provision
  it in dev only" shape as Redis; neither belongs inside spec 227.
- **Cron: dropped.** It does not align with the rest. It is not an
  `infra.config.json` key, so the Infrastructure section cannot project it
  at all, and Encore's cron primitive is a no-op when self-hosted
  (`platform/charts/statecraft/templates/cronjob-orphan-sweeper.yaml:12`:
  the Encore cron is "a no-op without Encore Cloud, so this K8s CronJob IS
  the production scheduler" for statecraft's own sweepers). Tenant cron
  parity would mean generating a per-schedule K8s CronJob from app
  metadata: a different mechanism, not this projection. Not pursued now.
- Metrics (`metrics` pointing at the cluster Prometheus, mirroring
  statecraft's own config) is a cheap future add; low value for local-dev
  parity, left out.

### encore.app first-class config (resolves Open item #2, the CORS knob)

`encore.app` is **build-time only**: unlike `infra.config.json` it has no
`{"$env": ...}` runtime resolution, so its `global_cors` origins are baked
at `encore build`. Under Option A (one image across environments) CORS
origins are therefore fixed by the built image.

- **Dev:** scaffold-time template the tenant's domain set (apex plus
  `*.wildcard`) into `global_cors`, surfaced as the FR-007 "CORS origin"
  Base-app field. **Drop the dead runtime `CORS_ORIGIN` env** (security-core
  Open item #2): it can never work because `encore.app` reads no runtime
  env. This is the "drop the knob" resolution for factory-encore 008.
- **Staging / prod (tenant-owned): a deliberate branch build.** A
  build-time-only value that must differ per environment is handled by
  branching `main`, amending `encore.app`, and pushing or dispatching; the
  spec-213-seeded `deploy-{staging,prod}.yml` plus `deploy-reusable.yml`
  check out that ref, run `encore build docker`, and push an
  environment-tagged image bound to the GitHub Environment. Verified:
  `deploy-staging.yml` triggers on `push: branches:[staging]` and
  `workflow_dispatch`; `deploy-prod.yml` on `workflow_dispatch`;
  `deploy-reusable.yml` checks out the triggering ref before building.

**Option A boundary, clarified (not contradicted).** OAP dev stays strictly
one image (deployd-provisioned, runtime `$env`). A CORS-domain change is a
build-time *value* change, not a resource *topology* change: the infra
resource set stays identical, so SC-003 ("no rebuild for a topology
change") holds. FR-006 ("no per-environment image builds introduced by this
spec") also holds: OAP introduces none. The optional per-environment build
lives in the tenant's already-seeded CI, for the narrow class of values
`encore.app` cannot resolve at runtime, and only when the tenant asks for
that environment. OAP's responsibility ends at ensuring the tenant repo
*can* build an environment-specific image on demand, which (per the
verification above) it already can.
