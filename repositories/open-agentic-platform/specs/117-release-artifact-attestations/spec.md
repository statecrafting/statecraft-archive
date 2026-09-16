---
id: "117-release-artifact-attestations"
slug: release-artifact-attestations
title: Release Artifact Attestations — SBOM + build provenance for every shipped binary
status: approved
implementation: complete
owner: bart
created: "2026-04-28"
kind: governance
domain: tooling
risk: medium
amended: "2026-06-04"
amendment_record: |
  Re-amended 2026-06-04 — axiomregent demotion. axiomregent is no longer an
  independently released product (037, amended); release-axiomregent.yml is
  removed. The standalone axiomregent SBOM/attestation surface this spec
  established on that workflow is retired, and the §2 goal "the desktop installer
  SBOM includes the bundled sidecar's contents" — previously unmet — is now BOUND
  to the desktop flow: axiomregent's CycloneDX SBOM is generated within
  release-desktop.yml and linked into the per-target installer SBOM via a
  CycloneDX externalReferences BOM-Link, with the sidecar SBOM attached to the
  same release. Because the sidecar is built at OPC's release commit
  (build-ref == bundle-ref), single-commit provenance covers it — no build-ref→
  bundle-ref span clause is needed. The prior amendment (193) added the
  version-alignment gate; that is unchanged for OPC.
  Same-day correction: the bundled-sidecar SBOM recipe (§2.1) as merged scanned
  `crates/` while the workspace lock lands at repo-root ./Cargo.lock, yielding 0
  components; it now stages the lock into the scan path and AC-6 is enforced
  in-workflow by a component-count gate (see §2.1 provenance correction + AC-6
  lesson #4).
  Same-day correction #2 (desktop installer SBOM scope + attestation subject set):
  the per-target desktop SBOM scanned `product/apps/opc`, one level BELOW the pnpm
  workspace lock (product/pnpm-lock.yaml), so it captured only tests-e2e test deps
  (2 npm) and UNDER-reported the shipped frontend closure (~784 npm); the same
  post-build scan reached INTO src-tauri/target/, OVER-reporting non-reproducible
  MSVC proc-macro DLLs as ~230 purl-less components on Windows. Both are one
  mis-scoped scan — corrected to scope `product/` (reaches pnpm-lock.yaml;
  src-tauri/Cargo.lock cargo coverage unchanged at 961) and prune build-tree
  artifacts with jq (syft `--exclude` is a no-op for target/ in syft 1.43.0). Two
  fail-closed AC-6 gates now enforce npm>0 and zero build-tree components.
  Separately the provenance attestation + per-installer .intoto.jsonl subject set
  is extended from dmg/appimage/nsis to ALSO cover deb/rpm/msi, so every shipped
  installer is attested (AC-2/AC-4); the .sha256 updater sidecars remain
  deliberately updater-scoped (dmg/nsis/appimage). See §2.2 desktop-scope
  correction, §4.2, AC-6 lesson #5, and the amended AC-2/AC-4/AC-6.
depends_on:
  - "000-bootstrap-spec-system"  # bootstrap-spec-system
  - "037-cross-platform-axiomregent"  # cross-platform-axiomregent (sidecar build + bundle; SBOM source)
  - "086-open-source-launch"  # open-source-launch (release-fitness baseline)
  - "104-makefile-ci-parity-contract"  # makefile-ci-parity-contract
code_aliases: ["RELEASE_ATTESTATIONS"]
refines:
  - aspect: "artifact-attestation"
    unit: { kind: file, path: .github/workflows/release-desktop.yml }
  - aspect: "artifact-attestation"
    unit: { kind: file, path: .github/workflows/release-tools.yml }
summary: >
  Every binary shipped via release-{desktop,tools}.yml is paired with a
  CycloneDX SBOM and a GitHub-signed build provenance attestation. SBOMs and
  attestations are uploaded as release assets. The desktop installer SHA-256
  sidecars (already present) are kept; the attestations cover the binaries
  themselves and document the toolchain, dependencies, and build environment
  that produced them. The OPC installer SBOM includes the bundled axiomregent
  sidecar's contents — generated in the desktop flow and bound via a CycloneDX
  externalReferences BOM-Link (amended 2026-06-04, after axiomregent was demoted
  to an internal bundled component and release-axiomregent.yml retired).
---

# 117 — Release Artifact Attestations

> **Amended by [193-paired-release-cadence](../193-paired-release-cadence/spec.md) (2026-06-01).**
> The release-{desktop,tools} workflows this spec refines now run a pre-publish
> version-consistency guard (tag == committed sources == SBOM). The attestation
> contract here is unchanged; spec 193 adds the version-alignment gate around it.
>
> **Amended 2026-06-04 — axiomregent demotion + sidecar-SBOM binding.**
> axiomregent is demoted to an internal upstream component bundled by OPC
> ([037](../037-cross-platform-axiomregent/spec.md), amended) and
> `release-axiomregent.yml` is **removed**, so this spec no longer attests a
> standalone axiomregent release. The standalone `sbom-axiomregent.cdx.json` was
> the *only* CycloneDX coverage of the sidecar; retiring it would drop that
> coverage. To prevent that, the §2 goal — "the desktop installer SBOM includes
> the bundled sidecar's contents" (previously unmet) — is now **bound to the
> desktop flow**: axiomregent's SBOM is generated inside `release-desktop.yml`
> (the same proven generation lifted from the retired workflow) and **linked**
> into each per-target installer SBOM via a CycloneDX `externalReferences`
> BOM-Link, with `sbom-axiomregent.cdx.json` attached to the same release. See
> §2 and §4.2 (amended) for the mechanism and the merge-vs-reference rationale.
> Because the sidecar is built at OPC's release commit (build-ref == bundle-ref),
> single-commit provenance already covers it — **build-once makes this spec
> simpler, not harder**: no build-ref→bundle-ref span clause is required (§7,
> amended).

## 1. Problem Statement

The release workflows ship binaries that downstream users will install on their
own machines:

- `release-desktop.yml` — Tauri desktop installers (DMG, AppImage, NSIS) for
  three platforms, with the axiomregent sidecar embedded. _(Amended 2026-06-04:
  axiomregent is bundled here only — there is no standalone axiomregent release;
  `release-axiomregent.yml` is retired. See 037, amended.)_
- `release-tools.yml` — five Rust CLI tools per target triple, packaged as
  archives.

The desktop installer flow has already implemented SHA-256 sidecars (read by
the in-app updater). That covers **integrity** of the installer download
itself. It does not cover:

- **Provenance** — there is no signed claim asserting "this binary was built
  by the open-agentic-platform repo, by workflow X, at commit Y, by the
  GitHub-hosted runner whose attestor key signed it."
- **Inventory** — there is no SBOM listing the crates and JS packages that
  went into each binary. A downstream user cannot answer "is this affected
  by RUSTSEC-2026-XXXX?" without rebuilding from source.

GitHub now ships first-class primitives for both:

- `actions/attest-build-provenance@v2` produces an in-toto SLSA v1.0
  provenance attestation, signed by the runner's identity, anchored to a
  Sigstore transparency log.
- `anchore/sbom-action@v0` produces CycloneDX or SPDX SBOMs from a path or
  a Docker image.

For a project whose framing is **governed operating system**, shipping
unattested binaries is incongruent. This spec closes that gap on every
release surface in one pass.

## 2. Goals

- **Every release asset carries an attestation.** The four axiomregent
  binaries, the three desktop installers, and the per-platform tool
  archives each have a corresponding `*.intoto.jsonl` provenance attestation
  attached to the same GitHub Release.
- **Every release asset has an SBOM.** A `*.cdx.json` (CycloneDX) sibling
  per artifact lists every crate and version. For the desktop installer,
  the SBOM includes the bundled sidecar's contents — see **§2.1** for the
  mechanism that binds this to the desktop flow (amended 2026-06-04).
- **Verification is documentable.** A `docs/RELEASE-VERIFICATION.md` doc at repo
  root explains the verification flow:
  `gh attestation verify <file> --repo <repo>`.
- **No new Makefile target.** Attestations are CI-only — they are produced
  by GitHub-hosted runner identity, not reproducible locally. The Makefile
  is unchanged; the three workflows gain steps; ci-parity-check skips the
  attestation steps via an allowlist.
- **Failure is loud.** A failed attestation step fails the release job. A
  silent skip is a regression.

### 2.1 Sidecar-SBOM binding (amended 2026-06-04)

**Problem.** The desktop installer SBOM (`sbom-desktop-<target>.cdx.json`) is
generated by scanning `product/apps/opc`, whose Cargo.lock is the OPC src-tauri
workspace lock. axiomregent lives in the **root** workspace
(`crates/axiomregent`, root `Cargo.lock`), so its dependencies (octocrab,
hiqlite, fastembed, …) are absent from the desktop scan. The §2 goal "the
installer SBOM includes the bundled sidecar's contents" was therefore **unmet**
— and was only ever *partially* compensated by the standalone
`sbom-axiomregent.cdx.json` that `release-axiomregent.yml` produced. Demoting
axiomregent (037, amended) removes that workflow, so without this binding the
sidecar would have **zero** SBOM coverage.

**Mechanism (chosen): generate-once + reference (CycloneDX BOM-Link).**

1. **Generate ONCE** in a standalone `axiomregent-sbom` job (gated on
   `version-guard`, `runs-on: ubuntu-latest`). The recipe — originally lifted
   from the retired `release-axiomregent.yml` and described as "the steps §AC-6
   validated to a populated component count" (a description now withdrawn; see
   the provenance correction below) — is: `cargo generate-lockfile
   --manifest-path Cargo.toml`, **stage the workspace lock into the scan path**
   (`cp Cargo.lock crates/Cargo.lock` — `crates/` is a workspace *member
   subtree*, and syft's `rust-cargo-lock-cataloger` reads only a `Cargo.lock`
   inside the scan path, never an ancestor), then `anchore/sbom-action`
   (pinned ≥ v0.24.0) scanning `crates`, then a **fail-closed component-count
   assertion** (AC-6). The result is uploaded as a workflow artifact. **Single
   source of truth** — the per-target `release` legs do **not** regenerate it.
   This is deliberate: regenerating the SBOM in each of the three matrix legs
   (macOS/Linux/Windows) would (a) be non-deterministic — three syft runs on
   different runner OSes can differ in field ordering/metadata, and the
   `--clobber` upload winner would be a job-completion race — and (b) waste ~2×
   the syft work on the already-expensive cross-compile matrix. One generation →
   identical bytes and identical `serialNumber` (hence identical BOM-Link URN)
   across every leg. No new SBOM-generation logic is invented — it is relocated,
   not redesigned. The scan captures the whole-workspace Rust closure (a
   superset of axiomregent's link set); narrowing to the sidecar's own subgraph
   is a deferred design change, not part of this correction.

   > **Provenance correction (2026-06-04).** This recipe was carried over from
   > `release-axiomregent.yml` and described above as steps "§AC-6 validated to
   > a populated component count." That description is withdrawn — it is not
   > supported by the AC-6 record. Smoke runs #1–#3 each returned 0 components
   > on a clean CI checkout; the catalogers and scopes were still changing
   > between runs, and the final scan-`crates/` recipe was adopted only after #3
   > (per lesson #3's "now scans `crates/` rather than `crates/axiomregent`")
   > with no green smoke on record. The only >0 result (661) came from local
   > runs that lesson #3 attributes to a cached `target/`, not a clean checkout;
   > and no published axiomregent release ever exercised the path. A clean
   > `git archive` reproduction confirms the recipe as written (scan `crates/`,
   > workspace lock committed at repo-root only) yields 0 components, and 855
   > after staging the lock into the scan path. AC-6 is now enforced in-workflow
   > by a component-count gate rather than asserted in prose. See lesson #4.
2. **Reference** it from each `sbom-desktop-<target>.cdx.json` by adding a
   CycloneDX `externalReferences` entry of type `bom` whose `url` is a
   **conformant BOM-Link URN** — `urn:cdx:<serialNumber>/<version>` derived from
   the sidecar SBOM's own `serialNumber` (the CycloneDX-sanctioned machine-
   resolvable form, recognised by cyclonedx-cli / Dependency-Track), not a bare
   filename. The co-attached filename is carried in the `comment` for human
   resolution. (If the sidecar SBOM lacks a `serialNumber`, the bind falls back
   to the relative filename — a still-valid `iri-reference` external reference,
   just not a formal URN.)
3. **Attach** `sbom-axiomregent.cdx.json` to the same release **once**, in a
   dedicated post-matrix `attach-sidecar-sbom` job (`needs: [release]`) under the
   spec-194 draft guard, so the BOM-Link resolves and an auditor has the sidecar's
   full component list co-located with the installer. A post-matrix job attaches
   it exactly once **and** robustly — not redundantly from every leg (3× identical
   `--clobber`), and not fragilely from a single leg whose failure would silently
   drop the asset. It runs only when the full matrix succeeded (i.e. the draft is
   complete and publishable).

**Why reference, not merge.** The two CycloneDX-native options are a
`cyclonedx-cli merge` (embed the sidecar's components into the installer BOM) or
an `externalReferences` BOM-Link (declare + co-attach). Reference is chosen
because: (a) it is implemented with `jq`, already used across these workflows,
so it is portable across the macOS/Linux/Windows `release` matrix with **zero
new binary supply-chain surface** — a `cyclonedx-cli` binary download per matrix
OS would add exactly the kind of unpinned, un-attested dependency this spec
exists to eliminate; (b) it keeps the sidecar BOM independently verifiable
rather than dissolving it into a flat union; (c) it restores the coverage the
retired workflow provided (a complete, attached sidecar BOM) **and** binds it to
the installer, closing the §2 gap. The richer embed-merge is recorded here as
the future option if inline component enumeration in the single installer file
becomes a hard requirement.

### 2.2 Desktop installer SBOM scope correction (2026-06-04)

**Problem (two faces, one cause).** The per-target desktop SBOM
(`sbom-desktop-<target>.cdx.json`) was generated by scanning `product/apps/opc`.
That single mis-scoped path produced two defects:

- **Under-report (npm) — the dangerous direction.** `product/apps/opc` sits one
  level *below* the pnpm workspace lock at `product/pnpm-lock.yaml`. syft's
  javascript catalogers read a lock *inside* the scan path, never an ancestor —
  the same ancestor-walk limitation recorded for `Cargo.lock` in AC-6 lesson #4.
  So the only npm lock in scope was `product/apps/opc/tests-e2e/package-lock.json`
  — **2 test-only components** — while the frontend closure that actually ships
  in the installer (~784 npm from the workspace lock) was silently omitted. A
  consumer asking "is this installer affected by npm advisory X?" got a false
  negative.
- **Over-report (target/).** The SBOM is generated *after* the Tauri build, so
  `product/apps/opc/src-tauri/target/` exists in the scan path. On the MSVC build
  syft catalogs compiled proc-macro DLLs under `target/release/deps/` as ~230
  purl-less `application` components named by their per-build-hashed path (e.g.
  `serde_derive-<hash>.dll`). They are non-reproducible, duplicate crates already
  present as `pkg:cargo` purls, and do not ship in the installer. macOS/Linux
  catalog 0 such entries (2–8 no-purl, all source manifests), so the SBOM was
  platform-inconsistent as well as misleading. This is softer than the
  under-report — the 961 `pkg:cargo` purls are correct and complete — but the
  SBOM is not reproducible.

**Fix (one corrected scope + a deterministic prune).**

1. **Scope to `product/`.** It contains *both* authoritative locks —
   `product/pnpm-lock.yaml` (frontend closure) and
   `product/apps/opc/src-tauri/Cargo.lock` (961 cargo, unchanged) — so one scan
   covers both ecosystems. Verified on a clean `git archive` export: npm 2 → 792
   (784 workspace closure + 8 near-empty sibling/test locks), cargo 961
   unchanged. `node_modules` does not inflate the count — syft sources every npm
   component from the lockfiles — so the result is stable post-`pnpm install`.
2. **Prune build-tree artifacts with `jq`.** syft's own `--exclude` does NOT
   remove them: in syft 1.43.0 a valid `**/target/**` glob is a silent no-op, and
   a directory-form pattern errors the scan (`invalid exclusion pattern(s) … must
   start with one of: './', '*/', or '**/'`). A `jq` filter — already the
   workflow's tool for the sidecar BOM-Link, so **no new binary** and byte-stable
   output — drops any component whose name or *every* syft location lies under a
   `target/` build tree (forward- and back-slash). On macOS/Linux it is a no-op;
   on Windows it removes the proc-macro DLL entries, restoring platform
   consistency and reproducibility.
3. **Fail-closed gates (AC-6).** `npm > 0` catches a scope regression back below
   the workspace lock; `build-tree == 0` catches a prune/scope regression that
   readmits `target/` artifacts. Both run before upload, mirroring the
   sidecar-SBOM component-count gate added in the same-day #1 correction.

**Scope note (whole-workspace superset).** The npm set is the pnpm *workspace*
closure — a superset of OPC's production runtime closure (it includes dev tooling
such as `@anthropic-ai/claude-code` and sibling workspace packages). This is the
same superset caveat already accepted for the bundled-sidecar Rust SBOM (§2.1);
narrowing to OPC's production subgraph (e.g. via `pnpm --filter` deploy
resolution) is a deferred design change, not part of this correction.

