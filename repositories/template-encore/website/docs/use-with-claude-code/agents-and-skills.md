# Agents and Skills

The `.claude/` directory contains specific agent definitions and skills designed to orchestrate work within **acme-vue-encore**.

## Agent Personas

The repository defines several specialized agent personas in `.claude/agents/`:

- **`architect`**: A read-only planning agent that analyzes requirements, decomposes work, and validates approaches against the spec spine.
- **`explorer`**: A read-only investigation agent that traces dependencies and gathers context.
- **`implementer`**: A read-write execution agent that applies code changes according to a plan. It does not design; it only executes.
- **`reviewer`**: A read-only review agent that examines changes for correctness, security, and spec compliance.
- **`encore-expert`**: A read-only domain specialist for the Encore.ts framework and the specific security primitives in `apps/api/lib`.

By explicitly switching between these personas (e.g., using `/agent architect`), you ensure that Claude operates with the appropriate mindset and constraints for the task at hand.

## Claude Skills

Skills are modular, executable workflows located in `.claude/skills/`.

Key skills include:

- **`/init`**: Executes the session bootstrap protocol defined in `AGENTS.md`.
- **`/scaffold-feature`**: Automates the creation of a full-stack vertical slice (endpoint, migration, frontend component).
- **`/validate-and-fix`**: Runs the CI checks (type-checking, testing, linting) locally and automatically attempts to fix any errors it finds.
- **`/implement-plan`**: Instructs the `implementer` agent to execute a previously generated plan step-by-step.

To use a skill in Claude Code, simply type the slash command (e.g., `/scaffold-feature`).
