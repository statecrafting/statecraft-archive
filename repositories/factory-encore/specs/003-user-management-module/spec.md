---
id: "003-user-management-module"
title: "User-management: the reference Encore service module"
status: approved
created: "2026-06-10"
owner: bart
kind: feature
domain: generator
risk: medium
implementation: complete
# The `security-data-invariants` and `multi-driver-auth-service` specs describe
# the base app's frozen security + auth contract; they live in template-encore
# and are pinned here via the lockstep (006-factory-schema-lockstep). Only the
# in-corpus dependencies are kept.
depends_on:
  - "001-module-manifest-schema"
  - "002-encore-generator-core"
code_aliases: ["USER_MANAGEMENT_MODULE"]
summary: >
  The reference service module: a self-contained user-management Encore
  service with app_role/user_role tables, typed api() admin endpoints,
  tagged-template SQL model, role catalog, audit on every mutation
  (INV-8), and its own SQL schema file. Demonstrates the shape every feature
  module follows: manifest.json + files/<service-dir>.
establishes:
  - "adapters/acme-vue-encore/modules/user-management/"
---

# 003. User-management: the reference Encore service module

## 1. Purpose

The user-management module is the canonical example of a feature module in
this template. It delivers a self-contained Encore service directory — with
its own typed `api()` endpoints, tagged-template SQL model, SQL schema file, and
`encore.service.ts` — composable into any generated application by the
generator core (spec 002). It is the first end-to-end exercise of the
composition pipeline and sets the shape that every subsequent feature module
follows.

Beyond demonstrating the module shape, it provides genuine business value: an
admin-CRUD role catalog (`app_role`) with per-user assignment (`user_role`),
admin endpoints for user identity management, and a complete audit trail on
every mutation (INV-8 per the `security-data-invariants` spec).

## 2. Territory

This spec owns everything under `modules/user-management/`:

- `manifest.json`: the module's manifest v2 declaration (spec 001)
- `files/user-management/` — the Encore service directory copied to
  `apps/api/user-management/` on compose

The spec references `apps/api/lib/`, `apps/api/db/`, and `apps/api/auth/`
(all owned by the `security-data-invariants` and `multi-driver-auth-service`
specs) as the substrate this module builds on. It does
not own those paths.

Auth-driver selection is a configuration concern (the `multi-driver-auth-service`
spec). No driver files
are copied or owned here.

## 3. Behavior

### FR-001 — Service directory structure

The module MUST deliver a complete Encore service directory at
`modules/user-management/files/user-management/` containing:

- **`encore.service.ts`** — `new Service("user-management", { middlewares:
  [securityHeaders, csrfMiddleware, apiRateLimit] })`, composing the same lib
  middleware chain as the base `auth` service.
- **`types.ts`** — `AppRole`, `UserSummary`, and request/response interfaces
  for every endpoint.
- **`model.ts`**: tagged-template queries (INV-2 per the `security-data-invariants` spec) over
  `app_role`, `user_role`, and `user_account`. Role assignment runs in a
  transaction (`db.begin()` → `commit`/`rollback`).
- **`users.ts`** — admin endpoints over identity and assignments.
- **`roles.ts`** — role-catalog CRUD endpoints.

The module MUST also provide `modules/user-management/files/db/1_user_management.up.sql`
containing the SQL schema that creates the `app_role` and `user_role` tables.

### FR-002 — Role model: app-managed tables

The service MUST persist app-managed roles in two new tables, keyed to the
existing `user_account` identity in the single `SQLDatabase("app")` (the
`encore-app-architecture` spec, INV-2/INV-11):

- **`app_role`** — the application's own role catalog (`pk_app_role`,
  `role_name` unique-ci, `description`, `is_system`, `created_at`), seeded
  with the template defaults: `user`, `admin`, `user-manager`.
- **`user_role`** — assignment join table linking `user_account(pk_user_account)`
  to `app_role(pk_app_role)` with `assigned_by` / `assigned_at`,
  `ON DELETE CASCADE` on both FK sides.

The service MUST NOT introduce a `pg.Pool`, a `DB_SCHEMA` prefix, or a
`{ success, data }` response envelope. Every query is parameterized (INV-2);
errors use `APIError.*` (`{ code, message, details }`).

The SQL schema file is renumbered to the next free prefix when the module is
composed, so the `user_account` FK target exists before the schema runs.

### FR-003 — Admin endpoints

**`users.ts`** exposes:

- `GET /api/v1/admin/users` — paginated, searchable user list
- `GET /api/v1/admin/users/:id` — single user with role summary
- `PATCH /api/v1/admin/users/:id` — toggle `is_active`
- `GET /api/v1/admin/users/:id/roles` — current app-role assignments
- `PUT /api/v1/admin/users/:id/roles` — replace app-role assignment set

**`roles.ts`** exposes:

