---
id: "001-module-manifest-schema"
title: "Module manifest schema: declarative service composition and the module taxonomy"
status: approved
created: "2026-06-10"
owner: bart
kind: architecture
domain: generator
risk: medium
implementation: complete
# The base app whose service tree this composes into (the `encore-app-architecture`
# invariant) lives in template-encore and is pinned here via the lockstep
# (006-factory-schema-lockstep), not as an in-corpus spec dependency.
depends_on: []
code_aliases: ["MODULE_MANIFEST_SCHEMA", "MODULE_TAXONOMY"]
summary: >
  The module manifest schema: every module under modules/ declares its
  composition declaratively — services, secrets, corsEntries, middlewares,
  migrations — consumed by the generator at compose time. Service modules
  additionally ship an Encore service directory under files/. The four
  cross-cutting modules (security-core, api-gateway, data-postgres,
  data-redis) are pure declarative payloads with no copied source files.
establishes:
  - "adapters/acme-vue-encore/scripts/lib/manifest.schema.ts"
  - "adapters/acme-vue-encore/scripts/lib/modules-ts-generator.ts"
  - "adapters/acme-vue-encore/modules/security-core/"
  - "adapters/acme-vue-encore/modules/api-gateway/"
  - "adapters/acme-vue-encore/modules/data-postgres/"
  - "adapters/acme-vue-encore/modules/data-redis/"
---

# 001. Module manifest schema: declarative service composition and the module taxonomy

## 1. Purpose

Every installable module under `modules/` declares its composition through
a `manifest.json` validated against the schema defined in
`scripts/lib/manifest.schema.ts`. The schema is the contract between module
authors and the generator: it specifies exactly what a module may contribute
to a generated Encore application and how those contributions are merged at
compose time.

`scripts/lib/modules-ts-generator.ts` is the schema's primary consumer
inside the generator pipeline; it reads validated manifests and drives the
composition steps.

## 2. Territory

This spec owns the manifest schema type definition and the modules-ts
generator, plus the four cross-cutting modules whose composition is purely
declarative. Service modules (those that also ship an Encore service
directory under `files/`) are owned by the spec that governs that service's
domain (e.g., spec 003 owns `modules/user-management/`).

## 3. Behavior

### 3.1 Manifest schema

#### FR-001 — Required and kept fields

Every `manifest.json` MUST include:

| Field | Type | Semantics |
|-------|------|-----------|
| `name` | string | Module identifier (matches directory name) |
| `version` | string | SemVer |
| `description` | string | Human summary |
| `status` | `"stable"` \| `"experimental"` \| `"deprecated"` | Installability signal |

Optional fields that MUST be supported:

| Field | Type | Semantics |
|-------|------|-----------|
| `requires` | `string[]` | Module names that must also be installed |
| `requiresOneOf` | `string[][]` | At least one of each inner list must be installed |
| `optionalPeers` | `string[]` | Modules that, if present, unlock additional behavior |
| `conflicts` | `string[]` | Module names that must not be co-installed |
| `files` | object | Source file globs to copy into the destination (service modules) |
| `authExports` | object | Auth-barrel extension points |
| `packageDeps` | `Record<string, string>` | npm dependencies to add to `apps/api/package.json` |
| `envVars` | `Array<{ key, value, comment? }>` | Non-secret env entries for `.env.example` |
| `webSnippetFile` | string | Vue nav snippet path (SPA runtime nav registration) |
| `workspaceChanges` | object | Root workspace-level changes |

#### FR-002 — Encore service-composition fields

Every `manifest.json` MAY include the following service-composition fields,
consumed by the generator's compose step (spec 002):

