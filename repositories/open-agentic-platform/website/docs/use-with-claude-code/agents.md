# Agents

The OAP development workflow utilizes specialized agent personas defined in `.claude/agents/`. These agents divide the labor of software delivery into focused, manageable roles.

## The Pipeline Agents

Four primary agents handle the plan, explore, implement, and review cycle:

1. **`architect`**: Plans and decomposes tasks. It validates proposed approaches against the existing specifications in the Spec Spine. This agent is strictly read-only.
2. **`explorer`**: Searches the codebase, traces dependencies, and gathers necessary context for a task. This agent is strictly read-only.
3. **`implementer`**: Executes focused code changes based on an existing plan. It is instructed to produce minimal, targeted diffs.
4. **`reviewer`**: Performs post-change reviews, checking for bugs, security issues, performance regressions, and strict compliance with the governing specs. This agent is strictly read-only.

## Domain Specialists

In addition to the pipeline agents, OAP includes domain specialists for specific technologies:

- **`encore-expert`**: A specialist in the Encore.ts framework, used exclusively for developing the `statecraft` control plane service. This agent is strictly read-only.

By separating these concerns, OAP ensures that planning and review are isolated from execution, aligning with the "Least Agency" and "Planner output is untrusted" principles of the OWASP ASI 2026 framework.
