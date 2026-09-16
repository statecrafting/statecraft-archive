---
id: "002-security-data-invariants"
title: "Security and data invariants: the API's non-negotiable guarantees (INV-1 - INV-11)"
status: approved
created: "2026-06-10"
owner: bart
kind: governance
domain: app
risk: high
implementation: complete
depends_on: ["001-encore-app-architecture"]
code_aliases: ["SECURITY_INVARIANTS", "INV_CATALOG"]
summary: >
  Eleven non-negotiable security and data guarantees (INV-1 - INV-11) that
  every build of the template enforces: role-scoped data access,
  parameterized SQL, httpOnly cookies, CSRF, security headers, rate
  limiting, RS256 JWT with refresh rotation, audit trail, multi-driver
  auth, the BFF proxy contract, and compliance tags. apps/api/lib and
  apps/api/db are the enforcement substrate.
establishes:
  - "apps/api/lib/"
  - "apps/api/db/"
---

# 002 — Security and data invariants: the API's non-negotiable guarantees (INV-1 - INV-11)

## 1. Purpose

This spec is the authoritative invariant record for this enterprise
template's API. It catalogs eleven non-negotiable security and data guarantees
and identifies where each is enforced. Specs `003-multi-driver-auth-service`
and `004-bff-gateway-proxy` cross-reference this catalog by INV number; an
implementation that drops or weakens any invariant is a defect regardless of
what layer introduces the change.

This spec owns `apps/api/lib` (shared security primitives) and `apps/api/db`
(persistence schema), the enforcement substrate on which all services build.

## 2. Territory

`apps/api/lib/` and `apps/api/db/` are the foundational directories. Every
service in the Encore application (spec `001`) draws from `lib/` for cookie
handling, CSRF, security headers, rate limiting, JWT, audit, and secrets; and
from `db/` for the `SQLDatabase("app")` instance and schema scripts.

INV-1's role-scoped data endpoints are a downstream obligation — the template
ships no domain data services to scope, so applications built from it MUST
implement per-endpoint scoping when they add domain services.

## 3. Behavior

### 3.1 Invariant catalog

#### INV-1: Role-scoped data access (AUTH-007)

Authenticated principals hold **multiple roles** (`string[]`, any-of
membership — not a privilege hierarchy). Role-scoped endpoints restrict the
data they return to what the caller's roles permit, enforced in the service
layer (a `WHERE`-clause scoping, not a client-side filter).

- **Enforcement substrate**: `user_account.user_roles TEXT[]`
  (`db/migrations/2_user_account.up.sql`); `hasRole` / `requireRole` any-of
  checks (`lib/roles.ts`).
- **Service enforcement**: multi-role is exercised end-to-end by the auth
  service — IdP claims → `user_account.user_roles TEXT[]` → JWT `roles` →
  `getAuthData().roles` → `requireRole` any-of checks (`auth/handler.ts`).
- **Downstream obligation**: per-endpoint data scoping (`WHERE` clause by
  role) is an obligation of applications built from this template when they
  add domain data services. AUTH-007 regression tests MUST accompany any such
  endpoint and assert that a lower-privileged caller cannot read another
  scope's rows.

#### INV-2: Parameterized SQL only

No string-concatenation path to the database. All queries use Encore's
tagged-template API, which auto-parameterizes `${...}` interpolations.
Polymorphic queries, when needed, branch into fixed-shape queries or use
positional `$N` params — never string concatenation.

- **Enforcement**: `db/db.ts` (`SQLDatabase("app")`, tagged-template
  contract); `auth/user-model.ts`, `auth/refresh-token-model.ts`.

#### INV-3: httpOnly cookies only (cookie-auth flow)

Access/refresh/CSRF cookies are `httpOnly` plus `secure` plus
`sameSite=lax`; no token is readable from JavaScript. A `Authorization:
Bearer` path is available additively and never replaces the cookie path.

- **Enforcement**: `lib/cookie-config.ts`, `lib/cookies.ts`; cookies issued
  by `auth/service.ts` and read by `auth/handler.ts`.

#### INV-4: CSRF double-submit

