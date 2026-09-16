# Project Structure

The **acme-vue-encore** repository is organized as a monorepo containing the Encore.ts backend, two Vue 3 single-page applications, shared packages, and governance documentation.

## Workspace Layout

```text
acme-vue-encore/
├── apps/
│   ├── api/            # Standalone Encore.ts backend
│   ├── web/            # Vue 3 + PrimeVue SPA: public/external users
│   └── web-internal/   # Vue 3 + PrimeVue SPA: internal/staff users
├── packages/
│   └── shared/         # Types, Zod schemas, constants shared between the SPAs
├── docker/             # Self-host docker-compose and container guides
├── docs/               # Technical documentation
├── specs/              # Spec spine: authoritative design records
└── website/            # Docusaurus documentation website (this site)
```

## The Standalone Backend

The `apps/api` directory contains the Encore.ts backend application.

Crucially, **`apps/api` is excluded from the root npm workspaces**. It maintains its own `package.json`, `package-lock.json`, and `node_modules` directory. This separation is deliberate because Encore owns its own installation, build, and deployment lifecycle. The backend does not import from the `@template/*` workspace packages; it remains entirely self-contained.

Because of this separation, two distinct `npm install` steps are required to set up the project: one at the repository root for the SPAs and shared packages, and one inside `apps/api` for the backend.

## The npm Workspaces

The frontend applications and shared packages are managed as npm workspaces defined in the root `package.json`. The workspace scope is `@template/*`.

- `@template/web` (`apps/web`): The public-facing application.
- `@template/web-internal` (`apps/web-internal`): The staff-facing administrative application.
- `@template/shared` (`packages/shared`): Shared TypeScript definitions and utilities.

> **Note**: The `@template/*` scope is an internal workspace namespace and is completely unrelated to any "template" functionality or product name.

## Governance and Specs

The `specs/` directory contains the markdown specifications that govern the repository. The `spec-spine.toml` configuration file defines the layout and rules for the `spec-spine` CLI, which compiles the specifications into a deterministic registry and enforces coupling between the specs and the codebase.
