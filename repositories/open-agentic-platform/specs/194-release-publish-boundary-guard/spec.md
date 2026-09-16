---
id: "194-release-publish-boundary-guard"
slug: release-publish-boundary-guard
title: "Publish-boundary guard — automation mutates draft releases only (resolves 193 §7)"
status: approved
implementation: complete
owner: bart
created: "2026-06-01"
approved: "2026-06-01"
kind: governance
domain: tooling
risk: medium
depends_on:
  - "193-paired-release-cadence"  # paired-release-cadence — §7 deferred "control the publish path"; this resolves it
  - "086-open-source-launch"  # open-source-launch — established release-tools.yml (tool-archive attach)
  - "117-release-artifact-attestations"  # release-artifact-attestations — established release-desktop.yml upload/attest steps
  - "037-cross-platform-axiomregent"  # cross-platform-axiomregent — release matrix context
refines:
  - aspect: "release-publish-boundary"
    unit: { kind: file, path: .github/workflows/release-desktop.yml }
  - aspect: "release-publish-boundary"
    unit: { kind: file, path: .github/workflows/release-tools.yml }
extends:
  # Mechanical featuregraph-golden refresh: appending spec 194 to the corpus
  # shifts the golden fingerprint. No semantic change to spec 034's claims.
  # Same precedent as spec 193 (PR #276), 187, 183.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
amended: "2026-06-04"
amendment_record: |
  Amended 2026-06-04 — new guarded mutation site. The axiomregent demotion
  (spec 117 §2.1, amended) adds a post-matrix `attach-sidecar-sbom` job to
  release-desktop.yml that `gh release upload`s the bundled-sidecar SBOM once.
  Per this spec's invariant, that new upload carries the same fail-closed
  three-state draft assertion before the mutation; §4's table gains the row.
  The invariant and mechanism are unchanged — only the set of guarded sites grew.

  self-amends (2026-06-02) — §3 mechanism correction. The
  `release-tools.yml` precondition `gh release view "$TAG" --json isDraft`
  was missing the `--repo "$GITHUB_REPOSITORY"` pin that the sibling
  `gh release upload` four lines down in the same step already carries.
  The `publish` job's only checkout uses `path: src` (the SBOM-scan
  checkout), so the workspace root has no `.git`; gh's fallback
  repo-inference from a cwd git remote fails ("not a git repository"),
  the precondition exits non-zero, and the guard fails CLOSED on the
  gh-lookup-failed branch — mislabeling the cause as "release gone or
  auth failed" rather than reading the draft's true isDraft state.
  Fail-closed preserved draft integrity (no spurious upload onto a
  published release), but on the wrong reason and before a healthy draft
  could ever be reached. The fix pins the precondition to the same repo
  as the mutation call so the two gh calls are identical; the three-state
  exit-code-first / published / draft structure is unchanged. Latent
  since #277; first reached on the 2026-06-02 opc-v0.4.0 tools backfill.
compliance:
  - framework: "owasp-asi-2026"
    # ASI04 (supply-chain compromise). Uploading assets to — or deleting — an
    # already-published release mutates an artifact set whose SHA-256 sidecars
    # and SLSA provenance were already public. Pinning automation to drafts
    # keeps the published artifact set immutable to CI: any post-publish change
    # is a deliberate, human, out-of-band action.
    controls: ["ASI04"]
summary: >
  Establish the publish-boundary invariant for release automation: a GitHub
  Actions workflow may CREATE a draft release and MUTATE (upload assets to /
  delete) a release only while it is a draft. Crossing the publish boundary —
  publishing, uploading to an already-published release, or deleting a
  published release + tag — requires a human action taken outside the
  automation. Realises spec 193 §7's deferred "control the publish path" item
  by adding a fail-closed draft assertion before every `gh release upload` and
  `gh release delete` in release-desktop.yml and release-tools.yml, closing the
  reactive race where the release-tools `workflow_run` chain (or a mid-build
  human publish of the desktop draft) could autonomously mutate a published,
  attested release.
---

# 194 — Publish-boundary guard

