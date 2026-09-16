---
id: template-configure
name: Template Configure: Apply Identity and Configuration
description: Applies app identity, environment variables, AUTH_DRIVER selection, infra.config.json secret bindings, encore.app global_cors, and the internal layout shell for the selected variant (public, internal, dual)
type: skill
variant_parameter: public | internal | dual
defers_to:
  - template-orchestrator (configuration reference, env var documentation)
---

# Template Skill: Configure

Apply all configuration changes to make the template yours. Configuration is mechanical: value substitution, renaming, env var and secret setup. No logic changes, no new feature files.

**Input** (pipeline mode): `variant`, `securityMethod`, and `templateOverrides` from the factory API Build Specification. App identity values come from `requirements/services/service-description.json` and `requirements/services/audience-identification.json`. `securityMethod` maps to the AUTH_DRIVER as: `oidc` → `rauthy`, `mock` → `mock`.

**Input** (standalone mode): equivalent values supplied directly by the user: at minimum a variant, app name, and selected auth driver(s).

This skill must run before any feature scaffolding or trimming.

---

## Step 1: App Identity

### 1a. Package Names

`apps/api` is a standalone Encore application excluded from npm workspaces; it has its own `package.json` and lockfile. Update it independently of the SPA workspaces.

**Encore app (standalone):**
| File | From | To |
|------|------|----|
| `apps/api/package.json` `name` | `@template/api` | `@{org}/api` |
| `apps/api/encore.app` `id` | `vue-encore-enterprise-template` | `{app-slug}` |

**SPA workspaces:**
| File | From | To |
|------|------|----|
| `package.json` (root) | `vue-encore-enterprise-template` | `{app-slug}` |
| `apps/web/package.json` | `@template/web` | `@{org}/web` |
| `apps/web-internal/package.json` (if dual) | `@template/web-internal` | `@{org}/web-internal` |
| `packages/shared/package.json` | `@template/shared` | `@{org}/shared` |

After renaming, search for `@template/` across all TypeScript and Vue files and replace with `@{org}/`. Note: `apps/api` does not import any `@template/*` package: its shared types live in `apps/api/lib`. Only the SPA workspaces consume `packages/*`.

### 1b. README

- Replace title with actual application name
- Replace description with application purpose
- Update the apps/ports table for the active variant
- Remove or replace the template disclaimer

---

## Step 2: Environment Files

### 2a. Create Working .env Files

```bash
# Encore app (standalone; its own .env.example)
cp apps/api/.env.example apps/api/.env
```

The Encore app reads `apps/api/.env` at development time. In production, all secret values come from Encore's secret store (bound via `infra.config.json`).

### 2b. Fill Development Values

In `apps/api/.env`, set for local development:

```
NODE_ENV=development
PORT=4000
AUTH_DRIVER=mock
FRONTEND_URL=http://localhost:5173
LOG_LEVEL=debug
LOG_PII=false
RATE_LIMIT_MAX=1000
AUTH_RATE_LIMIT_MAX=100
```

JWT signing keys are generated separately (see Step 3). The Encore app uses `infra.config.json` `$env` bindings to read the `JWT_*` env vars in development; in production they come from the Encore secret store.

**Frontend URLs by variant:**

| Variant | `FRONTEND_URL` | `encore.app` `global_cors` origins |
|---------|---------------|-------------------------------------|
| public | `http://localhost:5173` | `http://localhost:5173` + production URL |
| internal | `http://localhost:5173` | `http://localhost:5173` + production URL |
| dual (public app) | `http://localhost:5173` | `http://localhost:5173` + public production URL |
| dual (internal app) | `http://localhost:5174` | `http://localhost:5174` + internal production URL |

> **Dual variant**: Each Encore app allows only its own frontend origin in `global_cors`. Do not combine both frontend URLs in one app's `global_cors`: that defeats the trust-zone boundary.

### 2c. Dual-Stack Routing Configuration (dual variant only)

Two independent Encore apps (port 4000 each in isolation; run on separate ports or hosts in production):

```
apps/web (:5173)      -- Vite proxy --> public Encore app (:4000)  --> private backend (gateway S2S)
apps/web-internal (:5174) -- Vite proxy --> internal Encore app (:4001)  --> SQLDatabase("app")
```

Each Vite dev server (`vite.config.ts`) proxies `/api/*` to its own Encore backend. Verify these are correct after generation.

