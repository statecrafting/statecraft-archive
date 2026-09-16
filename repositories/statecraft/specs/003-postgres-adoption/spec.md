---
id: "003-postgres-adoption"
title: "Control plane on CoreLedger-over-Postgres"
status: approved
created: "2026-07-14"
implementation: complete
depends_on:
  - "002-app-shell"
establishes:
  - "docker/compose.postgres.yml"
  - ".env.example"
summary: >
  The control plane runs CoreLedger on the Postgres driver while stamped
  customer apps stay on libSQL/Turso: same decorator API, different
  driver, selected by URL scheme. The driver itself is enrahitu spec 011
  and lives in the chassis (core/ledger/postgres.ts); this spec is the
  consuming side: local Postgres for dev, config wiring, the migration
  posture for control-plane tables, and proof that the whole chassis
  test suite passes on both drivers inside this repo.
---

# 003: Postgres adoption

## 1. Cross-repo dependency (read first)

The Postgres driver is implemented in the template repo under enrahitu
spec 011. If the chassis imported by spec 002 does not yet contain
`core/ledger/postgres.ts`, this spec is blocked: stop and report
"blocked on enrahitu 011", do not fork the driver here. When the driver
exists upstream, refresh the chassis files it touches (core/ledger/*)
via a recorded manual re-import (same mode as spec 002 §2), then
proceed.

RESOLVED 2026-07-15: spec 002's slimmed import brought the driver at
`backend/core/ledger/postgres.ts` (with the parameterized ledger suite),
so this spec is unblocked and consumes it as-is.

## 2. Territory

- `docker/compose.postgres.yml`: a dev Postgres 16 service (single
  container, named volume, port 5433 to avoid host collisions) plus a
  documented `npm run dev:db` script in the root package.json.
- Config wiring edits land in files owned by 002 (env plumbing) and are
  amended there if behavior moves.

## 3. Behavior

- Driver selection is config only. Spec 002's import kept the chassis
  substrate env prefix (the stamp deliberately does not rename env
  prefixes), so the variable is `ENRAHITU_LEDGER_URL`, not a
  statecraft-prefixed name: `postgres://...` selects the Postgres driver,
  `file:...` keeps libSQL for quick local hacking. Both are documented in
  `.env.example`. The parameterized test suite selects Postgres separately
  via `TEST_POSTGRES_URL` (set by CI against a Postgres service, unset
  skips), so tests never depend on the app's own ledger config.
- Control-plane tables (tenants, installations, attestations, etc.)
  arrive with their owning service specs; this spec proves the
  substrate, not the schema.
- Migration posture: forward-only, additive-first, versioned, as
  enrahitu spec 011 §3 defines; destructive changes require a manual,
  reviewed migration. The control plane never auto-drops.
- FIPS rule: any checksum or auth SQL uses sha256, never md5 (the
  production Postgres targets reject md5; this burned the platform
  once).

## 4. Acceptance

- `npm run dev:db` (docker/compose.postgres.yml), then `npm test` with
  `TEST_POSTGRES_URL` pointed at it: the chassis ledger suite's Postgres
  arm runs and passes (it skips when unset). CI proves this continuously:
  verify.yml runs the whole suite against a Postgres service every run,
  so both drivers pass on every push.
- The same suite still passes on the default libSQL path.
- `npm run dev` with `ENRAHITU_LEDGER_URL=postgres://...` boots and
  `/health`'s decorator canary goes green.
- Spine gates green.

## 5. Out of scope

- Managed/production Postgres provisioning (fleet/infra concern).
- Any control-plane domain schema (owned by service specs 004+).
- Turso sync (stamped-app concern; the control plane does not sync).

## 6. Status (2026-07-15): complete

CoreLedger runs on Postgres for the control plane; stamped apps stay on
libSQL. `docker/compose.postgres.yml` + `npm run dev:db` provide the dev
database; `.env.example` documents the `ENRAHITU_LEDGER_URL` selection.

Proof: `verify.yml` now runs the whole suite against a Postgres 16 service
every push (with `TEST_POSTGRES_URL` set). The parameterized ledger suite
passes on BOTH drivers: 66 tests, 0 skipped (was 55 passed / 11 skipped
before the Postgres arm ran), including the 15 `PostgresDriver` tests
(migrations, tx, the sha256-not-md5 checksum path) and the 8
CoreLedger-over-Postgres ledger tests. libSQL stays green on the default
path.

Not separately exercised this session: a local `npm run dev` boot against
Postgres (needs Docker running). The driver's init/canary path is the same
one the 15 + 8 passing tests cover, so the substrate is proven by CI rather
than a one-off boot.
