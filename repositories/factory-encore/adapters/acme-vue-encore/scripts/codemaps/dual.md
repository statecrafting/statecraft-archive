# Codemap: Dual-App (Public + Internal)

> Architectural blueprint: execution flows, service graphs, API surfaces, and component relationships.
> For developer onboarding and AI agent context. Reduces codebase to ~5% of tokens, ~90% of understanding.
>
> **Backend = Encore.ts.** The Express 5 BFF was retired in the Encore migration (specs 001 to 006).
> Dual-app = **two independent, standalone Encore apps** (spec 004 Option A). Each has its own
> Gateway, authHandler, secrets, and deploy boundary. There are no shared `api-public`/`api-internal`
> Express servers, no `session-store` modules, and no runtime plugin-chain loader.

---

## Project Tree

```
my-dual-app/
├── public/                        External-facing Encore app (AUTH_DRIVER=rauthy)
│   ├── apps/
│   │   ├── api/                   Encore.ts application (standalone)
│   │   │   ├── encore.app
│   │   │   ├── infra.config.json
│   │   │   ├── lib/               ← `lib` service: security primitives
│   │   │   ├── db/                ← `db` service: SQLDatabase("app") + migrations
│   │   │   ├── health/            ← `health` service: probes + info + csp-report
│   │   │   ├── auth/              ← `auth` service: authHandler + Gateway; rauthy driver
│   │   │   ├── gateway/           ← `gateway` service: api.raw BFF proxy /api/v1/data/*
│   │   │   └── web/               ← `web` service: api.static serving apps/web/build
│   │   └── web/                   Vue 3 SPA (external user-facing; PrimeVue)
│   ├── packages/                  @template/shared (SPA only; not imported by apps/api)
│   └── ... (root config, scripts, modules)
│
└── internal/                      Staff-facing Encore app (AUTH_DRIVER=rauthy)
    ├── apps/
    │   ├── api/                   Encore.ts application (standalone)
    │   │   ├── encore.app
    │   │   ├── infra.config.json
    │   │   ├── lib/               ← `lib` service: security primitives
    │   │   ├── db/                ← `db` service: SQLDatabase("app") + migrations
    │   │   ├── health/            ← `health` service
    │   │   ├── auth/              ← `auth` service: authHandler + Gateway; rauthy driver
    │   │   ├── gateway/           ← `gateway` service: api.raw BFF proxy
    │   │   └── web/               ← `web` service: api.static serving apps/web-internal/build
    │   └── web-internal/          Vue 3 SPA (staff-facing; PrimeVue)
    │       └── src/views/admin/   (if user-management module: UserListView, UserDetailView)
    ├── packages/
    └── ... (root config, scripts, modules)
```

**Two independent apps.** Each subdirectory (`public/`, `internal/`) is a complete, standalone
Encore application produced by `setup-dual-app.ts`. Each has its own `encore.app`, `infra.config.json`,
`apps/api/package-lock.json`, and deploy pipeline. There is no shared backend codebase and no
cross-repo service call between the two apps at the generator level.

---

## Tech Stack (Required)

All code added to either application **must** use these technologies.

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Language** | TypeScript (strict) | All application/library/test code in TS. |
| **Frontend** | Vue 3 (Composition API + `<script setup>`) | Single-file components only. |
| **State** | Pinia | `apps/web*/src/stores/`. No Vuex. |
| **Routing** | Vue Router 4 | Lazy-load views: `() => import('./views/X.vue')` |
| **Styling** | PrimeVue | `primevue` + `@primevue/themes` (Aura preset, indigo primary); component-scoped CSS. No Tailwind. |
| **Backend** | **Encore.ts** | Typed `api()` / `api.raw()` endpoints; services discovered from `encore.service.ts`; `authHandler` + `Gateway`; service `middlewares` arrays. |
| **Auth (public)** | **Stateless RS256 JWT + rauthy OIDC** | `AUTH_DRIVER=rauthy`; access + DB-backed refresh in httpOnly cookies. Not `express-session`. |
| **Auth (internal)** | **Stateless RS256 JWT + rauthy OIDC** | `AUTH_DRIVER=rauthy`; same JWT mechanism; separate rauthy registration. |
| **Persistence** | **Postgres via `SQLDatabase("app")`** | Tagged-template queries only. Redis is optional, rate-limit backing only. |
| **Build** | Vite (frontend); `encore build docker` (backend) | `encore run --port=4000` for local dev of either app. |
| **Testing** | Vitest (unit), Playwright (E2E) | `encore check` validates each backend graph independently. |
| **Linting** | ESLint 9 + Prettier | Flat config format. |

**Do NOT introduce**: Express/`express-session` (retired), shared session stores between the two apps, Vuex, ORMs, Webpack, Joi/Yup, CSS-in-JS, Tailwind CSS, string-concatenated SQL.

