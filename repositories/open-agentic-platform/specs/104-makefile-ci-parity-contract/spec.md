---
id: "104-makefile-ci-parity-contract"
title: "Makefile as CI Parity Contract — Drift-Checked Local Mirror of GitHub Actions"
status: approved
implementation: complete
owner: bart
created: "2026-04-16"
amended: "2026-06-11"
amendment_record: |
  amended 2026-06-11 (self-amendment, riding the spec-198 FR-012
  adapter-scopes derivation cutover) — the PRODUCERS rule for
  `adapter-scopes-compiler` repoints its artifact from the retired
  `build/adapter-scopes.json` to the real committed snapshot at
  `platform/services/statecraft/api/factory/adapter-scopes.json`. The
  tool no longer writes a `build/` copy; the rule table stays truthful.
  No workflow or Makefile recipe invokes the pattern today, so no
  parity verdict changes.

  amended by the spec-177 ci-gate fold (2026-05-31) — `ai-pr-review.yml` is
  no longer "not enforcing." It is folded into the orchestrated gate
  (made reusable, dispatched from `ci.yml`, required via `ci-gate.needs`), so
  a failed or absent AI review now blocks merge. It nonetheless stays
  **parity-exempt**: an AI review calls a hosted model and cannot be
  reproduced by `make ci-strict`, so it is the FIRST gate without a local
  mirror — a deliberate carve-out. The parity TOOL needs no change: it
  iterates `ENFORCING_WORKFLOWS` (which `ai-pr-review.yml` is correctly NOT
  in) and never reads `ci-gate.needs`, so a gate-without-mirror is invisible
  to it by construction. The §"Explicitly not enforcing" list and the
  "AI-assist workflow is not enforcing" line are corrected below to record
  the new gate-but-exempt status honestly.

  amended by spec 135 (135-fast-ci-as-default, 2026-05-03).

  amended by spec 182 (2026-05-30) — the `process` section this spec
  co-authors moved verbatim to `.claude/skills/validate-and-fix/SKILL.md`
  in the spec-182 deprecation PR (legacy `.claude/commands/validate-and-fix.md`
  deleted); the `co_authority` section unit and the SC-05 body references
  are repointed accordingly. No contract change.
kind: governance
domain: tooling
risk: low
depends_on:
  - "000-bootstrap-spec-system"  # bootstrap-spec-system (Principle II — compiler-owned JSON)
  - "006-conformance-lint-mvp"  # conformance-lint-mvp (precedent for static workflow linting)
code_aliases: ["CI_PARITY_CONTRACT"]
establishes:
  - unit: { kind: file, path: tools/oap/ci-parity-check/src/lib.rs }
  - unit: { kind: file, path: tools/oap/ci-parity-check/src/main.rs }
  - unit: { kind: file, path: .github/workflows/ci-parity.yml }
co_authority:
  - with_specs:
      - "102-governed-excellence"
      - "127-spec-code-coupling-gate"
      - "116-supply-chain-policy-gates"
      - "128-spec-lint-default-fail-on-warn"
      - "134-fast-local-ci-mode"
      - "135-fast-ci-as-default"
    unit: { kind: section, file: Makefile, anchor: ci-parity }
  - with_specs:
      - "000-bootstrap-spec-system"
    unit: { kind: section, file: .claude/skills/validate-and-fix/SKILL.md, anchor: process }
summary: >
  Promote the root Makefile to the authoritative single source of truth for
  local validation parity with every CI-enforcing GitHub Actions workflow.
  Introduce a drift-check binary (tools/oap/ci-parity-check) and a CI job that
  fails on drift between workflow `run:` blocks and Makefile recipes.
---

# 104 — Makefile as CI Parity Contract

> **Amended by spec 182 (2026-05-30).** The `process` section this spec
> co-authors (the `/validate-and-fix` contract reference) moved verbatim
> to `.claude/skills/validate-and-fix/SKILL.md`; the legacy
> `.claude/commands/validate-and-fix.md` was deleted in the spec-182
> deprecation PR. The `co_authority` section unit and the SC-05 body
> references are repointed accordingly. No contract change.

