---
id: "029-supply-chain-provenance"
title: "Supply-chain provenance: signed, described, and installable offline"
status: approved
created: "2026-07-25"
implementation: in-progress
depends_on:
  - "012-born-with-provenance"
  - "016-amd64-image"
  - "027-operational-verbs"
establishes:
  - "scripts/airgap-bundle.sh"
  - "scripts/airgap-bundle.test.ts"
summary: >
  Spec 012 established born-with provenance for the repository: a
  stamped app can prove what generated it and under what agentic
  posture. The artifact that repository produces carries none of that.
  image.yml pushes to GHCR unsigned and unattested, with no SBOM and no
  offline install path, so the chain of custody the template is careful
  about ends exactly where a buyer's security review begins. This spec
  extends provenance from the repo to the image: cosign keyless
  signatures, an SPDX SBOM published as an attestation, and a docker
  save bundle with a verification script so a cell can be installed on a
  host with no outbound network. The buyer persona that wants a
  self-contained image is disproportionately the persona that has no
  egress, so the air-gap path is not an edge case for this substrate; it
  is the main case arriving late.
---

# 029: Supply-chain provenance

## 1. Purpose

The template is unusually rigorous about provenance in the repository
and entirely silent about it in the artifact.

Spec 012 defines a born-with certificate, a schema, a validator, and an
agentic-posture binding, all reachable through `template.toml`'s
`[provenance]` table. Spec 024 hash-chains and signs every governance
Decision. Spec 021 boots fail-closed on a model whose integrity does not
check. That is a coherent and genuinely differentiated position on
custody, and it stops at `docker push`.

`.github/workflows/image.yml` builds per-arch images, smokes them,
pushes them under a SHA-scoped tag, and stitches a multi-arch manifest.
Nothing signs them. Nothing describes their contents. A consumer pulling
`ghcr.io/<owner>/enrahitu:latest` has no way to establish that it came
from this repository's CI rather than from anyone with push rights, and
no machine-readable statement of what is inside it.

The gap matters most for exactly the buyer this substrate targets. An
organization that wants one self-contained image on its own hardware
usually wants it because the hardware has no outbound network, and it
usually has a security review that asks for an SBOM by name. Today the
build pulls `ghcr.io/sebadob/rauthy:0.36.0` and npm packages from the
registry at build time, and ships no bundle, so the answer to "install
this on an air-gapped host" is that you cannot.

## 2. Territory

This spec owns `scripts/airgap-bundle.sh`: the offline bundle producer
and its verification counterpart.

It amends, without owning, `.github/workflows/image.yml` (spec 016): the
signing, attestation, and bundle-publication steps in sections 3.1
through 3.3.

## 3. Behavior

### 3.1 Signatures

cosign keyless signing over the OIDC identity GitHub Actions already
provides, so there is no key to manage, rotate, or leak. Every pushed
tag is signed: the per-arch SHA-scoped tags and the multi-arch manifest.

Verification is documented as a command a consumer runs before
installing, with the expected identity and issuer stated explicitly.
An unverifiable image is a refusal, and the documentation says so in
those terms rather than presenting verification as optional hygiene.

### 3.2 The SBOM

An SPDX SBOM generated from the final image and published as a cosign
attestation attached to it, so the description travels with the artifact
rather than beside it.

The SBOM covers what the image actually contains, which for this
substrate is a specific and unusually interesting list: the node base,
the app bundle, the rauthy binary copied from its upstream image, the
prebuilt Encore runtime and tsparser binaries from
`@statecrafting/toolchain`, the hiqlite and kernel native addons, and
the built SPA bundles. Several of those are prebuilt binaries with their
own upstream provenance, which is precisely the thing a reviewer wants
enumerated.

The rauthy binary's own version and origin are recorded explicitly,
since it enters the image by `COPY --from` and would otherwise be
invisible to a scanner that only reads package manifests.

### 3.3 The air-gap bundle

`scripts/airgap-bundle.sh <arch>` produces one directory, and a
`.tar.gz` of it, containing everything needed to install with no
network:

- the image for that one architecture as a `docker save` archive,
- its cosign signature and SBOM attestation,
- a checksum manifest over every member,
- `verify.sh`, which checks the checksums and, when cosign is present,
  the signature, and which states clearly what it could and could not
  verify rather than passing silently on a missing tool,
- the operator documentation (spec 028) for the exact version in the
  bundle, because an air-gapped operator cannot read documentation on a
  website.

