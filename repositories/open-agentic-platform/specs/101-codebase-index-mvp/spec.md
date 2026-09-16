---
id: "101-codebase-index-mvp"
title: "Codebase Index MVP — Governed Structural Inventory"
status: approved
implementation: complete
owner: bart
created: "2026-04-14"
kind: tooling
domain: tooling
amended: "2026-06-18"
amendment_record: |
  amended by spec 188 (2026-05-30, Phase 4a) — the narrow config-slice hash
  is RE-HOMED out of the broad index. It lived at `build.claudeConfigHash`
  (index schema 2.3.0, Phase 3); Phase 4a moves it to its own tracked file
  `.derived/codebase-index/config-hash.json` (schema config-hash.schema.json
  1.0.0) and bumps the index schema 2.3.0 → 3.0.0 (the field is removed; a
  major bump because it was required under `additionalProperties:false`).
  `compile` writes the file (self-validated, FR-09 parity); `check-config`
  (§2.4, FR-12) reads it. Behavior is bit-for-bit unchanged — same slice,
  same hash, same PR-time blocking gate — only the storage location moved.
  This leaves the broad `index.json` carrying nothing governed, dissolving
  the cache/contract tension Phase 3 surfaced. Phase 4b (`.gitignore` the
  broad index) is now IMPLEMENTED (spec 188, 2026-06-16): the broad
  `index.json` is gitignored and rebuilt on demand, never committed, so
  concurrent PRs never collide on it (clean merge-queue auto-merge). This
  reverses SC-06 (below). See FR-12 and spec 188 §Phase 4.

  amended by spec 188 (2026-05-30, Phase 3) — index freshness enforcement
  is re-homed. The broad `codebase-indexer check` (whole-index staleness,
  FR-10) drops from a required per-PR gate; PRs are no longer required to
  carry a fresh broad `index.json`. The broad committed `index.json`
  becomes a **best-effort regenerable cache** — its byte-freshness on
  `main` is no longer enforced. (A direct-push post-merge heal was
  specified then **retired** in the same spec when the merge queue brought
  PR-required + signed-commits protection to `main`, which a bot push
  cannot satisfy; a report-only `cd-index-staleness-report.yml` surfaces
  drift instead — see spec 188 FR-007.) A new narrow `codebase-indexer
  check-config` subcommand (§2.4) verifies a dedicated
  `build.claudeConfigHash` sub-hash over ONLY `.claude/settings.json` +
  `.mcp.json` (the spec 184 slice); it is the PR-time blocking gate that
  preserves spec 184's guarantee independently of the broad hash, and —
  because it depends only on those two files — it stays valid in a merge
  queue. Schema bumped 2.2.0 → 2.3.0 (additive `build.claudeConfigHash`;
  re-homed and removed at 3.0.0 by Phase 4a, above). See FR-12.

  amended by spec 182 (2026-05-26) — FR-08 and Layer 4 add
  `.claude/skills/**/SKILL.md` to the documented inventory inputs;
  `collect_input_files` in `tools/spec-spine/codebase-indexer/src/lib.rs`
  walks `.claude/skills` alongside `.claude/{agents,commands,rules}`
  (union, not swap) so the indexer hashes the new skill surface
  during and after the spec 182 migration.

  self-amends — §2.4 (2026-05-23) adds the `orphans` subcommand that prints the `traceability.orphanedSpecs` list from `.derived/codebase-index/index.json` to stdout (newline-delimited by default, `--json` for a JSON array). Closes the gap surfaced when `/init` users asked for the orphan list and only the count was rendered.

  amended by spec 184 (2026-05-26) — `collect_input_files`
  additionally hashes `.mcp.json` (project-root MCP server config)
  and `.claude/settings.json` (Claude Code shared settings:
  permissions, hooks, statusLine, env, model) when present.
  Both are optional single-file inputs modeled on the workflow-
  allowlist pattern. Edits to either now trip the staleness gate,
  closing the self-governance loop for the PostToolUse hook glob
  that guards every other hashed input. Spec 184 establishes
  authority over both files.

  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree codebase-indexer this spec established was deleted; the index producer is now spec-spine-core (`spec-spine index`), emitting per-unit shards. The codebase-indexer source units and monolithic index.json reference are stripped (paths deleted); spec 101 continues to govern the codebase-index contract via the surviving OAP overlay schema codebase-index-oap.schema.json.
