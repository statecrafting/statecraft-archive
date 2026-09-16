---
id: "128-spec-lint-default-fail-on-warn"
slug: spec-lint-default-fail-on-warn
title: "spec-lint default to fail-on-warn — repo opts into the strict posture"
status: approved
implementation: complete
amends: ["006-conformance-lint-mvp"]
owner: bart
created: "2026-05-02"
approved: "2026-05-02"
amended: "2026-06-18"
amendment_record: |
  amended 2026-05-13 by 147-spec-kind-grammar.
  amended 2026-06-18 by spec 217 (engine-swap collapse): the Makefile `spec-lint`
  invocation this spec governs (the strict --fail-on-warn posture) was repointed
  from the deleted in-tree generic spec-lint to the surviving OAP overlay spec-lint
  binary plus `spec-spine lint` (generic codes). The strict-posture policy is
  unchanged; only the invoked binary moved.
kind: governance
domain: tooling
risk: low
depends_on:
  - "006-conformance-lint-mvp"  # conformance-lint-mvp (the surface being amended)
  - "104-makefile-ci-parity-contract"  # makefile-ci-parity-contract (the integration point)
code_aliases: ["SPEC_LINT_STRICT"]
co_authority:
  - with_specs:
      - "102-governed-excellence"
      - "104-makefile-ci-parity-contract"
      - "116-supply-chain-policy-gates"
      - "127-spec-code-coupling-gate"
      - "134-fast-local-ci-mode"
      - "135-fast-ci-as-default"
    unit: { kind: section, file: Makefile, anchor: spec-lint }
summary: >
  Spec 006 defines `spec-lint` as advisory by default with an opt-in
  `--fail-on-warn` flag for repos that choose the strict posture. This
  spec ratifies OAP's policy choice: the strict posture is on. `make ci`
  now invokes spec-lint with `--fail-on-warn` and propagates non-zero exit
  codes (the previous `|| true` is dropped). Behaviour-preserving for the
  current corpus — zero W-codes fire against the 128-spec corpus as of
  the 2026-05-02 audit — but closes the silent-drift channel for future
  changes.
---

# 128 — spec-lint default to fail-on-warn

## 1. Problem Statement

Spec 006 §"Purpose and charter" defines two postures for `spec-lint`:

> - **CLI** that prints warnings to **stderr** and exits **0** by default …
> - **Optional** `--fail-on-warn` (or equivalent) for **strict** CI

…and §"Normative dependency" closes with:

> 006 warnings are **advisory** unless a repo policy opts into
> `--fail-on-warn`.

OAP's `make ci` does NOT currently opt in:

```makefile
./tools/spec-spine/spec-lint/target/release/spec-lint || true   # warnings non-blocking (matches CI)
```

The `|| true` swallows any future warnings into `make ci`'s green log.
A contributor could land a `W-002` (superseded spec missing replacement
pointer) or `W-005` (mixed task notation) without CI noticing.

This spec is the policy choice that spec 006 line 46 anticipated.

## 2. Decision

**OAP opts into `--fail-on-warn`.** No CLI default is changed; spec-lint
itself remains advisory by design. The amendment is purely the
operational integration in `make ci`.

This is the amendment-style change the spec-spine bootstrap (spec 000)
designed for: refining narrative without superseding. The `amends:
["006"]` frontmatter records the link; spec 006 carries
`amended: 2026-05-02` and `amendment_record:
"128-spec-lint-default-fail-on-warn"` plus an in-body callout.

## 3. Scope

### In scope

- Drop `|| true` from `make ci-tools`'s spec-lint line.
- Add `--fail-on-warn` to that invocation.
- Update spec 006 with the amendment frontmatter and in-body callout.
- Inventory spec-lint warnings before the flip and document the
  baseline in `/tmp/spec_lint_inventory.md` (saved as a session artefact,
  not a checked-in file).

### Out of scope

- Adding new W-codes — that's a follow-on to spec 006.
- Changing the CLI default (`spec-lint` without flags still exits 0) —
  this is a per-repo policy choice and other consumers may differ.
- Changing the test surface of `spec-lint` itself.

## 4. Inventory baseline (2026-05-02)

Pre-flip inventory:

```
$ ./tools/spec-spine/spec-lint/target/release/spec-lint
$ echo $?
0
```

Zero W-codes fire across all 128 specs. Below the Unit 3 inventory
thresholds (>20 total or any single spec >3) that would have routed the
flip to a separate hygiene-sweep PR. The amendment is purely mechanical.