**`apps/web/vite.config.ts`**: must proxy to the public Encore app:
```typescript
proxy: {
  '/api': {
    target: 'http://localhost:4000',
    changeOrigin: true,
  },
},
```

**`apps/web-internal/vite.config.ts`**: must proxy to the internal Encore app:
```typescript
proxy: {
  '/api': {
    target: 'http://localhost:4001',
    changeOrigin: true,
  },
},
```

---

## Step 3: Auth Driver Configuration

The Encore app ships two auth drivers in `apps/api/auth/`: `mock` and `rauthy`. Driver selection is controlled by the `AUTH_DRIVER` env var: no file copies or module registrations are needed.

### Step 3a. Generate JWT Keys (development)

```bash
cd apps/api
npm run generate-keys      # writes apps/api/keys/*.pem (gitignored)
```

The generated `.pem` files are read via `$env` references in `infra.config.json` in development. In production, the PEM content is stored as Encore secrets (`JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_REFRESH_PRIVATE_KEY`, `JWT_REFRESH_PUBLIC_KEY`) declared in `apps/api/lib/secrets.ts`.

### Step 3b. rauthy OIDC driver (public or internal variant)

In `apps/api/.env`:
```
AUTH_DRIVER=rauthy
RAUTHY_ISSUER={rauthy issuer URL}
RAUTHY_CLIENT_ID={OIDC client ID}
RAUTHY_CLIENT_SECRET={OIDC client secret}
RAUTHY_REDIRECT_URI=http://localhost:4000/api/v1/auth/rauthy/callback
RAUTHY_SCOPES=openid profile email
RAUTHY_DEFAULT_ROLE=user
```

In `apps/api/infra.config.json`, bind the rauthy secret env vars under `secrets`.

### Step 3c. Dual variant

Configure a separate rauthy OIDC client for the public Encore app and another for the internal Encore app: each in its own `apps/api/.env` and `infra.config.json`. Neither app shares an `infra.config.json` with the other.

### Step 3d. Customize Mock Users (Required)

The template ships with generic mock users in `apps/api/auth/mock.ts` (`developer`, `admin`, `user`). Replace them with mock users whose roles match the business requirements.

```typescript
// apps/api/auth/mock.ts: replace the default mockUsers array
const mockUsers = [
  {
    userID: 'mock-external-1',
    email: 'external@example.com',
    name: 'Mock External User',
    roles: ['external'],
    ssoProvider: 'mock',
  },
  {
    userID: 'mock-staff-1',
    email: 'caseworker@example.com',
    name: 'Mock Caseworker',
    roles: ['user', 'caseworker'],
    ssoProvider: 'mock',
  },
  {
    userID: 'mock-admin-1',
    email: 'admin@example.com',
    name: 'Mock Administrator',
    roles: ['user', 'admin'],
    ssoProvider: 'mock',
  },
]
```

**Rules:**
- One mock user per distinct role combination the business requirements define
- Use the exact role strings (case-sensitive) from the business requirements: these are the same strings used in `requireRole(getAuthData()!.roles, ...)` guards and `hasRole(role)` UI checks
- Set `RAUTHY_DEFAULT_ROLE` in `apps/api/.env` to the lowest-privilege role
- Document the `?user=N` mapping in the project README so developers know which index corresponds to each role

---

## Step 4: infra.config.json Secret Bindings

`apps/api/infra.config.json` binds Encore `secret()` names to `$env` references for local development. In production, the secrets come from the Encore secret store.

Review the existing bindings and extend them for any secrets the application requires:

```jsonc
{
  "secrets": {
    "JwtPrivateKey": { "$env": "JWT_PRIVATE_KEY" },
    "JwtPublicKey": { "$env": "JWT_PUBLIC_KEY" },
    "JwtRefreshPrivateKey": { "$env": "JWT_REFRESH_PRIVATE_KEY" },
    "JwtRefreshPublicKey": { "$env": "JWT_REFRESH_PUBLIC_KEY" },
    "RauthyClientSecret": { "$env": "RAUTHY_CLIENT_SECRET" },
    // ... add driver-specific and feature-specific secrets here
  },
  "sql_databases": [
    {
      "name": "app",
      "config": {
        "host": "localhost",
        "port": 5432,
        "database": "app",
        "user": "postgres",
        "password": { "$env": "DB_PASSWORD" }
      }
    }
  ]
}
```

Never commit actual secret values; use `$env` references only. Encore provisions a local Postgres instance automatically via Docker when `encore run` starts.

---

## Step 5: encore.app global_cors

