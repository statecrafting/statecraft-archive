---
id: "009-repo-ci-orchestrator"
title: "Repo CI orchestrator: ci.yml routing, dependabot, CODEOWNERS, PR template"
status: approved
created: "2026-06-10"
owner: bart
kind: governance
domain: ci-cd
risk: low
implementation: complete
depends_on: ["000-bootstrap", "010-supply-chain-gates", "012-enterprise-actions-governance"]
code_aliases: ["CI_ORCHESTRATOR"]
summary: >
  The root CI orchestrator: ci.yml computes change routes with inline git
  diff (no third-party filter action), always runs the constitutional gates
  (the spec-spine governance workflow and supply-chain), dispatches routed
  gates (Encore CI, AI review), and aggregates everything behind the
  terminal ci-gate job that branch protection requires. Dependabot covers
  npm and github-actions ecosystems; CODEOWNERS and the PR template route
  review.
establishes:
  - ".github/workflows/ci.yml"
  - ".github/dependabot.yml"
  - ".github/CODEOWNERS"
  - ".github/pull_request_template.md"
---

# 009 — Repo CI orchestrator

## 1. Purpose

`ci.yml` is the root orchestrator that collapses all CI gates into a
single terminal `ci-gate` job that branch protection points at. Without a
central orchestrator, every governance workflow would need its own
required-check entry in branch protection — fragile and expensive to
maintain. The orchestrator solves this by routing change-filtered jobs
via inline `git diff` (no third-party filter action, see spec 012) and
making constitutional always-on gates unconditional, then aggregating all
results behind the single `ci-gate` check.

This spec also owns the supporting GitHub metadata:
`dependabot.yml`, `CODEOWNERS`, and `pull_request_template.md`.

## 2. Territory

`ci.yml` is the top-level entry point for every PR and push-to-main
event. It owns the job topology: which workflows fire, under what
conditions, and how failures propagate. It does not own the workflows it
dispatches — those are owned by their respective specs (spec 007 for
Encore CI, spec 010 for supply-chain, spec 013 for AI review).

`dependabot.yml` owns the automated dependency-bump cadence for the two
ecosystems this repo actually uses: `npm` and `github-actions`. No other
ecosystems are present.

`CODEOWNERS` routes review requests by path. The PR template enforces
spec-alignment and a pre-merge checklist on every PR.

## 3. Behavior

### 3.1 Pipeline shape

```
pull_request (any branch → main)  OR  push: main
OR  merge_group  OR  workflow_dispatch
       │
       ├──▶ changes (inline git diff)
       │      outputs: encore, ai-review (booleans)
       │
       ├──▶ spec-spine     (constitutional, always-on)
       │      uses: ./.github/workflows/spec-spine.yml
       │
       ├──▶ supply-chain   (constitutional, always-on)
       │      uses: ./.github/workflows/ci-supply-chain.yml
       │
       ├──▶ encore         (routed, if changes.encore == 'true')
       │      uses: ./.github/workflows/encore-ci.yml
       │
       ├──▶ ai-review      (routed, PR-only)
       │      uses: ./.github/workflows/ai-pr-review.yml
       │
       └──▶ ci-gate (aggregator)
              needs: changes, spec-spine, supply-chain, encore, ai-review
              if: always()
              fail if any upstream result is failure or cancelled
              skipped counts as success
```

Branch protection on `main` points at exactly **one** required check:
`ci-gate`. Adding a new routed workflow to the orchestrator does not
require updating branch protection.

### FR-01: Inline git-diff change routing

The `changes` job MUST compute route booleans with an inline `git diff`
shell step, never via a third-party filter Action. The enterprise
Actions allow-list (spec 012) forbids third-party path-filter actions,
so routing is inline:

- On `pull_request`: `git diff --name-only ${{ github.event.pull_request.base.sha }} HEAD`
- On `merge_group` and `workflow_dispatch`: every route defaults to
  `true` (no PR base to diff; run the full suite)
- On `push`: `git diff` against `${{ github.event.before }}`. When there
  is no usable base (first push to a ref, where `before` is the zero SHA,
  or a parentless initial commit), the base is resolved with
  `git rev-parse --verify --quiet HEAD~1` and falls back to the empty-tree
  object so every path registers as changed and all routes compute. Plain
  `git rev-parse HEAD~1` must not be used here: on a parentless commit it
  echoes the literal `HEAD~1` to stdout, producing a two-line base that
  breaks the subsequent `git diff` (the born-with produced app's very first
  commit is exactly this case).

Route outputs today:

| Output | True when |
|--------|-----------|
| `encore` | any change under `apps/api/**`, `apps/web/**`, `apps/web-internal/**`, `.github/workflows/encore-ci.yml`, `.github/actions/encore-*/**` |

Future routes are added by their owning spec via `co_authority` on
`jobs.changes`, using the same inline mechanism.

