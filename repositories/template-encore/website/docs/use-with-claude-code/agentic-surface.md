# Agentic Surface

**acme-vue-encore** is designed not just for human developers, but also to be highly operable by autonomous coding agents, specifically Claude Code.

The repository includes a dedicated "agentic surface" located in the `.claude/` directory and governed by the `AGENTS.md` protocol.

## The Purpose of the Agentic Surface

The agentic surface provides Claude with the context, tools, and protocols necessary to operate effectively within the repository without requiring constant human guidance. It shifts the interaction model from "write this code" to "execute this protocol."

## Components

The surface consists of:

1. **`AGENTS.md`**: The authoritative protocol document. It defines how agents should initialize sessions, hand off tasks, and validate changes.
2. **`.claude/agents/`**: A directory of specialized agent personas (e.g., `architect`, `implementer`).
3. **`.claude/skills/`**: A directory of modular skills that extend Claude's capabilities (e.g., `scaffold-feature`, `validate-and-fix`).

## The `AGENTS.md` Protocol

`AGENTS.md` is the entry point for any agentic interaction. When you start a new Claude Code session, you should immediately run the `/init` skill. This skill instructs Claude to read `AGENTS.md` and execute the "New Sessions" protocol.

The protocol ensures that Claude:
- Understands the repository structure.
- Adheres to the security invariants.
- Respects the spec-spine governance.