---

## Service Graphs

### Public App (external user-facing, rauthy)

```
Encore application (public/apps/api) ════════════════════════════════════
  Gateway + authHandler   verifies access-token cookie | Bearer → AuthData{ roles }
    │
    ├── lib       security primitives (no endpoints)
    │             cookie-config, cookies, csrf, jwt, secrets, security-headers,
    │             rate-limit, audit, logger (PII guard), roles (hasRole/requireRole)
    │
    ├── db        SQLDatabase("app") + migrations
    │
    ├── health    securityHeaders only
    │
    ├── auth      securityHeaders + csrfMiddleware + apiRateLimit
    │             authHandler + Gateway; driver = rauthy; me/refresh/logout/csrf-token/rauthy/*
    │
    ├── gateway   api.raw catch-all /api/v1/data/* (auth:true) → private backend (S2S OAuth)
    │
    └── web       api.static → public/apps/api/web/build (external user SPA, history fallback)

Frontend (public/apps/web) ═════════════════════════════════════════════
  Vue 3 SPA ──► /api/v1/* (Vite proxy → :4000)
```

### Internal App (staff-facing, rauthy)

```
Encore application (internal/apps/api) ══════════════════════════════════
  Gateway + authHandler   verifies access-token cookie | Bearer → AuthData{ roles }
    │
    ├── lib       security primitives (no endpoints)
    │
    ├── db        SQLDatabase("app") + migrations
    │
    ├── health    securityHeaders only
    │
    ├── auth      securityHeaders + csrfMiddleware + apiRateLimit
    │             authHandler + Gateway; driver = rauthy; me/refresh/logout/csrf-token/rauthy/*
    │
    ├── gateway   api.raw catch-all /api/v1/data/* (auth:true) → private backend (S2S OAuth)
    │
    ├── web       api.static → internal/apps/api/web/build (staff SPA, history fallback)
    │
    └── user-management   (optional module) CRUD endpoints /api/v1/admin/*; own migration

Frontend (internal/apps/web-internal) ══════════════════════════════════
  Vue 3 SPA ──► /api/v1/* (Vite proxy → :4000)
```

**Trust-zone separation**: the two apps run at separate Encore `encore run` processes (both default
to port 4000; assign them different ports when running simultaneously, e.g., public on 4000 and
internal on 4001). Each has its own `infra.config.json`, JWT keys, and rauthy registration. There is no
in-process or network coupling between the two apps at template level.

**Build order (per app)**: shared → config → auth → web (or web-internal).
Each Encore backend builds independently with `encore build docker`.

---

## API Surfaces

Both apps expose the same core endpoint set, differing only in optional modules and separate rauthy registrations.

### Core endpoints (both apps)

| Method | Path | Auth | Service | Notes |
|--------|------|:----:|---------|-------|
| GET | `/api/v1/auth/drivers` | - | auth | list active driver names |
| GET | `/api/v1/auth/status` | - | auth | `{ authenticated, drivers }` |
| GET | `/api/v1/auth/login` | - | auth | default driver (`AUTH_DRIVER`) |
| GET | `/api/v1/auth/mock/login` | - | auth | mock instant login (`?user=0\|1\|2`; dev only) |
| GET | `/api/v1/auth/rauthy/login` | - | auth | rauthy OIDC authorize redirect |
| GET | `/api/v1/auth/rauthy/callback` | - | auth | OIDC code exchange (PKCE) |
| GET | `/api/v1/auth/csrf-token` | - | auth | `{ token }` (replay as `X-CSRF-Token`) |
| GET | `/api/v1/auth/me` | Y | auth | current user (`MeResponse`) |
| POST | `/api/v1/auth/refresh` | - | auth | rotate refresh token |
| POST | `/api/v1/auth/logout` | Y | auth | revoke refresh token + clear cookies |
| GET/POST/PUT/PATCH/DELETE | `/api/v1/data/*path` | Y | gateway | BFF proxy to private backend |
| GET | `/health` | - | health | composite health |
| GET | `/health/liveness` | - | health | always 200 |
| GET | `/health/readiness` | - | health | 200 / 503 |
| GET | `/api/v1/info` | - | health | API metadata |
| POST | `/api/v1/csp-report` | - | health | CSP violation sink |
| GET | `/!path` (non-API) | - | web | static SPA + history fallback |

### Internal-app-only endpoints (user-management module optional)

| Method | Path | Auth | Notes |
|--------|------|:----:|-------|
| GET | `/api/v1/admin/users` | Y + admin | list users (if user-management module) |
| GET | `/api/v1/admin/users/:id` | Y + admin | user detail with roles |
| PUT | `/api/v1/admin/users/:id` | Y + admin | activate/deactivate |
| PUT | `/api/v1/admin/users/:id/roles` | Y + admin | assign roles (replace all) |
| GET | `/api/v1/admin/roles` | Y + admin | list roles |
| POST | `/api/v1/admin/roles` | Y + admin | create role |
| PUT | `/api/v1/admin/roles/:id` | Y + admin | update role |
| DELETE | `/api/v1/admin/roles/:id` | Y + admin | delete non-system role |

