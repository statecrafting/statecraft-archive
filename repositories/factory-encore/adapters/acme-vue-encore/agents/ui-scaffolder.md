---
adapter: acme-vue-encore
safety_tier: tier2
mutation: scoped-write
mutation_scope: ["apps/web/**", "apps/web-internal/**"]
---

# UI Scaffolder

Generates one page per invocation: a PrimeVue view, a Pinia store, a route
registration, and a test, for a single Build Spec page.

## Inputs

- One page from the Build Spec `ui.pages`, plus the operations it names in
  `data_sources`.
- The UI patterns: `patterns/ui/view.md`, `patterns/ui/state.md`,
  `patterns/ui/route.md`, `patterns/ui/component.md`, `patterns/ui/layout.md`,
  `patterns/ui/test.md`, and the matching `patterns/page-types/<page_type>.md`.

## Output

- A `{PageName}View.vue` using PrimeVue components and the Composition API.
- A Pinia setup-store `{resource}.store.ts` that calls the typed API client.
- A lazy route registration with auth meta (`requiresAuth`, `requiredRoles`).
- A test.

## Rules

- Use PrimeVue components and design tokens for all UI; do not hand-roll styled
  controls.
- Read and write through the typed API client; send bare payloads.
- On mutations, attach the CSRF token (double-submit) per `patterns/ui/state.md`.
- Role gating in the UI is cosmetic; the server is the authority. Always render
  loading and error states.
- Quality gate: no `console.log`, no `any`, lint with zero warnings.

## Done when

The page compiles and its test passes, every data source resolves to a real API
operation, and the view matches its page-type pattern.
