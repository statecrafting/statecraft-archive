---
id: "103-init-protocol-governed-reads"
title: "Init Protocol Governed Reads — Consumer Binaries Over Ad-Hoc Parsing"
status: approved
implementation: complete
owner: bart
created: "2026-04-16"
kind: governance
domain: substrate
risk: low
depends_on:
  - "000-bootstrap-spec-system"  # bootstrap-spec-system (Principle II — compiler-owned JSON)
  - "001-spec-compiler-mvp"  # spec-compiler-mvp
  - "002-registry-consumer-mvp"  # registry-consumer-mvp
  - "101-codebase-index-mvp"  # codebase-index-mvp (render/check subcommands)
code_aliases: ["INIT_GOVERNED_READS"]
establishes:
  - unit: { kind: file, path: .claude/rules/governed-artifact-reads.md }
refines:
  - aspect: "governed-reads"
    unit: { kind: file, path: AGENTS.md }
amended: "2026-06-18"
amendment_record: |
  self-amends — Consumer Binaries table (2026-05-23) refreshed to
  advertise the new `codebase-indexer orphans` subcommand landed in
  spec 101's 2026-05-23 self-amendment. The principle is unchanged;
  the table is the orchestrator-facing index of available governed-read
  verbs and must track new subcommands as they land.

  amended by spec 182 (2026-05-30) — the spec-182 deprecation PR
  corrected the stale `.claude/commands/` path in AGENTS.md's
  "Available Commands" listing to `.claude/skills/`. Documentation
  path correction only; 103's governed-reads aspect (FR-01) and the
  `AGENTS.md § New Sessions` protocol body are unchanged. AGENTS.md
  remains the canonical cross-agent protocol authority.

  amended by spec 217 (2026-06-18, engine-swap collapse): the Consumer
  Binaries table in `.claude/rules/governed-artifact-reads.md` and the
  `AGENTS.md § New Sessions` init protocol were repointed from the four
  deleted in-tree engine binaries (spec-compiler, registry-consumer,
  codebase-indexer, spec-code-coupling-check) to the published spec-spine
  CLI (`spec-spine compile|index|registry|couple`) plus the OAP overlay
  (`oap-registry-enrich by-authority`). 103's governed-reads principle is
  unchanged; only the binary names in the consumer table moved.

  self-amends (2026-06-01) — added FR-06 (registry freshness) to the
  `AGENTS.md § New Sessions` protocol. The spec registry
  (`.derived/spec-registry/registry.json`) is gitignored — a per-clone
  local cache — so FR-03's staleness surface, which compares a committed
  `index.json` hash, has no committed reference for the registry. `/init`
  now runs `spec-compiler compile` before the registry-consumer reads so
  lifecycle counts reflect current `spec.md` frontmatter, not a stale
  cache. Motivated by a 2026-06-01 session where `/init` under-reported
  approved specs (165/175/187/188/192) from a month-old local registry.
  The governed-reads aspect (FR-01) is unchanged.
summary: >
  Replace ad-hoc parsing of compiled JSON artifacts in orchestrated workflows
  (starting with /init) with governed reads through the consumer binaries
  (registry-consumer, codebase-indexer). Establishes a reusable rule that
  extends constitution Principle II from authoring discipline to read discipline.
---

# 103 — Init Protocol Governed Reads

> **Amended by spec 182 (2026-05-30).** The spec-182 deprecation PR
> corrected the stale `.claude/commands/` → `.claude/skills/` path in
> AGENTS.md's "Available Commands" listing. This is a documentation
> path correction only — 103's governed-reads aspect (FR-01) and the
> `AGENTS.md § New Sessions` protocol body are unchanged. AGENTS.md
> remains the canonical cross-agent protocol authority.

> **Self-amended (2026-06-01).** Added FR-06 (registry freshness). The
> spec registry is gitignored, so the staleness mechanism FR-03 uses for
> the committed codebase index has no committed reference to check against
> for the registry — `/init` recompiles it (`spec-compiler compile`)
> before reading lifecycle counts so they reflect current `spec.md`
> frontmatter. See **FR-06** and §6. Governed-reads aspect (FR-01)
> unchanged.

## 1. Problem Statement

The `/init` protocol defined in `AGENTS.md § New Sessions` instructs agents to read
`.derived/codebase-index/index.json` directly as "structural context." In practice this
invites ad-hoc parsing: during a recent session, `/init` shelled out to `python3 -c`
three times to extract crate/package/spec counts from the raw JSON, including one
call that failed on a schema guess (`'list' object has no attribute 'keys'`) and had
to be retried.

This is wrong in two distinct ways:

1. **It bypasses the governed read layer.** The registry-consumer (specs 002–031)
   and codebase-indexer (spec 101) exist precisely to mediate reads of compiled
   artifacts. They expose typed subcommands — `registry-consumer status-report
   --json`, `registry-consumer list --ids-only`, `codebase-indexer render`,
   `codebase-indexer check` — that cover every query `/init` actually performs.
   Using python to re-derive those numbers re-implements the consumer layer
   unsafely, per workflow, per session.

