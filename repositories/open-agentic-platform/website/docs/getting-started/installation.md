# Installation

This guide covers setting up the Open Agentic Platform for local development.

## Prerequisites

Before installing OAP, ensure you have the following tools available:

- **Rust**: The spec compiler and core crates are written in Rust. Install via `rustup`.
- **Node.js**: Version 18 or higher is required for the web and desktop frontends.
- **pnpm**: Used for the root JS workspace (`product/apps/opc/` and `product/packages/*`).
- **Docker**: Required for running the platform services locally.
- **Encore CLI**: Needed for the `statecraft` service development.

## Initial Setup

Clone the repository and run the setup target:

```bash
git clone https://github.com/statecrafting/open-agentic-platform.git
cd open-agentic-platform
make setup
```

The `make setup` command performs several essential bootstrapping steps:
1. Installs the generic `spec-spine` CLI (pinned to version 0.10.0) from crates.io.
2. Builds the OAP-specific overlay tools (like `spec-lint`, `oap-registry-enrich`, and `oap-code-index-enrich`).
3. Compiles the registry to generate the initial JSON shards under `.derived/spec-registry/by-spec/`.
4. Fetches the `axiomregent` sidecar binary required by the desktop app.

## Running the Development Environment

OAP provides several Make targets to start different parts of the system:

- **Desktop App Only**: Run `make dev` to start the OPC desktop application (Tauri plus Vite with hot-reload).
- **Platform Services**: Run `make dev-platform` to start the background services (statecraft and deployd-api).
- **Full Environment**: Run `make dev-all` to start both the desktop app and the platform services.
- **Stop Services**: Run `make stop` to kill the background platform services.

## Desktop Installer Verification

When installing from a release rather than building from source, you should verify the release artifacts. Every shipped installer carries a SLSA build-provenance attestation and a CycloneDX SBOM.

Using the GitHub CLI, you can verify the provenance of an installer:

```bash
gh attestation verify path/to/opc_<version>_aarch64.dmg \
  --repo statecrafting/open-agentic-platform
```

The verifier will confirm that the installer was built by the official GitHub Actions workflow from the correct repository and commit.
