---
id: "018-optional-redis-infra"
title: "Optional Redis infrastructure: a typed baseline client and the opt-in infra.config redis contract"
status: approved
created: "2026-07-08"
owner: bart
kind: feature
domain: app
risk: low
implementation: complete
depends_on:
  - "001-encore-app-architecture"
  - "002-security-data-invariants"
  - "008-container-host-deploy"
code_aliases: ["REDIS_HOST", "REDIS_USER", "REDIS_PASSWORD", "getRedis"]
summary: >
  Redis is an optional, opt-in infrastructure resource for the baseline app.
  When present it is provisioned externally (in OAP dev by deployd; in
  staging/prod by the tenant) and reached over a fully typed connection triple,
  REDIS_HOST / REDIS_USER / REDIS_PASSWORD, exactly parallel to the app's
  Postgres SQL_HOST / SQL_USERNAME / SQL_PASSWORD contract. This spec ships the
  single baseline seam that reads that triple: apps/api/lib/redis.ts, a lazily
  constructed ioredis client that stays dormant (opens no socket) unless
  REDIS_HOST is set. The Encore infra.config `redis` block that declares the
  resource is not baseline: it is composed into a produced app only when the
  factory data-redis module is selected (factory-encore spec 008), so the lean
  baseline carries the client but not the resource. Redis is explicitly NOT the
  rate-limit backend (that is Postgres, INV-6) and NOT a session store (sessions
  are stateless JWT, INV-3 / INV-7); its first concrete consumer is the cron
  scheduler's large-scale distributed lock, which peers with this resource
  optionally.
establishes:
  - "apps/api/lib/redis.ts"
  - "apps/api/lib/redis.test.ts"
---

# 018 - Optional Redis infrastructure: a typed baseline client and the opt-in infra.config redis contract

## 1. Purpose

The baseline app has no Redis. Rate limiting is Postgres-backed (INV-6) and the
OAuth token cache is in-process (INV-10), so Redis is not a core dependency.
Some produced apps, however, want a real provisioned Redis: the canonical case
is the cron scheduler's large-scale distributed lock, which uses a Redis
`SET NX` lock across replicas instead of a Postgres atomic claim.

This spec makes Redis a first-class *optional* resource with one honest,
fully-typed contract, so that:

- the connection contract is a single typed triple, not an opaque URL, and it
  parallels the app's existing Postgres contract; and
- the baseline stays lean: it carries the small client seam, but the Encore
  `infra.config.json` `redis` block that declares the resource is composed in
  only when the app opts into Redis.

## 2. The contract

### 2.1 Connection env (fully typed, parallel to Postgres)

| Var | Kind | Meaning |
|-----|------|---------|
| `REDIS_HOST` | non-secret | `host` or `host:port` (default port 6379) |
| `REDIS_USER` | non-secret | ACL username (Redis 6+ ACL) |
| `REDIS_PASSWORD` | secret | ACL password |

This mirrors `SQL_HOST` / `SQL_USERNAME` / `SQL_PASSWORD`. There is no
`REDIS_URL`: a single typed triple is the only Redis connection contract, so
there is nothing to clash. `REDIS_PASSWORD` is read from the process
environment (not through Encore `secret()`) because the client is a raw ioredis
client for a self-hosted resource rather than an Encore-managed resource; the
value is injected at container start by the deploy substrate, the same way the
raw connection env for the resource is supplied.

### 2.2 The infra.config redis block (composed, not baseline)

A produced app that opts into Redis carries a `redis` block in
`apps/api/infra.config.json`:

```json
"redis": {
  "cache": {
    "host": "${REDIS_HOST}",
    "auth": {
      "type": "acl",
      "username": "${REDIS_USER}",
      "password": { "$env": "REDIS_PASSWORD" }
    }
  }
}
```

The block is a topology declaration: Encore accepts it without a `CacheCluster`
in code (verified against Encore v1.57.9), and the app reaches Redis through the
raw client in §2.3. The block is **not** part of the lean baseline; it is
composed by the factory `data-redis` module (factory-encore spec 008) when the
resource is selected. This keeps the baseline free of an unused resource
declaration while giving opted-in apps the `redis` topology the deploy substrate
provisions against.

### 2.3 The baseline client seam

`apps/api/lib/redis.ts` is the one place that reads the triple:

- `isRedisConfigured()` reports whether `REDIS_HOST` is set, so a consumer can
  branch (small tier vs large tier) without touching Redis.
- `getRedis()` lazily constructs and memoizes an ioredis client from the triple;
  it opens no socket unless called, so an app that never sets `REDIS_HOST` pays
  nothing. It throws if called while unconfigured, so misuse fails loudly rather
  than connecting to a default localhost.
- `parseRedisHost()` splits `host` / `host:port` into typed parts and is exported
  for tests.

## 3. Requirements

### Functional Requirements

- **FR-001**: The baseline MUST expose a single Redis client seam
  (`apps/api/lib/redis.ts`) that reads the typed `REDIS_HOST` / `REDIS_USER` /
  `REDIS_PASSWORD` triple. No other connection contract (in particular no
  `REDIS_URL`) may be introduced.
- **FR-002**: The client MUST be dormant by default: constructing it MUST be
  lazy, and an app that never sets `REDIS_HOST` MUST open no Redis socket and
  MUST type-check and boot unchanged.
- **FR-003**: Redis MUST NOT be presented as the rate-limit backend or a session
  store. The seam documents its honest role (an optional provisioned resource;
  first consumer the cron large-scale lock).
- **FR-004**: The infra.config `redis` block declaring the resource MUST NOT be
  in the lean baseline; it is composed by the factory `data-redis` module when
  the resource is selected.

### Success Criteria

- **SC-001**: `encore check` and the app boot pass with `REDIS_HOST` unset and
  no Redis available.
- **SC-002**: With the triple set, `getRedis()` returns a client that speaks the
  `SET ... PX ... NX` lock protocol the cron scheduler uses.
- **SC-003**: There is no `REDIS_URL` anywhere in the produced app's contract.

## 4. Relationships

`depends_on` cites the invariant specs whose guarantees this must not violate
(001 architecture, 002 security/data invariants: rate limit stays Postgres,
sessions stay stateless JWT) and 008 (the deploy paths that inject the runtime
env). The cross-repo companions are OAP spec 227 (which surfaces Redis as an
opt-in Infrastructure resource in create-project and provisions it in dev via
deployd `previewRedis`) and factory-encore spec 008 (which composes the
infra.config `redis` block and migrates the cron lock onto this typed client).

## 5. Out of scope

- The infra.config `redis` block composition and the cron lock migration:
  owned by factory-encore spec 008.
- The create-project Redis selector and deployd dev provisioning: owned by
  OAP spec 227.
- Encore-native `CacheCluster` caching, additional resource types
  (object storage, pub/sub, metrics), and any change to the Postgres rate
  limiter (INV-6) or the in-process token cache (INV-10).