> **Amendment (spec 134, 2026-05-03).** A sibling target `make ci-fast` is
> now permitted as a parity-exempt, performance-optimised local mirror.
> Lines bracketed by `# BEGIN ci-fast (spec 134)` / `# END ci-fast` in the
> Makefile are skipped by `ci-parity-check`. The parity contract on
> `make ci` is unchanged.
>
> **Amendment (spec 135, 2026-05-03).** Two structural changes follow on
> from spec 134's measurement work. (a) The `ci-rust` recipe collapses
> the per-manifest loop over `crates/*` into a single `cargo --workspace
> --manifest-path crates/Cargo.toml` triple, closing the ghost-crate gap
> where 7 of 18 workspace members previously escaped `make ci`.
> `deployd-api-rs` (separate workspace) stays as a per-manifest
> invocation. (b) The `ci` and `ci-fast` target names are reversed:
> `make ci` now refers to the fast parallel local validation (the daily
> dev loop), and `make ci-strict` is the parity-bound recipe (pre-merge
> / parity-investigation). The parity contract itself is unchanged —
> `ci-parity-check` rebinds to `ci-strict:`. The §2.2 table below has
> been updated; spec 134's body is reframed editorially in the same PR.

## 1. Problem Statement

Prior to this spec, `/validate-and-fix` discovered validation commands
heuristically (grep `package.json`, list `Cargo.toml` manifests, read CLAUDE.md).
That gave it partial coverage — root `cargo clippy` misses every isolated
Cargo workspace, `platform/services/statecraft` was never validated at all,
and the ten `registry-consumer` contract subsets in `spec-conformance.yml`
had no local mirror. The command would report green while CI turned red.

The fix landed in one change: a `ci` target family in the root Makefile
(`make ci`, `ci-rust`, `ci-tools`, `ci-desktop`, `ci-statecraft`, `ci-cross`)
mirroring every gate enforced by `.github/workflows/`. `/validate-and-fix`
now invokes `make ci` directly and drops the discovery heuristics.

This works today, but is silently fragile: if a contributor adds a new
gate to a workflow without adding the mirror to the Makefile, `/validate-and-fix`
passes locally and fails in CI — exactly the asymmetry the consolidation was
meant to eliminate. Nothing in the build pipeline detects the drift.

This spec formalises the Makefile's role and adds a small, owned enforcement
surface.

## 2. Solution

### 2.1 Principle — CI Parity Is Contractual

> The root `Makefile`'s `ci` target and its subtargets MUST mirror, line-for-line
> in spirit, every validation `run:` block in the set of **CI-enforcing
> workflows** under `.github/workflows/`. A workflow gate without a Makefile
> mirror is a workflow violation.

This is a sibling of constitution Principle II (compiler-owned JSON) and
spec 103's governed-reads rule: where Principle II binds *authoring* of
machine artifacts and 103 binds *reads*, this binds *local parity* with
the enforced build pipeline.

### 2.2 The CI-Enforcing Workflow Set

The following workflows are **enforcing** — each runs validation that can
block a merge. `make ci` MUST mirror their commands:

| Workflow | Mirror in Makefile |
|----------|--------------------|
| `ci-axiomregent.yml` | `ci-rust` (covered by `cargo --workspace --manifest-path crates/Cargo.toml`; `crates/axiomregent` is a workspace member) |
| `ci-crates.yml` | `ci-rust` (`cargo --workspace --manifest-path crates/Cargo.toml`; per spec 135 the matrix collapses to a single workspace job) |
| `ci-deployd-api-rs.yml` | `ci-rust` (`platform/services/deployd-api-rs/Cargo.toml`, separate workspace, per-manifest invocation) |
| `ci-desktop.yml` | `ci-desktop` |
| `ci-orchestrator.yml` | `ci-rust` (covered by `cargo --workspace --manifest-path crates/Cargo.toml`; `crates/orchestrator` is a workspace member) |
| `ci-policy-kernel.yml` | `ci-rust` (covered by `cargo --workspace --manifest-path crates/Cargo.toml`; `crates/policy-kernel` is a workspace member) |
| `ci-statecraft.yml` | `ci-statecraft` |
| `spec-conformance.yml` | `ci-tools` (including all ten contract subsets via `CI_REGISTRY_CONSUMER_CONTRACTS`) |

