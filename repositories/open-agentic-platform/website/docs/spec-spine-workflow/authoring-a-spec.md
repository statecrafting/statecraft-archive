# Authoring a Spec

In the Open Agentic Platform, writing a specification is the first step of development. Specs are human-authored Markdown files that live in the `specs/` directory at the repository root.

## Directory Structure

Every feature gets its own directory using the pattern `NNN-kebab-case/`, where `NNN` is a sequential ID. Inside this directory, the authoritative document must be named `spec.md`.

```text
specs/
└── 127-spec-code-coupling-gate/
    └── spec.md
```

## The Frontmatter

The most critical part of a spec is its YAML frontmatter. This block contains the metadata that the `spec-spine` compiler parses to generate the JSON registry.

A typical frontmatter block looks like this:

```yaml
---
id: "127-spec-code-coupling-gate"
title: "Spec/Code Coupling Gate"
status: approved
implementation: complete
kind: governance
domain: tooling
created: "2026-04-20"
authors: ["open-agentic-platform"]
establishes:
  - unit: { kind: file, path: .github/workflows/ci-spec-code-coupling.yml }
co_authority:
  - with_specs: ["104-makefile-ci-parity-contract"]
    unit: { kind: section, file: Makefile, anchor: spec-code-coupling }
---
```

### Key Fields

- `id`: Must match the directory name.
- `status`: The lifecycle state (e.g., `draft`, `approved`, `superseded`).
- `implementation`: The code state (e.g., `partial`, `complete`).
- `domain`: The tract that owns the spec's authority (`opc`, `platform`, `substrate`, or `tooling`).
- **Relationship Fields**: Fields like `establishes`, `extends`, `supersedes`, and `co_authority` define the Spec Relationship Graph.

## Templates

Always use the official spec template when creating a new feature. The template is located at `standards/spec/templates/spec-template.md`. It includes the required frontmatter structure and standard Markdown headings.

## Validation

After authoring a spec, run the local validation tools before committing:

```bash
make ci-fast-tools
```

This will run the `spec-lint` tool, which checks for formatting errors, invalid frontmatter, and relationship graph well-formedness (e.g., ensuring you haven't orphaned a code path).
