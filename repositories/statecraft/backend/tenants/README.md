<!-- Spec-Linkage: 004-tenants-github-app -->
# tenants (spec 004)

The tenancy spine of milestone M2. A user authenticates against the control
plane (embedded rauthy, chassis auth), creates a tenant, and installs the
statecraft GitHub App into their own org. From then on everything the platform
does for them keys off `installationId` and happens inside their org: nobody
joins our org, code sovereignty is a first-class property.

## Files

- `encore.service.ts`: service registration; mounts the general API rate-limit tier.
- `config.ts`: the fixed GitHub App identity + its three secrets (Encore
  `secret()`, falling back to `process.env` in local dev).
- `entities.ts`: `Tenant` and `Installation` CoreLedger entities.
- `store.ts`: eager schema init + data access (find-then-write upserts).
- `state.ts`: the signed, short-lived install `state` token (HMAC over the
  webhook secret). Pure functions, unit-tested.
- `signature.ts`: GitHub webhook HMAC-SHA256 verification (constant-time).
  Pure, unit-tested.
- `github-app.ts`: App JWT minting, installation-token exchange (cached in
  hiqlite KV ~50 min), and REST reads. Exported for the factory (spec 005).
- `api.ts`: the `/api/v1/tenants*` endpoints (auth required, owner-scoped).
- `setup.ts`: `GET /github/setup`, the App Setup URL callback (raw handler).
- `webhook.ts`: `POST /github/webhook`, HMAC-verified event receipt (raw handler).

## API

All `/api/v1/tenants*` endpoints require auth; `auth.userID` is the owner and
every `:id` read enforces ownership (a foreign tenant reads as 404).

- `POST /api/v1/tenants` `{ name }`: create; creator becomes owner.
- `GET  /api/v1/tenants`: list the caller's tenants.
- `GET  /api/v1/tenants/:id`: detail, including installations.
- `GET  /api/v1/tenants/:id/github/install-url`: the App installation URL with a
  signed `state` binding this tenant + user.
- `GET  /api/v1/tenants/:id/repos`: repositories visible to the tenant's active
  installation (412 if none yet).
- `GET  /github/setup`: Setup URL callback. Verifies `state`, confirms tenant
  ownership, verifies the installation via an App JWT (yielding the org),
  persists it, and redirects to the webapp. No session auth: the signed state is
  the binding.
- `POST /github/webhook`: `installation` events (created/deleted/suspend/
  unsuspend) upsert installation status. Unknown events / unknown installations:
  204, logged, ignored.

## Secrets

Wired into Encore secrets via `infra.config.json` (spec 002-owned root config,
amended by spec 004): `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_B64` (base64 PEM),
`GITHUB_WEBHOOK_SECRET`. The App is "statecraft.ing GitHub App" (App ID 3319911,
slug `statecraft-ing-github-app`), already installed org-wide on statecraft-ing
(installation 125344051), which doubles as the e2e test installation.

For local dev, `secret()` returns "" and the service reads `process.env`, so:

```bash
set -a; . ~/.config/oap/infra/hetzner/.env; set +a   # sources the three vars
npm run dev
```

## Manual e2e click path (spec 004 §4)

1. Log in to the control plane (embedded rauthy).
2. `POST /api/v1/tenants { "name": "..." }` -> note the tenant id.
3. `GET /api/v1/tenants/:id/github/install-url` -> open the returned URL.
4. On GitHub, install the App into an org (or "Configure" the existing
   statecraft-ing installation) -> GitHub redirects to `GET /github/setup`,
   which persists the `Installation` and bounces to `/?github=installed&tenant=:id`.
5. `GET /api/v1/tenants/:id` shows the installation; `GET /api/v1/tenants/:id/repos`
   returns the org's repositories.

The App webhook still points at the legacy plane (spec 004 §1); repointing it at
the new control plane happens once fleet gives it a public URL. HMAC verification
is implemented and unit-tested regardless.
