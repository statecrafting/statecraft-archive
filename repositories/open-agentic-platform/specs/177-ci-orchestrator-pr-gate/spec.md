---
id: "177-ci-orchestrator-pr-gate"
slug: ci-orchestrator-pr-gate
title: "CI orchestrator — collapse PR-gate workflow fleet behind a single ci-gate"
status: approved
implementation: complete
owner: bart
created: "2026-05-24"
approved: "2026-05-24"
completed: "2026-05-24"
kind: governance
domain: tooling
risk: medium
depends_on:
  - "104-makefile-ci-parity-contract"  # makefile-ci-parity-contract — Makefile/CI run-block mirror
  - "116-supply-chain-policy-gates"  # supply-chain-policy-gates — cron-driven advisory refresh preserved
  - "118-workflow-spec-traceability"  # workflow-spec-traceability — `# Spec:` headers on the new orchestrator
  - "127-spec-code-coupling-gate"  # spec-code-coupling-gate — constitutional always-on contract
  - "135-fast-ci-as-default"  # fast-ci-as-default — daily-loop / parity-mirror split unchanged
  - "152-path-co-authority"  # path-co-authority — empty-authority bypass for `.github/workflows/`
  - "158-workflow-ref-sha-pinning-lint"  # workflow-ref-sha-pinning-lint — `uses:` ref pin contract
