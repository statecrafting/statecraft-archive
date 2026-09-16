---
id: "014-claude-skills"
title: "Claude Code skills and agents: the agentic surface"
status: approved
created: "2026-06-10"
owner: bart
kind: governance
domain: agentic
risk: low
implementation: complete
depends_on: ["000-bootstrap", "015-claude-config-governance"]
code_aliases: ["CLAUDE_SKILLS"]
summary: >
  The agentic surface: nine skills under .claude/skills/ (init, setup,
  commit, implement-plan, research, validate-and-fix, cleanup,
  scaffold-feature, code-quality), four
  pipeline agents under .claude/agents/ (architect, explorer, implementer,
  reviewer) plus the encore-expert domain specialist, and the frontmatter
  schemas that govern their shape. Skills
  perform all governed reads through the spec-spine CLI; the whole surface
  is a hashed index input, so quiet edits trip the staleness gate.
establishes:
  - ".claude/skills/"
  - ".claude/agents/"
  - "standards/schemas/frontmatter/agent-frontmatter.schema.json"
  - "standards/schemas/frontmatter/skill-frontmatter.schema.json"
---

# 014 — Claude Code skills and agents: the agentic surface

## 1. Purpose

The agentic surface of this template is the set of Claude Code skills and
pipeline agents that automate governed development workflows. Nine skills
under `.claude/skills/` and five agents under `.claude/agents/` form the
primary interaction layer for humans and automated pipelines alike. Their
shape is governed by two JSON Schema files. Because `.claude/**` is listed
in `spec-spine.toml`'s `[index] extra_hashed_inputs`, any quiet edit to a
skill or agent body is visible as index staleness on the next PR.

## 2. Territory

This spec owns the `.claude/skills/` and `.claude/agents/` directory trees
and the two frontmatter schema files under `standards/schemas/frontmatter/`.
The shared config files consumed by skills at runtime (`.mcp.json` and
`.claude/settings.json`) are owned by spec `015-claude-config-governance`.
The AGENTS.md cross-agent protocol body at the repo root is outside this
spec's territory; it is a vendor-neutral AAIF standard read by any coding
agent that opens this repository.

## 3. Behavior

### 3.1 Skill surface

**FR-01**: Nine skills MUST exist under `.claude/skills/`, each as a
`<name>/SKILL.md` file:

| Skill | Contract |
|-------|----------|
| `init` | Thin dispatcher: reads AGENTS.md § New Sessions and executes the cross-agent session-init protocol declared there. MUST NOT inline the protocol body; `wc -l .claude/skills/init/SKILL.md` MUST return fewer than 30 lines. |
| `setup` | Runs `npm install` for the root workspace, verifies `npx spec-spine --version`, then runs `npx spec-spine compile` and `npx spec-spine index` to confirm the spec-spine toolchain is functional. |
| `commit` | Prepares a governed commit: stages changes, runs the pre-commit checks, generates a conventional commit message, and confirms with the user before executing. |
| `implement-plan` | Generic plan-file executor: reads a plan document, executes each step in order with checkpoint confirmations, and writes a structured completion report. |
| `research` | Parallel-research orchestrator: dispatches concurrent sub-agent reads via the Task tool, collects results into a filesystem artifact, and surfaces a structured findings report. |
| `validate-and-fix` | Operates on the npm/TypeScript surface: runs `npm test`, `npm run typecheck`, `encore check`, and `npx spec-spine couple --base origin/main` in sequence, surfaces every failure, and iterates fixes until the suite is green or a human decision is required. It also carries the product's born-with quality checklist (checks 0–15). |
| `cleanup` | Dead-code and dependency hygiene over the npm/TypeScript surface: detects unused exports, stale dependencies, and duplicate code across `apps/web`, `apps/web-internal`, `apps/api`, and `packages/`; degrades gracefully when optional detectors (`knip`, `jscpd`) are absent. |
| `scaffold-feature` | Build-time guide: scaffolds one new Vue + Encore feature (Encore service directory, endpoints, tagged-template model, migration, Vue view, Pinia store, PrimeVue components, tests written alongside) following the template's established patterns. |
| `code-quality` | Authoring-time constraints: translates `eslint.config.mjs` and tsconfig strict rules into generation-time guidance so generated code passes `npm run lint --max-warnings 0` and strict typecheck on the first pass. |

**FR-02**: Skills MUST perform all governed reads through the spec-spine CLI.
Direct parsing of `.derived/**/*.json` with `jq`, `python`, `awk`, or similar
is forbidden within a skill body. The correct pattern is
`npx spec-spine registry status-report`, `npx spec-spine registry list`,
`npx spec-spine index check`, etc.

**FR-03**: The `init` skill MUST reference `AGENTS.md` by name so the
dispatch relationship is explicit. `grep -F "AGENTS.md" .claude/skills/init/SKILL.md`
MUST return at least one match.

