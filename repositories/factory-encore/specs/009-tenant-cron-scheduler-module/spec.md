---
id: "009-tenant-cron-scheduler-module"
title: "Tenant self-hosted cron: the in-app scheduler module (postgres small-scale / +redis large-scale)"
status: approved
created: "2026-07-08"
owner: bart
kind: feature
domain: generator
risk: medium
implementation: complete  # Module code landed with this spec (#20). The scheduler service, the shared-app-db migration, the tiered lock, and the manifest shipped; baseline.lock.json gained "cron" (lockstep, spec 006) and born-with.ts self-registers the spec in GENERATOR_META_SPEC_IDS (spec 002). The encore-metadata auto-extraction bridge (section 5) shipped its explicit-registration seam; the build-time metadata reader stays a recorded residual (does not block completion). This follow-up reconciles the Redis prose to the shipped typed contract (the lock reads the baseline lib/redis client over REDIS_HOST/REDIS_USER/REDIS_PASSWORD; there is no REDIS_URL and cron declares no ioredis dep).
depends_on:
  - "001-module-manifest-schema"      # the manifest v2 grammar this module declares against
  - "002-encore-generator-core"       # the generator that composes the module + the base SQLDatabase("app") the store extends
  - "003-user-management-module"       # the reference payload-bearing module shape (services + files/<service> + db/ migration) this follows
  - "006-factory-schema-lockstep"     # baseline.lock.json pins the module catalog; "cron" is added there
  - "008-data-redis-promotion-dual-composition"  # the data-redis optionalPeer whose promotion lights up the large-scale Redis lock
code_aliases: ["CRON_SCHEDULER_MODULE", "TASK_SCHEDULES"]
summary: >
  The adapter-side companion to OAP spec 230. Encore's CronJob primitive is a
  no-op on self-hosted deploys (there is no Encore Cloud scheduler), so every
  tenant CronJob is silent. This module installs an in-app scheduler service
  into the generated Encore app: a task_schedules store in the base app's single
  SQLDatabase("app") (INV-11, no per-service db), register/list endpoints, and a
  polling daemon that fires due jobs against the app's own endpoints. The daemon
  fires each due job exactly once across replicas via a lock tiered on the
  tenant's create-project scale choice: a Postgres atomic claim by default
  (small scale, zero extra infra), a Redis distributed lock when the typed
  REDIS_HOST connection is configured (large scale). One code path, tier
  auto-detected by the baseline lib/redis client (REDIS_HOST/REDIS_USER/
  REDIS_PASSWORD; there is no REDIS_URL). The module
  therefore requires data-postgres (always) and optionally peers with data-redis
  (large tier only). Distinct from stagecraft's own control-plane sweepers
  (OAP spec 224), which stay on per-sweeper K8s CronJobs.
establishes:
  - "adapters/acme-vue-encore/modules/cron/"
extends:
  # baseline.lock.json pins the module catalog (spec 006); adding "cron" to the
  # pinned modules array is an additive extension of the lockstep catalog.
  - spec: "006-factory-schema-lockstep"
    nature: additive
    unit: { kind: file, path: adapters/acme-vue-encore/scripts/lockstep/baseline.lock.json }
  # This spec self-registers in GENERATOR_META_SPEC_IDS (born-with.ts, a
  # 002-established path) so produced apps drop it as create-time machinery,
  # the spec 008 precedent. Additive edit to the generator core's meta-spec set.
  - spec: "002-encore-generator-core"
    nature: additive
    unit: { kind: file, path: adapters/acme-vue-encore/scripts/lib/born-with.ts }
---

# 009. Tenant self-hosted cron: the in-app scheduler module

> Provenance: adapter-side companion to OAP spec
> `230-tenant-cron-scheduler-module`, which fixes the tenant-cron contract
> (cron requires data-postgres, optionally peers with data-redis, the scheduler
> auto-detects the typed `REDIS_HOST` connection to pick the lock backend) and
> stages this module as
> the factory-encore realization. The create-project form wiring (the Infra-axis
> cron capability + Small/Large scale toggle) is a follow-on OAP spec-227 stage.

