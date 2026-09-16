---
id: "193-paired-release-cadence"
slug: paired-release-cadence
title: "Paired release cadence + version-consistency guard (amends 037, 086, 117)"
status: approved
implementation: complete
owner: bart
created: "2026-06-01"
approved: "2026-06-01"
amended: "2026-06-04"
amendment_record: |
  Self-amended 2026-06-04 — axiomregent demotion. axiomregent is no longer an
  independently released product (see 037, amended): it is an internal upstream
  component of OPC, built from OPC's release commit and bundled as a Tauri
  sidecar. The paired train therefore collapses to a SINGLE product. This
  amendment removes the `axiomregent-v*` tag grammar, the cross-product boundary
  invariant (opc.minor == axiomregent.minor — there is no second product to
  pair with), and the guard's axiomregent product arm; the version-consistency
  guard becomes OPC-only. release-axiomregent.yml is retired. The OPC mechanics
  (product-prefixed `opc-v*` tag, draft-first publish, fast-fail version-guard
  job, SBOM assertion) are unchanged.
kind: governance
domain: tooling
risk: medium
amends: ["037-cross-platform-axiomregent", "086-open-source-launch", "117-release-artifact-attestations"]
depends_on:
  - "037-cross-platform-axiomregent"  # cross-platform-axiomregent (axiomregent release matrix)
  - "086-open-source-launch"  # open-source-launch (release-tools fitness baseline)
  - "117-release-artifact-attestations"  # release-artifact-attestations (SBOM + provenance the guard reads)
  - "116-supply-chain-policy-gates"  # supply-chain-policy-gates (the lane the guard wires into)
  - "158-workflow-ref-sha-pinning-lint"  # workflow-ref-sha-pinning-lint (shell-lint-in-tools/lint precedent)
code_aliases: ["RELEASE_CADENCE", "RELEASE_VERSION_GUARD"]
establishes:
  - unit: { kind: file, path: tools/lint/release-version-guard.sh }
  - unit: { kind: file, path: tools/lint/release-version-guard-test.sh }
extends:
  # Mechanical featuregraph-golden refresh: appending spec 193 to the corpus
  # shifts the golden fingerprint. No semantic change to spec 034's claims.
  # Same precedent as spec 187 (PR #272), 167/168/169, 183.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
refines:
  - aspect: "release-version-alignment"
    unit: { kind: file, path: .github/workflows/release-desktop.yml }
  - aspect: "release-version-alignment"
    unit: { kind: file, path: .github/workflows/release-tools.yml }
  - aspect: "release-version-alignment"
    unit: { kind: file, path: .github/workflows/ci-supply-chain.yml }
  - aspect: "release-version"
    unit: { kind: file, path: product/apps/opc/src-tauri/tauri.conf.json }
  - aspect: "release-version"
    unit: { kind: file, path: product/apps/opc/package.json }
  - aspect: "release-version"
    unit: { kind: file, path: product/apps/opc/src-tauri/Cargo.toml }
compliance:
  - framework: "owasp-asi-2026"
    # ASI04 (supply-chain compromise). A release whose envelope version
    # disagrees with its artifact version is an integrity gap: the published
    # version string is unverifiable against the binary it labels. The guard
    # makes envelope == artifact == SBOM a merge- and publish-time contract.
    controls: ["ASI04"]
summary: >
  Establish OPC's release cadence, a product-prefixed tag grammar (opc-v*), and
  a pre-publish version-consistency guard that refuses any release whose tag
  disagrees with its committed version sources or its SBOM. OPC builds a draft
  first so every publish is guard-gated AND human-gated. Closes the class of bug
  where a release envelope (tag) carried one version while the artifacts carried
  a stale committed version (OPC drafts v0.3.5/6/7 shipped 0.3.4 assets).
  Amended 2026-06-04: OPC is the sole release lever — axiomregent is an internal
  upstream component bundled by OPC (037, amended), so the paired cadence and
  the axiomregent-v* tag grammar are retired and the guard is OPC-only.
---

# 193 — OPC release cadence + version-consistency guard

> **Amendment record.** This spec amends **037** (cross-platform axiomregent),
> **086** (open-source-launch release-tools), and **117** (release artifact
> attestations). It does not supersede them: their release mechanics stand. It
> adds (a) a version-consistency contract every release must satisfy and (b) a
> product-prefixed tag grammar. The companion investigation of every
> release-publish path is recorded in
> `docs/analysis/release-publish-paths-2026-06-01.md`.
>
> **Amended 2026-06-04 — single release lever.** axiomregent has been demoted to
> an internal upstream component of OPC (see [037](../037-cross-platform-axiomregent/spec.md),
> amended): it is built from OPC's release commit and bundled as a Tauri
> sidecar, never independently published. **OPC is therefore the sole release
> lever.** The "paired" framing this spec introduced collapses to a single
> product: the `axiomregent-v*` tag grammar, the cross-product boundary
> invariant, draft-first publishing *for axiomregent*, and the guard's
> axiomregent product arm are all **retired**. `release-axiomregent.yml` is
> removed. Everything in this spec now reads as OPC-only; the OPC mechanics are
> otherwise unchanged. _Consequence:_ the duplicate-release-object incident
> class (two release objects on one `axiomregent-v*` tag) is structurally
> eliminated — there is no second product release object to collide.