## 3. Scope

### In scope

- `release-desktop.yml`: SBOM + provenance per installer artifact, after
  Tauri Action completes, before SHA-256 sidecar generation. Provenance covers
  **every shipped installer** — DMG, AppImage, NSIS `.exe`, **and** `.deb`,
  `.rpm`, `.msi` (corrected 2026-06-04 §2.2; the prior dmg/appimage/nsis-only
  subject set left deb/rpm/msi unattested). The per-target SBOM is scoped to
  `product/` and pruned of `target/` build-tree artifacts (§2.2). **Plus (amended
  2026-06-04):** the bundled-sidecar SBOM generation and the `externalReferences`
  BOM-Link binding it into each installer SBOM (§2.1).
- `release-tools.yml`: SBOM + provenance per archive (`oap-tools-*.tar.gz`,
  `oap-tools-*.zip`).
- `docs/RELEASE-VERIFICATION.md` documenting the verification commands.
- `ci-parity-check` allowlist update for the attestation step names so the
  parity gate doesn't flag them as missing-from-Makefile.

_Removed 2026-06-04:_ `release-axiomregent.yml` SBOM + provenance — the
standalone axiomregent release is retired (037, amended); its SBOM generation is
relocated into `release-desktop.yml` per §2.1.

### Out of scope

