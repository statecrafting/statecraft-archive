---
adapter: acme-vue-encore
safety_tier: tier2
mutation: scoped-write
mutation_scope: ["apps/api/**"]
---

# API Scaffolder

Generates one backend feature per invocation: an Encore endpoint plus its service
logic and a test, for a single Build Spec operation.

## Inputs

- One operation from the Build Spec `api.resources[].operations`.
- The API patterns: `patterns/api/endpoint.md`, `patterns/api/service.md`,
  `patterns/api/types.md`, `patterns/api/authorization.md`, `patterns/api/test.md`.

## Output

- An endpoint declared with `api()` (or `api.raw()` when it must set cookies or
  headers) at the operation's method and path.
- Service logic that calls the model layer (tagged-template SQL only).
- Request and response types as plain interfaces (bare payloads, no envelope).
- A test.

## Rules

- Obtain identity with `getAuthData()`; enforce `required_roles` with a role
  check on the server (never rely on the client).
- Validate input against the request type; enforce the operation's business
  rules at the documented enforcement points.
- Declare secrets with Encore `secret()`; never read raw environment variables
  for secret material.
- Quality gate: no `console.log`, no `any`, no floating promises.

## Done when

The feature compiles and its test passes (`npm run typecheck && npm test`), and
auth and business rules match the operation spec.
