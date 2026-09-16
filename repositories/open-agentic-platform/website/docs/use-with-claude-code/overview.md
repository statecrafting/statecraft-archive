# Use with Claude Code

The Open Agentic Platform treats the AI agent development environment as first-class infrastructure. The repository ships with native [Claude Code](https://docs.anthropic.com/en/docs/claude-code) integration located in the `.claude/` directory.

## First-Class Infrastructure

The `.claude/` directory is not just a collection of helpful prompts; it defines the orchestrated workflows, safety rules, and agent behaviors that build the platform itself.

- **`.claude/agents/`**: Defines the specific personas used in the development pipeline.
- **`.claude/skills/`**: Contains the commands (skills) available to the agents.
- **`.claude/rules/`**: Defines the behavioral constraints enforced by the orchestrator.

## The `AGENTS.md` Protocol

The initialization of any agent session is governed by the `AGENTS.md` file at the repository root. This file acts as the cross-agent session-init protocol authority (compatible with the AAIF/Linux Foundation AGENTS.md standard).

When you start a session using the `/init` skill, it reads `AGENTS.md` to load the context, recent activity, and governed reads of the registry and codebase index.

### Strict Read Discipline

A critical rule enforced during initialization (Spec 103) is that the init protocol **MUST NOT** parse compiled JSON artifacts directly. All structural and lifecycle data must be retrieved through the `spec-spine` consumer binaries. If the index is stale, the `/init` protocol will instruct the developer to run the appropriate `make` targets rather than attempting to bypass the compiler.