**Response shapes** (Encore-native): typed endpoints return the bare payload; errors use `{ code, message, details }`.
The Express `{ success, data }` envelope is retired.

---

## Execution Flows

### 1. HTTP Request → Response (either app)

```
Browser / SPA
  │
  ▼
Encore Gateway              authHandler runs for `auth: true` endpoints (cookie | Bearer → AuthData)
  │                         per-service middleware: securityHeaders, csrfMiddleware, apiRateLimit
  │
  ├── /api/v1/auth/*         ───► auth service
  ├── /api/v1/data/*         ───► gateway service (api.raw proxy to private backend, auth:true)
  ├── /api/v1/admin/*        ───► user-management service (internal app only, if module installed)
  ├── /health, /health/*     ───► health service
  ├── /api/v1/info           ───► health service
  ├── /api/v1/csp-report     ───► health service
  └── /!path (non-API)       ───► web service (api.static → built SPA, history fallback)
```

### 2. Authentication

```
Both apps (AUTH_DRIVER=rauthy), each against its own rauthy registration:
  GET /api/v1/auth/rauthy/login    → 302 rauthy authorize
  GET /api/v1/auth/rauthy/callback (code exchange, PKCE)
    → RS256 access + refresh JWT (httpOnly cookies); refresh-token hash persisted in db

Role claim priority (both apps): roles, then groups, then RAUTHY_DEFAULT_ROLE (default: 'user').

Session lifecycle (stateless; same for both apps):
  GET  /api/v1/auth/me          (auth:true) → MeResponse
  GET  /api/v1/auth/csrf-token              → { token }
  POST /api/v1/auth/refresh                 → rotate refresh token, mint new access cookie
  POST /api/v1/auth/logout      (auth:true) → revoke + clear cookies
```

### 3. API Gateway (BFF Pattern; both apps)

```
Authenticated request (auth:true)
  │
  ▼
/api/v1/data/*path         gateway/proxy.ts (api.raw)
  ├── sanitise path
  ├── token-cache.ts         S2S OAuth client-credentials (cached)
  ▼
fetch() to private backend  Authorization: Bearer {token}
  ▼
response proxied back        5xx → 502, timeout → 504, per-access audit
```

### 4. Build Pipeline (each app independently)

```
Frontend / packages   npm run build (inside public/ or internal/)
                      build:packages (shared → config → auth) → build:apps (web or web-internal)
                      SPA bundle emits into apps/api/web/build

Backend (Encore)      encore build docker --base <base>   (inside apps/api)
                      dev:  encore run --port=4000
                      check: encore check
```

---

## Component Map

### API: Service Decomposition (both apps share this layout)

```
auth/        handler.ts (authHandler + Gateway), encore.service.ts,
             drivers.ts, rauthy.ts, mock.ts, me.ts, refresh.ts, logout.ts,
             csrf-token.ts, user-model.ts, refresh-token-model.ts
gateway/     proxy.ts (5 api.raw data handlers), token-cache.ts (S2S OAuth), encore.service.ts
health/      api.ts (health/liveness/readiness, info, csp-report), encore.service.ts
lib/         cookie-config, cookies, csrf, jwt, secrets, security-headers, rate-limit, audit, logger, roles, env
db/          db.ts (SQLDatabase("app")), migrations/{1_extensions,2_user_account,3_refresh_token,4_audit_log}
web/         static.ts (api.static → ./build), encore.service.ts

user-management/   (internal app, optional module)
             encore.service.ts, users.ts, roles.ts, types.ts, model.ts,
             migrations/N_user_management_schema.up.sql
```

### Web: Component Hierarchy

```
(public app: apps/web)                 (internal app: apps/web-internal)

App.vue                                 App.vue
└── AppLayout.vue                       └── AppLayout.vue
    ├── AppHeader.vue                       ├── AppHeader.vue
    ├── <router-view />                     ├── <router-view />
    │   ├── HomeView                        │   ├── HomeView
    │   ├── LoginView (rauthy / mock)       │   ├── LoginView (rauthy / mock)
    │   ├── ProfileView (auth:true)         │   ├── ProfileView (auth:true)
    │   ├── ConnectivityTestView            │   ├── ConnectivityTestView
    │   └── AboutView                       │   ├── AboutView
    │                                       │   └── admin/ (if user-management module)
    └── AppFooter                           └── AppFooter

PrimeVue (per-SFC imports, both apps):  Button │ Card │ Menu │ Avatar │ Tag │ Message │ Badge │ ProgressSpinner │ DataTable
```

