---
id: "134-fast-local-ci-mode"
title: "Fast Local CI Mode — Two-Mode Parity Contract"
status: approved
implementation: complete
owner: bart
created: "2026-05-03"
amended: "2026-05-30"
amendment_record: |
  amended by spec 135 (135-fast-ci-as-default, 2026-05-03).

  amended by spec 182 (2026-05-30) — the `ci-fast-validation` aspect
  this spec refines moved verbatim to
  `.claude/skills/validate-and-fix/SKILL.md` in the spec-182
  deprecation PR (legacy command file deleted); the `refines:` unit
  path is repointed from `.claude/commands/validate-and-fix.md`
  accordingly. No behavioral change.
kind: governance
domain: tooling
risk: low
amends:
  - "104-makefile-ci-parity-contract"
depends_on:
  - "104-makefile-ci-parity-contract"
co_authority:
  - with_specs:
      - "102-governed-excellence"
      - "104-makefile-ci-parity-contract"
      - "116-supply-chain-policy-gates"
      - "127-spec-code-coupling-gate"
      - "128-spec-lint-default-fail-on-warn"
      - "135-fast-ci-as-default"
    unit: { kind: section, file: Makefile, anchor: ci-fast }
extends:
  - spec: "104-makefile-ci-parity-contract"
    nature: additive
    unit: { kind: file, path: tools/oap/ci-parity-check/src/lib.rs }
refines:
  - aspect: "ci-fast-validation"
    unit: { kind: file, path: .claude/skills/validate-and-fix/SKILL.md }
summary: >
  Amend spec 104 to introduce a two-mode CI contract: the parity-bound
  recipe (renamed `make ci-strict` by spec 135) retains strict
  workflow→Makefile parity; the fast sibling (renamed `make ci` and
  promoted to default by spec 135) is a parity-exempt,
  performance-optimised local mirror that covers the same gate set with
  parallel/accelerated tooling. Reference target: 90+ min → ≤ 25 min warm
  on M1 Pro 10c / 64 GB (aspirational; measurement required within 7
  days of `implementation: complete`).
---

# 134 — Fast Local CI Mode

> **Amended by spec 182 (2026-05-30).** The `ci-fast-validation` aspect
> this spec refines now lives at
> `.claude/skills/validate-and-fix/SKILL.md` (migrated verbatim from the
> deleted `.claude/commands/validate-and-fix.md` by the spec-182
> deprecation PR); the `refines:` unit path is repointed accordingly.
> No behavioral change.

> Amends spec 104 (`makefile-ci-parity-contract`). The parity contract on
> the parity-bound recipe (now `make ci-strict`) is **unchanged**. This
> spec adds a sibling target (now `make ci`) with a different contract.

> **Editorial reframe (spec 135, 2026-05-03).** Spec 135 reversed the
> semantic positions of `make ci` and `make ci-fast`: the fast loop is
> now `make ci`, and the parity-bound mirror is `make ci-strict`.
> References to `make ci` / `make ci-fast` throughout this document —
> written before that rename — have been updated to use the new names.
> The spec's contract (the parity-exempt sentinel mechanism in §2.4 and
> §FR-03) is **unchanged**: it applies to whichever recipe the fast
> logic lives under, and that recipe is now `ci`. Internal Makefile
> sub-target names (`ci-rust`, `ci-tools`, `ci-fast-rust`,
> `ci-fast-tools`, …) are also unchanged — the rename was at the
> top-level entry-point only.

## 1. Problem Statement

`make ci-strict` mirrors every enforcing GitHub workflow `run:` block token-for-token
(spec 104 §FR-02). That contract correctly prevents silent CI/local drift but
precludes any optimisation whose form diverges from the workflow tokens —
`cargo nextest` instead of `cargo test`, `--workspace` mode instead of N
per-member invocations, removing the 10× redundant `registry-consumer`
contract subset loop, sharing `CARGO_TARGET_DIR` across the 11 isolated tool
manifests, `RUSTC_WRAPPER=sccache`.

On reference local hardware (MacBook Pro M1 Pro, 10 cores, 64 GB) `make ci-strict`
takes 90+ min. CI runners take ≤ 30 min because they fan out across jobs;
a single-machine local run cannot match that within the parity contract.

The result: contributors push validation onto CI rather than running it
locally. The iteration loop suffers, and CI becomes the de-facto first
feedback channel — the inversion `make ci-strict` was meant to prevent.

## 2. Solution

### 2.1 Two-Mode CI Contract

The Makefile carries two end-to-end validation targets:

| Target | Audience | Parity contract |
|---|---|---|
| `make ci-strict` | CI parity, conservative local validation | **Bound** by spec 104 §FR-02 (token-equivalent mirror of enforcing workflows). Unchanged by this spec. |
| `make ci` | Local development on capable hardware | **Exempt** from token parity. Bound by §2.3 coverage invariant. |

Spec 104's invariants on the parity-bound recipe remain in force. The
amendment adds a sibling target with a different contract.

