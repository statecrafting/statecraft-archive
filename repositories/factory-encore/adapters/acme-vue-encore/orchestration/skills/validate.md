---
id: template-validate
name: Template Validate: Quality Check
description: Validates template-specific concerns for the selected variant (public, internal, dual): encore check, TypeScript, lint, build, placeholders, architecture invariants. Complements but does not duplicate factory validation gates.
type: skill
variant_parameter: public | internal | dual
defers_to:
  - factory-orchestrator (FAC-S* validation rules, UC/TC traceability, cross-stage consistency)
  - template-orchestrator (architecture invariants, tech stack requirements)
---

# Template Skill: Validate

Verify the implementation is sound. This skill checks template-specific quality concerns. It **does not** duplicate factory validation gates (FAC-S4, FAC-S5): those are owned by the factory orchestrator.

**Input**: Variant + list of active workspaces

Run after completing feature work, or any time you want a quality check.

---

## Scope Boundary

**This skill checks:**
- Encore application graph, topology, and types (`encore check`)
- Placeholder completeness
- TypeScript strict mode (SPAs and packages)
- ESLint zero warnings
- Prettier formatting
- Package and app builds
- Unit test execution
- Orphan detection (post-removal)
- Environment variable documentation
- Architecture invariants
- Route URL alignment (Encore endpoint path ↔ Pinia store axios path)
- Field name alignment (shared types ↔ DDL columns ↔ service SQL mapping)

**The factory checks (do NOT duplicate here):**
- OpenAPI spec validity and DDL alignment (FAC-S4-001, FAC-S4-016)
- UC-nnn / TC-nnn coverage validation (FAC-S4-012/014/015, FAC-S5-012/013/014)
- Cross-stage consistency
- Content spec / page file completeness (FAC-S5-001 through FAC-S5-010)

---

## Check 0: Install and Package Build

Run these first. Downstream checks are meaningless if packages do not compile.

```bash
npm install
npm run build:packages
```

**Pass**: Zero install errors, zero package build errors, `dist/` present in `packages/shared`.

Also install the Encore app's dependencies:

```bash
cd apps/api && npm install && cd ../..
```

---

## Check 1: Placeholder Completeness

Search for `{{` across all files (excluding `node_modules/`, `dist/`, `.git/`).

| Found in | Verdict |
|----------|---------|
| `.env.example`, `apps/api/.env.example` | OK: these are documentation |
| `apps/api/.env`, `apps/web/.env` (working files) | **FAIL**: must be filled or removed |
| Any `.ts`, `.vue`, `.json` source file | **FAIL**: hard failure |

**Pass**: No `{{...}}` in working env files or source code.

---

## Check 2: Encore Application Graph (`encore check`)

```bash
cd apps/api
npx encore check
```

**Pass**: Exit 0 with zero errors. This validates:
- Service topology: every `encore.service.ts` is well-formed
- Type correctness: all `api()` request/response types are serializable
- Import graph: no import cycles across services
- Auth handler wiring: authHandler and Gateway are correctly declared

This is the primary backend type-check gate. It replaces the Express-era `tsc` check for `apps/api`.

**Common failure patterns:**
- A new service directory is missing `encore.service.ts`: Encore cannot discover it
- An `api()` request or response type contains a non-serializable field (e.g., `Date`: use `string` ISO format instead)
- A service imports from another service in a way that creates a disallowed cycle

---

## Check 3: TypeScript Strict Mode (SPAs and Packages)

Run typecheck for each active SPA workspace:

**All variants:**
```bash
npm run typecheck --workspace=packages/shared
```

**Single-stack (public or internal):**
```bash
npm run typecheck --workspace=apps/web
```

**Dual:**
```bash
npm run typecheck --workspace=apps/web
npm run typecheck --workspace=apps/web-internal
```

**Pass**: Zero TypeScript errors across all workspaces.

Do not suppress with `// @ts-ignore` or `as any`. The only acceptable `any` uses are in test files.

---

## Check 4: ESLint Zero Warnings

```bash
npm run lint
```

**Pass**: Zero warnings, zero errors.

Common issues:
- `no-floating-promises`: every async call must be awaited or `.catch()` handled
- `no-unused-vars`: no unused imports (prefix with `_` if intentionally unused)
- `no-explicit-any`: no `any` outside test files
- `await-thenable`: do not `await` non-Promise values

Auto-fix available: `npm run lint:fix`

---

## Check 5: Prettier Formatting

```bash
npm run format:check
```

**Pass**: Zero formatting differences.

Fix: `npm run format`

---

## Check 6: Package Build

```bash
npm run build:packages
```

**Pass**: `shared` (and any other active packages) produce `dist/` with zero errors.

---

## Check 7: App Build

Build the SPAs:

```bash
npm run build:apps
```

Build the Encore app image (optional: use for CI):

```bash
cd apps/api && npm run build:docker
```

**Pass**: All active apps build successfully.

Run `build:packages` first if packages changed.

---

## Check 8: Unit Tests

### 8a. Run all tests

```bash
npm test --workspaces --if-present
```

Also run tests inside the Encore app:

```bash
cd apps/api && npm test && cd ../..
```