### 3.2 Agent surface

**FR-04**: Five agents MUST exist under `.claude/agents/`, each as a
`<name>.md` file: four pipeline agents plus one domain specialist.

| Agent | Role |
|-------|------|
| `architect` | Designs solutions and produces structured plan documents consumed by the `implement-plan` skill. |
| `explorer` | Reads and summarises repository structure, spec coverage, and test surfaces without making changes. |
| `implementer` | Applies a plan produced by the architect agent, making minimal, correct code changes and verifying each step. |
| `reviewer` | Reviews changes for spec fidelity, security invariant compliance, and coupling-gate cleanliness. |
| `encore-expert` | Read-only Encore.ts domain specialist for `apps/api`: grounds endpoint, service, auth, and migration work in the security invariants (spec 002) and the auth/BFF contracts (specs 003 and 004). |

**FR-05**: Agent bodies MUST declare their role, input contract, output
contract, and any tool restrictions in their frontmatter or opening section.

### 3.3 Frontmatter schemas

**FR-06**: Two JSON Schema files govern the shape of skill and agent frontmatter:

- `standards/schemas/frontmatter/skill-frontmatter.schema.json` — required
  fields for `SKILL.md` files: `name` (must match the directory name),
  `description`, `version`.
- `standards/schemas/frontmatter/agent-frontmatter.schema.json` — required
  fields for agent markdown files: `name`, `description`, `role`.

**FR-07**: These schemas are inputs to `npx spec-spine lint`; a skill or agent
with invalid frontmatter MUST cause `npx spec-spine lint --fail-on-warn` to
exit non-zero.

### 3.4 Staleness gate

**FR-08**: `.claude/skills/` and `.claude/agents/` are enumerated in
`spec-spine.toml`'s `[index] extra_hashed_inputs` via the `.claude/**` glob.
Any edit to a skill or agent body MUST be accompanied by regenerated
`.derived/codebase-index/` index shards committed in the same diff, or
`npx spec-spine index check` will exit non-zero and the staleness gate will
block the PR.

### 3.5 Feature-spec materialization

**FR-09**: New application features MUST begin as a spec. Before feature code is
written, a `specs/NNN-slug/spec.md` is authored from
`standards/spec/templates/spec-template.md` (with `kind` and `domain` from the
closed taxonomies and ownership edges declared), and the `architect` agent's
planning pass MUST flag any proposed change with no backing spec as a missing
spec rather than proceed. The `scaffold-feature` skill generates feature code
only; it does not author the spec, so the spec-first step is a precondition, not
a byproduct, of scaffolding.

## 4. Acceptance criteria

- **AC-1:** `ls .claude/skills/` lists exactly the nine skill directories:
  `init`, `setup`, `commit`, `implement-plan`, `research`, `validate-and-fix`,
  `cleanup`, `scaffold-feature`, `code-quality`. Each contains a `SKILL.md`.
- **AC-2:** `ls .claude/agents/` lists exactly the five agent files:
  `architect.md`, `explorer.md`, `implementer.md`, `reviewer.md`,
  `encore-expert.md`.
- **AC-3:** `wc -l .claude/skills/init/SKILL.md` returns a count under 30.
  `grep -F "AGENTS.md" .claude/skills/init/SKILL.md` returns at least one match.
- **AC-4:** `grep -rEl "jq |python3? " .claude/skills/ | xargs -r grep -l ".derived/"`
  returns zero matches (no skill parses `.derived/**` ad hoc; the spec-spine
  CLI is the only governed-read surface).
- **AC-5:** `npx spec-spine compile` exits 0 with the schemas present.
- **AC-6:** `npx spec-spine index check` exits 0 (index current with respect
  to the `.claude/**` inputs).
- **AC-7:** `npx spec-spine couple --base origin/main` exits 0 with this spec
  and all four skill/agent directory additions in the same diff.
- **AC-8:** `.claude/agents/architect.md` instructs the planner to flag work with
  no backing spec (a "missing specs" check), and
  `standards/spec/templates/spec-template.md` exists as the authoring source for a
  new `specs/NNN-slug/spec.md` (FR-09).

## 5. Out of scope

- **AGENTS.md** — the cross-agent session-init protocol body. Owned by
  spec `000-bootstrap`; the `init` skill is a thin dispatcher that reads it,
  not a duplicate of it.
- **`.claude/rules/`** — governed by spec `000-bootstrap` as part of the
  bootstrap scaffold.
- **`.claude/settings.json` and `.mcp.json`** — owned by spec
  `015-claude-config-governance`.
- **Adding new skills beyond the nine** — each addition is a change to the
  agentic surface and requires touching this spec.
- **User-scope skill files** (`~/.claude/skills/`) — outside the project surface
  and not governed by this spec.