- Cosign signing of binaries. GitHub's attest-build-provenance uses
  Sigstore under the hood; a separate cosign workflow is unnecessary for
  v1.
- Reproducible builds (bit-for-bit identical rebuilds). A future spec.
- Container image attestations. Statecraft and deployd-api images already
  flow through `cd-{statecraft,deployd-api-rs}.yml`; image attestations are
  a candidate follow-up but out of scope here (this spec covers release
  binaries only).
- Distribution-time trust anchors (Homebrew, winget). Out of scope.

## 4. Workflow Shape

Each subject is attested in its own `actions/attest-build-provenance` step
so the action's `bundle-path` output names a single-subject bundle file
that can be staged under the subject's name (`<subject>.intoto.jsonl`).
A glob `subject-path` produces a single multi-subject bundle whose
filename is unrelated to the subject names — that conflicts with the
AC-1/2/3 requirement to surface per-target `*.intoto.jsonl` files as
release assets and conflicts with `gh attestation download`'s default
`sha256:<digest>.jsonl` output naming. Per-step attestation is the
canonical shape.

### 4.1 release-axiomregent.yml — RETIRED (amended 2026-06-04)

> **Retired.** `release-axiomregent.yml` is removed (037, amended): there is no
> standalone axiomregent release to attest. The SBOM generation below is **not
> deleted but relocated** — it is lifted verbatim into `release-desktop.yml` and
> bound into the installer SBOM per **§2.1 / §4.2**. The per-target binary
> attestations it carried are subsumed by the desktop installer attestation
> (the sidecar binary is built and bundled in the same single-commit desktop
> run; build-ref == bundle-ref, §7). The block below is retained as the
> canonical record of the lifted generation step.

