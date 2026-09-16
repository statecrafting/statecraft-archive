# AGENTS.md — Open Agentic Platform

## New Sessions

Run `/init` as the mandatory first action of every new session. The command reads this section to derive its execution plan dynamically — any item added here is automatically picked up on the next init.

**Init protocol (executed by `/init`):**

> AGENTS.md is loaded implicitly as the protocol source — its contents
> are the protocol, so `/init` does not list AGENTS.md as a parallel
> identity read in Step 1 (avoiding the self-reference loop).

0. **Load rules** — read `.claude/rules/orchestrator-rules.md`,
   `.claude/rules/governed-artifact-reads.md`, AND
   `.claude/rules/adversarial-prompt-refusal.md` (the three loaded
   automatically by every orchestrated workflow per spec 103 +
   spec 131).
1. **Refresh the registry, then parallel reads.** Run `spec-spine
   compile` *first* (see **Registry freshness** below; the spec registry
   is a per-clone local cache with no committed reference to staleness-check
   against pre-commit), then dispatch the following simultaneously:
   - `CLAUDE.md` — project overview and conventions
   - `README.md` — full project description
   - `standards/spec/contract.md` — graduated spec spine contract
   - `standards/spec/constitution.md` — graduated constitutional baseline
   - `spec-spine index check` : staleness gate for the structural index (non-fatal)
   - `spec-spine index render` : generic Layer 1+2+Diagnostics markdown
     (the spec-spine view); optional follow-up
     `oap-code-index-enrich render` produces the OAP-overlay
     `.derived/codebase-index/CODEBASE-INDEX.md` (Layers 3-5; spec 101+118)
   - `spec-spine registry status-report --json --nonzero-only` : lifecycle counts per spec status
   - `spec-spine registry list --ids-only` : spec id list (for latest-spec detection)
   - `ls tools/` — top-level tool subdivision (spec-spine/, oap/, lint/, shared/, vendor/)
   - `ls product/apps/` — desktop app discovery
   - `ls docs/` — graduated docs surface
   - `git log --oneline -10` — recent history
   - `git diff --stat HEAD~1` — last change summary
2. **Emit** `## initialized: open-agentic-platform` summary block (layer
   overview, recent activity, ready to help with). The summary
   template includes a `## lifecycle:` sub-section populated from the
   `spec-spine registry status-report --nonzero-only` output. The
   templates live under `standards/spec/templates/` (graduated from
   `.specify/templates/` in Epic 2 I3); modifying the summary shape
   requires editing them, not AGENTS.md.

**Read discipline (spec 103):** the init protocol MUST NOT parse `.derived/**/*.json` directly (no `python`, `jq`, `awk`, `sed` against compiled artifacts). All structural and lifecycle data comes from the consumer binaries and the rendered markdown view.

**Staleness surface:** if `spec-spine index check` exits non-zero, include `Structural index: stale, run `spec-spine index`` in the summary and continue. If `CODEBASE-INDEX.md` is missing and `render` fails (no committed index shards), report `Structural index: not built` and continue without structural counts.

**Registry freshness (spec 103 FR-06):** the spec registry shards under `.derived/spec-registry/by-spec/` are a per-clone local cache (gitignored until the spec 217 / 188-supersession shard commit), so unlike a committed artifact there may be no committed reference for a staleness *check*. `/init` therefore runs `spec-spine compile` *before* the `spec-spine registry` reads, guaranteeing lifecycle counts reflect the current `specs/*/spec.md` frontmatter rather than a stale cache. The recompile is deterministic (constitution Principle IV) and effectively a no-op on an already-fresh tree; if it would change the registry, the prior counts were stale and are now correct. This differs from the codebase-index step (FR-03 surfaces staleness and continues) because for a regenerable cache there is no committed truth to diverge from, only source (`spec.md`) and derived shards.

**Binary missing:** if a consumer binary is not built, instruct the user to `cargo build --release --manifest-path tools/<name>/Cargo.toml` and continue — do NOT fall back to ad-hoc parsing.

If any file is missing: log "not found" and continue.

## Available Agents

Agents live in `.claude/agents/`. Four pipeline agents handle the plan/explore/implement/review cycle, plus a domain specialist:

- `architect` — Plans and decomposes tasks, validates approaches against specs. Read-only.
- `explorer` — Searches the codebase, traces dependencies, gathers context. Read-only.
- `implementer` — Executes focused code changes from an existing plan. Produces minimal diffs.
- `reviewer` — Post-change review for bugs, security, performance, and spec compliance. Read-only.
- `encore-expert` — Encore.ts framework specialist for statecraft service development. Read-only.

## Available Commands

Commands live in `.claude/skills/` (one `SKILL.md` per folder; `.claude/commands/` is the retired legacy form per spec 182):

- `/init` — Initialize a session (load context, recent activity, memory)
- `/setup` : One-time contributor setup: install the `spec-spine` CLI and build the OAP overlay binaries (oap-registry-enrich, oap-code-index-enrich), and verify governed reads work, so `/init` can report lifecycle and structural counts
- `/commit` — Create a git commit with impact-focused conventional message
- `/code-review` — Staged adversarial review: decorrelated finders, per-finding refuters, evidence block (absorbed `/review-branch`)
- `/ship` — Gate → review → commit → PR creation with waiver and evidence discipline
- `/shepherd-prs` — Post-create PR lifecycle: infra reruns, comment triage, merge verification
- `/implement-plan` — Execute a plan file step-by-step with progress tracking
- `/research` — Deep research with parallel sub-agents and query classification
- `/validate-and-fix` — Run quality checks and automatically fix issues
- `/cleanup` — Dead code and duplicate detection with categorized recommendations
- `/refactor-claude-md` — Modularize large CLAUDE.md files with path-scoped rules

## Conventions

- Items added to the "New Sessions" init protocol are auto-loaded by `/init`.
- Agents must be self-contained within `.claude/agents/` — no cross-project dependencies (Rule 5).
- Commands must produce output files for downstream steps — no context-window-only state (Rule 2).
- Orchestrated workflows must read compiled artifacts (`.derived/**`) through consumer binaries, never via ad-hoc parsers — see `.claude/rules/governed-artifact-reads.md` (spec 103).
