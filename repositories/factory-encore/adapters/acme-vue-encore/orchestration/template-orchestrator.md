---
id: template-orchestrator
name: Template Orchestrator: Vue + Encore Enterprise Template
description: Orchestrates template transformation for public, internal, or dual-stack variants. Covers project structure, module system, implementation patterns with code examples, configuration, and architecture invariants. Designed to be consumed by the factory pipeline (stages 4-5) without duplicating factory-owned concerns.
type: orchestrator
scope: template-implementation
references:
  - template-analyze
  - template-configure
  - template-scaffold-feature
  - template-trim
  - template-validate
skills_dir: orchestration/skills/
defers_to:
  - factory-orchestrator (pipeline workflow, stage gates, validation rules FAC-S*)
  - api-web-standards (enterprise web API standards)
  - api-rest-standards (REST design standards)
  - api-security (API security standards)
  - ci-design-system (PrimeVue design system guidance)
  - business-requirements (requirements gathering: factory stage 1)
  - svc-req-orchestrator (service requirements: factory stage 2)
---

# Vue + Encore Enterprise Template: Orchestrator

This document is the single source of truth for **how to build with the Vue + Encore Enterprise Template**. It orchestrates template transformation for any of the three supported variants (public, internal, dual), provides implementation patterns with code examples, and references sub-skills for each phase of work.

**This document does NOT cover:**
- Pipeline workflow, stage sequencing, or validation gates: owned by `ref:factory-orchestrator`
- Business requirements gathering: owned by factory stages 1-3
- Enterprise API/REST/security standards enforcement: owned by `ref:api-web-standards`, `ref:api-rest-standards`, `ref:api-security`
- PrimeVue design system guidance: owned by `ref:ci-design-system`
- Test traceability validation (UC-nnn / TC-nnn coverage checks): owned by factory validation gates. The template **produces** the traceability report; the factory **validates** it.

When the factory pipeline invokes template work (stages 4-5), this document provides the implementation knowledge. The factory provides the what and why; this document provides the how.

---

## Execution Discipline

### Skill Dereferencing: Read Before Invoke

Every `ref:template-*` in this orchestrator refers to a skill whose authoritative specification is a markdown file containing `id: <identifier>` in its YAML frontmatter. When invoking a skill, you MUST follow these rules:

1. **Locate the skill file.** Search the `orchestration/skills/` directory for a markdown file whose frontmatter `id` matches the `ref:` identifier. Do NOT hardcode file paths; resolve by frontmatter `id`.
2. **Read the skill file in full.** Before generating any output governed by that skill, read the entire skill markdown so that all code patterns, checklist items, validation rules, and structural requirements are available. Section-level gating (e.g., "invoke Section A only") means skip the *execution* of other sections: still read the full file so cross-references and shared rules are available.
3. **Never substitute memory for specification.** If context was compacted since the skill was last read, re-read the skill file before resuming work. Do NOT reconstruct the skill's instructions from memory: code examples, CSS patterns, checklist items, and dual-variant rules contain exact details that memory will approximate incorrectly.
4. **If a skill file cannot be located, STOP.** Report the missing `ref:` identifier. Do NOT approximate the skill's behaviour from prior context or training knowledge.

### Just-in-Time Skill Loading

Do NOT read all 5 skill files at pipeline start. Read each skill ONLY when you are about to invoke it for the current phase. After a phase completes and its output is committed, the skill's detailed instructions can be released from active context: you do not need to hold them while working on the next phase.

Re-read a skill if needed in a later phase. A targeted re-read costs far less context than holding all skills simultaneously, and far less than fixing an artifact that failed because you lost the skill's instructions mid-generation.

**Phase-to-skill loading schedule:**

| Phase | Skill to read | When to release |
|-------|--------------|-----------------|
| Phase 1: Analyze | `ref:template-analyze` | After Underdrawing Summary is complete |
| Phase 3: Configure | `ref:template-configure` | After Configuration Report is complete |
| Phase 4a: Build API | `ref:template-scaffold-feature` | After Phase 4a checkpoint passes |
| Phase 4b: Build UI | Re-read `ref:template-scaffold-feature` | After all views and stores are committed |
| Phase 5: Trim | `ref:template-trim` | After Trim Report is complete |
| Phase 6: Validate | `ref:template-validate` | After Validation Report is complete |

Phase 2 (Receive Build Specification) and Phase 7 (Hard Gate) have no sub-skill: they are governed by this orchestrator directly.

### Context Resumption Protocol

When starting a fresh session mid-pipeline (due to context exhaustion or session break):

1. **Read this orchestrator** to recover the phase flow and architecture invariants
2. **Read `CODEMAP.md`** to recover the project structure
3. **Read ONLY the skill file for the current phase**: do not re-read completed phase skills
4. **Read committed outputs from prior phases** as the contract for the current phase:
   - Resuming Phase 4a: read the Build Specification and Feature Plan
   - Resuming Phase 4b: re-read `ref:template-scaffold-feature` AND the typed client reference (`apps/web*/src/lib/encore-client.ts`) AND the Encore endpoint signatures (source of truth for store methods)
   - Resuming Phase 5: read the REMOVE list from Phase 1
   - Resuming Phase 6: no prior artifacts needed: run all checks fresh

Do NOT re-read completed phase skills. Their outputs (committed code, configuration files, reports) are the contract: the skill instructions that produced them are no longer needed.

---

## Workflow: Template Transformation

### Variant Selection

Before any work begins, determine the variant. When invoked from the factory pipeline, the variant is provided in the factory's **Build Specification** (`variant` field). When invoked standalone (without the factory), derive it from `sitemap.json` as described below.

| Condition | Variant | Auth |
|-----------|---------|------|
| `public-site` surface only | **public** | rauthy + Mock (AUTH_DRIVER=rauthy) |
| `staff-portal` surface only | **internal** | rauthy + Mock (AUTH_DRIVER=rauthy) |
| Both surfaces present | **dual** | Two independent Encore apps: public (AUTH_DRIVER=rauthy) + internal (AUTH_DRIVER=rauthy) |


Auth is stateless RS256 JWT with DB-backed refresh tokens in all variants: there is no session store to select.

**Standalone variant derivation from `sitemap.json`**: The factory sitemap uses `areas[].viewType` values to determine logical surfaces. Map viewTypes to surfaces as follows:

| `areas[].viewType` | Logical Surface | Stack |
|---|---|---|
| `public` | `public-site` | external user/unauthenticated |
| `public-authenticated` | `public-site` | external user-authenticated (rauthy OIDC) |
| `private-authenticated` | `staff-portal` | staff user (rauthy OIDC) |

If only `public-site` areas are present: **public** variant. If only `staff-portal`: **internal** variant. If both: **dual** variant.

The variant parameter flows into every sub-skill below.

> **Dual variant reminder**: Dual is two independent Encore apps: not one Encore app with two audiences. Each app has its own Gateway + authHandler, its own AUTH_DRIVER, its own secrets, and its own deploy lifecycle. Cross-stack data flow (public app fetching from the private backend) uses the BFF `/api/v1/data/*` gateway proxy in the public app, authenticated with S2S OAuth client credentials. See Architecture Invariant #14.

### Phases

Work through these phases in order. Each phase has a dedicated sub-skill. Do not skip phases: each informs the next.

#### Phase 1: Study the Template

**Skill**: `ref:template-analyze`

Understand what the template provides before making changes. Produces a structured inventory: active apps, installed modules, placeholders, endpoints, views, and modules to remove for this variant.

**Output**: Underdrawing Summary (inventory of current state)

---

#### Phase 2: Receive Build Specification

**No sub-skill**: the factory pipeline provides the build instructions.

When invoked from the factory pipeline (stages 4-5), the factory produces a **Build Specification**: a structured contract that tells this template orchestrator exactly what to build. The factory defines WHAT; this orchestrator defines HOW.

**Primary input: Factory Build Specification:**

| Build Specification | Factory Stage | What It Provides |
|---|---|---|
| API Build Specification | Stage 4 | `variant`, `securityMethod`, `templateOverrides`, `endpoints[]` (method, path, resource, operation, schemas, business rules, test cases), `dataModel` (DDL + JSON Schema paths, entity names), `standards` references |
| UI Build Specification | Stage 5 | `variant`, `pages[]` (pageId, title, slug, pageType, viewType, areaId, audiences, keyContent, apiEndpoints, linked use cases), `testCases[]`, `apiSpec` path, `standards` references |

**Canonical file paths (where to find the Build Specifications on disk):**

| Build Specification | Single-stack (`public` / `internal`) | Dual-stack |
|---|---|---|
| API Build Specification | `{project-root}/apps/api/api-build-spec.json` | `{project-root}/apps/api-public/api-build-spec.json` AND `{project-root}/apps/api-internal/api-build-spec.json` |
| UI Build Specification | Not materialized as a single file in template-mode: the factory passes the UI page list in the stage invocation prompt. Fall back to `{project-root}/content-specs/*.json` (one file per page) if present. | Same: passed in-prompt; per-stack `content-specs/` if materialized |

The API Build Specification is conformant to the schema `https://factory.local/factory/api-build-spec.schema.json` (`Factory Agent/Orchestrator/schemas/api-build-spec.schema.json` in the factory repo). The factory's `fac_s4_runner.py` validates against this file post-stage; if it is missing or malformed, FAC-S4-COV-007 fails.

The Build Specification is the **authoritative list** of what to build. Do NOT independently re-derive endpoints from sitemap.json or content-spec files: the factory has already performed that derivation.

**Supplementary artifacts: read for implementation context:**

| Artifact | Factory Stage | Purpose |
|----------|--------------|---------|
| `service-description.json` | Stage 2 | App identity, package naming (for Phase 3 configuration) |
| `audience-identification.json` | Stage 2 | External user vs staff audience mapping (for auth driver selection) |
| `integration_points_register.md` | Stage 2 | BFF gateway decision (keep or remove the `gateway` service) |
| `ddl_script.sql` + `json_schema.json` | Stage 3 | Database tables and entity definitions: owned by factory orchestration |
| `business_requirements_document.md` | Stage 1 | UC-nnn use cases, BR-nnn rules (for understanding business logic context) |
| `test_specifications.md` | Stage 1 | TC-nnn test cases (for understanding test intent beyond what the Build Specification lists) |

**Standalone mode** (without factory pipeline): If no Build Specification is available, fall back to reading `sitemap.json`, `future-state.json`, and other stage 1-3 artifacts directly to derive the feature list. This is the legacy path: the factory pipeline is the preferred invocation method.

**Map Build Specification + supplementary artifacts to template actions:**
- **CONFIGURE**: App identity, env vars, auth driver, CORS/CSP (from Build Specification `variant` + `securityMethod` + supplementary `service-description.json`)
- **KEEP**: Template parts that serve the application as-is
- **ADD**: New features from Build Specification `endpoints[]` and `pages[]`
- **MODIFY**: Existing template parts that need logic changes
- **REMOVE**: Template parts not needed for this variant/application

---

#### Phase 3: Configure

**Skill**: `ref:template-configure`

Apply identity and configuration: package names, environment variables, auth driver credentials, CORS/CSP. This makes the template yours before any feature work begins. There is no session store to configure; auth is stateless JWT issued by the Encore `auth` service.

