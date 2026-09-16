---
id: "230-tenant-cron-scheduler-module"
title: "Tenant self-hosted cron: in-app scheduler module (postgres small-scale / +redis large-scale), the create-project Infra axis"
feature_branch: "230-tenant-cron-scheduler-module"
status: approved
implementation: pending  # Design spec. No OAP code lands in this PR beyond the featuregraph golden node (extends 034), matching the 214/222-227/229 new-spec precedent. The factory-encore cron module and the OAP create-project form wiring land in follow-on PRs (a factory-encore spec + a spec-227 stage) that promote the referenced paths to authoritative relationships. Flips to complete on merge.
kind: platform
domain: platform
created: "2026-07-08"
approved: "2026-07-08"
authors: ["open-agentic-platform"]
language: en
category: ["infrastructure", "data"]
depends_on:
  - "227-create-project-infra-config-projection"  # the Encore-infra-config projection + previewRedis provisioning this cron option extends
extends:
  # A new spec adds a node to the featuregraph golden (corpus convention;
  # specs 214/222/223/224/225/226/229 carry the same edge).
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
references:
  # Non-authoritative pointers to the OAP-side create-project surfaces a
  # follow-on spec-227 stage will wire. Claimed additively then, not here.
  - role: planned
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.projects.new.tsx }
  - role: planned
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/moduleCatalog.ts }
summary: >
  Tenant apps deploy self-hosted via OAP deployd, where Encore's `CronJob`
  primitive is a no-op (there is no Encore Cloud scheduler). This spec gives
  each tenant app working self-hosted cron via an in-app scheduler baked into
  the generated Encore app, with no per-tenant Kubernetes CronJob. The
  scheduler stores schedules in Postgres and fires due jobs against the app's
  own endpoints. The distributed lock is tiered by the tenant's scale choice
  in create-project: small scale uses a Postgres atomic claim (postgres-only);
  large scale uses Redis (postgres + redis), production-grade for multi-replica
  deployments. Cron therefore always requires data-postgres and optionally
  peers with data-redis. Implemented as a new factory-encore adapter `cron`
  module and surfaced as the create-project Infra-axis cron option. This is
  distinct from spec 224 (statecraft's OWN control-plane sweepers, which stay
  on per-sweeper K8s CronJobs).
---

# 230: Tenant self-hosted cron via in-app scheduler

## §1 Motivation

Encore's `CronJob` primitive is scheduled by Encore Cloud's proprietary
platform. On a self-hosted target, `encore build docker` only *extracts* the
cron definitions and their internal endpoints and warns the operator to wire
an external scheduler; it ships no scheduler daemon. OAP tenant apps deploy
self-hosted through deployd, so every tenant `CronJob` is a silent no-op
today.

