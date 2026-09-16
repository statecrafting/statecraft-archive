# Spec Spine

The Spec Spine is the authoritative foundation of the Open Agentic Platform. It is the repository of all functional and architectural truth, ensuring that human intent is durably recorded and machine-verifiable.

## What is a Spec?

A spec is a Markdown document (`spec.md`) that defines a feature, process, or architectural decision. It lives in a dedicated directory under `specs/` (e.g., `specs/127-spec-code-coupling-gate/spec.md`).

Every spec contains a YAML frontmatter block that defines its metadata, status, and, most importantly, its relationships to other specs and to the codebase.

Specs follow a strict lifecycle:
- **Draft**: Work in progress.
- **Approved**: Ratified and delivered.
- **Superseded**: Replaced by a newer spec.
- **Retired**: No longer active.

## Markdown Truth vs. JSON Machine Truth

OAP enforces a strict separation between human authoring and machine consumption, defined by Principles I and II of the Constitution:

1. **Human-authored durable truth is Markdown only.** YAML is allowed only as frontmatter inside `.md` files. Standalone authored YAML is forbidden (invariant V-004).
2. **Machine truth is JSON produced only by the compiler.**

When a human or agent authors a spec, they write Markdown. To make this truth actionable by the system, the `spec-spine` compiler processes the Markdown corpus and emits a deterministically sharded JSON registry under `.derived/spec-registry/by-spec/`.

## The Compiled Registry

The output of the compiler is the only source of truth for downstream tools. Hand-editing the JSON files in `.derived/` is a workflow violation.

The compiled registry is consumed by various tools to enforce governance:
- The **Coupling Gate** uses it to ensure code changes match spec changes.
- The **Codebase Indexer** uses it to generate the traceability matrix.
- The **Compliance Reporter** uses it to map specs to external frameworks like OWASP ASI 2026.

By forcing all tools to read from the compiled registry rather than parsing Markdown directly, OAP ensures that the entire platform operates on a single, unambiguous interpretation of the rules.
