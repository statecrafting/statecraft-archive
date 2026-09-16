# Command Reference

This page provides detailed reference information for each `oap-bootstrap` command.

## `init`

Collects user-supplied keys, generates random secrets, and computes derived URLs. 

- **Flags**:
  - `--yes`: Run non-interactively. Do not prompt for input; fail if a required user-supplied value is missing.
- **Behavior**: Prompts the user for missing required keys (such as `ORG`, `DOMAIN`, and tokens). Generates cryptographic secrets for databases and sessions. Computes derived URLs based on the domain. Writes the resulting configuration to `oap.env`.

## `doctor`

Performs preflight checks before any provisioning occurs.

- **Behavior**: Checks the system `PATH` for required tools (`git`, `gh`, `hetzner-k3s`, `flux`, `kubectl`, `helm`, `sops`, `age`). Verifies the secrets-at-rest posture and reports on configuration completeness. It currently checks tool presence and versions, but does not perform live token-scope probing.

## `github`

Forks the upstream repository and registers the GitHub App.

- **Flags**:
  - `--upstream-owner`: The upstream organization to fork from (default: `statecrafting`).
  - `--upstream-repo`: The upstream repository to fork (default: `open-agentic-platform`).
  - `--timeout`: Maximum wait time for the GitHub App consent flow (default: `5m`).
  - `--skip-fork`: Assume the fork already exists and skip the forking step.
- **Behavior**: Forks the repository into the target organization. If `GITHUB_APP_ID` is absent, it initiates the App Manifest flow, opening a browser for user consent. Persists the generated App credentials and sets the `GHCR_PAT` and `DB_PASSWORD` Actions secrets.

## `cluster`

Provisions the K3s cluster and bootstraps GitOps.

- **Flags**:
  - `--repo-dir`: Path to the local checkout of the forked repository (default: `./<REPO>`).
  - `--skip-clone`: Assume the repository is already checked out at `--repo-dir` and skip cloning.
  - `--keep-bridge`: Debug flag to prevent shredding the plaintext `.env` bridge file after the phase completes.
- **Behavior**: Refreshes configuration and writes a transient `.env` file. Executes `setup.sh` Phase 1. Captures the `NODE_IP` from the cluster, persists it to `oap.env`, and uploads the generated `kubeconfig` as the `KUBECONFIG_HETZNER` Actions secret.

## `dns`

Configures DNS records and waits for TLS certificates.

- **Flags**:
  - `--repo-dir`: Path to the local checkout holding the `kubeconfig` (default: `./<REPO>`).
  - `--dns-timeout`: Maximum wait time for hand-set records to resolve if no Cloudflare token is provided (default: `10m`).
  - `--cert-timeout`: Maximum wait time for cert-manager Certificates to become Ready (default: `10m`).
  - `--skip-certs`: Skip the cert-manager readiness poll.
- **Behavior**: If a Cloudflare token is present, it upserts the required A records. Otherwise, it prints the records and blocks until DNS resolves. It then polls the cluster to ensure TLS certificates are issued.

## `identity`

Creates Rauthy OIDC clients and registers the upstream provider.

- **Behavior**: Connects to the Rauthy admin API using `RAUTHY_ADMIN_TOKEN`. Ensures custom authorization scopes exist. Creates the SPA, Server, and two M2M clients, persisting their credentials immediately. Attempts to register the GitHub upstream provider via the API; if session-gated (Rauthy 0.35), it prints manual guidance.

## `platform`

Materializes secrets and deploys workloads.

- **Flags**:
  - `--repo-dir`: Path to the local checkout of the forked repository (default: `./<REPO>`).
  - `--skip-clone`: Skip cloning the repository.
  - `--keep-bridge`: Debug flag to prevent shredding the plaintext `.env` bridge file.
- **Behavior**: Validates that all Phase-2 gate keys (provider-produced credentials) are present. Writes the transient `.env` file and executes `setup.sh` Phase 2. This applies the secrets to the cluster and rolls the deployments.

## `verify`

Asserts the health of the deployed instance.

- **Flags**:
  - `--repo-dir`: Path to the local checkout holding the `kubeconfig` (default: `./<REPO>`).
  - `--timeout`: Per-endpoint HTTP timeout (default: `10s`).
  - `--skip-certs`: Skip the in-cluster cert-manager readiness snapshot.
- **Behavior**: Probes the public endpoints (Statecraft, Deployd API, Rauthy, and the GitHub webhook receiver) to ensure they respond successfully over valid TLS. It optionally checks in-cluster certificate statuses. A hard endpoint failure (unreachable or 5xx status) fails the phase.

## `apply`

Runs every phase in sequence.

- **Flags**:
  - `--repo-dir`: Threaded through to the phases that accept it.
  - `--yes`: Mandatory flag to confirm unattended execution.
- **Behavior**: Executes `init --yes`, `github`, `cluster`, `dns`, `identity`, `platform`, and `verify` in order. Halts immediately on the first error.
