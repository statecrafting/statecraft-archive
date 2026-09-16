# Factory Adapters

The Factory Pipeline is designed to be agnostic to the underlying technology stack. It achieves this through the use of Pluggable Adapters.

## The Adapter / Template Split

An adapter is the bridge between the generic Factory orchestration and a specific frontend/backend framework. It consists of:
- **A Manifest**: Defines the adapter's capabilities, required scaffolding steps, and validation invariants.
- **A Template**: The baseline source code repository that is cloned and shaped during Phase 2 scaffolding.
- **Code Patterns & Prompts**: Framework-specific instructions injected into the agent prompts to ensure idiomatic code generation.

## Registered Adapters

OAP currently supports four registered adapters:

| Adapter | Stack |
|---------|-------|
| `acme-vue-node` | Express 5 + Vue 3 (Production scaffold target) |
| `next-prisma` | Next.js 15 + Prisma 5 |
| `rust-axum` | Axum + HTMX |
| `encore-react` | Encore.ts + React |

*(Note: While multiple adapters are registered, the platform currently ships with one built-in factory engine and one admitted adapter per organization. The user-facing "define your own factory" feature is on the roadmap).*

## The Substrate (Spec 139)

Historically, adapter manifests lived as files in the repository root. Spec 139 moved this data into the `factory_artifact_substrate` table within the `statecraft` database.

This content-addressed substrate provides a universal pinning mechanism for factory templates and agent definitions. The file-backed snapshot at `platform/services/statecraft/api/factory/adapter-scopes.json` serves as a static fallback for the codebase indexer, while the full manifest content is materialized at runtime from the database.