### FR-02: Constitutional always-on gates

Two governance workflows MUST run on every PR regardless of route:

- **spec-spine** (`spec-spine.yml`, owned by spec 000): compile,
  lint --fail-on-warn, index check, couple --base origin/main. Dispatched
  with `secrets: inherit` so that in a born-with produced app the reusable
  workflow's terminal `tenant-emit build-certificate` step (spec 220
  FR-002) can read the `OAP_SIGNING_KEY` secret (spec 220 FR-003) and sign
  with the operator key. A reusable workflow receives no caller secrets
  without `inherit`; inherited secrets are simply empty on fork PRs, which
  preserves the emit step's documented graceful skip.
- **supply-chain** (`ci-supply-chain.yml`, owned by spec 010): npm
  audit + workflow-pins

These are the constitutional carve-outs — they defend the spec
spine's integrity and the dependency surface on every PR.

### FR-03: Routed gates

Routed jobs MUST be gated on `needs.changes.outputs.<route> == 'true'`
and MUST appear in `ci-gate.needs`. A skipped routed job does not fail
the gate.

- **encore** — dispatches `encore-ci.yml` (spec 007) when Encore
  sources change
- **ai-review** — dispatches `ai-pr-review.yml` (spec 013), PR-only
  via `if: github.event_name == 'pull_request'`

### FR-04: ci-gate aggregator

A terminal `ci-gate` job MUST:

- `needs:` every other job in the orchestrator
- `if: always()` so it runs even when an upstream is skipped or fails
- Aggregate `toJSON(needs)` and exit 1 if any upstream result is
  `failure` or `cancelled`; `skipped` and `success` both pass
- Be the **only** required check in branch protection

### FR-05: dependabot.yml — npm and github-actions only

`.github/dependabot.yml` MUST configure automated dependency bumps for:

- **`github-actions`** ecosystem at repo root (weekly cadence)
- **`npm`** ecosystem for each npm surface the repo ships:
  - `/` (root workspace: scripts, spec-spine CLI, dev tooling)
  - `apps/api` (standalone Encore.ts app, outside the workspace)

Each ecosystem groups minor + patch updates into consolidated PRs to
reduce noise. No other ecosystems are configured — there are no
native-language manifests requiring separate bump tracking.

### FR-06: CODEOWNERS

`.github/CODEOWNERS` MUST route review requests for:

- Default `*` → repo owner
- `/specs/` → repo owner (contract drift surface)
- `/.github/` → repo owner (CI plumbing)
- `/apps/api/` → repo owner (Encore.ts backend)
- `/apps/web/`, `/apps/web-internal/` → repo owner (SPA surfaces)

The owner handle `@your-github-handle` MUST be substituted by
downstream forks. No tool-path routes are configured — `tools/lint/`
is governed entirely by spec 011 without CODEOWNERS coverage.

### FR-07: pull_request_template.md

`.github/pull_request_template.md` MUST include:

- Summary section
- Spec alignment section (referencing `specs/NNN-slug/spec.md` or
  declaring "none (infra/chore/docs)")
- Change classification checklist (feature | fix | governance | chore)
- Standard pre-merge checklist (npx spec-spine couple passes, CI
  green, CODEOWNERS reviewers assigned)

## 4. Acceptance criteria

**AC-1** `.github/workflows/ci.yml` exists with the `changes`,
`spec-spine`, `supply-chain`, `encore`, `ai-review`, and `ci-gate` jobs
wired as described in §3.1.

**AC-2** `ci.yml`'s `changes` job routes via inline `git diff` — no
third-party filter action appears anywhere in the file.

**AC-3** `.github/dependabot.yml` covers the `github-actions` ecosystem
and the two npm surfaces (`/` and `apps/api`).

**AC-4** `.github/CODEOWNERS` covers the path categories enumerated in
FR-06.

**AC-5** `.github/pull_request_template.md` includes the spec-alignment
and pre-merge checklists.

**AC-6**
```bash
npx spec-spine registry show 009-repo-ci-orchestrator
```
exits 0 and resolves all four `establishes:` units.

**AC-7** `gh workflow run ci-supply-chain.yml` from any branch executes
without infrastructure errors.

## 5. Out of scope

- **Branch protection configuration** — configuring branch protection
  to require `ci-gate` is a repo-admin action, not a workflow file.
  Downstream forks configure this on `main`.
- **Release pipelines** — `release-*.yml` workflows trigger on their
  own events and are not dispatched from `ci.yml`.
- **AI changelog** — `ai-changelog.yml` and interactive review bots
  are opt-in for downstream forks; they are not part of the
  constitutional CI surface.
- **Additional npm surfaces** — if a downstream fork adds new npm
  packages under `packages/`, their dependabot entries are the
  fork's responsibility.
