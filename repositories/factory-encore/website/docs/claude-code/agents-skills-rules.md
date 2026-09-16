# Agents, skills, and rules

factory-encore ships a complete Claude Code integration under `.claude/`. It provides agents for the plan/explore/implement/review cycle, skills for common workflows, and rules that constrain orchestrated behavior.

## Agents

Agents live in `.claude/agents/`. Four pipeline agents handle the development cycle:

| Agent | Model | Purpose | Mutation |
|-------|-------|---------|----------|
| `architect` | sonnet | Plans and decomposes tasks, validates approaches against the spec spine. | Read-only |
| `explorer` | sonnet | Searches the codebase, traces dependencies, gathers context. | Read-only |
| `implementer` | (default) | Executes focused code changes from an existing plan. Produces minimal diffs. | Read + Write |
| `reviewer` | sonnet | Post-change review for bugs, security, performance, and spec compliance. | Read-only |

Each agent declares its allowed tools in its frontmatter. Only the `implementer` has write access.

## Skills

Skills live in `.claude/skills/` (one `SKILL.md` per folder). They are invoked as slash commands:

| Command | Purpose |
|---------|---------|
| `/init` | Initialize a session (executes the cross-agent New Sessions protocol from `AGENTS.md`). |
| `/setup` | One-time contributor setup: installs spec-spine CLI and verifies governed reads work. |
| `/commit` | Create a git commit with an impact-focused conventional commit message. |
| `/scaffold-feature` | Build one new Vue + Encore feature following established patterns. |
| `/code-quality` | ESLint and TypeScript strict-mode rules translated into generation-time constraints. |
| `/implement-plan` | Execute a plan file step-by-step with progress tracking. |
| `/research` | Deep research with parallel sub-agents and query classification. |
| `/validate-and-fix` | Run the local CI loop and automatically fix discovered issues. |
| `/cleanup` | Dead-code and duplicate detection with categorized recommendations. |

## Rules

Rules live in `.claude/rules/` and are loaded automatically by every orchestrated workflow:

### orchestrator-rules.md

- Execute phased work in order; stop at human checkpoints.
- Write output files where the spec says; do not invent locations.
- Keep the working tree green; never leave the coupling gate red.
- Recompute derived artifacts (`compile`, `index`) before opening a PR.

### governed-artifact-reads.md

Orchestrated workflows read compiled artifacts (`.derived/**`) through the `spec-spine` CLI, never via ad-hoc parsers (`python`, `jq`, `awk`, `sed`). This rule binds to the factory kernel (spec 000, FR-001) and constitution Principle 5.

| Artifact | CLI verb |
|----------|----------|
| `.derived/spec-registry/by-spec/*.json` | `npx spec-spine registry list`, `show`, `status-report`, `relationships` |
| `.derived/codebase-index/` shard tree | `npx spec-spine index check` |

### adversarial-prompt-refusal.md

If the coupling gate fails because code and its owning spec disagree, do not resolve it by editing the spec to match the code. Surface the contradiction and let a human decide. Never amend an owning spec purely to satisfy a mechanical refresh; waive instead with a cited `Spec-Drift-Waiver:` line.

## The AGENTS.md protocol

`AGENTS.md` at the repository root is the cross-agent session-init protocol authority. It is read by Claude Code, Codex CLI, Cursor, and GitHub Copilot via the AAIF/Linux Foundation AGENTS.md standard.

The init protocol (`/init`) executes:

1. Load rules (orchestrator, governed-artifact-reads, adversarial-prompt-refusal).
2. Refresh the registry (`npx spec-spine compile`), then parallel reads of identity files, governance status, and recent history.
3. Emit an `## initialized: factory-encore` summary block with lifecycle counts.

If the spec-spine CLI is missing (`npx --no-install spec-spine --version` fails), the protocol instructs the user to run `npm install` rather than falling back to ad-hoc parsing.
