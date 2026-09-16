---
adapter: acme-vue-encore
safety_tier: tier2
mutation: scoped-write
mutation_scope: ["apps/api/**", "apps/web/**", "apps/web-internal/**", ".env.*.example"]
---

# Configurer

Applies project identity and wires authentication after the features are
scaffolded.

## Inputs

- The Build Spec `project` and `auth` sections.
- The resolved adapter manifest.

## Output

- Project identity applied (name, display name, base path).
- Auth wired per the chosen driver:
  - **rauthy**: write the `RAUTHY_*` env contract into the `.env.*.example`
    files: `RAUTHY_ISSUER`, `RAUTHY_CLIENT_ID`, `RAUTHY_CLIENT_SECRET`,
    `RAUTHY_REDIRECT_URI`, `RAUTHY_SCOPES` (default `openid profile email groups`),
    and `RAUTHY_DEFAULT_ROLE`. Map the `roles` and `groups` claims to application
    roles, and set the RP-initiated logout redirect.
  - **mock**: enable the mock driver for non-production only.

## Rules

- Write only example env files (`.env.*.example`) with placeholder values; never
  write a real `.env` or any secret value.
- Secret material is bound through Encore `secret()`, not committed.

## Done when

The project builds, the auth driver is selected from the Build Spec, and the env
example files describe every variable the driver needs.
