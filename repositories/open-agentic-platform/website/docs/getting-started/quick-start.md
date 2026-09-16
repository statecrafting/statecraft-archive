# Quick Start

This quick start guide walks through the core governance workflows of the Open Agentic Platform using a fresh clone. These commands demonstrate the real artifacts produced by the system today.

## 1. Setup

First, ensure you have run the setup command to install the `spec-spine` CLI and build the overlay tools:

```bash
make setup
```

## 2. Generate a Compliance Report

The OWASP ASI 2026 traceability mapping is a deterministic JSON artifact generated from the compiled registry. Run the following command to emit the ASI-control-to-spec mapping:

```bash
./tools/oap/oap-registry-enrich/target/release/oap-registry-enrich \
    compliance-report --framework owasp-asi-2026 --json
```

This report proves that compliance is a structural property of the system, not an afterthought.

## 3. Check Registry Status

You can query the compiled registry to see the lifecycle inventory across the entire spec corpus (e.g., how many specs are approved, draft, or superseded):

```bash
spec-spine registry status-report --json --nonzero-only
```

## 4. Render the Codebase Index

The codebase index provides spec-to-code traceability for every crate and package in the repository. Render it and view the output:

```bash
spec-spine index render
cat .derived/codebase-index/CODEBASE-INDEX.md
```

The resulting Markdown file includes a "Spec" column that acts as the traceability surface.

## 5. Build and Verify a Governance Certificate

The governance certificate is the load-bearing artifact of OAP. Every factory run emits a `governance-certificate.json` binding the requirements hash, the frozen Build Spec hash, and per-stage artifact hashes.

To demonstrate this on a fresh clone, we can synthesize a one-stage run directory and build a certificate retroactively:

```bash
# Create a mock run directory and artifact
mkdir -p /tmp/oap-demo-run/s0-preflight
echo '{"ok":true}' > /tmp/oap-demo-run/s0-preflight/preflight.json

# Create mock business requirements
echo "tenant onboarding requirements" > /tmp/oap-demo-reqs.md

# Build the certificate
make build-certificate FILE=/tmp/oap-demo-run \
    BUSINESS_DOCS=/tmp/oap-demo-reqs.md \
    ADAPTER=acme-vue-node
```

This writes the certificate to `/tmp/oap-demo-run/governance-certificate.json`.

Now, act as an independent auditor and verify the certificate:

```bash
make verify-certificate FILE=/tmp/oap-demo-run/governance-certificate.json \
    ARTIFACT_DIR=/tmp/oap-demo-run
```

The command should exit `0` and print `governance certificate VERIFIED`.

To prove the verifier works, tamper with the artifact and verify again:

```bash
echo "TAMPERED" > /tmp/oap-demo-run/s0-preflight/preflight.json
make verify-certificate FILE=/tmp/oap-demo-run/governance-certificate.json \
    ARTIFACT_DIR=/tmp/oap-demo-run
```

The verifier will exit `1` and reject the certificate with a specific artifact-hash mismatch diagnostic. The verifier explicitly does not trust the producer.
