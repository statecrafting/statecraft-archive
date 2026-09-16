---
id: "195-release-tools-dispatch-build-ref"
slug: release-tools-dispatch-build-ref
title: "Release Tools dispatch build-ref — build from a commit, never the (absent) draft tag"
status: approved
implementation: complete
owner: bart
created: "2026-06-01"
approved: "2026-06-01"
kind: governance
domain: tooling
risk: medium
depends_on:
  - "086-open-source-launch"  # open-source-launch — established release-tools.yml (tool-archive attach)
  - "117-release-artifact-attestations"  # release-artifact-attestations — SLSA provenance per archive; coherence requires the build commit
  - "194-release-publish-boundary-guard"  # release-publish-boundary-guard — sibling refines on the same file; its publish-boundary guard is unchanged here
refines:
  - aspect: "release-tools-dispatch-build-ref"
    unit: { kind: file, path: .github/workflows/release-tools.yml }
extends:
  # Mechanical featuregraph-golden refresh: appending spec 195 to the corpus
  # shifts the golden fingerprint. No semantic change to spec 034's claims.
  # Same precedent as specs 194 (PR #277), 193 (#276), 187, 183.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
compliance:
  - framework: "owasp-asi-2026"
    # ASI04 (supply-chain compromise). The SLSA build-provenance attestation
    # spec 117 emits for each tool archive binds the artifact to the commit it
    # was built from. If the tools build from a different commit than the
    # desktop binaries they ship beside, the attested provenance is incoherent
    # across the same release. Pinning the dispatch build to a commit (and
    # defaulting it to the desktop build commit) keeps the whole release's
    # provenance attesting one source of truth.
    controls: ["ASI04"]
