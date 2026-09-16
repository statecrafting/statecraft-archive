---
id: template-trim
name: Template Trim: Remove Unused Elements
description: Cleanly removes unused template elements for the selected variant (public, internal, dual): auth drivers, Encore services/modules, Vue views, and config
type: skill
variant_parameter: public | internal | dual
defers_to:
  - template-orchestrator (removal patterns, architecture invariants)
---

# Template Skill: Trim

Remove everything that doesn't belong in the final application. A removal is only complete when the element is gone and nothing still references it.

**Input** (pipeline mode): `variant` from the factory API Build Specification. REMOVE scope is informed by which endpoints and services are needed. The variant-driven removals table below covers the canonical case; Build Spec inspection refines edge cases.

**Input** (standalone mode): REMOVE list produced by the analyze phase + variant supplied by the user.

---

## The Four Rules of Clean Removal

For every item you remove:

1. **Delete the files**
2. **Remove all imports**: search for deleted file or symbol names across all files
3. **Remove all registrations**: from `router/index.ts`, `useNavigation.ts`, and any module manifest that references the removed item
4. **Update documentation**: `CODEMAP.md`, `README.md`

If any of these four are incomplete, the removal is incomplete.

---

## Variant-Driven Removals

Before processing the REMOVE list, apply these variant-specific removals automatically. Auth drivers are built into `apps/api/auth/` and selected by `AUTH_DRIVER`: trim applies to optional Encore modules and Vue views, not to driver files that are always present.

### Public Variant: Remove These:

| Category | What to Remove | Reason |
|----------|---------------|--------|
| Module | `api-gateway` module (if BFF proxying not needed) | Public stack may not need the gateway service |
| Module | `user-management` module (if not required) | Optional feature module |
| Vue views | Staff-only admin views | Public app is external user-facing only |
| Config | Internal-only env vars | No internal stack |

The `auth` service always ships both drivers (`mock`, `rauthy`): `AUTH_DRIVER` selects the active one. Do not delete driver files; configure `AUTH_DRIVER=rauthy` (plus `AUTH_DRIVER=mock` for dev).

### Internal Variant: Remove These:

| Category | What to Remove | Reason |
|----------|---------------|--------|
| Module | `api-gateway` module | Internal stack owns data directly (no BFF proxy needed) |
| Module | `user-management` module (if not required) | Optional feature module |
| Vue views | External-user-only public views | Internal app is staff-facing only |
| Config | Unused rauthy OIDC env vars (if only the mock driver is used in dev) | `AUTH_DRIVER=rauthy` for internal |

### Dual Variant: Remove These:

Apply the public removals to the public Encore app and the internal removals to the internal Encore app. Each app keeps only the modules and views its audience needs.

---

## Removal Patterns by Type

### Pattern A: Remove an Entire Stack (dual → single)

Use when a dual template is being narrowed to single-stack.

1. **Delete the Encore app directory** (the one not needed):
   - Removing public: delete the public Encore app (`apps/api-public/` or equivalent)
   - Removing internal: delete the internal Encore app

2. **Remove from root `package.json` scripts**: any script referencing the removed Encore app

3. **Delete the corresponding Vue SPA** (`apps/web/` or `apps/web-internal/`)

4. **Remove from root `package.json` workspaces**

5. **Remove GitHub Actions workflows** for the removed stack

6. **Update `README.md` and `CODEMAP.md`**: remove app references

---

### Pattern B: Remove an Auth Driver Configuration

Auth drivers (`mock`, `rauthy`) are static files in `apps/api/auth/`. Removing them is rarely needed: the driver is inactive unless `AUTH_DRIVER` selects it.

If the project will never use a driver and you want to remove the dead code:

1. **Identify driver files**: `apps/api/auth/{mock,rauthy}.ts`
2. **Remove the driver handler** from `apps/api/auth/drivers.ts` (the discovery and login dispatcher)
3. **Remove driver-specific secrets** from `apps/api/lib/secrets.ts` and `apps/api/infra.config.json`
4. **Remove driver env vars** from `apps/api/.env.example`
5. **Verify `encore check` still passes** after removal

