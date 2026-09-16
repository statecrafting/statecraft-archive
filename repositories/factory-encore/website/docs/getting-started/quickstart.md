# Quickstart

This guide walks you through setting up the factory-encore repository and generating your first application with the `acme-vue-encore` adapter.

## Prerequisites

| Requirement | Minimum version |
|-------------|-----------------|
| Node.js | >= 24.0.0 |
| npm | >= 10.0.0 |
| Git | any recent version |

The repository is `private: true` and is not installable as an npm package. You work with it by cloning the repository directly.

## Clone and set up

```bash
git clone https://github.com/stagecraft-ing/factory-encore.git
cd factory-encore
make setup
```

`make setup` performs three steps:

1. `npm install` to install all dependencies (including `spec-spine@0.8.0`).
2. `npx spec-spine compile` to build the spec registry under `.derived/spec-registry/`.
3. `npx spec-spine index` to build the codebase index under `.derived/codebase-index/`.

After setup completes, the governance kernel is operational and the generator is ready to use.

## Generate a first app

The generator requires a checkout of `template-encore` (the lean baseline it clones). Clone it as a sibling:

```bash
cd ..
git clone https://github.com/stagecraft-ing/template-encore.git
cd factory-encore
```

Run the single-app generator with the `minimal` profile (mock auth, no external dependencies):

```bash
npx tsx adapters/acme-vue-encore/scripts/setup-app.ts \
  --profile minimal \
  --dest ../my-app
```

This produces a complete Encore.ts + Vue 3 application at `../my-app` with:

- An Encore backend (`apps/api/`) with health, auth (mock driver), database, and web services.
- A Vue 3 SPA (`apps/web/`) on PrimeVue with Pinia state management.
- No generator tooling, no spec-spine, no factory references: a plain application that boots on its own.

## Run the generated app

After generation, follow the setup commands declared in the adapter manifest:

```bash
cd ../my-app
npm install
npm --prefix apps/api install
npm --prefix apps/api run generate-keys
```

Then start the development server:

```bash
npm run dev
```

## Available profiles

| Profile | Auth driver | Modules composed | Generator script |
|---------|-------------|------------------|------------------|
| `minimal` | mock | none | `setup-app.ts` |
| `public` | rauthy OIDC | none | `setup-app.ts` |
| `internal` | rauthy OIDC | user-management | `setup-app.ts` |
| `dual` | rauthy OIDC | none | `setup-dual-app.ts` |

The `dual` profile produces two independent Encore applications (public + internal) via `setup-dual-app.ts`. It does not compose `--with` modules.

## Verify the governance kernel

To confirm the spec-spine governance surface is healthy:

```bash
make ci
```

This runs the full local gate set: governance (compile, lint, index check, coupling gate), typecheck, vitest test suite, and the cross-repo lockstep check.