summary: >
  A deterministic indexer tool that walks the repository tree, parses manifest files
  and spec frontmatter, and emits a governed .derived/codebase-index/index.json artifact.
  Provides four-layer structural inventory: crate/package inventory, spec-to-code
  traceability, factory adapter coverage, and tool/infrastructure catalog. Follows the
  same compiler-emits-artifact pattern established by spec-compiler (001).
  Amended by spec 147 (2026-05-13) to surface the `primary: bool` flag on
  ImplementingPath (sourced from the new `implements:` list-item shape introduced by
  147) and to bump the index schema 1.3.0 → 1.4.0. Consumers that don't recognise the
  flag fall back to spec 130's any-one-claimant heuristic. Further amended by spec 160
  (2026-05-22) to repoint the input-hash walk from the legacy `factory/adapters/*` and
  `factory/process/stages/*` directories (removed in the spec 108 relocation) to the
  statecraft-resident `platform/services/statecraft/api/factory/adapter-scopes.json`
  and `platform/services/statecraft/api/factory/process-stages/`. Layer 3 narrative
  below is preserved as historical record; the live Layer 3 surface moved to
  `tools/oap/oap-code-index-enrich` in Cut D W-07c.
depends_on:
  - "000-bootstrap-spec-system"  # bootstrap-spec-system (artifact pattern)
  - "001-spec-compiler-mvp"  # spec-compiler-mvp (registry pattern)
  - "003-feature-lifecycle-mvp"  # feature-lifecycle-mvp (status vocabulary)
code_aliases: ["CODEBASE_INDEX"]
risk: low
# 217 deleted the in-tree codebase-indexer this spec established; the index producer
# is now spec-spine-core (`spec-spine index`), emitting per-unit shards. The
# codebase-indexer source units and the monolithic index.json reference are stripped
# (paths deleted / no longer emitted). Spec 101 continues to govern the codebase-index
# contract: the generic L1-2 schema is now the spec-spine library's per-unit shard
# schemas (1.0.0), so Workstream D dropped the in-tree monolithic
# codebase-index.schema.json and re-anchored 101 onto the surviving OAP overlay schema
# codebase-index-oap.schema.json (the L1-5 enriched superset emitted by
# oap-code-index-enrich, which is itself tagged spec 101). Amended by 217.
establishes:
  - unit: { kind: file, path: standards/schemas/spec-spine/codebase-index-oap.schema.json }
---

# 101 — Codebase Index MVP

## 1. Problem Statement

OAP has grown to 100+ specs, 15+ Rust crates, multiple TypeScript packages, factory
adapters, platform services, and a deep `.claude/` agent/command infrastructure. No
single artifact provides a machine-readable, structurally accurate inventory of what
exists, what depends on what internally, and how code maps back to governing specs.

Contributors (human and agent) must manually explore the tree to orient themselves.
The `/init` command and explorer agent spend significant tokens re-discovering
structure that should be pre-computed. This is the exact kind of structural knowledge
that should be governed — compiled, verified, and kept current — not guessed or
re-derived per session.

### Why not just read the filesystem?

Reading the filesystem gives you file paths. It does not give you:

- Which crate depends on which other crate (internal dependency graph)
- Which specs govern which code (traceability)
- Which specs have no implementing code (orphaned specs)
- Which code has no governing spec (untraced code)
- Which factory adapters cover which pipeline stages
- What the `.claude/` agent/command inventory looks like

These require cross-referencing multiple manifest files and spec frontmatter — exactly
what a compiler does.

## 2. Solution

### 2.1 The Index as a Build Artifact

A new Rust tool `tools/spec-spine/codebase-indexer/` reads the repository tree and emits
`.derived/codebase-index/index.json`. This follows the identical pattern established by
the spec-compiler:

```
repo tree  →  spec-spine index  →  .derived/codebase-index/by-spec/<id>.json
                                →  .derived/codebase-index/by-package/<slug>.json
```

The generic L1-2 schema is now the spec-spine library's per-unit shard schemas
(1.0.0); the OAP overlay superset lives at
`standards/schemas/spec-spine/codebase-index-oap.schema.json` and is itself a
governed contract.

