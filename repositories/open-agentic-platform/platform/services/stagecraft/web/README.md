# Statecraft Web Frontend

React Router v7 frontend for the Statecraft control plane, served by the Encore.ts backend.

## Stack

- React Router v7 (SSR + HMR)
- TailwindCSS
- TypeScript

## Routes

| Path | Access | Purpose |
|------|--------|---------|
| `/` | Public | Landing page |
| `/signin`, `/signup` | Public | Authentication |
| `/app` | Authenticated | User dashboard |
| `/app/settings` | Authenticated | User settings |
| `/admin` | Admin only | Admin panel |
| `/admin/users` | Admin only | User management |
| `/admin/audit` | Admin only | Audit log viewer |
| `/admin/signin` | Public | Admin sign-in |

## Development

### Full-stack local (no cluster)

The frontend is bundled into the Encore.ts backend and served from a prebuilt `web/build/`. Run from the statecraft root:

```bash
npm run start
# → http://localhost:4000
```

`npm run start` rebuilds the frontend before starting Encore — web/** edits require a restart to take effect.

### Frontend HMR against the Hetzner cluster

For fast iteration on web/**, run the React Router dev server alongside a mirrord'd Encore backend. Two terminals, both from `platform/`:

```bash
# Terminal 1 — Encore backend on :4000, traffic stolen from the cluster pod
make dev-statecraft-hetzner

# Terminal 2 — Vite dev server on :3000 with HMR, proxying Encore paths to :4000
make dev-statecraft-web-hetzner
```

Open http://localhost:3000. Frontend edits hot-reload; SSR loaders reach the mirrord'd Encore via `ENCORE_API_BASE_URL=http://localhost:4000`; browser-initiated hits to Encore-owned paths (`/api/*`, `/auth/oidc*`, `/auth/rauthy*`, `/site`, `/v1/*`, ...) are proxied by vite.

**Selective steal.** Mirrord's steal filter (`infra/hetzner/mirrord/statecraft.yaml`) only diverts requests carrying `x-statecraft-dev: 1`, which vite injects on every proxied request. Without this filter, kubelet's `GET /healthz` probes on :4000 get stolen to the laptop — during the ~500ms Encore boot they fail, k8s terminates the pod, and the mirrord agent aborts with "agent unexpectedly closed connection". Consequence: while this config is active, browser hits to `https://${DOMAIN}` stay on the pod (production behaviour preserved); use `http://localhost:3000` for dev.

**Auth flow on localhost.** `dev-statecraft-hetzner` defaults `DEV_APP_BASE_URL=http://localhost:3000`, so OAuth/OIDC callbacks land on the dev origin. The compile script writes this into `.statecraft.env` and `statecraft.yaml` excludes `APP_BASE_URL` from mirrord's pod-env import so the override wins. Register the matching redirect URIs:

- Rauthy `statecraft-server` client → add `http://localhost:3000/auth/oidc/callback` and `http://localhost:3000/auth/rauthy/callback`
- Rauthy GitHub upstream provider → add `http://localhost:3000/auth/rauthy/callback` (spec 106)

> **Note (spec 107).** Production redirect URIs (`${APP_BASE_URL}/auth/rauthy/callback` and `${APP_BASE_URL}/auth/oidc/callback`) are now managed automatically by `scripts/seed-rauthy.mjs` on every Helm release. The seeder merges these into the `statecraft-server` client's allow-list without touching other entries, so the localhost URIs you add here for dev survive deploys. OPC's `opc://auth/callback` is similarly converged when `OPC_CLIENT_ID` is set.

To keep the pod's cluster-domain `APP_BASE_URL` instead (e.g. for testing the deployed origin), run `DEV_APP_BASE_URL= make dev-statecraft-hetzner` — empty override forces the compile script's pod-env fallback.

## Build

```bash
npm run build:frontend
```

The built assets are served by the Encore.ts backend.
