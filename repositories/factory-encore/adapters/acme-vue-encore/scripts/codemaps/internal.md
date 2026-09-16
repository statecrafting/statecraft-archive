# Codemap: Internal Application

> Architectural blueprint: execution flows, service graph, API surfaces, and component relationships.
> For developer onboarding and AI agent context. Reduces codebase to ~5% of tokens, ~90% of understanding.
>
> **Backend = Encore.ts.** The Express 5 BFF was retired in the Encore migration (specs 001 to 006).
> Auth driver for this profile: **rauthy OIDC** (`AUTH_DRIVER=rauthy`).

---

## Project Tree

```
my-internal-app/
├── apps/
│   ├── api/                       Encore.ts application (standalone; excluded from npm workspaces)
│   │   ├── encore.app             App manifest (global_cors, build.docker.bundle_source)
│   │   ├── infra.config.json      Secret + SQL bindings ($env); no secret values committed
│   │   ├── Dockerfile.base        OS + helper binaries for the image base
│   │   ├── Dockerfile.hotfix      Source-only fast-path image
│   │   ├── scripts/               generate-keys.ts (RSA JWT keys), migrate.mjs, docker-build.sh
│   │   ├── lib/                   ← `lib` service: shared security primitives (no endpoints)
│   │   │                            cookie-config, cookies, csrf, jwt, secrets, security-headers,
│   │   │                            rate-limit, audit, logger (PII guard), roles (hasRole/requireRole)
│   │   ├── db/                    ← `db` service: SQLDatabase("app") + migrations (no endpoints)
│   │   │   └── migrations/        1_extensions, 2_user_account, 3_refresh_token, 4_audit_log
│   │   ├── health/                ← `health` service: probes + /api/v1/info + /api/v1/csp-report
│   │   ├── auth/                  ← `auth` service: authHandler + Gateway; rauthy OIDC (internal profile)
│   │   │                            handler.ts, drivers.ts, rauthy.ts, mock.ts, me.ts, refresh.ts,
│   │   │                            logout.ts, csrf-token.ts, user-model.ts, refresh-token-model.ts
│   │   ├── gateway/               ← `gateway` service: api.raw BFF proxy /api/v1/data/*
│   │   │                            proxy.ts (catch-all; auth:true), token-cache.ts (S2S OAuth)
│   │   └── web/                   ← `web` service: api.static serving the built SPA
│   │
│   ├── web/                       Vue 3 SPA (public-facing; not primary for this profile)
│   │
│   └── web-internal/              Vue 3 SPA (staff-facing; PrimeVue)
│       └── src/
│           ├── main.ts            ← ENTRY POINT (frontend)
│           ├── router/            Routes + nav guards
│           ├── stores/            Pinia auth state (Encore-adapted)
│           ├── views/             HomeView, LoginView, ProfileView, ConnectivityTestView, AboutView
│           │                      admin/ (if user-management module: UserListView, UserDetailView)
│           ├── components/        Layout (AppHeader/Footer/Layout) built on PrimeVue
│           └── lib/               encore-client.ts (typed client reference)
│
├── packages/                      Reusable libraries (NOT consumed by the Encore backend)
│   └── shared/                    Types, Zod schemas, constants
│
├── modules/                       Optional domain modules; user-management ships as an Encore service
├── scripts/                       Generator + module CLI (setup-app.ts, add-module.ts, etc.)
├── docs/                          Auth, deployment, development, testing, troubleshooting
└── .env.example                   Dev config template; see apps/api/.env.example for Encore vars
```

> **Standalone backend.** `apps/api` has its own `package-lock.json` and `node_modules` and is
> excluded from root npm workspaces. It imports no `@template/*` package; all security primitives
> live in `apps/api/lib`.

---

## Tech Stack (Required)

