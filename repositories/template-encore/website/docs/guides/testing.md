# Testing

**acme-vue-encore** uses Vitest for unit testing across both the frontend and backend.

## Backend Testing (Encore API)

The Encore backend uses Vitest configured to run tests ending in `.test.ts`.

Because Encore tests require the native `encore-runtime.node` binding to execute API logic, the project includes a custom `vitest.config.ts` in `apps/api` that automatically discovers the path to this binding from the installed Encore CLI.

To run the backend unit tests:

```bash
cd apps/api
npm test
```

This runs the tests quickly using standard Vitest, without the overhead of `encore test` (which provisions isolated infrastructure for every run).

## Frontend Testing

The Vue SPAs also use Vitest for component and logic testing.

To run the frontend unit tests:

```bash
cd apps/web
npm test:unit
```

## Continuous Integration

The GitHub Actions CI pipeline (`.github/workflows/encore-ci.yml`) runs the test suites automatically on every pull request that touches application code. The pipeline enforces that all tests pass before a PR can be merged.