Update `apps/api/encore.app` CORS origins for the production deployment:

```jsonc
{
  "id": "{app-slug}",
  "global_cors": {
    "allow_origins_with_credentials": [
      "http://localhost:5173",
      "https://{app}.example.com"
    ]
  }
}
```

> **Do NOT combine both public and internal frontend URLs in a single app's `global_cors`** (dual variant). Each Encore app allows only its own frontend. This enforces the external user/staff trust-zone boundary.

Redis (`REDIS_URL`) is an optional rate-limit backend (not a session store). If Redis is configured, Encore uses it for the `apiRateLimit` middleware; if not, the in-memory rate-limit backend is used.

---

## Step 6: Source-Level Configuration

### 6a. Router Home Route

Replace `HomeView.vue` at `/` with the app's real primary view:

**Public (`apps/web/src/router/index.ts`): external user landing page:**
```typescript
{
  path: '/',
  name: 'Home',
  component: () => import('@/views/{PrimaryLandingView}.vue'),
  // meta.requiresAuth: false: external user landing pages are unauthenticated
}
```

**Internal (`apps/web-internal/src/router/index.ts`): staff dashboard:**
```typescript
{
  path: '/',
  name: 'Home',
  component: () => import('@/views/{PrimaryDashboardView}.vue'),
  meta: { requiresAuth: true },
}
```

After updating the route, delete `HomeView.vue` following Pattern E in template-trim.

### 6b. Internal App Layout Shell (internal and dual variants only)

Internal/staff-facing apps use a fundamentally different layout: a **PrimeVue-based sidebar** (`AppLayout.vue`). The sidebar provides the brand mark, user identity, and navigation. Layout is a flex row: sticky `<aside>` sidebar + scrollable `<main>` content area.

**This step must be done during configure: not deferred to feature scaffolding.**

**Target**: `apps/web/src/` (internal variant) or `apps/web-internal/src/` (dual variant). Do not touch the public SPA.

> **Dual variant (`apps/web-internal/`)**: The template already ships a starter sidebar shell using PrimeVue `Avatar` and `Badge`. Do NOT skip this step because the shell already exists. You must still validate and customize:
> 1. **Validate**: confirm `AppLayout.vue` has no `AppHeader` import, no top navigation bar, and `.app-layout` uses flex row (`min-height: 100vh; display: flex`)
> 2. **Customize**: update the `serviceName` default prop, configure nav items (`primaryItems`, `secondaryItems`, `accountItems`) for the project's pages
> 3. **Verify icon mapping**: confirm the `ICONS` record in `AppLayout.vue` maps all icon names used by the project's nav items to PrimeIcons class strings (e.g. `home: 'pi pi-home'`)

> **Internal variant (single-stack targeting staff, `apps/web/src/`)**: the SPA starts with the public top-header layout and must be swapped to the sidebar pattern using the structure in `apps/web-internal/src/components/layout/AppLayout.vue` as the reference.

#### 6b-1. Configure `AppLayout.vue`

The sidebar layout uses plain HTML elements styled with component-scoped CSS and PrimeVue `Avatar`/`Badge`. The key structure is:

```vue
<!-- apps/web{-internal}/src/components/layout/AppLayout.vue -->
<script setup lang="ts">
import Avatar from 'primevue/avatar'
import Badge from 'primevue/badge'
// ... props: serviceName, user, primaryItems, secondaryItems, accountItems
</script>

<template>
  <div class="app-layout">
    <a href="#main-content" class="skip-link">Skip to main content</a>

    <aside class="sidebar" aria-label="Primary">
      <!-- Brand mark -->
      <RouterLink to="/" class="sidebar__brand">
        <span class="sidebar__logo" aria-hidden="true">VE</span>
        <span class="sidebar__title">{{ serviceName }}</span>
      </RouterLink>

      <!-- Primary navigation -->
      <nav class="sidebar__nav">
        <RouterLink
          v-for="item in primaryItems"
          :key="item.id"
          :to="item.to"
          class="sidebar__link"
        >
          <i :class="iconClass(item.icon)" aria-hidden="true" />
          <span>{{ resolveLabel(item.label) }}</span>
        </RouterLink>
      </nav>

      <!-- Account section -->
      <div class="sidebar__account">
        <div v-if="user" class="sidebar__user">
          <Avatar :label="initials" shape="circle" size="normal" />
          <div class="sidebar__user-info">
            <span class="sidebar__user-name">{{ user.name }}</span>
            <span v-if="user.email" class="sidebar__user-email">{{ user.email }}</span>
          </div>
        </div>
        <button type="button" class="sidebar__link sidebar__signout" @click="handleLogout">
          <i class="pi pi-sign-out" aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>

    <main id="main-content" class="content">
      <div class="content__inner">
        <slot />
      </div>
    </main>
  </div>
</template>
```

