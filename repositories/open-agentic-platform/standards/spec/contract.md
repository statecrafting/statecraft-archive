# `standards/spec/` contract (open-agentic-platform)

This file is a **short normative summary** of Feature `000-bootstrap-spec-system`.

**Precedence:** `specs/000-bootstrap-spec-system/spec.md` > `standards/spec/constitution.md` > **this file**. The constitution filename does **not** override Feature 000.

## Authoring

- Human durable truth: **markdown files** (`.md`) only.
- Structured metadata for a document: **YAML inside markdown frontmatter** (`---` blocks) when required by the document grammar. Frontmatter is **not** an independent authoring format and must not become an escape hatch for bulk YAML semantics—see the feature spec.
- **No** standalone `.yaml` / `.yml` files as authoritative inputs (see feature spec invariant **V-004**).

## Machine layer

- Machine durable truth: **JSON only**, emitted by **`spec-spine compile`** into `.derived/spec-registry/`.
- **Sharded output** under `.derived/spec-registry/by-spec/`: deterministic, canonical for consumers; read through `spec-spine registry` subcommands, not ad-hoc parsers.
- **`build-meta.json`**: ephemeral compiler-owned JSON (wall-clock `builtAt`); **not** part of golden-file determinism checks.
- Humans do not hand-edit compiler JSON.

## Spec Kit layout

- **Canonical feature specs** live at **`specs/NNN-kebab-case/`** (repository root), with `spec.md`, `plan.md`, `tasks.md`, and optional `contracts/`, `research.md`, `quickstart.md`. **Not** under `standards/spec/specifications/`.
- `standards/spec/` holds **templates, scripts, and constitution**—workflow support, not the authoritative spec library.
- Workflow scripts live under `.specify/scripts/bash/` (legacy Spec Kit location; evaluated for retirement in Epic 2 I13); templates under `standards/spec/templates/`.

## Amendment convention

- A spec may **amend** earlier specs in place (refining narrative or invariants without superseding them) by carrying `amends: [<id>, ...]`. Amended specs carry `amended: <date>` and `amendment_record: <amender-id>` plus an in-body callout. This is distinct from supersession (`status: superseded` + `superseded_by:`), which marks a direction change. Formal definition lives in spec 000 under "Amendment frontmatter convention".

## Next step

Read the full contract: `specs/000-bootstrap-spec-system/spec.md`.

For registry consumer process governance after contract stabilization, see `docs/registry-consumer-contract-governance.md`.

Distilled extension rule (`spec-spine registry`): accept an extension only when it adds one clear guarantee with minimal surface area, explicit mode/flag interaction rules, fixture-first contract coverage (including help surface), and no drift to settled guarantees; otherwise classify it as a breaking change candidate and enter explicit versioning discussion.
