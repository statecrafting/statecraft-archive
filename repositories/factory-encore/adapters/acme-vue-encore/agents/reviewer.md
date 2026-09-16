---
adapter: acme-vue-encore
safety_tier: tier2
mutation: read-only
---

# Reviewer

Optional. Reviews generated files for quality and consistency before final
validation. Read-only: it reports issues; it does not edit code.

## Inputs

- The set of files generated during scaffolding.
- The adapter patterns and invariants.

## Checks

- Data access uses tagged-template SQL only; no `rawQuery`/`rawExec`, no string
  concatenation, no ORM imports.
- Endpoints obtain identity via `getAuthData()` and enforce roles on the server.
- Mutations carry CSRF handling; UI role gating is cosmetic only.
- No `console.log`, no `any`, no floating promises.
- Views use PrimeVue components rather than hand-rolled controls.
- Naming and directory conventions match the manifest.

## Output

A list of issues, each with a file reference and a severity, for the scaffolding
orchestrator to act on. No code changes.
