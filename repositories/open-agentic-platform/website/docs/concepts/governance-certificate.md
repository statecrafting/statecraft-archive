# Governance Certificate

The Governance Certificate (Spec 102) is the load-bearing artifact of the Open Agentic Platform. It is the cryptographic proof that a software artifact was produced according to the specified, governed process.

## Emission and Binding

At the end of every Factory pipeline run (whether it succeeds or halts), the system automatically emits a `governance-certificate.json` file into the run directory.

This certificate is a self-authenticating document that binds together the entire lifecycle of the build:
1. **Requirements Hash**: The SHA-256 hash of the initial business documents or user prompts.
2. **Build Spec Hash**: The hash of the frozen Build Spec generated during Phase 1 of the pipeline.
3. **Artifact Hashes**: A map of every file produced during Phase 2 scaffolding, along with its expected SHA-256 hash.
4. **Self-Signature**: A hash over the canonical JSON of the certificate itself.

By cryptographically linking the intent (requirements) to the plan (Build Spec) and the output (artifacts), the certificate proves the unbroken chain of custody.

## The Do-Not-Trust-The-Producer Verifier

The defining characteristic of the Governance Certificate is that the verifier explicitly **does not trust the system that produced it**.

The `verify-certificate` tool is an independent binary. When an auditor or deployment gate receives a run directory, they execute:

```bash
make verify-certificate FILE=/path/to/governance-certificate.json \
    ARTIFACT_DIR=/path/to/run/dir
```

The verifier recalculates the hashes of all artifacts in the directory and compares them against the claims in the certificate. 

- If the hashes match, the verifier exits `0` (VERIFIED).
- If any artifact has been modified, injected, or removed since the certificate was signed, the verifier exits `1` (INVALID) and outputs a specific tamper-rejection diagnostic, pinpointing exactly which file failed the check.

This mechanism ensures that even if the build environment is compromised post-generation, the resulting artifacts cannot be deployed or trusted without detection.
