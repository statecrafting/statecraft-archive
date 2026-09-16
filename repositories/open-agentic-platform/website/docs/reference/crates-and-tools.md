# Crates and Tools

The Open Agentic Platform is composed of numerous Rust crates and specialized tooling. This reference provides an overview of the key components.

## Core Library Crates (`crates/`)

The library crates power the platform's orchestration, policy enforcement, and desktop backend.

- **`agent`**: Core agent interaction traits and LLM provider abstractions.
- **`axiomregent`**: The governed MCP server sidecar, unifying Git context, semantic search, and policy enforcement.
- **`factory-contracts`**: Shared types and schemas used across the factory ecosystem.
- **`factory-engine`**: Implements the two-phase Factory pipeline logic and handles Governance Certificate emission.
- **`orchestrator`**: Executes multi-step DAG workflows with verify-and-retry logic and state persistence.
- **`policy-kernel`**: The enforcement engine that evaluates safety tiers and policy rules.
- **`tool-registry`**: Manages the registration, schema validation, and tier classification of tools.

## Tooling (`tools/`)

The `tools/` directory contains OAP-specific overlay tools and the platform's linting infrastructure.

### OAP Overlay Tools (`tools/oap/`)
These tools augment the generic `spec-spine` output with platform-specific logic:
- **`oap-registry-enrich`**: Generates compliance reports (e.g., OWASP ASI 2026) and authority views.
- **`oap-code-index-enrich`**: Adds platform-specific metadata to the codebase index.
- **`policy-compiler`**: Compiles policy rules into executable bundles.
- **`factory-schema-lockstep`**: Ensures schema parity between Rust and TypeScript definitions.

### Spec-Spine Tools (`tools/spec-spine/`)
- **`spec-lint`**: Enforces OAP-specific authoring rules on the Markdown specs, such as checking for valid frontmatter and relationship graph well-formedness.

*(Note: The generic `spec-spine` engine itself is an external dependency installed via `cargo install spec-spine-cli`).*

## Full Codebase Index

For a complete, generated mapping of every crate and tool to its governing specification, refer to the [Codebase Index](../spec-spine-workflow/codebase-index) rendered by `spec-spine index render`.