State-changing cookie-auth requests carry a CSRF token validated with a
constant-time compare against a signed cookie value; sub-codes
(`CSRF_MISSING` / `CSRF_MISMATCH`) land at `details.code`.

- **Enforcement**: `lib/csrf.ts` (middleware factory plus exempt-path
  allow-list); `csrfMiddleware` mounted on the `auth` service; SSO
  callbacks and `/auth/refresh` are in `CSRF_EXEMPT_PATHS`.

#### INV-5: Security headers

CSP, HSTS, and Permissions-Policy are applied as an Encore middleware.

- **Enforcement**: `lib/security-headers.ts`; `securityHeaders` middleware
  mounted on the `health` and `auth` services.

#### INV-6: Rate limiting

Postgres-backed fixed-window rate limiting over the application
`SQLDatabase("app")`: no Redis and no separate cache. The counter is an
UNLOGGED `rate_limit_counter` row per bucket, incremented with a lock-free
`ON CONFLICT DO UPDATE` upsert that resets per window and fails open on any
backend error. Two tiers: a general API tier and a tighter auth tier.

- **Enforcement**: `lib/rate-limit.ts` plus `db/migrations/5_rate_limit.up.sql`;
  `apiRateLimit` middleware mounted on the `auth` and `gateway` services, plus
  the tighter auth bucket consumed inline by the login/callback endpoints.

#### INV-7: Stateless RS256 JWT plus DB-backed refresh rotation

Access tokens are RS256, short-lived (15 min); refresh tokens are DB-backed,
rotated on use, and revocable (logout-everywhere). Only the SHA-256 hash of
a refresh token is ever stored.

- **Enforcement**: `lib/jwt.ts` (sign/verify), `lib/secrets.ts` (key
  bindings), `db/migrations/3_refresh_token.up.sql` (hash-only store);
  `/auth/refresh` rotation endpoint and `authHandler` verification in
  `auth/refresh.ts` and `auth/handler.ts`.

#### INV-8: Durable audit trail

Security-relevant mutations write a durable, queryable audit record,
best-effort (never blocking the user flow).

- **Enforcement**: `lib/audit.ts` (writer), `db/migrations/4_audit_log.up.sql`
  (table), `lib/logger.ts` `logSecurityEvent` for the log-stream side; audit
  writes on auth mutations (login, logout, refresh) and on every gateway data
  access.

#### INV-9: Multi-driver auth registry

Two SSO drivers at full parity: `mock` (dev) and `rauthy` (self-hosted OIDC
provider). Selectable by the `AUTH_DRIVER` configuration value; the
discovery/login surface is uniform across drivers.

- **Enforcement**: driver secrets declared in `lib/secrets.ts`
  (`RAUTHY_*`); `auth/mock.ts`, `auth/rauthy.ts`, driver discovery in
  `auth/drivers.ts`.

#### INV-10: BFF proxy contract

The `/api/v1/data/*` proxy to the private backend enforces: path-traversal
sanitisation of the forwarded path, a service-to-service OAuth
client-credentials token cache with Bearer injection, 5xx masking (upstream
error bodies not leaked), and upstream timeout to 504.

- **Enforcement**: `gateway/proxy.ts` (traversal sanitisation, 5xx masking,
  timeout to 504, per-access audit) and `gateway/token-cache.ts` (S2S OAuth
  client-credentials cache). Gateway OAuth secrets declared in
  `lib/secrets.ts` (`GATEWAY_OAUTH_*`).

#### INV-11: Compliance-tag discipline

Compliance and requirement annotations (`REQ-...`, `CC-...`, `FINDING-...`)
in code comments preserve the compliance trace.

- **Enforcement**: `CC-006` PII-logging guard in `lib/logger.ts`; tags
  carried in every auth handler and gateway handler.

### 3.2 Key entities

- **`user_account`**: one row per authenticated principal across drivers.
  `user_roles TEXT[]` (multi-role, INV-1), email-keyed (`text` with a
  case-insensitive `lower(email)` unique index; citext is unsupported by the
  Encore binding, see `db/migrations/6_user_account_email_text.up.sql`),
  `sso_provider_*`, `attributes JSONB`.