**Internal/dual variants**: this phase also configures the layout shell for internal web apps (Step 6c). The authenticated layout uses a **PrimeVue sidebar** (`AppLayout.vue` with a custom `<aside>` using PrimeVue `Avatar` and `Badge`): the sidebar IS the chrome, providing the brand logo, user identity, and navigation in a flex row layout. For **dual** variants, `apps/web-internal/` already ships with a **starter sidebar shell**. **Do not skip Step 6c because the shell exists**: it still requires validation and customization. Verify `.app-layout` uses flex row, confirm the sidebar brand name and nav items match the project, and ensure no public-layout header is present. For **internal** variants (single-stack targeting staff), `apps/web/` starts with the public top-header layout and must be swapped to the sidebar pattern. Either way, Step 6c must complete here: before feature scaffolding: so that every view built in Phase 4b sits inside the correct, fully-configured layout container.

**Must complete before Phases 4-5.**

---

#### Phase 4a: Plan and Build API

> **Context note**: API implementation is one of the two largest jobs in this pipeline: context loss mid-phase is expected on complex applications. Complete all API work (Phase 4a) fully before starting UI work (Phase 4b). If context is running low, commit what is done and continue in a fresh session before moving to Phase 4b.

**Step 0: Pre-plan the full feature set (do this once, before writing any code)**

> **Mandatory pre-read: Code Quality Rules**: Before writing any code, load `ref:template-code-quality` AND open `eslint.config.mjs` at the project root. The skill summarizes the rules that most frequently break AI-generated code; the live config is the authoritative source. If any rule in the config contradicts the skill, the config wins.

Do not build features JIT (one at a time without a plan). JIT building causes the AI to duplicate shared types, generate inconsistent endpoint naming, and rebuild similar query logic independently across features: all of which were observed problems before this pre-planning step was introduced.

**Read the factory's API Build Specification.** When invoked from the factory pipeline, the Build Specification's `endpoints[]` array is the authoritative endpoint list. The factory has already performed `pageType` → endpoint derivation, deduplication, and UC-nnn/BR-nnn mapping. Do NOT re-derive endpoints from sitemap.json or content-spec files.

**Standalone fallback:** If no Build Specification is available (standalone invocation without the factory), fall back to reading content-spec files (`client-interface/content-specs/*.json`) or `sitemap.json` and deriving endpoints manually.

Convert the Build Specification endpoints into a **Feature Plan**: a consolidated table grouped by resource (multiple pages may call the same endpoint):

| # | Feature name | Encore endpoints | Pages that call it | Shared types | Linked IDs |
|---|-------------|-----------------|-------------------|--------------|------------|
| 1 | applications-list | `GET /api/v1/applications` | Dashboard, List | `ApplicationSummaryDto` | UC-003, BR-007 |
| 2 | application-detail | `GET /api/v1/applications/:id` | Detail | `ApplicationDetailDto` | UC-004 |

To build this table from the Build Specification: group `endpoints[]` by `resource`, use `sourcePageId` to populate the "Pages that call it" column, use `requestSchema`/`responseSchema` to identify shared types, and carry `linkedUseCases` + `businessRules` into the "Linked IDs" column. These IDs flow into test annotations and the traceability report: do not discard them.

From the Feature Plan, identify before coding:
- **Shared types** used by more than one feature: define these first (use `endpoints[].requestSchema`/`responseSchema` from the Build Specification)
- **Service groupings**: which endpoint functions belong in the same Encore service
- **Service boundaries**: one Encore service per resource group; only endpoints the frontend actually needs

**Service scope rule**: Encore service files contain the business logic and SQL queries for their resource domain. Endpoints are typed `api()` declarations; they validate input via typed request interfaces, call model/query functions, and return typed responses. Only build endpoints for resources that frontend pages actually call: do not generate full CRUD for every database entity. If a page doesn't call it, don't build it.

> **Dual variant: multi-role access pattern detection (AUTH-007)**: After building the Feature Plan table, examine each `api-internal` Encore service's "Pages that call it" column. If a single endpoint is consumed by pages with different `viewType` values: some `private-authenticated` (staff via `web-internal`) and some `public-authenticated` or `public` (external users via BFF proxy from the public app): that endpoint requires all three of the following applied together:
> 1. `auth: true` on the Encore `api()` declaration so the authHandler validates the incoming request
> 2. All required roles in the `requireRole(getAuthData()!, [...])` call: both staff and external user roles
> 3. Role-scoped data filtering in the SQL query (a WHERE clause keyed to `getAuthData()!.roles`) in the service layer
>
> Applying only items 1 or 2 without item 3 removes the 403 but returns unscoped data to external user callers: every `assessed-person` sees all companies, every `tax-agent` sees all applications. Flag any such endpoint in the Feature Plan before writing any code.
>
> **AUTH-007 role-scoped data**: this is the invariant: an endpoint serving both staff and external user callers scopes its SQL query to the caller's roles. The pattern:
> ```typescript
> export const listCases = api(
>   { expose: true, auth: true, method: "GET", path: "/api/v1/cases" },
>   async (): Promise<{ cases: Case[] }> => {
>     const auth = getAuthData()!
>     requireRole(auth, ["case-worker", "external", "admin"])  // any-of
>     const rows = await db.query`
>       SELECT * FROM cases
>       WHERE owner_roles && ${auth.roles}::text[]  -- service-layer scoping
>     `
>     return { cases: rows.rows }
>   },
> )
> ```
> The WHERE clause is the enforcement mechanism: not middleware, not a wrapper function. Every feature with mixed-audience access MUST implement this pattern.

---

**Step 1: Execute the Feature Plan (API only)**

**Skill**: `ref:template-scaffold-feature`: invoke **Section A and Section F1/F2 only**; skip Sections B/C/D (those are UI work for Phase 4b)

For each API feature in the Feature Plan, in order:

1. Create the Encore service directory if it does not exist:
   - `apps/api/<service>/encore.service.ts` (declares `Service(name, { middlewares: [...] })`)
   - `apps/api/<service>/types.ts` (request/response interfaces)
   - `apps/api/<service>/model.ts` (SQLDatabase query functions)
   - `apps/api/<service>/<name>.ts` (typed `api()` endpoint declarations)
2. Add migration files to `apps/api/db/migrations/` if the feature introduces new tables
3. Write and run service unit tests: fix until green
4. Run `encore check` to validate the backend application graph
5. Update the typed client reference (`apps/web*/src/lib/encore-client.ts`) if endpoint signatures changed

**ID-forwarding**: for each feature, use the Linked IDs from the Feature Plan:
- Read `linkedUseCases` (UC-nnn) to understand the business context before implementing: look up the UC in `business_requirements_document.md` if the Build Specification's `businessRules` field doesn't provide enough detail
- Read `businessRules` (BR-nnn) to implement validation logic and constraints in the endpoint/model layer
- Annotate every test with the TC-nnn IDs from the Build Specification's linked test cases (e.g., `// TC-001: verify permit creation returns 201`). See `ref:template-scaffold-feature` Section F for the annotation pattern

For each MODIFY item: update existing unit tests to reflect the change, or add new tests if none exist.

**Test-alongside mandate**: tests are not an afterthought. Each step is blocked until its test passes:
- An Encore service endpoint is not complete until `vitest` passes for that service
- Do not batch all tests at the end: run after each endpoint
- `encore check` MUST pass after every new service or endpoint; it validates the entire backend graph/topology/types

**Fail loop**: if a test or `encore check` fails:
1. Read the full failure output
2. Determine: is the **code wrong** or the **test expectation wrong**?
3. Fix the identified side, re-run
4. Repeat until green: never skip or delete a failing test
5. Only then proceed to the next feature

**Pre-read: DDL migration files (internal/dual only)**: Before writing any service SQL, read all files in `apps/api/db/migrations/` to understand exact table names, column names, and constraints. `1_extensions.up.sql` is template infrastructure (Postgres extensions); `2_user_account.up.sql`, `3_refresh_token.up.sql`, and `4_audit_log.up.sql` are the auth tables. Application-specific migrations are produced by the factory (Stage 3) and placed in the migrations directory (Stage 4 Step 1b). Read them for implementation context: do not design application DDL independently.

**Execution order**: shared types → Encore service directories (endpoints + model + migrations) → unit tests → `encore check` → typed client update

**Phase 4a checkpoint**: before moving to Phase 4b:
```bash
encore check          # backend graph + topology + types: zero errors
npm run test:api      # all Encore service unit tests pass
```
All endpoints declared in `api()`. All migrations in place. `encore check` exits 0. Only proceed to Phase 4b when both commands succeed.

---

#### Phase 4b: Build UI

> **Context note**: UI implementation is the second of the two largest jobs. If context is running low after Phase 4a, start a fresh session here: read the Encore endpoint type signatures before building any store or view.

**Skill**: `ref:template-scaffold-feature`: invoke **Sections B/C/D and Section F3/F4 only**; skip Section A (API work is complete)

> **Mandatory pre-read: Code Quality Rules**: If this is a fresh session (context was reset between Phase 4a and 4b), re-load `ref:template-code-quality` AND open `eslint.config.mjs` before writing any Vue or TypeScript code.

> **Prerequisite 1**: Internal/dual variants must have completed configure Step 6c (layout shell configuration) before building any views. If the layout shell is not yet configured for the correct variant, stop and run Step 6c first: views built inside the wrong layout container will need to be reworked.