> Post-spec-135 note: the parity-bound recipe lives under `make
> ci-strict`. References to `make ci` elsewhere in this spec — written
> before the rename — refer to that same recipe, now under the
> `ci-strict` target name. `ci-parity-check` scans `ci-strict:` for
> parity tokens.

Explicitly **not** enforcing (excluded from the parity contract):

- `ai-changelog.yml` — AI-assist, no validation gate.
- `ai-pr-review.yml` — AI-assist that, since the spec-177 fold (2026-05-31),
  **does** gate merge (dispatched from `ci.yml`, required via
  `ci-gate.needs`) — yet is still **parity-exempt**. It is the one gate the
  parity contract intentionally does not require a `make ci-strict` mirror
  for: a hosted-model review has no deterministic local equivalent. It is
  therefore (correctly) absent from `ENFORCING_WORKFLOWS`; the tool only
  obligates mirrors for that list and never inspects `ci-gate.needs`, so the
  gate-without-mirror carve-out needs no code exception.
- `build-axiomregent.yml` — build-only matrix (`ci-cross` is the opt-in local mirror)
- `cd-deployd-api-rs.yml`, `cd-statecraft.yml` — delegate to enforcing CI via `workflow_call`
- `release-*.yml` — release packaging, downstream of merge
- `ci-parity.yml` — the enforcement surface itself (this spec)

### 2.3 Drift-Check Tool

A new Rust binary `tools/oap/ci-parity-check` reads the enforcing workflows' YAML,
extracts every `run:` block's significant command lines (those invoking
`cargo`, `pnpm`, `npm`, `npx`, `node`, or a `./tools/*/target/release/*` binary),
normalises them, and asserts that each line's command skeleton appears in the
Makefile. The tool fails with exit 1 and a per-line report when drift is
detected.

The tool is a Rust binary (not a shell script) because:
1. The user's stated direction is to retire `scripts/` in favor of binaries.
2. A binary has a compiler-checked schema for the workflow subset it parses,
   so changes to GitHub Actions YAML shape fail at build, not silently.
3. It participates in the same governed-tool-surface the rest of `tools/` does.

### 2.4 Enforcement Surface

A new workflow `.github/workflows/ci-parity.yml` runs `ci-parity-check` on
every push and PR. A new `make ci-parity` target lets contributors run it
locally before opening a PR.

The parity check is **additive to**, not a replacement for, the existing
enforcing workflows. Those still run and still gate merges. `ci-parity`
only prevents the Makefile from silently falling behind them.

### 2.5 Scope — What Changes, What Does Not

**Changes:**
- New spec file (this one)
- New Rust crate `tools/oap/ci-parity-check/`
- New `ci-parity` target in the root `Makefile`
- New workflow `.github/workflows/ci-parity.yml`
- `.claude/skills/validate-and-fix/SKILL.md` gains a one-line reference to
  `make ci-parity` in its Process section

**Does not change:**
- Any existing CI-enforcing workflow (they remain the actual gate)
- `make ci` or its subtargets (unchanged by this spec)
- `scripts/` (addressed by spec 105, not here)

## 3. Functional Requirements

### FR-01: Parity Contract Documented in Spec

The enforcing-workflow list in §2.2 is authoritative. Adding a new workflow
that gates a merge requires adding a row to that table and updating
`ci-parity-check`'s configured workflow list in the same change.

