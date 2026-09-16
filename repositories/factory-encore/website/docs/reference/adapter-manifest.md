# Adapter Manifest: acme-vue-encore

The `acme-vue-encore` adapter manifest (`adapters/acme-vue-encore/manifest.yaml`) is the canonical declaration of the shipped adapter. It conforms to `contract/schemas/adapter-manifest.schema.yaml` at version 1.1.0.

## Identity

| Field | Value |
|-------|-------|
| Name | `acme-vue-encore` |
| Display name | Acme Vue + Encore (PrimeVue, rauthy) |
| Version | 0.1.0 |
| Schema version | 1.1.0 |

## Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript |
| Runtime | Node 24 |
| Backend | Encore.ts |
| Frontend | Vue 3 (Composition API, script setup) |
| State management | Pinia |
| Design system | PrimeVue |
| Database | PostgreSQL (Encore `SQLDatabase`, tagged-template SQL, no ORM) |
| Auth | OpenID Connect via rauthy |

## Capabilities

| Capability | Supported |
|-----------|-----------|
| Single stack | Yes |
| Dual stack | Yes |
| BFF pattern | Yes |
| Token auth | Yes |
| Session auth | No |
| API key auth | No |
| Module system | Yes |
| Direct SQL | Yes |
| ORM-based | No |
| API proxy | Yes |
| Audit logging | Yes |
| File uploads | No |
| Background jobs | No |
| Realtime | No |
| Email notifications | No |

## Supported auth methods

| Method | Driver | Description |
|--------|--------|-------------|
| OIDC | rauthy | Authorization code flow with PKCE (S256). Tokens validated against issuer JWKS; roles/groups claims map to application roles. RP-initiated logout via end_session_endpoint. |
| Mock | mock | Built-in mock driver for development and test only. |

## Commands

| Command | Value |
|---------|-------|
| install | `npm install` |
| compile | `npm run build` |
| test | `npm test && npm --prefix apps/api test` |
| lint | `npm run lint` |
| dev | `npm run dev` |
| format_check | `npm run format:check` |
| type_check | `npm run typecheck && npm run typecheck:api` |
| feature_verify | `npm run typecheck:api` then `npm test` |

## Directory conventions

| Convention | Path pattern |
|-----------|-------------|
| API service | `apps/api/{resource}/service.ts` |
| API controller | `apps/api/{resource}/{resource}.ts` |
| API route | `apps/api/{resource}/encore.service.ts` |
| API model | `apps/api/{resource}/model.ts` |
| API types | `apps/api/{resource}/types.ts` |
| API test | `apps/api/{resource}/{resource}.test.ts` |
| API middleware | `apps/api/lib/{name}.ts` |
| UI view | `apps/{stack}/src/views/{PageName}View.vue` |
| UI store | `apps/{stack}/src/stores/{resource}.store.ts` |
| UI route config | `apps/{stack}/src/router/index.ts` |
| UI test | `apps/{stack}/src/views/{PageName}View.test.ts` |
| UI component | `apps/{stack}/src/components/{Name}.vue` |
| Migration | `apps/api/db/migrations/{n}_{name}.up.sql` |
| Env file | `apps/api/.env.example` |

The `{stack}` placeholder refers to the Vue SPA app (`web` or `web-internal`); the backend is always `apps/api`.

## Profiles

| Profile | Variant | Auth driver | Default modules |
|---------|---------|-------------|-----------------|
| minimal (default) | single | mock | none |
| public | single-public | rauthy | none |
| internal | single-internal | rauthy | user-management |
| dual | dual | rauthy | none |

## Governance sub-envelope

The adapter declares a governance sub-envelope (introduced at schema 1.1.0):

- **Max tier**: tier2
- **File write scope**: `apps/**`, `packages/**`, `public/**`, `internal/**`, `package.json`, `.env.*.example`
- **File write denied**: `.env`, `**/keys/**`, `**/.git/**`, `node_modules/**`
- **Scaffold execution**: sandbox-required isolation.

## Validation invariants

| ID | Description | Type | Severity |
|----|-------------|------|----------|
| INV-001 | No ORM imports (typeorm, prisma, sequelize, drizzle-orm) | grep-absent | error |
| INV-002 | No raw dynamic SQL (db.rawQuery/db.rawExec) | grep-absent | error |
| INV-003 | No console.log in shipped code | grep-absent | warning |
| INV-004 | No explicit `any` types | grep-absent | warning |
| INV-005 | Lint passes with zero warnings | command-succeeds | error |

## Dual-stack topology

The dual topology produces two independent Encore applications:

| Variant | Directory | API | Web | Port (API) | Port (Web) | Data access |
|---------|-----------|-----|-----|-----------|-----------|-------------|
| public | `public/` | `apps/api` | `apps/web` | 4000 | 5173 | proxy |
| internal | `internal/` | `apps/api` | `apps/web-internal` | 4000 | 5174 | direct |

Each variant is a complete, standalone Encore app with its own `encore.app`, database, and deployment boundary.
