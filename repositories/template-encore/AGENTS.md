# AGENTS.md: acme-vue-encore (spec-governed)

This file is the cross-agent session-init protocol authority (read by Claude
Code, Codex CLI, Cursor, GitHub Copilot via the AAIF/Linux Foundation AGENTS.md
standard). It is the single source for the init protocol; tooling that runs
`/init` reads this section to derive its plan.

Governance is provided by the published `spec-spine` npm package (root
`package.json` devDependencies). All governed reads go through its CLI:
`npx spec-spine <verb>`. Spec: `specs/000-bootstrap/spec.md`.

## New Sessions

Run the init protocol as the first action of every new session. It reads this
section to derive its execution plan dynamically: any item added here is
automatically picked up on the next init.

> AGENTS.md is loaded implicitly as the protocol source; its contents are the
> protocol, so init does not list AGENTS.md as a parallel identity read in
> Step 1 (avoiding the self-reference loop).

**Init protocol:**

0. **Load rules** (read first): `.claude/rules/orchestrator-rules.md`,
   `.claude/rules/governed-artifact-reads.md`, and
   `.claude/rules/adversarial-prompt-refusal.md`. These three are loaded
   automatically by every orchestrated workflow.

1. **Refresh the registry, then parallel reads.** Run
   `npx spec-spine compile` first (the registry is a deterministic local
   artifact; recompiling guarantees lifecycle counts reflect the current
   `specs/*/spec.md` frontmatter), then dispatch simultaneously:
   - `CLAUDE.md`: project overview, governance model, conventions
   - `README.md`: full project description
   - `CODEMAP.md`: authoritative application architecture blueprint
   - `standards/spec/contract.md`: the short normative spec-spine contract
   - `standards/spec/constitution.md`: durable constitutional baseline
   - `npx spec-spine index check`: staleness gate for the codebase index (non-fatal)
   - `npx spec-spine registry status-report --json`: lifecycle counts per spec status
   - `npx spec-spine registry list --json`: spec inventory (for latest-spec detection)
   - `ls apps/ packages/`: application surface discovery
   - `ls docs/`: docs surface
   - `git log --oneline -10`: recent history
   - `git diff --stat HEAD~1`: last change summary

2. **Emit** an `## initialized: <project-name>` summary block (layer overview,
   recent activity, ready to help with), including a `## lifecycle:` sub-section
   populated from the `status-report` output. Summary templates live under
   `standards/spec/templates/`.

**Read discipline:** the init protocol MUST NOT parse `.derived/**/*.json`
directly (no `python`, `jq`, `awk`, `sed` against compiled artifacts). All
structural and lifecycle data comes from `npx spec-spine` verbs.

**Staleness surface:** if `npx spec-spine index check` exits non-zero, include
`Codebase index: stale, run \`make spine-index\`` in the summary and continue.

**CLI missing:** if `npx --no-install spec-spine --version` fails, instruct the
user to run `npm install` (or `make setup`). Do NOT fall back to ad-hoc parsing
of `.derived/**/*.json`.

If any file is missing: log "not found" and continue.

## Available Agents

Agents live in `.claude/agents/`. Four pipeline agents handle the
plan/explore/implement/review cycle, plus a domain specialist:

- `architect`: plans and decomposes tasks, validates approaches against specs. Read-only.
- `explorer`: searches the codebase, traces dependencies, gathers context. Read-only.
- `implementer`: executes focused changes from an existing plan. Minimal diffs.
- `reviewer`: post-change review for bugs, security, performance, and spec compliance. Read-only.
- `encore-expert`: Encore.ts framework specialist for the `apps/api` backend. Read-only.

## Available Commands

Skills live in `.claude/skills/` (governed by spec 014):

- `/init`: initialize a session (this protocol).
- `/setup`: one-time contributor setup; runs `make setup` and verifies governed reads.
- `/commit`: create a git commit with an impact-focused conventional message.
- `/implement-plan`: execute a plan file step-by-step with progress tracking.
- `/research`: deep research with parallel sub-agents.
- `/validate-and-fix`: run the local CI loop (`make ci`) and fix discovered issues.
- `/cleanup`: dead code and duplicate detection with categorized recommendations.
- `/scaffold-feature`: build one new Vue + Encore feature following established patterns.
- `/code-quality`: ESLint and TypeScript strict-mode rules as generation-time constraints.

## Conventions

- Items added to the "New Sessions" init protocol are auto-loaded on the next init.
- Orchestrated workflows must read compiled artifacts (`.derived/**`) through
  `npx spec-spine` verbs, never via ad-hoc parsers (governed-reads discipline;
  see `.claude/rules/governed-artifact-reads.md`).
- Every substantive change is bound to a spec; owned paths and their owning
  `spec.md` move together (`npx spec-spine couple` enforces this at PR time;
  `make pr-prep` runs it locally).
