---
id: "005-spa-static-serving"
title: "SPA static serving: Encore api.static serves the Vue bundles with history fallback"
status: approved
created: "2026-06-10"
owner: bart
kind: feature
domain: app
risk: low
implementation: complete
depends_on: ["001-encore-app-architecture"]
code_aliases: ["SPA_STATIC", "WEB_SERVICE"]
summary: >
  The web service serves the built Vue SPA via api.static at /!path over
  ./build with history-API fallback to index.html and no auth middleware
  (static assets must cache normally). apps/web builds into
  apps/api/web/build; in the dual-app layout the staff SPA
  (apps/web-internal) builds into the internal app's web service the same
  way.
establishes:
  - "apps/api/web/"
---

# 005 — SPA static serving: Encore api.static serves the Vue bundles with history fallback

## 1. Purpose

The Encore app serves the built Vue SPA so a production deploy ships the
API and the client from a single image, eliminating a separate static host.
The `web` service uses `api.static` to expose the pre-built bundle at the
`/!path` catch-all, with a history-API fallback so Vue Router's HTML5
history mode handles client-side routes without server round-trips.

In the dual-app layout the same mechanism applies to the staff
SPA: `apps/web-internal` builds into the internal app's `web` service at
`apps/api/web/build`, keeping the serving contract identical across both
variants.

## 2. Territory

This spec owns the `apps/api/web/` Encore service directory — its static
handler, service declaration, build placeholder, and the `vite.config.ts`
output-directory wiring that makes `npm run build:web` land the bundle in
the right place.

The Vue SPA source code (`apps/web/src/`, `apps/web-internal/src/`) is
outside this territory; only the configuration that routes build output to
the Encore service is within scope.

## 3. Behavior

### FR-001 — `web` Encore service registration

The Encore app MUST register a `web` service (via
`apps/api/web/encore.service.ts`) with **no middleware** array. Static
assets must cache normally; applying the `securityHeaders` middleware
(which emits `Cache-Control: no-store`) to static assets would defeat
browser caching for hashed bundles. No state-changing endpoints exist in
the service, so CSRF and rate-limit middleware do not apply.

### FR-002 — `api.static` catch-all handler

`apps/api/web/static.ts` MUST export an `api.static` handler configured
as:

```ts
export const spa = api.static(
  { expose: true, path: "/!path", dir: "./build", notFound: "./build/index.html" }
);
```

- `path: "/!path"` is the lowest-priority catch-all in Encore's router. It
  MUST yield to all more-specific routes (`/api/*`, `/health`,
  `/api/v1/data/*`) registered by the other services.
- `dir: "./build"` is resolved relative to `static.ts`, placing the root
  at `apps/api/web/build`.
- `notFound: "./build/index.html"` enables history-API fallback: any path
  not matching a static file returns `index.html`, allowing Vue Router to
  handle the route on the client.

### FR-003 — build-output wiring

`apps/web/vite.config.ts` MUST set `build.outDir` to `../api/web/build`
(with `emptyOutDir: true`), so `npm run build:web` writes the Vite bundle
directly into the `web` service's `build/` directory. `encore.app`'s
`bundle_source: true` setting (spec 001) then sweeps `./web/build` into
the Docker image during `encore build docker`.

Only the committed placeholder `apps/api/web/build/index.html` is tracked
in git (`apps/api/.gitignore` excludes the real build output: hashed
assets, `assets/` subtree). This lets the app boot in development before a
real build exists.

The repository-root `.gitignore` excludes build outputs everywhere
(`build/`), so it MUST also carry an explicit `!apps/api/web/build/`
negation that un-prunes that one directory. Git cannot re-include a file
whose parent directory is pruned, so without the root negation
`apps/api/.gitignore`'s `!/web/build/index.html` is powerless on a produced
app's fresh `git init && git add` (a born-with scaffold): the placeholder is
dropped from commit #1 and the produced app's `encore check` fails with
"unable to read static assets directory". The template repository itself is
unaffected (the placeholder is already tracked there, so a fresh add never
re-evaluates it); the root negation is what carries the placeholder into a
born-with produced app.

### FR-004 — dual-app layout wiring

The template ships the **public variant** active: `apps/web` is the SPA wired to
`apps/api/web/build` (FR-003), and `apps/web-internal` is present as source but is
not wired to the served build. This satisfies the public variant, which requires
no additional configuration.

Switching the served SPA to the **internal variant** is the documented
alternative, and when you do so:

- `apps/web-internal/vite.config.ts` MUST set `build.outDir` to
  `../api/web/build` (with `emptyOutDir: true`), mirroring `apps/web`.
- the active build script MUST build only the served SPA into
  `apps/api/web/build`, so no double-build or `emptyOutDir` collision between the
  two SPAs can arise.

Only one SPA is served per Encore app, so exactly one variant's wiring is active
at a time.

### FR-005 — development workflow

In development, contributors run Vite on its default port with the `/api`
proxy pointed at the Encore development server (port 4000; configured in
`vite.config.ts` per spec 006). The `web` service is still present and
`encore run` still starts it, but the dev workflow uses the Vite server for
hot-module replacement.

## 4. Acceptance criteria

**AC-1.** `cd apps/api && encore check` resolves the application graph with
the `web` service present and the `/!path` catch-all not shadowing the API,
health, or gateway routes.

**AC-2.** `npm run build:web` completes and the output lands in
`apps/api/web/build/` (directory contains `index.html` and an `assets/`
subtree); the committed placeholder `build/index.html` is the only
git-tracked file under `web/build/`.

**AC-3.** Navigating to a deep Vue Router path (e.g., `/dashboard/users`)
on a running `encore run` instance returns `200 index.html` (history
fallback active), not a 404.

**AC-4.** `npx spec-spine compile` exits 0 (registry well-formed); `npx
spec-spine lint --fail-on-warn` exits 0; `npx spec-spine couple --base
origin/main` exits 0 for changes under `apps/api/web/` owned here.

## 5. Out of scope

- **Vue SPA source** (`apps/web/src/`, `apps/web-internal/src/`): owned by
  spec 006.
- **Document-level CSP for the SPA shell**: `api.static` does not run
  service middleware; the shell CSP is an ingress or CDN concern, not this
  spec's.
- **CI build-web step**: wiring `build:web` into the Encore CI workflow is
  owned by spec 007.
