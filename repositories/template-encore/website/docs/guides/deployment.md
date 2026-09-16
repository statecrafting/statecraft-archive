# Deployment

**acme-vue-encore** supports a dual-path deployment strategy, detailed in spec 008. You can deploy using a Node zip artifact or a custom Docker container image.

## Dual Deploy Paths

### 1. Node Zip Path
This path uses a brittle "cancel-then-scrape" technique (`docker-build.sh`) that reaches into Encore internals to extract the compiled JavaScript bundle before the slow gzip-layer step begins. This path is CLI-version-sensitive and is generally not recommended for standard deployments, but it is available for specialized environments.

### 2. Encore Container Path (Recommended)
This is the supported path. An inert Continuous Deployment (CD) template is provided at `.github/workflows/encore-cd.yml.example`.

To activate this path:
1. Configure your container registry and credentials.
2. Rename the file to `encore-cd.yml`.
3. SHA-pin the third-party GitHub Actions (as required by the spec 011 workflow-pins policy).

This workflow installs the Encore CLI, runs `npm ci` and `encore gen client`, builds the SPA, and uses the `encore-build` composite action to push the resulting image to your registry.

## Configuration Split

Encore enforces a strict separation between non-secret configuration and secrets.

### Non-Secret Configuration
Non-secret configuration is provided via environment variables (or `apps/api/.env` locally).

```bash
NODE_ENV=production
PORT=4000
API_BASE_URL=https://your-app.example.com
FRONTEND_URL=https://your-app.example.com
AUTH_DRIVER=rauthy
SERVE_CLIENT=true
LOG_PII=false
```

### Secrets
Secrets must be provided via the Encore secret store or bound through `infra.config.json` (`$env`). They must never be committed to the repository.

```bash
encore secret set --type prod JWT_PRIVATE_KEY
encore secret set --type prod CSRF_SECRET
encore secret set --type prod RAUTHY_CLIENT_SECRET
```

## Database Migrations

Encore applies database migrations automatically during `encore run` and on Encore-managed deployments.

If you are deploying a self-hosted Docker container and managing your own Postgres instance, you must run the standalone migration runner before starting the application:

```bash
cd apps/api && npm run db:migrate
```

Ensure your managed Postgres instance enforces TLS and is bound correctly through `infra.config.json`.