All code added to this application **must** use these technologies. Do not introduce alternatives.

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Language** | TypeScript (strict) | All application/library/test code in TS. |
| **Frontend** | Vue 3 (Composition API + `<script setup>`) | Single-file components only. |
| **State** | Pinia | Stores in `apps/web-internal/src/stores/`. No Vuex. |
| **Routing** | Vue Router 4 | Lazy-load views: `() => import('./views/X.vue')` |
| **Styling** | PrimeVue | `primevue` + `@primevue/themes` (Aura preset, indigo primary); component-scoped CSS. No Tailwind. |
| **Backend** | **Encore.ts** | Typed `api()` / `api.raw()` endpoints; services discovered from `encore.service.ts`; `authHandler` + `Gateway`; service `middlewares` arrays. |
| **Auth** | **Stateless RS256 JWT + rauthy OIDC** | Access (~15 min) + DB-backed refresh (~7 day, rotation/revocation) in httpOnly cookies; CSRF double-submit. `AUTH_DRIVER=rauthy` for this profile. Not `express-session`. |
| **Persistence** | **Postgres via `SQLDatabase("app")`** | Tagged-template queries only. Redis is optional, for rate-limit backing only (`REDIS_URL`). |
| **Build** | Vite (frontend); `encore build docker` (backend) | `encore run --port=4000` for local dev. |
| **Testing** | Vitest (unit), Playwright (E2E) | `encore check` validates backend graph/topology/types. |
| **Linting** | ESLint 9 + Prettier | Flat config format. |

**Do NOT introduce**: Express/`express-session` (retired), session stores, Vuex, ORMs, Webpack, Joi/Yup, CSS-in-JS, Tailwind CSS, string-concatenated SQL.

---

## Service Graph

```
Encore application (apps/api) ════════════════════════════════════════════
  Gateway + authHandler (auth/handler.ts)   verifies access-token cookie | Bearer → AuthData{ roles, ... }
    │
    ├── lib       no endpoints; secret() declarations + shared middleware/utilities
    │             cookie-config, cookies, csrf, jwt, secrets, security-headers,
    │             rate-limit, audit, logger (PII guard), roles (hasRole/requireRole any-of)
    │
    ├── db        no endpoints; SQLDatabase("app") + migrations (1_extensions → 4_audit_log)
    │
    ├── health    securityHeaders only (probes/CSP are unauthenticated)
    │
    ├── auth      securityHeaders + csrfMiddleware + apiRateLimit
    │             authHandler + Gateway; driver = rauthy (internal profile); me/refresh/logout/csrf-token
    │
    ├── gateway   api.raw catch-all /api/v1/data/* (auth:true) → private backend (S2S OAuth)
    │
    ├── web       api.static → apps/api/web/build (SPA history fallback)
    │
    └── user-management   (optional module) Encore service directory; CRUD for users + roles;
                          migrations added to db/migrations/; endpoints under /api/v1/admin/*

Frontend (apps/web-internal) ═══════════════════════════════════════════════
  Vue 3 SPA ──► axios (+ encore-client.ts typed reference) ──► /api/v1/* (Vite proxy → :4000)
```

**Service discovery**: each directory exporting `Service(...)` via `encore.service.ts` is a service.
**Build order (packages + SPA)**: shared → config → auth → web-internal. The Encore app builds independently via `encore build docker`.

---

## API Surface (Type Signatures)

```typescript
// === apps/api/auth/handler.ts (Encore authHandler + Gateway) ===
interface AuthData { userID: string; email: string; name: string; roles: string[]; ssoProvider: string }
// authHandler validates the access-token cookie (or Authorization: Bearer); populates AuthData.
// Gateway({ authHandler }) gates every endpoint declared with `auth: true`.

// === apps/api/lib/jwt.ts ===
function signAccessToken(claims): Promise<string>          // RS256, ~15 min
function signRefreshToken(claims): Promise<string>         // RS256, ~7 day
function verifyAccessToken(token: string): Promise<Claims>

// === apps/api/lib/roles.ts ===
function hasRole(roles: string[], required: string | string[]): boolean   // any-of, not a hierarchy
function requireRole(auth: AuthData, required: string | string[]): void   // throws Encore APIError if missing

// === apps/api/lib/csrf.ts ===
function csrfMiddleware(opts?): Middleware    // double-submit; CSRF_MISSING / CSRF_MISMATCH at details.code

// === apps/api/db/db.ts ===
const db = new SQLDatabase("app", { migrations: "./migrations" })
// Tagged-template queries: db.query`SELECT ... WHERE id = ${id}` (auto-parameterized)

// === apps/api/gateway/proxy.ts (BFF) ===
// api.raw GET/POST/PUT/PATCH/DELETE /api/v1/data/*path (auth:true):
//   path sanitisation → S2S OAuth Bearer (token-cache) → fetch private backend
//   → 5xx masked to 502, timeout to 504, per-access audit.

// === apps/web-internal/src/stores/auth.store.ts (Pinia) ===
state: { user: User | null, loading: boolean, error: string | null }
getters: { isAuthenticated: boolean, hasRole(role): boolean }
actions: { fetchUser(), login(driver: string), logout(), checkStatus() }
// Reads Encore { code, message, details } errors; CSRF token from GET /api/v1/auth/csrf-token.
```

