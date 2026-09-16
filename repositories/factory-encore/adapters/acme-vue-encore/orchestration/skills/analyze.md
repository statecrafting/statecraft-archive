---
id: template-analyze
name: Template Analyze: Study the Underdrawing
description: Inventories the template structure for any variant (public, internal, dual): CODEMAP, Encore services, installed modules, placeholders, API endpoints, and Vue views
type: skill
variant_parameter: public | internal | dual
defers_to:
  - template-orchestrator (project structure reference, architecture invariants)
---

# Template Skill: Analyze

Study the template before making any changes. This skill produces a structured inventory of what the template currently provides, tailored to the active variant.

**Input**: Variant selection (`public`, `internal`, or `dual`): sourced from the factory API Build Specification's `variant` field when invoked from the pipeline, or derived from `requirements/services/sitemap.json` `areas[].viewType` values in standalone mode (see template-orchestrator.md "Standalone variant derivation").

---

## Step 1: Read the Architecture Blueprint

Read `CODEMAP.md` in full. Extract and summarize:

- **Backend**: The standalone Encore.ts application at `apps/api`: its Encore services, `encore.app` manifest, `infra.config.json` bindings, and port (4000)
- **Frontend**: The two Vue 3 SPAs (`apps/web`, `apps/web-internal`): their entry points, router, stores, and components
- **Service graph**: Encore services discovered from `encore.service.ts` files: `lib`, `db`, `health`, `auth`, `gateway`, `web`, and any feature services
- **Auth model**: Stateless RS256 JWT (access + DB-backed refresh) in httpOnly cookies; multi-driver SSO (`AUTH_DRIVER` env: `mock`, `rauthy`)
- **Architectural invariants**: Rules from `CODEMAP.md` Invariants section

---

## Step 2: Determine Active Apps by Variant

| Variant | Active Backend | Active Frontend(s) | Auth Driver | Use Case |
|---------|---------------|-------------------|-------------|----------|
| **public** | `apps/api` (single Encore app, rauthy OIDC) | `apps/web` | `rauthy` | External user-facing BFF |
| **internal** | `apps/api` (single Encore app, rauthy OIDC) | `apps/web` | `rauthy` | Staff-facing, owns DB |
| **dual** | Two independent Encore apps (one per audience) | `apps/web` (public) + `apps/web-internal` (staff) | `rauthy` (public), `rauthy` (internal) | Both external user and staff stacks |

**Dual variant: two independent Encore apps, not one app with two audiences:**

The dual variant is two separate Encore applications that happen to live in the same monorepo, each with its own `encore.app`, `infra.config.json`, services, and auth driver:

| Stack | App directory | Auth driver | Audiences | Data access |
|-------|--------------|-------------|-----------|-------------|
| Public | `apps/api` (public) | `rauthy` | External users | BFF: proxies to internal via `gateway` service |
| Internal | `apps/api` (internal) | `rauthy` | staff users | Owns the database (`SQLDatabase("app")`) |

During inventory, note which `AUTH_DRIVER` is configured and which driver files exist under `apps/api/auth/`.

---

## Step 2b: Variant-Structure Alignment Check

**Before proceeding**, verify the physical project structure matches the required variant. Check it explicitly.

---

### For `dual` variant:

Check that BOTH Encore app directories exist AND each contains an `encore.app` manifest and `package.json`:

| Required directory | Must contain |
|---|---|
| Public Encore app | `encore.app`, `infra.config.json`, `auth/`, `gateway/`, `package.json` |
| Internal Encore app | `encore.app`, `infra.config.json`, `auth/`, `db/`, `package.json` |
| `apps/web/` (public SPA) | `src/main.ts`, `src/router/`, `package.json` |
| `apps/web-internal/` (staff SPA) | `src/main.ts`, `src/router/`, `package.json` |

**If MISMATCH or INCOMPLETE: STOP.**

Surface this to the user:

> **Structural mismatch detected. Cannot proceed.**
>
> Variant required: **dual** (both `public-site` and `staff-portal` surfaces found)
> Project structure found: **[describe what exists]**
>
> The dual variant requires two independent Encore apps (one rauthy OIDC + external user, one rauthy OIDC + staff)
> and two Vue SPAs (`apps/web`, `apps/web-internal`).
>
> To resolve, choose one:
> - (a) Run `npx tsx scripts/setup-dual-app.ts --dest <path> --yes` to create the correct dual structure
> - (b) Re-confirm the variant: if only one audience is truly required, select `public` or `internal`
>
> Waiting for user instruction before proceeding.

---