If a future amendment to spec 006 adds new heuristics that increase the
fire rate, the policy choice can be reconsidered via another amendment.

## 5. Functional Requirements

- **FR-001 — make ci is strict.** `make ci-tools` invokes
  `spec-lint --fail-on-warn`, no `|| true`.
- **FR-002 — CLI default unchanged.** Running `spec-lint` without flags
  still exits 0 on warnings. Other consumers (a future docs build, a
  pre-commit hook) opt in or out independently.
- **FR-003 — amendment annotation.** Spec 006 carries
  `amended: 2026-05-02` and `amendment_record:
  "128-spec-lint-default-fail-on-warn"` plus a brief in-body callout
  pointing at this spec.

## 6. Acceptance

- **AC-1.** `make ci-tools` invocation contains `--fail-on-warn` and no
  `|| true` on the spec-lint line.
- **AC-2.** `make ci` exits 0 (current corpus is clean).
- **AC-3.** Spec 006 frontmatter includes the amendment annotation.
- **AC-4.** A synthetic test that introduces a `W-002` violation
  (superseded spec without replacement pointer) is rejected by
  `make ci-tools` post-flip. Verified manually during landing; not
  encoded as a permanent test fixture (would require a fixture spec
  that never compiles cleanly).

## 7. Amendment 147 — Severity tiers *(amended by spec 147, 2026-05-13)*

Spec 147 (spec-kind grammar) introduces new W-codes whose semantics
are advisory rather than contract-violating: surfacing orphan
declarations, novel-but-permitted vocabulary, and similar
observations. The empty-W-set posture this spec ratified
(2026-05-02 audit) was earned by W-codes that all represented
contract violations. Adding advisory W-codes into the same gate
would force the audit posture to defend "zero advisories" rather
than "zero contract violations", which is not what fail-on-warn is
for.

This amendment introduces an **info** severity tier for spec-lint
W-codes. The fail-on-warn gate retains its meaning at the warning
tier; info-tier diagnostics emit alongside but do not gate CI.

### 7.1 Severity tiers

Spec-lint diagnostics carry a severity at registration time. Two
tiers are recognized:

- **warning** — actionable, fail-on-warn-gated. Default for
  W-codes. A warning indicates a contract violation that should
  block CI under the strict posture this spec establishes. The
  empty-W-set audit posture (2026-05-02) applies to this tier and
  this tier only.
- **info** — informational diagnostic. NOT subject to
  `--fail-on-warn`. Used for surfacing facts that are not contract
  violations — orphan declarations, novel-but-permitted vocabulary,
  advisory observations. Info diagnostics emit to the standard
  diagnostic stream but never cause non-zero exit under
  `--fail-on-warn`.

A new flag `--fail-on-info` is reserved for strict-mode runs that
wish to gate on informational diagnostics. It is off by default.
The schema-version gate, build pipeline, and `make ci` invocation
are unchanged — they continue to use `--fail-on-warn` (the
empty-W-set posture established by §2).

Severity is declared at the W-code registration site in
`tools/spec-spine/spec-lint/src/lib.rs`. This is a registration-site
declaration, not a per-W-code exemption list — the severity is
intrinsic to the code, not added later by configuration. A future
amendment that needs to flip a W-code between tiers must do so by
amending its registration, not by adjusting a configuration file.

### 7.2 Audit-posture continuity

The empty-W-set posture (2026-05-02 audit) is preserved for the
**warning** tier. The 2026-05-02 audit did not include info-tier
diagnostics because the tier did not exist; subsequent audits
SHOULD report warning-tier zero-firing and info-tier observation
counts separately. Spec 128 does NOT extend the empty-set audit
posture to the info tier.

### 7.3 W-codes introduced by spec 147

Spec 147 registers three new W-codes with severity per §7.1:

- **W-130** (`category:` value unconventional) — info.
- **W-131** (`shape:` value not in declared (kind, shape) table) — warning.
- **W-132** (capability declares `selectable_by:` but is orphan) — info.

Spec 147's §Lint changes is the authoritative source for these
declarations; this section records the integration with the
fail-on-warn gate this spec governs.

### 7.4 Acceptance criteria (additive)

- **AC-5.** Spec-lint exposes a `severity` field at W-code
  registration; values `warning` and `info`.
- **AC-6.** `--fail-on-warn` exits non-zero on any warning-tier
  diagnostic; passes on info-tier diagnostics regardless of count.
- **AC-7.** `--fail-on-info` reserved flag introduced; off by
  default. No CI invocation uses it.