The (former) publish job inserted, after `actions/download-artifact` and before
`gh release create`, SBOM generation, four per-target attestation steps, and a
stage step copying each step's `bundle-path` output to a per-target file in
`dist/`:

```yaml
- name: Generate SBOM (CycloneDX)
  uses: anchore/sbom-action@<pinned-sha>  # v0.24.0+
  with:
    path: crates
    format: cyclonedx-json
    output-file: dist/sbom-axiomregent.cdx.json

- name: Attest aarch64-apple-darwin provenance
  id: attest-darwin-arm64
  uses: actions/attest-build-provenance@<pinned-sha>  # v4
  with:
    subject-path: dist/axiomregent-aarch64-apple-darwin
# ... three more per-target attestation steps ...

- name: Stage per-target attestation bundles for release
  run: |
    cp "${{ steps.attest-darwin-arm64.outputs.bundle-path }}" \
      dist/axiomregent-aarch64-apple-darwin.intoto.jsonl
    # ... three more cp commands ...
```

### 4.2 release-desktop.yml (per-target release job)

Per matrix-target the bundle dir holds every installer that platform ships —
macOS: DMG; Linux: AppImage + `.deb` + `.rpm`; Windows: NSIS `.exe` + `.msi`
(corrected 2026-06-04 §2.2). A single `attest-build-provenance` call takes all of
them as subjects and emits one multi-subject `bundle-path`; the stage step copies
that bundle to each installer's sibling `<installer>.intoto.jsonl`. A
multi-subject bundle verifies for **any** of its subjects, so
`gh attestation verify` succeeds against each shipped installer (AC-4). The
`*.sha256` updater sidecars remain untouched (regression guard for AC-2) and stay
**deliberately updater-scoped** — DMG / NSIS setup.exe / AppImage only, the set
`updater.rs` downloads; deb/rpm/msi get provenance + SBOM but no `.sha256`
(documented in RELEASE-VERIFICATION.md so the narrower set reads as intentional).

