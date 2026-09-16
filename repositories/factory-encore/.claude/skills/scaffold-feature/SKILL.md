---
name: scaffold-feature
description: Build one new Vue + Encore feature (API service and/or Vue view) following the template's established Encore.ts, Pinia, and PrimeVue patterns, with tests written alongside.
---

# Skill: Scaffold Feature

Build one new feature following established Encore template patterns. This skill covers:

- **API side**: Encore service directory (Section A + F1/F2)
- **UI side**: Vue view, Pinia store, router, and nav (Sections B/C + F3/F4)
- **Both**: execute all sections that apply

You can build the API side, the UI side, or both in a single invocation. Identify the sections to execute based on what is needed.

**Input**: Feature name, which targets to build (api | ui | both), and any relevant requirements.

---

## Before You Start

1. Confirm which targets this feature touches:
   - Backend code goes in `apps/api/<service>/`
   - Public SPA code goes in `apps/web/src/`
   - Staff SPA code goes in `apps/web-internal/src/`

   The repository has three targets: `apps/api` (Encore backend), `apps/web` (public SPA), and `apps/web-internal` (staff SPA). A feature may touch one, two, or all three.

2. Read `CODEMAP.md` to confirm current patterns.

3. Identify the sections to execute:
   - **API work** -> Section A (service directory), then F1/F2 (tests)
   - **UI work** -> Section B (view), C (shared types), then F3/F4 (tests)
   - **Shared type or schema only** -> Section C
   - **Composable or utility** -> Section D

---

## Section A: API Feature (Backend: Encore service directory)

**Target**: `apps/api/<service-name>/`

> **Pre-generation quality gate**: before writing any code, follow the code-quality skill if not already read. Key rules for Encore service code: `await` every async call (`no-floating-promises`), no `any` types, use `logger` not `console.log`, guard array access with `?.` or null checks.

**The unit of composition in Encore is a service directory.** A new feature = a new directory containing `encore.service.ts` (service declaration + middleware) + endpoint files (`api()` / `api.raw()`) + `model.ts` (tagged-template queries) + `types.ts`. Encore discovers it automatically; register nothing in `app.ts` (there is no `app.ts`).

### A1. Define Types

```typescript
// apps/api/<service-name>/types.ts
export interface FeatureName {
  id: string
  // fields from requirements
}

export interface CreateFeatureNameRequest {
  // fields for creation
}

export interface CreateFeatureNameResponse {
  featureName: FeatureName
}
```

Types used across multiple services can live in `apps/api/lib/` (e.g., shared enums or utility types).

### A2. Create the Service Declaration

```typescript
// apps/api/<service-name>/encore.service.ts
import { Service } from 'encore.dev/service'
import { securityHeaders } from '../lib/security-headers'
import { csrfMiddleware } from '../lib/csrf'
import { apiRateLimit } from '../lib/rate-limit'

export default new Service('<service-name>', {
  middlewares: [securityHeaders, csrfMiddleware, apiRateLimit],
})
```

Encore discovers this service at compile time from the filesystem. No registration elsewhere.

**Middleware selection**: Most feature services compose the same chain as the `auth` service (`securityHeaders`, `csrfMiddleware`, `apiRateLimit`). Unauthenticated services (like `health`) may use `securityHeaders` only. Confirm with `apps/api/auth/encore.service.ts` as the reference.

### A3. Create Endpoints

```typescript
// apps/api/<service-name>/<feature>.ts
import { api, APIError, Query } from 'encore.dev/api'
import { getAuthData } from '~encore/auth'
import { requireRole } from '../lib/roles'
import * as model from './model'
import type { FeatureName, CreateFeatureNameRequest, CreateFeatureNameResponse } from './types'

interface ListParams {
  page?: Query<number>
  limit?: Query<number>
  search?: Query<string>
}

interface ListResponse {
  items: FeatureName[]
  total: number
}

export const listFeatureNames = api(
  { expose: true, auth: true, method: 'GET', path: '/api/v1/<resource>' },
  async ({ page, limit, search }: ListParams): Promise<ListResponse> => {
    const auth = getAuthData()!
    requireRole(auth.roles, 'user', 'admin')
    const p = page && page > 0 ? page : 1
    const l = limit && limit > 0 ? Math.min(limit, 100) : 20
    const { rows, total } = await model.listFeatureNames(l, (p - 1) * l, search)
    return { items: rows, total }
  },
)

export const createFeatureName = api(
  { expose: true, auth: true, method: 'POST', path: '/api/v1/<resource>' },
  async (req: CreateFeatureNameRequest): Promise<CreateFeatureNameResponse> => {
    const auth = getAuthData()!
    requireRole(auth.roles, 'admin')
    const item = await model.createFeatureName(req, auth.userID)
    return { featureName: item }
  },
)
```