### 2.2 What Fast Mode May Do

`make ci` MAY:

1. **Parallelise** — `make -jN`, `xargs -P`, background `&` + `wait`.
2. **Substitute commands** with verifiably equivalent or stricter tooling:
   - `cargo nextest run` for `cargo test`
   - `cargo {check,clippy,test} --workspace --manifest-path X` for N
     per-member invocations across one workspace
   - `cargo clippy --all-targets -- -D warnings` covering the surface of a
     separate `cargo check` step (clippy is a superset of check)
3. **Use transparent build accelerators:**
   - `RUSTC_WRAPPER=sccache` (auto-detected; absent → no-op)
   - Shared `CARGO_TARGET_DIR` for the otherwise-isolated tool manifests
4. **Omit verifiably-redundant invocations** whose coverage is subsumed
   elsewhere in the fast loop (`ci`), *and* whose side-channel guarantees
   (if any) are preserved by an explicit replacement. Each omission MUST
   cite both the subsuming invocation and any preserved meta-check in a
   Makefile comment.

   Known redundancy on landing: the 10× `cargo test --manifest-path
   tools/spec-spine/registry-consumer/Cargo.toml --all <prefix>_` subset loop is
   subsumed *for test execution* by the unfiltered `cargo test ...`
   immediately preceding it. The loop also provided a side-channel
   guarantee that each prefix in `CI_REGISTRY_CONSUMER_CONTRACTS` matches
   ≥1 test (a renamed test would silently disappear from the contract set
   otherwise — `cargo test <filter>` exits 0 on zero matches).
   `ci-fast-tools` MUST preserve this meta-check explicitly via a
   `cargo test -- --list` post-pass asserting each prefix has ≥1 match.

### 2.3 Coverage Invariant

`ci` (the fast loop) MUST cover the same gate set as `ci-strict` (the
parity-bound mirror). Formally:

> The set of validations performed by `ci` (fast) MUST be a superset of the
> set performed by `ci-strict`.

Practical consequences:

- If `make ci` exits 0, `make ci-strict` SHOULD also exit 0 on the same source
  state. A contradiction is a `ci` (fast-loop) bug.
- Adding a new gate to `ci-strict` (in service of a new enforcing workflow)
  MUST extend `ci` in the same change.
- Removing a gate from `ci-strict` MUST also remove it from `ci`.

The mapping between `ci-strict` gates and `ci` gates lives in §3 (FR-02).

### 2.4 ci-parity-check Coverage

`tools/oap/ci-parity-check` continues to enforce token parity on `make ci-strict`
only (spec 135 FR-04 rebinding). The Makefile MUST demarcate the fast-loop
recipe tree with sentinel comments at line start: the literal text
`# BEGIN ci-fast (spec 134)` opens the region and `# END ci-fast` closes it.
`ci-parity-check` MUST skip every line between (and including) those markers
when scanning the Makefile. The sentinel marker text is **unchanged** by
spec 135 — it binds to this spec's contract identifier (134), not to the
top-level make-target name.

The marker text MUST match exactly (after leading whitespace tolerance)
so a comment that merely *mentions* the marker text doesn't accidentally
open or close the region.

### 2.5 Documentation

`.claude/commands/validate-and-fix.md` MUST mention both targets and their
relationship: `ci` (the fast loop) is the inner-loop default; `ci-strict`
is the pre-push parity gate. `make help` MUST list both with wall-time
expectations.

## 3. Functional Requirements

### FR-01: Fast-loop target exists

The root `Makefile` MUST define a phony fast-loop target invocable
without flags. At spec 134 landing the target was named `ci-fast`;
spec 135 renamed it to `ci` (and renamed the previous `ci` to
`ci-strict`).

### FR-02: Gate coverage mapping

For each gate in `ci-strict`, the fast loop MUST realise an equivalent or
stricter gate. Initial mapping at spec landing time (sub-target names
unchanged by spec 135):

| `ci-strict` sub-target | fast-loop realisation |
|---|---|
| `ci-rust` (12 manifests, serial check + clippy + test) | `ci-fast-rust`: `cargo clippy --workspace` + `cargo nextest --workspace` (or `cargo test`) on `crates/Cargo.toml` covers 11 of 12 entries; deployd-api-rs runs as a concurrent sibling. `cargo clippy --all-targets -- -D warnings` subsumes `cargo check`. |
| `ci-tools` (8 tool crates serial; 10× registry-consumer subset loop) | `ci-fast-tools`: parallel xargs fan-out across tool manifests; shared `CARGO_TARGET_DIR`; subset loop dropped (§2.2(4)) with prefix-existence meta-check preserved. |
| `ci-desktop` | `ci-fast-desktop`: rust phase concurrent with `pnpm install`; `tsc` and `vitest` concurrent. |
| `ci-statecraft` | `ci-fast-statecraft`: `tsc` and `vitest` concurrent after `npm ci`. |
| `ci-schema-parity` | `ci-fast-schema-parity`: same — already short. |
| `ci-spec-code-coupling` | `ci-fast-spec-coupling`: same — already short. |
| `ci-supply-chain` | `ci-fast-supply-chain`: parallel xargs for cargo-deny; pnpm/npm audit in background. |