**Amended 2026-06-04 — bundled-sidecar SBOM binding (§2.1).** The axiomregent
SBOM is generated **once** in the standalone `axiomregent-sbom` job (§2.1); each
per-target `release` leg **downloads** that single artifact and BOM-Links it into
its installer SBOM via an `externalReferences` entry whose `url` is a conformant
`urn:cdx:<serialNumber>/<version>` URN derived from the sidecar SBOM. The sidecar
SBOM is co-attached to the release inside the existing draft-guarded upload step
(spec 194). The bind is a `jq` edit — portable across the macOS/Linux/Windows
matrix, no new binary tool — and is deterministic because all legs consume the
one generated artifact.

```yaml
- name: Generate installer SBOM
  uses: anchore/sbom-action@<pinned-sha>
  with:
    path: product            # §2.2 — workspace root: reaches product/pnpm-lock.yaml
    format: cyclonedx-json    #        AND src-tauri/Cargo.lock (both ecosystems)
    output-file: product/apps/opc/src-tauri/target/sbom-desktop-${{ matrix.target }}.cdx.json

# §2.2 — prune target/ build-tree artifacts (syft --exclude is a no-op for them); jq, no new binary
- name: Prune build-tree artifacts from desktop SBOM
  run: |
    jq 'def ut($s): ($s|type=="string") and (($s|test("/target/")) or ($s|test("\\\\target\\\\")));
        .components |= map([ (.properties//[])[]|select(.name|test("syft:location.*:path"))|.value ] as $p
                           | select( (ut(.name)|not) and all($p[]; ut(.)|not) ))' "$sbom" > "$sbom.tmp" && mv "$sbom.tmp" "$sbom"

# §2.2 / AC-6 — fail-closed scope gates: frontend present, no build-tree artifacts
- name: Assert desktop SBOM scope
  run: |
    [ "$(jq '[.components[]|select(.purl//""|startswith("pkg:npm"))]|length' "$sbom")" -gt 0 ] || exit 1
    [ "$(jq '[.components[]|select((.name|test("/target/|\\\\target\\\\")) or (any((.properties//[])[]|select(.name|test("location.*path"))|.value; test("/target/|\\\\target\\\\"))))]|length' "$sbom")" -eq 0 ] || exit 1

# amended 2026-06-04 — download the once-generated sidecar SBOM (axiomregent-sbom job)
- name: Download bundled-sidecar SBOM
  uses: actions/download-artifact@<pinned-sha>
  with:
    name: sbom-axiomregent
    path: product/apps/opc/src-tauri/target/
# Bind via a conformant CycloneDX BOM-Link URN (jq — matrix-portable, no new binary)
- name: Generate installer SBOM bundled-sidecar BOM-Link (CycloneDX)
  shell: bash
  run: |
    sbom="product/apps/opc/src-tauri/target/sbom-desktop-${{ matrix.target }}.cdx.json"
    side="product/apps/opc/src-tauri/target/sbom-axiomregent.cdx.json"
    sn="$(jq -r '.serialNumber // empty' "$side" | sed 's#^urn:uuid:##')"
    ver="$(jq -r '.version // 1' "$side")"
    if [ -n "$sn" ]; then link="urn:cdx:$sn/$ver"; else link="sbom-axiomregent.cdx.json"; fi
    jq --arg link "$link" '.externalReferences = ((.externalReferences // []) + [{
          "type": "bom", "url": $link,
          "comment": "Bundled axiomregent sidecar SBOM (CycloneDX BOM-Link; co-attached as sbom-axiomregent.cdx.json; spec 117 §2.1)"
        }])' "$sbom" > "$sbom.tmp" && mv "$sbom.tmp" "$sbom"

- name: Attest installer provenance
  id: attest-installer
  uses: actions/attest-build-provenance@<pinned-sha>
  with:
    subject-path: ${{ steps.installers.outputs.paths }}

- name: Stage per-installer attestation bundle
  run: |
    cp "${{ steps.attest-installer.outputs.bundle-path }}" \
      "${INSTALLER}.intoto.jsonl"

- name: Upload SBOM and attestations to release
  run: |
    gh release upload "$TAG" \
      "<sbom path>" "<installer path>.intoto.jsonl" \
      --clobber --repo "$GITHUB_REPOSITORY"
```

