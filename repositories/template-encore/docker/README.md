# docker/

Container configuration for the Encore.ts template.

## Production image

The production image is built by Encore, not by a hand-written Dockerfile:

```bash
# Build the SPA first (output lands in apps/api/web/build)
npm run build

# Build the Encore image (encore build docker --base apps/api/Dockerfile.base)
npm run build:api
```

`apps/api/Dockerfile.base` defines the OS base: `node:22-slim` + `ca-certificates` + `tini`. Encore overlays `main.mjs`, the native runtime (`encore-runtime.node`), and the bundled source tree (including `apps/api/web/build` because `bundle_source: true` is set in `encore.app`) on top of that base.

The result is a SINGLE image that serves both the Encore API (port 4000) and the built SPA (via the `web` service / `api.static`). There is no separate web container and no nginx container.

## Local development (primary path)

```bash
npm run dev
```

`encore run` on port 4000 auto-provisions a local Postgres instance via Docker. Vite runs in parallel. This is the recommended workflow for day-to-day development; docker-compose is not required.

## Local containerised self-host (docker-compose.yml)

`docker-compose.yml` (repo root) is for validating the built image locally or running a self-hosted stack. It is NOT the primary development path.

Services and profiles:

| Service | Profile | Purpose |
|---------|---------|---------|
| `postgres` | (default) | SQLDatabase backing (Encore-managed migrations); required by `api`, so always started |
| `redis` | `cache` | Optional Redis-backed rate limiting (`REDIS_URL`); not a session store |
| `api` | (default) | The Encore-built image; `depends_on` postgres |

Bring up the full stack:

```bash
# Build the image first (SPA into apps/api/web/build, then the Encore image)
npm run docker:build

# Start Postgres + api + Redis
docker compose --profile cache up -d

# Or just Postgres + api (Redis is optional)
docker compose up -d
```

Required env vars in `.env` (see `apps/api/.env.example`): `POSTGRES_PASSWORD`, `CSRF_SECRET`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_REFRESH_PRIVATE_KEY`, `JWT_REFRESH_PUBLIC_KEY`. Generate JWT keys with `npm --prefix apps/api run generate-keys`.

Override the image tag:

```bash
API_IMAGE=my-registry/template-api:v1.2.3 docker compose up -d
```

## Retired files

The Express-era `api.Dockerfile`, `web.Dockerfile`, and `nginx.conf` have been removed. They have no Encore analog:

- The API image is produced by `encore build docker`, not by a hand-written Dockerfile.
- The SPA is bundled into the Encore image (`bundle_source: true`); there is no separate nginx container.

See `CODEMAP.md` and `specs/048-encore-app-architecture` for the authoritative architecture.
