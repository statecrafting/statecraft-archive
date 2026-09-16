# Quickstart

This guide walks you through building the `oap-bootstrap` CLI and provisioning a new Open Agentic Platform instance.

## 1. Build the CLI

Clone the repository and build the binary using Go 1.25:

```bash
git clone https://github.com/statecrafting/oap-bootstrap.git
cd oap-bootstrap
go build -o oap-bootstrap ./cmd/oap-bootstrap
```

## 2. Initialize Configuration

The `init` phase collects the user-supplied values, generates necessary secrets, and computes derived URLs. It prompts for the values only you can supply, such as your target organization, domain, and API tokens.

```bash
./oap-bootstrap init
```

*Note: In the current implementation, `init` echoes secret input visibly to the terminal. Masked input will be added in a future milestone.*

## 3. Preflight Checks

Run the `doctor` phase to verify that all required tools are installed and your configuration is ready.

```bash
./oap-bootstrap doctor
```

## 4. Provisioning

You can run the provisioning phases one by one. Every phase is idempotent (detect-or-create), so if a step fails, you can fix the issue and re-run the phase to resume exactly where you left off.

```bash
# Fork the repo, register the GitHub App, and set Actions secrets
./oap-bootstrap github

# Wrap setup.sh Phase 1 (K3s + GitOps) and capture the worker NODE_IP
./oap-bootstrap cluster

# Create Cloudflare A records and wait for cert-manager Certificates
./oap-bootstrap dns

# Create Rauthy OIDC clients and register the upstream GitHub provider
./oap-bootstrap identity

# Wrap setup.sh Phase 2 to materialize secrets and deploy workloads
./oap-bootstrap platform

# Verify endpoint health, TLS certificates, and webhook reachability
./oap-bootstrap verify
```

### Unattended Execution

Alternatively, if you have a complete `oap.env` file, you can run the entire sequence unattended. The `--yes` flag is required to confirm the automated execution.

```bash
./oap-bootstrap apply --yes
```

If any phase encounters an error during an unattended run, the CLI will halt. You can simply run `./oap-bootstrap apply --yes` again to resume.