---

## Execution Flows

### 1. HTTP Request → Response

```
Browser / SPA
  │
  ▼
Encore Gateway              authHandler runs for `auth: true` endpoints (cookie | Bearer → AuthData)
  │                         per-service middleware: securityHeaders, csrfMiddleware, apiRateLimit
  │
  ├── /api/v1/auth/*         ───► auth service (rauthy, me, refresh, logout, csrf-token)
  ├── /api/v1/data/*         ───► gateway service (api.raw proxy to private backend, auth:true)
  ├── /api/v1/admin/*        ───► user-management service (auth:true + requireRole; if module installed)
  ├── /health, /health/*     ───► health service (liveness/readiness probes)
  ├── /api/v1/info           ───► health service (API metadata)
  ├── /api/v1/csp-report     ───► health service (CSP violation sink)
  └── /!path (non-API)       ───► web service (api.static → built SPA, history fallback)
```

### 2. Authentication (rauthy OIDC: Internal Profile)

```
AUTH_DRIVER=rauthy (staff-facing, self-hosted rauthy OIDC provider)

  GET /api/v1/auth/rauthy/login    → 302 rauthy authorize
  GET /api/v1/auth/rauthy/callback (code exchange, PKCE)
    │
    ▼
  issue RS256 access + refresh JWT (httpOnly cookies);
  persist refresh-token hash in db; redirect → SPA (FRONTEND_URL)

Session lifecycle (stateless):
  GET  /api/v1/auth/me          (auth:true) → MeResponse { id, email, name, roles, ssoProvider }
  GET  /api/v1/auth/status                  → { authenticated, drivers }
  GET  /api/v1/auth/csrf-token              → { token }  (replay as X-CSRF-Token on mutations)
  POST /api/v1/auth/refresh                 → rotate refresh token, mint new access cookie
  POST /api/v1/auth/logout      (auth:true) → revoke refresh token + clear cookies

Role claim priority: roles, then groups, then RAUTHY_DEFAULT_ROLE (default: 'user').
Mock driver available for local dev (AUTH_DRIVER=mock):
  GET /api/v1/auth/mock/login?user=0|1|2   → instant login

JWT keys (RS256): apps/api/keys/*.pem in dev (npm run generate-keys);
  Encore secrets (JWT_PRIVATE_KEY / JWT_PUBLIC_KEY / JWT_REFRESH_PRIVATE_KEY / JWT_REFRESH_PUBLIC_KEY) in prod.
```

**Driver files**: `apps/api/auth/{rauthy,mock}.ts` · **Handler/Gateway**: `apps/api/auth/handler.ts`
**Secrets**: `apps/api/lib/secrets.ts`

### 3. API Gateway (BFF Pattern)

```
Authenticated request (auth:true)
  │
  ▼
/api/v1/data/*path         gateway/proxy.ts (api.raw; GET/POST/PUT/PATCH/DELETE)
  ├── sanitise forwarded path (traversal protection)
  ├── token-cache.ts         getAccessToken() → OAuth client-credentials (cached, deduped)
  ▼
fetch() to private backend  Authorization: Bearer {token}
  ▼
response proxied back        5xx masked to 502, timeout to 504, per-access audit
```

### 4. Frontend Navigation