**Pass**: Zero test failures across all workspaces.

### 8b. Business logic coverage gate

Verify that every Encore endpoint file and model file added during feature work has a corresponding test file:

```bash
# List endpoint files that have no matching test
for f in apps/api/*/\*.ts; do
  [[ "$f" == *".test.ts" ]] && continue
  [[ "$f" == *"encore.service.ts" ]] && continue
  [[ "$f" == *"types.ts" ]] && continue
  test_file="${f%.ts}.test.ts"
  [[ ! -f "$test_file" ]] && echo "MISSING TEST: $test_file"
done
```

**Pass**: No `MISSING TEST:` lines. Every endpoint file and model file has a `.test.ts` sibling.

### 8c. Fail loop: do not proceed with failing tests

If any test fails:

1. Read the failure output: identify the specific assertion and file
2. Determine whether the **code is wrong** or the **test is wrong**
3. Fix the identified side, re-run
4. Repeat until all tests pass: never skip or delete a failing test
5. Only then proceed to Check 9

---

## Check 9: Orphan Detection

For each item removed during trim:

1. Search for removed endpoint paths (e.g., `/api/v1/about`) in Pinia store axios calls and Vue router
2. Search for removed file names in all import statements
3. Search for removed npm packages in `package.json` files

**Pass**: No orphaned references found.

---

## Check 10: Environment Variable Coverage

1. Search `apps/api/` source files for `process.env.` references
2. Compare against `apps/api/.env.example` entries
3. Any `process.env.X` in source but not in `.env.example` is undocumented

**Pass**: Every `process.env.X` in `apps/api/` has a corresponding `.env.example` entry. Encore secrets are declared in `lib/secrets.ts` and bound in `infra.config.json`: verify all `secret('Name')` calls have a matching `$env` binding in `infra.config.json`.

---

## Check 11: Architecture Invariants

Verify these manually by searching/reading relevant files:

| Invariant | How to Verify |
|-----------|--------------|
| No Express | Search `import.*express` in `apps/api/`: should find nothing |
| No express-session | Search `express-session` in `apps/api/package.json`: should find nothing |
| No Vuex | Search `import.*vuex`: should find nothing |
| No ORM | Search `sequelize\|typeorm\|prisma\|drizzle` in `apps/api/`: should find nothing |
| No Tailwind | Search `tailwind` in `package.json` and templates: should find nothing |
| Encore service discovery | Every feature service directory has `encore.service.ts` |
| `<script setup>` in Vue | New `.vue` files use `<script setup lang="ts">`, not Options API |
| Tagged-template queries only | Search `pool.query(\s*\`\|db.query(\s*\`` vs string-concatenated SQL: should find no concatenation |
| Stateless JWT, no sessions | No `express-session`, no `req.session`, no `connect-redis`, no `connect-pg-simple` |
| Redis is rate-limit only | `REDIS_URL` used only in `lib/rate-limit.ts`: not as a session store |
| Port 4000 | `apps/api/.env.example` sets `PORT=4000`; Vite proxy targets `localhost:4000` |
| Encore error shape | Pinia stores read `e.response?.data?.message` (Encore `{ code, message, details }`): not `e.response?.data?.error?.message` (Express envelope) |

**Pass**: All invariants hold.

---

## Check 12: Route URL Alignment

For every API feature, verify the endpoint path in the Encore `api()` declaration matches the Pinia store's axios call path.

### 12a. Encore endpoint path ↔ Pinia store axios path

1. Open each endpoint file in `apps/api/<service-name>/`
2. List each `api({ ..., path: '/api/v1/<resource>' })` declaration
3. Open the corresponding Pinia store in `apps/web{-internal}/src/stores/`
4. Verify each `axios.get('/api/v1/<resource>')` call matches an actual Encore endpoint path

**Common mismatches:**

| Pinia Store Axios Call | Encore Endpoint | Problem |
|---|---|---|
| `axios.post('/api/v1/resource')` | No `method: 'POST'` endpoint at that path | Store calls POST but no POST handler exists |
| `axios.delete('/api/v1/resource/${id}')` | No endpoint with `path: '/api/v1/resource/:id'` and `method: 'DELETE'` | 404 in production |
| `axios.put('/api/v1/resource/${id}')` | `path: '/api/v1/resource'` (no `:id`) | Path mismatch |

**Pass**: Every store axios call (method + path) matches an actual Encore endpoint.

### 12b. Field name alignment (internal/dual only)

For each shared DTO type, verify property names align with DDL column names via the project's naming convention (DDL `snake_case` ↔ TypeScript `camelCase`):

1. Open each shared DTO type (e.g., `FeatureNameDto`)
2. For each property (e.g., `createdAt: string`), verify the model maps it from the DDL column (e.g., `created_at`)
3. Verify `db.query` column names match DDL exactly

**Pass**: Every shared type property traces to a DDL column, and every model maps between them.

---

## Check 13: AUTH-007 Role-Scoped Data Verification

For any `auth: true` endpoint that serves multiple roles (both external user and staff callers), verify the service-layer scoping is correct.