2. **It is brittle on schema drift.** Ad-hoc parsers guess shapes. The Rust tools
   have compile-time typed schemas (per user convention: schema versions embedded
   as compile-time constants so mismatches fail at build, not runtime). When the
   indexer's output shape changes, python blobs silently produce wrong answers or
   error at session init; the binaries fail to compile in CI and force the
   correction upstream.

The constitution's Principle II ("compiler-owned JSON machine truth") governs
*authoring* of machine artifacts. This spec extends the same discipline to
*reads of* machine artifacts from orchestrated workflows.

### Why not a CLAUDE.md tip?

Because the instruction lives in `AGENTS.md § New Sessions`, which is the
self-extending init contract. Tips in CLAUDE.md don't rebind the init protocol.
The read layer needs to be the same surface the protocol names.

## 2. Solution

### 2.1 Principle — Governed Artifact Reads

> Compiled artifacts under `build/**` MUST be read by orchestrated workflows
> (commands, agents, init protocol) through their designated consumer binaries.
> Ad-hoc parsers (`python -c`, `jq` pipelines, inline `awk`/`sed`) over
> `build/**/*.json` in a workflow step are a workflow violation.

This is a read-side mirror of Principle II. Humans inspecting artifacts
interactively are unaffected; the rule binds orchestrated, repeatable steps.

### 2.2 Amend `AGENTS.md § New Sessions`

Replace the current "parallel reads" list's structural-inventory entry with
consumer-binary calls. The replacement reads:

```
1. Parallel reads (dispatch simultaneously):
   - CLAUDE.md                                          — project conventions
   - README.md                                          — full project description
   - codebase-indexer check                             — index staleness gate
   - .derived/codebase-index/CODEBASE-INDEX.md          — rendered structural summary
   - registry-consumer status-report --json             — lifecycle counts per status
   - git log --oneline -10                              — recent history
   - git diff --stat HEAD~1                             — last change summary

If `codebase-indexer check` exits non-zero, the summary MUST surface
"(index stale — run `codebase-indexer compile` to refresh)" and continue.
If `CODEBASE-INDEX.md` is missing, init MUST run `codebase-indexer render`
before reading it. Never parse `index.json` directly inside the init protocol.
```

The spec-directory listing (`ls specs/`) is dropped — the rendered index and
`registry-consumer status-report` together provide the same information with
governance.

### 2.3 Add Rule File `.claude/rules/governed-artifact-reads.md`

A new rule file loaded alongside `orchestrator-rules.md`. It defines the
discipline above in reusable form so future commands (beyond `/init`) inherit it
without restating it.

### 2.4 Scope — What Changes, What Does Not

