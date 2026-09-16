---
id: "001-encore-app-architecture"
title: "Encore.ts application architecture: standalone apps/api and service decomposition"
status: approved
created: "2026-06-10"
owner: bart
kind: architecture
domain: app
risk: medium
implementation: complete
code_aliases: ["ENCORE_APP", "ENCORE_API_SCAFFOLD"]
summary: >
  The backend is a standalone Encore.ts application at apps/api —
  deliberately outside the npm workspace — decomposed into lib, db, health,
  auth, gateway, and web services. Locked decisions: stateless RS256 JWT,
  a single SQLDatabase("app"), /api/v1 path prefix, port 4000, global_cors,
  and `encore build docker --base` for container images.
establishes:
  - "apps/api/encore.app"
  - "apps/api/tsconfig.json"
  - "apps/api/infra.config.json"
  - "apps/api/vitest.config.ts"
  - "apps/api/Dockerfile.base"
  - "apps/api/Dockerfile.hotfix"
  - "apps/api/.env.example"
  - "apps/api/scripts/"
  - "apps/api/health/"
references:
  - { unit: { kind: file, path: "CODEMAP.md" }, role: "derived architecture view" }
---

# 001 — Encore.ts application architecture: standalone apps/api and service decomposition

## 1. Purpose

The backend of this enterprise template is a standalone **Encore.ts**
application at `apps/api`. Encore primitives replace traditional middleware
stacks: typed `api()` endpoints, an `authHandler` plus `Gateway`, service
`middlewares`, `SQLDatabase`, `encore.dev/log`, and `global_cors`. This spec
is the authoritative architectural blueprint; it fixes the layout, service
decomposition, and locked decisions that every downstream spec builds against.

## 2. Territory

This spec owns the root application scaffold — the Encore manifest, build
configuration, environment template, Docker files, the app's helper
scripts (`apps/api/scripts/`), and the `health` service. The security primitives and persistence schema are
owned by spec `002-security-data-invariants`. The `auth` and `gateway`
services are owned by specs `003-multi-driver-auth-service` and
`004-bff-gateway-proxy` respectively.

`CODEMAP.md` is a derived architecture view that references this spec but
is not owned here.

## 3. Behavior

### 3.1 Standalone application layout

**FR-001**: The backend MUST be a standalone Encore.ts application rooted at
`apps/api` with an `encore.app` manifest. It MUST be excluded from the root
npm workspaces so its dependency tree does not tangle with the Vue SPA or
package trees.

`apps/api` has its own `node_modules` and `package-lock.json`. Root
`package.json` script wiring:

- `dev:api` — runs `npm --prefix apps/api run dev` (Encore, `encore run --port=4000`)
- `build:api` — runs `npm --prefix apps/api run build:docker`
- `typecheck:api` — runs `npm --prefix apps/api run typecheck` (`encore check`)

### 3.2 Service decomposition

**FR-002**: Encore services MUST be discovered from per-directory
`encore.service.ts` files. The application graph MUST resolve cleanly
(`encore check` passing) with all services present.

| Service | Role |
|---------|------|
| `lib` | No-endpoint service; hosts `secret(...)` declarations, shared middleware, and utilities. Owned by spec `002-security-data-invariants`. |
| `db` | No-endpoint service; owns the single `SQLDatabase("app")` and its schema scripts. Owned by spec `002-security-data-invariants`. |
| `health` | Liveness/readiness probes (`/health`, `/health/liveness`, `/health/readiness`), `GET /api/v1/info`, `POST /api/v1/csp-report`. Only `securityHeaders` middleware is mounted (probes and CSP reports are unauthenticated). Owned by this spec. |
| `auth` | `authHandler` plus `Gateway`, multi-driver SSO (`mock`, `rauthy`), `/auth/me`, `/auth/refresh`, `/auth/logout`, `/auth/csrf-token`, driver discovery. Owned by spec `003-multi-driver-auth-service`. |
| `gateway` | BFF proxy: `api.raw` catch-all at `/api/v1/data/*` to the private backend. Owned by spec `004-bff-gateway-proxy`. |
| `web` | Static SPA serving via `api.static`. Owned by spec `005-spa-static-serving`. |

### 3.3 Locked decisions

