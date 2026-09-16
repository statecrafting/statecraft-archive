# CLI and Scripts

The repository uses npm scripts to orchestrate builds, testing, and development across the monorepo workspaces.

## Root Scripts

These scripts are run from the repository root.

- **`npm run dev`**: Starts the Encore API and both Vue Vite development servers concurrently.
- **`npm run build:packages`**: Builds the `@template/shared` workspace package.
- **`npm run build:web`**: Builds the public Vue SPA into `apps/api/web/build`.
- **`npm run build:web-internal`**: Builds the internal Vue SPA.
- **`npm run typecheck:web`**: Runs TypeScript type-checking for the public SPA.
- **`npm run typecheck:web-internal`**: Runs TypeScript type-checking for the internal SPA.

## Backend Scripts (`apps/api`)

These scripts must be run from within the `apps/api` directory.

- **`npm run generate-keys`**: Generates local RS256 JWT signing keys into the `keys/` directory.
- **`npm run gen:client`**: Generates the strongly-typed Encore client and writes it to `apps/web/src/lib/encore-client.ts`. Must be run whenever the backend API surface changes.
- **`npm run db:migrate`**: Runs the standalone database migration tool (useful for self-hosted deployments).
- **`npm test`**: Runs the backend Vitest suite.

## Spec-Spine Scripts

These scripts manage the governance specifications.

- **`npx spec-spine compile`**: Compiles the markdown specifications into `spec-spine-index.json`.
- **`npx spec-spine lint`**: Lints the specification corpus for conformance.
- **`npx spec-spine index check`**: Verifies that the compiled index is up-to-date with the markdown files.
