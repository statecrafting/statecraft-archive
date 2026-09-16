# Author an adapter

Adding a new technology stack to factory-encore means authoring a new adapter. An adapter is a self-contained directory under `adapters/` that implements one stack and conforms to the Adapter Manifest schema.

## Adapter structure

```
adapters/<name>/
  manifest.yaml          # Adapter Manifest (schema 1.1.0)
  README.md              # Human-readable overview
  agents/                # Focused code-generation agent prompts
  patterns/              # Concrete code-generation patterns
  modules/               # Optional: composable service modules
  scripts/               # Optional: generator scripts
  orchestration/         # Optional: from-Build-Spec orchestration
```

## Step 1: Write the manifest

The manifest (`manifest.yaml`) is the canonical declaration of your adapter. It must conform to `contract/schemas/adapter-manifest.schema.yaml` at version 1.1.0.

Key sections to fill:

| Section | What to declare |
|---------|-----------------|
| `identity` | Name, display name, version. |
| `stack` | Language, runtime, backend/frontend frameworks, database. |
| `capabilities` | What your stack supports (dual-stack, auth methods, modules, etc.). |
| `commands` | How to install, compile, test, lint, dev, typecheck, and verify features. |
| `directory_conventions` | Where services, controllers, views, stores, migrations, and tests live. |
| `patterns` | Locations of code-generation patterns for API, UI, data, and page types. |
| `agents` | The focused agents the scaffolding orchestrator will invoke. |
| `scaffold` | Source repository, entry point, profiles, setup commands. |
| `governance` | Max tier, file write scope, denied paths, scaffold execution constraints. |
| `validation_invariants` | Grep-absent and command-succeeds checks with severity levels. |

## Step 2: Write agent prompts

Each agent prompt under `agents/` is a focused, single-purpose instruction for one scaffolding step. Agents should:

- Read one slice of the Build Specification.
- Follow one pattern from `patterns/`.
- Produce one artifact (a service, a view, a migration).
- Stay within the declared context budget.

The scaffolding orchestrator invokes agents in order; each agent does not need to know about the others.

## Step 3: Write patterns

Patterns under `patterns/` are concrete code examples that agents follow. They demonstrate your stack's conventions:

- API patterns: how a service, endpoint, middleware, and test look.
- UI patterns: how a view, store, route, and component look.
- Data patterns: how a migration, model, and query look.
- Page-type patterns: how different page types (list, detail, form, dashboard) are structured.

Patterns are authored prose, not generated code. They are excluded from the coupling gate.

## Step 4: Validate the manifest

The pre-flight stage validates the adapter manifest at the start of every run:

- Schema conformance against `adapter-manifest.schema.yaml`.
- All referenced agents and patterns exist on disk.
- Declared capabilities are consistent.

You can validate manually by running the pre-flight checks against your adapter.

## Step 5: Optional — add a module system

If your stack supports compile-time composition, you can add a `modules/` directory with composable service modules. Each module declares its composition through a `manifest.json` validated against a schema you define.

The `acme-vue-encore` adapter's module system is the reference implementation. See the [Module catalog](/docs/reference/module-catalog) for details.

## Step 6: Optional — add a generator

If your stack has a lean baseline (a template repository), you can add generator scripts under `scripts/` that clone the baseline and compose modules. The generator is stack-specific code that lives entirely within your adapter directory.

## What stays the same

When you add an adapter, the process and contract layers never change:

- The pipeline stages are universal.
- The Build Specification schema is fixed.
- The verification contract is declarative.
- The governance envelope is process-level.

Your adapter consumes the frozen Build Specification at Stage 6 and produces a running application. Everything upstream is technology-agnostic.
