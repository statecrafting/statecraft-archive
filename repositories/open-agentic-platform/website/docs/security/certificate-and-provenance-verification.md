# Certificate and Provenance Verification

Security in OAP relies on cryptographic proof. The platform provides mechanisms to verify both the output of the Factory pipeline and the released binaries themselves.

## Verifying the Governance Certificate

The Governance Certificate (Spec 102) is the primary artifact for verifying a Factory run. It binds the requirements, the frozen Build Spec, and the generated artifacts.

To verify a certificate against a run directory, use the independent verifier:

```bash
make verify-certificate FILE=/path/to/governance-certificate.json \
    ARTIFACT_DIR=/path/to/run/dir
```

The verifier does not trust the producer. It recalculates the hashes of all artifacts in the directory. If a file has been tampered with, the verifier exits `1` and outputs a specific diagnostic detailing the expected and actual hashes.

## Verifying Release Provenance

Every shipped installer carries a SLSA build-provenance attestation and a CycloneDX SBOM (Spec 117).

You can verify the SLSA attestation using the GitHub CLI:

```bash
gh attestation verify path/to/opc_<version>_aarch64.dmg \
  --repo statecrafting/open-agentic-platform
```

This command confirms that the binary was built by the official GitHub Actions workflow from the correct repository and commit.

## Inspecting the SBOM

The CycloneDX SBOM provides a complete inventory of the dependencies used to build the target. You can inspect it using tools like `jq`:

```bash
# Count the number of components
jq '.components | length' sbom-desktop-aarch64-apple-darwin.cdx.json
```

The desktop installer SBOM also includes a BOM-Link to the bundled `axiomregent` sidecar SBOM, ensuring full traceability of the internal components.