> **Relationship.** Resolves the deferred item in **spec 193 §7** ("the publish
> path is controlled") and refines the publish-boundary behaviour of the
> release workflows established by **086** (release-tools) and **117**
> (release-desktop upload/attest). It does not change spec 193's
> version-consistency contract (that aspect — `release-version-alignment` —
> stays 193's). The Phase-1 inventory that motivates this spec is
> `docs/analysis/publish-boundary-hardening-2026-06-01.md`; the prior-state
> investigation is `docs/analysis/release-publish-paths-2026-06-01.md`.

## 1. Problem statement

Spec 193 made release *creation* draft-first and human-gated, but release
*mutation* steps still ran without asserting the target is a draft. Three of
the project's `gh release` mutation sites could therefore cross the publish
boundary autonomously:

1. **`release-tools.yml` (primary, reactive).** Triggered by `workflow_run` on
   *Release Desktop* completion, it builds the four CLI tools (~30 min across
   three OSes) and then `gh release upload --clobber`s their archives to the
   desktop release. By the time it fires, the desktop draft is fully populated
   and *looks done*. If the operator publishes it during that window, the
   upload lands on an **already-published** release — an autonomous boundary
   crossing that mutates an artifact set whose SHA-256 sidecars and provenance
   were already public.
2. **`release-desktop.yml` uploads.** The SBOM/attestation and SHA-256 sidecar
   steps `gh release upload --clobber` to the release the same run created.
   They carry the same missing-draft-check gap with a shorter (but still
   full-multi-OS-build) window.
3. **`release-desktop.yml` guard-failure delete.** On a post-build SBOM
   version mismatch the workflow runs `gh release delete --yes --cleanup-tag`.
   If a human published the draft before the post-build guard tripped, this
   would **delete a published release and its tag** — the most severe crossing,
   because it destroys rather than appends.

`ai-changelog.yml` (edits release *notes* only — mutable metadata, legal under
asset-immutability) is **not** a boundary violation and is left unchanged.
_(Amended 2026-06-04: `release-axiomregent.yml`, formerly listed here as a
create-draft-only non-violation, is **retired** — 037/117, amended. Its upload
surface is gone; the bundled-sidecar SBOM it would have carried now attaches via
the guarded `attach-sidecar-sbom` job in release-desktop.yml, §4.)_

## 2. The invariant

> **Automation mutates draft releases only.** A workflow step may
> `gh release create --draft`, `gh release upload`, or `gh release delete`
> **iff** the target release is a draft at the moment of the call. Publishing a
> release, uploading to an already-published release, or deleting a published
> release/tag requires a human action performed outside these workflows.

Editing release **notes** is exempt (notes are mutable metadata; downloadable
assets and their attestations are not) — `ai-changelog.yml` stays compliant.

## 3. Mechanism — fail-closed draft assertion

Immediately before every `gh release upload` / `gh release delete`, the
workflow asserts:

```
state = gh release view "$TAG" --json isDraft -q .isDraft
state == "true"  → proceed (mutation permitted)
state == "false" → ::error:: + exit 1 (refuse: release is published)
otherwise        → ::error:: + exit 1 (fail closed: draft state undeterminable)
```

The assertion is **inlined** at each call site rather than extracted to a
shared `tools/lint/` lint (the spec-158 pattern spec 193 used for the version
guard) because the call sites have heterogeneous checkouts — `release-tools`'s
`publish` job sparse-checks-out only `src/`, so a root-relative
`tools/lint/<script>` is not present there. The invariant is documented
centrally here; the inline blocks are uniform and each carry a
`# spec 194 — publish-boundary guard` marker.

> **Amendment (2026-06-02) — repo pin on the precondition.** The same
> `src/`-only checkout that rules out a shared `tools/lint/` script also
> means `gh release view` cannot infer the target repo from a cwd git
> remote — the `publish` job's workspace root has no `.git`. The
> precondition therefore MUST carry `--repo "$GITHUB_REPOSITORY"`, matching
> the `gh release upload` mutation in the same step. Without it the view
> exits non-zero and the guard fails closed on the gh-lookup-failed branch
> (mislabeling the cause), so a healthy draft is never reached. Pinning
> both gh calls to the same repo makes them self-evidently consistent; the
> three-state structure above is otherwise unchanged.

**Happy path is unchanged.** When these steps run normally the release is
always a draft (just created; not yet published), so the assertion passes and
no behaviour changes. The guard bites only on the race — converting a silent,
irreversible boundary crossing into a loud, safe CI failure.

The guard-failure **delete** in `release-desktop.yml` is additionally narrowed:
it deletes only if the release is still a draft; if a human published it first,
the step errors and leaves the published release intact for manual handling.

## 4. Where it applies

| Workflow → step | Mutation | Guard |
|-----------------|----------|-------|
| `release-desktop.yml` → post-build SBOM guard (`gh release delete --cleanup-tag`) | delete release + tag | delete only if draft; else error, leave published release |
| `release-desktop.yml` → Upload SBOM and attestations (`gh release upload`) | upload assets | assert draft before upload |
| `release-desktop.yml` → Generate SHA-256 sidecars (`gh release upload`) | upload assets | assert draft before upload |
| `release-desktop.yml` → attach-sidecar-sbom job (`gh release upload`) | upload asset (sidecar SBOM) | assert draft before upload |
| `release-tools.yml` → Upload tool archives + SBOM + attestations (`gh release upload`) | upload assets | assert draft before upload |

`release-axiomregent.yml`: **retired** (037/117, amended). `ai-changelog.yml`:
**unchanged** (§1).

## 5. Operator runbook note

The desktop draft should be published **only after both _Release Desktop_ and
_Release Tools_ are green** — that is when the CLI tool archives have finished
attaching. Publishing earlier now fails the _Release Tools_ upload loudly
(rather than silently mutating the published release); the operator re-runs
_Release Tools_ against a fresh draft, or attaches the archives manually, then
publishes.

## 6. Acceptance criteria

- **AC-1.** Before every `gh release upload`/`gh release delete` in
  `release-desktop.yml` and `release-tools.yml`, the workflow asserts the
  target release `isDraft == true` and fails closed (exit 1) otherwise.
- **AC-2.** The `release-desktop.yml` guard-failure delete runs
  `gh release delete --cleanup-tag` **only** when the release is a draft; on a
  published release it errors without deleting.
- **AC-3.** Happy-path behaviour is unchanged: on a normal release run every
  assertion passes (the release is a draft) and the same assets are attached.
- **AC-4.** `ai-changelog.yml` (notes-only edit) is unmodified.
  (`release-axiomregent.yml` is retired by 037/117, amended — no longer a release
  surface; the new `attach-sidecar-sbom` upload site carries the guard, §4.)
- **AC-5.** The coupling gate is satisfied via this spec's `refines` claim over
  both edited workflow files; no Spec-Drift-Waiver is used.

## 7. Out of scope

- **Publishing** any release — remains an operator action (spec 193 §7).
- Restructuring `release-tools` to attach archives *before* the desktop draft
  becomes publishable (e.g. folding tools into the desktop release job, or a
  GitHub Environment with a required reviewer on the publish). The fail-closed
  assertion makes the race *safe*; eliminating the race window is a larger
  structural change deferred to a future spec.
- Reconciliation of the existing stale drafts / already-live releases
  (spec 193 §7, tracked separately).