```
URL change
  │
  ▼
router/index.ts            beforeEach guard:
  ├── First visit?         fetchUser() → GET /api/v1/auth/me
  ├── requiresAuth?        No auth → redirect /login
  ├── guestOnly?           Authenticated → redirect /profile
  └── Set document title
  │
  ▼
  /              ───► HomeView.vue              (public)
  /about         ───► AboutView.vue             (public)
  /login         ───► LoginView.vue             (guestOnly)
  /profile       ───► ProfileView.vue           (requiresAuth)
  /connectivity  ───► ConnectivityTestView.vue  (requiresAuth)
  /admin/users   ───► UserListView.vue          (requiresAuth + admin; if user-management module)
  /admin/users/:id  ► UserDetailView.vue        (requiresAuth + admin; if user-management module)
```

### 5. Build Pipeline

```
Frontend / packages   npm run build → build:packages (shared → config → auth) → build:apps (web-internal)
                      build:web-internal emits into apps/api/web/build (served by the web service)

Backend (Encore)      npm run build:api → apps/api: encore build docker --base <base>
                      dev:  encore run --port=4000
                      check: encore check (backend graph + topology + types)
```

---

## Component Map

### API: Service Decomposition

```
auth/        handler.ts (authHandler + Gateway), encore.service.ts (securityHeaders + csrfMiddleware + apiRateLimit),
             drivers.ts, rauthy.ts, mock.ts, me.ts, refresh.ts, logout.ts, csrf-token.ts,
             user-model.ts, refresh-token-model.ts
gateway/     proxy.ts (5 api.raw data handlers), token-cache.ts (S2S OAuth), encore.service.ts
health/      api.ts (health/liveness/readiness, info, csp-report), encore.service.ts (securityHeaders)
lib/         cookie-config, cookies, csrf, jwt, secrets, security-headers, rate-limit, audit, logger, roles, env
db/          db.ts (SQLDatabase("app")), migrations/{1_extensions,2_user_account,3_refresh_token,4_audit_log}
web/         static.ts (api.static → ./build), encore.service.ts
user-management/  (if module installed) encore.service.ts, users.ts, roles.ts, types.ts, model.ts,
                  migrations/N_user_management_schema.up.sql
```

### Web: Component Hierarchy (apps/web-internal)

```
App.vue
└── AppLayout.vue                  Skip nav link + id="main-content" on <main>
    ├── AppHeader.vue              PrimeVue header bar + user menu
    ├── <router-view />
    │   ├── HomeView.vue           Landing page
    │   ├── LoginView.vue          Auth method selection (rauthy / mock)
    │   ├── ProfileView.vue        User info (protected, ProgressSpinner loading state)
    │   ├── ConnectivityTestView.vue  BFF gateway connectivity test (protected)
    │   ├── AboutView.vue          App info
    │   └── admin/                 (if user-management module)
    │       ├── UserListView.vue   User management table (search, pagination)
    │       └── UserDetailView.vue User detail + role assignment UI
    └── AppFooter.vue              application footer (PrimeVue)

PrimeVue (per-SFC imports):  Button │ Card │ Menu │ Avatar │ Tag │ Message │ Badge │ ProgressSpinner │ DataTable
```

---

## Endpoints

