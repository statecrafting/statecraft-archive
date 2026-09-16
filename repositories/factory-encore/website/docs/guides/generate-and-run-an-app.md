# Generate and run an app

This guide walks through generating a complete Encore.ts + Vue 3 application using the `acme-vue-encore` adapter and running it locally.

## Prerequisites

- Node.js >= 24.0.0
- A clone of `factory-encore` with `make setup` completed.
- A clone of `template-encore` as a sibling directory (or set `TEMPLATE_ENCORE_SOURCE`).
- The [Encore CLI](https://encore.dev/docs/install) installed (for `encore check` and `encore gen client`).

## Generate a minimal app

The `minimal` profile uses the mock auth driver and composes no modules. It is the fastest path to a running application:

```bash
npx tsx adapters/acme-vue-encore/scripts/setup-app.ts \
  --profile minimal \
  --dest ../my-app
```

The generator:

1. Clones the `template-encore` lean baseline into `../my-app`.
2. Sets `AUTH_DRIVER=mock` in `apps/api/.env.example`.
3. Skips module composition (no `--with` flags).
4. Runs `npm install` in the destination.
5. Runs `git init` in the destination.

## Generate a public app with modules

The `public` profile uses rauthy OIDC authentication. You can compose additional modules:

```bash
npx tsx adapters/acme-vue-encore/scripts/setup-app.ts \
  --profile public \
  --dest ../my-public-app \
  --with user-management \
  --with api-gateway
```

This produces an application with:

- `AUTH_DRIVER=rauthy` configured.
- The `user-management` Encore service composed in (role catalog, admin CRUD).
- The `api-gateway` module's connectivity test page added to the frontend.
- `security-core` auto-installed (required by `api-gateway`).

## Generate a dual-app deployment

For a hard trust-zone split between external and staff access:

```bash
npx tsx adapters/acme-vue-encore/scripts/setup-dual-app.ts \
  --dest ../my-dual-app \
  --yes
```

This produces:

```
../my-dual-app/
  public/     standalone Encore app (AUTH_DRIVER=rauthy)
  internal/   standalone Encore app (AUTH_DRIVER=rauthy)
```

Each variant is independent: separate databases, separate deployments, separate scale boundaries.

## Run the generated app

After generation, set up and start the application:

```bash
cd ../my-app
npm install
npm --prefix apps/api install
npm --prefix apps/api run generate-keys
```

Start the development server:

```bash
npm run dev
```

This starts both the Encore backend (port 4000) and the Vue frontend (port 5173).

## Verify the generated app

Run the full verification suite:

```bash
npm run typecheck
npm run typecheck:api
npm test
npm --prefix apps/api test
npm run lint
```

For the Encore-specific check:

```bash
cd apps/api && encore check
```

## Machine-driven generation

For CI or platform-driven generation where VCS state and dependency installation are owned externally:

```bash
npx tsx adapters/acme-vue-encore/scripts/setup-app.ts \
  --profile public \
  --dest ../my-app \
  --no-install
```

The `--no-install` flag skips `npm install` and implies `--no-git`, producing a clean tree with no `.git` directory and no `node_modules/`. The consuming platform handles both.