code_aliases: ["CI_GATE"]
amended: "2026-05-31"
amendment_record: |
  self-amended (2026-05-31) — the AI PR review (`ai-pr-review.yml`, spec 085)
  is folded into the orchestrated gate. It was a standalone `pull_request`
  workflow that was green-but-dead on every PR back to ~#220 (an empty
  `ANTHROPIC_API_KEY` won by precedence over the subscription OAuth token and
  the failure was swallowed by `|| echo`), so a non-gating "review" gave
  false assurance. It is now a reusable (`workflow_call`) workflow dispatched
  from `ci.yml` as the PR-only `ai-review` job and added to the terminal
  `ci-gate` `needs:`, so a failed review blocks merge. A green ci-gate means
  the AI review ran and passed OR — for a diff over `DIFF_SIZE_CAP` — was
  skipped with a visible "manual review required" PR comment (the size cap
  is a documented escape hatch, not a silent bypass; the folded gate caught
  this hole on its own PR #267 and the skip path was made visible). PR-only
  (it needs PR context, like
  spec-code-coupling); skipped on push/merge_group, which ci-gate treats as
  success. Job-level `pull-requests: write` (overriding ci.yml's read
  default for this job) + `secrets: inherit` give the called workflow the
  token scope to post its comment. It is parity-EXEMPT (spec 104): an AI
  review has no `make ci-strict` mirror — the first gate without a local
  mirror, a carve-out documented in spec 104.

  amended by spec 188 (2026-05-30, Phase 3) — the constitutional always-on
  PR set (§2.2) swaps `ci-codebase-index.yml` for `ci-config-hash.yml`. The
  broad index-staleness gate was retired as a per-PR check: the broad
  committed `index.json` became a best-effort cache, and PRs no longer
  carry a fresh broad `index.json`. (A direct-push post-merge heal was
  specified then retired as incompatible with `main`'s PR-required +
  signed-commits protection; the report-only `cd-index-staleness-report.yml`
  surfaces drift instead — spec 188 FR-007.) The narrow `ci-config-hash`
  gate (spec 101 FR-12, spec 184)
  replaces it in the constitutional set — it blocks an unacknowledged
  `.claude/settings.json` / `.mcp.json` edit but depends only on those two
  files, so it is merge-queue-safe. Spec 188 Phase 2 (same branch) adds the
  `merge_group:` trigger to `ci.yml` and forces the full routed suite on the
  speculative merged tree (FR-001); *requiring* `ci-gate` on `merge_group`
  is the remaining ops step (branch protection), deliberately left to an
  admin so FR-006's "Phase 2 strictly after Phase 3" holds as an ops
  ordering.
amends:
  # The ci-gate fold (2026-05-31 self-amendment) amends spec 104's parity
  # contract: it introduces the first enforcing-but-parity-exempt gate
  # (`ai-pr-review.yml` blocks merge via ci-gate yet has no `make ci-strict`
  # mirror). This edge is the coupling authority for the 104 spec.md edit
  # this change carries (104's "not enforcing"/exempt prose is corrected).
  - "104-makefile-ci-parity-contract"
establishes:
  - unit: { kind: file, path: .github/workflows/ci.yml }
references:
  # Folded into the gate 2026-05-31 (self-amendment above): dispatched from
  # ci.yml as the PR-only `ai-review` job and required via ci-gate.
  - role: trigger-consolidation
    unit: { kind: file, path: .github/workflows/ai-pr-review.yml }
  - role: trigger-consolidation
    unit: { kind: file, path: .github/workflows/ci-axiomregent.yml }
  - role: trigger-consolidation
    unit: { kind: file, path: .github/workflows/ci-config-hash.yml }
  - role: trigger-consolidation
    unit: { kind: file, path: .github/workflows/ci-crates.yml }
  - role: trigger-consolidation
    unit: { kind: file, path: .github/workflows/ci-deployd-api-rs.yml }
  - role: trigger-consolidation
    unit: { kind: file, path: .github/workflows/ci-desktop.yml }
  - role: trigger-consolidation
    unit: { kind: file, path: .github/workflows/ci-featuregraph-golden.yml }
  - role: trigger-consolidation
    unit: { kind: file, path: .github/workflows/ci-orchestrator.yml }
  - role: trigger-consolidation
    unit: { kind: file, path: .github/workflows/ci-parity.yml }
  - role: trigger-consolidation
    unit: { kind: file, path: .github/workflows/ci-policy-kernel.yml }
  - role: trigger-consolidation
    unit: { kind: file, path: .github/workflows/ci-spec-code-coupling.yml }
  - role: trigger-consolidation
    unit: { kind: file, path: .github/workflows/ci-statecraft.yml }
  - role: trigger-consolidation
    unit: { kind: file, path: .github/workflows/ci-supply-chain.yml }
  - role: trigger-consolidation
    unit: { kind: file, path: .github/workflows/ci-tenant-hello.yml }
  - role: trigger-consolidation
    unit: { kind: file, path: .github/workflows/spec-conformance.yml }
summary: >
  Replace the 14-workflow PR-gate fleet's implicit merge contract — "whatever
  workflows happen to fire on `pull_request` plus whatever the branch-
  protection UI lists" — with one declared, hashable orchestrator at
  `.github/workflows/ci.yml`. Each existing `ci-*.yml` and
  `spec-conformance.yml` is converted to `workflow_call:` (preserving
  `workflow_dispatch:` and the supply-chain `schedule:` cron). The
  orchestrator runs a `dorny/paths-filter` job, dispatches each reusable
  workflow conditionally on its file-paths surface, and ends in a single
  `ci-gate` aggregator. Constitutional gates — `spec-conformance`,
  `ci-spec-code-coupling`, `ci-supply-chain`, `ci-codebase-index` — run
  unconditionally regardless of path-filter outputs. Branch protection's
  required-check surface shrinks from "fourteen names + whatever's in the
  UI" to one: `ci-gate`.
---

# 177 — CI orchestrator (PR-gate consolidation)

## 1. Problem Statement

Before this spec, OAP's merge contract was distributed across 14 separate
`.github/workflows/*.yml` files plus the branch-protection page in the
GitHub UI. The set of required PR checks could not be answered without
opening that UI, and the relationship between "which workflows must pass"
and "what `pull_request:` triggers exist in this directory" was implicit.

Two specific failure modes:

1. **No single required check.** GitHub Actions' `needs:` is intra-workflow
   only. With 14 separate PR-gate workflows, no job could `needs:` across
   them. Branch protection had to enumerate each one by name. Adding or
   removing a CI workflow required a UI edit that was not captured in git.

2. **Path-filter skips look identical to pass.** Each workflow has its
   own `pull_request: paths:` filter. When a filter doesn't match, GitHub
   reports the workflow as "skipped" — which counts as a pass for branch
   protection. The set of *actually-required* checks therefore varies per
   PR in ways neither the author nor the reviewer can predict from the
   diff alone.

This spec collapses both gaps to a single orchestrator file. The merge
contract is now `.github/workflows/ci.yml`, hash-verifiable, traceable,
and edited via the same review path as any other change.

## 2. Design

### 2.1 Topology

One orchestrator + N reusable workflows. The orchestrator is the only
workflow registered as a required check; everything else is reachable
only via `workflow_call:` (or manual `workflow_dispatch:`).

```
pull_request → ci.yml ─┬─ changes (paths-filter)
                       ├─ ci-axiomregent     (if changes.axiomregent)
                       ├─ ci-config-hash     (always)   ← spec 188 P3 (was ci-codebase-index)
                       ├─ ci-crates          (if changes.crates)
                       ├─ ci-deployd-api-rs  (if changes.deployd_api_rs)
                       ├─ ci-desktop         (if changes.desktop)
                       ├─ ci-featuregraph    (if changes.featuregraph)
                       ├─ ci-orchestrator    (if changes.orchestrator)
                       ├─ ci-parity          (if changes.parity)
                       ├─ ci-policy-kernel   (if changes.policy_kernel)
                       ├─ ci-spec-coupling   (always)
                       ├─ ci-statecraft      (if changes.statecraft)
                       ├─ ci-supply-chain    (always)
                       ├─ ci-tenant-hello    (if changes.tenant_hello)
                       ├─ spec-conformance   (always)
                       └─ ci-gate  ← required check
```

### 2.2 Constitutional carve-out (always-on)

Four workflows run on every PR regardless of paths-filter output:

| Workflow                  | Constitutional anchor |
|---------------------------|-----------------------|
| `spec-conformance.yml`    | Spec 000 / 006 — every PR validates emitted JSON against schemas. |
| `ci-spec-code-coupling.yml` | Spec 127 — every diff path's authority spec must be edited (or waived). |
| `ci-supply-chain.yml`     | Spec 116 — blocking-from-day-0 supply-chain posture. |
| `ci-config-hash.yml`      | Spec 184 / 188 Phase 3 — narrow `check-config` gate: a `.claude/settings.json` / `.mcp.json` edit cannot merge unacknowledged. (Replaced `ci-codebase-index.yml`; the broad staleness check is no longer a PR gate — the broad index is a best-effort cache surfaced post-merge by `cd-index-staleness-report.yml`.) |

Belt and braces: these are also independently SHA-bound through their
own `# Spec:` headers and the spec-coupling gate's authority graph.
Conditionally skipping them on a path-filter narrow miss would weaken
the very invariants they exist to defend.

### 2.3 Trigger normalisation

Each reusable workflow ends up with:

```yaml
on:
  workflow_call:
  workflow_dispatch:
```

`ci-supply-chain.yml` additionally keeps its `schedule: cron: '0 12 * * 1'`
trigger so the weekly advisory-db pull survives independent of PR
activity (spec 116 §9). No workflow keeps a top-level `pull_request:`
trigger — that surface is owned solely by the orchestrator.

### 2.4 The `ci-gate` aggregator

The orchestrator's final job uses `if: always()` and `needs: [<every prior job>]`,
then reads `toJSON(needs)` and asserts no job result is `failure` or
`cancelled`. `skipped` (path-filter said don't run) is treated as
success — that's the entire point of conditional dispatch. The aggregator
prints the full `needs` map before evaluating so a failure's blame is
visible in the run log.

### 2.5 Third-party action pinning (spec 158)

The orchestrator references one new third-party action:
`dorny/paths-filter`. Pinned to a 40-hex SHA per spec 158; local
`./.github/workflows/*.yml` and `./.github/actions/*` refs remain
exempt from the lint (workflow-pins.sh §classify).

## 3. Functional Requirements

- **FR-001** — `.github/workflows/ci.yml` exists and triggers on
  `pull_request` (any branch into `main`), `push: branches: [main]`, and
  `merge_group` (spec 188 Phase 2 — the GitHub merge queue tests each PR
  against the speculative merged tree). On `merge_group` the paths-filter
  step is skipped (a merge group has no PR base) and every routed job's
  gate falls back to `true`, so the full suite runs on the speculative
  tree; `ci-gate` remains the single required check.
- **FR-002** — Every existing PR-gate workflow listed in §references is
  callable via `workflow_call:` and retains `workflow_dispatch:`. No
  retained `push:` or `pull_request:` trigger.
- **FR-003** — `ci-supply-chain.yml` retains its `schedule:` trigger
  alongside `workflow_call:` and `workflow_dispatch:`.
- **FR-004** — `ci.yml` ends in a `ci-gate` job that, when run with any
  upstream `failure` or `cancelled` result, exits non-zero and surfaces
  the failing job names in the log.
- **FR-005** — Constitutional workflows (§2.2) are dispatched from `ci.yml`
  without a path-filter `if:` guard.
  > **Amended 2026-05-31:** the AI PR review (`ai-pr-review.yml`, spec 085)
  > joins the gate as the PR-only `ai-review` job — made reusable
  > (`workflow_call`, per FR-002), dispatched from `ci.yml`, and required via
  > `ci-gate.needs` — so a failed review blocks merge. A green ci-gate means
  > the review ran and passed OR (diff over `DIFF_SIZE_CAP`) was skipped with
  > a visible "manual review required" PR comment — a documented escape
  > hatch, not a silent bypass. It carries `if: github.event_name ==
  > 'pull_request'` (it needs PR context, like `spec-code-coupling`, and is
  > skipped — i.e. success — on push/merge_group) plus a job-level
  > `pull-requests: write` (overriding ci.yml's read default for this job)
  > and `secrets: inherit`. Parity-exempt (spec 104): unlike every other
  > gate, an AI review has no `make ci-strict` mirror — the first
  > gate-without-a-local-mirror, documented there.
- **FR-006** — All third-party action `uses:` refs in `ci.yml` are
  40-hex SHA-pinned per spec 158.

## 4. Acceptance Criteria

- **AC-1** — `make pr-prep` is green on the consolidating PR.
- **AC-2** — `cargo test --manifest-path tools/oap/ci-parity-check/Cargo.toml`
  passes. The parity check's `ENFORCING_WORKFLOWS` list reads
  `jobs.<name>.steps[*].run` — converting the workflows' triggers does
  not touch jobs/steps, so parity coverage is preserved by construction.
- **AC-3** — `tools/lint/workflow-pins.sh` exits 0 across
  `.github/workflows/**` after the conversion.
- **AC-4** — On a PR touching only `specs/**`: `spec-conformance`,
  `ci-spec-code-coupling`, `ci-supply-chain`, `ci-config-hash`, and
  `ci-featuregraph-golden` jobs run; the rest skip; `ci-gate` is green.
  (Spec 188 Phase 3: `ci-config-hash` replaced `ci-codebase-index` in the
  always-on set.)
- **AC-5** — On a PR touching only `crates/policy-kernel/**`: at minimum
  `ci-policy-kernel`, `ci-crates`, `ci-config-hash`, `ci-spec-code-coupling`,
  `ci-supply-chain`, `spec-conformance` run; unrelated workflows skip;
  `ci-gate` is green.
- **AC-6** — Branch protection on `main` requires exactly one check:
  `ci-gate`. (Manual configuration step — see §7.)

## 5. Out of Scope

- CD workflows (`cd-*.yml`), release workflows (`release-*.yml`,
  `build-axiomregent.yml`), and AI ancillary workflows (`ai-*.yml`)
  are not PR gates and remain untouched. Their existing triggers
  (`push: tags:`, manual dispatch, repository events) are correct
  for their purpose.

## 6. Migration

One PR carries the conversion. Steps:

1. Convert each reusable workflow's `on:` block.
2. Add `# Spec: 177-ci-orchestrator-pr-gate` to each converted file's
   header (spec 118 traceability).
3. Land `ci.yml`.
4. Recompile `.derived/codebase-index/index.json`.
5. Update branch protection (manual; see §7).

Rollback is reversion: re-add `pull_request:` and `push:` triggers to
the underlying workflows, delete `ci.yml`, restore branch-protection
required-check list. Git history makes both atomic.

## 7. Operator note — branch protection

Required-check list before this spec:

```
ci-axiomregent / check + clippy + test
ci-codebase-index / staleness
ci-crates / cargo --workspace
…  (≈ 14 entries)
```

After this spec, the required-check list reduces to:

```
ci-gate
```

The orchestrator's `ci.yml` is the merge contract. The branch-protection
page becomes a one-line declaration that ci-gate must pass.

## 8. Why this fits OAP's posture

The recurring OAP move is: take a piece of implicit configuration that
governs system behavior and convert it into a declared, hashable
artifact under spec authority. Cut D collapsed seven spec-spine tools'
overlapping invariants into typed registry-consumer subcommands; spec
160 absorbed loose adapter-manifest files into the statecraft substrate;
spec 152 codified empty-authority patterns that previously lived in a
bypass text file. This spec is the same move applied to the merge
contract itself: pull governance out of the GitHub UI and into a file
that lives under the same review discipline as every other
authority-bearing artifact in the tree.

## Amendment — 2026-06-10: push-trim, config-hash fold, ai-review verifier mode

Three changes to `ci.yml` and the gate suite; prose above describes the
pre-amendment state where it conflicts.

1. **Push-to-main trim.** §2's "the other always-on workflows run for
   push-to-main too" no longer holds for the path-routed heavy jobs
   (axiomregent, crates, deployd-api-rs, desktop, featuregraph-golden,
   orchestrator, policy-kernel, schema-parity, statecraft,
   tenant-hello): they skip on `push`. Rationale: branch protection
   requires the merge queue, so every push-to-main commit is
   tree-identical to the merge_group candidate that just passed the
   full suite — the post-merge re-validation was a third full payment
   per PR (~13 min of runner time) for zero new information. Still
   running on push: opc-bench (saves the main baseline that
   workflow_dispatch diagnostics consume), parity, spec-conformance
   (now carrying check-config), and supply-chain. `workflow_dispatch`
   still runs everything; cd-*.yml and build-axiomregent.yml are
   separate files and unaffected.
2. **config-hash job folded.** The `config-hash` job and its
   `needs:` entry in `ci-gate` are removed; the check-config gate
   lives in spec-conformance.yml (see spec 188's 2026-06-10
   amendment). The §2.2 constitutional set is unchanged in coverage,
   smaller by one runner spin-up.
3. **ai-review verifier mode.** The "green ci-gate ⇒ actually
   reviewed" claim is re-scoped to "reviewed locally with adversarial
   verification (a `Local-Review-Evidence:` comment bound to the head
   SHA and diff sha256, posted by /ship from /code-review v2), OR
   scanned by the CI review, OR visibly-skipped-as-oversized". The
   verifier-mode binding means evidence for any other head or diff
   falls back to a full scan — the verifier does not trust the
   producer (spec 102 FR-007 posture).

## Amendment (2026-06-23): ai-review API-failure resilience

A Claude API outage (the 2026-06-23 "elevated error rate" incident,
14:19-14:53 UTC) made `ai-pr-review.yml`'s `claude -p` call exit non-zero,
which under the 2026-05-31 fold turned `ci-gate` red and blocked merges on
any PR whose diff was scanned during the window. A third-party API incident
must not gate this repo's merges.

The "Run AI Review" step now classifies a claude failure instead of failing
blindly:

- **Secret unset** (the pre-existing explicit check) still hard-fails: a
  missing `CLAUDE_CODE_OAUTH_TOKEN` is a config error, not an outage.
- **Auth / permission failure** (`authentication_error`, `permission_error`,
  401/403, invalid or expired token) still hard-fails. A broken token must
  be fixed, not masked; this preserves the anti-silent-green guard the
  2026-05-31 fold installed against the ~#220 "green-but-dead" review.
- **Any other claude failure** (`overloaded_error`, `rate_limit_error`, 5xx,
  timeout, network, or unclassified) is treated as a transient API outage:
  the step emits a loud `::warning::` and posts a PR comment stating the
  review could not run and why, then **passes** so the incident does not
  block merges.

The ci-gate claim gains a fourth disjunct. Green `ci-gate` now means:
reviewed locally with adversarial verification, OR scanned by the CI review,
OR visibly-skipped-as-oversized, OR **visibly-passed-because-the-Claude-API-
failed** (with a PR comment recording the failure). The pass is loud, never
silent, exactly as with the oversized-diff escape hatch: a human still sees
the review did not run. Re-running the job after the API recovers, or
attaching `Local-Review-Evidence`, restores a real review.
