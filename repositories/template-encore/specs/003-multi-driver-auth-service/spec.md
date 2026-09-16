---
id: "003-multi-driver-auth-service"
title: "Multi-driver auth service: Encore authHandler/Gateway, mock/rauthy OIDC SSO, JWT issuance and refresh rotation"
status: approved
created: "2026-06-10"
owner: bart
kind: feature
domain: app
risk: high
implementation: complete
depends_on: ["001-encore-app-architecture", "002-security-data-invariants"]
code_aliases: ["AUTH_SERVICE", "AUTH_GATEWAY"]
summary: >
  The auth service: a dual-mode Encore authHandler (httpOnly session cookie
  + Bearer), a Gateway binding it, two SSO drivers (mock, rauthy OIDC)
  selected by AUTH_DRIVER, RS256 JWT issuance, refresh-token rotation and
  revocation, CSRF protection, rate limiting, and auth-event audit.
establishes:
  - "apps/api/auth/"
---

# 003 - Multi-driver auth service: Encore authHandler/Gateway, mock/rauthy OIDC SSO, JWT issuance and refresh rotation

## 1. Purpose

The `auth` service is the authentication surface of the Encore.ts backend. It
provides a dual-mode `authHandler` validated by a `Gateway`, two SSO drivers
selectable by configuration, RS256 JWT issuance with DB-backed refresh rotation
and revocation, CSRF-token issuance, logout with optional IdP SLO, and driver
discovery. It is the load-bearing realisation of most of the invariants in spec
`002-security-data-invariants` (INV-3, INV-4, INV-5, INV-6, INV-7, INV-8,
INV-9, and the multi-role path of INV-1).

## 2. Territory

This spec owns `apps/api/auth/`. The security primitives it depends on
(`lib/jwt.ts`, `lib/csrf.ts`, `lib/rate-limit.ts`, `lib/audit.ts`, etc.) and
the persistence schema (`db/`) are owned by spec `002-security-data-invariants`.
The `Gateway` exported from `auth/handler.ts` is the authHandler gateway for all
authenticated endpoints across the application, including the BFF proxy
(spec `004-bff-gateway-proxy`).

## 3. Behavior

### 3.1 Service shape

`apps/api/auth/` is one Encore service:

- **`encore.service.ts`** — `Service("auth", { middlewares: [securityHeaders,
  csrfMiddleware, apiRateLimit] })`. Middlewares run in declaration order; SSO
  callbacks and `/auth/refresh` are in `CSRF_EXEMPT_PATHS`.
- **`handler.ts`** — the dual-mode `authHandler<AuthParams, AuthData>` (reads
  `Authorization: Bearer` first, then the `access_token` cookie) and
  `export const gateway = new Gateway({ authHandler: auth })`. An expired
  access token surfaces a typed `TOKEN_EXPIRED` detail so the SPA can trigger
  the silent refresh flow.
- **`types.ts`** — `AuthData`, `SSOProfile`, `UserRecord`, `MeResponse` (the
  stored refresh-token row is `StoredRefreshToken`, defined in
  `refresh-token-model.ts`).
- **`service.ts`** — shared helpers: login finalisation, cookie issuance, JWT
  pair minting, auth-event audit.
- **`user-model.ts`**, **`refresh-token-model.ts`** — tagged-template DB access
  (`db` from `../db/db`), parameterized only (INV-2).
- **`drivers.ts`** — `GET /api/v1/auth/drivers` (list), `/status` (raw, no
  401), `/login` (raw, default-driver redirect).
- **`mock.ts`**, **`rauthy.ts`**: per-driver login + callback
  flows (`isMockEnabled` / `isRauthyConfigured` gate availability).
- **`me.ts`**, **`refresh.ts`**, **`logout.ts`**, **`csrf-token.ts`** — the
  profile read and the cookie/token lifecycle endpoints.

### 3.2 Endpoint map

| Path | Kind | Notes |
|------|------|-------|
| `GET /api/v1/auth/me` | typed, `auth: true` | profile from the persisted user row |
| `GET /api/v1/auth/csrf-token` | raw | sets the CSRF cookie, returns `{ token }` |
| `POST /api/v1/auth/refresh` | raw | rotates the token pair (CSRF-exempt) |
| `POST /api/v1/auth/logout` | raw, `auth: true` | revokes refresh token + clears cookies (+ optional IdP SLO) |
| `GET /api/v1/auth/drivers` | typed | list of configured drivers |
| `GET /api/v1/auth/status` | raw | auth status (no 401) |
| `GET /api/v1/auth/login` | raw | default-driver redirect |
| `GET /api/v1/auth/{mock,rauthy}/login` | raw | per-driver SSO entry point; consumes the auth rate bucket inline |
| `GET /api/v1/auth/rauthy/callback` | raw | OIDC code-exchange callback (CSRF-exempt); the mock driver logs in inline at `/mock/login` and has no callback |

