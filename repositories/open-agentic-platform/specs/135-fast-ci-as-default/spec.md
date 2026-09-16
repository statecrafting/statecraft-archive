---
id: "135-fast-ci-as-default"
title: "Fast CI as Default — Crates Workspace Convergence + Target Rename"
status: approved
implementation: complete
owner: bart
created: "2026-05-03"
approved: "2026-05-03"
completed: "2026-05-03"
amended: "2026-06-11"
amendment_record: |
  amended by spec 182 (2026-05-30) — the `validate-and-fix` file this
  spec extends (wrapping) moved verbatim to
  `.claude/skills/validate-and-fix/SKILL.md` in the spec-182
  deprecation PR (legacy command file deleted); the `extends:` unit
  path is repointed from `.claude/commands/validate-and-fix.md`
  accordingly. No behavioral change.
  self-amended (2026-06-11), FR-05a: hosted-runner disk headroom for
  the disk-heavy Rust CI jobs. A local composite action
  (.github/actions/free-disk-space, established by this spec) is wired
  into ci-crates.yml and spec-conformance.yml after merge_group runs
  27355231139 (ci-crates, ENOSPC mid-test) and 27371047814
  (spec-conformance, rustc LLVM IO failure on output stream) both
  exhausted hosted-runner disk. Guarded to GitHub-hosted runners
  inside the action; no change to any validation surface.
kind: governance
domain: tooling
risk: low
amends:
  - "104-makefile-ci-parity-contract"
depends_on:
  - "104-makefile-ci-parity-contract"  # makefile-ci-parity-contract (the contract being amended)
  - "134-fast-local-ci-mode"  # fast-local-ci-mode (the sibling target being promoted)
  - "130-spec-coupling-primary-owner"  # spec-coupling-primary-owner (claim resolution for shared paths)
co_authority:
  - with_specs:
      - "102-governed-excellence"
      - "104-makefile-ci-parity-contract"
      - "116-supply-chain-policy-gates"
      - "127-spec-code-coupling-gate"
      - "128-spec-lint-default-fail-on-warn"
      - "134-fast-local-ci-mode"
    unit: { kind: section, file: Makefile, anchor: ci-default-rename }
establishes:
  - unit: { kind: file, path: .github/actions/free-disk-space/action.yml }
extends:
  - spec: "104-makefile-ci-parity-contract"
    nature: wrapping
    unit: { kind: file, path: tools/oap/ci-parity-check/src/lib.rs }
  - spec: "104-makefile-ci-parity-contract"
    nature: wrapping
    unit: { kind: file, path: .github/workflows/ci-crates.yml }
  - spec: "104-makefile-ci-parity-contract"
    nature: wrapping
    unit: { kind: file, path: specs/104-makefile-ci-parity-contract/spec.md }
  - spec: "134-fast-local-ci-mode"
    nature: wrapping
    unit: { kind: file, path: .claude/skills/validate-and-fix/SKILL.md }
