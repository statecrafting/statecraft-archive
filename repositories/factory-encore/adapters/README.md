# Adapters

An adapter implements the factory for exactly one technology stack. It is the
only layer that names a framework, a language, or a file path. The process and
contract layers never change when an adapter is added or removed.

## What an adapter contains

Each adapter is a self-contained directory `adapters/<name>/`:

- `manifest.yaml`, conformant to `contract/schemas/adapter-manifest.schema.yaml`,
  declaring the stack, capabilities, supported auth methods, build and test
  commands, directory conventions, the agents it ships, the locations of its code
  patterns, a scaffold source, and a `governance:` sub-envelope.
- `agents/`, the focused code-generation agents the scaffolding orchestrator
  invokes (data, API, UI, configure, trim, and any optional reviewer or seed
  generator the manifest declares).
- `patterns/`, concrete code-generation patterns the agents follow.
- `validation/`, the stack-specific invariants checked during final validation.

The factory binds a run to an adapter at pre-flight and confirms, once the
deployment variant is known at Stage 2, that the adapter can satisfy the run's
variant and auth methods before any scaffolding begins.

## Shipped adapters

### `acme-vue-encore`

A neutral adapter for an Encore.ts backend with one or two Vue 3 SPAs on PrimeVue,
PostgreSQL (Encore `SQLDatabase`, tagged-template SQL, no ORM), and OpenID Connect
authentication via rauthy. It supports single and dual deployment topologies.

This adapter is also the **create-time home** of the `acme-vue-encore` product.
Beyond the four files above, it carries:

- `scripts/`, the deterministic generator (setup-app / setup-dual-app / add /
  remove / validate modules, the `scripts/lib/` composers, and the `lockstep/`
  cross-repo check), with its vitest suite.
- `modules/`, the module catalog (manifests + `files/` payloads).
- `orchestration/`, the create-time from-Build-Spec skills (`analyze`,
  `configure`, `trim`, the `FAC-S*` boundary half of `validate`) and
  `template-orchestrator.md`.

The generator materializes a project as **"lean baseline + compose"**: it clones
the `template-encore` lean baseline via `--source` (it does not own the baseline
app source) and composes the requested modules in. The carry-forward policy
(`scripts/lib/born-with.ts`) decides what a produced app is born with (the
governance kernel + the app) and what stays behind (the generator, the catalog,
the generator meta-specs). The specs that govern this generator live at the
repository root under `specs/` (007-010, 020), with the kernel (000) and the
lockstep (031).

To contribute another adapter, follow `docs/how-to.md` ("Adding an adapter") and
the Adapter Manifest schema.
