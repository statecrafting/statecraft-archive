---
id: "004-bff-gateway-proxy"
title: "BFF gateway proxy: api.raw /api/v1/data/* to the private backend"
status: approved
created: "2026-06-10"
owner: bart
kind: feature
domain: app
risk: high
implementation: complete
depends_on: ["001-encore-app-architecture", "002-security-data-invariants", "003-multi-driver-auth-service"]
code_aliases: ["BFF_PROXY", "GATEWAY_SERVICE"]
summary: >
  The gateway service: an api.raw catch-all at /api/v1/data/* proxying to
  the private backend with an S2S OAuth client-credentials token cache,
  path-traversal sanitisation, 5xx masking, upstream timeout mapped to 504,
  and per-access audit (INV-10).
establishes:
  - "apps/api/gateway/"
---

# 004 — BFF gateway proxy: api.raw /api/v1/data/* to the private backend

## 1. Purpose

The defining security trait of this template is that the public application
never talks to the private backend directly. The `gateway` service is the
realisation of that contract: an `api.raw` catch-all at `/api/v1/data/*` that
proxies authenticated requests to the private backend, injecting a
service-to-service OAuth client-credentials Bearer token so the browser never
holds backend credentials and the private backend is never directly reachable.

This is the complete enforcement of spec `002-security-data-invariants` INV-10
(BFF proxy contract). After this service is in place the only remaining
invariant not fully enforced in this template's own surface is INV-1's
role-scoped data endpoints, which is a downstream obligation (the template
ships no domain data services to scope).

## 2. Territory

This spec owns `apps/api/gateway/`. The OAuth credentials (`GATEWAY_OAUTH_*`)
are declared in `lib/secrets.ts` (owned by spec `002`). The Gateway authHandler
(spec `003`) runs before any proxy handler body — `auth: true` on all proxy
endpoints ensures unauthenticated callers are rejected before reaching
`proxy.ts`.

## 3. Behavior

### 3.1 Service shape

`apps/api/gateway/` is one Encore service:

- **`encore.service.ts`** — `Service("gateway", { middlewares: [securityHeaders,
  csrfMiddleware, apiRateLimit] })`. State-changing proxy calls carry the SPA's
  `X-CSRF-Token`.
- **`proxy.ts`** — five `api.raw` handlers (GET / POST / PUT / PATCH / DELETE)
  bound to `/api/v1/data/*path`, all `auth: true` so the Gateway authHandler
  (spec `003`) rejects unauthenticated callers before the body runs;
  `getAuthData()` yields the caller identity for the audit line.
- **`token-cache.ts`** — the S2S OAuth client-credentials cache.

### 3.2 The INV-10 contract

Every element of the INV-10 contract (spec `002`) is enforced here:

#### Path-traversal sanitisation

`sanitizePath` iteratively `decodeURIComponent`s the forwarded path (defeating
`%2e%2e` / double-encoding), rejects any `..` segments and control characters,
and re-anchors to a single leading slash. A rejected path logs
`gateway.blocked.path_traversal` and returns 400.

#### S2S OAuth Bearer injection

`getAccessToken()` in `token-cache.ts` returns a cached client-credentials
token (60s expiry buffer, concurrent-fetch deduplication) and injects it as
`Authorization: Bearer` on the upstream call. The public caller's own token is
**never** forwarded to the private backend.

#### 5xx masking

Upstream 5xx responses collapse to a generic `502 bad_gateway`; 4xx error
bodies are stripped of any `error.stack`. Upstream internals never leak to the
public caller.

#### Timeout to 504

An `AbortController` aborts the upstream fetch after `GATEWAY_TIMEOUT_MS`
(default 30 s); the abort surfaces as `504 deadline_exceeded`.

#### Per-access audit

Every data access logs an audit line with the caller id, HTTP method, and
sanitised path (spec `002` INV-8).

#### Availability gate

When the S2S OAuth inputs or the private backend URL are unconfigured,
`isGatewayConfigured()` returns false and requests return `503` rather than
attempting a call.

### 3.3 Endpoint map

| Path | Methods | Kind | Notes |
|------|---------|------|-------|
| `/api/v1/data/*path` | GET / POST / PUT / PATCH / DELETE | `api.raw`, `auth: true` | proxy to `PRIVATE_API_BASE_URL` with S2S Bearer |

### 3.4 Functional requirements

**FR-001**: Every `/api/v1/data/*` request MUST run behind the Gateway
authHandler (`auth: true`); unauthenticated callers MUST receive 401 before the
proxy body runs.

**FR-002**: The forwarded path MUST be sanitised against traversal (iterative
decode, reject `..` and control chars); a rejected path MUST return 400 and log
a security event.

**FR-003**: The upstream call MUST carry an injected S2S OAuth client-credentials
Bearer token; the caller's own token MUST NOT be forwarded.

**FR-004**: Upstream 5xx MUST be masked to a generic 502; 4xx error bodies MUST
be stripped of stack traces; upstream internals MUST NOT leak to the public
caller.

**FR-005**: An upstream timeout MUST surface as 504; the proxy MUST NOT hang
past `GATEWAY_TIMEOUT_MS`.

**FR-006**: Every data access MUST write an audit log line (caller id, method,
sanitised path).

**FR-007**: When the gateway is unconfigured (missing OAuth inputs or backend
URL), requests MUST return 503 — no half-configured proxy attempt.

### 3.5 Key entities

- **S2S token** — the cached OAuth client-credentials access token for the
  BFF-to-backend hop; never exposed to the public caller or to the browser.

## 4. Acceptance criteria

**AC-1**: `cd apps/api && encore check` passes with the `gateway` service present
and its five `api.raw` `/api/v1/data/*` handlers resolving behind the Gateway
authHandler from spec `003`.

**AC-2**: `cd apps/api && npm test` passes; unit tests cover `sanitizePath` (at
minimum: double-encoded traversal, control characters, clean paths) in
`gateway/path.test.ts`, the masking decisions (5xx to 502, timeout to 504, 4xx
stack stripping) in `gateway/masking.test.ts`, and the availability gate in
`gateway/token-cache.test.ts`. The full proxy handler (503/502/504 masking, 4xx
stack stripping, S2S token injection, and the per-access audit) is covered by
`gateway/proxy.itest.ts`, run via `npm run test:integration` (`encore test`).

**AC-3**: An unconfigured gateway (no `PRIVATE_API_BASE_URL` or OAuth secrets)
returns 503 on any data request; an unauthenticated caller returns 401; a path
containing `../` after iterative decoding returns 400.

**AC-4**: `npx spec-spine compile` produces no new diagnostics; `npx spec-spine
index check` exits 0; `npx spec-spine couple --base origin/main` is clean for
`apps/api/gateway/` (owned here).

## 5. Out of scope

- The `authHandler` and `Gateway` — those are owned by spec
  `003-multi-driver-auth-service`.
- OAuth credential declarations (`GATEWAY_OAUTH_*` secrets) — owned by spec
  `002-security-data-invariants` (`lib/secrets.ts`).
- Per-endpoint data scoping for domain services — see spec `002` INV-1
  downstream obligation note.
- The client-side Vite dev proxy configuration — see spec
  `006-client-encore-integration`.