The bundle is per-architecture, not multi-arch. A stock Docker daemon
on the classic image store cannot `docker load` a multi-platform
archive, and an air-gapped host has exactly one architecture, so a
multi-arch bundle would double the transfer to deliver something half
of which that host can never run. CI produces one bundle per
architecture on release and publishes each as a release asset. Each
bundle's checksum manifest is signed by the same keyless flow, so the
bundle inherits the chain rather than starting a new one.

### 3.4 The build's own egress, stated

This spec does not make the build hermetic; that is a larger change and
a different concern. It does make the build's inputs explicit: the
pinned rauthy image digest (not merely its tag), the toolchain package
versions, and the base image digest are recorded in the SBOM and in the
build metadata, so an auditor can see exactly what was pulled even
though the build pulled it.

Pinning `ghcr.io/sebadob/rauthy` by digest rather than by the current
`0.36.0` tag is the one behavioral change to the build here, and it is
worth the friction: a tag is mutable and this substrate's whole claim is
about custody.

## 4. Acceptance

1. Every image tag pushed by `image.yml` carries a verifiable cosign
   signature; `cosign verify` with the documented identity and issuer
   succeeds, and succeeds against the multi-arch manifest as well as the
   per-arch tags.
2. An SPDX SBOM is attached as an attestation and enumerates the node
   base, the rauthy binary with its version and source digest, both
   `@statecrafting` native addons, the Encore runtime and tsparser
   binaries, and the SPA bundles.
3. `scripts/airgap-bundle.sh` produces a bundle that installs a working
   cell on a host with no outbound network, verified by building the
   bundle, running the install on a network-isolated container, and
   reaching a successful login.
4. `verify.sh` fails on a tampered member and reports precisely which
   member failed; with cosign absent it reports that the signature was
   not checked rather than exiting zero silently.
5. The rauthy base is pinned by digest, and the digest appears in both
   the Dockerfile and the SBOM.
6. A release run publishes each architecture's bundle and its signed
   checksum manifest as release assets.
7. Coupling gate green.

## 5. Out of scope

- A hermetic or fully offline build. The build still pulls from GHCR and
  npm; this spec records what it pulls rather than eliminating the pull.
- SLSA provenance attestation beyond what cosign keyless plus the SBOM
  deliver. A named extension once a consumer asks for a specific level.
- Signing the stamped application repositories the factory produces.
  That is spec 012's territory and the factory's, not the image's.
- Vulnerability scanning and a CVE policy. The SBOM makes scanning
  possible; deciding what to do about findings is an operational policy
  this template does not set for its consumers.
- Mirroring npm and GHCR for air-gapped rebuilds. The bundle installs a
  built image; rebuilding from source offline is a different and much
  larger requirement.

## Amendment (2026-08-10): two mechanisms this spec named imprecisely

Written before implementation, corrected before code, per the backlog
protocol's design-truth-precedes-code rule.

1. **The bundle is per-architecture** (§3.3, acceptance 6). The spec
   asked for "the multi-arch image as a `docker save` archive", which is
   not an artifact a stock Docker daemon can consume: multi-platform
   export and `docker load` of a platform index require the containerd
   image store, which an air-gapped operator may well not have enabled.
   The image is 795 MB, so shipping both arches would also double the
   transfer to deliver something half of which the host cannot run.
2. **The rauthy pin is the OCI index digest**, not a per-arch manifest
   digest (§3.4, acceptance 5). `ghcr.io/sebadob/rauthy:0.36.0` resolves
   to `sha256:e2a670c7...`, an `application/vnd.oci.image.index.v1+json`
   carrying linux/amd64 and linux/arm64. Pinning the index preserves the
   per-arch resolution that `docker build --platform` depends on;
   pinning a leaf manifest would silently break the other architecture's
   build. The dev topology (`docker/Dockerfile.dev`,
   `docker/compose.dev.yml`, specs 033 and 005) intentionally stays on
   the mutable tag: dev is not the artifact whose custody this spec is
   about, and pinning it would move two more specs' owned paths for no
   provenance gain.