**Identify candidate endpoints**: any endpoint where `requireRole` lists both external-user-role strings and staff-role strings.

For each such endpoint, verify in the model:
- [ ] Model function branches on `roles: string[]`: contains at least one `roles.includes(...)` guard
- [ ] Each external user role has a scoped query that limits results to that user's data (e.g., `WHERE owner_user_id = ${userId}`)
- [ ] Staff roles fall through to an unscoped query (existing behaviour preserved)

```bash
# Find endpoints that list multiple roles in requireRole
grep -rn "requireRole" apps/api/ --include="*.ts" | grep -v ".test.ts"
```

For each matched endpoint, confirm the corresponding model function applies per-role scoping. An endpoint whose `requireRole` lists external user roles but whose model performs an unscoped query is a **BLOCKER** (AUTH-007 / INV-1).

---

## Check 14: Dual Variant Checks

### Dual independence check:

- [ ] Both Encore apps build independently (`encore check` passes in each app directory)
- [ ] Both Vue SPAs build independently
- [ ] Public Encore app `encore.app` `global_cors` lists only the public SPA origin
- [ ] Internal Encore app `encore.app` `global_cors` lists only the internal SPA origin
- [ ] `apps/web/vite.config.ts` Vite proxy target points to the public Encore app port
- [ ] `apps/web-internal/vite.config.ts` Vite proxy target points to the internal Encore app port
- [ ] All Vue store axios calls use relative paths (`/api/v1/*`): no hardcoded `localhost` URLs
- [ ] No cross-app imports (public app does not import from internal app or vice versa)

---

## Check 15: Post-Completion Hard Gate

> **This is the final quality gate. It MUST pass before the template is considered complete.**

```bash
# Step 1: Rebuild packages
npm run build:packages

# Step 2: Full typecheck (SPAs)
npm run typecheck --workspaces --if-present

# Step 3: Encore check (backend)
cd apps/api && npx encore check && cd ../..

# Step 4: Full lint
npm run lint -- --max-warnings 0

# Step 5: Full app build
npm run build:packages && npm run build:apps

# Step 6: Full test suite
npm test --workspaces --if-present
cd apps/api && npm test && cd ../..
```

**Pass**: All commands exit 0. Zero TypeScript errors, zero lint warnings, zero build errors, zero test failures, zero `encore check` errors.

---

## Check 16: Test Traceability Report (factory pipeline only)

When invoked from the factory pipeline, produce `test-traceability-report.md` in the project root mapping requirement IDs to implementation artifacts.

**Skip this check** in standalone mode.

**Required sections:**

```markdown
# Test Traceability Report

## UC → Endpoint/Page Mapping

| UC ID | UC Name | Endpoint(s) / Page(s) | Status |
|---|---|---|---|
| UC-001 | [name] | GET /api/v1/resource, FeatureView | Mapped |

## TC → Test Code Mapping

| TC ID | Test Type | Test Category | Test File | Test Method | Status |
|---|---|---|---|---|---|
| TC-001 | API Contract | Unit | feature.test.ts | returns items for admin | Implemented |

## Coverage Summary

- **Use Cases**: X of Y mapped (Z%)
- **Test Cases**: X of Y implemented (Z%)
```

---

## Output: Validation Report

```
TEMPLATE VALIDATION REPORT: {variant} variant
================================================
Check 0   Install + Package Build             [ PASS / FAIL ]
Check 1   Placeholder Completeness            [ PASS / FAIL ]
Check 2   encore check (graph + types)        [ PASS / FAIL ]
Check 3   TypeScript Strict Mode (SPAs)       [ PASS / FAIL ]
Check 4   ESLint Zero Warnings                [ PASS / FAIL ]
Check 5   Prettier Formatting                 [ PASS / FAIL ]
Check 6   Package Build                       [ PASS / FAIL ]
Check 7   App Build                           [ PASS / FAIL ]
Check 8a  Unit Tests: All Pass               [ PASS / FAIL ]
Check 8b  Unit Tests: Business Coverage      [ PASS / FAIL ]
Check 9   Orphan Detection                    [ PASS / FAIL ]
Check 10  Environment Coverage                [ PASS / FAIL ]
Check 11  Architecture Invariants             [ PASS / FAIL ]
Check 12  Route URL + Field Alignment         [ PASS / FAIL ]
Check 13  AUTH-007 Role-Scoped Data           [ PASS / FAIL ]
Check 14  Dual Variant Checks                 [ PASS / SKIP ]
Check 15  Post-Completion Hard Gate           [ PASS / FAIL ]
Check 16  Test Traceability Report            [ PASS / FAIL / SKIP ]

Overall: PASS / FAIL
```

For each FAIL: list specific issues and what needs to change.

**If all pass**: "Template validation complete for {variant} variant. All checks passed."

**If any fail**: "Template validation found {N} issue(s). Resolve before proceeding." List issues.

---

## Note on Factory Validation

After template validation passes, the factory orchestrator runs its own gates (FAC-S4-* and FAC-S5-*) covering standards compliance, DDL alignment, UC/TC coverage, and cross-stage consistency. Template validation passing is a prerequisite for: but does not replace: factory validation.