### 3.3 Invariant enforcement

This service enforces the following invariants from spec `002-security-data-invariants`:

- **INV-1 (AUTH-007 multi-role)** — IdP claims → `user_account.user_roles TEXT[]` →
  JWT `roles` → `getAuthData().roles`, with `requireRole` any-of checks.
- **INV-3 (httpOnly cookies)** — access/refresh/CSRF cookies issued by
  `auth/service.ts`, `httpOnly` + `secure` + `sameSite=lax`.
- **INV-4 (CSRF double-submit)** — `csrfMiddleware` on the service; callbacks
  and `/auth/refresh` in the exempt set.
- **INV-5 (security headers)** — `securityHeaders` middleware mounted.
- **INV-6 (rate limiting)** — `apiRateLimit` middleware on the service; the
  tighter auth bucket consumed inline (`withinAuthRateLimit`) on the login and
  rauthy-callback endpoints.
- **INV-7 (RS256 JWT + refresh rotation)** — `auth/refresh.ts` rotates (new pair,
  revoke presented token); `auth/handler.ts` verifies access tokens.
- **INV-8 (audit trail)** — login, logout, and refresh MUST write best-effort
  audit records.
- **INV-9 (multi-driver registry)**: both drivers (`mock`, `rauthy`) are
  implemented and discoverable via `GET /api/v1/auth/drivers`.

### 3.4 Functional requirements

**FR-001**: Authentication MUST be validated by a single Encore `authHandler`
registered on a `Gateway`; endpoints requiring auth declare `auth: true` and
read identity via `getAuthData()`.

**FR-002**: The handler MUST accept the httpOnly `access_token` cookie (SPA
primary path) and, additively, `Authorization: Bearer`; it MUST surface
`TOKEN_EXPIRED` distinctly so the client can trigger the silent refresh flow.

**FR-003**: Both drivers (`mock`, `rauthy`) MUST be available at parity and
discoverable via `/api/v1/auth/drivers`; availability is config-gated: a driver
absent from config is simply not listed.

**FR-004**: Refresh MUST rotate (issue a new pair, revoke the presented token)
and MUST be revocable server-side; only the SHA-256 hash of a refresh token is
stored (spec `002` INV-7).

**FR-005**: The service MUST mount `securityHeaders`, `csrfMiddleware`, and
`apiRateLimit`; SSO callbacks and `/auth/refresh` MUST be CSRF-exempt; the login
and callback endpoints (`/mock/login`, `/rauthy/login`, `/rauthy/callback`) MUST
additionally consume the tighter auth rate bucket inline (`withinAuthRateLimit`,
spec `002` INV-6).

**FR-006**: Multi-role MUST be preserved end-to-end (spec `002` INV-1): IdP
claims to `user_account.user_roles TEXT[]` to JWT `roles` to
`getAuthData().roles`, with `requireRole` any-of checks.

**FR-007**: Auth mutations (login, logout, refresh) MUST write a best-effort
audit record (spec `002` INV-8).

### 3.5 Key entities

- **AuthData** — `{ userID, email, name, roles, ssoProvider }`, the per-request identity
  surfaced by the handler to every `auth: true` endpoint.
- **SSOProfile** — the normalized profile a driver returns before it is
  resolved to a `user_account` row.

## 4. Acceptance criteria

**AC-1**: `cd apps/api && encore check` passes with the `auth` service and its
`Gateway`/`authHandler` present, the `auth: true` endpoints resolving
`getAuthData()`, and the `health` service unaffected.

**AC-2**: `cd apps/api && npm test` passes; unit tests cover `requireRole`
any-of semantics and CSRF token validation. Refresh-token rotation against the
database is covered by `auth/refresh.itest.ts`, run via
`npm run test:integration` (`encore test`).

**AC-3**: Both drivers' login flows and the rauthy OIDC callback are exercised in
integration or test mode (the mock driver logs in inline and has no callback);
`GET /api/v1/auth/drivers` returns only the drivers whose config keys are present.

**AC-4**: `npx spec-spine compile` produces no new diagnostics; `npx spec-spine
index check` exits 0; `npx spec-spine couple --base origin/main` is clean for
`apps/api/auth/` (owned here).

## 5. Out of scope

- The BFF proxy service — see spec `004-bff-gateway-proxy`.
- Per-endpoint data scoping for domain services — see spec `002` INV-1
  downstream obligation note.
- Client-side auth stores — see spec `006-client-encore-integration`.
- The security primitives (`lib/`) and persistence schema (`db/`) — see spec `002`.