---

## Persistence

```
SQLDatabase("app")   each app has its own independent Postgres database
                     migrations auto-applied on encore run / deploy

Base migrations (both apps):
  1_extensions, 2_user_account, 3_refresh_token, 4_audit_log

Additional (internal app, user-management module):
  N_user_management_schema.up.sql   users + roles + user_roles tables + seed data

Query contract: tagged templates only (never string concatenation).
```

Redis is **not** a session store in either app. `REDIS_URL` enables Redis-backed rate limiting only.

---

## Security Stack

```
Each app independently:

Request ─► Encore Gateway ─► authHandler (auth:true) ─► service middleware ─► handler
                                │                          │
                                │                          ├── securityHeaders
                                │                          ├── csrfMiddleware   (auth service)
                                │                          └── apiRateLimit
                                │
                                └── verifies access-token cookie | Bearer → AuthData{ roles }
                                    requireRole(auth, ...) → APIError

Cookies:  httpOnly │ secure │ sameSite; no token readable from JS
CSRF:     double-submit; callbacks + /auth/refresh exempt
JWT:      RS256 access (~15m) + DB-backed refresh (~7d); each app has its own key pair
Logging:  PII redaction; LOG_PII must be false in production
Audit:    lib/audit.ts → audit_log per app
```

---

## User Roles

### Public app

| Driver | Role source | Fallback |
|--------|-------------|----------|
| **rauthy** | Token claims: `roles`, then `groups` | `RAUTHY_DEFAULT_ROLE` (default: `user`) |
| **Mock** | Hardcoded in `apps/api/auth/mock.ts` | n/a |

### Internal app

| Driver | Role source | Fallback |
|--------|-------------|----------|
| **rauthy** | Token claims: `roles`, then `groups` | `RAUTHY_DEFAULT_ROLE` (default: `user`) |
| **Mock** | Hardcoded in `apps/api/auth/mock.ts` | n/a |

If the **user-management module** is installed in the internal app, app-managed roles replace the
rauthy claims. Admins manage roles via `/api/v1/admin/*`.

### Protecting endpoints

```typescript
export const listCases = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/cases" },
  async () => {
    const auth = getAuthData()!
    requireRole(auth, ["case-worker", "admin"])   // any-of; throws APIError if missing
  },
)
```

---

## Invariants

1. **Two independent Encore apps**: `public/` and `internal/` are fully standalone; each boots, deploys, and scales independently. There is no shared Express server, no shared session store between them, and no in-repo S2S coupling at the template level.
2. **Trust-zone separation**: separate rauthy registrations (one per app), different JWT key pairs, different `infra.config.json`, different network exposure boundaries.
3. **Stateless JWT, not sessions**: RS256 access + DB-backed refresh rotation in httpOnly cookies (both apps). No `express-session`.
4. **Postgres via `SQLDatabase`**: each app has its own `SQLDatabase("app")`; tagged-template queries only; Redis is rate-limit-only.
5. **BFF pattern**: each app's `gateway` service proxies `/api/v1/data/*` with S2S OAuth tokens and traversal sanitisation.
6. **PII never logged**: `lib/logger.ts` redacts in both apps; `LOG_PII=false` in production.
7. **PrimeVue UI**: all SPA UI in both apps uses PrimeVue components (Aura theme preset, registered in `main.ts`).
8. **Single deployable per audience**: each Encore app (`public/apps/api`, `internal/apps/api`) serves its built SPA via `api.static`; port 4000 per app (assign distinct ports for simultaneous local dev).

---

## Quick Reference: Adding Features

**New API endpoint** (in either app):
add `apps/api/<service>/<name>.ts` exporting `api({ ... })`.

**New frontend page**:
`views/*.vue` → route in `router/index.ts` → nav link in `AppHeader.vue`.

**New domain service** (e.g., user-management pattern):
add a directory with `encore.service.ts` + endpoints + model + migration. Encore discovers it.

**New persisted entity**:
add `apps/api/db/migrations/N_<name>.up.sql` → query via `db.query\`...\``.

---

## Further Reading

| Doc | When to read |
|-----|-------------|
| `CODEMAP.md` | Top-level architecture, service graph, security model |
| `specs/048-encore-app-architecture/spec.md` | Authoritative backend layout + service decomposition |
| `specs/049-preserved-migration-invariants/spec.md` | Security/data invariant freeze |
| `specs/062-dual-app-encore/spec.md` | Dual-app Option A design record |
| `README.md` | Project quick start |
| `docs/AUTH-SETUP.md` | rauthy driver configuration |
| `docs/DEPLOYMENT.md` | Building and deploying each Encore app |
| `docs/DEVELOPMENT.md` | Local dev: running both apps, port assignment |
| `docs/TESTING.md` | Testing strategy |