3. **The tsparser is not in the image**, so it is not in the image's
   SBOM (§3.2, acceptance 2). §3.2 listed "the prebuilt Encore runtime
   and tsparser binaries" among the image's contents; only the runtime
   is. `scripts/docker-build.sh` runs the tsparser on the *build host*
   to produce the app bundle and injects only `encore-runtime.node`
   into the image, confirmed by inspecting a locally built image on
   2026-08-10. An SBOM naming a binary the image does not contain is a
   false statement of contents, which is the one thing a bill of
   materials may not be. The build-host tsparser version is recorded
   instead through the toolchain version carried by the runtime entry.

   The same inspection showed the enumeration §3.2 asks for is wider
   than syft alone provides. syft catalogues 301 packages from the
   image and none of them is rauthy, the Encore runtime, or either SPA
   bundle: two arrive as bare files and two are build output, so no
   package manifest inside the image names any of them. All four are
   written into the SBOM explicitly, alongside the resolved base image
   digest.

## Status (2026-08-10): implemented, three acceptance items need a published release

Everything in §3 is built. `implementation` stays `in-progress` because
three acceptance items cannot be closed from a working tree: they
require a real publish or release run, and claiming them from local
evidence would be exactly the ratification this corpus forbids.

**Verified locally, against a real image built from this branch**
(`scripts/docker-build.sh arm64`, 2026-08-10):

- **Item 4, in full.** `verify.sh` fails a tampered member and names it,
  fails a member deleted outright and names it, reports both categories
  separately in one run, refuses a bundle whose manifest is gone, never
  lets `--allow-unsigned` excuse a tampered member, and on cosign's
  absence reports the signature as NOT CHECKED and exits 2 rather than
  zero. Twelve cases in `scripts/airgap-bundle.test.ts`, each
  mutation-checked: reverting the fix fails them.

  Writing them found a defect worth recording. The first verifier
  passed a bundle with a member *deleted*, because Darwin's `sha256sum`
  reports an absent file only on stderr and prints no `FAILED` line on
  stdout, so a verifier reading stdout sees a clean run. Removing the
  SBOM or the verifier itself was undetectable. Members are now checked
  for existence by looking, not by reading the tool's output.

- **Item 5's Dockerfile half.** The image builds from the pinned index
  digest, and the rauthy binary inside it reports `rauthy 0.36.0`,
  matching the version the comment claims. The digest, the comment and
  the shipped binary agree.

- **Item 3, everything except the login itself.** The bundle was built
  from a real `docker save` (188 MB compressed), the local tag was
  deleted, and the image was loaded *only* from the bundle. It then ran
  under `--network none`: no address, no gateway, stricter than the
  air-gapped host this is for. First boot provisioned both RS256
  keypairs, the rauthy client secret, the admin password and the metrics
  token; `/healthz`, `/readyz` (ledger ok, hiqlite ok) and `/hiq/health`
  all answered 200 within six seconds; the SPA served 200; rauthy's OIDC
  discovery served 200 with the right issuer through the same-origin
  proxy; and the app's login endpoint returned its 302 into the IdP.
  What was **not** done is driving a browser through to a session, which
  is spec 017's harness. The login *path* is proven to work with no
  network; the login is not.

- **Item 2's enumeration.** syft catalogues 301 packages from the image,
  including `@statecrafting/hiqlite-native`, `@statecrafting/kernel-native`,
  their per-triple carriers, `encore.dev` and the libsql bindings, plus
  the trixie base evidence (`base-files 13.8+deb13u6`, `libc6 2.41`).
  It catalogues none of rauthy, the Encore runtime, or either SPA
  bundle, which is why all four are injected explicitly; the injection
  step was run against the real 301-package SBOM and produced 306 with
  every value resolved (base image digest, toolchain 0.4.0, rauthy
  0.36.0 and its digest).

**Not verifiable without a published release**, and therefore open:

1. **Item 1.** No tag has been signed yet, so no `cosign verify` has
   succeeded against a real signature. cosign is not installed on the
   development host either, so even the invocation in `verify.sh` and in
   `docs/OPERATIONS.md` is unexercised. It is written defensively for
   that reason: only cosign's own exit 0 counts as verified, and its
   stderr is printed verbatim on failure, so a wrong flag produces a
   loud diagnosis rather than a false pass.
2. **Item 2's attachment.** The SBOM is generated and augmented
   correctly; whether `cosign attest` attaches it and a consumer can
   read it back is a claim about a run that has not happened.
3. **Item 6.** No release has been cut, so no bundle has been published
   as an asset and no checksum manifest has been signed.

The next release run closes all three. Until then this spec is
`in-progress`, and `docs/OPERATIONS.md` documents the verification
commands as the contract they will satisfy rather than as commands that
have been observed to pass.
