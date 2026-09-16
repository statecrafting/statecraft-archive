# Development Guide

## Prerequisites

- **Node.js** 24.x or higher ([nodejs.org](https://nodejs.org/))
- **npm** 10.x or higher (included with Node.js)
- **Encore CLI** ([install](https://encore.dev/docs/install)): `apps/api` is an Encore.ts app
- **Docker**: Encore provisions a local Postgres for `SQLDatabase("app")` during `encore run`
- **Git** for version control
- **VS Code** (recommended) with: Vue - Official (Volar), ESLint, Prettier

## Quick Start

### 1. Clone and install

```bash
git clone <repository-url>
cd acme-vue-encore

# SPAs + shared packages (npm workspaces)
npm install

# Standalone Encore app (excluded from workspaces; has its own lockfile)
cd apps/api
npm install
npm run generate-keys        # RSA-2048 JWT signing keys → apps/api/keys/*.pem (gitignored)
cp .env.example .env         # optional; dev fallbacks work without it
cd ../..
```

**What happens**:
- The root install links the workspace packages (`apps/web`, `apps/web-internal`, `packages/*`).
- `apps/api` installs separately (it imports no `@template/*` package; its security primitives live in `apps/api/lib`).
- `generate-keys` writes the dev JWT key pair; without it, JWT-dependent flows fall back per `apps/api/.env.example`.

### 2. Configure environment (optional)

The backend reads non-secret config from `apps/api/.env` and secrets from Encore's secret store (with dev
fallbacks). The defaults work out of the box with `AUTH_DRIVER=mock`. See [apps/api/.env.example](../apps/api/.env.example)
for the full set (`AUTH_DRIVER`, `API_BASE_URL`, `FRONTEND_URL`, JWT keys, `CSRF_SECRET`, `RAUTHY_*`,
`GATEWAY_OAUTH_*`, `RATE_LIMIT_*`). See [AUTH-SETUP.md](AUTH-SETUP.md) for driver configuration.

### 3. Start development servers

```bash
npm run dev          # api (Encore :4000) + web (:5173) + web-internal (:5174), concurrently
```

Or individually:

```bash
npm run dev:api          # Encore API only (encore run --port=4000)
npm run dev:web          # public SPA only
npm run dev:web-internal # internal SPA only
```

Docker must be running so Encore can start the local Postgres. The Vite dev servers proxy `/api/*` to port 4000.

### 4. Verify setup

- **Web App**: http://localhost:5173
- **API Health**: http://localhost:4000/health
- **API Info**: http://localhost:4000/api/v1/info
- **Encore local dashboard**: http://localhost:9400 (traces, API explorer, DB shell)

## Development Workflow

### Project Structure

```
acme-vue-encore/
├── apps/
│   ├── api/                  # Encore.ts app (standalone; not in npm workspaces)
│   │   ├── encore.app        # app manifest (global_cors, build.docker)
│   │   ├── infra.config.json # secret + SQL bindings ($env)
│   │   ├── lib/              # shared security primitives (cookie/csrf/jwt/secrets/roles/...)
│   │   ├── db/               # SQLDatabase("app") + migrations
│   │   ├── health/           # probes + /api/v1/info + /api/v1/csp-report
│   │   ├── auth/             # authHandler + Gateway, multi-driver SSO, JWT
│   │   ├── gateway/          # BFF api.raw proxy /api/v1/data/*
│   │   └── web/              # api.static serving the built SPA
│   ├── web/                  # Vue 3 SPA (public)
│   └── web-internal/         # Vue 3 SPA (staff)
├── packages/                 # shared / config / auth (reusable libs; not used by apps/api)
├── specs/                    # spec spine (authoritative design record)
└── docs/                     # this documentation
```

### Frontend development

```bash
touch apps/web/src/components/UserCard.vue
```

```vue
<!-- apps/web/src/components/UserCard.vue -->
<script setup lang="ts">
import Card from 'primevue/card'
import Button from 'primevue/button'
defineProps<{ user: { id: string; name: string; email: string } }>()
defineEmits<{ edit: [id: string] }>()
</script>

<template>
  <Card>
    <template #title>{{ user.name }}</template>
    <template #content>
      <p>{{ user.email }}</p>
      <Button label="Edit" @click="$emit('edit', user.id)" />
    </template>
  </Card>
</template>
```

Add a route in `apps/web/src/router/index.ts` (lazy-loaded), and a nav link in `AppHeader.vue`.

### Backend development (Encore)

Each directory with an `encore.service.ts` is a service; each file exporting `api()` / `api.raw()` is an
endpoint, auto-discovered at compile time. To add an endpoint:

```typescript
// apps/api/<service>/users.ts
import { api } from "encore.dev/api"
import { getAuthData } from "~encore/auth"
import { requireRole } from "../lib/roles"

interface ListUsersResponse { users: { id: string; name: string }[] }

export const listUsers = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/users" },
  async (): Promise<ListUsersResponse> => {
    const auth = getAuthData()!
    requireRole(auth, ["case-worker", "admin"])   // any-of (AUTH-007 / INV-1)
    // scope the query to auth.roles in the service layer; use the db service for persistence
    return { users: [] }
  },
)
```

For a cookie/redirect/proxy flow (no typed body), use `api.raw(...)` with the native `Request`/`Response`
(see `apps/api/auth/*.ts` and `apps/api/gateway/proxy.ts`). For a new service, add a directory with
`encore.service.ts` exporting `new Service("name", { middlewares: [...] })`.

> Auth, gateway, health, and static serving are already wired. There is **no** manual route registration
> file (the Express `app.ts` / `modules.ts` model is gone); Encore discovers the graph.

### Hot reload

- **Frontend (Vite)**: edits to `.vue`/`.ts`/`.css` hot-reload instantly.
- **Backend (Encore)**: `encore run` watches the source and recompiles automatically; no manual restart.

## Testing

```bash
npm test                       # vitest across workspaces
npm run typecheck:api          # encore check (backend graph + topology + types)
npm run test:e2e               # Playwright E2E
```

Backend units run with Vitest inside `apps/api` (`npm test` there). `encore check` is the backend's primary
fast feedback: it parses the app, resolves the service graph and topology, type-checks, and applies migrations
against an ephemeral Postgres. See [TESTING.md](TESTING.md).

## Linting and Formatting

```bash
npm run lint        # eslint --max-warnings 0
npm run lint:fix
npm run format      # prettier --write
npm run format:check
```

An opt-in pre-commit hook (`.githooks/pre-commit`) guards the codebase index and
workflow SHA-pins. Enable it in your clone with `git config core.hooksPath .githooks`
(disable with `git config --unset core.hooksPath`).

## Type Checking

```bash
npm run typecheck            # SPAs + packages (vue-tsc / tsc)
npm run typecheck:api        # encore check (backend)
```

Shared types for the SPAs live in [packages/shared/](../packages/shared/) (`import type { X } from '@template/shared'`).
The Encore app defines its request/response types inline in each endpoint module.

## Debugging

**Frontend**: browser DevTools + Vue DevTools extension.

**Backend (Encore)**: the local dev dashboard at http://localhost:9400 shows request traces, the API explorer,
and a database shell. Structured logs stream to the console via `encore.dev/log`. For step debugging, attach a
Node inspector to the `encore run` process.

## Environment Variables

- **Non-secret config**: `apps/api/.env` (loaded by `encore run`). Template: [apps/api/.env.example](../apps/api/.env.example).
- **Secrets** (JWT keys, `CSRF_SECRET`, `RAUTHY_CLIENT_SECRET`, `GATEWAY_OAUTH_*`): declared via
  `secret(...)` in `apps/api/lib/secrets.ts`. Set locally with `encore secret set --type local <NAME>` or rely
  on the dev fallbacks (JWT reads `apps/api/keys/*.pem`). In production, bind via `infra.config.json` `$env` or
  `encore secret set --type prod <NAME>`. Never commit secret values.

To add a config variable: add it to `apps/api/.env.example`, read it where needed (or add a `secret()` to
`lib/secrets.ts` if it is sensitive), and document it.

## Common Tasks

```bash
# Clean workspace node_modules / build output
npm run clean && npm install

# Regenerate the committed typed client after changing API endpoints
npm --prefix apps/api run gen:client     # → apps/web/src/lib/encore-client.ts

# Update dependencies
npm outdated
npm update <package-name> --workspace=apps/web
```

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md). Quick fixes:

| Issue | Solution |
|-------|----------|
| Port 4000 already in use | Stop the stale `encore run`; on Windows `netstat -ano \| findstr :4000` then `taskkill /F /PID <id>` |
| `encore: command not found` | Install the Encore CLI ([docs](https://encore.dev/docs/install)) |
| DB / migration errors on `encore run` | Ensure Docker is running (Encore needs it for the local Postgres) |
| JWT / login failures in dev | Run `npm run generate-keys` inside `apps/api` |
| Frontend can't reach API | Confirm the API is on `:4000` and the Vite proxy target matches |

## Additional Resources

- [CODEMAP.md](../CODEMAP.md): architecture overview and service graph
- [Authentication Setup](AUTH-SETUP.md): rauthy (OIDC), Mock
- [Testing](TESTING.md) · [Deployment](DEPLOYMENT.md) · [PrimeVue docs](https://primevue.org/) (Aura theme)
- [Encore.ts documentation](https://encore.dev/docs/ts)

---

**Last Updated**: 2026-06-24
