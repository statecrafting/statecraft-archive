---
name: validate-and-fix
description: Run the project's local CI loop (`make ci`) and automatically fix discovered issues using concurrent agents
allowed-tools: Bash, Agent, Read, Edit, Glob, Grep
---

# Validate and Fix

Run the local CI loop and automatically fix discovered issues. `make ci` covers the same gate set as the GitHub Actions workflows in this repo — if `make ci` passes locally, CI will pass too.

## Process

### 1. Run the local CI loop

Invoke `make ci` from the repo root. The `Makefile` is the **single source of truth** for what CI validates. Do not rediscover validation commands by grepping `package.json` or CLAUDE.md — the Makefile already enumerates every gate the CI workflows enforce.

`make ci` composes the gates sequentially:

- **`spine`** — runs all four governance verbs in order:
  - `make spine-compile`: `npx spec-spine compile` — compiles the spec registry.
  - `make spine-lint`: `npx spec-spine lint --fail-on-warn` — corpus conformance lint; a warning is a failure.
  - `make spine-index-check`: `npx spec-spine index check` — staleness gate for the codebase index.
  - `make spine-couple`: `npx spec-spine couple --base origin/main` — spec/code coupling gate; refuses owned-path changes whose owning spec is not in the diff.
  Mirrors `.github/workflows/spec-spine.yml`.
- **`npm run lint`** — TypeScript/Vue linter across the workspace.
- **`npm run typecheck`** — TypeScript type-check across apps and packages.
- **`npm test`** — Vitest suite across workspaces.
- **`tools/lint/workflow-pins-test.sh`** — validates GitHub Actions workflow steps are SHA-pinned (spec 011).

Pre-commit gate (separate from `make ci`):

- **`make pr-prep`** — regenerates the `.derived/codebase-index/` shards (`make spine-index`) and runs the coupling gate (`make spine-couple`). Run this immediately before `git commit` on a PR. If the index drifted, stage the regenerated artifact.

**If a check is missing, add it to the Makefile and the relevant workflow in the same change.** Never introduce a new validation via a one-off script.

Capture full output — file paths, line numbers, error messages. Categorize findings:

- **CRITICAL** — security issues, breaking changes, data loss risk, coupling-gate failure (spec 000 FR-07: an owned path changed without its owning spec).
- **HIGH** — functionality bugs, test failures, build breaks, `npx spec-spine index check` staleness.
- **MEDIUM** — `npx spec-spine lint` warnings (the gate runs `--fail-on-warn`, so warnings ARE failures here), TypeScript errors, lint rule violations.
- **LOW** — formatting, minor optimizations.

### 2. Strategic Fix Execution

#### Phase 1 — Safe Quick Wins
- Start with LOW and MEDIUM findings that can't break anything.
- Verify each fix by re-running the narrowest affected target (e.g. `make spine-lint` after a spec.md edit, `npm run lint` after a TypeScript style fix).

#### Phase 2 — Functionality Fixes
- Address HIGH findings one at a time.
- Run the affected sub-target after each fix to confirm no regressions.

#### Phase 3 — Critical Issues
- Handle CRITICAL findings with explicit user confirmation.
- Provide a detailed plan before executing.
- Spec/code coupling failures need spec/code judgement: refusing the destructive sub-step is sometimes the right answer (see `.claude/rules/adversarial-prompt-refusal.md`).

#### Phase 4 — Verification
- Re-run the full `make ci` composite to confirm end-to-end pass.
- Provide summary of what was fixed vs. what remains.

### 3. Comprehensive Error Handling

#### Rollback Capability
- Create a git stash checkpoint before ANY changes: `git stash push -m "pre-validate-and-fix"`
- Provide instant rollback procedure if fixes cause issues.

#### Partial Success Handling
- Continue execution even if some fixes fail.
- Clearly separate successful fixes from failures.
- Provide manual fix instructions for unfixable issues.