A markdown renderer mode emits `.derived/codebase-index/CODEBASE-INDEX.md` from the
JSON — this is the human-readable view. It is never hand-authored.

### 2.2 Four-Layer Schema

The index covers four structural layers:

**Layer 1 — Crate & Package Inventory**

Derived from `Cargo.toml` and `package.json` manifests. No LLM interpretation.

| Field | Source | Description |
|-------|--------|-------------|
| `name` | manifest `[package].name` or `"name"` | Canonical package name |
| `path` | directory relative to repo root | Location |
| `kind` | `lib`, `bin`, `npm-package`, `npm-workspace` | Package classification |
| `version` | manifest version field | Declared version |
| `entryPoint` | `src/lib.rs`, `src/main.rs`, `"main"` | Primary entry |
| `internalDeps` | `[dependencies]` matching known crate names | Internal dependency edges |
| `externalDeps` | remaining deps | External dependency list |

**Layer 2 — Spec-to-Code Traceability**

Cross-references spec frontmatter `implements` declarations against actual file paths.

| Field | Source | Description |
|-------|--------|-------------|
| `specId` | spec frontmatter `id` | Governing spec |
| `implementingPaths` | frontmatter `implements` list or `[package.metadata.oap].spec` | Code locations |
| `orphanedSpecs` | specs with no `implements` and no Cargo.toml back-reference | Unimplemented specs |
| `untracedCode` | crates/packages with no governing spec reference | Ungoverned code |

**Layer 3 — Factory Adapter Inventory**

> **Amended by spec 160 (2026-05-22):** Layer 3's live surface moved out of the
> generic indexer in Cut D W-07c (now emitted by `tools/oap/oap-code-index-enrich`),
> and the on-disk locations cited below were removed when the `factory/` directory
> was retired in the spec 108 relocation. The input-hash walk now reads the
> statecraft-resident `platform/services/statecraft/api/factory/adapter-scopes.json`
> (the static fallback snapshot retained after spec 108 dropped the
> `factory_adapters` table) and the forward-compatible
> `platform/services/statecraft/api/factory/process-stages/` directory. The Layer 3
> narrative below is preserved as historical record of the original four-layer model.

Derived from `factory/adapters/*/manifest.yaml` files and the global pipeline stage
definitions in `factory/process/stages/`.

| Field | Source | Description |
|-------|--------|-------------|
| `name` | `adapter.name` from manifest.yaml | Adapter identifier |
| `path` | relative path | Location |
| `displayName` | `adapter.display_name` from manifest.yaml | Human-readable name |
| `targetStack` | adapter directory name | Technology stack |
| `stackLanguage` | `stack.language` from manifest.yaml | Primary language |
| `stackRuntime` | `stack.runtime` from manifest.yaml | Runtime environment |
| `phaseCoverage` | `factory/process/stages/*.md` | Global pipeline stages (shared across all adapters) |

> **Note:** Pipeline stages are global process definitions, not per-adapter stage
> files. Numbered stages run the canonical 7-stage build (`00-pre-flight` through
> `06-adapter-handoff`); conditional stages use a 2-letter prefix (e.g.
> `cd-client-documentation`) and run with NOW/SKIP/DEFERRED scheduling. All
> adapters share the same pipeline; individual adapter capabilities are
> expressed through the manifest's `capabilities`, `agents`, and `patterns`
> sections, not through stage presence.

**Layer 4 — Tool & Infrastructure Inventory**

Catalogs tools, agents, commands, and rules.