### 4.3 release-tools.yml (publish job)

After archives are packaged: SBOM step, three per-archive attestation
steps, a stage step that copies each `bundle-path` to
`<archive>.intoto.jsonl`, and the existing
`gh release upload "$TAG" release/*` picks up archives, SBOM, and
attestations in one shot.

```yaml
- name: Generate tools SBOM (CycloneDX)
  uses: anchore/sbom-action@<pinned-sha>
  with:
    path: src/tools
    format: cyclonedx-json
    output-file: release/sbom-tools.cdx.json

- name: Attest aarch64-apple-darwin archive provenance
  id: attest-tools-darwin
  uses: actions/attest-build-provenance@<pinned-sha>
  with:
    subject-path: release/oap-tools-aarch64-apple-darwin.tar.gz
# ... two more per-archive attestation steps ...

- name: Stage per-archive attestation bundles
  run: |
    cp "${{ steps.attest-tools-darwin.outputs.bundle-path }}" \
      release/oap-tools-aarch64-apple-darwin.tar.gz.intoto.jsonl
    # ... two more cp commands ...
```

## 5. Verification Flow (RELEASE-VERIFICATION.md)

A standalone markdown doc at repo root, linked from README.md and from the
release notes template, documents:

```bash
# Verify provenance (desktop installer — the single attested release subject)
gh attestation verify path/to/opc_<version>_aarch64.dmg \
  --repo statecrafting/open-agentic-platform

# Inspect the installer SBOM, then the co-attached bundled-sidecar SBOM it BOM-Links to
jq '.components | length' sbom-desktop-aarch64-apple-darwin.cdx.json
jq -r '.externalReferences[] | select(.type=="bom") | "\(.url)  (\(.comment))"' \
  sbom-desktop-aarch64-apple-darwin.cdx.json
  # -> urn:cdx:<serialNumber>/1  (co-attached as sbom-axiomregent.cdx.json)
jq -r '.serialNumber' sbom-axiomregent.cdx.json   # the BOM-Link URN's serialNumber
jq '.components | length' sbom-axiomregent.cdx.json
```

Plus the equivalent flow without `gh` (using `cosign verify-blob` against
the Sigstore Rekor log).

## 6. Acceptance Criteria