### For `public` or `internal` variant:

Check that `apps/api/` contains `encore.app` and that `apps/web/` has `src/main.ts` and `package.json`.

If dual-app directories are present instead: confirm variant selection with the user.

---

## Step 3: Inventory Placeholders

Scan for `{{...}}` patterns across:
- `apps/api/.env.example` (always)
- `apps/web/.env.example` and `apps/web-internal/.env.example` if present
- Source files (should have none: flag any found)

For each placeholder, note: name, expected value type, file location, required vs optional.

---

## Step 4: Inventory the Encore Application

### For the active Encore app:

Read `apps/api/encore.app`: note `global_cors` origins, `build.docker`.

Read `apps/api/infra.config.json`: note secret bindings (`$env` references) and `SQLDatabase` bindings.

Read `apps/api/auth/encore.service.ts`: note which middleware the `auth` service composes (`securityHeaders`, `csrfMiddleware`, `apiRateLimit`).

List every Encore service directory under `apps/api/` that contains an `encore.service.ts` file:
- Core services: `lib`, `db`, `health`, `auth`, `gateway`, `web`
- Feature services: any additional directories (e.g., `user-management`)

For each feature service, note:
- The endpoint files (`*.ts` exporting `api()` or `api.raw()`)
- The model file (tagged-template `db.query` calls)
- Migrations under `db/migrations/` or the service's own `migrations/` directory

Note the active `AUTH_DRIVER` value in `apps/api/.env` or `apps/api/.env.example`.

### For each active web app:

Read `src/router/index.ts`: note registered routes and auth guards.

Read `src/stores/`: note existing Pinia stores (especially `auth.store.ts`).

Read `src/composables/useNavigation.ts`: note registered nav items.

---

## Step 5: Inventory Installed Modules

List every module found in the `modules/` directory. For each:
- Read `manifest.json`
- Note: name, version, services it contributes, secrets, corsEntries, middlewares, migrations, files (frontend)
- Flag modules not needed for the selected variant:

| Module | Public | Internal | Dual |
|--------|:------:|:--------:|:----:|
| `security-core` | Keep (declarative overlay) | Keep | Keep |
| `api-gateway` | Keep (if BFF proxying needed) | Remove | Keep (public) |
| `data-postgres` | Keep (declarative; base app has SQLDatabase) | Keep | Keep |
| `data-redis` | Keep (if rate-limit via Redis needed) | Keep | Keep |
| `user-management` | Conditional | Keep (if user admin needed) | Conditional |

Note: auth drivers (`mock`, `rauthy`) are now built into `apps/api/auth/` and selected by `AUTH_DRIVER`: they are not installable modules. The session-store modules (`session-store-postgres`, `session-store-redis`, `api-docs`) are retired; they have no Encore analog.

---

## Step 6: Read Environment Examples

Read `apps/api/.env.example`.

Note:
- `AUTH_DRIVER` default and available values
- JWT key references (populated by `npm run generate-keys`)
- `REDIS_URL` (optional: rate-limit backing only, not a session store)
- Database bindings (handled by `infra.config.json`, not raw `DB_*` env vars)
- `FRONTEND_URL`, `CORS_ORIGIN` equivalents in `encore.app` `global_cors`

---

## Output: Underdrawing Summary

Produce a structured report:

### 0. Variant-Structure Alignment
State whether the physical project structure matches the required variant.
- **MATCH**: structure confirmed, proceed
- **MISMATCH**: describe what is missing and STOP

### 1. Variant and Active Applications
Table: app directory, type (Encore app / Vue SPA), auth driver, purpose, port.

### 2. Encore Service Graph
List each service directory under `apps/api/`, its role (endpoints or no-endpoint utility), and its middleware stack.

### 3. Installed Modules
Table: Module | Status for this variant (Keep / Remove / Conditional) | What it contributes (services, secrets, corsEntries, frontend files).

### 4. Placeholder Inventory
Table: Placeholder | Expected value type | File | Required/Optional.

### 5. API Endpoints
All `api()` / `api.raw()` endpoints per service, with method, path, `auth: true/false`, and handler file.

### 6. Frontend Routes and Views
All registered routes with path, view component, and auth guard status.

### 7. Architectural Invariants
Bullet list from CODEMAP.md Invariants section.

### 8. Conventions
Key naming and coding conventions from CODEMAP.md Conventions section.

### 9. Items to Remove
List of modules/services/views that do not belong in this variant (input for the trim phase).

---

After producing this report: **"Underdrawing studied for {variant} variant. Ready for configuration and feature work."**