**CSS note**: `.app-layout` is a flex ROW (`display: flex; min-height: 100vh`). The sidebar uses `position: sticky; top: 0; height: 100vh`. Active link styling uses `--p-primary-50` and `--p-primary-700` from the Aura preset (no third-party design-system CSS vars).

```css
<style scoped>
.app-layout {
  min-height: 100vh;
  display: flex;
}

.sidebar {
  width: var(--app-sidebar-width);
  flex-shrink: 0;
  background: var(--app-surface);
  border-right: 1px solid var(--app-border);
  display: flex;
  flex-direction: column;
  padding: 1rem 0.75rem;
  gap: 0.5rem;
  position: sticky;
  top: 0;
  height: 100vh;
}

.content {
  flex: 1;
  min-width: 0;
}

.content__inner {
  max-width: 1080px;
  margin: 0 auto;
  padding: 2rem 1.5rem 3rem;
}
</style>
```

**Key differences from public layout:**

- **No `AppHeader.vue` and no top navigation bar**: the sidebar is the chrome
- PrimeVue `Avatar` shows user initials; `Badge` decorates secondary nav items with counts
- **Flat flex row**: `<aside>` + `<main>` as direct children of `.app-layout`
- **No footer**: internal apps do not use a page footer
- CSS variables use `--p-primary-*` (PrimeVue Aura) and `--app-*` (application tokens in `main.css`), not a third-party design-system's CSS vars

#### 6b-2. Verify No AppHeader in Internal Layout

Internal authenticated pages do not use a top-of-page header. If an `AppHeader.vue` exists in `apps/web-internal/src/components/layout/`, confirm it is NOT imported or used by `AppLayout.vue`. User identity and service name are provided by the sidebar.

#### 6b-3. Update `App.vue`

Verify `App.vue` passes correct props to `AppLayout`:

```vue
<!-- apps/web{-internal}/src/App.vue -->
<AppLayout
  :service-name="'{App Name} Internal'"
  :user="user"
  :primary-items="primaryItems"
  :secondary-items="secondaryItems"
  :account-items="accountItems"
>
```

#### Summary of layout differences

| Element | Public (`apps/web`) | Internal (`apps/web-internal`) |
|---------|--------------------|---------------------------------|
| Top header | Custom `AppHeader.vue` (PrimeVue `Button`, `Avatar`, `Menu`) | **None** |
| Navigation | Header links (`RouterLink`) | Sidebar `RouterLink` items + PrimeIcons |
| User identity | Avatar + name in `AppHeader` dropdown | Avatar + name in sidebar account section |
| Content area | Full-width centered under header | Flex right of sticky sidebar |
| Footer | `AppFooter.vue` | **None** |
| Page layout | Each view inside its own markup | Each view sits inside `<main>` inside sidebar layout |

---

## Step 7: GitHub Actions (if deploying to a cloud provider)

Update `.github/workflows/`:
- Set the deployment target name to the actual app/service name for your cloud provider
- Set the deployment group/namespace to the actual resource group or project
- Flag required GitHub secrets: deployment credentials for your cloud provider, build-time `VITE_*` env vars

**Dual variant**: ensure separate workflows for the public and internal stacks, or use a parameterized reusable workflow.

---

## Output: Configuration Report

### Changes Made
Bulleted list of every file changed and what was changed.

### Placeholder Status

| Placeholder | Status | File | Notes |
|-------------|--------|------|-------|
| `RAUTHY_ISSUER` | UNFILLED | `apps/api/.env` | Needs the rauthy issuer URL from the auth team |
| JWT keys | GENERATED | `apps/api/keys/*.pem` | Run `npm run generate-keys` |
| ... | ... | ... | ... |

### Secret Bindings
List each Encore secret declared in `lib/secrets.ts` and its `infra.config.json` `$env` mapping status.

### Required Actions Before Production
Numbered list: provide Encore production secrets, register the OIDC client in rauthy, update `encore.app` CORS origins, set up database, create GitHub secrets.

---

After the report: **"Configuration complete for {variant} variant. Ready for feature scaffolding."**