- **AC-1 (amended 2026-06-04):** There is no standalone axiomregent release.
  `release-axiomregent.yml` is removed and no `axiomregent-v*` tag produces a
  release. The sidecar's SBOM coverage is preserved via the desktop binding
  (AC-2, §2.1) and its provenance via the single-commit desktop attestation
  (build-ref == bundle-ref, §7).
- **AC-2 (amended 2026-06-04; subject set extended 2026-06-04 §2.2):** A push of
  `opc-v<semver>` produces a GitHub Release with: **every shipped installer**
  (DMG, AppImage, NSIS `.exe`, `.deb`, `.rpm`, `.msi`), a matching
  `<installer>.intoto.jsonl` for **each** of them (the prior dmg/appimage/nsis-only
  subject set left deb/rpm/msi unattested), per-target installer SBOMs, the
  existing `*.sha256` sidecars (regression guard — the new flow does not displace
  the updater integrity hashes; these remain **deliberately updater-scoped** to
  DMG/NSIS/AppImage, the set `updater.rs` downloads), AND a
  `sbom-axiomregent.cdx.json` that each installer SBOM references via a CycloneDX
  `externalReferences` BOM-Link (§2.1).
- **AC-3:** `release-tools.yml` follow-up run produces a `sbom-tools.cdx.json`
  and per-archive attestations, attached to the same release as `release-desktop`
  (sequencing is handled in spec H Phase 3.2 / M8 of the parent plan).
- **AC-4 (subject set extended 2026-06-04 §2.2):** `gh attestation verify`
  returns `Verification succeeded` for **each** shipped installer — including
  `.deb`, `.rpm`, and `.msi` (previously: "no attestation found" for those three)
  — with provenance pointing to the correct workflow, repo, and commit SHA.
- **AC-5:** `make ci-parity` does not flag the new workflow steps as
  missing-from-Makefile (the parity allowlist explicitly exempts steps
  whose name matches `^(Generate|Attest).*` in release-* workflows).