### FR-02: `tools/oap/ci-parity-check` Binary

A Rust crate at `tools/oap/ci-parity-check/` MUST:

- Parse the YAML of each configured enforcing workflow (§2.2)
- Extract significant command lines from every step's `run:` block
- Normalise each line (strip leading whitespace, trailing comments, shell
  continuations, `set -e` / `set -euo pipefail` preambles)
- For each normalised line whose first token is in the recognised-command set
  (`cargo`, `pnpm`, `npm`, `npx`, `node`, or a path under `./tools/`), check
  that a substring-equivalent form appears in the root `Makefile`
- Exit 0 on parity, 1 on drift
- Emit on drift: `MISSING in Makefile: [<workflow>:<job>:<step>] <line>`

### FR-03: `make ci-parity` Target

A `ci-parity` target MUST exist at the root of the `Makefile`. It builds
`ci-parity-check` in release mode and runs it. The build step is idempotent
(skipped if the binary is newer than its sources).

### FR-04: CI Parity Workflow

`.github/workflows/ci-parity.yml` MUST:

- Trigger on `push: branches: [main]` and on `pull_request`
- Run on `ubuntu-latest` with the project's standard Rust toolchain action
  (`dtolnay/rust-toolchain@<sha> # stable`)
- Cache Rust dependencies (`Swatinem/rust-cache@<sha>`)
- Build and run `tools/oap/ci-parity-check`
- Fail the job on drift

### FR-04.1: Precondition Check (Fresh-Clone Execution Parity)

`tools/oap/ci-parity-check` MUST also verify fresh-clone execution parity,
not just command equality. The command-equality check guarantees that
every `run:` block has a Makefile mirror; it does not guarantee the
CI runner has the preconditions the command needs to succeed.

Concretely: for every step in an enforcing workflow that invokes a
"consumer" of a governed artifact under `build/`, the tool MUST assert
that the artifact is either:

- produced by an earlier step in the same job (known producer
  invocation detected via substring match), OR
- tracked in git (discovered via `git ls-files`)

If neither holds, the tool MUST report a precondition drift. The
canonical case this catches: a workflow step running
`codebase-indexer check` without a prior `codebase-indexer compile` and
without `.derived/codebase-index/index.json` committed — passes locally
because the file exists as dev-workspace residue, fails on CI because
the fresh clone has no such file.

Consumer and producer rules are listed in
`tools/oap/ci-parity-check/src/lib.rs` (`CONSUMERS` and `PRODUCERS`
constants). Adding a new tool that reads or writes a governed artifact
MUST extend those constants in the same change.

### FR-05: Recognised Exclusions

The tool MUST recognise and skip the following line classes:

- `set -e`, `set -euo pipefail`, empty lines, comment-only lines
- `cd <dir>` preambles (the command that follows is what matters)
- `echo`, `mkdir`, `touch`, `chmod`, `grep` auxiliary lines
- Shell-variable assignments without a command (`FOO=$(...)`)
- `|| true` suffixes (warning-non-blocking pattern, present in `spec-lint` smoke)

### FR-06: Explicit Allow List for CI-Only Steps

Some CI steps have no local analogue (e.g. `ci-desktop.yml` creates a dist
stub and sidecar stub on fresh runners). The tool MUST support a documented
allow list embedded in its source that suppresses drift reports for those
exact lines. Each allow-list entry MUST cite the reason in a comment.

## 4. Success Criteria

### SC-01: Drift Is Caught In CI

Introducing a `run:` block to any enforcing workflow without a Makefile
mirror MUST cause `ci-parity.yml` to fail with a clear diagnostic pointing
at the missing line. Likewise, introducing a step that reads a governed
artifact without either a prior producer step or a committed baseline
MUST fail the precondition check.

### SC-02: The Tool Is Stable Against Cosmetic Changes

Adding a new `echo` banner, reordering steps, or renaming a step in a
workflow MUST NOT cause `ci-parity` to fail as long as the actual
validation commands are still mirrored.