| Method | Path | Auth | Service | Notes |
|--------|------|:----:|---------|-------|
| GET | `/api/v1/auth/drivers` | - | auth | list registered driver names |
| GET | `/api/v1/auth/status` | - | auth | `{ authenticated, drivers }` |
| GET | `/api/v1/auth/login` | - | auth | default driver (`AUTH_DRIVER`) |
| GET | `/api/v1/auth/mock/login` | - | auth | mock instant login (`?user=0\|1\|2`) |
| GET | `/api/v1/auth/rauthy/login` | - | auth | rauthy OIDC authorize redirect |
| GET | `/api/v1/auth/rauthy/callback` | - | auth | OIDC code exchange (PKCE) |
| GET | `/api/v1/auth/csrf-token` | - | auth | `{ token }` (replay as `X-CSRF-Token`) |
| GET | `/api/v1/auth/me` | Y | auth | current user (`MeResponse`) |
| POST | `/api/v1/auth/refresh` | - | auth | rotate refresh token → new access cookie |
| POST | `/api/v1/auth/logout` | Y | auth | revoke refresh token + clear cookies |
| GET/POST/PUT/PATCH/DELETE | `/api/v1/data/*path` | Y | gateway | BFF proxy to private backend |
| GET | `/api/v1/admin/users` | Y + admin | user-management | list users (if module installed) |
| GET | `/api/v1/admin/users/:id` | Y + admin | user-management | get user with roles |
| PUT | `/api/v1/admin/users/:id` | Y + admin | user-management | activate/deactivate |
| GET | `/api/v1/admin/users/:id/roles` | Y + admin | user-management | user role list |
| PUT | `/api/v1/admin/users/:id/roles` | Y + admin | user-management | assign roles (replace all) |
| GET | `/api/v1/admin/roles` | Y + admin | user-management | list roles |
| POST | `/api/v1/admin/roles` | Y + admin | user-management | create role |
| PUT | `/api/v1/admin/roles/:id` | Y + admin | user-management | update role |
| DELETE | `/api/v1/admin/roles/:id` | Y + admin | user-management | delete non-system role |
| GET | `/health` | - | health | composite health |
| GET | `/health/liveness` | - | health | always 200 |
| GET | `/health/readiness` | - | health | 200 / 503 |
| GET | `/api/v1/info` | - | health | API metadata |
| POST | `/api/v1/csp-report` | - | health | CSP violation sink |
| GET | `/!path` (non-API) | - | web | static SPA + history fallback |

**Response shapes** (Encore-native): typed endpoints return the bare payload; errors use `{ code, message, details }`.
The Express `{ success, data }` envelope is retired.

---

## Persistence (`db` service)

```
SQLDatabase("app")     apps/api/db/db.ts: migrations auto-applied on encore run / deploy

Migrations (apps/api/db/migrations/):
  1_extensions.up.sql   Postgres extensions
  2_user_account.up.sql one row per principal; user_roles TEXT[] (multi-role), email-keyed
  3_refresh_token.up.sql hash-only refresh-token store; rotation + revoked_at
  4_audit_log.up.sql    durable audit trail: table/record/action + old/new JSONB + actor + IP/UA

If user-management module is installed, its migration is added to db/migrations/ on compose.
Query contract: tagged templates only: db.query`... WHERE id = ${id}` (never string concatenation).
```

Redis is **not** a session store. `REDIS_URL`, when set, only swaps the in-memory rate-limit backend
(`lib/rate-limit.ts`) for a Redis-backed one.

---

## Security Stack

```
Request ─► Encore Gateway ─► authHandler (auth:true) ─► service middleware ─► handler
                                │                          │
                                │                          ├── securityHeaders  (CSP, HSTS, Permissions-Policy)
                                │                          ├── csrfMiddleware   (double-submit; auth service)
                                │                          └── apiRateLimit     (api + auth tiers)
                                │
                                └── verifies access-token cookie | Bearer → AuthData{ roles }
                                    requireRole(auth, ...) → APIError (any-of)

Cookies:  httpOnly │ secure │ sameSite (access + refresh + CSRF); no token readable from JS
CSRF:     double-submit, constant-time compare; callbacks + /auth/refresh exempt
JWT:      RS256 access (~15m) + DB-backed refresh (~7d) rotation/revocation; hash-only refresh store
Logging:  PII redaction (logger.ts); LOG_PII must be false in production
Audit:    lib/audit.ts → audit_log, best-effort, never blocks the user flow
```

---

## User Roles

### Sources by driver

| Driver | Role source | Fallback |
|--------|-------------|----------|
| **rauthy** | Token claims: `roles`, then `groups` | `RAUTHY_DEFAULT_ROLE` env (default: `user`) |
| **Mock** | Hardcoded in `apps/api/auth/mock.ts` | n/a |

If the **user-management module** is installed, app-managed roles from the `user_management` service
replace IdP claims on every authenticated request (first request auto-upserts the user and assigns
`USER_MGMT_DEFAULT_ROLE`). Admins manage roles via `/api/v1/admin/*`.

### Template default roles

```
'user'       → every authenticated user (baseline access)
'admin'      → administrative functions
'developer'  → mock driver only (dev/test)
```

### Protecting endpoints