These decisions are fixed for all applications built from this template:

- **Auth: stateless RS256 JWT.** Access token (RS256, 15 min) plus refresh
  token (7 day, DB-backed rotation/revocation) in httpOnly cookies, validated
  by an Encore `authHandler` plus `Gateway`. The Vue httpOnly cookie plus CSRF
  contract is preserved. Mechanisms are specified in detail by spec
  `002-security-data-invariants`.
- **Persistence: a minimal `SQLDatabase("app")`.** Postgres is used for the
  user record, refresh-token revocation, and a durable audit trail
  (`user_account`, `refresh_token`, `audit_log`).
- **Path prefix `/api/v1`.**  Endpoints keep the `/api/v1` prefix so external
  OIDC callback URLs and the `/api/v1/data/*` gateway contract stay stable and
  the SPA requires minimal change.
- **CORS via `encore.app` `global_cors`.** Replaces per-request middleware;
  credentialed origins enumerate every SPA origin (Vite dev servers plus
  production hostnames).
- **Port 4000** (Encore default), cascaded to Vite proxy targets.
- **Docker: `encore build docker --base <custom>`.** `Dockerfile.base` carries
  the OS plus helper binaries; `Dockerfile.hotfix` is the source-only fast
  path; `scripts/docker-build.sh` is the cancel-then-scrape hotfix builder.
  `encore.app` sets `bundle_source: true`.

**FR-003**: Endpoints MUST retain the `/api/v1` path prefix for the
externally-visible surface (`/api/v1/info`, `/api/v1/csp-report`, and the
`/api/v1/data/*` proxy plus `/api/v1/auth/*`).

**FR-004**: CORS MUST be configured in `encore.app` `global_cors`, not as
per-request middleware; credentialed origins MUST enumerate every SPA origin.

**FR-005**: Secrets and the SQL database MUST be bound via
`infra.config.json` `$env` mappings; no secret value is committed.

### 3.4 Application scaffold inventory

Files and directories owned by this spec:

- `apps/api/encore.app` — app manifest (`global_cors`, `build.docker.bundle_source`).
- `apps/api/tsconfig.json` — `~encore/*` path mapping, strict, `bundler` resolution.
- `apps/api/infra.config.json` — local-dev secret plus SQL-server bindings (`$env`).
- `apps/api/vitest.config.ts` — node env, `--passWithNoTests`.
- `apps/api/.env.example` — non-secret env plus secret placeholders (`PORT=4000`, and so on).
- `apps/api/Dockerfile.base`, `apps/api/Dockerfile.hotfix`.
- `apps/api/scripts/` — `generate-keys.ts` (RSA-2048 JWT keys), `migrate.mjs` (prod schema runner), `docker-build.sh`.
- `apps/api/health/` — the `health` service (probes plus info plus csp-report).

Not committed (gitignored, generated on demand): `apps/api/encore.gen/`,
`apps/api/.encore/`, `apps/api/node_modules/`, `apps/api/keys/` plus
`*.pem` (created by `npm run generate-keys`), `apps/api/openapi.yaml`.

Owned by spec `002-security-data-invariants`: `apps/api/lib/`, `apps/api/db/`.

## 4. Acceptance criteria

**AC-1**: `cd apps/api && encore check` resolves the application graph,
service topology, and typechecks with zero errors.

**AC-2**: `cd apps/api && npm test` passes (vitest, `--passWithNoTests`
acceptable on a scaffold with no test files yet).

**AC-3**: `npx spec-spine compile` produces no new diagnostics; the codebase
index is up to date (`npx spec-spine index check` exits 0); and the spec/code
coupling gate is clean for every path claimed by this spec (`npx spec-spine
couple --base origin/main`).

**AC-4**: No secret material is present in the committed tree — `keys/` and
`*.pem` are gitignored; `infra.config.json` carries only `$env` references.

## 5. Out of scope

- The `auth`, `gateway`, and `web` services — see specs `003`, `004`, `005`.
- The security primitives (`lib/`) and persistence schema (`db/`) — see spec `002`.
- CI/CD workflows — see specs `007`, `009`, `010`.
- The SPA applications (`apps/web`, `apps/web-internal`) — unchanged by this spec.