- `GET /api/v1/admin/roles` — full role catalog
- `POST /api/v1/admin/roles` — create a new role (unique-violation guard: a
  `23505` Postgres error maps to `APIError.alreadyExists`)
- `PATCH /api/v1/admin/roles/:id` — update role fields; `UPDATE … RETURNING *`
  in one round-trip
- `DELETE /api/v1/admin/roles/:id` — delete role (MUST reject `is_system` roles
  with `APIError.permissionDenied`)

Every endpoint MUST be declared `{ expose: true, auth: true }` and MUST call
`requireRole(getAuthData()!.roles, "admin", "user-manager")` (any-of, INV-1
per the `security-data-invariants` spec).

### FR-004 — Input validation on `assignAppRoles`

`assignUserRoles` MUST reject unknown role ids before touching the database:
`findUnknownRoleIds` → `APIError.invalidArgument`. The insert is a single
`INSERT … SELECT unnest(...)` (two round-trips regardless of the assignment
count, not N+1).

### FR-005 — Audit on every mutation (INV-8)

Every admin mutation (`updateUser`, `assignUserRoles`, `createRole`,
`updateRole`, `deleteRole`) MUST call `lib/audit.logAuditEvent` (best-effort,
non-blocking on error). The audit record MUST include the pre-mutation state as
`oldData`:

- `updateUser`: pre-fetch old `is_active` via `getUserById` before calling
  `setUserActive`.
- `assignUserRoles`: pre-fetch old app-role set via `getAppRolesForUser` before
  calling `assignAppRoles`.
- `updateRole`: pre-fetch old role row via `getRoleById` before calling
  `model.updateRole`.

`deleteRole` captures `oldData` from the deletion target. `createRole` has no
pre-mutation state and correctly omits `oldData`.

### FR-006 — Auth service isolation

The base `auth` service MUST NOT gain a compile-time dependency on
`user-management` (`~encore/clients` imports fail `encore check` when the
module is absent). `user-management` is an opt-in module; the identity token
continues to carry IdP-sourced roles (`user_account.user_roles`). Wiring
app-managed roles into the JWT is a documented opt-in seam: a per-app step
performed when the generated application installs this module and requires
app-managed roles in the token.

### FR-007 — Manifest v2 declaration

`modules/user-management/manifest.json` MUST declare:

- `services: ["user-management"]`
- `migrations: [{ source: "db/1_user_management.up.sql" }]`
- `middlewares: ["securityHeaders", "csrfMiddleware", "apiRateLimit"]`
  (documentary; the service wires them itself)
- `secrets: []`, `corsEntries: []` (the admin surface needs no new secret or
  CORS origin)
- `requires: []` (all cross-cutting concerns are the base app floor)

### FR-008 — JSONC-aware CORS merge

When this module is composed or decomposed, the generator's `encore.app` CORS
merge MUST be comment-preserving (JSONC-aware via `jsonc-parser`). The
`//` comments and unrelated formatting of `encore.app` MUST survive a
compose + decompose round-trip intact.

## 4. Acceptance criteria

**AC-1.** `npx tsx scripts/setup-app.ts --profile internal --dest <d> --with
user-management` produces `<d>` where `cd <d>/apps/api && encore check` exits 0,
`user-management/` is present, and `db/migrations/5_user_management.up.sql`
(renumbered) exists.

**AC-2.** `add-module user-management` followed by `remove-module
user-management` composes and fully decomposes the service directory and its
SQL schema file (by the recorded `composedMigrations` filename) with no residue; the
base SQL schemas remain intact.

**AC-3.** A user-management test fixture with all five admin mutations calls
`lib/audit.logAuditEvent`; the `updateUser`, `assignUserRoles`, and `updateRole`
handlers include `oldData` in their audit records.

**AC-4.** Calling `POST /api/v1/admin/roles` with a duplicate `role_name`
returns `APIError.alreadyExists` (not a 500). Calling `PUT
/api/v1/admin/users/:id/roles` with an unknown role id returns
`APIError.invalidArgument`.

**AC-5.** An `encore.app` carrying `//` comments survives a compose +
decompose CORS round-trip with its comments and formatting intact (asserted by
the `encore-composer` JSONC fixture test).

**AC-6.** `npm test` (vitest) is green with no skips in the user-management
or composer suites.

**AC-7.** `npx spec-spine compile` exits 0; `npx spec-spine lint --fail-on-warn`
passes; `npx spec-spine index check` reports the index current; `npx spec-spine
couple --base origin/main` is clean.

## 5. Out of scope

- Wiring app-managed roles into the JWT (the opt-in token-epoch / role-source
  capability) — a downstream per-app step.
- SPA admin-view response-shape changes — frontend concern.
- Auth-driver files (driver selection is configuration only, per the
  `multi-driver-auth-service` spec).
- The dual-app generator: spec 004.
- Per-service databases: INV-11 (the `security-data-invariants` spec) forbids them; the single
  `SQLDatabase("app")` is the only database.