## 1. Problem Statement

Two version-source families feed a release and nothing asserted they agree:

- The **release envelope** (GitHub Release title + tag) is taken from the git
  tag / `workflow_dispatch` input.
- The **artifacts** are named and stamped from the *committed* version sources
  — `tauri.conf.json` / `package.json` / `Cargo.toml` for OPC (Tauri reads the
  bundle version from `tauri.conf.json`).

Cutting a release without first bumping the committed sources produced a split:
the OPC drafts **v0.3.5 / v0.3.6 / v0.3.7** all carry **0.3.4** assets. The same
class of split previously affected the now-retired standalone axiomregent
releases **v0.3.0 / v0.3.1**, which shipped **0.2.0** binaries from a **live,
immutable** publish (no `--draft`) — burning the mismatch publicly the instant a
`workflow_dispatch` ran. Both motivate the guard below; with axiomregent demoted
to a bundled component (§2, amended) the axiomregent path is moot, so the guard
applies to OPC.

## 2. Cadence policy

OPC is the **sole release lever**. axiomregent is an internal upstream component
bundled into the OPC desktop installer at OPC's release commit
([037](../037-cross-platform-axiomregent/spec.md), amended); it has no
independent product version and no standalone release, so there is no second
cadence to pair with and no cross-product boundary invariant to enforce.

- **OPC versions and cuts on its own cadence.** `opc` carries a single
  `major.minor.patch` identical across `tauri.conf.json` / `package.json` /
  `Cargo.toml` / `Cargo.lock`. The first cut under this spec is `0.4.0`.
- **axiomregent is commit-pinned.** The bundled sidecar rides OPC's release
  commit (build-ref == bundle-ref). Its crate version is not a product version
  and is not load-bearing at runtime (the sidecar boot gate is liveness-only and
  the MCP `serverInfo` version is a static literal), so the guard no longer
  asserts it (§4, amended).

This spec does not automate the bump; it defines the invariant the guard and
reviewers enforce. The bump is an honest committed edit (§4), never a
build-time injection — the source tree always tells the truth about the
version it will ship.

## 3. Tag grammar (naming unification)

The release tag is **product-prefixed**: `<product>-v<semver>`.

| Product | Tag | Trigger workflow |
|---------|-----|------------------|
| OPC desktop | `opc-v<semver>` (e.g. `opc-v0.4.0`) | `release-desktop.yml` |

OPC's bare `v*` grammar is **retired**. The workflow's resolver derives the
product from the prefix (`${TAG%-v*}`) and the version from the suffix
(`${TAG##*-v}`), and rejects a tag whose product is not `opc`. The dependent
`release-tools.yml` `workflow_run` gate keys on
`startsWith(head_branch, 'opc-v')` so the tool-archive chain keeps firing for
desktop releases.

> **Amended 2026-06-04.** The `axiomregent-v*` row is removed — axiomregent is no
> longer independently released (§2; [037](../037-cross-platform-axiomregent/spec.md),
> amended). The product-prefixed grammar is retained for OPC: it future-proofs
> the tag namespace and keeps the `release-tools.yml` gate unambiguous.

## 4. Version-consistency guard (the contract)

`tools/lint/release-version-guard.sh <product> [expected-version] [sbom]` asserts
the version is identical across every source:

```
tag == tauri.conf.json == package.json == Cargo.toml == Cargo.lock ( == SBOM component )
```

- **Internal-consistency mode** (`<product>` only): all committed sources agree
  with one another. Runs in the supply-chain lane (`ci-supply-chain.yml`) on
  every PR, catching a half-done bump before it can reach a release tag.
- **Expected mode** (`<product> <version> [sbom]`): all sources — and the SBOM
  component — equal the resolved tag version. Runs in the release workflows.

Exit `0` = eligible; `1` = mismatch (release NOT eligible); `2` = usage error.
SBOM-component **mismatch** is fatal; SBOM-component **absence** is a warning
(syft component naming is scanner-version dependent and outside this repo's
control). The guard ships with a fixture test
(`release-version-guard-test.sh`) that is its own spec, run in the same lane —
the spec-158 precedent.

> **Amended 2026-06-04 — OPC-only guard.** The `<product>` argument now accepts
> **`opc` only**. The axiomregent arm — which asserted
> `crates/axiomregent/Cargo.toml == Cargo.lock` against an *axiomregent product
> version* — is **dropped**: axiomregent has no product version (§2). Its two
> callers are removed with it (the retired `release-axiomregent.yml`, and the
> `Guard axiomregent version sources` step in `ci-supply-chain.yml`).
> `release-version-guard.sh axiomregent` now exits `2` (unknown product), and
> the fixture test asserts that. The commit-pin the arm would have approximated
> (build-ref == bundle-ref) is structurally guaranteed by `release-desktop.yml`
> building the sidecar from the same checkout that produces the installer — a
> version assertion adds nothing to a single-commit build.