**Key rules:**
- `auth: true` endpoints are gated by the Encore `authHandler` + `Gateway` automatically
- `getAuthData()!` returns the `AuthData` populated by the authHandler: always non-null inside `auth: true` endpoints
- `requireRole(auth.roles, 'role-a', 'role-b')` is any-of membership: throws `APIError` if none of the listed roles are present (INV-1)
- Errors use `APIError` (Encore's error type): `APIError.notFound(...)`, `APIError.invalidArgument(...)`, etc.
- No Express `Request`/`Response` objects, no middleware parameter signatures

### A3b. AUTH-007 Role-Scoped Data for Multi-Role Endpoints

**Applies when**: an endpoint must be accessible to both external users and staff, but must return different data to each caller based on their roles.

In the Encore model there is no BFF proxy layer passing forwarded headers; the authHandler populates `AuthData` directly for every authenticated caller. The AUTH-007 pattern is therefore simpler: require ALL roles (external user + staff), then scope the SQL query in the service layer based on `auth.roles`.

```typescript
// apps/api/<service-name>/<feature>.ts
export const listItems = api(
  { expose: true, auth: true, method: 'GET', path: '/api/v1/<resource>' },
  async ({ page, limit }: ListParams): Promise<ListResponse> => {
    const auth = getAuthData()!
    // Require at least one of: external user roles OR staff roles
    requireRole(auth.roles, 'external', 'caseworker', 'admin')
    const p = page && page > 0 ? page : 1
    const l = limit && limit > 0 ? Math.min(limit, 100) : 20
    const { rows, total } = await model.listItems(l, (p - 1) * l, auth.roles, auth.userID)
    return { items: rows, total }
  },
)
```

**The scoping lives in `model.ts`:**

```typescript
// apps/api/<service-name>/model.ts
export async function listItems(
  limit: number,
  offset: number,
  roles: string[],
  userId: string,
): Promise<{ rows: Item[]; total: number }> {
  // External role A: scope to records owned by this user
  if (roles.includes('external-role-a')) {
    const result = await db.query<ItemRow>`
      SELECT * FROM app.items
      WHERE owner_user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    const countResult = await db.query<{ count: string }>`
      SELECT COUNT(*) AS count FROM app.items WHERE owner_user_id = ${userId}
    `
    return { rows: result.rows.map(toItem), total: parseInt(countResult.rows[0]?.count ?? '0', 10) }
  }

  // External role B: scope to records this user has an approved relationship to
  if (roles.includes('external-role-b')) {
    const result = await db.query<ItemRow>`
      SELECT i.* FROM app.items i
      JOIN app.relationships r ON r.item_id = i.item_id
      WHERE r.agent_user_id = ${userId} AND r.status = 'approved'
      LIMIT ${limit} OFFSET ${offset}
    `
    const countResult = await db.query<{ count: string }>`
      SELECT COUNT(*) AS count FROM app.items i
      JOIN app.relationships r ON r.item_id = i.item_id
      WHERE r.agent_user_id = ${userId} AND r.status = 'approved'
    `
    return { rows: result.rows.map(toItem), total: parseInt(countResult.rows[0]?.count ?? '0', 10) }
  }

  // Staff roles: unscoped list
  const result = await db.query<ItemRow>`
    SELECT * FROM app.items ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
  `
  const countResult = await db.query<{ count: string }>`SELECT COUNT(*) AS count FROM app.items`
  return { rows: result.rows.map(toItem), total: parseInt(countResult.rows[0]?.count ?? '0', 10) }
}
```

**Key rules:**
- Replace `external-role-a` / `external-role-b` with actual role codes from the business requirements
- Check external user roles first: fall through to the staff (unscoped) query last; this preserves existing staff behaviour when new external user roles are added later
- `auth.userID` is the caller's identity: always present for `auth: true` endpoints
- This pattern replaces the Express `bff-auth.middleware.ts` / `requireBffOrSessionAuth` / `req.session` / `X-Forwarded-User` approach entirely; Encore's authHandler already populates `AuthData` directly for every caller

### A4. Create Model (Database Access)

```typescript
// apps/api/<service-name>/model.ts
import { SQLDatabase } from 'encore.dev/storage/sqldb'