## 1. Purpose

Encore's `CronJob` primitive is scheduled by Encore Cloud's proprietary
platform. On a self-hosted target `encore build docker` only *extracts* the
cron definitions and warns the operator to wire an external scheduler; it ships
no scheduler daemon. OAP tenant apps deploy self-hosted through deployd, so every
tenant `CronJob` is a silent no-op today.

Requiring each tenant app to provision a Kubernetes CronJob, a Rauthy client, and
an external-secret per job (the model OAP uses for its OWN control-plane sweepers,
OAP spec 224) would break the self-contained-app property. Tenant cron must run
IN-APP. This module supplies that runtime: a scheduler service baked into the
generated Encore app, portable to anywhere Encore + Postgres (+ optional Redis)
run, with no per-tenant Kubernetes object.

## 2. Territory

This spec owns everything under `modules/cron/`:

- `manifest.json`: the module's manifest v2 declaration (spec 001).
- `files/scheduler/`: the Encore `scheduler` service directory, copied to
  `apps/api/scheduler/` on compose.
- `files/db/1_create_task_schedules.up.sql`: the schedule-store migration,
  renumbered to the next free prefix and applied to the base `app` database on
  compose (the user-management precedent, spec 003 FR-002).

It references the base app's `SQLDatabase("app")` (owned by the
`encore-app-architecture` baseline invariant, pinned via lockstep) as the
substrate the store extends; it does not own that path. It does not own the base
`lib/` middleware chain.

## 3. The store (shared app database, INV-11)

Per INV-11 (`security-data-invariants`, spec 003 FR-002, Out of scope), the
single `SQLDatabase("app")` is the only database: the scheduler MUST NOT declare
its own `SQLDatabase`. The prototype's standalone `new SQLDatabase("scheduler")`
is therefore adapted to `SQLDatabase.named("app")`, and the schedule table is a
`db/` migration applied to the base app database, exactly as user-management adds
its role tables (spec 003).

### FR-001, task_schedules table

`files/db/1_create_task_schedules.up.sql` MUST create `task_schedules`:

- `id text PRIMARY KEY` (caller-chosen stable job id),
- `title text NOT NULL`,
- `endpoint text NOT NULL` (the app-relative path the daemon fires, e.g.
  `/tasks/rollup`),
- `schedule text NOT NULL` (the cron expression),
- `next_run_at timestamptz NOT NULL`,
- `last_run_at timestamptz`,
- `updated_at timestamptz NOT NULL DEFAULT now()`.

The migration file is renumbered to the next free prefix when the module is
composed (spec 003 FR-002 precedent), so it applies after the base schema.

## 4. The service

### FR-002, service directory

`files/scheduler/` MUST deliver a complete Encore service directory:

- **`encore.service.ts`**: `new Service("scheduler")`. It imports the worker and
  starts the daemon from the service module (FR-005), tying daemon lifecycle to
  service initialization rather than to a bare top-level import side-effect.
- **`store.ts`**: `SQLDatabase.named("app")` plus the tagged-template queries
  over `task_schedules` (upsert on register, select-due, claim, advance
  `next_run_at`). No `pg.Pool`; parameterized tagged-template SQL only (INV-2).