summary: >
  Amend spec 104 to (a) collapse the per-manifest crates/* loop in `ci-rust`
  into a single `cargo --workspace` invocation, closing the ghost-crate
  validation gap permanently in the parity-bound recipe, and (b) reverse
  the semantic positions of `make ci` and `make ci-fast`. After this spec,
  `make ci` is the fast parallel local validation (≈ 5 min warm) used as
  the daily dev loop, and `make ci-strict` is the parity-mirror recipe
  (90+ min) used pre-merge for release verification or when investigating
  parity drift. The `ci-parity-check` binding follows the rename.
---

# 135 — Fast CI as Default + Crates Workspace Convergence

> **Amended by spec 182 (2026-05-30).** The `validate-and-fix` file this
> spec extends (wrapping) now lives at
> `.claude/skills/validate-and-fix/SKILL.md` (migrated verbatim from the
> deleted `.claude/commands/validate-and-fix.md` by the spec-182
> deprecation PR); the `extends:` unit path is repointed accordingly.
> No behavioral change.

> Amends spec 104 (`makefile-ci-parity-contract`) §2.2. Spec 134
> (`fast-local-ci-mode`) introduced `make ci-fast` as a sibling target
> with a parity-exempt sentinel; this spec promotes that target to the
> primary `make ci` namespace and renames the previous `make ci` to
> `make ci-strict` so the daily/pre-merge distinction is explicit at
> the command line.

## 1. Problem Statement

Two structural issues from the spec 134 implementation work both trace
back to the same root cause: the parity-bound `make ci` recipe
validates a strict subset of the `crates/` workspace.

**Ghost-crate gap.** The `crates/Cargo.toml` workspace declares 18
members. `CI_RUST_MANIFESTS` in the Makefile lists 12 manifests, of
which 11 are from `crates/` (the 12th is
`platform/services/deployd-api-rs/Cargo.toml`, a separate workspace).
The remaining 7 `crates/` workspace members —

| Member | Validated by `make ci` today? |
|---|---|
| `crates/agent` | no |
| `crates/factory-platform-client` | no |
| `crates/factory-project-detect` | no |
| `crates/featuregraph` | no |
| `crates/provenance-validator` | no |
| `crates/run` | no |
| `crates/xray` | no |

are validated **only** by `make ci-fast`'s `cargo clippy --workspace
--manifest-path crates/Cargo.toml --all-targets -- -D warnings`
invocation, never by `make ci` or any enforcing GitHub workflow. They
have been silently accumulating debt:

- PR #76 surfaced 16 clippy errors across 5 of these 7 ghost crates
  the first time `make ci-fast` ran them under the current toolchain.
- PR #77 surfaced a 31-spec stale `featuregraph` golden file, never
  caught by `make ci` because `featuregraph` is one of the ghosts.

The asymmetry is invisible by design: the parity contract on `make ci`
is checked by `ci-parity-check` against the enforcing GitHub workflow
matrix, and that matrix has the same gap (`ci-crates.yml` matrices the
same 7 crate names as `CI_RUST_MANIFESTS`).

**Wrong default.** `make ci` warm-cache wall time on reference
hardware is 90+ minutes; `make ci-fast` is **4m54s warm** on the same
hardware (spec 134 §SC-01 baseline at `docs/ci-fast-bench.md`). The
`/validate-and-fix` skill calls `make ci`. Every contributor pays the
90-minute cost on every routine local validation, even though the
faster target with strictly broader workspace coverage already exists.

The correct default is the fast target. The naming should make the
distinction obvious: dev loop = `make ci`; pre-merge parity check =
`make ci-strict`.

## 2. Solution

### 2.1 Workspace mode for `crates/*` in `ci-rust`

Replace the per-manifest portion of the `ci-rust` loop covering the 11
`crates/*` manifests with a single triple of workspace invocations:

```make
ci-rust:
	cargo check  --workspace --manifest-path crates/Cargo.toml
	cargo clippy --workspace --manifest-path crates/Cargo.toml -- -D warnings
	cargo test   --workspace --manifest-path crates/Cargo.toml
	cargo check  --manifest-path platform/services/deployd-api-rs/Cargo.toml
	cargo clippy --manifest-path platform/services/deployd-api-rs/Cargo.toml -- -D warnings
	cargo test   --manifest-path platform/services/deployd-api-rs/Cargo.toml
```

`deployd-api-rs` stays as a per-manifest invocation because it lives in
its own workspace (`platform/services/deployd-api-rs/Cargo.toml`), not
under `crates/Cargo.toml`.

This closes the ghost-crate gap permanently: every workspace member is
validated by `make ci-strict` (the renamed parity-bound recipe).
`CI_RUST_MANIFESTS` becomes a single-element list containing only
`platform/services/deployd-api-rs/Cargo.toml`, or is dropped entirely
in favour of explicit recipe lines.

This is the same simplification spec 134 §2.2(2) already permits for
`ci-fast`; the asymmetry between `ci` and `ci-fast` for `crates/`
coverage disappears.

### 2.2 Target rename — `ci` ↔ `ci-fast`

| Before | After | Audience |
|---|---|---|
| `make ci` (parity-bound, ≈ 90 min) | `make ci-strict` | pre-merge release verification, parity-drift investigation |
| `make ci-fast` (parallel, ≈ 5 min warm) | `make ci` | daily dev loop, pre-push routine |

The recipe bodies do not change in this rename — only their target
names. The fast recipe inherits the parity-exempt sentinel mechanism
from spec 134; the strict recipe inherits the parity contract from
spec 104.

### 2.3 `ci-parity-check` binds to `ci-strict`

The `tools/oap/ci-parity-check` binary's parity binding follows the
rename: it scans the recipe under `ci-strict:` for parity tokens
against the enforcing-workflow matrix, not `ci:`. The sentinel comments
`# BEGIN ci-fast (spec 134)` / `# END ci-fast` are **not** renamed —
they bind to a spec id and to the parity-exempt region semantically,
not to the make target name. A clarifying comment near the sentinel
notes this.

The atomic-landing invariant from spec 134 §SC-03 carries through:
the `ci-parity-check` source delta MUST land in the same commit as,
or strictly before, the Makefile target rename. A commit that renames
`ci` → `ci-strict` without the parity-check rebinding fails locally
and on CI.

### 2.4 `validate-and-fix` recommends `make ci`

`.claude/commands/validate-and-fix.md` Process section is updated:

- Primary recommendation: `make ci` (fast dev loop, ≈ 5 min warm).
- Pre-merge recommendation: `make ci-strict` (parity mirror, ≈ 90 min).

Spec 134 §FR-04 ("validate-and-fix references both targets") remains
satisfied — both are still referenced; the primacy is reversed.

### 2.5 `ci-crates.yml` workspace switch

`.github/workflows/ci-crates.yml` currently matrices the same 7 crates
as `CI_RUST_MANIFESTS` did. With workspace-mode, the matrix collapses
to a single job running `cargo check + clippy + test --workspace
--manifest-path crates/Cargo.toml`. Trigger paths broaden to `crates/**`.
The `agent-frontmatter` TS-drift gate stays as a conditional follow-up
step (`make ci-agent-frontmatter-ts`), gated on the workspace test step
having run.

This change is what makes the GitHub-side validation match the local
strict mirror: with the matrix collapsed, ghost crates can no longer
silently escape CI either.

### 2.6 Spec 134 narrative reframe

Spec 134's body refers to "`make ci`" in several places as the
parity-bound mode and "`make ci-fast`" as the fast sibling. After spec
135 lands, the names point at the opposite recipes. Spec 134 is
amended editorially in the same PR as spec 135 to use the new names.
Its **contract** does not change: the parity-exempt sentinel mechanism
applies to whichever recipe the fast logic lives under, and that recipe
is now `ci`.

### 2.7 What does NOT change

- The parity contract itself (token-equality between enforcing
  workflows and the strict recipe). Spec 104 §FR-02 stands; only the
  recipe target name changes.
- Spec 134's parity-exempt sentinel mechanism. The `# BEGIN ci-fast
  (spec 134)` / `# END ci-fast` markers stay; the recipe inside them
  is unchanged.
- `deployd-api-rs` handling. It's a separate workspace and stays as a
  per-manifest invocation in both recipes.
- Any other CI-enforcing workflow. Only `ci-crates.yml` switches to
  `--workspace`; the rest keep their current shapes.

## 3. Functional Requirements

### FR-01: `ci-rust` uses `--workspace` for `crates/Cargo.toml`

The strict `ci-rust` recipe (post-rename: under `ci-strict:` or its
sub-target) MUST invoke `cargo check + clippy + test --workspace
--manifest-path crates/Cargo.toml` exactly once each, replacing the
11-iteration loop over `crates/*` manifests. `deployd-api-rs` runs as
a separate per-manifest invocation in the same recipe.

### FR-02: `make ci-strict` exists and matches previous `make ci`

The root Makefile MUST define a phony `ci-strict` target whose body is
the previous `ci` recipe, modified only by FR-01. Running `make
ci-strict` MUST be a strict superset of the validation `make ci`
performed before this spec — the workspace switch adds the 7 ghost
crates; nothing is removed.

### FR-03: `make ci` is the previous `make ci-fast`; `ci-fast` removed

The root Makefile MUST define a phony `ci` target whose body is the
previous `ci-fast` recipe, unchanged. The `ci-fast` target name MUST
be removed in the same commit — no transitional alias is retained.
The naming distinction is the point of the rename; preserving the old
name as an alias would dilute it.

### FR-04: `ci-parity-check` binds to `ci-strict`

`tools/oap/ci-parity-check/src/lib.rs` MUST scan the `ci-strict:` recipe
(post-rename) for parity tokens against the enforcing-workflow matrix.
The sentinel-region exemption (spec 134 §FR-03) continues to apply to
the renamed `ci:` recipe (formerly `ci-fast:`).

### FR-05: `ci-crates.yml` uses `--workspace`

`.github/workflows/ci-crates.yml` MUST drop its 7-element crate matrix
and replace it with a single job invoking `cargo check + clippy + test
--workspace --manifest-path crates/Cargo.toml`. The `# Spec:` headers
at the top of the file gain `# Spec: 135-fast-ci-as-default`. The
`agent-frontmatter` TS-drift conditional step is preserved, gated on
the workspace test step having run.

### FR-05a: Hosted-runner disk headroom (amendment 2026-06-11)

Disk-heavy Rust CI jobs on GitHub-hosted runners MUST reclaim
preinstalled-toolchain disk space before their cargo invocations. Two
same-day ENOSPC data points established that the hosted-runner free
margin no longer fits a full root-workspace build profile:

- merge_group run 27355231139: the ci-crates workspace job (workspace
  debug build plus two release fixture-producer builds) failed with
  "couldn't create a temp dir: No space left on device";
- merge_group run 27371047814: the spec-conformance job (six per-tool
  release target dirs plus, at the time, an accidental full-workspace
  test build) failed with rustc LLVM "IO failure on output stream: No
  space left on device" compiling sandbox-local-container. (The
  accidental `--all` on the contract-subset invocations was dropped in
  the same amendment PR; that step's semantics are owned by the
  conformance gate's specs, not this one.)

The mechanism is a local composite action,
`.github/actions/free-disk-space/action.yml` (established by this
spec), wired into `ci-crates.yml` and `spec-conformance.yml` after
their checkout steps. It:

- is guarded with `if: runner.environment == 'github-hosted'` INSIDE
  the action, so no caller can route it onto an operator machine (the
  ci-crates `runs-on` enabler, 2026-06-10, can send merge_group jobs
  to self-hosted runners once `OAP_RUNNER_HEAVY` is set);
- is plain shell, not a third-party action: keeps the supply-chain
  surface flat (spec 116 posture) and adds no new SHA-pinned action
  ref under the spec 158 lint;
- deletes only preinstalled toolchains these jobs never use (.NET,
  Android, Haskell, CodeQL toolcache, preloaded Docker images),
  reclaiming roughly 25 GB (field-measured: 89 GB → 112 GB available
  in 82 s on the first green run);
- prints `df -h` before and after, so future margin erosion is
  visible in job logs rather than surfacing as the next ENOSPC flake.

### FR-06: `validate-and-fix` calls `make ci` as the dev-loop default

`.claude/commands/validate-and-fix.md` MUST recommend `make ci` (the
new fast default) as the primary inner-loop validation, with
`make ci-strict` mentioned for pre-merge / parity-investigation use.

### FR-07: Spec 134 editorial amendment

`specs/134-fast-local-ci-mode/spec.md` MUST be updated in the same PR
as spec 135 to use the new target names throughout its body. The
spec's contract (the parity-exempt sentinel mechanism) is unchanged;
this is a pure editorial reframe. Spec 134's `amended:` and
`amendment_record:` frontmatter are updated.

### FR-08: Spec 104 §2.2 amendment

`specs/104-makefile-ci-parity-contract/spec.md` §2.2 MUST be updated
to reflect the workspace-mode shape:
- The `ci-crates.yml` row's Makefile mirror reference becomes `ci-rust`
  via `cargo --workspace --manifest-path crates/Cargo.toml`.
- A second `> Amendment (spec 135, ...)` callout is added near the
  existing spec-134 callout.
- Spec 104's `amended:` date and `amendment_record:` field point to
  spec 135.

## 4. Success Criteria

### SC-01: Ghost-crate coverage closed

After this spec lands, all 18 `crates/Cargo.toml` workspace members
are validated by `make ci-strict` and by the `ci-crates.yml` workflow.
A regression test: introducing a clippy lint in `crates/agent/` (one
of the previously-ghosted members) MUST fail both `make ci-strict`
locally and `ci-crates.yml` on CI.

### SC-02: `make ci` wall-time matches previous `make ci-fast`

`make ci` warm-cache wall time on reference hardware (M1 Pro 10c, 64
GB) MUST equal the spec 134 §SC-01 baseline (≈ 4m54s) within
measurement noise. This is a renames-only invariant for the new `ci`
target.

### SC-03: `ci-parity-check` passes after the rename

`make ci-parity` (or its post-rename equivalent if the parity target is
also renamed) MUST exit 0 immediately after this spec's PR merges. The
parity rules in `tools/oap/ci-parity-check/src/lib.rs` are updated to scan
`ci-strict:` instead of `ci:`; the test fixtures under
`tools/oap/ci-parity-check/tests/` are updated to match.

### SC-04: `validate-and-fix` recommends the new default

`.claude/commands/validate-and-fix.md` Process section reads `make ci`
where it previously read `make ci` (now meaning the fast loop), and
mentions `make ci-strict` for the previous parity-bound use. A
contributor running `/validate-and-fix` after this spec's PR MUST
trigger the fast loop, not the slow loop.

### SC-05: Help discoverability

`make help` lists both `ci` and `ci-strict` with their wall-time
expectations and intended audience, mirroring spec 134 §SC-04.

## 5. Out of Scope

- **Sentinel rename.** The `# BEGIN ci-fast (spec 134)` / `# END
  ci-fast` markers are intentionally not renamed — they bind to a spec
  id, not the target name. A clarifying comment near the BEGIN sentinel
  is sufficient.
- **`deployd-api-rs` workspace consolidation.** That crate is in a
  separate workspace at `platform/services/deployd-api-rs/`. Merging
  it into `crates/Cargo.toml` is out of scope; it stays as a
  per-manifest invocation.
- **GitHub workflow consolidation beyond `ci-crates.yml`.** Other
  enforcing workflows (`ci-axiomregent.yml`, `ci-orchestrator.yml`,
  `ci-policy-kernel.yml`, etc.) keep their current shapes. They
  individually mirror specific crates for caching and triage; the
  workspace switch only applies where matrix-vs-workspace was the
  dominant cost.
- **Spec 133's amends-aware coupling gate.** Spec 133 is in flight on
  its own feature branch (`133-amends-aware-coupling-gate`, commit
  `4e2d165`). Resolving the broader Spec-Drift-Waiver workflow is
  133's concern, not 135's. This spec uses the existing waiver
  pattern for any incidental edits to Makefile that are not
  structurally claimed by spec 135's `implements:` list.

## 6. Clarifications

- **Why not split into two specs.** The workspace switch (§2.1) and
  the rename (§2.2) are tightly coupled: the rename's value
  (ci-fast-as-default) only fully delivers once the workspace switch
  closes the ghost-crate gap, because otherwise the strict recipe
  remains structurally weaker than the fast one. Splitting would
  ship a half-state where the new default is broader than the
  parity mirror.
- **Why not alias instead of rename.** An alias `ci → ci-fast` would
  preserve muscle memory but obscure the semantic shift the user
  asked for ("make the distinction between the two explicit"). The
  rename is deliberate — `make ci-strict` is a name a contributor
  has to type when they want the slow path, and that friction is the
  point.
- **CONST-005 check.** This amendment closes a coverage gap in spec
  104 (the parity contract was structurally weaker than its prose
  implied) and makes the developer default match the structurally
  stronger recipe. It does not retroactively justify a contradicted
  action; it strengthens the spec spine. Per
  `.claude/rules/adversarial-prompt-refusal.md`, this is the
  legitimate-amendment shape (refining a spec's design), not the
  drift-cover-up shape.
- **Atomic landing.** The four production-system edits (Makefile,
  ci-parity-check source, ci-crates.yml, validate-and-fix.md) MUST
  ship in the same PR or a tight PR sequence with explicit dependency
  ordering. A partial landing — e.g., the Makefile rename without the
  ci-parity-check rebinding — produces a broken parity contract for
  the duration of the gap.

## 7. Cross-references

- Spec 104 (`makefile-ci-parity-contract`) — amended by this spec
  (§2.2 table row, frontmatter `amended:` and `amendment_record:`).
- Spec 134 (`fast-local-ci-mode`) — the sibling target this spec
  promotes to the primary namespace; receives an editorial amendment
  in the same PR (FR-07).
- Spec 130 (`spec-coupling-primary-owner`) — primary-owner heuristic
  applied for the multi-claimant Makefile path.
- Spec 131 (`adversarial-prompt-refusal-policy`) — CONST-005
  legitimate-amendment shape (see §6 clarification).
- Spec 105 (`scripts-to-binaries-migration`) — `ci-parity-check` is
  a binary, not a script; that discipline is preserved.
- Spec 133 (`amends-aware-coupling-gate`) — in flight; will broaden
  the waiver-resolution surface but is not a precondition for spec
  135.


## Amendments received

**Amendment 2026-06-11 (record: 104 self-amendment with spec 198 FR-012).**
Spec 104 — whose parity contract this spec implements as the default `make
ci` — self-amended its `PRODUCERS` rule for `adapter-scopes-compiler`: the
artifact repoints from the retired `build/adapter-scopes.json` to the
committed statecraft snapshot, following the spec-198 FR-012 derivation
cutover. No fast-ci lane, recipe, or parity verdict changes; recorded here
because this spec is 104's current implements-owner.

**Amendment 2026-05-24 (record: 178-opc-directory-rename).**
Spec 178 (opc-directory-rename, 2026-05-24): mechanical path rename
`product/apps/desktop/*` → `product/apps/opc/*`. No semantic change
to this spec's claims; owned paths inherit the new prefix.

**Amendment 2026-06-11 (record: self, FR-05a).** Operational
hardening for hosted-runner disk margin: the local composite action
`.github/actions/free-disk-space/action.yml` (established here) is
wired into `.github/workflows/ci-crates.yml` and
`.github/workflows/spec-conformance.yml` after merge_group runs
27355231139 and 27371047814 both died ENOSPC. Guarded to
`runner.environment == 'github-hosted'` inside the action; no
validation surface changes.