This is the **tenant** analogue of a gap OAP already solved for **itself**.
Spec 224 handles statecraft's OWN control-plane sweepers with a per-sweeper
Kubernetes CronJob that curls an M2M endpoint. That model is correct for
statecraft (it IS the control plane on OAP's K8s) but is wrong to impose on
tenants: you cannot require every tenant app to provision K8s CronJobs, a
Rauthy client, and an external-secret per job, and it would break the
self-contained-app property. Tenant cron must therefore run IN-APP.

Create-project (spec 227) already reframes project creation as a projection
onto the tenant app's Encore configuration across axes the user selects:
topology (public/private/dual), auth (mock/rauthy, spec 229), and the Infra
axis derived from the app's `apps/api/infra.config.json`. The Infra axis must
eventually cover what Encore supports; cron is the missing capability that
needs a self-hosted runtime, which this spec supplies.

## §2 The model

- **Cron runs in-app.** Selecting cron installs a scheduler service into the
  generated tenant Encore app. The app schedules and fires its own jobs. No
  per-tenant Kubernetes object.
- **Cron consumes infra, it is not itself an `infra.config.json` resource.**
  Encore cron jobs are declared in code, not in `infra.config.json`. What the
  scheduler needs is infra: a SQL database for the schedule store (always) and
  optionally a cache for the distributed lock. So cron is a capability that
  *pulls* Infra-axis resources rather than being a raw infra resource.
- **Portable.** The tenant app runs anywhere Encore + Postgres (+ optional
  Redis) run. No K8s dependency for scheduling.

## §3 Mechanism

The scheduler is the `~/DevExperiment/encore-cron-scheduler-ts` prototype,
Encore-native and small:

- **Schedule store.** A Postgres table (`task_schedules`: `id`, `title`,
  `endpoint`, `schedule`, `next_run_at`, `last_run_at`, `updated_at`) via
  Encore `SQLDatabase` + a SQL migration.
- **Registration.** `POST /scheduler/register` parses the cron expression with
  the `cron-parser` npm package, computes `next_run_at`, and upserts by `id`
  (`api.ts`). The productionized flow auto-registers from the app's own Encore
  cron metadata (extracted by `encore build docker`) at startup, rather than
  by manual curl.
- **Polling daemon.** A `setInterval` loop (`worker.ts`) selects rows where
  `next_run_at <= NOW()`, fires each job's endpoint asynchronously, and
  recomputes `next_run_at` from the cron expression.

## §4 The lock and the scale tiers (decided)

The daemon must fire each due job exactly once even when the tenant app runs
multiple replicas. The lock backend is the tenant's explicit **scale choice**
in create-project:

- **Small scale (postgres-only).** The prototype's Postgres atomic claim:
  `UPDATE task_schedules SET last_run_at = NOW() WHERE id = $1 AND
  next_run_at <= NOW() RETURNING true`. Exactly one replica wins the row.
  Zero extra infrastructure; correct for single-replica and light multi-replica
  deployments.
- **Large scale (postgres + redis).** A Redis distributed lock, the
  production/enterprise-grade tier for higher replica counts and job volume
  where row-level contention on the schedule table would bottleneck.

Selection rule, mirroring the existing `data-redis` idiom (redis is an
opt-in backend switched on by `REDIS_URL`): the scheduler **auto-detects
`REDIS_URL`**. When set (large scale, `data-redis` co-selected and
provisioned), it uses the Redis lock; otherwise it falls back to the Postgres
atomic claim. One code path, tier chosen by whether redis is present.

Consequence for dependencies:

- Cron **always requires `data-postgres`** (schedule store + small-scale lock).
- Cron **optionally peers with `data-redis`** (large-scale lock only).

Postgres is already default-on in create-project (spec 227), so the required
dependency is satisfied by default; Redis is already opt-in and provisionable
via the merged `previewRedis` dev path (spec 227 Stage 3, `redis.yaml`), so the
large tier reuses existing provisioning with no new deployd surface.

## §5 factory-encore `cron` module shape

A new adapter module under `adapters/acme-vue-encore/modules/cron/`, following
the existing module manifest grammar (compare `data-postgres`, `data-redis`):

```jsonc
{
  "name": "cron",
  "version": "1.0.0",
  "description": "In-app self-hosted scheduler for Encore CronJobs. Stores schedules in Postgres and fires due jobs against the app's own endpoints. Lock backend: Postgres atomic claim by default, Redis when REDIS_URL is set (large scale).",
  "status": "stable",
  "requires": ["data-postgres"],
  "optionalPeers": ["data-redis"],
  "services": ["scheduler"],
  "migrations": ["scheduler/migrations/1_create_task_schedules.up.sql"],
  "files": { "...": "scheduler/{scheduler,api,worker}.ts" },
  "packageDeps": { "cron-parser": "^<pinned>" },
  "envVars": {
    "SCHEDULER_POLL_INTERVAL_MS": { "required": false, "description": "Daemon poll cadence (default 10000)" },
    "REDIS_URL": { "required": false, "description": "When set (large scale), the scheduler uses a Redis distributed lock instead of the Postgres atomic claim" }
  }
}
```

`requires: ["data-postgres"]` and `optionalPeers: ["data-redis"]` drive the
create-project transitive selection (the mechanism landed in create-project
PR #534): choosing cron auto-includes postgres; choosing the large tier
co-includes redis.

## §6 Create-project surface (OAP, spec-227 stage)

- Cron is a selectable **capability** in the create-project form. Because it
  pulls Infra-axis resources, it presents under the Infrastructure grouping
  (or an Application-features row that annotates its infra pull), with a
  **scale sub-choice: Small (Postgres) / Large (Postgres + Redis)**.
- Selecting cron ensures `data-postgres` (already default-on). Selecting Large
  co-selects `data-redis`, provisioned dev-side by `previewRedis` (spec 227
  Stage 3) and by the tenant for staging/prod, consistent with Option A
  topology parity.
- The exact form treatment (grouping, copy, how the scale toggle composes with
  the topology and auth axes) is the spec-227 stage's concern; this spec fixes
  the contract (cron requires postgres, large adds redis, scheduler
  auto-detects `REDIS_URL`).

## §7 Productionizing the daemon

The prototype starts the daemon at module load (`startDaemon()` top-level) and
hardcodes `http://127.0.0.1:4000` as the fire target. The tenant module MUST:

- Tie the daemon lifecycle to a service startup hook, not `init()` / module
  load, so it waits for the database connection pool to be ready.
- Fire against the app's own resolved base URL / internal endpoint, not a
  hardcoded loopback port.
- Rely on the §4 lock for multi-replica correctness (the daemon runs in every
  replica; the lock guarantees single execution).

## §8 Relationships

- **Spec 227** (create-project infra-config projection): this cron option is a
  new capability on 227's Infra axis; it reuses 227's `previewRedis`
  provisioning and transitive module selection. A follow-on 227 stage wires
  the form.
- **Spec 224** (self-hosted sweeper cron revival): DISTINCT. 224 is
  statecraft's own control-plane sweepers on K8s CronJobs and is unchanged.
  This spec is tenant-app cron. The two share only the underlying observation
  that Encore `CronJob` is a self-hosted no-op.
- **factory-encore adapter modules** (`data-postgres`, `data-redis`, ...): the
  `cron` module joins this set; implementation is a factory-encore spec (the
  cross-repo companion, as spec 227 pairs with factory-encore 008 for
  data-redis).
- **Spec 229** (auth model): sibling axis of the same create-project form.

## §9 Out of scope / staged

- The factory-encore `cron` module implementation (the scheduler payload,
  migration, manifest) lands in a factory-encore spec + PR.
- The OAP create-project form wiring (the cron capability + scale toggle +
  cascade) lands in a spec-227 stage.
- Auto-registration of the app's Encore cron metadata into the schedule table
  (the build-time extraction to runtime-register bridge) is designed here and
  implemented with the module.
- Redis-lock implementation details (library, key scheme, TTL) are settled in
  the factory-encore module PR.

## §10 Acceptance criteria

- **AC-001:** The design fixes the dependency contract: cron `requires:
  [data-postgres]`, `optionalPeers: [data-redis]`, scheduler auto-detects
  `REDIS_URL` to pick the lock backend.
- **AC-002:** Small and large scale tiers are both first-class tenant choices;
  small requires no Redis. No per-tenant Kubernetes CronJob is introduced.
- **AC-003:** Spec 224's control-plane sweeper model is untouched; this spec
  claims no statecraft sweeper path.
- **AC-004:** No OAP code-path relationship changes in this PR; the only in-PR
  code delta is the featuregraph golden node (extends 034). Follow-on PRs
  (factory-encore module, spec-227 stage) promote the referenced paths.
