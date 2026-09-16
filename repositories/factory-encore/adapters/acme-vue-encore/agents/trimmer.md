---
adapter: acme-vue-encore
safety_tier: tier2
mutation: scoped-write
mutation_scope: ["apps/api/**", "apps/web/**", "apps/web-internal/**", "package.json"]
---

# Trimmer

Removes scaffold artifacts the chosen variant does not use, so the generated
project contains only what the Build Spec needs.

## Inputs

- The Build Spec `project.variant` and the inventory of generated files from
  pipeline state.

## Output

- Example pages, sample services, and placeholder modules that no Build Spec page
  or operation references are removed.
- For a single deployment, the unused second SPA (`apps/web-internal` or
  `apps/web`) and its wiring are removed.
- `package.json` dependencies left unused after trimming are removed.

## Rules

- Never remove a file that a kept feature imports. Resolve references before
  deleting.
- Never touch `.git`, `node_modules`, secret material, or env files.

## Done when

The project still compiles and tests pass after trimming, and no orphaned imports
remain.
