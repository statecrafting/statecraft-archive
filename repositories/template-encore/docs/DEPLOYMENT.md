# Deployment Guide

## Overview

The backend is a standalone **Encore.ts** application (`apps/api`) that builds to a Docker image via the
Encore CLI. It is stateless (RS256 JWT, no server session store) and uses Postgres via Encore's
`SQLDatabase("app")`. The two Vue SPAs build into `apps/api/web/build` and are served by the Encore app's
`web` service (`api.static`), so the default deployable is a **single container** on **port 4000**.

## Deploy paths (spec 008)

The template ships two spec-governed deploy paths. Pick the one that matches your platform:

| Path | Workflow | Unit | When to use |
|------|----------|------|-------------|
| **Node zip** (Node continuity) | `deploy-{dev,staging,prod}.yml` calling `deploy-reusable.yml` | A Node zip carrying the scraped Encore artifact (`main.mjs` + `encore-runtime.node`), the built SPA, and production `node_modules`, started with `node main.mjs` | You deploy to a Node-based app host and want to keep the familiar zip/Node idiom. |
| **Encore container** (alignment) | `encore-cd.yml.example` (inert; spec 007) | An OCI image from `encore build docker` | You deploy to a container runtime (your container host, OpenShift, Encore Cloud). This is the Encore-supported, robust unit. |

> **Zip path caveat.** The zip is assembled by the OPTIONAL cancel-then-scrape build (the
> `apps/api/scripts/docker-build.sh` model), which reaches into Encore internals and is sensitive to
> the CLI version. The container path is the supported, robust deploy unit; prefer it where your
> platform can run containers. Neither path is exercised in CI (the deploy workflows are
> `workflow_dispatch` / branch-push and the template ships no cloud target), so verify your first
> deploy against a non-prod environment.

## Build (Encore container)

The image is built with the Encore CLI, not a hand-written Node Dockerfile. `apps/api` carries:

- `Dockerfile.base`: the OS plus helper binaries that form the image base.
- `Dockerfile.hotfix`: a source-only fast path.
- `scripts/docker-build.sh`: the cancel-then-scrape hotfix builder.
- `encore.app` sets `build.docker.bundle_source: true`.

```bash
# Build the SPA bundle first (emits into apps/api/web/build, served by the web service)
npm run build:web

# Build the backend image (run from apps/api, or `npm run build:api` from the root)
cd apps/api
docker build -f Dockerfile.base -t template-api-base:local .
encore build docker --config ./infra.config.json --base template-api-base:local template-api:local
```

