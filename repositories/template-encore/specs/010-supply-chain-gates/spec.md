---
id: "010-supply-chain-gates"
title: "Supply-chain gates: npm audit and workflow-pin enforcement"
status: approved
created: "2026-06-10"
owner: bart
kind: governance
domain: ci-cd
risk: medium
implementation: complete
depends_on: ["011-workflow-pins-lint"]
code_aliases: ["SUPPLY_CHAIN"]
summary: >
  One workflow, two gates: npm audit over every npm surface (root workspace
  and the standalone apps/api) with a high-severity failure bar, and the
  workflow-pins lint (spec 011) over .github/**. Runs on every PR and on a
  weekly Monday cron so new advisories surface on quiet weeks.
establishes:
  - ".github/workflows/ci-supply-chain.yml"
---

# 010 — Supply-chain gates

## 1. Purpose

A production-grade template must defend its own dependency surface. The
repo ships two npm surfaces and a collection of GitHub Actions workflows;
without supply-chain gates, a known advisory in any npm dependency or an
un-pinned Actions ref merges to `main` without CI seeing it.

`ci-supply-chain.yml` is the single workflow that covers both surfaces:
npm audit (advisory gate) and the workflow-pins lint (Actions ref gate,
spec 011). Running both in one workflow keeps the supply-chain posture
consolidated behind a single workflow name that the orchestrator
(spec 009) dispatches as a constitutional always-on gate.

## 2. Territory

`ci-supply-chain.yml` owns the two supply-chain jobs. It does not own the
lint script itself — that belongs to spec 011, which also governs the
`jobs.workflow-pins` section of this file via section-anchored
`co_authority`. Spec 010 owns the file overall and the `npm-audit-*`
jobs; spec 011 owns the `jobs.workflow-pins` section.

The weekly cron is part of this spec's territory — it ensures the gate
runs even on quiet weeks when no PR triggers it, so new advisories
published between PRs do not go undetected.

## 3. Behavior

### 3.1 Workflow topology

```
ci-supply-chain.yml
  triggers: pull_request, schedule (weekly Monday), workflow_call,
            workflow_dispatch

  jobs (run in parallel):
    npm-audit-root    — npm audit in /  (root workspace)
    npm-audit-api     — npm audit in apps/api  (standalone Encore app)
    workflow-pins     — tools/lint/workflow-pins.sh over .github/**
                        (section governed by spec 011)
```

### FR-01: npm audit covers every npm surface

The `npm-audit-root` job MUST run `npm audit --audit-level=high` at the
repository root (the npm workspace containing scripts and dev tooling).

The `npm-audit-api` job MUST run `npm audit --audit-level=high` in
`apps/api/` (the standalone Encore.ts application, which has its own
`package.json` and lockfile outside the root workspace).

Both jobs run as **independent jobs** so a failure in one surface does
not block triage of the other. Both use `--audit-level=high` — the
high-severity bar is appropriate for this advisory surface: low-severity
transitive advisories in build tooling are typically not actionable and
produce noise that degrades gate signal.

### FR-02: workflow-pins job is co-owned by spec 011

The `jobs.workflow-pins` section of `ci-supply-chain.yml` is governed by
spec 011 (`011-workflow-pins-lint`) via section-anchored co-authority.
That job invokes `tools/lint/workflow-pins.sh` against `.github/**` and
MUST:

- Exit 1 on any non-SHA-pinned `uses:` ref
- Exit 2 on invocation failure (treated as a gate failure — not silent)
- Never use an allow-list; the only fix for a flagged ref is to pin it

Edits to the `workflow-pins` job MUST be accompanied by a spec 011
change; edits to the npm-audit jobs MUST be accompanied by a spec 010
change.

### FR-03: Weekly cron is non-optional

The `schedule: cron: '0 12 * * 1'` (every Monday 12:00 UTC) trigger
MUST remain in the workflow. Without it, a new npm advisory published
after the last PR goes undetected until the next PR trigger. The weekly
cadence ensures the gate runs at least once every seven days regardless
of repository activity.

### FR-04: Triggered as constitutional gate

`ci-supply-chain.yml` MUST support `workflow_call:` so the orchestrator
(spec 009) can dispatch it as a constitutional always-on gate. It MUST
also support `workflow_dispatch:` for manual runs.

### FR-05: All `uses:` refs SHA-pinned

Every `uses:` ref inside `ci-supply-chain.yml` MUST be pinned to a full
40-hex commit SHA per spec 011. The workflow's own `workflow-pins` job
audits `.github/**`, which includes itself — the gate is self-auditing.

## 4. Acceptance criteria

**AC-1** `.github/workflows/ci-supply-chain.yml` exists and declares the
`npm-audit-root`, `npm-audit-api`, and `workflow-pins` jobs.

**AC-2** Both npm-audit jobs run `npm audit --audit-level=high` against
their respective surfaces and fail the workflow on a high-severity
finding.

**AC-3** The `workflow-pins` job invokes `tools/lint/workflow-pins.sh`
with no allow-list.

**AC-4** The `schedule:` trigger is present with cron `'0 12 * * 1'`.

**AC-5** The workflow supports `workflow_call:` for orchestrator dispatch.

**AC-6**
```bash
npx spec-spine registry show 010-supply-chain-gates
```
exits 0 and resolves the `establishes:` unit.

**AC-7** Manual run:
```bash
gh workflow run ci-supply-chain.yml
```
executes without infrastructure errors; both npm-audit jobs and the
workflow-pins job complete.

## 5. Out of scope

- **npm license policy** — `npm audit` covers security advisories only.
  License-policy enforcement for npm requires a separate tool and is a
  follow-on concern for downstream forks.
- **Container image scanning** — registry-side scanning (Trivy, grype
  on pushed images) is a deployment-pipeline concern, not a gate here.
- **Dependabot bump cadence** — the automated bump schedule is governed
  by `.github/dependabot.yml` (spec 009). This spec is the *gate*, not
  the *bump cadence*.
- **Additional npm surfaces** — if a downstream fork adds new npm
  packages, their audit jobs are the fork's responsibility to extend.