## 5. Publish gating

- **OPC desktop** builds a **draft** (`tauri-action releaseDraft: true`);
  publishing is human-gated. This spec adds a **pre-build** guard (fail-fast,
  before any artifact or draft exists — no version burned on mismatch) and a
  **post-build** SBOM assertion that discards the draft + tag on mismatch.

The result: the OPC release cannot publish with a version the artifacts do not
actually carry, and it does not publish without a human.

> **Amended 2026-06-04.** The former **axiomregent draft-first** bullet is
> removed: there is no standalone axiomregent release to gate
> ([037](../037-cross-platform-axiomregent/spec.md), amended). The sidecar now
> ships inside the OPC draft, under OPC's gating above.

### 5.1 Fast-fail front gate (refinement, 2026-06-01)

The pre-build guard above was first placed as a *step inside* the build job
(`release` for desktop, `publish` for axiomregent). Those jobs `needs:` the
build/sidecar matrix, so GitHub Actions cannot start them — and cannot run the
guard — until the full matrix completes. A mismatched dispatch therefore still
burned the entire matrix (~16m35s of axiomregent cross-compiles for the
`opc-v0.4.1` mismatch test, run `26793968624`; guard executed at `02:24:33Z`
against a run created `02:07:58Z`) before the guard rejected it. Protection
held — the guard fired before tauri-action, so no draft and no desktop build —
but the *fail-fast* intent stated above did not hold: the sidecar matrix is the
real cost, and an in-job step cannot pre-empt the job's own `needs:`.

The guard reads only committed sources (`tauri.conf.json` / `package.json` /
`Cargo.toml` / `Cargo.lock`), which are present in a bare checkout, so it needs
no build output. This spec therefore requires the committed-source check to run
as a **standalone `version-guard` job that the entire build/sidecar matrix
`needs:`** — the structural front gate. A mismatch now dies in ~30s with zero
build minutes burned, no draft, no tag. The in-job guards are **retained as
defense-in-depth**: the desktop `release` job re-checks its own checkout before
tauri-action, and (historically) the axiomregent `publish` job kept the
**SBOM-component** assertion the front gate cannot see. The post-build SBOM guard
(build-time drift) is unchanged. See `docs/analysis/release-prebuild-guard-fastfail-2026-06-01.md`.

> _Amended 2026-06-04._ The axiomregent `publish`-job half of this narrative is
> historical — `release-axiomregent.yml` is retired (§2). The standalone
> `version-guard` front gate it motivated remains in `release-desktop.yml`
> (OPC-only). The SBOM-component assertion the front gate cannot see now lives in
> the desktop post-build SBOM guard, which additionally covers the bundled
> sidecar via the merged installer SBOM ([117](../117-release-artifact-attestations/spec.md), amended).

## 6. Acceptance criteria

- **AC-1.** `release-version-guard.sh opc` exits `0` on the committed tree
  (`0.4.0`); `release-version-guard.sh axiomregent` exits `2` (unknown product);
  the fixture test passes.
- **AC-2.** `release-desktop.yml` resolves `<product>` and `<version>` from a
  prefixed tag and rejects a tag whose product is not `opc`.
- **AC-3.** `release-desktop.yml` triggers on `opc-v*`; `release-tools.yml`'s
  `workflow_run` gate keys on `opc-v`.
- **AC-4.** No standalone axiomregent release exists: `release-axiomregent.yml`
  is removed and no `axiomregent-v*` tag grammar remains in any workflow.
- **AC-5.** `ci-supply-chain.yml` runs the internal-consistency guard for
  **opc** and the fixture test on every PR (the axiomregent guard step is
  removed).
- **AC-6.** Committed OPC version: `opc = 0.4.0` across tauri.conf.json /
  package.json / Cargo.toml / Cargo.lock.
- **AC-7.** `release-desktop.yml` gates the entire build/sidecar matrix on a
  standalone `version-guard` job (committed-source check, no build output); a
  tag-vs-committed mismatch fails before any build/sidecar job starts (§5.1).
  The in-job pre-build guard and the post-build SBOM guard are retained as
  defense-in-depth.

## 7. Out of scope (human-gated, deferred)

- Cutting and **publishing** the `opc-v0.4.0` release. This spec lands the
  mechanism; the first publish is an operator action, additionally blocked until
  the release-publish-path investigation
  (`docs/analysis/release-publish-paths-2026-06-01.md`) is resolved and the
  publish path is controlled.
- Cleanup of the existing stale OPC drafts (`v0.3.5/6/7`) — remediation, tracked
  separately. The already-live `axiomregent-v0.3.0/v0.3.1` releases/tags remain
  **burned names (off-limits)**; with the standalone axiomregent release retired
  (§2; [037](../037-cross-platform-axiomregent/spec.md), amended) there is no
  further axiomregent-release reconciliation to do — those objects are frozen as
  historical.
