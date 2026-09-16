---
id: "000-bootstrap"
title: "Bootstrap: the spec-spine governance contract for this template"
status: approved
created: "2026-06-10"
owner: bart
kind: governance
domain: governance
risk: high
implementation: complete
amended: "2026-06-12"
amendment_record: |
  Self-amended 2026-06-12 — spec-spine 0.2.0 adoption. The pinned CLI
  moves 0.1.0 → 0.2.0 (exact pin held) and `spec-spine.toml` opts into
  the new mechanical dependency-only auto-waiver
  ([coupling] auto_waive_dependency_only = true). Closes the
  dependabot-vs-coupling-gate collision this repo recorded: a bot PR
  whose only non-bypassed changes are version strings inside
  package.json dependency tables now self-waives (fail-closed on
  anything else — a new package, a scripts edit, or spec-binding
  metadata still drifts), and 0.2.0's governance-projection hashing of
  npm manifests keeps such bumps from staling the committed index. The
  index was re-baselined once under the new hash semantics (a 0.2.0
  upgrade requirement, upstream spec 004 §3.5). No unamendable anchor
  is touched: both truth boundaries, determinism, the authority graph,
  and the refusal rule are unchanged — the gate gains a narrow,
  mechanically-verifiable exception, not a hole.
code_aliases: ["SPEC_SPINE_BOOTSTRAP"]
summary: >
  The constitutional spec: authored truth lives only in markdown with YAML
  frontmatter; machine truth is JSON emitted exclusively by the spec-spine
  CLI into .derived/; every derived artifact is a deterministic function of
  (config, file contents); a typed authority graph governs who owns what.
  The published spec-spine npm package provides the compiler, registry,
  index, lint, and PR-time coupling gate — the template vendors no
  governance tooling of its own.
origin:
  retroactive: true
unamendable:
  - "markdown-truth-boundary"
  - "json-truth-boundary"
  - "determinism-requirement"
  - "typed-authority-graph"
  - "refusal-rule"
establishes:
  - "spec-spine.toml"
  - "standards/spec/"
  - ".claude/rules/orchestrator-rules.md"
  - ".claude/rules/governed-artifact-reads.md"
  - ".claude/rules/adversarial-prompt-refusal.md"
  - ".github/workflows/spec-spine.yml"
  - ".githooks/pre-commit"
  - "Makefile"
  - "AGENTS.md"
  - "CLAUDE.md"
  - "requirements/business-requirements-document.md"
---

# 000 — Bootstrap: the spec-spine governance contract