`npm run build:api` (root) wraps the `encore build docker` step. Tag and push the resulting image to your
container registry (GHCR or the platform's internal registry).

## Configuration

Encore separates **non-secret config** (`apps/api/.env` / platform env) from **secrets** (Encore secret
store or `infra.config.json` `$env` bindings). No secret value is committed.

### Required environment

```bash
NODE_ENV=production
PORT=4000
API_BASE_URL=https://your-app.example.com       # builds OAuth callback URLs
FRONTEND_URL=https://your-app.example.com       # post-login redirect target
AUTH_DRIVER=rauthy                              # or mock
SERVE_CLIENT=true                               # serve the built SPA from the web service
LOG_PII=false                                   # must be false in production (fail-fast)
```

### Secrets (set via `encore secret set --type prod <NAME>` or `infra.config.json` `$env`)

```bash
# JWT signing (RS256)
JWT_PRIVATE_KEY / JWT_PUBLIC_KEY / JWT_REFRESH_PRIVATE_KEY / JWT_REFRESH_PUBLIC_KEY
CSRF_SECRET

# Auth driver (whichever is active): see docs/AUTH-SETUP.md
RAUTHY_CLIENT_ID / RAUTHY_CLIENT_SECRET          # rauthy (OIDC)

# Database
POSTGRES_PASSWORD                                # consumed by infra.config.json for self-host
```

See [AUTH-SETUP.md](AUTH-SETUP.md) for the full driver configuration and [apps/api/.env.example](../apps/api/.env.example)
for every variable.

## Database

`SQLDatabase("app")` owns the schema (`user_account`, `refresh_token`, `audit_log`) and its migrations in
`apps/api/db/migrations/`. Encore applies migrations automatically on `encore run` and on Encore-managed
deploys. For a self-hosted Postgres, run the standalone migration runner:

```bash
cd apps/api && npm run db:migrate     # node scripts/migrate.mjs
```

Provision a managed Postgres with TLS enforced and bind it through
`infra.config.json` for self-hosted images.

## CD (Encore container path)

An inert CD template ships at `.github/workflows/encore-cd.yml.example` (spec 007, dual-path context
added by spec 008). It installs the Encore CLI, runs `npm ci` and `encore gen client`, builds the SPA, and
runs the `encore-build` composite action to push the image to a registry. It now also carries a documented
(commented) container-host deploy step as a starting point. It is shipped as `.example` so it stays
inactive until a project:

1. configures a container registry plus credentials,
2. renames it to `encore-cd.yml`, and
3. SHA-pins its third-party `uses:` (spec 011 workflow-pins policy).

Encore CI (`.github/workflows/encore-ci.yml`, spec 007) validates every PR: SPA type-check plus `build:web`,
`encore check`, and a typed-client staleness check.

## BFF gateway (private backend connectivity)

The `gateway` service proxies authenticated `/api/v1/data/*` requests to a private backend, injecting an
OAuth client-credentials Bearer token (service-to-service). Configure:

```bash
PRIVATE_API_BASE_URL=https://your-private-app.internal/api/v1/public   # full API path prefix
GATEWAY_OAUTH_TOKEN_URL=https://your-oidc-provider.example.com/oauth2/token   # OAuth token endpoint
GATEWAY_OAUTH_SCOPE=<private-api-scope>
GATEWAY_OAUTH_CLIENT_ID=<public-app-client-id>          # secret
GATEWAY_OAUTH_CLIENT_SECRET=<public-app-secret-VALUE>   # secret (the VALUE, not the secret ID)
# GATEWAY_TIMEOUT_MS=30000
```

The proxy strips `/api/v1/data/` and appends the remainder to `PRIVATE_API_BASE_URL`. It sanitises the
forwarded path (traversal protection), masks upstream 5xx as 502, maps timeouts to 504, and audits each
access. The built-in `/connectivity` page (authenticated) exercises `GET /api/v1/data/info` end-to-end. See
[TROUBLESHOOTING.md](TROUBLESHOOTING.md) for gateway diagnostics.

## Post-deployment verification

```bash
curl https://your-app.example.com/health             # composite health
curl https://your-app.example.com/health/readiness   # 200 / 503
curl https://your-app.example.com/api/v1/auth/drivers
curl -I https://your-app.example.com/api/v1/auth/login   # 302 to the OIDC provider (rauthy)
```

## Security considerations

1. **Secrets**: Encore secret store / your secrets manager; never hardcode. `keys/` and `*.pem` are gitignored.
2. **TLS**: enforce HTTPS; cookies are `secure` in production.
3. **Database**: TLS-enforced managed Postgres; least-privilege credentials.
4. **Image scanning**: scan the built image (Trivy, the spine supply-chain workflow already runs Trivy).
5. **PII**: keep `LOG_PII=false`; the logger redacts.

## Additional Resources

- [Encore.ts: build a Docker image](https://encore.dev/docs/ts/deploy/docker)
- [Encore.ts: self-hosting](https://encore.dev/docs/ts/self-host/build)
- `specs/008-container-host-deploy/spec.md`: the dual deploy strategy (zip + container)
- `specs/007-encore-ci-cd/spec.md`: Encore CI/CD actions and the CD example
- [CODEMAP.md](../CODEMAP.md): service graph and security model

---

**Last Updated**: 2026-06-07