```typescript
export const listCases = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/cases" },
  async () => {
    const auth = getAuthData()!
    requireRole(auth, ["case-worker", "admin"])   // any-of; throws APIError if missing
    // scope the query to auth.roles (AUTH-007)
  },
)
```

### Frontend role checks

```typescript
const { hasRole } = useAuthStore()
if (hasRole('admin')) { /* show admin UI */ }
// Router meta guard: meta: { requiresRole: 'supervisor' } → redirect /unauthorized if missing
```

---

## Invariants

1. **Standalone Encore backend**: one Encore app at `apps/api`, excluded from npm workspaces, self-contained.
2. **Multi-driver auth**: `rauthy` is the production driver (`AUTH_DRIVER=rauthy`); `mock` is available for dev.
3. **Stateless JWT, not sessions**: RS256 access + DB-backed refresh rotation in httpOnly cookies. No `express-session`.
4. **Postgres via `SQLDatabase`**: `user_account` / `refresh_token` / `audit_log`. Tagged-template queries only. Redis is rate-limit-only.
5. **BFF pattern**: `gateway` proxies `/api/v1/data/*` to the private backend with S2S OAuth tokens, traversal sanitisation, 5xx masking, audit.
6. **PII never logged**: `lib/logger.ts` redacts; `LOG_PII=false` in production or the app fails fast.
7. **PrimeVue UI**: all SPA UI uses PrimeVue components (Aura theme preset, registered in `main.ts`).
8. **Single deployable**: the `web` service serves the built SPA via `api.static`; one Encore app, port 4000.

---

## Quick Reference: Adding Features

**New API endpoint**:
add `apps/api/<service>/<name>.ts` exporting `api({ ... })` (or `api.raw`); it is auto-discovered.
For a new service, add a directory with `encore.service.ts`.

**New frontend page**:
`views/*.vue` → add route in `router/index.ts` → add nav link in `AppHeader.vue`.

**New gateway-proxied route**:
covered by the `/api/v1/data/*` catch-all in `gateway/proxy.ts`; configure `PRIVATE_API_BASE_URL` + `GATEWAY_OAUTH_*`.

**New persisted entity**:
add a migration `apps/api/db/migrations/N_<name>.up.sql` → query via `db.query\`...\``.

**New unit test**:
colocate `foo.test.ts` next to `foo.ts`; run `encore check` for the backend graph and `vitest` for units.

---

## Conventions

**TypeScript**: strict mode; `interface` for object shapes, `type` for unions.

**Frontend**: `<script setup>` for all components; PrimeVue components imported per-SFC (e.g. `import Button from 'primevue/button'`); Aura theme preset registered once in `main.ts`; lazy-load views; Pinia for shared state.

**Backend (Encore)**:
- Endpoints are typed `api()` or `api.raw()`; business logic in the service module.
- Secrets via `secret()` in `lib/secrets.ts`; never read raw `process.env` for secret material.
- Database access is parameterized (tagged-template) only; never concatenate SQL.

**Security**:
- `auth: true` + `requireRole(auth, ...)` on every protected endpoint; scope data to `auth.roles` (AUTH-007).
- CSRF token required for state-changing requests; fetched from `/api/v1/auth/csrf-token`, replayed as `X-CSRF-Token`.
- Never log PII.

**Testing**: unit tests colocated with source; `encore check` validates backend graph.

---

## Further Reading

| Doc | When to read |
|-----|-------------|
| `CODEMAP.md` | Architectural overview, service graph, security model (start here) |
| `specs/048-encore-app-architecture/spec.md` | Authoritative backend layout + service decomposition |
| `specs/049-preserved-migration-invariants/spec.md` | Security/data invariant freeze (INV-1 to INV-11) |
| `README.md` | Project quick start |
| `docs/AUTH-SETUP.md` | Configuring auth drivers (rauthy, Mock) on Encore |
| `docs/DEPLOYMENT.md` | Building and deploying the Encore app |
| `docs/DEVELOPMENT.md` | Local dev setup, `encore run`, hot reload |
| `docs/TESTING.md` | Writing and running unit and E2E tests |
| `docs/TROUBLESHOOTING.md` | Diagnosing common errors |
