---
id: "000-factory-kernel"
title: "Factory kernel: spec-spine governance and the resilient CI surface"
status: approved
created: "2026-06-23"
owner: bart
kind: governance
domain: governance
risk: medium
implementation: complete
depends_on: []
code_aliases: ["FACTORY_KERNEL"]
summary: >
  factory-encore now carries governed code (the create-time generator), so it
  earns a kernel. This spec adopts spec-spine over the corpus (compile,
  fail-on-warn lint, index staleness gate, PR-time coupling gate) and stands up
  the OAP resilient CI surface: a path-routed orchestrator whose terminal
  ci-gate aggregates the governance gate, the generator test gate, the lockstep
  gate, and an AI PR review that passes with a visible notice on a Claude API
  failure (never a silent green).
establishes:
  - ".github/workflows/ci.yml"
  - ".github/workflows/spec-spine.yml"
  - ".github/workflows/ai-pr-review.yml"
  - ".github/workflows/generator-ci.yml"
  - "standards/"
---

# 000. Factory kernel: spec-spine governance and the resilient CI surface

## 1. Purpose

The factory restructure makes factory-encore the create-time home: it owns the
deterministic generator, the module catalog, the from-Build-Spec orchestration,
and the specs that govern them. Owning code means owning governance. This spec
adopts the spec-spine kernel and the OAP resilient CI surface so the generator
is governed exactly as the product it produces is.

Before this spec, factory-encore carried only the process/contract layers and
the adapter prose; it had no `package.json` and no `.github/`. That changes
here because the repository now carries governed TypeScript.

## 2. Territory

This spec owns the CI workflow surface and the standards corpus. The spec-spine
configuration itself (`spec-spine.toml`) and the toolchain manifest
(`package.json`) are always-hashed governance core; `package.json` annotates
this spec as its owner via `"spec-spine": { "spec": "000-factory-kernel" }`.
The lockstep gate is owned by spec 006; the generator and its meta-specs are
owned by specs 001-005.

## 3. Behavior

### 3.1 spec-spine governance

#### FR-001: Governed corpus

The spec corpus under `specs/` MUST compile to a deterministic registry
(`spec-spine compile`), pass the corpus conformance lint at `--fail-on-warn`,
and keep a committed codebase index that the staleness gate
(`spec-spine index check`) verifies. Domains and kinds are closed taxonomies
declared in `spec-spine.toml`.

#### FR-002: PR-time coupling gate

On pull requests, the coupling gate (`spec-spine couple`) MUST refuse code that
drifts from its owning spec. Waivers are visible `Spec-Drift-Waiver:` PR-body
lines; dependency-only PRs self-waive.

### 3.2 Resilient CI surface

#### FR-003: Terminal ci-gate

Branch protection's single required check on `main` is the terminal `ci-gate`
job. Every other gate is a reusable (`workflow_call:`) workflow dispatched from
`ci.yml`. `ci-gate` treats `skipped` as success and fails the build on any
upstream `failure` or `cancelled`.

#### FR-004: Always-on governance, routed app checks

The governance gate (`spec-spine.yml`) and the lockstep gate run on every PR
(never path-filtered). Two gates are routed on the generator surface
(`adapters/**`, `package.json`, `tsconfig.json`): the generator test gate
(`generator-ci.yml`: typecheck + vitest) and the structural generator e2e
(`generator-e2e.yml`, owned by spec 007). On `merge_group` / `workflow_dispatch`
the routes fall back to `true` (no base to diff) and the full suite runs. The
expensive build-matrix e2e lanes (spec 007) run on a schedule, are non-gating,
and are not aggregated by `ci-gate`.

#### FR-005: AI review API-failure resilience, never silent

The AI PR review (`ai-pr-review.yml`) MUST pass `ci-gate` when the Claude API
fails transiently (overloaded, rate-limited, 5xx, timeout, network), but the
pass MUST be visible: a PR notice is posted so a green `ci-gate` never falsely
implies the review happened. An authentication or permission error is a hard
failure (a broken token must be fixed, not masked). An oversized diff is
skipped with the same visible-notice discipline.

## 4. Acceptance criteria

**AC-1.** `npx spec-spine compile` exits 0; `npx spec-spine lint --fail-on-warn`
exits 0; `npx spec-spine index check` exits 0.

**AC-2.** `ci.yml` declares a terminal `ci-gate` that `needs:` the governance,
generator, lockstep, and AI-review jobs and fails on any `failure`/`cancelled`.

**AC-3.** `ai-pr-review.yml` classifies a Claude API outage as a pass with a
posted PR notice, and classifies an auth/permission error as a hard failure.

**AC-4.** Every external `uses:` in the workflow surface is SHA-pinned.

## 5. Out of scope

- **The lockstep gate** (`ci-lockstep.yml` + the checker): owned by spec 006.
- **The generator mechanism**: owned by specs 001-004.
- **Run-side / born-with verification** (tenant-tail provenance + certificate):
  a produced-app concern, not a generator-home concern; deliberately absent
  from this kernel.