| Field | Source | Description |
|-------|--------|-------------|
| `tools` | `tools/*/Cargo.toml` | CLI tool inventory |
| `agents` | `.claude/agents/*.md` | Agent definitions |
| `commands` | `.claude/commands/**/*.md` | Command definitions (legacy form per spec 182; kept hashed during the migration's transition window) |
| `skills` | `.claude/skills/**/SKILL.md` | Skill definitions (primary surface post-spec-182) |
| `rules` | `.claude/rules/*.md` | Rule files |
| `schemas` | `schemas/*.json` | JSON Schema contracts |

### 2.3 Traceability Convention

This spec introduces one new optional convention. Specs may declare which code
implements them via an `implements` key in frontmatter:

```yaml
---
id: "001-spec-compiler-mvp"
status: active
implements:
  - crate: spec-compiler
    path: tools/spec-spine/spec-compiler
  - crate: registry-consumer
    path: tools/spec-spine/registry-consumer
---
```

And `Cargo.toml` files may carry a back-reference:

```toml
[package.metadata.oap]
spec = "001-spec-compiler-mvp"
```

Both directions are optional. The indexer cross-references whatever is declared and
reports orphans in both directions. This is designed for incremental adoption — the
orphan report shows what's untraced and gaps close over time.

**Note:** The `implements` key is not in the spec-compiler's `KNOWN_KEYS` list. It
will land in `extraFrontmatter` as a structured value. A follow-up may promote it to
a first-class key if adoption warrants (requires spec-compiler change per the
`V-002` nested-mapping validation rule — the indexer would read it from
`extraFrontmatter` in the interim, or parse spec frontmatter directly).

### 2.4 Indexer Implementation

The indexer is a Rust binary at `tools/spec-spine/codebase-indexer/`. It follows the
spec-compiler's architecture:

```
src/
  main.rs          — CLI entry (clap): `compile`, `render`, `check`
  lib.rs           — Core indexing logic
  manifest.rs      — Cargo.toml and package.json parsers
  spec_scanner.rs  — Spec frontmatter reader (reuses spec-compiler patterns)
  factory.rs       — Factory adapter scanner
  infra.rs         — Tool/agent/command/rule scanner
  xref.rs          — Cross-reference engine (Layer 2)
  schema.rs        — JSON Schema validation of output
  render.rs        — Markdown renderer
```

Subcommands:

- `codebase-indexer compile` — full index, emits `index.json` + `build-meta.json`
- `codebase-indexer render` — emits `CODEBASE-INDEX.md` from existing `index.json`
- `codebase-indexer check` — exits non-zero if `index.json` is stale vs current tree
- `codebase-indexer check-config` — (spec 188 Phase 3; re-homed Phase 4a)
  exits non-zero if the Claude shared-config slice (`.claude/settings.json` +
  `.mcp.json`) does not match the committed `claudeConfigHash` in
  `.derived/codebase-index/config-hash.json` (re-homed Phase 4a out of the
  broad index's `build.claudeConfigHash`). Narrow counterpart to `check`: it
  hashes only those two files, so it is independent of broad-input churn and
  stays valid in a merge queue. Powers the constitutional `ci-config-hash`
  PR gate that preserves spec 184's blocking guarantee (FR-12).
- `codebase-indexer orphans` — prints the `traceability.orphanedSpecs` list from
  `index.json` (newline-delimited by default; `--json` emits a JSON array). Added
  by the 2026-05-23 self-amendment to close the gap between the count rendered in
  the L2 header and the actual list, which previously required ad-hoc JSON
  parsing — a governed-artifact-reads (spec 103) violation in any orchestrated
  workflow.

### 2.5 CI Integration

Same pattern as the spec registry:

- `codebase-indexer check` runs in CI and fails the build if the index is stale
- PRs that add/remove/move crates, packages, specs, adapters, or tools must update
  the index as part of the change

> **Amended by spec 188 Phase 3 (2026-05-30).** The broad `check` above is
> no longer a required *per-PR* gate, and the broad committed `index.json`
> is a **best-effort regenerable cache** — not kept byte-fresh on `main`
> (this removes the merge-serialization toil; see spec 188 §Problem). A
> direct-push post-merge heal was specified then **retired** when the merge
> queue brought PR-required + signed-commits protection to `main` (a bot
> push can't satisfy it; a bypass actor is a non-starter). Instead,
> `cd-index-staleness-report.yml` runs `check` on `main` and *reports*
> broad drift (annotation + tracking issue) without pushing. The only
> required *per-PR* freshness obligation is the **narrow** `check-config`
> gate over `.claude/settings.json` + `.mcp.json` (FR-12), wired as the
> constitutional `ci-config-hash` workflow. With no healer that writes, the
> FR-009 back door is closed by construction — config drift cannot be
> silently absorbed. (Spec 188 **Phase 4a (done)** re-homed `claudeConfigHash`
> to its own tracked `config-hash.json`, so the broad index now carries
> nothing governed — `check-config` reads the re-homed file. **Phase 4b
> (deferred)** — `.gitignore`-ing the broad index — is separable and not
> required to dissolve the cache/contract split; until it lands the broad
> index stays committed as this best-effort cache.)

### 2.6 Agent Orientation

Once the index exists, any Claude Code agent can read `.derived/codebase-index/index.json`
on startup and immediately understand:

- What crates and packages exist and where
- What depends on what internally
- Which specs govern which code
- What's orphaned in either direction
- What factory adapters are available and their coverage

This replaces expensive per-session tree-walking with a single file read.

## 3. Functional Requirements

### FR-01: Manifest Parsing

The indexer MUST parse `Cargo.toml` files to extract: package name, version, edition,
`[[bin]]` targets, `[lib]` presence, `[dependencies]` (distinguishing workspace members
from external crates), and `[package.metadata.oap]` if present.

### FR-02: Package.json Parsing

The indexer MUST parse `package.json` files to extract: name, version, main/module
entry points, dependencies, devDependencies, and workspaces configuration.

### FR-03: Spec Frontmatter Scanning

The indexer MUST parse spec frontmatter from all `specs/*/spec.md` files, extracting
at minimum: `id`, `status`, `implementation`, `depends_on`, and `implements` (if present
in `extraFrontmatter` or as a direct field).

### FR-04: Internal Dependency Graph

The indexer MUST compute the internal dependency graph by resolving `[dependencies]`
entries that reference other workspace members (by name or path).

### FR-05: Cross-Reference Engine

The indexer MUST cross-reference spec `implements` declarations against actual
filesystem paths and `[package.metadata.oap].spec` back-references. Mismatches
(declared path doesn't exist, back-reference points to non-existent spec) MUST be
reported as warnings.

### FR-06: Orphan Detection

The indexer MUST identify:
- **Orphaned specs**: specs with `implementation != n/a` that have no `implements`
  declaration and no `Cargo.toml` back-reference pointing to them
- **Untraced code**: crates/packages with no governing spec (no `implements` reference
  from any spec and no `[package.metadata.oap].spec`)

### FR-07: Factory Adapter Scanning

> **Amended by spec 160 (2026-05-22):** Adapter manifests are no longer authored
> as per-adapter `manifest.yaml` files in a repo-resident `factory/adapters/`
> directory. The authoritative store is statecraft's
> `factory_artifact_substrate` table (spec 139); the file-backed snapshot the
> indexer hashes is
> `platform/services/statecraft/api/factory/adapter-scopes.json`. The Layer 3
> emission moved to `tools/oap/oap-code-index-enrich` in Cut D W-07c; the
> generic indexer retains only the input-hash walk repointed by spec 160.

The indexer MUST scan `factory/adapters/*/manifest.yaml` and report: adapter name,
display name, path, target stack, language, runtime, and version. The indexer MUST
also scan `factory/process/stages/*.md` to report the global pipeline phase list
(shared across all adapters).

### FR-08: Infrastructure Scanning

The indexer MUST inventory:
- `tools/*/` entries (name, path, binary targets)
- `.claude/agents/*.md` (name, description from frontmatter)
- `.claude/commands/**/*.md` (name, path) — legacy form retained during the spec-182 transition window
- `.claude/skills/**/SKILL.md` (name, path) — primary surface post-spec-182
- `.claude/rules/*.md` (name, path)
- `schemas/*.json` (name, path)

The indexer MUST additionally hash (input-set only, not inventoried)
the following optional single-file Claude Code shared configs when
present at the repo root (spec 184):

- `.mcp.json` — team-shared MCP server config
- `.claude/settings.json` — permissions allow/deny, hooks,
  statusLine, outputStyle, env, model

Both files are hashed byte-for-byte by `collect_input_files` and
skipped cleanly when absent (the indexer is already defensive about
optional inputs — see the workflow-allowlist, adapter-scopes JSON,
and process-stages walk). Edits to either trip the staleness gate
the same as a `Cargo.toml` or workflow YAML edit. The `.claude/`
inventory in the bullet list above remains read-only metadata
extraction; the hash-input contribution is separate.

### FR-09: JSON Schema Validation

The emitted index shards MUST validate against the spec-spine library's per-unit
shard schemas (1.0.0); the OAP overlay enrichment additionally validates against
`standards/schemas/spec-spine/codebase-index-oap.schema.json`. `spec-spine index`
validates its own output before writing.

### FR-10: Staleness Check

`codebase-indexer check` MUST compare the current repo state against the existing
`index.json` content hash and exit non-zero if they differ.

> **Scope note (spec 188 Phase 3).** `check` remains the broad whole-index
> staleness comparison, but it is no longer a required per-PR gate. It runs
> post-merge on `main` in report-only mode (`cd-index-staleness-report.yml`
> surfaces drift without pushing) and locally via `make pr-prep` /
> `ci-strict`. The per-PR blocking obligation is carried by `check-config`
> (FR-12); the broad index is a best-effort cache (spec 188 FR-007).

### FR-11: Markdown Rendering

`codebase-indexer render` MUST produce a human-readable markdown document from
`index.json` that presents all four layers in a structured format.

### FR-12: Narrow Config-Slice Check (spec 188 Phase 3; re-homed Phase 4a)

`codebase-indexer check-config` MUST compare ONLY the Claude shared-config
slice (`.claude/settings.json` + `.mcp.json`, the spec 184 input set)
against the dedicated `claudeConfigHash` field in
`.derived/codebase-index/config-hash.json`, and exit non-zero if they
differ. The slice hash MUST be computed by the same input definition
`compile` uses to write `config-hash.json`, so the written and verified
values cannot drift. Because the slice depends only on those two files,
`check-config` MUST be independent of any other hashed input: editing an
unrelated input (a `spec.md`, a `Cargo.toml`) MUST NOT cause `check-config`
to fail. This independence is what lets `check-config` serve as a
merge-queue-safe PR-time gate (spec 188 FR-006) while preserving spec 184's
guarantee that a quiet edit to either config file cannot merge unacknowledged
(spec 188 FR-009).

> **Re-homed in Phase 4a (2026-05-30).** This slice originally lived at
> `build.claudeConfigHash` inside `index.json` (index schema 2.3.0). Phase
> 4a moved it to its own tracked file `.derived/codebase-index/config-hash.json`
> (schema `config-hash.schema.json` 1.0.0, re-included from `.gitignore`)
> and bumped the index schema **2.3.0 → 3.0.0** (the field is removed — a
> major bump because it was required under `additionalProperties:false`).
> `compile` self-validates `config-hash.json` against its schema (FR-09
> parity). Behavior is bit-for-bit unchanged; only the storage location
> moved. The motivation: leave the broad `index.json` carrying nothing
> governed, dissolving the cache/contract tension (spec 188 §Phase 4).

## 4. Success Criteria

### SC-01: Deterministic Output

Running `codebase-indexer compile` twice on the same repo state MUST produce
byte-identical `index.json` output (same content hash).

### SC-02: Complete Inventory

The index MUST include every Rust crate in `crates/` and `tools/`, every
`package.json` in `apps/` and `platform/services/`, and every spec in `specs/`.

### SC-03: Accurate Dependencies

Internal dependency edges MUST match actual `Cargo.toml` `[dependencies]` entries.
No false positives (edges that don't exist in manifests), no false negatives
(manifest deps on workspace members that are missing from the graph).

### SC-04: Orphan Coverage

The orphan report MUST correctly identify at least the known untraced crates and
unimplemented specs that exist as of spec creation date.

### SC-05: CI Enforcement

A PR that adds a new crate without updating `index.json` MUST fail the CI check.

> **Amended by spec 188 Phase 3 (2026-05-30).** This broad-freshness
> obligation is **no longer a required per-PR gate** — a PR adding a crate
> without regenerating the broad index is not blocked. The broad committed
> `index.json` is a best-effort cache; post-merge, `cd-index-staleness-
> report.yml` *reports* drift on `main` (annotation + tracking issue)
> without pushing — a direct-push heal was retired as incompatible with
> `main`'s PR-required + signed-commits protection. The remaining *per-PR*
> enforcement is the narrow `check-config` gate: a PR editing
> `.claude/settings.json` or `.mcp.json` without regenerating the index
> MUST fail `ci-config-hash` (preserving spec 184's guarantee). Spec 188
> **Phase 4a (done)** re-homed the gated `claudeConfigHash` slice to its own
> tracked `config-hash.json` — but this does **not** restore the
> broad-freshness invariant. **Phase 4b is now implemented** (spec 188,
> 2026-06-16): the broad `index.json` is `.gitignore`-d and rebuilt on demand,
> a pure regenerable artifact, never committed. This restores the freshness
> invariant structurally (a never-committed file cannot be stale on disk),
> retires `cd-index-staleness-report.yml` (nothing committed to report on),
> and reverses SC-06 (see the amendment under SC-06 below). The motivating
> driver was clean merge-queue auto-merge: a committed monolithic index was a
> per-PR merge-conflict point that ejected sibling PRs from the queue.

### SC-06: Agent Startup Acceleration

After index exists, the `/init` command MUST be able to load structural context from
`index.json` instead of walking the tree, reducing init token cost.

> **Amended by spec 188 Phase 4b (2026-06-16): present-on-clone reversed.**
> The broad `index.json` is now gitignored (a rebuilt-on-demand artifact), so
> it is NOT guaranteed present on a brand-fresh clone before the first
> `codebase-indexer compile` (run by `make setup` / `make registry` / `make
> ci`). When absent, `/init` reports "structural index: not built" and
> continues (the graceful-degradation path AGENTS.md already specifies). Once
> compiled, the index persists on disk (untracked), so the startup
> acceleration holds locally; only a brand-fresh pre-build clone pays the
> one-time cost. Per-spec index sharding (spec-spine, planned) will restore a
> committed-but-conflict-free present-on-clone form, superseding this reversal.

## 5. Out of Scope (MVP)

- **Runtime/deployment topology** (Layer 5) — future spec
- **Call graph or symbol-level indexing** — xray crate handles this separately
- **Automatic `implements` inference** — MVP requires explicit declaration
- **Spec-compiler modification** — MVP reads `implements` from `extraFrontmatter`;
  promoting it to a first-class key is a follow-up
- **Cross-repo indexing** — this indexes only the OAP monorepo

## 6. Clarifications

- The indexer is a **deterministic Rust binary**, not an LLM-driven agent. The
  explorer/architect/implementer agent workflow described in the design discussion is
  the bootstrapping approach for the first pass. The long-term path is the compiled tool
  running in CI without any LLM in the loop.
- The `implements` convention is **opt-in and incremental**. Specs and crates without
  declarations simply appear in the orphan report. There is no enforcement gate in MVP.
- The markdown output is a **derived view**, not a source of truth. `index.json` is
  canonical. The markdown is for human consumption and PR review diffs.

## 7. Cross-references

- Spec 118 (`workflow-spec-traceability`) added `workflowTraceability` (Layer 5)
  and bumped `schemaVersion` to `1.1.0`.
- Spec 129 (`granular-package-oap-metadata`) bumps `schemaVersion` to `1.2.0`,
  extends `TraceSource` with `cargo-metadata-crate` (renamed from
  `cargo-metadata`), `cargo-metadata-module` (reserved), `comment-header`
  (new), and `multiple` (replaces `both`); adds the `comment_scanner`
  module and merges file-level claims via xref. The mechanism is additive;
  the index's existing layers are unchanged.
- Spec 133 (`amends-aware-coupling-gate`) bumps `schemaVersion` to `1.3.0`,
  extends `TraceMapping` with `amends` (list of spec ids amended in place
  per spec 119's protocol) and `amendmentRecord` (the back-link surfaced
  from an amended spec's frontmatter). The spec scanner reads the new
  fields from frontmatter; downstream consumers (the spec/code coupling
  gate from spec 127, as relaxed by spec 130) consume them to recognise
  amender→amended edits as valid coupling alongside `implements:`. The
  mechanism is additive — the new fields default to empty when absent
  and the index's existing layers are unchanged.


## Amendments received

**Amendment 2026-05-24 (record: 178-opc-directory-rename).**
Spec 178 (opc-directory-rename, 2026-05-24): mechanical path rename
`product/apps/desktop/*` → `product/apps/opc/*`. No semantic change
to this spec's claims; owned paths inherit the new prefix.