- **`refresh_token`**: hash-only refresh-token store (INV-7), with rotation
  plus server-side revocation via `revoked_at`; `ON DELETE CASCADE` to
  `user_account`.
- **`audit_log`**: durable audit trail (INV-8), with table/record/action plus
  old/new JSONB plus actor plus IP/UA.
- **`rate_limit_counter`**: ephemeral UNLOGGED fixed-window counter (INV-6),
  one row per `tier:client` bucket; loss-tolerant (the limiter fails open).

### 3.3 Enforcement table

| Invariant | Foundation (`lib/`, `db/`) | Service enforcement |
|-----------|---------------------------|---------------------|
| INV-1 AUTH-007 | `lib/roles.ts`, `user_roles TEXT[]` | `auth/handler.ts`: `getAuthData().roles`, `requireRole`; role-scoped data endpoints are a downstream obligation |
| INV-2 Parameterized SQL | `db/db.ts` tagged-template contract | `auth/user-model.ts`, `auth/refresh-token-model.ts` |
| INV-3 httpOnly cookies | `lib/cookie-config.ts`, `lib/cookies.ts` | `auth/service.ts` issues, `auth/handler.ts` reads |
| INV-4 CSRF | `lib/csrf.ts` factory | `csrfMiddleware` on `auth/encore.service.ts`; callbacks + `/auth/refresh` exempt |
| INV-5 Security headers | `lib/security-headers.ts` | `securityHeaders` on `health` + `auth` |
| INV-6 Rate limiting | `lib/rate-limit.ts`, `db/migrations/5_rate_limit.up.sql` | `apiRateLimit` on `auth` + `gateway`; inline auth bucket on login/callback |
| INV-7 JWT + refresh | `lib/jwt.ts`, `db/migrations/3_refresh_token.up.sql` | `auth/refresh.ts` rotation, `auth/handler.ts` verification |
| INV-8 Audit | `lib/audit.ts`, `db/migrations/4_audit_log.up.sql` | auth mutations + gateway per-access audit |
| INV-9 Multi-driver auth | `lib/secrets.ts` (driver secrets) | `auth/{mock,rauthy}.ts`, `auth/drivers.ts` |
| INV-10 BFF proxy | `lib/secrets.ts` (`GATEWAY_OAUTH_*`) | `gateway/proxy.ts`, `gateway/token-cache.ts` |
| INV-11 Compliance tags | `lib/logger.ts` (`CC-006`) | carried in auth and gateway handlers |

### 3.4 Functional requirements

**FR-001**: Every invariant in the catalog MUST remain enforced across all
services; none may be silently dropped.

**FR-002**: Database access MUST be parameterized only (INV-2); no service
may introduce a string-concatenated query path.

**FR-003**: Cookie-auth credentials MUST remain httpOnly (INV-3); a Bearer
path, if used, MUST be additive and never replace the cookie flow.

**FR-004**: Multi-role any-of semantics (INV-1) MUST be preserved; roles
MUST remain a set, not collapsed to a single role or a hierarchy.

**FR-005**: Role-scoped data endpoints (INV-1) are an obligation of
applications built from this template when they add domain data services;
they MUST scope data in the service layer via `WHERE`-clause filtering, not
client-side filtering.

## 4. Acceptance criteria

**AC-1**: `cd apps/api && encore check` passes with `lib/` and `db/` present;
the application graph resolves with zero errors.

**AC-2**: `cd apps/api && npm test` passes; parameterized-SQL contract
assertions and `hasRole` / `requireRole` unit tests are green.

**AC-3**: `npx spec-spine compile` produces no new diagnostics; `npx
spec-spine index check` exits 0; `npx spec-spine couple --base origin/main`
is clean for every path claimed by this spec.

**AC-4**: No secret value is committed; `infra.config.json` carries only
`$env` references; `keys/` and `*.pem` are gitignored.

## 5. Out of scope

- Per-endpoint data scoping for domain services — that is a downstream
  application obligation, not part of this template's API surface.
- The auth service endpoints — see spec `003-multi-driver-auth-service`.
- The BFF gateway service — see spec `004-bff-gateway-proxy`.
- CI/CD validation — see spec `007-encore-ci-cd`.
