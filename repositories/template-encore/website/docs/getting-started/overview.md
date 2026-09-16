# Overview

**acme-vue-encore** is a lean, runnable full-stack reference application designed to provide a hardened, opinionated starting point for enterprise web apps. It combines a dual Vue 3 single-page application (SPA) frontend with a single Encore.ts service cluster on the backend.

## Architecture Shape

The application is structured as two Vue 3 plus PrimeVue SPAs backed by a single Encore.ts backend:

- **Public Web App** (`apps/web`): The external, public-facing user interface.
- **Internal Web App** (`apps/web-internal`): The staff-facing administrative interface.
- **Encore API** (`apps/api`): A single Encore.ts application that provides a BFF (Backend-for-Frontend) API gateway, stateless RS256 JWT authentication, and Postgres persistence via Encore's `SQLDatabase("app")`.

The backend decomposes into six logical services (`lib`, `db`, `health`, `auth`, `gateway`, and `web`), all running in a single container.

## Key Features

- **Stateless multi-driver auth**: RS256 JWT with a 15-minute access token and a 7-day DB-backed, rotating, and revocable refresh token. It uses `httpOnly` cookies, CSRF double-submit protection, and pluggable SSO drivers (`mock` for development, `rauthy` OIDC for production).
- **BFF gateway proxy**: An `api.raw` catch-all proxies authenticated `/api/v1/data/*` requests to a private backend using service-to-service OAuth client-credentials tokens. It handles path-traversal sanitization, 5xx-to-502 masking, timeout-to-504 mapping, and per-access auditing.
- **Born-with spec-spine governance**: Every substantive change begins as a markdown spec under `specs/`. This corpus compiles to a deterministic JSON registry and is mechanically coupled to the code that implements it via the published `spec-spine` CLI.

## Ecosystem Context

`acme-vue-encore` sits in the broader Open Agentic Platform (OAP) / Statecrafting ecosystem as the lean reference app.

The code-generating "generator" was deliberately stripped out into the sibling repository `factory-encore` (commit `b37d3d7`). The repository also vends `tenant-tail` run-side provenance and certificate verifiers tied to OAP specs 209 and 219 (the pinned version lives in the root `package.json`). The Express 5 backend it originally began with was fully retired during the Encore migration (specs 001 through 006).

> **Note**: The GitHub repository is named `template-encore`, but the project's own identity throughout the codebase is **`acme-vue-encore`**. The npm workspace scope is `@template/*` (e.g., `@template/web`, `@template/api`, `@template/shared`), which is unrelated to any "template" verb.