> **Prerequisite 2: Read Encore endpoint signatures before building any store (Architecture Invariant #18)**: Before creating Pinia stores, **open every Encore service file** created in Phase 4a and list the exact HTTP methods, paths, and typed request/response interfaces each endpoint declares. Store methods MUST correspond 1:1 to declared Encore endpoints. Do NOT generate "standard CRUD" store methods by assumption: if there is no `DELETE` endpoint, the store must not have a `delete`/`remove` method. If the endpoint takes no path parameter, the store must not append `/${id}` to the URL. The Encore service file is the source of truth for what the store can call. See `ref:template-scaffold-feature` Section B2 for the detailed procedure.

> **Page type specs differ by surface**: Public-facing pages use the standard `ci-page-*` skills. Internal/authenticated pages use a different set of specs from `.factory/Client_Interface/page-types/authenticated/`: these use the PrimeVue sidebar layout, PrimeVue form components, filter panels, and different component conventions. See `ref:template-scaffold-feature` Section B1 for the complete mapping table by variant.

> **Design system routing rule**: For each page, the `viewType` field determines which page-type skills and component conventions to use:
>
> | `viewType` | Page-Type Skills | Layout Shell | Target App (dual) |
> |---|---|---|---|
> | `public` | `ref:ci-page-*` skills (public folder) | `AppHeader` (PrimeVue Menubar/Avatar) + full-width | `apps/web-public/` |
> | `public-authenticated` | `ref:ci-page-*` skills (public folder) | `AppHeader` (PrimeVue Menubar/Avatar) + full-width | `apps/web-public/` |
> | `private-authenticated` | `.factory/Client_Interface/page-types/authenticated/` specs | PrimeVue sidebar `AppLayout` + card container | `apps/web-internal/` |
>
> For single-variant projects (public or internal), all pages target `apps/web/`. For dual, public/public-authenticated pages target `apps/web-public/`, private-authenticated pages target `apps/web-internal/`.

For each page in the factory's **UI Build Specification** `pages[]` array (or `sitemap.json` in standalone mode), in order:

1. Create Vue store (if shared state is needed): **write and run store test**: fix until green
2. Create Vue view: **write and run component test**: fix until green
3. Register view route in `router/index.ts`
4. Add navigation item (if the page appears in the nav)

**ID-forwarding**: for each page, use the IDs from the UI Build Specification:
- Read `linkedUseCases` (UC-nnn) to understand which use case flows this page serves
- Annotate Vue store and component tests with TC-nnn IDs from the Build Specification's `testCases[]` array, filtered by `linkedPageId` matching this page (e.g., `// TC-012: verify dashboard shows permit count`). See `ref:template-scaffold-feature` Section F for the annotation pattern
- For E2E tests (multi-page flows), annotate with the UC-nnn the flow implements (e.g., `// UC-003: external user submits permit application`)

For each MODIFY item: update existing tests or add new ones.

**Test-alongside mandate**: same rule as Phase 4a:
- A Vue store action is not complete until `npm test -w apps/{web-stack}` passes
- Do not batch all tests at the end

**Fail loop**: same rule as Phase 4a.

**Execution order**: Vue stores (+ tests) → Vue views (+ tests) → router registrations → nav items

---

#### Phase 5: Trim Unused Elements

**Skill**: `ref:template-trim`

Remove everything from the REMOVE list. Applies variant-driven removals automatically (e.g., a variant that only uses the mock driver in development removes unused rauthy OIDC configuration).

Clean removal = files deleted + imports removed + registrations removed + docs updated.

---

#### Phase 6: Validate

**Skill**: `ref:template-validate`

Run all validation checks in order: install → package build → TypeScript → ESLint → Prettier → `encore check` → app build → unit tests → orphan detection → env coverage → architecture invariants → endpoint alignment → variant-specific checks.

**encore check gate (Check 7a)**: Run `encore check` from `apps/api`. Zero errors and zero warnings required. This validates the backend application graph, service topology, and all typed endpoint interfaces. If this fails, the API is not deployable.

**Unit test gate (Check 7b)**: Run `npm test --workspaces --if-present`. If any test fails, apply the fail loop (read failure → fix code or test → re-run) until exit code is 0. Additionally verify business logic coverage: every Encore service file must have a sibling `.test.ts`: template infrastructure tests alone do not satisfy this gate.

**Test traceability report (Check 15)**: After all tests pass, produce `test-traceability-report.md` in the project root. This maps requirement IDs to implementation artifacts so the factory can validate coverage (FAC-S4-015, FAC-S5-013). See `ref:template-validate` Check 15 for the required format.

**Do not proceed** to Phase 7 until all checks pass.

This is a prerequisite for: but does not replace: factory validation gates (FAC-S4-*, FAC-S5-*).

---

#### Phase 7: Post-Completion Hard Gate (MANDATORY: do not skip)

This phase runs **after** Phase 6 (Validate) passes and is the final quality gate before the template is considered complete. It catches issues that individual feature-level checks might miss when viewed in aggregate.

**Step 1: Full typecheck (zero tolerance):**
```bash
npm run build:packages
npm run typecheck --workspaces --if-present
encore check   # from apps/api
```
**Gate**: Exit code MUST be 0 with zero TypeScript errors and zero `encore check` errors. If any workspace or the backend graph fails, fix the error and re-run. Do NOT proceed with errors: they indicate broken imports, mismatched interfaces, or invalid service wiring that will cause runtime failures.

**Step 2: Full lint (zero tolerance):**
```bash
npm run lint -- --max-warnings 0
```
**Gate**: Exit code MUST be 0 with zero warnings and zero errors. Common failures:
- `no-floating-promises`: add `await` or `.catch()`
- `no-unused-vars`: remove dead imports or prefix with `_`
- `no-non-null-assertion`: add proper null checks

Auto-fix available: `npm run lint:fix`: but review changes before committing.

**Step 3: Full app build:**
```bash
npm run build:packages && npm run build:apps
```
**Gate**: All frontend apps produce `dist/` directories with zero errors (Vite build). The Encore backend builds via `encore build docker`: this is the production build path and is validated separately in CI.

**Step 4: Full test suite:**
```bash
npm test --workspaces --if-present
```
**Gate**: Zero test failures. If any test fails, apply the fail loop from Phase 6 Check 7b.

**Step 5: Service implementation audit (no placeholders):**

Search all Encore service files for placeholder patterns:
```bash
grep -rn "MOCK_\|TODO\|PLACEHOLDER\|placeholder\|mockData\|mock_data\|hardcoded" apps/api/*/  --include="*.ts" | grep -v ".test.ts" | grep -v "node_modules"
```

**Gate**: No matches in non-test Encore service files. If matches found:
- `MOCK_` arrays → Replace with real SQLDatabase queries (`db.query\`...\``)
- `TODO`/`PLACEHOLDER` comments → Implement the real logic
- Mock return values → Replace with actual database reads

**Step 6: Template variable preservation check:**
```bash
grep -c "{{" apps/api/.env.example 2>/dev/null
```
Compare against the original template. If any `{{PLACEHOLDER}}` patterns were removed or renamed from `.example` files, restore them.

**Completion report:**
```
POST-COMPLETION VERIFICATION
=============================
Step 1  TypeScript + encore check (zero errors)  [ PASS / FAIL ]
Step 2  ESLint (zero warnings)                   [ PASS / FAIL ]
Step 3  App Build (all frontend apps)            [ PASS / FAIL ]
Step 4  Test Suite (zero failures)               [ PASS / FAIL ]
Step 5  No Placeholder Services                  [ PASS / FAIL ]
Step 6  Template Variables Preserved             [ PASS / FAIL ]

Overall: PASS / FAIL
```

**ALL steps must PASS before the template transformation is considered complete.** If any step fails, fix the issue and re-run from that step. Do not mark the pipeline as done with any FAIL.

---

### Sub-Skill Quick Reference

| Skill | ID | Purpose | When to Use Independently |
|-------|----|---------|---------------------------|
| Analyze | `ref:template-analyze` | Inventory the template for a variant | Understanding current state |
| Configure | `ref:template-configure` | Apply identity, env vars, auth config | Setting up a new project |
| Scaffold Feature | `ref:template-scaffold-feature` | Build one new feature | Adding any Encore endpoint or Vue view |
| Trim | `ref:template-trim` | Remove unused elements | Cleaning up after variant selection |
| Validate | `ref:template-validate` | Quality check | Any time you want verification |
| Code Quality | `ref:template-code-quality` | ESLint & TypeScript rules for AI code generation | Before writing any code in Phase 4a/4b |

Each sub-skill accepts a **variant parameter** (`public`, `internal`, or `dual`) and adjusts its behavior accordingly: one skill handles all three scenarios.

---

## Table of Contents: Reference Sections

1. [Template Variants](#1-template-variants)
2. [Project Structure](#2-project-structure)
3. [Tech Stack (Mandatory)](#3-tech-stack-mandatory)
4. [Architecture Invariants](#4-architecture-invariants)
5. [Module System](#5-module-system)
6. [Service Composition Pattern](#6-service-composition-pattern)
7. [Implementation Patterns: API (Backend)](#7-implementation-patterns--api-backend)
8. [Implementation Patterns: Web (Frontend)](#8-implementation-patterns--web-frontend)
9. [Implementation Patterns: Shared Packages](#9-implementation-patterns--shared-packages)
10. [Configuration Reference](#10-configuration-reference)
11. [Authentication Architecture](#11-authentication-architecture)
12. [Auth is Stateless JWT: Redis is Rate-Limit Only](#12-auth-is-stateless-jwt--redis-is-rate-limit-only)
13. [API Gateway (BFF Pattern)](#13-api-gateway-bff-pattern)
14. [Adding a Feature: Complete Walkthrough](#14-adding-a-feature--complete-walkthrough)
15. [Removing Template Elements](#15-removing-template-elements)
16. [Validation Checklist (Template-Specific)](#16-validation-checklist-template-specific)
17. [Integration with Factory Pipeline](#17-integration-with-factory-pipeline)

---

## 1. Template Variants

The template supports three deployment configurations. The codebase is the same base Encore app: the variant determines which auth driver is active and, for dual, whether two independent apps are generated.

| Variant | Apps | Auth Driver | Use Case |
|---------|------|-------------|----------|
| **Public** | `apps/api` + `apps/web` | AUTH_DRIVER=rauthy (+ mock dev) | External user-facing BFF. Data proxied from private backend via the `gateway` service. |
| **Internal** | `apps/api` + `apps/web` | AUTH_DRIVER=rauthy (+ mock dev) | Staff-facing. Owns the SQLDatabase directly. |
| **Dual** | Two independent Encore apps: `<dest>/public` + `<dest>/internal` | public=rauthy, internal=rauthy | Both external user and staff stacks. Each is a complete standalone Encore app. |

Auth is stateless RS256 JWT in all three variants. There is no session store. Redis, when present, is rate-limit backing only (set via `REDIS_URL`).

**Stack selection** is determined by the factory's Build Specification `variant` field (or derived from `sitemap.json` `areas[].viewType` in standalone mode):
- `public-site` logical surface present (viewType `public` or `public-authenticated`) → public stack needed
- `staff-portal` logical surface present (viewType `private-authenticated`) → internal stack needed
- Both logical surfaces → dual stack
- Only one logical surface → remove or omit the unused stack entirely

---

## 2. Project Structure

### Single-Stack Layout (Public or Internal)

```
{project-root}/
├── apps/
│   ├── api/                         Encore.ts application (standalone)
│   │   ├── encore.app               App manifest (global_cors, build.docker.bundle_source)
│   │   ├── infra.config.json        Secret + SQL bindings ($env refs); no secret values
│   │   ├── package.json             Standalone package (excluded from npm workspaces)
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── Dockerfile.base          OS + helper binaries base image
│   │   ├── scripts/                 generate-keys.ts, migrate.mjs, docker-build.sh
│   │   │
│   │   ├── lib/                     ← `lib` service: shared security primitives (no endpoints)
│   │   │   ├── encore.service.ts    Service("lib"): no middlewares (security-headers used by others)
│   │   │   ├── jwt.ts               signAccessToken, signRefreshToken, verifyAccessToken (RS256)
│   │   │   ├── roles.ts             hasRole, requireRole (any-of, not a hierarchy)
│   │   │   ├── csrf.ts              csrfMiddleware (double-submit)
│   │   │   ├── cookies.ts           cookie helpers
│   │   │   ├── audit.ts             audit_log writer
│   │   │   ├── logger.ts            PII-redacting logger (CC-006)
│   │   │   ├── rate-limit.ts        apiRateLimit middleware (Redis-backed if REDIS_URL set)
│   │   │   ├── security-headers.ts  securityHeaders middleware (CSP, HSTS, Permissions-Policy)
│   │   │   └── secrets.ts           secret() declarations for JWT keys + app secrets
│   │   │
│   │   ├── db/                      ← `db` service: SQLDatabase("app") + migrations (no endpoints)
│   │   │   ├── encore.service.ts    Service("db")
│   │   │   ├── db.ts                const db = new SQLDatabase("app", { migrations: "./migrations" })
│   │   │   └── migrations/
│   │   │       ├── 1_extensions.up.sql
│   │   │       ├── 2_user_account.up.sql
│   │   │       ├── 3_refresh_token.up.sql
│   │   │       └── 4_audit_log.up.sql
│   │   │
│   │   ├── health/                  ← `health` service: probes + /api/v1/info + /api/v1/csp-report
│   │   │   ├── encore.service.ts    Service("health", { middlewares: [securityHeaders] })
│   │   │   └── api.ts               health/liveness/readiness + info + csp-report endpoints
│   │   │
│   │   ├── auth/                    ← `auth` service: authHandler + Gateway, multi-driver SSO, JWT
│   │   │   ├── encore.service.ts    Service("auth", { middlewares: [securityHeaders, csrfMiddleware, apiRateLimit] })
│   │   │   ├── handler.ts           authHandler + Gateway({ authHandler }): validates access-token cookie
│   │   │   ├── drivers.ts           driver discovery + default login + /api/v1/auth/status
│   │   │   ├── mock.ts              mock driver (instant login, ?user=0|1|2)
│   │   │   ├── rauthy.ts            rauthy OIDC driver (redirect + callback)
│   │   │   ├── me.ts                GET /api/v1/auth/me (auth:true) → MeResponse
│   │   │   ├── refresh.ts           POST /api/v1/auth/refresh (rotate refresh token)
│   │   │   ├── logout.ts            POST /api/v1/auth/logout (auth:true, revoke + clear)
│   │   │   ├── csrf-token.ts        GET /api/v1/auth/csrf-token → { token }
│   │   │   ├── user-model.ts        user_account DB queries
│   │   │   └── refresh-token-model.ts refresh_token DB queries (hash-only)
│   │   │
│   │   ├── gateway/                 ← `gateway` service: BFF api.raw proxy /api/v1/data/*
│   │   │   ├── encore.service.ts    Service("gateway", { middlewares: [securityHeaders, apiRateLimit] })
│   │   │   ├── proxy.ts             api.raw GET/POST/PUT/PATCH/DELETE /api/v1/data/*path (auth:true)
│   │   │   └── token-cache.ts       S2S OAuth client-credentials (cached, deduped)
│   │   │
│   │   └── web/                     ← `web` service: api.static serving the built SPA
│   │       ├── encore.service.ts    Service("web"): no middleware
│   │       └── static.ts            api.static({ dir: "./build", notFound: ... })
│   │
│   └── web/                         Vue 3 SPA (PrimeVue + Aura preset)
│       ├── package.json
│       ├── index.html
│       ├── vite.config.ts           proxy /api → http://localhost:4000
│       ├── vitest.config.ts
│       ├── tsconfig.json
│       └── src/
│           ├── main.ts              ← ENTRY POINT (PrimeVue + Aura preset registered here)
│           ├── App.vue              Root component
│           ├── router/
│           │   └── index.ts         Routes + nav guards
│           ├── stores/
│           │   └── auth.store.ts    Pinia auth state + CSRF interceptor
│           ├── lib/
│           │   └── encore-client.ts Typed client reference (committed; born-with template-encore)
│           ├── views/
│           │   ├── HomeView.vue
│           │   ├── AboutView.vue
│           │   ├── LoginView.vue
│           │   ├── ProfileView.vue
│           │   └── NotFoundView.vue
│           ├── components/
│           │   └── layout/          AppLayout, AppHeader (PrimeVue Menubar/Avatar/Menu), AppFooter
│           ├── composables/
│           │   └── useNavigation.ts Navigation item registry
│           └── assets/styles/
│               └── main.css
│
├── packages/                        Reusable libraries (NOT imported by apps/api)
│   └── shared/                      Types, Zod schemas, constants (used by the SPAs)
│
├── modules/                         Installable module definitions (manifest v2)
│   ├── security-core/               Declarative overlay: CORS env + global_cors note
│   ├── api-gateway/                 Declarative overlay: GATEWAY_OAUTH_* secrets + connectivity test view
│   ├── data-postgres/               Declarative overlay: documents base SQLDatabase; no pg.Pool files
│   ├── data-redis/                  Declarative overlay: REDIS_* envVars for rate-limit backing
│   └── user-management/             Reference feature module: full Encore service directory
│
├── docker/                          Encore self-host docker-compose + container guide (README)
├── docs/                            AUTH-SETUP, DEPLOYMENT, DEVELOPMENT, etc.
├── e2e/                             Playwright E2E tests
├── .github/workflows/               CI/CD
├── apps/api/.env.example            Encore backend dev config template
├── CODEMAP.md                       Architecture blueprint (read first)
├── package.json                     Monorepo root (npm workspaces; apps/api excluded)
├── eslint.config.mjs                Flat ESLint config
└── .prettierrc.json                 Prettier config
```

### Dual-Stack Layout

In dual-stack mode, the generator (`scripts/setup-dual-app.ts`) creates **two independent Encore apps** at the destination:
- `<dest>/public/`: complete Encore app, AUTH_DRIVER=rauthy, `web` service serves `apps/web`
- `<dest>/internal/`: complete Encore app, AUTH_DRIVER=rauthy, `web` service serves `apps/web-internal`

Each app is a full copy of the `apps/api` skeleton with its own `encore.app`, `infra.config.json`, Gateway, authHandler, secrets, and independent deploy lifecycle. They do NOT share a monorepo: they are separate deployable units.

### Dependency Flow

```
packages (shared SPA dependencies) ══════════════════════════
  shared ─── used by apps/web + apps/web-internal stores/views

Encore backend (self-contained) ════════════════════════════
  apps/api: imports nothing from packages/*
  lib ── used by db, health, auth, gateway, web (intra-app only)
  db  ── used by auth, user-management (and any feature service)

Build order: shared → config → auth → web + web-internal (parallel)
             apps/api: encore build docker (independent)
```

### Key File Roles

| File | Role | Editable? |
|------|------|-----------|
| `apps/api/encore.app` | Encore app manifest (global_cors, bundle_source) | Yes: add CORS entries |
| `apps/api/infra.config.json` | Secret + SQL bindings for local dev | Yes: add secrets for new drivers |
| `apps/api/auth/handler.ts` | authHandler + Gateway declaration | Yes: only to extend AuthData |
| `apps/api/lib/secrets.ts` | `secret()` declarations | Yes: add secrets for new services |
| `apps/web/src/router/index.ts` | Vue Router config + auth guards | Yes: add routes |
| `apps/web/src/composables/useNavigation.ts` | Navigation item registry | Yes: add nav items |
| `CODEMAP.md` | Architecture blueprint | Update when structure changes |

There is no `modules.ts` or `app.ts` in the Encore backend. New services are discovered automatically from the filesystem when a directory contains `encore.service.ts`.

---

## 3. Tech Stack (Mandatory)

All code added to this template **must** use these technologies. Do not introduce alternatives.

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Language** | TypeScript (strict) | All application/library/test code in TS. JS allowed only for config/build tooling. |
| **Frontend** | Vue 3 (Composition API + `<script setup>`) | Single-file components only. Two SPAs: `web` (public), `web-internal` (staff). |
| **State** | Pinia | Stores in `apps/web*/src/stores/`. No Vuex. |
| **Routing** | Vue Router 4 | Lazy-load views: `() => import('./views/X.vue')` |
| **Styling** | PrimeVue | `primevue` + `@primevue/themes` (Aura preset, indigo primary) + `primeicons`. No Tailwind. |
| **Backend** | **Encore.ts** | Typed `api()` / `api.raw()` endpoints; services discovered from `encore.service.ts`; `authHandler` + `Gateway`; per-service `middlewares` arrays. Replaces Express 5. |
| **Auth** | **Stateless RS256 JWT** | Access (~15 min) + DB-backed refresh (~7 day, rotation/revocation) in httpOnly cookies; CSRF double-submit. Multi-driver: mock/rauthy, selected by AUTH_DRIVER env. Not `express-session`. |
| **Validation** | Zod (SPA/packages); Encore typed request interfaces (API) | No Joi, Yup, or class-validator in the backend. |
| **Persistence** | **Postgres via Encore `SQLDatabase("app")`** | `user_account`, `refresh_token`, `audit_log`. Tagged-template (auto-parameterized) queries only. |
| **Build** | Vite (frontend); `encore build docker` (backend) | Backend image: `Dockerfile.base` + `encore build docker --base`. |
| **Testing** | Vitest (unit), Playwright (E2E) | `encore check` validates the backend graph/topology/types. |
| **Linting** | ESLint 9 + Prettier | Flat config format. |
| **Runtime** | Node >= 24.0.0, npm >= 10.0.0 | See `.nvmrc` |

**Do NOT introduce**: Express/`express-session` (retired), Vuex, ORMs (Prisma/TypeORM/Sequelize/Drizzle), Webpack, Joi/Yup/class-validator, CSS-in-JS, Redux-style patterns, Tailwind CSS, string-concatenated SQL, `pg.Pool` (use `SQLDatabase` tagged templates), Redis session stores.

Redis is **rate-limit backing only**: set `REDIS_URL` to enable it; never use it as a session or token store.

---

## 4. Architecture Invariants

These are non-negotiable engineering decisions. Do not change them without explicit user instruction.

1. **Stateless JWT, not sessions**: Auth is RS256 access token (~15 min) plus DB-backed rotating revocable refresh token (~7 day) stored in httpOnly cookies. Frontend reads user via `GET /api/v1/auth/me` (auth:true). No `express-session`, no session ID cookie, no server-side session state.

2. **Multi-driver auth by configuration, not registry**: The two drivers (`mock`, `rauthy`) ship as static files in `apps/api/auth/`. `AUTH_DRIVER` env var selects the default. No `authService.registerDriver()`, no priority sort, no runtime registry. Driver selection is a config line, not a code operation.

3. **Encore service-directory composition**: New backend features are added as self-contained directories under `apps/api/`, each containing `encore.service.ts` + endpoint files + `model.ts` + optional `migrations/`. Encore discovers services at compile time. There is no `app.ts` middleware chain, no `modules.ts` loader, no `registerAllModules(app)` call.

4. **View → Component → Store**: Views are thin. Business state lives in Pinia stores. API calls go through stores, not directly from views.

5. **PrimeVue only**: All UI uses PrimeVue components (Aura preset registered in `main.ts`; per-SFC imports). No third-party design-system components, no Tailwind, no other CSS frameworks.

6. **Zod for SPA/package validation**: Config schemas, input validation, shared types in `packages/shared`. No alternatives. Encore endpoints use typed request interfaces natively; Zod is not applied at the Encore layer.

7. **SQLDatabase tagged-template queries**: All persistence goes through `db.query\`...\`` (auto-parameterized). Never concatenate SQL strings. Never use a `pg.Pool` directly. Encore's `SQLDatabase` owns connection pooling.

8. **No database in the public stack's BFF role**: When deployed as the public-facing app, the `gateway` service proxies `/api/v1/data/*` to the private backend. The `db` service is still present (for `user_account` / `refresh_token` / `audit_log`) but no application domain data is stored.

9. **Packages before apps**: Build order is always `shared → config → auth → web + web-internal`. The Encore app (`apps/api`) builds independently with `encore build docker`.

10. **PII never logged**: `lib/logger.ts` redacts sensitive data automatically (CC-006). `LOG_PII` must be false in production or the app fails fast at startup.

11. **`encore check` is the backend graph gate**: After any change to Encore service files, endpoints, or dependencies, `encore check` MUST be run from `apps/api`. It validates the entire application graph, service topology, secret bindings, and all typed endpoint interfaces. A passing `encore check` is the equivalent of a TypeScript compile check for the backend.

12. **Tests accompany all code changes**: Write or update unit tests whenever an endpoint or service function is built or modified. Run all unit tests and `encore check` after changes. A task is not done until both pass.

13. **Dual variant requires two independent Encore apps**: Public and internal stacks MUST be separate Encore apps with separate `encore.app` manifests, separate Gateway + authHandler instances, separate secrets, and separate deploy lifecycles. This is a security and architectural boundary, not a code organization preference.

    **Required structure (Option A, the default):**
    - `<dest>/public/`: rauthy OIDC auth, `web` service serves `apps/web` (external user SPA), BFF gateway proxies to private backend
    - `<dest>/internal/`: rauthy OIDC auth, `web` service serves `apps/web-internal` (staff SPA), owns the database directly

    **Why physical separation is mandatory:**
    - **Security isolation**: Each app has its own auth driver, its own `authHandler`, its own Gateway. A misconfiguration in one app cannot bleed into the other.
    - **Independent deployment**: Public and internal apps have different scaling needs, uptime SLAs, and deployment cadences.
    - **Auth driver isolation**: The public app's OIDC tokens carry external user identity. The internal app's OIDC tokens carry staff identity. These must never flow through the same authHandler in production.
    - **Trust-zone separation**: The public app is internet-exposed. The internal app is not. They must be independently deployable to separate network zones.

    **What role-based access control IS for (within each app):**
    - Restricting which staff roles can access admin vs read-only views inside the internal Encore app
    - Gating specific external user actions behind verified identity inside the public Encore app
    - RBAC lives inside an app: it does not replace the boundary between apps.

    **What role-based access control is NOT for:**
    - Serving both external users and staff from a single Encore app by checking `getAuthData()!.roles`
    - Using `if (isStaff)` branches in a shared endpoint handler to return different data to different audiences
    - Registering two separate rauthy OIDC clients as concurrent active drivers in a single app for cross-audience use

14. **Dual variant: separate API surfaces and separate S2S identity**: The two Encore apps serve different audiences and have different data ownership:

    - **Public app**: external user-facing endpoints only. Internet-accessible. Authenticated via rauthy OIDC. The `gateway` service proxies `/api/v1/data/*` to the private backend using S2S OAuth client credentials.
    - **Internal app**: staff-facing and internal data endpoints only. Not internet-exposed. Authenticated via rauthy OIDC. Owns the SQLDatabase.

    Cross-stack S2S authentication uses a **separate rauthy OIDC client** (service account, client credentials flow): not the staff SSO client. Configure in `GATEWAY_OAUTH_*` secrets.

15. **Dual-Stack Routing Matrix (CRITICAL: read before writing any dual-variant code)**

    Every connection in a dual-stack deployment follows exactly one of the four paths below.

    ```
    ┌──────────────┐  /api/v1/*   ┌────────────────┐  /api/v1/data/*  ┌─────────────────┐
    │  web (public)│ ──────────►  │  public Encore  │ ───────────────► │ internal Encore  │
    │  :5173       │  Vite proxy  │  app (:4000)    │  gateway proxy   │ app (:4001)       │
    │  (external)  │  → :4000     │  AUTH_DRIVER    │  S2S OAuth       │ (owns database)   │
    │              │              │  =rauthy        │                  │ AUTH_DRIVER        │
    └──────────────┘              └────────────────┘                   │ =rauthy           │
                                                                        └─────────────────┘
                                                                               ▲
    ┌──────────────┐  /api/v1/*                                                │
    │ web-internal │ ──────────────────────────────────────────────────────────┘
    │  :5174       │  Vite proxy → :4001
    │  (staff)     │
    └──────────────┘
    ```

    **The four valid connections:**

    | # | From | To | Mechanism | What happens |
    |---|------|----|-----------|-------------|
    | 1 | `web` (:5173) | public Encore app (:4000) | Vite proxy `/api` → `localhost:4000` | External user browser calls BFF |
    | 2 | public Encore app (:4000) | internal Encore app (:4001) | `gateway/proxy.ts` api.raw catch-all (auth:true) + S2S OAuth | BFF fetches data from internal app |
    | 3 | `web-internal` (:5174) | internal Encore app (:4001) | Vite proxy `/api` → `localhost:4001` | Staff browser calls internal app directly |
    | 4 | internal Encore app (:4001) | PostgreSQL | SQLDatabase tagged-template queries | Internal app owns and queries the database |

    **Forbidden connections (these are bugs):**

    | From | To | Why it's wrong |
    |------|----|---------------|
    | `web` (public SPA) | internal Encore app | External users must never bypass the BFF: no external-user OIDC auth on the internal app |
    | `web-internal` | public Encore app | Staff should not go through the BFF: they have direct rauthy OIDC auth on the internal app |
    | public Encore app | PostgreSQL | Public app does not own a domain database: all data comes via the internal app's BFF proxy |
    | internal Encore app | public Encore app | Internal never calls back to public: data flows one direction only |

    **How the Vite proxy makes this work:**

    Each web app's `vite.config.ts` has a proxy rule that forwards `/api/*` requests to the correct backend:

    ```
    apps/web/vite.config.ts           →  proxy /api → http://localhost:4000  (public Encore app)
    apps/web-internal/vite.config.ts  →  proxy /api → http://localhost:4001  (internal Encore app)
    ```

    Both frontends use **relative axios paths** (`axios.get('/api/v1/applications')`); the Vite proxy routes to the correct app. **Never hardcode `localhost:4000` or `localhost:4001` in Vue code.** Always use relative `/api/v1/*` paths.

    **How the public app fetches data from the internal app:**

    The public app's `gateway/proxy.ts` catches all `auth:true` requests to `/api/v1/data/*path`, obtains an S2S OAuth token via `token-cache.ts`, and proxies the request to the internal app's `PRIVATE_API_BASE_URL`. The public app's Encore service files never query a SQLDatabase for domain data.

    **Verification rule: apply after every feature is scaffolded:**
    - Open each Pinia store file. Confirm axios paths are relative (`/api/v1/*`), not absolute URLs.
    - Open each public-app Encore service file. Confirm it routes domain-data calls through `gateway/proxy.ts`, never via direct SQLDatabase queries.
    - Open each internal-app Encore service file. Confirm it uses `db.query\`...\`` for domain data, never proxies to the public app.
    - Confirm `apps/web/vite.config.ts` proxy target is `:4000` and `apps/web-internal/vite.config.ts` proxy target is `:4001`.

16. **Encore endpoints are the communication layer only: build only what the frontend needs**: Endpoints validate typed input, call model/query functions, and return typed responses. They do not contain business logic or raw SQL. The full set of endpoints is derived from frontend page requirements (what does each page call?), not from the database schema (what CRUD operations exist?). Do not generate full CRUD for every entity. If no frontend page calls an endpoint, do not build it.

17. **No placeholder or mock implementations in production Encore service files**: Every model function must contain real SQLDatabase queries. Every endpoint must call real model functions. The following patterns are **forbidden** in Encore service files:
    - Hardcoded mock data arrays (e.g., `const MOCK_ITEMS = [...]` returned from endpoint functions)
    - `TODO` or `PLACEHOLDER` comments with stub return values
    - Functions that return static objects instead of querying the database

    **Mock data is allowed ONLY in:**
    - Test files (`*.test.ts`)
    - The `auth/mock.ts` driver (which is explicitly a development-only mock)

18. **Store methods must match Encore endpoint declarations exactly (store-endpoint contract)**: Every Pinia store axios call (HTTP method + URL path) MUST correspond to a declared Encore endpoint. Do NOT generate "standard CRUD" store methods by assumption. The Encore service file is the **single source of truth** for what the frontend can call.

    **Rules:**
    - Before creating a store, **open the Encore service file(s)** and list every `api({ method: ..., path: ... })` declaration
    - The store must contain **only** methods that call declared Encore endpoints
    - If there is no `DELETE` endpoint → the store must not have a `delete`/`remove` method
    - If the endpoint path has no `:id` parameter → the store must not append `/${id}` to the URL
    - After creating the store, perform the **store-endpoint cross-reference**: for each store method, confirm the matching Encore endpoint exists

19. **Encore response shapes**: Typed `api()` endpoints return bare typed payloads (e.g., `{ cases: Case[] }`) directly: no `{ success: true, data: ... }` wrapper. `api.raw()` handlers write JSON directly. Errors use Encore's native `{ code, message, details }` shape (sub-codes such as `CSRF_MISSING` or `NOT_FOUND` land at `details.code`). The Express `{ success, data }` / `{ success:false, error }` envelope is retired.

    **Standard Encore error codes:**

    | Situation | Encore `APIError` code | How to throw |
    |-----------|----------------------|--------------|
    | Input validation failed | `invalid_argument` | `throw APIError.invalidArgument('...')` |
    | Not authenticated | `unauthenticated` | `throw APIError.unauthenticated()` |
    | Role missing | `permission_denied` | `throw APIError.permissionDenied()` |
    | Resource not found | `not_found` | `throw APIError.notFound('...')` |
    | Conflict / duplicate | `already_exists` | `throw APIError.alreadyExists('...')` |
    | Unhandled exception | `internal` | `throw APIError.internal(err)` |

20. **Template variables are sacred: do not modify `{{PLACEHOLDER}}` patterns**: Files like `.env.example`, `apps/api/.env.example`, and deployment configs contain `{{PLACEHOLDER}}` template variables. These are filled by infrastructure automation or CI/CD. Never replace, rename, or remove these placeholders during template transformation.

---

## 5. Module System

The template uses an additive module system governed by the manifest v2 contract (spec 001). Modules are self-contained feature bundles with a manifest and optional files.

**Two module shapes exist:**

1. **Feature modules** (e.g., `user-management`): contribute a complete Encore service directory (`services[]`), migrations, frontend views, and `webSnippetFile` nav registration. These are the primary domain extension mechanism.

2. **Declarative overlay modules** (e.g., `security-core`, `api-gateway`, `data-postgres`, `data-redis`): contribute only declarative config (secrets, CORS entries, env vars) and optional frontend payloads. Their backend function is already provided by the base Encore app; the module is the install/remove UX for that configuration.

### Module Structure

```
modules/{module-name}/
├── manifest.json          Module metadata (manifest v2 schema)
├── web.snippet.ts         (optional) nav registration snippet for webSnippetFile
└── files/                 Files to copy into the project
    ├── {service-name}/    Encore service directory (feature modules only)
    │   ├── encore.service.ts
    │   ├── types.ts
    │   ├── model.ts
    │   └── {endpoints}.ts
    ├── db/                Migration files (renumbered on merge)
    │   └── N_name.up.sql
    └── apps/web/src/views/  Frontend views (if module ships UI)
```

### Module Manifest Schema (v2)

```json
{
  "name": "user-management",
  "version": "2.0.0",
  "description": "Application-side user + role management as an Encore service",
  "status": "stable",
  "requires": [],
  "requiresOneOf": [],
  "optionalPeers": [],
  "conflicts": [],
  "services": ["user-management"],
  "migrations": [
    {
      "source": "db/1_user_management.up.sql",
      "description": "app_role catalog + user_role assignments"
    }
  ],
  "secrets": [],
  "corsEntries": [],
  "middlewares": ["securityHeaders", "csrfMiddleware", "apiRateLimit"],
  "files": {
    "apps/web/src/views/admin/UserListView.vue": "apps/web/src/views/admin/UserListView.vue",
    "apps/web/src/views/admin/UserDetailView.vue": "apps/web/src/views/admin/UserDetailView.vue"
  },
  "authExports": [],
  "webSnippetFile": "web.snippet.ts",
  "packageDeps": {},
  "envVars": {
    "USER_MGMT_DEFAULT_ROLE": {
      "value": "user",
      "required": false,
      "description": "Default app-managed role for new users"
    }
  }
}
```

### Key Manifest Fields (v2)

| Field | Purpose |
|-------|---------|
| `services` | Encore service directory names this module contributes (each must contain `encore.service.ts`) |
| `migrations` | Migration files merged into `db/migrations/` (renumbered deterministically on merge) |
| `secrets` | Encore `secret()` names this module needs, bound in `infra.config.json` |
| `corsEntries` | Additions this module contributes to `encore.app` `global_cors` |
| `middlewares` | `lib` middleware factory names a contributed service composes in its `Service({ middlewares: [...] })` |
| `files` | Other files to copy (key = destination, value = source in module) |
| `webSnippetFile` | TypeScript file with nav registration to merge into the SPA's `useNavigation.ts` |
| `requires` | Modules that must be installed first |
| `conflicts` | Modules that cannot coexist |
| `envVars` | Non-secret environment variables this module needs |

**Retired manifest v1 fields** (do not use): `apiRegistrations`, `authDriverRegistration`, `sideEffectImports`. These were the Express runtime-registry mechanism. Encore has no `app.use`, no ordered middleware assembly, and no `registerAllModules(app)` call.

### Installed Modules (Default Template)

| Module | Shape | Purpose |
|--------|-------|---------|
| `security-core` | Declarative overlay | Declares CORS env; points at `encore.app` `global_cors`. No `apps/api/src/**` files. |
| `api-gateway` | Declarative overlay + frontend | Declares `GATEWAY_OAUTH_*` secrets; keeps the `ConnectivityTestView.vue` frontend payload. |
| `data-postgres` | Declarative overlay | Documents that persistence is the base `SQLDatabase("app")`; no `pg.Pool` files. |
| `data-redis` | Declarative overlay | Declares `REDIS_*` envVars for the rate-limit backend selector. |
| `user-management` | Feature module | Full Encore service directory: `user-management/encore.service.ts` + endpoints + model + migration. The reference shape for all future feature modules. |

---

## 6. Service Composition Pattern

The Encore model of composition is the **filesystem**, not a generated loader. When a directory under `apps/api/` contains `encore.service.ts`, Encore discovers it as a service at compile time.

### Adding a New Service

```
apps/api/<feature>/
├── encore.service.ts    declare Service("<feature>", { middlewares: [...] })
├── types.ts             request/response interfaces (plain TypeScript interfaces)
├── model.ts             SQLDatabase query functions (db.query`...`)
└── <endpoint>.ts        api() or api.raw() declarations
```

No registration in `app.ts`. No entry in `modules.ts`. No priority sort. The generator copies the directory; Encore discovers it.

### `encore.service.ts` Pattern

```typescript
// apps/api/<feature>/encore.service.ts
import { Service } from 'encore.dev/service'
import { securityHeaders } from '../lib/security-headers'
import { csrfMiddleware } from '../lib/csrf'
import { apiRateLimit } from '../lib/rate-limit'

export default new Service('<feature>', {
  middlewares: [securityHeaders, csrfMiddleware, apiRateLimit],
})
```

The `middlewares` array is resolved at **compile time** by Encore. There is no runtime ordering to manage.

### Endpoint Pattern

```typescript
// apps/api/<feature>/<endpoint>.ts
import { api, APIError } from 'encore.dev/api'
import { getAuthData } from '~encore/auth'
import { requireRole } from '../lib/roles'
import { db } from '../db/db'

interface ListRequest { limit?: number }
interface ListResponse { items: Item[] }

export const listItems = api(
  { expose: true, auth: true, method: 'GET', path: '/api/v1/<feature>' },
  async (req: ListRequest): Promise<ListResponse> => {
    const auth = getAuthData()!
    requireRole(auth, ['user', 'admin'])  // any-of
    const rows = await db.query`
      SELECT * FROM items
      WHERE owner_id = ${auth.userID}
      LIMIT ${req.limit ?? 20}
    `
    return { items: rows.rows }
  },
)
```

### Model Pattern (SQLDatabase)

```typescript
// apps/api/<feature>/model.ts
import { db } from '../db/db'
import type { Item } from './types'

export async function getItemById(id: string): Promise<Item | null> {
  const rows = await db.query`SELECT * FROM items WHERE id = ${id}`
  return rows.rows[0] ?? null
}

export async function createItem(data: { name: string; ownerId: string }): Promise<Item> {
  const rows = await db.query`
    INSERT INTO items (name, owner_id) VALUES (${data.name}, ${data.ownerId})
    RETURNING *
  `
  return rows.rows[0]
}
```

**Query rules:**
- Tagged templates only: `db.query\`...\``: auto-parameterized, never string-concatenated
- Return typed DTOs, not raw database rows
- No `pg.Pool`, no `getPool()`, no raw `pg` imports

---

## 7. Implementation Patterns: API (Backend)

### 7.1 Endpoint (Business Logic + HTTP Mapping)

In Encore, the endpoint file combines what was formerly the controller (HTTP mapping) and service (business logic) into a single typed function. Business logic that is reused across endpoints lives in `model.ts`.

```typescript
// apps/api/<feature>/<name>.ts
import { api, APIError } from 'encore.dev/api'
import { getAuthData } from '~encore/auth'
import { requireRole } from '../lib/roles'
import { getFeatureById, createFeature } from './model'
import type { FeatureResponse, CreateFeatureRequest } from './types'

export const getFeature = api(
  { expose: true, auth: true, method: 'GET', path: '/api/v1/feature/:id' },
  async ({ id }: { id: string }): Promise<FeatureResponse> => {
    const auth = getAuthData()!
    requireRole(auth, ['user'])
    const item = await getFeatureById(id)
    if (!item) throw APIError.notFound(`Feature ${id} not found`)
    return item
  },
)

export const createFeatureEndpoint = api(
  { expose: true, auth: true, method: 'POST', path: '/api/v1/feature' },
  async (req: CreateFeatureRequest): Promise<FeatureResponse> => {
    const auth = getAuthData()!
    requireRole(auth, ['admin'])
    return createFeature({ ...req, ownerId: auth.userID })
  },
)
```

**Endpoint rules:**
- Typed request and response interfaces: no `req: Request, res: Response` Express pattern
- `getAuthData()!` populates `AuthData` for `auth: true` endpoints
- `requireRole(auth, [...])` throws `APIError` if the role is missing (any-of, not a hierarchy)
- Business logic in `model.ts`; endpoint is the HTTP declaration + auth check
- Never concatenate SQL; always use tagged templates in `model.ts`

### 7.2 Types File

```typescript
// apps/api/<feature>/types.ts
export interface FeatureResponse {
  id: string
  name: string
  ownerId: string
  createdAt: string
}

export interface CreateFeatureRequest {
  name: string
}

export interface UpdateFeatureRequest {
  name?: string
}
```

Plain TypeScript interfaces. No Zod at the Encore layer: Encore validates the typed request interface at compile and runtime.

### 7.3 Migration File

```sql
-- apps/api/db/migrations/5_feature.up.sql
CREATE TABLE IF NOT EXISTS feature (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  owner_id    UUID NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feature_owner_id_idx ON feature(owner_id);
```

Migrations are numbered sequentially (the generator renumbers on merge). The `SQLDatabase` auto-applies migrations on `encore run` and deploy.

### 7.4 `encore check` (Backend Graph Gate)

After adding or modifying any Encore service file:

```bash
cd apps/api && encore check
```

This validates:
- Service topology (cycles, missing deps)
- All `secret()` declarations have bindings in `infra.config.json`
- All endpoint type interfaces are valid TypeScript
- Gateway and authHandler wiring is correct

Zero errors required before committing.

### 7.5 Typed Client Reference

After changing endpoint signatures, regenerate the typed client and commit the updated reference:

```bash
cd apps/api && encore gen client --lang typescript --output ../web/src/lib/encore-client.ts
```

The committed `encore-client.ts` is the source-of-truth for what types the SPA can consume. Stores use axios with relative paths, but the type reference confirms shapes match.

---

## 8. Implementation Patterns: Web (Frontend)

### Pattern: View → Component → Store

### 8.1 Vue View

```vue
<!-- apps/web/src/views/FeatureNameView.vue -->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth.store'

const auth = useAuthStore()
const isLoading = ref(false)
const error = ref<string | null>(null)

onMounted(async () => {
  // Fetch data on mount if needed
})
</script>

<template>
  <div class="feature-name-view">
    <Card>
      <template #content>
        <h1>Feature Title</h1>
        <!-- PrimeVue components (per-SFC imports: import Card from 'primevue/card') -->
      </template>
    </Card>
  </div>
</template>
```

**View rules:**
- Always use `<script setup lang="ts">`: no Options API
- Use PrimeVue components with per-SFC imports (e.g. `import Card from 'primevue/card'`). The Aura preset is registered once in `main.ts`; do not re-register it in individual components.
- Exactly one `<h1>` per view
- Keep views thin: push logic to stores or composables
- Do not call APIs directly from views: use Pinia stores

### 8.2 Pinia Store

Only create a store if state is shared across views or persists across navigation. One-time data fetches can happen in `onMounted`.

```typescript
// apps/web/src/stores/{feature-name}.store.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'

// Encore bare response shapes (no { success, data } wrapper)
interface FeatureName { id: string; name: string; ownerId: string; createdAt: string }

export const useFeatureNameStore = defineStore('feature-name', () => {
  const items = ref<FeatureName[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const hasItems = computed(() => items.value.length > 0)

  async function fetchItems() {
    isLoading.value = true
    error.value = null
    try {
      const { data } = await axios.get<FeatureName[]>('/api/v1/feature-name')
      items.value = data
    } catch (err: unknown) {
      // Encore errors: { code, message, details }
      if (axios.isAxiosError(err) && err.response?.data?.message) {
        error.value = err.response.data.message
      } else {
        error.value = 'Failed to load items'
      }
    } finally {
      isLoading.value = false
    }
  }

  return { items, isLoading, error, hasItems, fetchItems }
})
```

**Store rules:**
- Use Composition API form of `defineStore` (arrow function, not options)
- Encore typed endpoints return bare payloads: no `.data.data` unwrapping
- Encore errors use `{ code, message, details }`: not `{ success: false, error: { code } }`
- Return only what views need
- Handle errors within the store: set `error` state, do not throw to view
- No `any` types: type all API responses
- CSRF token is automatically injected by the auth store's axios interceptor (fetched from `/api/v1/auth/csrf-token`)

### 8.3 Route Registration

```typescript
// In apps/web/src/router/index.ts: add to the routes array
{
  path: '/feature-path',
  name: 'FeatureName',
  component: () => import('@/views/FeatureNameView.vue'),  // lazy-loaded
  meta: { requiresAuth: true },
}
```

**Always lazy-load** views with `() => import(...)` except the landing page.

### 8.4 Navigation Item

```typescript
// In apps/web/src/composables/useNavigation.ts
registerNavItem({
  id: 'nav-feature-name',
  label: 'Feature Display Name',
  to: '/feature-path',
  position: 'left',
  priority: 30,       // after Home (10) and About (20)
})
```

Only add if the feature should appear in primary navigation. Admin features may be route-only.

### 8.5 PrimeVue Component Usage

PrimeVue components are typed via the `primevue` package itself. No wrapper files or custom type declaration files are needed. Import each component directly in the SFC that uses it:

```vue
<!-- apps/web/src/components/SomeFeaturePanel.vue -->
<script setup lang="ts">
import Card from 'primevue/card'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'

defineProps<{ title: string }>()
</script>

<template>
  <Card>
    <template #title>{{ title }}</template>
    <template #content>
      <Message severity="info" :closable="false">
        <strong>Tip</strong>
        <p>Fill in the form below.</p>
      </Message>
      <InputText v-model="value" placeholder="Enter value" />
      <Button label="Submit" @click="onSubmit" />
    </template>
  </Card>
</template>
```

Common PrimeVue components and their import paths:

| Component | Import | Notes |
|-----------|--------|-------|
| `Button` | `primevue/button` | `label`, `icon`, `severity`, `@click` |
| `Card` | `primevue/card` | `#title` and `#content` named slots |
| `Message` | `primevue/message` | `severity="info\|warn\|error\|success"`, `:closable="false"` |
| `Tag` | `primevue/tag` | `value`, `severity` |
| `Avatar` | `primevue/avatar` | `label`, `size`, `shape="circle"` |
| `InputText` | `primevue/inputtext` | `v-model` |
| `Checkbox` | `primevue/checkbox` | `v-model`, `binary` |
| `Select` | `primevue/select` | `:options`, `optionLabel`, `optionValue`, `v-model` |
| `DataTable` | `primevue/datatable` | `:value` |
| `Column` | `primevue/column` | `field`, `header` (child of `DataTable`) |
| `ProgressSpinner` | `primevue/progressspinner` | loading state |
| `Menu` | `primevue/menu` | `:model`, `:popup="true"` |

### 8.6 Composable

```typescript
// apps/web/src/composables/useFeatureName.ts
import { ref, computed } from 'vue'

export function useFeatureName() {
  // Reactive composable logic
  return {
    // Expose only what callers need
  }
}
```

Naming rule: composables always start with `use`. Non-reactive utilities go in `src/utils/`.

---

## 9. Implementation Patterns: Shared Packages

### 9.1 Shared Types

```typescript
// packages/shared/src/types/{feature-name}.ts
export interface FeatureName {
  id: string
  // ... fields from requirements
}

export interface CreateFeatureNameDto {
  // ... fields for creation (omit server-assigned fields)
}

export interface UpdateFeatureNameDto {
  // ... all fields optional for PATCH pattern
}
```

Export from `packages/shared/src/index.ts`.

Shared types in `packages/shared` are used by the Vue SPAs, not by the Encore backend. The Encore backend defines its own types in `apps/api/<service>/types.ts`.

### 9.2 Zod Schemas (SPA-side validation)

```typescript
// packages/shared/src/schemas/{feature-name}.schema.ts
import { z } from 'zod'

export const createFeatureNameSchema = z.object({
  name: z.string().min(1).max(100),
})

export const updateFeatureNameSchema = z.object({
  name: z.string().min(1).max(100).optional(),
})

export type CreateFeatureNameInput = z.infer<typeof createFeatureNameSchema>
```

Export from `packages/shared/src/index.ts`.

### 9.3 Build After Changes

After modifying any package, rebuild before apps can use the changes:

```bash
npm run build -w packages/shared
# or rebuild all packages:
npm run build:packages
```

**IMPORTANT**: `@template/shared` (and other packages) resolve to `dist/`: apps import compiled output, not source. The Encore backend at `apps/api` does NOT import from `packages/*`.

---

## 10. Configuration Reference

### 10.1 App Identity Configuration

When configuring a new project from the template, update these files:

| File | What to Change |
|------|---------------|
| `package.json` (root) | `name` field |
| `apps/web*/package.json` | `name` field |
| `packages/*/package.json` | `name` field (`@template/*` → `@{org}/*`) |
| All TypeScript imports in SPAs/packages | `@template/*` → `@{org}/*` |
| `apps/api/encore.app` | `id` field (Encore app ID) |
| `README.md` | Title, description |

### 10.2 Environment Variables

**Core (`apps/api/.env`):**
```
AUTH_DRIVER=mock                  # mock | rauthy
FRONTEND_URL=http://localhost:5173
LOG_LEVEL=debug
LOG_PII=false
RATE_LIMIT_MAX=1000
```

Auth driver, JWT keys, and database connection are declared as Encore `secret()` values in `apps/api/lib/secrets.ts` and bound in `apps/api/infra.config.json`. In production these come from the Encore secret store.

**rauthy OIDC (`apps/api/.env`):**
```
AUTH_DRIVER=rauthy
RAUTHY_ISSUER={rauthy issuer URL}
RAUTHY_CLIENT_ID={OIDC client ID}
RAUTHY_CLIENT_SECRET={OIDC client secret}
RAUTHY_REDIRECT_URI=http://localhost:4000/api/v1/auth/rauthy/callback
RAUTHY_SCOPES=openid profile email
RAUTHY_DEFAULT_ROLE=user
```

**BFF gateway (when gateway is active):**
```
PRIVATE_API_BASE_URL={private backend URL}
GATEWAY_OAUTH_ISSUER={issuer}
GATEWAY_OAUTH_CLIENT_ID={client id}
GATEWAY_OAUTH_CLIENT_SECRET={client secret}
GATEWAY_OAUTH_SCOPE={scope}
GATEWAY_TIMEOUT_MS=30000
```

**Redis (rate-limit backing: optional):**
```
REDIS_URL={Redis connection string}      # if set, rate-limiter uses Redis; otherwise in-memory
```

Redis is NOT a session store. Session state is in httpOnly JWT cookies + the `refresh_token` table.

### 10.3 CSP Configuration

Content Security Policy is configured via the `securityHeaders` middleware in `apps/api/lib/security-headers.ts`. Update the CSP directive if the app uses external CDNs or APIs:

```typescript
// apps/api/lib/security-headers.ts
export const securityHeaders: Middleware = ...
// CSP directives are set here; update connectSrc for external API domains
```

CORS policy is configured in `apps/api/encore.app` under `global_cors`:

```json
{
  "global_cors": {
    "allow_origins_with_credentials": ["http://localhost:5173"],
    "allow_headers": ["X-CSRF-Token"],
    "expose_headers": ["X-CSRF-Token"]
  }
}
```

---

## 11. Authentication Architecture

### Multi-Driver by Configuration

```
Driver selection: AUTH_DRIVER env (mock | rauthy)

apps/api/auth/
  ├── handler.ts        authHandler(token) → AuthData  +  Gateway({ authHandler })
  ├── drivers.ts        GET /api/v1/auth/drivers, /status, /login (default driver dispatch)
  ├── mock.ts           GET /api/v1/auth/mock/login?user=0|1|2 → instant principal
  └── rauthy.ts         GET .../rauthy/login → 302 rauthy → GET .../rauthy/callback

Both drivers ship in the base app. AUTH_DRIVER selects the default.
No authService.registerDriver(). No priority sort. No runtime registry.
```

### Auth API Surface

```typescript
// apps/api/auth/handler.ts (Encore authHandler + Gateway)
interface AuthData {
  userID: string
  email: string
  name: string
  roles: string[]
  ssoProvider: string
}
// authHandler validates the access-token cookie (or Authorization: Bearer)
// Gateway({ authHandler }) gates every endpoint declared with auth: true

// apps/api/lib/jwt.ts
function signAccessToken(claims): Promise<string>          // RS256, ~15 min
function signRefreshToken(claims): Promise<string>         // RS256, ~7 day
function verifyAccessToken(token: string): Promise<Claims>

// apps/api/lib/roles.ts (AUTH-007)
function hasRole(roles: string[], required: string | string[]): boolean  // any-of, not a hierarchy
function requireRole(auth: AuthData, required: string | string[]): void  // throws APIError if missing
```

### Auth Endpoints

| Method | Path | Auth | Purpose |
|--------|------|:----:|---------|
| GET | `/api/v1/auth/drivers` | - | List available driver names |
| GET | `/api/v1/auth/status` | - | `{ authenticated, drivers }` |
| GET | `/api/v1/auth/login` | - | Login via default AUTH_DRIVER |
| GET | `/api/v1/auth/mock/login` | - | Mock instant login (`?user=0\|1\|2`) |
| GET | `/api/v1/auth/rauthy/login` | - | OIDC redirect to rauthy |
| GET | `/api/v1/auth/rauthy/callback` | - | OIDC code exchange |
| GET | `/api/v1/auth/csrf-token` | - | `{ token }` (replay as `X-CSRF-Token`) |
| GET | `/api/v1/auth/me` | Y | Current user (`MeResponse`) |
| POST | `/api/v1/auth/refresh` | - | Rotate refresh token → new access cookie |
| POST | `/api/v1/auth/logout` | Y | Revoke refresh token + clear cookies |

### Mock Test Users (MUST be customized: see configure.md Step 3b)

Template defaults (replace during configure phase):
```
?user=0  → developer@example.com   roles: ['developer', 'user']
?user=1  → admin@example.com       roles: ['admin', 'user']
?user=2  → user@example.com        roles: ['user']
```

> **These are placeholder roles.** The configure phase (Step 3b) **requires** replacing them with mock users whose roles match the business requirements. Without this, `requireRole()` guards and `hasRole()` UI conditionals cannot be tested. See `ref:template-configure` Step 3b for the full pattern.

### Customizing Roles (Required: not optional)

Every project defines its own roles in the business requirements. The mock users **must** be aligned:

1. **Read business requirements** to identify all roles (e.g., `EXTERNAL`, `STAFF`, `CASEWORKER`, `MANAGER`, `ADMINISTRATOR`)
2. **Replace mock users** in `apps/api/auth/mock.ts`: one user per distinct role combination
3. **Set `RAUTHY_DEFAULT_ROLE`** to the lowest-privilege role in `apps/api/.env`
4. **Apply `requireRole(auth, ...)`** to every protected endpoint using the exact role strings, and scope data queries to `auth.roles` in the model layer (AUTH-007)
5. **Use `hasRole()`** in frontend for conditional UI rendering
6. **Update the mock driver test** (`apps/api/auth/mock.test.ts`): mandatory, not optional. Run `encore check && vitest` before proceeding.
7. **Document the `?user=N` mapping** in `CODEMAP.md` so developers know which user to select for testing each role

### Frontend Auth Store

```typescript
// apps/web/src/stores/auth.store.ts (Pinia)
state: { user: User | null, loading: boolean, error: string | null }
getters: { isAuthenticated: boolean, hasRole(role): boolean }
actions: { fetchUser(), login(driver: string), logout(), checkStatus() }
// Reads BARE me/status payloads (Encore native, no { success, data } wrapper)
// Encore { code, message, details } errors parsed from axios error responses
// CSRF token fetched from GET /api/v1/auth/csrf-token, replayed as X-CSRF-Token
```

---

## 12. Auth is Stateless JWT: Redis is Rate-Limit Only

Auth in this template is **stateless RS256 JWT**, not session-based:

```
Access token:  RS256, ~15 min, in httpOnly cookie
Refresh token: RS256, ~7 day, in httpOnly cookie + hash stored in refresh_token table
               Revocation: set revoked_at in DB. "Log out everywhere": revoke all rows for user.
CSRF:          double-submit cookie, constant-time compare (not session-backed)
OAuth state:   short-lived OAUTH_STATE cookie (rauthy.ts), not a session
```

**Redis**, when configured via `REDIS_URL`, swaps the in-memory rate-limit backend (`lib/rate-limit.ts`) for a Redis-backed one. Redis is **never** a session store or token store in this template.

Two bounded latencies exist and are acceptable by design:
1. **Access-token revocation latency**: up to one access-token TTL (~15 min) after DB revocation
2. **Stale roles**: role changes take effect at next token refresh

Neither is solved by re-introducing `express-session` (forbidden by INV-3/INV-7 in the `security-data-invariants` spec).

---

## 13. API Gateway (BFF Pattern)

The `gateway` service provides the BFF proxy for the public-facing (or dual public-side) stack.

```
Authenticated request (auth: true)
  │
  ▼
/api/v1/data/*path          gateway/proxy.ts (api.raw; GET/POST/PUT/PATCH/DELETE)
  ├── sanitise forwarded path (traversal protection)
  ├── token-cache.ts          getAccessToken() → OAuth client-credentials (cached, deduped)
  │   └── POST {rauthy issuer}/oidc/token
  ▼
fetch() to private backend   Authorization: Bearer {token}
  ▼
response proxied back        5xx masked to 502, timeout to 504, per-access audit
```

**Gateway is optional.** If the application owns its own data (no private backend), the `gateway` service is still present in the base app but the `api-gateway` module does not need to be configured. If kept active, set `PRIVATE_API_BASE_URL` + `GATEWAY_OAUTH_*` secrets.

---

## 14. Adding a Feature: Complete Walkthrough

This section walks through adding a complete feature (Encore API + frontend). Use as a checklist.

### Pre-step: AUTH-007 Role-Scoped Data Check

Before writing any code, review the Feature Plan for AUTH-007 obligations:

> If an endpoint will be called by users with **different roles** (e.g., staff with `case-worker` role AND external users with `applicant` role), it MUST implement all three of the following:
> 1. `auth: true` on the `api()` declaration
> 2. `requireRole(auth, ['case-worker', 'applicant'])`: all required roles in one call (any-of)
> 3. Role-scoped SQL: `WHERE owner_roles && ${auth.roles}::text[]` or equivalent scope in the model function
>
> Omitting item 3 means the endpoint returns un-scoped data to every authenticated caller regardless of role: a security defect, not just a functional gap.

Flag any such endpoint in the Feature Plan table before writing any code.

### Step 1: Create the Encore Service Directory

```
apps/api/<feature>/
├── encore.service.ts     Service("<feature>", { middlewares: [...] })
├── types.ts              Request/response interfaces
├── model.ts              SQLDatabase query functions
└── <endpoints>.ts        api() declarations
```

No registration needed anywhere: Encore discovers the service at compile time.

### Step 2: Add Migration (if new tables needed)

```
apps/api/db/migrations/N_<feature>.up.sql
```

Number sequentially after the existing migrations. Encore auto-applies on `encore run`.

### Step 3: Write Model Functions

```typescript
// apps/api/<feature>/model.ts
import { db } from '../db/db'
import type { Feature } from './types'

export async function getFeatureById(id: string): Promise<Feature | null> {
  const rows = await db.query`SELECT * FROM features WHERE id = ${id}`
  return rows.rows[0] ?? null
}
```

**Run unit tests after each model function:**
```bash
cd apps/api && vitest run
```

### Step 4: Write Endpoint Declarations

```typescript
// apps/api/<feature>/<name>.ts
import { api, APIError } from 'encore.dev/api'
import { getAuthData } from '~encore/auth'
import { requireRole } from '../lib/roles'
import { getFeatureById } from './model'
import type { Feature } from './types'

export const getFeature = api(
  { expose: true, auth: true, method: 'GET', path: '/api/v1/feature/:id' },
  async ({ id }: { id: string }): Promise<Feature> => {
    const auth = getAuthData()!
    requireRole(auth, ['user'])
    const item = await getFeatureById(id)
    if (!item) throw APIError.notFound(`Feature ${id} not found`)
    return item
  },
)
```

**Run `encore check` after adding any endpoint:**
```bash
cd apps/api && encore check
```

### Step 5: Write API Unit Tests

```typescript
// apps/api/<feature>/<name>.test.ts
import { describe, it, expect, vi } from 'vitest'
// TC-001: verify feature GET returns 200 with valid id
// TC-002: verify feature GET returns not_found for invalid id
```

### Step 6: Update Typed Client Reference

```bash
cd apps/api && encore gen client --lang typescript --output ../web/src/lib/encore-client.ts
```

### Step 7: Create Vue View

```
apps/web/src/views/FeatureNameView.vue
```

Use `<script setup lang="ts">`. PrimeVue components with per-SFC imports. Single `<h1>`.

### Step 8: Create Pinia Store (if needed)

```
apps/web/src/stores/{feature-name}.store.ts
```

Only if state is shared across views. Encore responses are bare typed payloads: no `{ success, data }` unwrap needed.

**Pre-read the Encore endpoint declarations before creating the store.** The store must call only declared endpoints with the correct HTTP method and path.

### Step 9: Write Store + View Tests

```typescript
// apps/web/src/__tests__/FeatureNameView.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
// TC-012: verify dashboard shows feature list
```

### Step 10: Register Frontend Route

In `apps/web/src/router/index.ts`, add lazy-loaded route with `meta: { requiresAuth: true }`.

### Step 11: Add Navigation (if needed)

In `useNavigation.ts`, add `registerNavItem(...)` with appropriate priority.

### Step 12: Verify

```bash
cd apps/api && encore check          # backend graph: zero errors
cd apps/api && vitest run            # API unit tests: zero failures
npm run typecheck --workspaces        # TypeScript: zero errors
npm run lint                          # ESLint: zero warnings
npm run build:packages && npm run build:apps  # frontend: zero build errors
npm test --workspaces --if-present    # all tests pass
```

---

## 15. Removing Template Elements

A removal is only complete when all four are done:

1. **Delete the files**
2. **Remove all imports**: search for the deleted file's name across all files
3. **Remove all references**: from `encore.app` CORS entries, `infra.config.json` secrets, nav registrations, router registrations
4. **Update documentation**: `CODEMAP.md`, `README.md`

After removing any Encore service: `encore check` must pass before committing.

### Common Removal Patterns

**Remove an entire stack** (dual → single):
- Delete the unused Encore app directory
- Remove from deployment workflows in `.github/workflows/`
- Delete the related `apps/api/.env.example` entries for the removed stack
- Update README and CODEMAP

**Remove an auth driver:**
- Remove driver file from `apps/api/auth/{driver}.ts`
- Remove driver-specific secrets from `apps/api/lib/secrets.ts` and `apps/api/infra.config.json`
- Remove driver-specific env var section from `apps/api/.env.example`
- Run `encore check` to confirm no dangling secret references

**Disable the BFF gateway (if no private backend):**
- The `gateway/` service ships in the base app as a **core service** and is part of the baseline's security wiring, so it is not removed. Leaving `PRIVATE_API_BASE_URL` (and the `GATEWAY_OAUTH_*` secrets) unset makes the proxy inert: with no private backend configured, the gateway forwards nothing.
- Do not delete the `gateway` service. The generator only composes services onto the baseline; it never subtracts a core service, so there is no configuration knob for removing one. A variant with no private backend simply leaves the gateway's config unset. (The manual Trim phase, Phase 5, prunes only optional composed modules and views, never core services.)

**Remove an Encore service (feature module):**
- Delete the service directory (e.g., `apps/api/user-management/`)
- Remove its migrations from `apps/api/db/migrations/` if they introduce tables not used by other services
- Run `encore check` to confirm no other service imports from it

**Remove a Vue view:**
- Delete view file
- Delete store (if feature-specific)
- Remove route from `router/index.ts`
- Remove nav item from `useNavigation.ts`
- Remove view-specific components (check they're not shared)

### Post-Removal Verification

After each removal:
1. Search for orphaned references (import statements, path strings, component names)
2. `encore check`: catch broken Encore service dependencies
3. `npm run typecheck --workspaces`: catch broken TypeScript imports
4. `npm run build:packages` if any packages were modified

---

## 16. Validation Checklist (Template-Specific)

These checks verify template-specific concerns. They complement (do not replace) factory validation gates (FAC-S*).

| # | Check | How |
|---|-------|-----|
| 1 | **Placeholder completeness** | Search for `{{` in `.env`, source files. Allowed only in `.env.example` files. |
| 2 | **TypeScript strict mode** | `npm run typecheck --workspaces`: zero errors |
| 3 | **ESLint zero warnings** | `npm run lint`: zero warnings, zero errors |
| 4 | **Prettier formatting** | `npm run format:check` |
| 5 | **Package build** | `npm run build:packages`: all packages produce `dist/` |
| 6 | **Frontend app build** | `npm run build:apps`: all active SPAs build successfully |
| 7a | **encore check** | `cd apps/api && encore check`: zero errors. Backend graph + topology + types valid. |
| 7b | **Unit tests pass** | `npm run test --workspaces --if-present`: zero failures |
| 8 | **Orphan detection** | No dead imports, no dangling secret references after removals |
| 9 | **Environment variable coverage** | Every non-secret config in source has entry in `.env.example` |
| 10 | **Architecture invariants** | Stateless JWT (no `express-session`), no Vuex, no ORM, no Tailwind, no third-party design-system components, PrimeVue per-SFC imports only, Encore service pattern (`api()` + `model.ts`), `<script setup>` in Vue, AUTH_DRIVER config (not runtime registry), SQLDatabase tagged-template queries |

---

## 17. Integration with Factory Pipeline

This section defines how the template orchestrator connects to the factory pipeline.

### What the Factory Provides (Inputs to Template Work)

When invoked from the factory pipeline, the primary inputs are the **Build Specifications** (see Phase 2):

| Factory Input | Template Use |
|---|---|
| **API Build Specification** (stage 4) | Authoritative endpoint list, variant, security method, data model, business rules, test cases, template overrides |
| **UI Build Specification** (stage 5) | Authoritative page list with pageType, viewType, API endpoint references, test cases |

Supplementary artifacts (read for implementation context, not for feature derivation):

| Factory Artifact | Template Use |
|-----------------|--------------|
| `service-description.json` (stage 2) | App identity, service name, package naming |
| `audience-identification.json` (stage 2) | External-user audiences → public stack, staff audiences → internal stack |
| `integration_points_register.md` (stage 2) | External systems → BFF gateway decision, S2S endpoints |
| `ddl_script.sql` + `json_schema.json` (stage 3) | Database tables and entity definitions: owned by factory orchestration |
| `business_requirements_document.md` (stage 1) | UC-nnn → features, BR-nnn → validation rules, Section 11 → business constraints |
| `test_specifications.md` (stage 1) | TC-nnn → test cases to implement |
| Content-spec files (stage 5 pre-read) | `pageType`, `apiEndpoints[]`, `vueComponent` per page: read during Phase 4a planning |

### What the Template Produces (Outputs for Factory Validation)

| Template Output | Factory Validates Against |
|----------------|--------------------------|
| Encore service files in `apps/api/<service>/` | FAC-S4 rules (buildable backend, health checks, etc.) |
| `encore check` passes | FAC-S4-001/002 (valid backend graph, endpoint type alignment) |
| Test files colocated with service files (annotated with `// TC-nnn`) | FAC-S4-013/014, FAC-S5-011/012 (TC-nnn coverage) |
| `test-traceability-report.md` | FAC-S4-015, FAC-S5-013 (UC→endpoint/page mapping, TC→test method mapping, coverage %) |
| Vue views in `apps/web/src/views/` | FAC-S5-003/005 (page per sitemap, single h1) |
| Compliance report | FAC-S4-011 (no Critical/High findings) |

### Boundary Rules

1. **The factory defines what to build.** The template defines how to build it. If the factory says "create a permits feature," the template provides the Encore service-directory pattern and file locations.

2. **The factory validates standards compliance.** The template validates template-specific concerns (TypeScript, build, placeholders, architecture invariants). Do not duplicate FAC-S* checks in template validation.

3. **The factory owns requirements derivation.** Do not re-derive the feature list (endpoints, pages) from raw factory artifacts. When invoked from the factory pipeline, the Build Specification is the authoritative source of what to build.

4. **Enterprise standards skills are shared references.** Both the factory and template reference `ref:api-web-standards`, `ref:api-rest-standards`, `ref:api-security`, `ref:ci-design-system`. The factory enforces them via validation gates. The template applies them during implementation. When implementing Vue views, extract UX and content rules from CI page-type skills but output Vue SFCs using PrimeVue components (not static HTML, third-party web components, or content-spec JSON).

5. **The template's `CODEMAP.md` is the authoritative project structure reference.** If the factory's stage 4 checks for `CODEMAP.md` to determine output paths, this template's CODEMAP provides that information.

6. **Backend technology is Encore.ts.** The factory must not specify Express 5 / TypeScript as the controller tech stack for this template. The backend is Encore.ts; controllers/routes/services as Express constructs do not exist here.

---

## 18. Code Quality Rules (Lint & TypeScript)

**Skill**: `ref:template-code-quality`: load this skill before writing any code in Phase 4a or 4b.

This section is now a standalone skill for JIT loading. It contains ESLint rules, TypeScript strict mode flags, common AI anti-patterns with do/don't examples, and incremental lint check guidance. The skill also instructs the AI to read the live `eslint.config.mjs` as the authoritative source of truth.
