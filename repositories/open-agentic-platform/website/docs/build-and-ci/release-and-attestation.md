# Release and Attestation

Every release of the Open Agentic Platform is accompanied by cryptographic attestations to ensure supply chain integrity (Spec 117).

## SLSA Build Provenance

Every shipped installer (e.g., `.dmg`, `.AppImage`, `.exe`, `.deb`, `.rpm`, `.msi`) carries a SLSA build-provenance attestation (`<installer>.intoto.jsonl`). 

This is a Sigstore-signed claim asserting that the installer was built by the official GitHub Actions workflow (`release-desktop.yml`), from a specific commit, on a GitHub-hosted runner.

### Verifying Provenance

You can verify the attestation using the GitHub CLI (`gh` version 2.50+):

```bash
gh attestation verify path/to/opc_<version>_aarch64.dmg \
  --repo statecrafting/open-agentic-platform
```

## CycloneDX SBOM

Every release target also carries a CycloneDX Software Bill of Materials (SBOM) (`sbom-desktop-<target>.cdx.json`).

This SBOM provides a complete inventory of the crates and npm packages that went into the build. It includes the full Rust closure from `src-tauri/Cargo.lock` and the frontend npm closure from `product/pnpm-lock.yaml`.

### Bundled Sidecar SBOM

The `axiomregent` MCP server is bundled into the OPC desktop installer as an internal sidecar. Its specific SBOM (`sbom-axiomregent.cdx.json`) is generated during the desktop release flow and linked from each installer SBOM via a CycloneDX `externalReferences` BOM-Link.