- **AC-6 (extended 2026-06-04 §2.2):** SBOM components count > 0 for every
  emitted SBOM (sanity check that the action ran against a populated artifact
  dir). For the **desktop** SBOM specifically, two further checks are enforced
  fail-closed in `release-desktop.yml` before upload:
  **(a)** `pkg:npm` component count > 0 — the shipped frontend closure must be
  present (guards the §2.2 under-report: a scope that slips below
  `product/pnpm-lock.yaml` collapses npm to ~2); and
  **(b)** zero components sourced from a `target/` build tree, by component name
  or any syft location (guards the §2.2 over-report: non-reproducible MSVC
  proc-macro DLLs). Both are operationalized as gates, not asserted in prose —
  the same posture as the sidecar-SBOM component-count gate (same-day #1
  correction).

  **Lessons from the smoke runs (2026-04-29):**

  1. Pointing `anchore/sbom-action` at the staged `dist/` of stripped
     release binaries yields a zero-component SBOM because syft cannot
     recover crate metadata from stripped Rust binaries. Scope `path:` to
     the source tree (e.g. `crates/axiomregent`, `product/apps/opc`, `tools/`)
     where `Cargo.toml` and `Cargo.lock` give syft something to
     enumerate.
  2. Source-tree scope still returned 0 components on
     `axiomregent-v0.0.1-attestation-smoke` because `anchore/sbom-action@v0.17.8`
     ships syft 1.11.1, whose Rust cataloger silently no-ops on `Cargo.lock`
     in some directory shapes. Local syft 1.43.0 against the same path
     returned 661 components. Action MUST be pinned to v0.24.0+ (ships
     syft 1.30+).
  3. After the action bump, smoke #3
     (`axiomregent-v0.0.2-attestation-smoke`) STILL returned 0 components.
     Root cause: `crates/Cargo.lock` is gitignored (Rust convention for
     library workspaces — see project `.gitignore` line 10), so a fresh CI
     checkout has no lockfile for syft's `rust-cargo-lock-cataloger` to
     walk. Local repros showed 661 components only because the developer's
     working tree had a cached `target/` directory. Workflows that scan a
     workspace member crate MUST run `cargo generate-lockfile
     --manifest-path <workspace>/Cargo.toml` before the SBOM step, and
     scan the workspace root (where the lockfile lands) — not the member
     crate. axiomregent now scans `crates/` rather than `crates/axiomregent`.

  4. **Correction (2026-06-04).** Lesson #3 is internally inconsistent and
     records no green CI validation. It states the right principle — "scan the
     workspace root (where the lockfile lands)" — then mis-applies it as
     "axiomregent now scans `crates/`": `crates/` is a workspace *member*
     subtree, not the workspace root. The single authoritative lock is committed
     at repo-root `./Cargo.lock` (spec 116; `.gitignore:18` re-includes the root
     lock while `:16` ignores `crates/Cargo.lock`), which lies outside the
     `crates/` scan path — so syft finds no lock and catalogs 0 Rust components.
     This is consistent with smokes #1–#3, all of which returned 0; the
     661-component figure (lessons #2–#3) came from local runs, which lesson #3
     attributes to a cached `target/`, not a clean checkout — so the recipe was
     never validated green in CI. Lesson #3's stated cause ("`crates/Cargo.lock`
     is gitignored → no lockfile in CI") is also imprecise: the workspace lock
     *is* present in CI, at the repo root — just outside the scanned member
     subtree. Confirmed by clean `git archive` reproduction: 0 components
     scanning `crates/`, 855 after `cp Cargo.lock crates/Cargo.lock`. The §2.1
     recipe now stages the lock into the scan path, and AC-6 is enforced
     in-workflow by a `.components | length > 0` gate.

  5. **Desktop SBOM scope (2026-06-04).** Lesson #4's ancestor-walk limitation
     ("syft reads a lock *inside* the scan path, never an ancestor") applies to
     the javascript catalogers too. The desktop SBOM scanned `product/apps/opc`,
     one level below `product/pnpm-lock.yaml`, so it saw only the `tests-e2e`
     lock (**2 npm**) and missed the ~784-component frontend closure that ships —
     an SBOM under-report (the dangerous direction). The same scan, run
     post-build, also reached into `src-tauri/target/`; on MSVC syft catalogued
     ~230 purl-less proc-macro DLLs (`serde_derive-<hash>.dll`, …) as
     `application` components — non-reproducible, duplicative of the `pkg:cargo`
     purls, and not shipped (macOS/Linux: 0 such entries). Both are one
     mis-scoped scan. Fix (§2.2): scope to `product/` (both locks in scope —
     cargo 961 unchanged, npm 2 → 792) and prune `target/`-sourced components
     with `jq` — syft's `--exclude` is a silent no-op for `**/target/**` in
     syft 1.43.0 and errors on directory-form patterns, so it cannot do this.
     Confirmed by clean `git archive` reproduction (npm 2 → 792, cargo 961
     unchanged; `node_modules` does not inflate the count — all npm comes from
     the lockfiles). AC-2/AC-4 (subject set) and AC-6 (desktop scope gates) above
     are amended accordingly; the gates are enforced fail-closed in
     `release-desktop.yml`.

## 7. Risks and Mitigations

- **Risk:** `attest-build-provenance` requires
  `permissions: id-token: write, attestations: write, contents: write`.
  Adding these to the release jobs widens permission surface.
  **Mitigation:** scoped per-job, not workflow-wide. Release workflows are
  already write-scoped (`contents: write`) so the marginal escalation is
  the id-token + attestations grants, both narrowly used.

- **Risk:** SBOM generation against a Tauri target dir produces a very
  large JSON (every transitive crate + every npm package).
  **Mitigation:** acceptable size cost (single MB scale). Compression
  applied via `gh release upload`'s default. If size becomes a problem,
  switch SBOM scope from `path: target/` to `format: spdx-json` + a path
  filter.

- **Risk:** Sigstore transparency log is unreachable, breaking the
  attestation step.
  **Mitigation:** known historical incidents resolve in minutes;
  attest-build-provenance retries internally. If sustained, the release
  job fails — preferable to silently shipping unattested binaries.

- **Risk:** A consumer running an older `gh` CLI without `gh attestation
  verify` cannot validate.
  **Mitigation:** docs/RELEASE-VERIFICATION.md documents both `gh` and direct
  `cosign verify-blob` paths. The `gh` requirement is `>= 2.50`.

- **Non-risk (amended 2026-06-04) — single-commit provenance for the bundled
  sidecar.** Because axiomregent is built from OPC's own release commit inside
  `release-desktop.yml` and bundled in the same run, **build-ref == bundle-ref**:
  the commit that produced the sidecar binary is the commit that produced the
  installer. The desktop installer attestation therefore already binds the
  sidecar's provenance to a single commit — no build-ref→bundle-ref *span* clause
  (which a separately-released-then-bundled component would require) is needed.
  Build-once makes this spec **simpler, not harder**: one provenance subject
  (the installer), one commit, one attestation per installer; the retired
  standalone per-binary axiomregent attestations are subsumed, not lost.

## 8. Sequencing With M8 (release-tools workflow_run trigger)

The parent plan's Phase 3.2 (M8) converts `release-tools.yml`'s trigger
from `push: tags` to `workflow_run` on `Release Desktop` completion. This
spec's release-tools changes (§4.3) MUST land alongside that trigger
change in a single commit, so the SBOM/attestation steps run against the
correct release object. The parity-check allowlist update (§4 last bullet)
is included.

## 9. Pre-Public-Release Posture

The parent plan flags this spec as "Phase 3 before a public release."
Concretely: no `vN.0.0` GitHub Release tag is pushed until this spec is
implemented end-to-end and AC-1 through AC-4 are demonstrated on a test
tag (`v0.0.0-attestation-smoke` or similar). The pre-public-release
ordering is the load-bearing constraint of this spec.