| Field | Type | Semantics |
|-------|------|-----------|
| `services` | `string[]` | Encore service directory names the module contributes. Each directory lives under `files/<service-dir>/` and is copied to `apps/api/<service-dir>/` on installation. |
| `secrets` | `string[]` | Encore `secret()` binding names to add to `apps/api/infra.config.json`. No secret values are ever written. |
| `corsEntries` | `Array<{ origins?, methods?, headers?, ...}>` | Entries to merge into `apps/api/encore.app` `global_cors`. |
| `middlewares` | `string[]` | Names of `lib` middleware factories a contributed service composes (recorded in the service's `encore.service.ts`). |
| `migrations` | `string[]` | Migration file paths (relative to `files/`) to merge into `apps/api/db/migrations/` with deterministic renumbering. |

#### FR-003 — Schema validation

`scripts/lib/manifest.schema.ts` MUST use Zod in non-strict mode (unknown
keys stripped) so forward-compatible manifests do not fail validation on an
older generator. All five service-composition fields are optional; their
absence means the module contributes nothing for that dimension.

### 3.2 Module taxonomy

The current module set and their types:

| Module | Type | Composition |
|--------|------|-------------|
| `security-core` | Cross-cutting declarative | Env declarations; no copied service files |
| `api-gateway` | Cross-cutting declarative | `secrets[]` (GATEWAY_OAUTH_*), `corsEntries[]`; no copied service files |
| `data-postgres` | Cross-cutting declarative | `secrets[]`; no copied service files |
| `data-redis` | Cross-cutting declarative | `envVars[]` (REDIS_URL); no copied service files |
| `user-management` | Service module | `services[]`, `migrations[]`, `secrets[]`, `middlewares[]`; ships `files/user-management/` |

#### FR-004 — Cross-cutting modules are pure declarative payloads

The four cross-cutting modules (`security-core`, `api-gateway`,
`data-postgres`, `data-redis`) MUST NOT include an `apps/api/src/**` source
file tree in their `files/` payload. Their composition is entirely through
the declarative fields (`secrets`, `corsEntries`, `envVars`). Their backend
function is already provided by the base Encore app (`apps/api/lib`,
`apps/api/db`, `apps/api/gateway`); the module exists to make
add/remove-module operations uniform across all installable units.

#### FR-005 — Service modules ship a complete Encore service directory

A module that declares `services: ["<name>"]` MUST ship a complete Encore
service directory under `files/<name>/` containing at minimum:
`<name>/encore.service.ts`, `<name>/api.ts` (or equivalent endpoint
file), and `<name>/model.ts`. The generator copies this directory to
`apps/api/<name>/`; Encore discovers the service at compile time with no
loader to generate.

### 3.3 `modules-ts-generator.ts`

#### FR-006 — Governed consumer of manifests

`scripts/lib/modules-ts-generator.ts` is the schema's primary consumer.
It MUST:

- Parse manifests via the Zod schema (strict validation, no raw JSON reads).
- Drive the web-nav snippet registration (`generateWebModulesTs`) for Vue
  SPA nav integration. The web loader path is the only emitted code this
  module generates; there is no backend loader.
- NOT emit any backend-loader function (no `registerAllModules`, no runtime
  auth-driver registry, no `app.use(...)` middleware chain).

The `generateWebModulesTs` path is retained unchanged because frontend nav
registration is a Vue runtime concern unaffected by the backend's
compile-time service model.

## 4. Acceptance criteria

**AC-1.** A search for `apiRegistrations`, `authDriverRegistration`,
`sideEffectImports`, and `registerAllModules` across `scripts/` and
`modules/` returns zero live references.

**AC-2.** `vitest --config scripts/vitest.config.ts` is green: schema v2
validation tests cover each service-composition field, each cross-cutting
module validates successfully, and the `generateWebModulesTs` tests remain
active.

**AC-3.** The four cross-cutting module directories contain no
`apps/api/src/**` file tree; their `manifest.json` validates against schema
v2 with zero errors.

**AC-4.** `npx spec-spine compile` exits 0; `npx spec-spine lint
--fail-on-warn` exits 0; `npx spec-spine couple --base origin/main` exits
0 for `scripts/lib/manifest.schema.ts`, `scripts/lib/modules-ts-generator.ts`,
and the four cross-cutting module directories owned here.

## 5. Out of scope

- **`user-management` module implementation**: the schema defines its
  contract; the module itself is owned by spec 003.
- **Generator compose/decompose logic** (how composition fields are applied
  to a destination app): owned by spec 002.
- **Vue SPA source and the web-nav runtime model**: `generateWebModulesTs`
  is retained here but the Vue nav component and store are outside this
  spec's territory.
- **Future module additions**: new modules under `modules/` that follow this
  schema are added by their owning specs; this spec governs only the schema
  contract and the four cross-cutting modules listed in §3.2.