const db = new SQLDatabase('app', { migrations: './migrations' })
// OR reference the shared db service:
// import { db } from '../db/db'
// (use whichever pattern the existing services use: check apps/api/db/db.ts)

interface FeatureNameRow {
  feature_id: string
  feature_name: string
  created_by: string
  created_at: Date
}

function toFeatureName(row: FeatureNameRow): FeatureName {
  return {
    id: row.feature_id,
    name: row.feature_name,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  }
}

export async function listFeatureNames(
  limit: number,
  offset: number,
  search?: string,
): Promise<{ rows: FeatureName[]; total: number }> {
  if (search) {
    const result = await db.query<FeatureNameRow>`
      SELECT * FROM app.feature_names
      WHERE feature_name ILIKE ${'%' + search + '%'}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    const countResult = await db.query<{ count: string }>`
      SELECT COUNT(*) AS count FROM app.feature_names
      WHERE feature_name ILIKE ${'%' + search + '%'}
    `
    return { rows: result.rows.map(toFeatureName), total: parseInt(countResult.rows[0]?.count ?? '0', 10) }
  }
  const result = await db.query<FeatureNameRow>`
    SELECT * FROM app.feature_names ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
  `
  const countResult = await db.query<{ count: string }>`SELECT COUNT(*) AS count FROM app.feature_names`
  return { rows: result.rows.map(toFeatureName), total: parseInt(countResult.rows[0]?.count ?? '0', 10) }
}

export async function createFeatureName(
  req: CreateFeatureNameRequest,
  userId: string,
): Promise<FeatureName> {
  const result = await db.query<FeatureNameRow>`
    INSERT INTO app.feature_names (feature_name, created_by)
    VALUES (${req.name}, ${userId})
    RETURNING *
  `
  const row = result.rows[0]
  if (!row) throw new Error('Insert returned no row')
  return toFeatureName(row)
}
```

**Database query contract (INV-2):**
- Use tagged-template queries ONLY: `` db.query`... WHERE id = ${id}` `` (auto-parameterized, SQL injection safe)
- Never concatenate SQL strings
- The shared `SQLDatabase("app")` instance is in `apps/api/db/db.ts`; import it from there rather than creating a new instance per service unless the service has its own migrations

### A5. Add a Migration (if the feature needs new tables)

```sql
-- apps/api/db/migrations/5_feature_name.up.sql  (number sequentially after existing migrations)
CREATE TABLE IF NOT EXISTS app.feature_names (
  feature_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_name  TEXT NOT NULL,
  created_by    UUID NOT NULL REFERENCES app.user_account (pk_user_account),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Migrations are applied automatically by Encore on `encore run` / deploy. No manual runner needed in development.

### A6. Update OpenAPI Specification (if maintained)

If the project maintains an OpenAPI spec (`apps/api/openapi.yaml`), update it for each new endpoint.

---

## Section B: Vue Feature (Frontend)

**Target**: `apps/web/src/` (public SPA) or `apps/web-internal/src/` (staff SPA), or both.

> **Pre-generation quality gate**: follow the code-quality skill before writing any Vue or store code. Key rules: no `any` in stores, `await` every async action, use named slot syntax (`<template #slotName>`) for PrimeVue components such as `Card` (`#title`, `#content`).

### B1. Create View

```vue
<!-- apps/web{-internal}/src/views/FeatureNameView.vue -->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import Card from 'primevue/card'
import Message from 'primevue/message'
import { useAuthStore } from '@/stores/auth.store'
import { useFeatureNameStore } from '@/stores/feature-name.store'

const auth = useAuthStore()
const store = useFeatureNameStore()
const isLoading = ref(false)
const error = ref<string | null>(null)

onMounted(async () => {
  await store.fetchAll()
})
</script>

<template>
  <div class="feature-name-view">
    <Message v-if="error" severity="error" :closable="false">
      <strong>Error</strong>
      <p>{{ error }}</p>
    </Message>
    <Card>
      <template #title>Feature Title</template>
      <template #content>
        <!-- PrimeVue components: import each one per-SFC from 'primevue/<component>' -->
      </template>
    </Card>
  </div>
</template>
```

**Page UX guidance**: views should follow the relevant page's UX conventions and use PrimeVue components (per-SFC imports from `primevue/<component>`). All internal views render inside the PrimeVue sidebar layout (`AppLayout.vue`). Do NOT add a sidebar or navigation chrome inside individual views: `AppLayout.vue` provides that. Views provide only their page content.

**View rules:**
- `<script setup lang="ts">`: no Options API
- PrimeVue components imported per-SFC (e.g. `import Card from 'primevue/card'`). No third-party design-system imports.
- Exactly one `<h1>` per view
- No direct API calls: use Pinia stores
- Add `data-testid` attributes to interactive elements for E2E testing

### B2. Create Pinia Store (if needed)

Only if state is shared across views. The Encore app returns typed payloads directly (no `{ success, data }` wrapper: Encore endpoints return the bare response type). Encore errors use `{ code, message, details }` shape.

```typescript
// apps/web{-internal}/src/stores/feature-name.store.ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'
import type { FeatureName } from '@/types/feature-name'

export const useFeatureNameStore = defineStore('featureName', () => {
  const items = ref<FeatureName[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const total = ref(0)

  async function fetchAll(page = 1, limit = 20) {
    isLoading.value = true
    error.value = null
    try {
      const { data } = await axios.get<{ items: FeatureName[]; total: number }>(
        `/api/v1/<resource>?page=${page}&limit=${limit}`
      )
      items.value = data.items
      total.value = data.total
    } catch (e: unknown) {
      // Encore error shape: { code, message, details }
      const err = e as { response?: { data?: { message?: string } } }
      error.value = err.response?.data?.message ?? 'Failed to load'
    } finally {
      isLoading.value = false
    }
  }

  return { items, isLoading, error, total, fetchAll }
})
```

**Note on response shapes**: Encore typed endpoints return the bare payload (e.g., `{ items: FeatureName[], total: number }`). The Express-era `{ success: true, data: ... }` / `{ success: false, error: ... }` envelope is retired. Store error handling reads `e.response?.data?.message` (Encore's `{ code, message, details }` error shape).

> **Axios URL rule**: All axios calls use **relative paths** (`/api/v1/...`). Never hardcode `http://localhost:4000` in Vue files. The Vite proxy routes `/api/*` to the correct Encore backend.

### B3. Register Route

In `apps/web{-internal}/src/router/index.ts`:

```typescript
{
  path: '/feature-path',
  name: 'FeatureName',
  component: () => import('@/views/FeatureNameView.vue'),
  meta: { requiresAuth: true },
}
```

### B4. Add Navigation (if appropriate)

In `useNavigation.ts` or via the nav registration mechanism:

```typescript
registerNavItem({
  id: 'nav-feature-name',
  label: 'Feature Name',
  to: '/feature-path',
  position: 'left',
  priority: 30,
})
```

---

## Section C: Shared Type or Schema

For types used only within `apps/api`, define them in the service's `types.ts`. For types shared between the Encore app and the SPAs, define them in `packages/shared/src/types/`.

1. Create in `packages/shared/src/types/` or `packages/shared/src/schemas/`
2. Export from `packages/shared/src/index.ts`
3. Rebuild: `npm run build -w packages/shared`

---

## Section D: Composable or Utility

```typescript
// apps/web{-internal}/src/composables/useFeatureName.ts
import { ref, computed } from 'vue'

export function useFeatureName() {
  return { /* expose only what callers need */ }
}
```

Composables: `use` prefix. Utilities (non-reactive): `src/utils/`.

---

## Section F: Test Code

Tests are written **alongside** the code: not after. A function is not done until its test is written and passing.

If your project tracks requirement IDs, annotate each test with a stable identifier for that requirement (one line per test is sufficient).

### F1. Service Tests (Encore endpoints)

Encore endpoints are regular async functions that receive typed request objects and return typed response objects. Test them by calling the function directly (no HTTP layer needed).

```typescript
// apps/api/<service-name>/<feature>.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listFeatureNames } from './<feature>'
import * as model from './model'

// Mock the model layer so tests do not touch a real database
vi.mock('./model', () => ({
  listFeatureNames: vi.fn(),
}))

// Mock Encore auth
vi.mock('~encore/auth', () => ({
  getAuthData: vi.fn().mockReturnValue({
    userID: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    roles: ['admin'],
    ssoProvider: 'mock',
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listFeatureNames', () => {
  it('returns mapped items for admin caller', async () => {
    vi.mocked(model.listFeatureNames).mockResolvedValueOnce({
      rows: [{ id: 'abc-123', name: 'Test Feature', createdBy: 'user-1', createdAt: '2026-01-01T00:00:00Z' }],
      total: 1,
    })
    const result = await listFeatureNames({ page: 1, limit: 20 })
    expect(result.items).toHaveLength(1)
    expect(result.total).toBe(1)
    expect(model.listFeatureNames).toHaveBeenCalledOnce()
  })

  it('throws APIError when role is insufficient', async () => {
    // Override auth mock to return a caller without the required role
    const { getAuthData } = await import('~encore/auth')
    vi.mocked(getAuthData).mockReturnValueOnce({
      userID: 'user-2',
      email: 'guest@example.com',
      name: 'Guest',
      roles: [],
      ssoProvider: 'mock',
    })
    await expect(listFeatureNames({ page: 1, limit: 20 })).rejects.toThrow()
  })
})
```

**Service test rules:**
- One `describe` block per exported endpoint function
- Cover the happy path, the role-failure path, and the not-found path
- Do not assert on SQL strings: assert on the mapped output shape

### F1b. Model Tests (database layer)

Mock the `db.query` tagged-template function from `encore.dev/storage/sqldb`.

```typescript
// apps/api/<service-name>/model.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listFeatureNames } from './model'

// Mock the SQLDatabase query method
const mockQuery = vi.fn()
vi.mock('encore.dev/storage/sqldb', () => ({
  SQLDatabase: vi.fn().mockImplementation(() => ({ query: mockQuery })),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listFeatureNames', () => {
  it('returns mapped rows when database returns data', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ feature_id: 'abc', feature_name: 'Test', created_by: 'u1', created_at: new Date() }],
      })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
    const result = await listFeatureNames(20, 0)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.id).toBe('abc')
    expect(result.total).toBe(1)
  })

  it('returns empty rows when database is empty', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
    const result = await listFeatureNames(20, 0)
    expect(result.rows).toHaveLength(0)
    expect(result.total).toBe(0)
  })
})
```

### F2. Endpoint Type Verification

Run `encore check` after each new service to verify the application graph, topology, and types:

```bash
cd apps/api
npx encore check
```

**Pass**: Exit 0 with no errors. This is the backend type-check gate, replacing `tsc` for the Encore app.

### F3. Vue Store Tests

```typescript
// apps/web{-internal}/src/stores/feature-name.store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import axios from 'axios'
import { useFeatureNameStore } from './feature-name.store'

vi.mock('axios')

beforeEach(() => { setActivePinia(createPinia()) })

describe('useFeatureNameStore', () => {
  it('loads items on fetchAll', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { items: [{ id: '1', name: 'Test' }], total: 1 }
    })
    const store = useFeatureNameStore()
    await store.fetchAll()
    expect(store.items).toHaveLength(1)
    expect(store.isLoading).toBe(false)
  })

  it('sets error on fetch failure using Encore error shape', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce({
      response: { data: { code: 'not_found', message: 'Not found' } }
    })
    const store = useFeatureNameStore()
    await store.fetchAll()
    expect(store.error).toBe('Not found')
  })
})
```

### F4. Vue Component Tests (views)

```typescript
// apps/web{-internal}/src/views/FeatureNameView.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import FeatureNameView from './FeatureNameView.vue'

describe('FeatureNameView', () => {
  it('renders the page heading', () => {
    const wrapper = mount(FeatureNameView, {
      global: { plugins: [createTestingPinia()] },
    })
    expect(wrapper.find('h1').exists()).toBe(true)
  })

  it('shows loading state while fetching', () => {
    const wrapper = mount(FeatureNameView, {
      global: {
        plugins: [createTestingPinia({ initialState: { featureName: { isLoading: true } } })],
      },
    })
    expect(wrapper.find('[data-testid="loading"]').exists()).toBe(true)
  })
})
```

### F5. E2E Tests (multi-page flows only)

```typescript
// e2e/<feature-name>.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Feature Use Case Flow', () => {
  test('user completes the flow', async ({ page }) => {
    await page.goto('/')
    await page.click('[data-testid="nav-feature-name"]')
    await expect(page).toHaveURL('/feature-path')
  })
})
```

---

## Section G: PrimeVue Component Patterns

PrimeVue components are imported per-SFC and typed via the `primevue` package. No wrapper layer or global type declaration file is required.

### G1. Select / Dropdown

Use `Select` (not a custom wrapper). Options are an array bound to `:options`:

```vue
<script setup lang="ts">
import Select from 'primevue/select'

const value = ref('')
const options = [
  { label: 'Label A', value: 'VALUE_A' },
  { label: 'Label B', value: 'VALUE_B' },
]
</script>

<template>
  <Select
    v-model="value"
    :options="options"
    option-label="label"
    option-value="value"
    placeholder="Select an option"
  />
</template>
```

### G2. Callout / Message

Use `Message` for inline callouts:

```vue
<script setup lang="ts">
import Message from 'primevue/message'
</script>

<template>
  <!-- severity: "info" | "warn" | "error" | "success" -->
  <Message severity="warn" :closable="false">
    <strong>Important notice</strong>
    <p>Review the information before proceeding.</p>
  </Message>
</template>
```

### G3. Card Container

Use `Card` with `#title` and `#content` named slots:

```vue
<script setup lang="ts">
import Card from 'primevue/card'
</script>

<template>
  <Card>
    <template #title>Section Heading</template>
    <template #content>
      <!-- page content here -->
    </template>
  </Card>
</template>
```

### G4. Quick Component Reference

| PrimeVue component | Import | Key props |
|--------------------|--------|-----------|
| `<Message severity="warn">` | `primevue/message` | `severity` (`info` / `warn` / `error` / `success`), `:closable="false"` |
| `<Card>` | `primevue/card` | `#title`, `#content` slots |
| `<Button label="...">` | `primevue/button` | `label`, `icon`, `severity` (`secondary`, etc.), `@click` |
| `<Tag value="X" severity="success"/>` | `primevue/tag` | `value`, `severity` |
| `<InputText v-model/>` | `primevue/inputtext` | `v-model` |
| `<Checkbox v-model binary/>` | `primevue/checkbox` | `v-model`, `binary` |
| `<Select :options optionLabel optionValue v-model/>` | `primevue/select` | `options`, `optionLabel`, `optionValue` |
| `<DataTable :value><Column field header/></DataTable>` | `primevue/datatable`, `primevue/column` | `field`, `header` |

---

## Final Checklist

- [ ] `types.ts` defined in the service directory
- [ ] `encore.service.ts` created (Service declaration + middleware array)
- [ ] Endpoint file(s) created with typed `api()` functions
- [ ] `auth: true` + `requireRole(getAuthData()!.roles, ...)` on every protected endpoint
- [ ] `model.ts` created with tagged-template `db.query` calls only (no SQL string concatenation)
- [ ] Migration added to `apps/api/db/migrations/` if new tables needed (numbered sequentially)
- [ ] `encore check` passes (run from `apps/api/`)
- [ ] For AUTH-007 multi-role endpoints: `requireRole` lists ALL applicable roles; model branches on `auth.roles` and scopes the WHERE clause per external user role
- [ ] Response shapes use Encore's bare payload (no `{ success, data }` wrapper)
- [ ] Vue view with `<script setup lang="ts">` and PrimeVue components (per-SFC imports)
- [ ] Pinia store reads Encore error shape `{ code, message, details }`: not the Express `{ success, error }` envelope
- [ ] All axios calls use relative paths (`/api/v1/...`): no hardcoded `localhost:4000`
- [ ] Endpoint tests written and passing (model mock + auth mock)
- [ ] Store/component tests written and passing
- [ ] Select/dropdown uses PrimeVue `Select` with `:options`, `optionLabel`, `optionValue`, and `v-model`
- [ ] No third-party design-system component imports anywhere in the SPA
- [ ] No `any` types outside test files
- [ ] No `console.log`: use `logger` from `encore.dev/log`
- [ ] Route registered in `router/index.ts` with lazy loading
- [ ] Navigation item added if the page appears in the nav
- [ ] E2E test if multi-page flow

---

**Post-feature verification (run after EVERY feature):**

```bash
# Backend graph + topology + types
cd apps/api && npx encore check

# Lint the affected SPA workspace
npm run lint -- --max-warnings 0

# Run tests
npm test --workspaces --if-present
```

All three MUST pass before moving to the next feature.

---

**Report**: "Feature '{name}' scaffolded. Files created: [list]. Checklist: [status]."
