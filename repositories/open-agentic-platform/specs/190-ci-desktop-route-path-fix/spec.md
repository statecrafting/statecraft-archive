---
id: "190-ci-desktop-route-path-fix"
slug: ci-desktop-route-path-fix
title: "Fix ci.yml desktop paths-filter stranded by the spec-178 product/apps rename"
status: approved
implementation: complete
owner: bart
created: "2026-05-30"
approved: "2026-05-30"
completed: "2026-05-30"
kind: governance
domain: tooling
risk: low
depends_on:
  - "177-ci-orchestrator-pr-gate"  # ci-orchestrator-pr-gate (the router whose desktop filter this corrects)
  - "178-opc-directory-rename"  # opc-directory-rename (the rename that stranded the glob)
code_aliases:
  - "CI_DESKTOP_ROUTE_FIX"
refines:
  - aspect: "desktop-route-path"
    unit: { kind: file, path: .github/workflows/ci.yml }
    refines_specs: ["177-ci-orchestrator-pr-gate"]
extends:
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
summary: >
  The spec-177 CI orchestrator routes the desktop PR gate (check + clippy +
  test) via a dorny/paths-filter glob in `ci.yml`. That glob still names
  `product/apps/desktop/**`, but spec 178 renamed the directory to
  `product/apps/opc/`. Since #178 the desktop gate has therefore been **dark
  for desktop-only PRs** — it fired only incidentally when a PR also touched
  `crates/**` (the filter's other glob). This spec retargets the glob to
  `product/apps/opc/**`, restoring the gate. A live demonstration: PR #257
  changed `product/apps/opc/src-tauri/**` and the desktop job skipped, so a
  clippy violation merged; PR #258 (which touched `crates/`) ran the gate and
  caught it. Same class of silent-dark-gate as spec 189's schema-parity
  finding, narrower blast radius.
---

# 190 — Fix ci.yml desktop paths-filter after the #178 rename

## 1. Problem

`.github/workflows/ci.yml` (spec 177) routes each reusable PR-gate workflow
behind a `dorny/paths-filter` boolean. The `desktop` filter reads:

```yaml
desktop:
  - 'product/apps/desktop/**'   # ← stale: renamed by spec 178
  - 'crates/**'
  - 'product/packages/**'
  - '.github/workflows/ci-desktop.yml'
```

Spec 178 (`opc-directory-rename`) renamed `product/apps/desktop/` →
`product/apps/opc/`. The filter was not updated, so a PR that changes only
the desktop app (`product/apps/opc/**`) does **not** match the `desktop`
filter and the `desktop` job is **skipped**. The aggregator treats
`skipped` as success, so the gate is silently absent — exactly the
failure mode spec 177 §2.2 and the spec-189 episode warn against.

The gate fired at all only because the filter *also* lists `crates/**`
(the desktop crate depends on workspace crates), so a PR touching any
crate incidentally triggered it. That is how the regression surfaced:

- **PR #257** changed `product/apps/opc/src-tauri/**` and nothing under
  `crates/` → `desktop` skipped → a `clippy::collapsible_match` violation
  merged uncaught.
- **PR #258** changed `crates/featuregraph/tests/golden/**` → `desktop`
  ran (via `crates/**`) → caught the very lint #257 introduced.

A gate that runs on PRs touching *other* areas but skips on PRs touching
*its own* area is worse than no gate: it reads as green-by-coverage while
the code it guards goes unchecked.

## 2. Fix

Retarget the one stale glob:

```diff
 desktop:
-  - 'product/apps/desktop/**'
+  - 'product/apps/opc/**'
   - 'crates/**'
   - 'product/packages/**'
   - '.github/workflows/ci-desktop.yml'
```

The `ci-desktop.yml` workflow body already operates on
`product/apps/opc/**` (it builds, clippies, and tests
`product/apps/opc/src-tauri`); only the *router glob* lagged. This is the
sole stranded `product/apps/desktop` reference in `.github/workflows/`
(the only other tracked occurrences are spec 178's title in the
featuregraph golden and two cosmetic doc/comment strings in the `opc`
tree, neither of which affects routing or behaviour).

## 3. Scope and non-goals

- **In scope:** the `desktop` filter glob in `ci.yml`.
- **Not in scope:** wiring `make ci-schema-parity` as its own CI job (a
  separate, larger follow-up that introduces a TypeScript-capable runtime
  to CI); cosmetic stale-path comments in `product/apps/opc/**`
  (governed by their own specs, no behavioural effect).

## 4. Acceptance

- **AC-1.** `ci.yml`'s `desktop` filter lists `product/apps/opc/**` and no
  longer lists `product/apps/desktop/**`.
- **AC-2.** A PR changing only files under `product/apps/opc/**` (and no
  `crates/**`) routes `needs.changes.outputs.desktop == 'true'` and runs
  the `desktop` reusable — i.e. the gate is no longer skipped on
  desktop-only PRs. (Verified by inspection of the filter; the next
  desktop-only PR exercises it live.)
- **AC-3.** `ci-parity-check` (spec 104) stays green — this changes a
  `filters:` glob, not a `run:` block, so the Makefile↔CI run-mirror is
  untouched.

## 5. Cross-references

- Spec 177 — the CI orchestrator whose `desktop` route this corrects.
- Spec 178 — the rename that stranded the glob.
- Spec 189 — the schema-parity restoration; same silent-dark-gate class,
  surfaced this one (its #257/#258 episode is the live evidence above).