#### Quality Validation
- Accept 100% success in each phase before proceeding.
- If a phase fails, diagnose and provide specific next steps.

#### Governed reads
- Read compiled artifacts under `.derived/**` only through `npx spec-spine` verbs (`npx spec-spine registry …`, `npx spec-spine index check`). Ad-hoc parsing with `python` / `jq` / `awk` / `sed` is a workflow violation per `.claude/rules/governed-artifact-reads.md`.

### 4. Parallel Execution

Launch multiple agents concurrently for independent, parallelizable tasks:
- **CRITICAL**: Include multiple Agent tool calls in a SINGLE message ONLY when tasks can be done in parallel.
- Parallelizable: fixes in different packages (one agent per failing package), independent test suites, non-overlapping spec edits.
- Sequential: shared-interface changes across packages, ordered phases, anything mutating a cross-package type contract.
- Each parallel agent must have non-overlapping file responsibilities.
- Each agent verifies its fix by re-running the relevant sub-target before reporting complete.

### 5. Final Verification

After all agents complete:
- Re-run `make ci` to confirm the full local CI pass.
- Confirm no new issues were introduced by fixes.
- Report any remaining manual fixes needed with specific instructions.
- Summary: `Fixed X/Y issues, Z require manual intervention — make ci: {PASS|FAIL}`

## Substrate-specific notes

- `npx spec-spine lint` runs with `--fail-on-warn` (spec 000). A warning is a failure here.
- The coupling gate compares `HEAD` against `origin/main`. If `origin/main` is not fetched, the gate cannot run — `git fetch origin main` first.
- The codebase index hashes more than `spec.md`. Its inputs include `package.json`, npm workspace manifests, `specs/*/spec.md`, `spec-spine.toml`, `standards/**`, `.github/workflows/**`, `.github/actions/**`, `.claude/**`, `.mcp.json`, `.githooks/**`, and `tools/lint/**`. Edits to any of these without a regenerated index fail the staleness check.
- `.claude/settings.json` and `.mcp.json` are hashed byte-for-byte. Editor reformatting trips the staleness gate even when JSON semantics are unchanged — edit in place, do not reformat.


---

## Born-with quality checklist (checks 0–15)

These checks are owned by this product (acme-vue-encore). Run them after feature work to verify the implementation is sound; the mechanized subset is also enforced by `make ci`.

---

### Check 0: Install and Package Build

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

### Check 1: Placeholder Completeness

Search for `{{` across all files (excluding `node_modules/`, `dist/`, `.git/`).

| Found in | Verdict |
|----------|---------|
| `.env.example`, `apps/api/.env.example` | OK: these are documentation |
| `apps/api/.env`, `apps/web/.env` (working files) | **FAIL**: must be filled or removed |
| Any `.ts`, `.vue`, `.json` source file | **FAIL**: hard failure |

**Pass**: No `{{...}}` in working env files or source code.

---

### Check 2: Encore Application Graph (`encore check`)

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

### Check 3: TypeScript Strict Mode (SPAs and Packages)

Run typecheck for each active workspace:

```bash
npm run typecheck --workspace=packages/shared
npm run typecheck --workspace=apps/web
npm run typecheck --workspace=apps/web-internal
```

**Pass**: Zero TypeScript errors across all workspaces.

Do not suppress with `// @ts-ignore` or `as any`. The only acceptable `any` uses are in test files.

---

### Check 4: ESLint Zero Warnings

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

### Check 5: Prettier Formatting

```bash
npm run format:check
```

**Pass**: Zero formatting differences.

Fix: `npm run format`

---

### Check 6: Package Build

```bash
npm run build:packages
```

**Pass**: `shared` (and any other active packages) produce `dist/` with zero errors.

---

### Check 7: App Build

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

### Check 8: Unit Tests

#### 8a. Run all tests

```bash
npm test --workspaces --if-present
```

Also run tests inside the Encore app:

```bash
cd apps/api && npm test && cd ../..
```

**Pass**: Zero test failures across all workspaces.

#### 8b. Business logic coverage gate

Verify that every Encore endpoint file and model file added during feature work has a corresponding test file:

```bash
# List endpoint files that have no matching test
for f in apps/api/*/*.ts; do
  [[ "$f" == *".test.ts" ]] && continue
  [[ "$f" == *"encore.service.ts" ]] && continue
  [[ "$f" == *"types.ts" ]] && continue
  test_file="${f%.ts}.test.ts"
  [[ ! -f "$test_file" ]] && echo "MISSING TEST: $test_file"
done
```

**Pass**: No `MISSING TEST:` lines. Every endpoint file and model file has a `.test.ts` sibling.

#### 8c. Fail loop: do not proceed with failing tests

If any test fails:

1. Read the failure output: identify the specific assertion and file
2. Determine whether the **code is wrong** or the **test is wrong**
3. Fix the identified side, re-run
4. Repeat until all tests pass: never skip or delete a failing test
5. Only then proceed to Check 9

---

### Check 9: Orphan Detection

For each item removed during trim:

1. Search for removed endpoint paths (e.g., `/api/v1/about`) in Pinia store axios calls and Vue router
2. Search for removed file names in all import statements
3. Search for removed npm packages in `package.json` files

**Pass**: No orphaned references found.

---

### Check 10: Environment Variable Coverage

1. Search `apps/api/` source files for `process.env.` references
2. Compare against `apps/api/.env.example` entries
3. Any `process.env.X` in source but not in `.env.example` is undocumented

**Pass**: Every `process.env.X` in `apps/api/` has a corresponding `.env.example` entry. Encore secrets are declared in `lib/secrets.ts` and bound in `infra.config.json`: verify all `secret('Name')` calls have a matching `$env` binding in `infra.config.json`.

---

### Check 11: Architecture Invariants

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

### Check 12: Route URL Alignment

For every API feature, verify the endpoint path in the Encore `api()` declaration matches the Pinia store's axios call path.

#### 12a. Encore endpoint path vs. Pinia store axios path

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

#### 12b. Field name alignment

For each shared DTO type, verify property names align with DDL column names via the project's naming convention (DDL `snake_case` vs. TypeScript `camelCase`):

1. Open each shared DTO type (e.g., `FeatureNameDto`)
2. For each property (e.g., `createdAt: string`), verify the model maps it from the DDL column (e.g., `created_at`)
3. Verify `db.query` column names match DDL exactly

**Pass**: Every shared type property traces to a DDL column, and every model maps between them.

---

### Check 13: AUTH-007 Role-Scoped Data Verification

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

### Check 14: Both-SPA Independence

Verify that both SPAs and the Encore app build and check independently:

- [ ] Encore app passes `encore check` in `apps/api/`
- [ ] Both Vue SPAs (`apps/web` and `apps/web-internal`) build independently
- [ ] `apps/web/vite.config.ts` Vite proxy target points to the Encore app port
- [ ] `apps/web-internal/vite.config.ts` Vite proxy target points to the Encore app port
- [ ] All Vue store axios calls use relative paths (`/api/v1/*`): no hardcoded `localhost` URLs
- [ ] No cross-app imports between `apps/web` and `apps/web-internal`

---

### Check 15: Post-Completion Hard Gate

> **This is the final quality gate. It MUST pass before the implementation is considered complete.**

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

### Output: Validation Report

```
TEMPLATE VALIDATION REPORT
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
Check 14  Both-SPA Independence               [ PASS / FAIL ]
Check 15  Post-Completion Hard Gate           [ PASS / FAIL ]

Overall: PASS / FAIL
```

For each FAIL: list specific issues and what needs to change.

**If all pass**: "Template validation complete. All checks passed."

**If any fail**: "Template validation found {N} issue(s). Resolve before proceeding." List issues.