summary: >
  Fix the release-tools workflow_dispatch backfill path: build the CLI tool
  archives from a commit SHA, never from `refs/tags/$TAG`. A draft release has
  no git tag yet (drafts don't tag until publish), so deriving the checkout ref
  from the tag fails `actions/checkout` at a nonexistent ref — making the manual
  `gh workflow run release-tools.yml -f tag=opc-v0.4.0` backfill unusable for
  exactly the draft releases it exists to complete. Add an optional `ref`
  workflow_dispatch input (commit SHA) and default it to the dispatch commit
  (github.sha); the reactive workflow_run path's head_sha behaviour is
  unchanged. Coherent SLSA provenance (spec 117) requires the tools build from
  the same commit as the desktop binaries.
---

# 195 — Release Tools dispatch build-ref

> **Relationship.** Refines the `release-tools-dispatch-build-ref` aspect of
> `.github/workflows/release-tools.yml`, established by **086** and carrying
> SLSA-provenance obligations from **117**. Sibling to **194**, which refines
> the *publish-boundary* aspect of the same file; 194's fail-closed draft
> assertion before `gh release upload` is **left unchanged** here. This spec
> touches only how the **workflow_dispatch** path resolves the build ref. The
> structural follow-up (the reactive chain silently skipping dispatch-cut
> desktop releases) is deferred to §7 as an explicit operator decision.

## 1. Problem statement

`release-tools.yml` attaches the four CLI tool archives (`spec-compiler`,
`registry-consumer`, `spec-lint`, `codebase-indexer` + per-archive SBOM and
`.intoto.jsonl`) to the same GitHub Release the desktop workflow created. Its
`resolve-tag` job picks a checkout ref two ways:

- **Reactive (`workflow_run`)** — `REF="$UPSTREAM_SHA"` (the upstream *Release
  Desktop* run's `head_sha`). Correct: a real commit.
- **Manual (`workflow_dispatch`)** — `REF="refs/tags/$TAG"`. **Wrong for a
  draft.** A draft release carries no git tag (GitHub creates the tag only at
  publish), so `refs/tags/opc-v0.4.0` does not exist while the release is a
  draft. `actions/checkout` fails at the ref and the build matrix never runs.

This makes the documented backfill —
`gh workflow run release-tools.yml -f tag=opc-v0.4.0` — unusable for precisely
the case it exists to serve: a draft desktop release whose tool archives are
missing. Observed on the **opc-v0.4.0** draft (16 desktop-only assets, no tools
bundle), which was cut via `workflow_dispatch` on *Release Desktop*
(`head_branch='main'`); the reactive tool chain skipped (its gate keys on
`startsWith(head_branch, 'opc-v')`), and the manual backfill would fail at the
nonexistent tag ref.

## 2. The fix

On the `workflow_dispatch` path, resolve the build ref to a **commit**, never a
tag:

- Add an optional `ref` workflow_dispatch input — a commit SHA to build from.
- `resolve-tag` sets `REF="${INPUT_REF:-$DISPATCH_SHA}"`, where `$DISPATCH_SHA`
  is `github.sha` (HEAD of the branch the workflow was dispatched against).
- `TAG` still comes from the `tag` input (correct — the upload target *is* the
  release identified by tag name; the draft's tag name exists as a label even
  before the git tag is created).
- The reactive `workflow_run` branch (`REF="$UPSTREAM_SHA"`) is **untouched**.

### Why a commit, not the tag

Two reasons, both load-bearing:

1. **The tag does not exist on the draft path.** Building from `refs/tags/$TAG`
   cannot work until publish creates the tag — which is the wrong ordering, as
   tools must attach *before* the operator publishes (spec 194 §5 runbook).
2. **Provenance coherence (spec 117).** Each archive ships an
   `attest-build-provenance` `.intoto.jsonl` binding the artifact to its build
   commit. The tools and the desktop binaries share one release; their
   provenance should attest the **same** commit. Defaulting `REF` to the
   dispatch commit, and letting the operator pin the desktop build commit
   explicitly via `ref`, keeps the release's provenance internally consistent.

## 3. Operator usage

For the opc-v0.4.0 backfill, the desktop draft was built from commit
`ed00951e` (the *Release Desktop* run's `head_sha`, equal to the draft's
`targetCommitish` and to current `main` HEAD). The backfill is therefore:

```
gh workflow run release-tools.yml -f tag=opc-v0.4.0 -f ref=ed00951e
```

When `main` HEAD still equals the desktop build commit, `-f ref=` may be
omitted and the default (`github.sha`) resolves to the same commit. Pinning the
explicit `ref` is the safe habit whenever `main` may have advanced past the
commit the desktop release was cut from.

## 4. Where it applies

| Workflow → element | Before | After |
|--------------------|--------|-------|
| `release-tools.yml` → `on.workflow_dispatch.inputs` | `tag` only | adds optional `ref` (commit SHA) |
| `release-tools.yml` → `resolve-tag` (dispatch branch) | `REF="refs/tags/$TAG"` | `REF="${INPUT_REF:-$DISPATCH_SHA}"` |
| `release-tools.yml` → `resolve-tag` (reactive branch) | `REF="$UPSTREAM_SHA"` | **unchanged** |
| `release-tools.yml` → upload step (spec 194 guard) | assert `isDraft` before upload | **unchanged** |

## 5. Acceptance criteria

- **AC-1.** On `workflow_dispatch`, `resolve-tag` outputs `ref` equal to the
  `ref` input when provided, else `github.sha` — never `refs/tags/$TAG`.
- **AC-2.** `TAG` (the upload target) continues to come from the `tag` input on
  the dispatch path.
- **AC-3.** The reactive `workflow_run` branch still resolves
  `REF="$UPSTREAM_SHA"` and `TAG="$UPSTREAM_BRANCH"` — byte-for-byte unchanged.
- **AC-4.** The spec-194 publish-boundary guard before `gh release upload`
  (assert `isDraft == true`, fail closed otherwise) is unchanged and still
  fires.
- **AC-5.** The coupling gate is satisfied via this spec's `refines` claim over
  `.github/workflows/release-tools.yml`; no Spec-Drift-Waiver is used.
- **AC-6.** The `ref` input is optional; an omitted `ref` resolves to the
  dispatch commit, preserving the simplest backfill invocation when `main` HEAD
  is the desktop build commit.

## 6. Out of scope

- Publishing any release — remains an operator action (spec 193 §7, spec 194).
- Changing the reactive chain's *trigger* gate or asset set — see §7.
- Backfilling opc-v0.4.0 itself. This spec lands the workflow fix; running the
  corrected dispatch to attach the archives to the existing draft is an operator
  action taken after this PR merges (the build will use `ref=ed00951e`).

## 7. Deferred — reactive auto-attach on dispatch-cut releases (operator decision)

The reason the opc-v0.4.0 tools never attached automatically is a **separate**
defect from the one this spec fixes: the reactive `workflow_run` trigger gates
on `startsWith(github.event.workflow_run.head_branch, 'opc-v')`. A desktop
release cut via `workflow_dispatch` has `head_branch='main'`, so the reactive
tool chain **silently skips**. (A tag-*push*-cut desktop release would have
`head_branch='opc-v…'` and the gate would pass — but the project's current
cadence cuts desktop releases by dispatch.) This spec does **not** resolve that;
it is left as an explicit operator decision between:

- **(a) Make `release-tools` dispatch-only.** Drop the `workflow_run` trigger;
  tools become a deliberate pre-publish step the operator dispatches after
  verifying the desktop draft. Eliminates the spec-194 §7 TOCTOU residual and
  the silent-skip surprise, at the cost of one manual step per release.
- **(b) Fix the reactive chain to learn the real tag on dispatch cuts.**
  Requires the *Release Desktop* run to pass its resolved tag (and build commit)
  through to the reactive consumer — non-trivial, because `workflow_run` exposes
  only `head_branch`/`head_sha`, not arbitrary upstream outputs, so it needs an
  artifact or `repository_dispatch` hop.

**Interim model (until P2 is decided):** tools are attached by a **manual
`release-tools` dispatch** (now buildable from a commit, per this spec) after
the desktop draft is verified and **before** publish — consistent with the
spec-194 §5 runbook ("publish only after both _Release Desktop_ and _Release
Tools_ are green").