### FR-03: Sentinel-bracketed parity exemption

`tools/oap/ci-parity-check/src/lib.rs` MUST treat the Makefile region between
`# BEGIN ci-fast (spec 134)` and `# END ci-fast` as opaque: no token from
that region is required to mirror a workflow `run:` block, and no token from
that region counts toward parity matches elsewhere.

### FR-04: validate-and-fix references both targets

`.claude/commands/validate-and-fix.md` MUST recommend the fast loop as the
primary inner-loop validation and the parity-bound mirror as the pre-push
parity gate. Post spec 135, that resolves to `make ci` (primary) and
`make ci-strict` (parity gate); spec 135 FR-06 owns the doc edit.

### FR-05: New gates extend both modes

When a new enforcing workflow is added under `.github/workflows/`, the spec
104 process (add to `ENFORCING_WORKFLOWS`, add a `ci-*` sub-target, add a row
to spec 104 §2.2) MUST also add a row to FR-02 above and a `ci-fast-*`
realisation in the Makefile.

## 4. Success Criteria

### SC-01: Wall-time target (aspirational)

`make ci` (the fast loop) warm-cache wall time on reference hardware
(MacBook Pro M1 Pro, 10 cores, 64 GB RAM) SHOULD be ≤ 25 minutes;
cold-cache SHOULD be ≤ 50 minutes. These are design targets, not
pass/fail gates — empirical baselines do not yet exist.

A measurement commit at `docs/ci-fast-bench.md` MUST land within 7 days of
this spec being marked `implementation: complete`, capturing the measured
warm/cold times on a clean reference workstation. If measurements diverge
materially from the SHOULD targets above, the targets are revised by a
follow-up spec amendment — not silently absorbed.

### SC-02: Coverage parity

Running `make ci` (fast) and `make ci-strict` (parity-bound) on the same
source state MUST produce the same pass/fail outcome. A contradiction is
a fast-loop bug.

### SC-03: parity-check unaffected

`make ci-parity` continues to pass after this spec lands. The sentinel
exemption is the only change to `ci-parity-check`; lines outside the
sentinels remain bound by spec 104.

**Atomic landing invariant.** The `tools/oap/ci-parity-check` delta (sentinel
skip) MUST land in the same commit as — or strictly before — the Makefile
sentinel-bracketed region. A commit that adds the bracketed Makefile region
without the parity-check support fails `make ci-parity` locally and on CI.
This is a hard PR-internal ordering requirement; CI cannot enforce it
because both files are in the same PR.

### SC-04: Help discoverability

`make help` lists both fast and parity-bound entry points with wall-time
expectations and intended audience. Post spec 135 those names are `ci`
and `ci-strict`.

## 5. Out of Scope (MVP)

- **Automated cross-check (SC-02 enforcement).** A periodic CI job that
  runs both modes to verify the fast loop catches what the parity-bound
  mirror catches is a follow-up.
- **Cross-platform fast mode.** The fast loop is tuned for Apple Silicon
  local dev. Linux/Windows tuning is a separate spec.
- **Build accelerator distribution.** `sccache`, `cargo-nextest` are
  auto-detected at runtime; this spec does not mandate installation.
- **Fast-loop participation in the ci-parity workflow.** No CI job runs
  the fast loop directly.

## 6. Clarifications

- The amendment scope is narrow: spec 104's parity contract on the
  parity-bound recipe (now `ci-strict`) is unchanged. The fast loop
  (now `ci`) is a sibling target with a different contract.
- "Coverage" means gate set, not implementation. `cargo nextest` instead
  of `cargo test` is still covered as long as the test set is the same.
- The sentinel mechanism is a Makefile-level convention; only
  ci-parity-check parses it.

## 7. Cross-references

- Spec 104 (`makefile-ci-parity-contract`) — amended by this spec.
- Spec 105 (`scripts-to-binaries-migration`) — the fast loop keeps the
  binaries-not-scripts discipline.
- Spec 127 (`spec-code-coupling-gate`) — `ci-fast-spec-coupling` mirrors
  the local equivalent.
- Spec 131 (`adversarial-prompt-refusal-policy`).
- Spec 135 (`fast-ci-as-default`) — editorial reframe (FR-07) reversing
  the semantic positions of `make ci` and `make ci-fast`. This document
  has been amended in place; the contract is unchanged.


## Amendments received

**Amendment 2026-05-24 (record: 178-opc-directory-rename).**
Spec 178 (opc-directory-rename, 2026-05-24): mechanical path rename
`product/apps/desktop/*` → `product/apps/opc/*`. No semantic change
to this spec's claims; owned paths inherit the new prefix.
