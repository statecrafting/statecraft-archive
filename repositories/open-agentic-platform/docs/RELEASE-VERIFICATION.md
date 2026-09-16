# Release Artifact Verification

**Every shipped installer carries a SLSA build-provenance attestation, and every
release target carries a CycloneDX SBOM** covering its build:

1. **SLSA build-provenance attestation** (`<installer>.intoto.jsonl`) — a
   Sigstore-signed claim asserting "this installer was built by `<repo>`, by
   workflow `<name>`, from commit `<sha>`, on a GitHub-hosted runner." One is
   attached for **each** shipped installer: `.dmg`, `.AppImage`, NSIS `.exe`,
   **`.deb`, `.rpm`, and `.msi`**.
2. **CycloneDX SBOM** (`sbom-desktop-<target>.cdx.json`) — an inventory of the
   crates and npm packages that went into the target's build: the full Rust
   closure from `src-tauri/Cargo.lock` plus the frontend npm closure from
   `product/pnpm-lock.yaml` (the pnpm *workspace* closure — a superset of OPC's
   production runtime deps), with non-reproducible `target/` build-tree artifacts
   pruned out (spec 117 §2.2). Each installer SBOM also BOM-Links the bundled
   `sbom-axiomregent.cdx.json` sidecar SBOM (§2.1).

These are produced by `release-desktop.yml` and `release-tools.yml`.
Specification: [`117-release-artifact-attestations`](../specs/117-release-artifact-attestations/spec.md).

> **Note (2026-06-04).** axiomregent is no longer released as a standalone
> product — it is an internal sidecar bundled into the OPC desktop installer
> (specs [037](../specs/037-cross-platform-axiomregent/spec.md) /
> [193](../specs/193-paired-release-cadence/spec.md), amended). Its CycloneDX
> SBOM (`sbom-axiomregent.cdx.json`) is generated in the desktop release flow,
> attached to the OPC release, and linked from each installer SBOM via a
> CycloneDX `externalReferences` BOM-Link (spec 117 §2.1). The sidecar binary's
> provenance is covered by the desktop installer attestation (same commit).

## Verifying provenance

Requires `gh` CLI version 2.50 or later.

```bash
# Verify a desktop installer (the attested release subject)
gh attestation verify path/to/opc_<version>_aarch64.dmg \
  --repo statecrafting/open-agentic-platform

# Expected output:
# Loaded digest sha256:... for file://...
# Loaded 1 attestation from GitHub API
# - Verification succeeded!
#
# The following policy criteria will be enforced:
# - Source Repository Owner URI: https://github.com/statecraft-ing
# - Source Repository URI:       https://github.com/statecrafting/open-agentic-platform
# - Predicate type:              https://slsa.dev/provenance/v1
# - Subject Alternative Name:    https://github.com/statecrafting/open-agentic-platform/.github/workflows/release-desktop.yml@refs/tags/...
```

## Verifying without `gh`

The attestations live in the public Sigstore Rekor transparency log.

```bash
# Compute the artifact digest
DIGEST=$(sha256sum opc_<version>_aarch64.dmg | awk '{print $1}')

# Find the Rekor entry
rekor-cli search --sha "sha256:$DIGEST"

# Inspect the entry
rekor-cli get --uuid <uuid-from-search> --format json
```

## Inspecting the SBOM

```bash
# How many components in the installer SBOM?
jq '.components | length' sbom-desktop-aarch64-apple-darwin.cdx.json

# Follow the BOM-Link to the bundled axiomregent sidecar SBOM (spec 117 §2.1).
# url is a urn:cdx:<serialNumber>/<version> BOM-Link; .comment names the
# co-attached release asset that resolves it.
jq -r '.externalReferences[] | select(.type=="bom") | "\(.url)  (\(.comment))"' \
  sbom-desktop-aarch64-apple-darwin.cdx.json
jq '.components | length' sbom-axiomregent.cdx.json   # the co-attached sidecar SBOM

# What licenses (sidecar)?
jq -r '.components[] | "\(.name) \(.version) \(.licenses[0].license.id // "unknown")"' \
  sbom-axiomregent.cdx.json | sort -u
```

## Updater integrity (desktop only)

The desktop installer flow additionally publishes per-installer
SHA-256 sidecars (`*.dmg.sha256`, `*.exe.sha256`, `*.AppImage.sha256`).
These are consumed by the in-app updater
(`product/apps/opc/src-tauri/src/commands/updater.rs`) — they are an
integrity check, not a provenance check, and exist for offline
update validation. They coexist with the SLSA attestations.

**Scope (intentional).** The `.sha256` sidecars cover **only the updater's three
formats** — DMG, NSIS `setup.exe`, and AppImage (the artifacts `updater.rs`
downloads). This is deliberately narrower than the provenance + SBOM coverage
above: `.deb`, `.rpm`, and `.msi` are **not** updater targets, so they ship with
a SLSA attestation and are inventoried in the SBOM, but get no `.sha256` sidecar.
The narrower set is a design choice (the updater consumes nothing else), not a
coverage gap — verify those three via `gh attestation verify` like any other
installer.