> **Do not remove the `mock` driver**: it is needed for local development regardless of production `AUTH_DRIVER`.

---

### Pattern C: Remove an Encore Service (feature service)

Use when a feature module's service directory is not needed for this variant.

1. **Delete the service directory** (`apps/api/<service-name>/`)
2. **Remove any migrations** the service added to `apps/api/db/migrations/` (renumber remaining migrations if needed)
3. **Remove module reference** from installed modules list (`template.json` or equivalent)
4. **Remove any frontend views and stores** the service powered (see Pattern E)
5. **Run `encore check`** to verify the application graph is clean

---

### Pattern D: Remove an API Endpoint

1. Delete or comment out the `api()` export from its endpoint file
2. If the endpoint file is now empty, delete it
3. If the entire service is now empty, delete the service directory (Pattern C)
4. Remove corresponding Pinia store methods that called the endpoint
5. Update OpenAPI spec if maintained

---

### Pattern E: Remove a Vue View / Page

1. Delete: `views/FeatureNameView.vue`
2. Delete associated store if feature-specific
3. Remove route from `router/index.ts`
4. Remove nav item from `useNavigation.ts`
5. Remove view-specific components (verify not shared first)

**Common view removals:**
- `/` (home) → `HomeView.vue` + route: **Must replace**, not just delete. Register the app's real primary view at `/` first (configure Step 6a), then delete `HomeView.vue`.
- `/about` → `AboutView.vue` + route + nav item
- `/profile` → `ProfileView.vue` + route (check if auth store profile methods still needed)
- `/connectivity-test` → `ConnectivityTestView.vue` + route (if `api-gateway` module removed)

---

### Pattern F: Remove the API Gateway Module

Use when the public stack does not need to proxy to a private backend.

1. **Remove the `api-gateway` module** from installed modules
2. **If the `gateway` service was installed as a module service**: delete `apps/api/gateway/` directory
   - Note: the base Encore app ships a `gateway` service by default (`apps/api/gateway/`); if this is the base gateway, remove `gateway/proxy.ts` and its `encore.service.ts` rather than the whole directory
3. **Remove gateway secrets and env vars** from `infra.config.json` and `.env.example` (`PRIVATE_API_BASE_URL`, `GATEWAY_OAUTH_*`, `GATEWAY_TIMEOUT_MS`)
4. **Remove `ConnectivityTestView.vue`** and its route (if it only tests the gateway)
5. **Update `CODEMAP.md`**: remove BFF pattern references if the gateway is fully gone

---

### Pattern G: Remove a Declarative Module (security-core, data-postgres, data-redis)

These modules are thin declarative overlays on the base Encore app (no `apps/api/src/**` files). Removing them means:

1. **Uninstall the module**: remove from `template.json` installed modules list
2. **Remove any `corsEntries`** the module contributed to `encore.app` `global_cors`
3. **Remove any `secrets`** the module declared from `infra.config.json` and `lib/secrets.ts`
4. **Remove any `envVars`** from `.env.example`
5. The backend function (rate-limiting, security headers, Postgres) remains in the base app: removing the declarative module does not change the runtime behaviour

---

## Verification After Each Removal

1. **Search for orphaned references**: grep for deleted file names, export names, route paths
2. **Encore check**: `cd apps/api && npx encore check` (backend graph clean)
3. **TypeScript check**: `npm run typecheck --workspace=apps/web` (and `apps/web-internal` if dual)
4. **ESLint**: `npm run lint`: catch unused imports

---

## Output: Trim Report

### Removed Items
For each removal: what was removed, files deleted, references cleaned.

### Cleanup Checklist
For each removal:
- [ ] Files deleted
- [ ] Imports removed
- [ ] Registrations removed
- [ ] Documentation updated
- [ ] `encore check` passed
- [ ] TypeScript check passed

### Remaining References
List any intentionally kept references: or confirm "no remaining references found."

---

**Report**: "Trim complete for {variant} variant. {N} items removed. All cleanup verified."
