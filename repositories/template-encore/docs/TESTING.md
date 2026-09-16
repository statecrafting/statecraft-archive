# Testing Documentation

## Overview

The template uses a layered testing strategy: fast unit tests, `encore check` for the backend application
graph, and a few end-to-end browser tests.

## Testing Stack

| Test Type | Tool | Purpose | Location |
|-----------|------|---------|----------|
| Backend graph/type check | `encore check` | Parse, resolve service topology, type-check, apply migrations | `apps/api` |
| Unit (backend) | Vitest | Test `lib/` primitives and endpoint logic | `apps/api/**/*.test.ts` |
| Unit (frontend) | Vitest + happy-dom + @vue/test-utils | Components, stores | `apps/web*/src/**/*.test.ts` |
| E2E | Playwright | User flows in a real browser | `e2e/` |
| Type Checking | TypeScript / `vue-tsc` | Compile-time safety | all `.ts`/`.vue` |
| Linting / Formatting | ESLint / Prettier | Code quality and style | all files |

## Testing Pyramid

```
        /\
       /E2E\         Few   - slow, browser-level
      /------\
     / encore \      backend graph + topology (encore check)
    /----------\
   /   Unit     \    Many  - fast, isolated
  /--------------\
```

## Backend: `encore check`

The backend's primary fast feedback is `encore check`, which parses the Encore app, resolves the service
graph and endpoint topology, type-checks, and applies migrations against an ephemeral Postgres:

```bash
npm run typecheck:api          # encore check (from root)
# or
cd apps/api && encore check
```

This is the first thing to run after changing endpoints, services, or migrations. CI runs it in the `api`
job of `encore-ci.yml`.

## Unit Testing

### Backend units (Vitest in `apps/api`)

`apps/api` runs Vitest with the node environment (`vitest.config.ts`, `--passWithNoTests`). Test the `lib/`
security primitives and endpoint helpers directly:

```typescript
// apps/api/lib/roles.test.ts
import { describe, it, expect } from "vitest"
import { hasRole } from "./roles"

describe("hasRole", () => {
  it("matches any-of membership, not a hierarchy", () => {
    expect(hasRole(["user"], ["admin", "user"])).toBe(true)   // any-of
    expect(hasRole(["user"], "admin")).toBe(false)            // user is NOT below admin
  })
})
```

```bash
cd apps/api && npm test            # vitest --passWithNoTests
```

For endpoint behavior that needs the database, prefer an integration-style test that runs under `encore test`
(Encore wires an ephemeral DB), or unit-test the extracted pure logic and rely on `encore check` plus E2E for
wiring.

### Frontend units (Vitest + Vue Test Utils)

```typescript
// apps/web/src/stores/auth.store.test.ts
import { setActivePinia, createPinia } from "pinia"
import { beforeEach, describe, it, expect, vi } from "vitest"
import { useAuthStore } from "./auth.store"

beforeEach(() => setActivePinia(createPinia()))

describe("auth store", () => {
  it("reads the bare MeResponse from /auth/me", async () => {
    // mock the HTTP layer; the Encore API returns the bare user object (no { success, data } envelope)
    // ...assert store.user is populated and getters.isAuthenticated is true
  })
})
```

Use a fresh `createPinia()` per test and mock the HTTP layer. The store reads bare payloads and Encore
`{ code, message, details }` errors (spec 006).

```bash
npm test                                   # all workspaces
npm test --workspace=apps/web              # one workspace
```

### Best practices

1. AAA pattern (Arrange, Act, Assert).
2. One behavior per test; descriptive names.
3. Mock external dependencies (HTTP, IdP).
4. Test edge cases and error handling.
5. Test behavior, not implementation details.

## End-to-End Testing (Playwright)

```bash
npm run test:e2e
npm run test:e2e -- --headed
npm run test:e2e -- --ui
```

```typescript
// e2e/auth-flow.spec.ts
import { test, expect } from "@playwright/test"

test("redirects unauthenticated users to login", async ({ page }) => {
  await page.goto("/profile")
  await expect(page).toHaveURL(/\/login/)
})

test("completes the mock auth flow", async ({ page }) => {
  await page.goto("/login")
  await page.getByRole("button", { name: "Casey User (user)" }).click()
  await expect(page).toHaveURL("/")
})
```

Playwright's `webServer` runs `npm run dev` and waits on http://localhost:5173. E2E exercises the real
Encore API on port 4000 through the Vite proxy.

## Continuous Integration

CI is provided by the spec spine and the Encore app workflows; there is no hand-maintained `test.yml`:

- **`.github/workflows/ci.yml`** (spine orchestrator): Rust build/clippy/test, spec-lint, codebase-index
  staleness, spec/code coupling, supply-chain, AI PR review. Aggregated into the required `ci-gate`.
- **`.github/workflows/encore-ci.yml`** (spec 007): `web` (type-check both SPAs + `build:web`), `api`
  (`encore check`), `client-staleness` (regenerate the typed client and fail on drift). Currently advisory;
  promotion to a required gate is tracked separately.

## Coverage

Aim for high coverage on the `lib/` security primitives and the Pinia stores; rely on `encore check` plus E2E
for endpoint wiring. Generate a local report:

```bash
cd apps/api && npm test -- --coverage
```

## Troubleshooting

```bash
# Backend graph errors
cd apps/api && encore check

# Flaky / slow E2E
npm run test:e2e -- --repeat-each=5
npm run test:e2e -- --trace=on
npx playwright show-trace trace.zip
```

If `encore check` cannot start a database, ensure Docker is running.

## Additional Resources

- [Vitest](https://vitest.dev/) · [Playwright](https://playwright.dev/) · [Vue Test Utils](https://test-utils.vuejs.org/)
- [Encore.ts testing](https://encore.dev/docs/ts/develop/testing)
- [CODEMAP.md](../CODEMAP.md) · [DEVELOPMENT.md](DEVELOPMENT.md)

---

**Last Updated**: 2026-06-24
