---
id: "012-enterprise-actions-governance"
title: "Enterprise Actions governance: the GitHub Actions allow-list, inline change-routing, and the merge queue"
status: approved
created: "2026-06-10"
owner: bart
kind: governance
domain: ci-cd
risk: low
implementation: complete
depends_on: ["011-workflow-pins-lint"]
code_aliases: ["ACTIONS_ALLOWLIST"]
summary: >
  The enterprise (EMU) constraint set for GitHub Actions: only
  allow-listed publishers may execute, so workflows route changes with
  inline git diff instead of third-party filter actions; every permitted
  third-party ref is SHA-pinned; the merge_group trigger ships inert until
  a repo admin enables the merge queue.
constrains:
  - unit: { kind: file, path: ".github/workflows/" }
    note: "every `uses:` ref must be an allow-listed publisher and SHA-pinned; no third-party change-filter actions"
    target_specs: ["007-encore-ci-cd", "008-container-host-deploy", "009-repo-ci-orchestrator", "010-supply-chain-gates", "013-ai-pr-review"]
---

# 012 — Enterprise Actions governance

## 1. Purpose

The repo's CI runs inside the **ACME** GitHub organisation. This
org enforces an Actions allow-list: only Actions from approved publishers
may execute in a workflow run. A `uses:` ref to any non-listed publisher
is refused by the organisation at run time — not by any repo-level gate.
This is a non-negotiable supply-chain control.

This spec records that constraint, documents the allow-listed publishers
in use, specifies the inline routing mechanism that replaces third-party
path-filter actions, and governs the merge-queue posture. The workflows
already conform; this spec is the governance record that makes the
constraint explicit and traceable.

## 2. Territory

This spec governs the **publisher-scope constraint** across all workflow
files in `.github/workflows/` and `.github/actions/`. It does not own
any workflow file; those are owned by their respective specs (007, 008,
009, 010, 013). It constrains all of them via the `constrains:` ownership
edge.

The SHA-pin half of the Actions posture is governed by spec 011
(`011-workflow-pins-lint`). This spec adds the publisher-scope constraint
on top: a ref can be SHA-pinned to a non-allow-listed publisher and still
fail at run time. Both constraints MUST hold together.

## 3. Behavior

### FR-01: Allow-listed publishers only

Every `uses:` ref under `.github/workflows/**` and `.github/actions/**`
MUST resolve to an allow-listed publisher or a local path. Non-allow-listed
publishers — including common third-party convenience Actions such as
`dorny/paths-filter` — MUST NOT be introduced.

Compliant publishers in use today:

| Publisher | Used for |
|-----------|----------|
| `actions/checkout`, `actions/setup-node`, `actions/cache`, `actions/upload-artifact` | first-party CI plumbing |
| `github/codeql-action` | first-party security scanning |
| the host-provider's login/deploy publisher | container-host deployment workflows (pinned per downstream project) |
| `./.github/actions/*`, `./.github/workflows/*.yml` | local composite + reusable (path-local, exempt from SHA-pin) |

There are zero non-allow-listed refs across `.github/**`.

### FR-02: Inline change-routing (no third-party filter action)

`ci.yml`'s `changes` job MUST compute route booleans with an inline
`git diff` shell step. The org allow-list excludes `dorny/paths-filter`
and equivalent third-party path-filter actions, so inline routing is the
only compliant mechanism:

- On `pull_request`: diff the PR base against `HEAD` and `grep` the
  changed-file list to emit one boolean output per route
- On `merge_group` and `workflow_dispatch`: every route defaults to
  `true` — no PR base exists, so the full suite runs

The route **mechanism** (inline diff, no third-party Action) is governed
by this spec. The route **catalogue** (which paths trigger which
workflow) is owned section-by-section by the spec that introduces each
route, via `co_authority` on `jobs.changes` in `ci.yml`.

### FR-03: Every external ref SHA-pinned

Every external `uses:` ref MUST be pinned to a full 40-hex commit SHA
per spec 011. This spec adds the publisher-scope constraint on top:
a ref must be both allow-listed AND SHA-pinned. Neither constraint alone
is sufficient.

### FR-04: Merge-queue posture

`ci.yml` declares a `merge_group:` trigger so the GitHub merge queue can
be enabled. When a repo admin (a) enables the merge queue on `main` and
(b) requires `ci-gate` on `merge_group` events, each queued PR is tested
against the speculative merged tree before reaching `main` — a green PR
cannot be silently invalidated by the PR merged ahead of it.

The `merge_group:` trigger is **inert** until those two branch-protection
steps are taken. Enabling the queue is a repo-admin action outside any
workflow file, consistent with the branch-protection carve-out in spec 009.

### 3.1 Enforcement model

The ACME organisation enforces the allow-list at run time: a
`uses:` ref to a non-allow-listed publisher does not execute, regardless
of any repo-side gate. This means the constraint is:

- **Primarily organisational** — enforced by the org before any workflow
  job begins
- **Secondarily documentary** — this spec records the constraint so
  contributors understand why third-party convenience actions cannot be
  added and how to work within the constraint (inline shell)

Spec 011's `workflow-pins.sh` enforces the SHA-pin half (FR-03) at the
commit and merge boundaries. Publisher-scope enforcement is the org's
responsibility; this spec does not re-implement it as a coupling-gate
edge over every workflow edit.

## 4. Acceptance criteria

**AC-1** A `uses:` audit of `.github/**` shows zero non-allow-listed
publishers:
```bash
grep -r 'uses:' .github/ | grep -v '^\s*#' | grep -v '\./\.github/'
# Every result must be an allow-listed publisher or a local ./ path
```

**AC-2** `ci.yml`'s `changes` job routes via inline `git diff` with no
third-party Action:
```bash
grep 'dorny' .github/workflows/ci.yml
# → no output (zero matches)
```

**AC-3** All external `uses:` refs are SHA-pinned:
```bash
bash tools/lint/workflow-pins.sh .github/workflows .github/actions
# → exit 0
```

**AC-4**
```bash
npx spec-spine registry show 012-enterprise-actions-governance
```
exits 0.

**AC-5** `ci.yml` contains a `merge_group:` trigger at the top level.

## 5. Out of scope

- **Adding publishers to the allow-list** — the allow-list is an
  organisational control managed by ACME admins. Requesting
  additions is a governance process outside this repo.
- **Enforcing publisher-scope at the coupling gate** — the org enforces
  publisher scope at run time; duplicating this in a coupling-gate edge
  would couple every workflow edit to this spec without adding real
  validation.
- **Third-party security scanning actions** — Actions like
  `aquasecurity/trivy-action` are allow-listed for security scanning use
  cases. Their inclusion requires approval through the org's allow-list
  process; they are not automatically permitted.