**Changes:**
- `AGENTS.md` § New Sessions (this spec's FR-01)
- `.claude/rules/governed-artifact-reads.md` (new file, FR-02)

**Does not change:**
- Interactive exploration by humans or agents (reading `build/**/*.json` ad-hoc
  in response to a user question is fine)
- The registry-consumer or codebase-indexer themselves — they already expose the
  required subcommands
- CI — lint enforcement of the rule is out-of-scope for this MVP (see §5)

## 3. Functional Requirements

### FR-01: Amend Init Protocol

`AGENTS.md § New Sessions` MUST be rewritten so the "parallel reads" list calls
consumer binaries (`codebase-indexer check`, `codebase-indexer render` +
`CODEBASE-INDEX.md`, `registry-consumer status-report --json`) instead of
naming `.derived/codebase-index/index.json` directly. The section MUST NOT list
any `build/**/*.json` path as a read target.

### FR-02: Publish Governed-Reads Rule

A new file `.claude/rules/governed-artifact-reads.md` MUST exist, stating the
principle in §2.1, listing the allowed consumer binaries and their typical
subcommands, and giving one short "bad pattern / good pattern" example. The
rule MUST reference constitution Principle II and this spec (103).

### FR-03: Staleness Surface

When `/init` runs `codebase-indexer check` and it exits non-zero, the init
summary block MUST include the marker `Structural index: stale` with an
instruction to run `codebase-indexer compile`. Init MUST continue to completion
(not halt) so the user can decide whether to recompile.

### FR-04: Missing Artifact Handling

If `CODEBASE-INDEX.md` is absent (fresh clone, or only `index.json` present),
init MUST run `codebase-indexer render` before reading it. If the render
itself fails (missing `index.json`), init MUST report `Structural index: not
built — run \`codebase-indexer compile\`` and continue without structural data.

### FR-05: Read-Discipline Applies Beyond Init

The rule file (FR-02) MUST state that the discipline applies to every
orchestrated workflow in `.claude/commands/**` and every agent in
`.claude/agents/**`, not only to `/init`. No other command is rewritten as
part of this MVP; the rule is the enforcement surface.

### FR-06: Registry Freshness Before Lifecycle Read

`AGENTS.md § New Sessions` MUST run `spec-compiler compile` before the
`registry-consumer status-report` / `list` reads. Rationale: the spec
registry (`.derived/spec-registry/registry.json`) is gitignored — a
per-clone local cache, never committed — so FR-03's staleness *check*,
which compares a committed `index.json` hash, has no committed reference
for the registry. Recompiling is the only mechanism that guarantees
lifecycle counts reflect the current `specs/*/spec.md` frontmatter. The
recompile is deterministic (constitution Principle IV) and idempotent; on
an already-fresh tree it changes nothing. Unlike FR-03 (which *surfaces*
staleness and continues), FR-06 *eliminates* the staleness, because for a
gitignored artifact there is no committed truth to diverge from — only
source (`spec.md`) and derived cache. This is read-side hygiene, not a new
authoring channel: the recompile is the same `spec-compiler compile` that
already produces the canonical registry (constitution Principle II).

## 4. Success Criteria

### SC-01: Init Does Not Invoke Python Against Build Artifacts

A trace of the `/init` protocol executing end-to-end MUST contain zero calls of
the form `python*` or `jq` (or equivalent ad-hoc parsers) against any path
under `build/`. The structural summary is derived entirely from
`CODEBASE-INDEX.md` and consumer-binary JSON output.

### SC-02: Rule File Discoverable

`.claude/rules/governed-artifact-reads.md` exists and is referenced from
`AGENTS.md` (Conventions section) so new commands pick it up on authoring.

### SC-03: Staleness Is Visible, Not Silent

When the index is stale at init time, the emitted summary block surfaces the
stale marker. A user who pulls new crates without recompiling sees the warning
on the very next `/init`, not two sessions later.

### SC-04: No Raw JSON Path Leaks Into Init

Grepping `AGENTS.md` for `build/**/*.json` (raw compiler JSON) as a read target
MUST return zero hits. The only `build/**` path init is allowed to name is the
rendered markdown view (`.derived/codebase-index/CODEBASE-INDEX.md`), which is
itself a governed output of `codebase-indexer render`. All JSON reads flow
through consumer binaries.

### SC-05: No Regression In Init Coverage

The summary block still reports: branch, uncommitted status, structural
counts (crates/packages/specs), lifecycle counts, latest spec id, recent
commits, and memory-sourced context. No orientation signal is lost by the
migration.

## 5. Out of Scope (MVP)

- **Automated lint** that rejects commands/agents parsing `build/**/*.json`
  directly — tracked as a follow-up once the rule has settled. For the MVP the
  rule is enforced by review.
- **Migrating other commands** (`/code-review`, `/validate-and-fix`, etc.) to
  consumer-binary reads — only `/init` is rewritten here. Those commands do
  not currently parse `build/` artifacts, so the rule binds them by policy
  going forward.
- **Adding a `codebase-indexer summary --json` subcommand** — the rendered
  markdown plus `registry-consumer status-report --json` cover init's needs.
  If a future command needs typed structural numbers, that is the right moment
  to add the subcommand, not speculatively here.
- **Runtime policy gate** (e.g. `CONST-005-compiler-json-direct-access`)
  enforced by the policy kernel — out of scope until the rule has been lived
  with and the kernel has a path hook suitable for read-side gates.

## 6. Clarifications

- "Orchestrated workflow" means a command under `.claude/commands/` or an
  agent under `.claude/agents/`, executing a protocol with defined steps. It
  does not mean "anything Claude does in a session."
- Interactive, exploratory tool use by an agent answering a user question is
  explicitly not governed by this spec. The rule is about the repeatable
  protocol layer, where drift compounds.
- The rule does not forbid reading compiled JSON — it forbids parsing it
  ad-hoc. A consumer binary IS allowed to `serde_json::from_reader` the
  artifact; that is what makes it the consumer.
- FR-06's recompile applies to the spec registry because it is gitignored
  (`.gitignore`: `.derived/spec-registry/*`). The codebase index
  (`.derived/codebase-index/index.json`) is committed and therefore uses
  FR-03's hash *check* instead. The two derived artifacts get different
  freshness treatment for exactly this reason: one has a committed
  reference, the other does not. If a future change commits the registry,
  FR-06 should be revisited in favour of an FR-03-style check.

## Amendment — 2026-06-10: AGENTS.md Available Commands refresh

The `## Available Commands` listing in AGENTS.md (outside the
`## New Sessions` protocol block this spec's AC-hash mechanisms cover,
so `PROTOCOL_SOURCE_HASH` is unaffected) is updated for the spec-182
post-migration evolution: `/review-branch` retired into `/code-review`
Stage 0; `/ship` and `/shepherd-prs` added. The init protocol itself is
unchanged.