- **`api.ts`**: `registerCron` and `listSchedules`. These are management
  endpoints, declared **`expose: false`** (internal, reachable via
  `~encore/clients` from the app's own registration bootstrap), so the module
  adds no unauthenticated public surface and takes no dependency on the auth
  module. `registerCron` parses the cron expression with `cron-parser`, computes
  `next_run_at`, and upserts by `id`.
- **`worker.ts`**: the polling daemon (FR-004/FR-005).
- **`lock.ts`**: the tiered lock (FR-003).

### FR-003, the lock and the scale tiers

The daemon MUST fire each due job exactly once even across multiple replicas.
`lock.ts` exposes a single `tryAcquire(taskId)` whose backend is auto-detected by
`isRedisConfigured()` (the typed `REDIS_HOST` connection), mirroring the existing
`data-redis` opt-in idiom:

- **Small scale (postgres-only, default).** The Postgres atomic claim:
  `UPDATE task_schedules SET last_run_at = now() WHERE id = $1 AND next_run_at <=
  now() RETURNING true`. Exactly one replica wins the row. Zero extra
  infrastructure; correct for single-replica and light multi-replica deploys.
- **Large scale (postgres + redis).** When the typed `REDIS_HOST` connection is
  configured, a Redis lock (`SET cron:lock:<id> <token> NX PX <ttl>`) is acquired
  before the claim, the production-grade tier where row-level contention on the
  schedule table would bottleneck at higher replica counts. The lock client is the
  baseline `lib/redis` seam (template-encore spec 018), constructed lazily so the
  small tier opens no Redis socket; `ioredis` is a baseline dependency, not a cron
  `packageDep`.

The large tier's typed `REDIS_HOST`/`REDIS_USER`/`REDIS_PASSWORD` triple is
provisioned by the promoted `data-redis` resource (spec 008 FR-001) and, dev-side,
by deployd `previewRedis` (OAP spec 227). This module declares the dependency
(`optionalPeers: ["data-redis"]`)
and owns its lock client; it does not own the Redis provisioning.

### FR-004, the polling daemon

`worker.ts` runs a `setInterval` loop (cadence `SCHEDULER_POLL_INTERVAL_MS`,
default 10000). Each tick selects `task_schedules` rows where `next_run_at <=
now()`, and for each: acquires the tier lock (FR-003); on success fires the
endpoint asynchronously against the app's resolved base URL (FR-006), then
recomputes `next_run_at` from the cron expression and advances the row. Every
tick is wrapped so a transient database or network error is logged and the loop
survives (the prototype's try/catch posture, retained).

### FR-005, productionized daemon start (no hardcoded loopback)

Per OAP spec 230 section 7, the module MUST NOT keep the prototype's two
shortcuts:

- **Lifecycle.** `startDaemon()` is exported by `worker.ts` and called from
  `encore.service.ts`, not invoked as a top-level side-effect of importing the
  worker. Encore.ts exposes no first-class post-db startup hook, so the daemon
  starts at service initialization; the FR-004 error-tolerant first tick absorbs
  any connection-pool warmup. Starting the interval is idempotent
  (double-start guarded).
- **Fire target.** The daemon fires against `SCHEDULER_BASE_URL` (default
  `http://127.0.0.1:4000`, documented as the same-process gateway for a
  single-container self-hosted deploy, overridable for multi-container
  topologies), never a hardcoded literal in the fire path.

### FR-006, manifest v2 declaration

`modules/cron/manifest.json` MUST declare:

- `requires: ["data-postgres"]`: the base app database the store extends.
- `optionalPeers: ["data-redis"]`: the large-scale Redis lock backend.
- `services: ["scheduler"]`.
- `migrations: [{ source: "db/1_create_task_schedules.up.sql", description: ... }]`.
- `packageDeps: { "apps/api": { "cron-parser": "^5.6.1" } }` (the scheduler
  service runs in the Encore backend; the Redis lock client is the baseline
  `lib/redis` seam, so `ioredis` is a baseline dependency, not declared here).
- `envVars`: `SCHEDULER_POLL_INTERVAL_MS` (optional, default 10000) and
  `SCHEDULER_BASE_URL` (optional, default the same-process gateway). The Redis
  connection (`REDIS_HOST`/`REDIS_USER`/`REDIS_PASSWORD`) is baseline env owned by
  the `data-redis` resource, not declared as a cron envVar.
- `middlewares: []`, `secrets: []`, `corsEntries: []`, `files: {}` (the service
  ships via `services`, the schema via `migrations`; there are no web-side
  files).

## 5. Registration

### FR-007, explicit-registration seam (ships now)

The scheduler is populated by calling `registerCron` for each of the app's cron
jobs. The module ships the register endpoint and a documented startup seam: the
generated app registers its jobs at scheduler startup by calling `registerCron`
(internally, via `~encore/clients`) for each `{ id, title, endpoint, schedule }`
it wants scheduled. This is deterministic and testable and is the mechanism that
ships in this PR.

### FR-008, auto-extraction bridge (staged residual)

OAP spec 230 section 3 and section 9 describe auto-registering from the app's own
Encore cron metadata, which `encore build docker` extracts into the built image.
Reading that extracted metadata at runtime is Encore-version-specific and is
**not** a stable public API today, so the full build-time-to-runtime bridge is a
recorded residual of this spec: the explicit-registration seam (FR-007) is the
shipping mechanism, and the metadata reader lands in a follow-on once the
extraction surface is pinned. This is stated, not silently dropped: until FR-008
lands, a generated app using cron registers its jobs through the FR-007 seam.

## 6. Registration surfaces (catalog + lockstep)

- **`modules/cron/manifest.json`** (this spec): the module's own manifest is what
  the generator resolves for `--with cron` and what the create-project catalog
  projection (OAP spec 227) enumerates. Cron is intentionally absent from every
  `manifest.yaml` `profiles[].modules` default: it is a capability a tenant
  selects, not a baseline floor.
- **`baseline.lock.json`** (spec 006 lockstep): `"cron"` is added to the pinned
  `modules` array so the lockstep gate accepts the new catalog entry (the
  `extends: 006` edge above).
- **`born-with.ts`** (spec 002 generator core): `009-tenant-cron-scheduler-module`
  is added to `GENERATOR_META_SPEC_IDS` so produced apps drop this generator spec
  as create-time machinery (the `extends: 002` edge above, the spec 008
  precedent).

## 7. Acceptance criteria

- **AC-1.** `npx tsx scripts/setup-app.ts --profile internal --dest <d> --with
  cron` composes the module: `<d>/apps/api/scheduler/` is present, and the
  renumbered `db/migrations/<n>_create_task_schedules.up.sql` exists after the
  base schema.
- **AC-2.** `add-module cron` then `remove-module cron` composes and fully
  decomposes the `scheduler/` service directory and its recorded migration with
  no residue; the base schemas remain intact (the spec 003 AC-2 round-trip
  precedent).
- **AC-3.** The scheduler store declares `SQLDatabase.named("app")` and no
  standalone `SQLDatabase` (INV-11); the migration targets the base app database.
- **AC-4.** `lock.ts` uses the Postgres atomic claim when `isRedisConfigured()` is
  false (no `REDIS_HOST`) and the Redis lock when it is true; the baseline
  `lib/redis` client is constructed lazily, so the small tier opens no Redis socket.
- **AC-5.** `worker.ts` starts the daemon from `encore.service.ts` (not a bare
  top-level import side-effect) and fires against `SCHEDULER_BASE_URL`, with no
  hardcoded loopback literal in the fire path.
- **AC-6.** `manifest.json` declares `requires: ["data-postgres"]`,
  `optionalPeers: ["data-redis"]`, `services: ["scheduler"]`, the migration, and
  the two `SCHEDULER_*` env vars; `manifest.schema` validation passes.
- **AC-7.** `"cron"` is present in `baseline.lock.json`'s `modules` array and
  `npm run lockstep` passes; `npm run e2e:struct` composes cron.
- **AC-8.** `npm test` (vitest) is green with no skips in the module/composer
  suites.
- **AC-9.** `npx spec-spine compile` exits 0; `npx spec-spine lint --fail-on-warn`
  passes; `npx spec-spine index check` reports current; `npx spec-spine couple
  --base origin/main` is clean.

## 8. Out of scope

- The OAP create-project form wiring (the Infra-axis cron capability, the
  Small/Large scale toggle, the cascade to data-postgres/data-redis): OAP spec
  227 stage.
- The data-redis promotion itself (the `redis` infra.config resource + `REDIS_*`
  bindings + template-encore baseline edits via lockstep): spec 008. This module
  consumes the typed `REDIS_*` connection; it does not provision Redis.
- The `encore build docker` cron-metadata auto-extraction reader: FR-008 staged
  residual.
- Per-service databases: INV-11 forbids them; the single `SQLDatabase("app")` is
  the only database.
- Stagecraft's own control-plane sweepers: OAP spec 224 (per-sweeper K8s
  CronJobs), unchanged and distinct.