### SC-03: `make ci-parity` Runs In Under 10 Seconds On A Warm Build

The check is cheap: read ~8 YAML files, read one Makefile, substring-match
against each. A cold build of the tool is acceptable to take longer
(cargo compile); a warm run must be near-instant.

### SC-04: The Allow List Is Explicit And Rare

FR-06 entries MUST each have a one-line inline rationale. If the allow
list grows past ~5 entries, this spec MUST be revisited (the rule is
too lossy to enforce).

### SC-05: `/validate-and-fix` References The Contract

`.claude/skills/validate-and-fix/SKILL.md` MUST mention `make ci-parity` as
a pre-PR check, alongside the existing `make ci` step.

## 5. Out of Scope (MVP)

- **Semantic equivalence checking** (e.g. "these two cargo invocations are
  equivalent even with reordered flags") — substring match is sufficient
  for the gate; semantic equivalence is over-engineered for MVP.
- **Deploy-workflow parity** — `cd-*.yml` workflows are delegators; their
  validation is transitive via the enforcing workflows they call.
- **Reverse check** (Makefile steps that are NOT in any workflow) — a
  Makefile target that is a pure convenience (e.g. `make dev`) is fine
  without a CI mirror. Only the workflow → Makefile direction is enforced.
- **Multi-Makefile parity** (e.g. `platform/Makefile`) — the root Makefile
  is the contract. Delegation to `platform/Makefile` via `cd platform && make ...`
  is treated as an opaque command and mirrored by presence, not
  recursively.

## 6. Clarifications

- "Enforcing workflow" means one that can block a merge on validation
  failure. A release workflow is not enforcing. AI-assist was likewise
  non-enforcing until the spec-177 fold (2026-05-31) made `ai-pr-review.yml`
  block merge via `ci-gate`; it is now the sole **enforcing-but-parity-exempt**
  workflow — it gates merge yet has no `make ci-strict` mirror (a hosted-model
  review has no deterministic local equivalent), so it is intentionally
  absent from `ENFORCING_WORKFLOWS` and the parity tool does not obligate a
  mirror for it. Enforcing ⇏ mirrored is now a recognised (single-instance)
  exception, not a contradiction.
- "Significant command line" means a line whose first non-`cd` token is
  in the recognised-command set. The spec deliberately narrows scope: we
  catch cargo/node-ecosystem drift, not every shell utility.
- The parity rule is **asymmetric**: workflows MUST have Makefile mirrors,
  Makefile-only targets (`make dev`, `make setup`) are fine.

## 7. Cross-references

- Spec 127 (`spec-code-coupling-gate`) plugs the
  `ci-spec-code-coupling.yml` workflow into the `ENFORCING_WORKFLOWS`
  registry of `tools/oap/ci-parity-check/src/lib.rs` and adds the matching
  `ci-spec-code-coupling` Makefile target. The count of mirrored
  workflows moves from 9 → 11 (the 10th was `ci-supply-chain.yml` from
  spec 116). No change to the parity contract itself.


## Amendments received

**Amendment 2026-06-11 (record: self-amendment with spec 198 FR-012).**
The `PRODUCERS` table in `tools/oap/ci-parity-check/src/lib.rs` maps the
`adapter-scopes-compiler` command pattern to the artifact it writes. The
spec-198 FR-012 derivation cutover retired the tool's legacy
`build/adapter-scopes.json` copy (untracked, consumer-less); the rule now
names the committed snapshot
`platform/services/statecraft/api/factory/adapter-scopes.json`. No
enforcement change: no Makefile recipe or workflow invokes the pattern.

**Amendment 2026-05-24 (record: 178-opc-directory-rename).**
Spec 178 (opc-directory-rename, 2026-05-24): mechanical path rename
`product/apps/desktop/*` → `product/apps/opc/*`. No semantic change
to this spec's claims; owned paths inherit the new prefix.
