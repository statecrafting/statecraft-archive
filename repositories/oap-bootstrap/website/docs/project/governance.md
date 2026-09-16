# Governance

The `oap-bootstrap` repository operates under a strict governance model enforced by `spec-spine`. This system ensures that the project's documentation, specifications, and codebase remain synchronized and that architectural decisions are explicitly documented.

## The spec-spine Discipline

The repository follows the "markdown-truth" and "compiler-owned-JSON" discipline defined in the foundational `000-bootstrap` specification. 

All authoritative truth is authored by humans in Markdown files containing YAML frontmatter. These files reside in the `specs/` directory. The `spec-spine` compiler processes these Markdown files to generate machine-consumable JSON artifacts, which are placed in the `.derived/` directory. 

You must never hand-edit the files in the `.derived/` directory. They are entirely owned by the compiler and are ignored by version control.

## Authoritative Specifications

The design and behavior of the CLI are governed by specific documents:

- **Spec 000 (Bootstrap)**: Defines the fundamental rules of the spec system itself, establishing the markdown-truth boundary and the typed authority graph.
- **Spec 001 (oap-instance-bootstrap-cli)**: The authoritative design document for the CLI. It details the configuration model, the phase dependency graph, the command surface, and the explicit out-of-scope non-goals.

## Preventing Upstream Drift

A primary risk for `oap-bootstrap` is drifting from the upstream `open-agentic-platform` repository's contract (e.g., changes to environment variable names, secret shapes, or webhook events). 

To mitigate this, the project employs strict rules, located in the `.claude/rules/` directory:

- **Governed Artifact Reads**: Derived JSON artifacts must only be read using typed `spec-spine` subcommands (like `registry` or `index`), never via ad-hoc tools like `jq` or `grep`. This ensures that schema drift results in clean, explicit deserialization errors rather than silent failures.
- **Adversarial Prompt Refusal**: If code and its owning specification disagree, the contradiction must be surfaced for human review. The specification must never be amended purely to satisfy a mechanical check. If a deviation is necessary, it must be explicitly acknowledged using a `Spec-Drift-Waiver:` line in the pull request.

Note that `oap-bootstrap` does not ship any specific AI agents, skills, or commands. The repository only contains the governance rule files. Therefore, there are no separate instructions for using this repository with Claude Code or similar tools beyond adhering to the established rules.