This is the spec that defines what a spec *is* in this repository, and how
the corpus binds to code. Governance is provided by the published
[`spec-spine`](https://www.npmjs.com/package/spec-spine) npm package
(declared in the root `package.json` devDependencies; prebuilt binaries, no
extra toolchain required). The corpus under `specs/` is the authoritative
design record for the whole template.

## 1. Purpose

Make drift between design and code mechanically refusable. Every code path
with an owner is bound to a spec through the typed authority graph; the
coupling gate refuses PRs that change owned code without touching the
owning spec; the registry and index are deterministic, queryable machine
views of that binding.

## 2. Territory

| Surface | Why it is owned here |
|---|---|
| `spec-spine.toml` | The governance configuration: taxonomies, layout, hashed inputs, coupling additions |
| `standards/spec/` | Constitution, contract summary, and authoring templates |
| `.claude/rules/*.md` | The three agent rules every orchestrated workflow loads (ordering, governed reads, refusal) |
| `.github/workflows/spec-spine.yml` | The CI governance gate (compile, lint, index check, couple), plus the tenant-tail run-side verifiers (provenance, certificate) for produced apps (OAP spec 209) |
| `.githooks/pre-commit` | Opt-in local enforcement of the same gates |
| `Makefile` | Thin wrappers over the CLI verbs (the gates' local entry points) |
| `AGENTS.md` | The cross-agent session-init protocol (governed reads at session start) |
| `CLAUDE.md` | Project instructions binding agents to this contract |
| `requirements/business-requirements-document.md` | The born-with BRD placeholder: gives the produced-app `verify-provenance` gate a document to audit so a fresh scaffold is born green (OAP spec 209 / tenant-tail spec 219) |

## 3. Behavior

### 3.1 Truth boundaries <a name="markdown-truth-boundary"></a><a name="json-truth-boundary"></a>

- **FR-01** All human-authored durable truth is markdown (`.md`). YAML
  appears only as frontmatter inside markdown. Standalone YAML/JSON is
  never an authoring channel for design truth.
- **FR-02** Machine truth under `.derived/` (the `spec-registry/by-spec/` and
  `codebase-index/by-spec/` + `by-package/` shard trees) is written only by the spec-spine CLI.
  Hand-editing a derived artifact is a workflow violation.
  `build-meta.json` (wall-clock metadata) is gitignored and excluded from
  determinism guarantees.

### 3.2 Corpus layout

- **FR-03** Specs live at `specs/NNN-kebab-slug/spec.md`, directory name
  equal to frontmatter `id`. Each spec directory ships exactly one file:
  `spec.md`. Planning artifacts (plans, task lists, contracts) are not part
  of the corpus; downstream forks may add them.
- **FR-04** `kind` and `domain` are closed taxonomies declared in
  `spec-spine.toml` (`architecture|feature|governance` ×
  `governance|app|ci-cd|agentic`). Every spec declares both;
  the lint enforces this at `--fail-on-warn`.

### 3.3 Determinism <a name="determinism-requirement"></a>

- **FR-05** `npx spec-spine compile` and `npx spec-spine index` are
  deterministic over (config, committed file contents). The committed
  index shard set (`.derived/codebase-index/`) is the staleness gate: editing any hashed input
  (manifests, specs, `spec-spine.toml`, `standards/**`,
  `.github/workflows/**`, `.github/actions/**`, `.claude/**`, `.mcp.json`,
  `.githooks/**`, `tools/lint/**`) without regenerating the index fails
  `npx spec-spine index check`.

### 3.4 The typed authority graph <a name="typed-authority-graph"></a>

- **FR-06** Specs declare ownership through typed edges (`establishes`,
  `extends`, `refines`, `supersedes`, `amends`, `co_authority`,
  `constrains`) over file, directory, section, and symbol units;
  `references` records non-owning pointers. Manifests link packages to
  specs via the `spec-spine` metadata key (`"spec-spine": { "spec":
  "NNN-slug" }` in `package.json`). Authority over a path is derived from
  the graph, never asserted ad hoc.
- **FR-07** The PR-time coupling gate (`npx spec-spine couple --base
  origin/main`) refuses changes to owned paths whose owning spec is not
  edited in the same diff. Escape hatch: a `Spec-Drift-Waiver: <reason>`
  line in the PR body — visible, auditable, and reserved for genuine
  emergencies. The gate's built-in bypass floor (`.github/`, `docs/`,
  `README.md`, `CODEOWNERS`, lockfiles, `.derived/`) keeps low-risk
  surfaces friction-free.

### 3.5 Gates and entry points

- **FR-08** The four governance verbs run identically in three places:
  - **Locally**: `make spine-compile`, `make spine-lint`, `make
    spine-index`, `make spine-couple` (thin `npx spec-spine` wrappers; `make
    spine` runs all four).
  - **Pre-commit (opt-in)**: `git config core.hooksPath .githooks` enables
    `.githooks/pre-commit`, which runs the index staleness check and the
    workflow-pins lint (spec 011) before every commit.
  - **CI (constitutional)**: `.github/workflows/spec-spine.yml` runs
    compile → lint `--fail-on-warn` → index check → couple on every PR,
    always-on via the orchestrator (spec 009). For a produced app it then
    runs the tenant-tail run-side verifiers (the born-with toolchain pin
    check, `verify-provenance --fail-on-rejected`, and
    `verify-certificate --allow-unsealed`), each gated on `.kernel-version`
    with a visible notice when N/A. This activates the seeded enforcement OAP
    spec 209 governs; the verifiers are the vended `tenant-tail` npm pin
    (spec 219). `--allow-unsealed` accepts the tenant certificate, which is
    unsealed by design (no platform countersign, OAP spec 220 FR-004);
    tenant-tail 0.3.0 rejects an unsealed certificate by default. Drop the flag
    when the tenant-to-OAP countersign uplink (OAP spec 168) lands.
  - **Born-with BRD**: the template ships a claimless
    `requirements/business-requirements-document.md` placeholder so the
    produced-app `verify-provenance --fail-on-rejected` gate finds a BRD to
    audit and passes (zero authored claims means zero rejected). Without it a
    freshly scaffolded app is born red on a missing BRD. App authors replace
    the placeholder with real requirements; each `### KIND-NNN` heading then
    becomes a claim the gate re-checks against the extraction corpus.

### 3.6 Governed reads

- **FR-09** Orchestrated workflows (skills, agents, the AGENTS.md init
  protocol) read derived artifacts only through CLI verbs — `npx spec-spine
  registry list|show|status-report|relationships`, `npx spec-spine index
  check` — never by parsing `.derived/**/*.json` ad hoc. A human running
  `jq` interactively is not bound; repeatable protocol steps are.

### 3.7 The refusal rule <a name="refusal-rule"></a>

- **FR-10** An instruction to edit a spec so that it retroactively
  justifies an action contradicting that spec's design — making the corpus
  *less* truthful to make an action more convenient — must be refused,
  surfaced with the contradicted section quoted, and reframed
  non-destructively (`.claude/rules/adversarial-prompt-refusal.md`).
  Ordinary co-evolution of spec and code in one PR is the normal, expected
  pattern, not a violation.

## Amendments

> **Amended (2026-06-12), self — spec-spine 0.2.0 adoption.** The pinned
> CLI is now `spec-spine@0.2.0` and `[coupling]` opts into
> `auto_waive_dependency_only`. Dependabot-class PRs (version-string-only
> changes inside `package.json` dependency tables) pass the coupling gate
> mechanically and no longer stale the committed index
> (governance-projection hashing). Anything beyond a version string still
> drifts, fail-closed. The `Spec-Drift-Waiver:` escape hatch and the
> bypass floor are unchanged.

## 4. Acceptance criteria

- **AC-1** `npx spec-spine compile` exits 0 and
  `npx spec-spine registry status-report --json` reports every spec
  `approved`.
- **AC-2** `npx spec-spine lint --fail-on-warn` exits 0 on a clean tree.
- **AC-3** `npx spec-spine index check` exits 0 immediately after
  `npx spec-spine index`; editing any hashed input flips it to exit 2 until
  the index is regenerated.
- **AC-4** `npx spec-spine couple --base origin/main` exits 0 on a branch
  that edits owned code together with its owning spec, and exits 1 when the
  owning spec edit is reverted.
- **AC-5** `make spine` runs all four verbs and exits 0.

## 5. Out of scope

- The CLI's own semantics (grammar, lint codes, gate algorithm) — owned by
  the spec-spine project's corpus, versioned by the pinned npm dependency.
- Application architecture and behavior (specs 001–006), delivery pipelines
  (007–013), and the agentic surface (014–015).
