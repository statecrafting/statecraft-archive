# Spec-Spine Overview

**acme-vue-encore** is governed by a "born-with" specification spine. This means that the repository's architecture, security invariants, and major features are not just documented—they are formally specified and mechanically coupled to the codebase.

## The Concept

The core principle is that **authored truth lives only in markdown**. The `specs/` directory contains a corpus of markdown files, each representing a formal specification.

These specs are not passive documentation; they are active governance artifacts.

## The Mechanism

The governance is enforced by the `spec-spine` CLI tool, which is executed via a GitHub Actions workflow (`.github/workflows/spec-spine.yml`) on every pull request.

The workflow performs three critical checks:

1. **Compilation**: It compiles the markdown corpus into a deterministic JSON registry (`specs/spec-spine-index.json`).
2. **Linting**: It validates the frontmatter and structure of every spec against strict schemas.
3. **Coupling Gate**: This is the most important check. It diffs the PR against the base branch. If a PR modifies code that is "owned" by a specification (as declared in the spec's frontmatter), the PR **must** also include an edit to that owning specification.

If the coupling gate fails, the PR is blocked. This ensures that the documentation and the code evolve together, preventing architectural drift.

## The `spec-spine.toml` Configuration

The rules for the spec spine are defined in `spec-spine.toml` at the repository root. This file configures:
- The location of the specs (`specs/`).
- The location of the compiled index (`specs/spec-spine-index.json`).
- The glob patterns defining which files are governed by the coupling gate.

By default, the coupling gate is configured to ignore mechanical dependency bumps (e.g., Dependabot PRs) to reduce friction, while strictly enforcing coupling for application code changes.
