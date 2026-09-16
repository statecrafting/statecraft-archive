# Authentication Setup Guide

This document describes configuring authentication for the Enterprise Application Template
(Encore.ts backend). The template ships two auth drivers:

1. **Mock**: local development (no real Identity Provider)
2. **rauthy**: OIDC, a single self-hosted OpenID Connect provider for all applications

## Authentication model

Authentication is **stateless RS256 JWT**, not a server-side session:

- On login, the `auth` service issues an **access token** (RS256, ~15 min) and a **refresh token** (~7 day,
  DB-backed, rotated on use, revocable), both in **httpOnly cookies**. No token is readable from JavaScript.
- An Encore `authHandler` plus `Gateway` validate the access-token cookie (or `Authorization: Bearer`) on
  every endpoint declared `auth: true`, populating `AuthData { userID, email, name, roles, ssoProvider }`.
- State-changing requests carry a **CSRF token** (double-submit): the SPA fetches it from
  `GET /api/v1/auth/csrf-token` and replays it as the `X-CSRF-Token` header.
- `POST /api/v1/auth/refresh` rotates the refresh token and mints a new access cookie; `POST /api/v1/auth/logout`
  revokes the refresh token and clears cookies.

There is no `express-session`, no `SESSION_SECRET`, and no Redis session store. Postgres
(`SQLDatabase("app")`) stores the user record, the refresh-token hashes, and the audit log.

## Configuration model

The backend reads **non-secret** config from `apps/api/.env` (loaded by `encore run`); see
[apps/api/.env.example](../apps/api/.env.example). **Secrets** (JWT keys, `CSRF_SECRET`, the OIDC client
secret) are declared via `secret(...)` in `apps/api/lib/secrets.ts` and resolved from Encore's secret
store:

```bash
# Local development
encore secret set --type local <NAME>
# Production
encore secret set --type prod <NAME>
# or bind via infra.config.json ($env) / your secrets manager
```

JWT signing keys have a dev fallback: `npm run generate-keys` (inside `apps/api`) writes
`apps/api/keys/*.pem`, auto-loaded in dev. Unset rauthy/gateway secrets simply disable those features
(no startup crash).

Driver selection: `AUTH_DRIVER` (`mock` | `rauthy`) is the default for `/api/v1/auth/login`.
All installed drivers are also reachable at their own routes.

| Route | Purpose |
|-------|---------|
| `GET /api/v1/auth/drivers` | list available drivers |
| `GET /api/v1/auth/login` | login via the default (`AUTH_DRIVER`) driver |
| `GET /api/v1/auth/mock/login?user=0\|1\|2` | mock instant login |
| `GET /api/v1/auth/rauthy/login` → `GET /api/v1/auth/rauthy/callback` | rauthy (OIDC) |

---

## Quick Start (Development): Mock

No external IdP required.

```bash
cd apps/api
npm install
npm run generate-keys           # JWT keys for dev
cp .env.example .env            # defaults use AUTH_DRIVER=mock
cd ../.. && npm run dev
```

Relevant `.env` defaults:

```bash
AUTH_DRIVER=mock
API_BASE_URL=http://localhost:4000
FRONTEND_URL=http://localhost:5173
```

Then visit http://localhost:5173, click **Sign In**, and choose a mock user:

- `?user=0`: Developer (`developer`, `user` roles)
- `?user=1`: Administrator (`admin`, `user` roles)
- `?user=2`: Standard User (`user` role)

Mock users are defined in `apps/api/auth/mock.ts`.

---

## rauthy (OIDC)

For all applications, using a single self-hosted rauthy OpenID Connect provider.

### 1. Register the application

In rauthy, register a client and add a **Redirect URI**:
`https://your-app.example.com/api/v1/auth/rauthy/callback` (and the local
`http://localhost:4000/api/v1/auth/rauthy/callback` for dev). Create a client secret.

### 2. Configure

Non-secret config in `apps/api/.env`:

```bash
AUTH_DRIVER=rauthy
RAUTHY_ISSUER=https://your-rauthy.example.com     # OIDC issuer; the provider is discovered from its .well-known/openid-configuration
RAUTHY_REDIRECT_URI=https://your-app.example.com/api/v1/auth/rauthy/callback
RAUTHY_SCOPES=openid profile email groups          # default scopes
RAUTHY_DEFAULT_ROLE=user                            # fallback when no role claim is present
```

Secrets (Encore secret store):

```bash
encore secret set --type local RAUTHY_CLIENT_ID
encore secret set --type local RAUTHY_CLIENT_SECRET
```

The provider metadata (authorization, token, and JWKS endpoints) is discovered from `RAUTHY_ISSUER`
via `.well-known/openid-configuration`. rauthy always emits a `roles` claim, and emits a `groups` claim
when the `groups` scope is requested. Roles resolve from token claims, falling back to `RAUTHY_DEFAULT_ROLE`.

---

## Configuration Reference

### Core (all drivers)

```bash
AUTH_DRIVER=mock|rauthy
API_BASE_URL=https://your-app.example.com     # builds OAuth callback URLs
FRONTEND_URL=https://your-app.example.com     # post-login redirect target (comma-separated; first wins)
```

### JWT + CSRF (secrets)

```bash
# Dev: npm run generate-keys (apps/api). Prod: set as Encore secrets (PEM strings).
JWT_PRIVATE_KEY= / JWT_PUBLIC_KEY= / JWT_REFRESH_PRIVATE_KEY= / JWT_REFRESH_PUBLIC_KEY=
CSRF_SECRET=                                  # HMAC key for CSRF token signatures
```

### Rate limiting

```bash
RATE_LIMIT_API_MAX=100
RATE_LIMIT_API_WINDOW_MS=900000
RATE_LIMIT_AUTH_MAX=20
RATE_LIMIT_AUTH_WINDOW_MS=900000
# REDIS_URL=redis://localhost:6379            # optional: Redis-backed rate limits (NOT sessions)
```

---

## Security Best Practices

1. **Secrets management**: use Encore secrets / your secrets manager; never commit secret values. `keys/` and
   `*.pem` are gitignored.
2. **HTTPS in production**: cookies are `secure`; most providers require HTTPS callback URLs.
3. **JWT keys**: RSA 2048-bit minimum; rotate periodically. Refresh tokens are stored hash-only and are
   revocable (logout-everywhere).
4. **Rate limiting**: the `auth` tier (`RATE_LIMIT_AUTH_*`) protects login/callback from brute force.
5. **PII**: `LOG_PII` must be `false` in production (the app fails fast otherwise); the logger redacts PII.
6. **Client secret**: rotate the rauthy client secret periodically; have a renewal process.

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for rauthy/CSRF/cookie issues.

## Additional Resources

- [OpenID Connect specifications](https://openid.net/developers/specs/)
- [Encore.ts auth handlers](https://encore.dev/docs/ts/develop/auth)
- Your organization's digital service standard (consult your internal policy documentation)

---

**Last Updated**: 2026-06-05
