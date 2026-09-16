# Troubleshooting Guide

## Common Issues and Solutions

### Development Server Issues

#### `encore: command not found`

The backend is an Encore.ts app. Install the Encore CLI ([encore.dev/docs/install](https://encore.dev/docs/install)),
then `npm run dev:api` (or `npm run dev`).

#### Database / migration errors on `encore run`

`encore run` starts a local Postgres in Docker for `SQLDatabase("app")`. Ensure **Docker is running**. If
migrations fail, check `apps/api/db/migrations/*.up.sql` and the Encore output; reset the local DB from the
Encore dev dashboard (http://localhost:9400) if needed.

#### Port 4000 already in use

```bash
# Windows
netstat -ano | findstr :4000
taskkill /F /PID <process_id>

# Linux/Mac
lsof -ti:4000 | xargs kill -9
```

A stale `encore run` is the usual cause. Encore watches the source and recompiles in place, so you rarely
need to restart manually.

---

### Authentication Issues

#### Login fails / "invalid signature" in dev

JWTs are RS256-signed. In development the keys come from `apps/api/keys/*.pem`. Run `npm run generate-keys`
inside `apps/api` if they are missing. In production, set `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` /
`JWT_REFRESH_PRIVATE_KEY` / `JWT_REFRESH_PUBLIC_KEY` as Encore secrets.

#### Not authenticated after login (cookies not set)

Auth uses httpOnly cookies (access + refresh + CSRF). Check:

1. `API_BASE_URL` and `FRONTEND_URL` are correct and the SPA origin is in `encore.app` `global_cors`.
2. In production, HTTPS is in use (cookies are `secure`).
3. The OIDC round-trip returns via a top-level redirect, so auth cookies use `SameSite=Lax`; `secure` is automatic in production (`NODE_ENV=production`).
4. The browser allows cookies (not blocked in private mode).

#### Request returns 403 with `CSRF_MISSING` / `CSRF_MISMATCH`

State-changing requests need a CSRF token. Fetch it from `GET /api/v1/auth/csrf-token` and send it back as
the `X-CSRF-Token` header. The login callbacks and `/api/v1/auth/refresh` are exempt by design. The SPA's
axios layer (and the committed `encore-client.ts`) already do this; if you call the API directly, replicate
the fetch-then-replay.

#### Access token expired mid-session

Access tokens are short-lived (~15 min). The SPA calls `POST /api/v1/auth/refresh` to rotate the refresh
token and mint a new access cookie. If refresh fails (revoked or expired refresh token), the user must log
in again. `POST /api/v1/auth/logout` revokes the refresh token server-side.

#### rauthy login fails / token validation failed

1. Verify `RAUTHY_ISSUER` points at the rauthy base URL and that `<RAUTHY_ISSUER>/.well-known/openid-configuration` is reachable from the backend (provider metadata and the JWKS are discovered from it).
2. Confirm the redirect URI registered in rauthy matches `RAUTHY_REDIRECT_URI` (`<API_BASE_URL>/api/v1/auth/rauthy/callback`).
3. Confirm `RAUTHY_CLIENT_ID` / `RAUTHY_CLIENT_SECRET` are set as secrets and match the rauthy client.
4. Ensure the client secret has not been rotated out from under the app.

#### Roles or groups missing from the session

rauthy always emits a `roles` claim; the `groups` claim is only emitted when the `groups` scope is requested.
Confirm `RAUTHY_SCOPES` includes `groups` (default `openid profile email groups`). When no role claim is
present, the user falls back to `RAUTHY_DEFAULT_ROLE`.

---

### API Gateway (BFF) Issues

The gateway proxies `/api/v1/data/*` to a private backend with a service-to-service OAuth token.

#### 503 "service unavailable"

Gateway env vars are not configured. Set and restart:

```bash
PRIVATE_API_BASE_URL=https://your-private-app.internal/api/v1/public
GATEWAY_OAUTH_TOKEN_URL=https://your-oidc-provider.example.com/oauth2/token
GATEWAY_OAUTH_SCOPE=<private-api-scope>
GATEWAY_OAUTH_CLIENT_ID=<public-app-client-id>          # secret
GATEWAY_OAUTH_CLIENT_SECRET=<secret-VALUE>              # secret
```

#### 502 "failed to reach backend"

The upstream call failed (network, OAuth, or a backend 5xx; upstream 5xx is masked to 502). Diagnose each step:

```bash
# 1. Reach the private backend?
curl -s https://your-private-app.internal/

# 2. Acquire an OAuth token?
curl -s -X POST "${GATEWAY_OAUTH_TOKEN_URL}" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=${GATEWAY_OAUTH_CLIENT_ID}&client_secret=${GATEWAY_OAUTH_CLIENT_SECRET}&scope=${GATEWAY_OAUTH_SCOPE}"

# 3. Call the private API with the token?
#    (acquire token as above, then:)
curl -s -H "Authorization: Bearer $TOKEN" "${PRIVATE_API_BASE_URL}/info"
```

| Step 1 fails | Network issue: private networking, private endpoints, DNS, access restrictions. |
|---|---|
| Step 2 fails | OAuth issue: see token-endpoint errors below. |
| Step 3 fails | Private backend rejects the token: audience/version/validation config on the backend side. |

#### Token endpoint returns "invalid client secret"

`GATEWAY_OAUTH_CLIENT_SECRET` is set to the secret **ID** (a GUID) instead of the secret **value**. The value
is only shown once at creation; create a new client secret if you cannot retrieve it.

#### Token endpoint returns "consent required" / "app not found"

The public app lacks permission for the private app's scope. In your OIDC provider, grant the public client
access to the private API's scope (and admin consent if your provider requires it).

#### 504 "backend timed out"

The private backend did not respond within `GATEWAY_TIMEOUT_MS` (default 30s). Check backend responsiveness;
raise the timeout if warranted.

#### Private backend returns HTML instead of JSON

`PRIVATE_API_BASE_URL` is missing the API path prefix, so requests hit the backend's SPA fallback. Include
the full prefix, e.g. `https://private-app.internal/api/v1/public`.

---

### CORS Issues

#### "blocked by CORS policy"

CORS is configured in `encore.app` `global_cors`, not per-request middleware. Ensure the SPA origin (exact
protocol + host + port) is enumerated in the credentialed origins, and that `API_BASE_URL` / `FRONTEND_URL`
match. Recompile (`encore run`) after editing `encore.app`.

---

### Type / Build Issues

#### `encore check` reports errors

`encore check` parses the app, resolves the service graph and topology, type-checks, and applies migrations.
Read the diagnostic: a missing `encore.service.ts`, an endpoint with an invalid signature, or a migration
error are the common causes.

#### Typed client drift (CI `client-staleness` fails)

The committed `apps/web/src/lib/encore-client.ts` drifted from the API. Regenerate and commit:

```bash
npm --prefix apps/api run gen:client
```

---

## Getting Help

### Logs and traces

- **Development**: the Encore dev dashboard at http://localhost:9400 shows request traces, the API explorer,
  and a DB shell. Structured logs stream to the console.
- **Production**: container/platform logs (`docker logs`, `kubectl logs`, or the platform's log stream).

### Verify configuration

```bash
curl http://localhost:4000/health
curl http://localhost:4000/api/v1/auth/drivers
```

### Report issues

Gather: `node --version`, the Encore CLI version (`encore version`), the failing command, sanitized logs, and
steps to reproduce.

---

**Last Updated**: 2026-06-05
