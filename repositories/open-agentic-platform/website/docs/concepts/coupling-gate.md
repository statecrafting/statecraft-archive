# Coupling Gate

The Spec/Code Coupling Gate (Spec 127) is the load-bearing invariant of the Open Agentic Platform. It enforces the rule that **drift between a spec and the code it claims fails CI before merge.**

In an AI-native development environment, agents can generate and modify code at incredible speed. Without the coupling gate, the codebase would quickly diverge from its specifications, leading to an unmaintainable and ungovernable system.

## How the Gate Works

When a pull request is opened, the CI pipeline runs the `make ci-spec-code-coupling` target. This target invokes the `spec-spine couple` command, which performs the following checks:

1. **Diff Analysis**: It analyzes the Git diff to identify all modified code paths.
2. **Authority Lookup**: It queries the Spec Relationship Graph to determine which specs have authority over those modified paths.
3. **Spec Modification Check**: It verifies that the authoritative `spec.md` files have also been modified in the same pull request.

If a code path is modified but its governing spec is not, the gate fails the build. The developer (or agent) must either update the spec to reflect the code change or revert the code change to match the spec.

## Co-Authority and Section Matching

Some files, like the repo-root `Makefile` or complex CI workflows, are governed by multiple specs. To handle this, OAP uses `co_authority:` edges and section matching (Spec 152).

The coupling gate matches diff hunks to specific sections within a file based on file-type rules:
- `Makefile` target groups
- GitHub workflow `jobs.<name>`
- Source-file `// region: <name>` markers
- Markdown heading slugs

If a change falls within a specific section, only the spec that claims `co_authority:` over that section needs to be updated.

## The Waiver Mechanism

In rare cases (such as purely mechanical refactoring, dependency bumps, or fixing typos), a code change may not require a change to the underlying specification. 

For these situations, the coupling gate supports a waiver mechanism. A developer can bypass the gate by including a specific waiver token in the commit message or PR description, provided they supply a written justification. Waivers are heavily scrutinized during code review and leave a permanent audit trail.
