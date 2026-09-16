# AGENTS.md: factory-encore (spec-governed)

This file is the cross-agent session-init protocol authority (read by Claude
Code, Codex CLI, Cursor, and GitHub Copilot via the AAIF/Linux Foundation
AGENTS.md standard). It is the single source for the init protocol; tooling that
runs `/init` reads the `## New Sessions` section to derive its plan.
`.claude/skills/init/SKILL.md` is a thin Claude-Code dispatcher onto this file;
the protocol body lives here only.

Governance is the spec-spine kernel (spec `000-factory-kernel`), provided by the
published `spec-spine` npm package (root `package.json` devDependencies). All
governed reads go through its CLI: `npx spec-spine <verb>`.

## New Sessions

Run `/init` as the first action of every new session. It reads this section to
derive its execution plan dynamically: any item added here is automatically
picked up on the next init.

> AGENTS.md is loaded implicitly as the protocol source; its contents are the
> protocol, so init does not list AGENTS.md as a parallel identity read in
> Step 1 (avoiding the self-reference loop).

**Init protocol:**

0. **Load rules** (read first): `.claude/rules/orchestrator-rules.md`,
   `.claude/rules/governed-artifact-reads.md`, and
   `.claude/rules/adversarial-prompt-refusal.md`. These three are loaded
   automatically by every orchestrated workflow.

1. **Refresh the registry, then parallel reads.** Run `npx spec-spine compile`
   first (the registry shards under `.derived/spec-registry/by-spec/` are a
   per-clone local cache with no committed staleness reference; recompiling is
   deterministic and guarantees lifecycle counts reflect the current
   `specs/*/spec.md` frontmatter), then dispatch simultaneously:
   - `CLAUDE.md`: project overview, governance model, conventions
   - `README.md`: the three-layer architecture and directory map
   - `standards/spec/contract.md`: the short normative spec-spine contract
   - `standards/spec/constitution.md`: durable constitutional baseline
   - `npx spec-spine index check`: staleness gate for the codebase index (non-fatal)
   - `npx spec-spine registry status-report --json`: lifecycle counts per spec status
   - `npx spec-spine registry list --json`: spec inventory (for latest-spec detection)
   - `ls process/ contract/ adapters/`: the three governed layers (process, contract, adapters)
   - `ls docs/`: human-facing docs surface
   - `git log --oneline -10`: recent history
   - `git diff --stat HEAD~1`: last change summary

2. **Emit** an `## initialized: factory-encore` summary block (layer overview,
   recent activity, ready to help with), including a `## lifecycle:` sub-section
   populated from the `status-report` output. Summary templates live under
   `standards/spec/templates/`.

**Read discipline:** the init protocol MUST NOT parse `.derived/**/*.json`
directly (no `python`, `jq`, `awk`, `sed` against compiled artifacts). All
structural and lifecycle data comes from `npx spec-spine` verbs (see
`.claude/rules/governed-artifact-reads.md`).

**Staleness surface:** if `npx spec-spine index check` exits non-zero, include
`Codebase index: stale, run \`npm run spec:index\`` in the summary and continue.

**CLI missing:** if `npx --no-install spec-spine --version` fails, instruct the
user to run `npm install` (the `spec-spine` CLI is a devDependency). Do NOT fall
back to ad-hoc parsing of `.derived/**/*.json`.

If any file is missing: log "not found" and continue.

## Available Agents

Agents live in `.claude/agents/`. Four pipeline agents handle the
plan/explore/implement/review cycle:

- `architect`: plans and decomposes tasks, validates approaches against the spec spine. Read-only.
- `explorer`: searches the codebase, traces dependencies, gathers context. Read-only.
- `implementer`: executes focused code changes from an existing plan. Produces minimal diffs.
- `reviewer`: post-change review for bugs, security, performance, and spec compliance. Read-only.

## Available Commands

Skills live in `.claude/skills/` (one `SKILL.md` per folder):

- `/init`: initialize a session (this protocol).
- `/setup`: one-time contributor setup; installs the `spec-spine` CLI and verifies governed reads work, so `/init` can report lifecycle and structural counts.
- `/commit`: create a git commit with an impact-focused conventional message.
- `/scaffold-feature`: build one new Vue + Encore feature following the template's established Encore.ts, Pinia, and PrimeVue patterns.
- `/code-quality`: ESLint and TypeScript strict-mode rules translated into generation-time constraints.
- `/implement-plan`: execute a plan file step-by-step with progress tracking.
- `/research`: deep research with parallel sub-agents and query classification.
- `/validate-and-fix`: run the local CI loop and automatically fix discovered issues.
- `/cleanup`: dead-code and duplicate detection with categorized recommendations.

## Conventions

- Items added to the "New Sessions" init protocol are auto-loaded on the next init.
- Agents must be self-contained within `.claude/agents/`: no cross-project dependencies.
- Orchestrated workflows read compiled artifacts (`.derived/**`) through the
  `spec-spine` CLI, never via ad-hoc parsers (see
  `.claude/rules/governed-artifact-reads.md`).
- Every spec-claimed code path changes together with its owning `spec.md` (the
  coupling gate, `npx spec-spine couple`); waivers are visible
  `Spec-Drift-Waiver:` PR-body lines, never silent.
