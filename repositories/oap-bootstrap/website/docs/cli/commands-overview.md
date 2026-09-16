# Commands Overview

The `oap-bootstrap` CLI provides a linear, phase-structured command surface. Each command corresponds to a specific stage in the provisioning lifecycle.

The CLI is built using the Go standard library's `flag` package, rather than external frameworks like Cobra, to keep the binary dependency-free.

## Global Flags

All commands accept the following global flag:

- `--config`: Specifies the path to the configuration file. Defaults to `oap.env`.

## Command Summary

The commands are designed to be run in the following order:

1. **`init`**: Collects user-supplied keys, generates random secrets, and computes derived URLs, saving the result to `oap.env`.
2. **`doctor`**: Performs preflight checks to verify that required tools are installed and the configuration is ready.
3. **`github`**: Forks the upstream repository into the target organization, registers the GitHub App via the manifest flow, and sets initial GitHub Actions secrets.
4. **`cluster`**: Wraps the upstream `setup.sh` Phase 1 script to provision the Hetzner K3s cluster and bootstrap GitOps. Captures the worker node IP address.
5. **`dns`**: Creates Cloudflare A records pointing to the cluster node and waits for TLS certificates to be issued.
6. **`identity`**: Creates the necessary Rauthy OIDC clients and registers the GitHub upstream provider.
7. **`platform`**: Wraps the upstream `setup.sh` Phase 2 script to materialize secrets and deploy the platform workloads.
8. **`verify`**: Asserts the health of the deployed endpoints, TLS certificates, and webhook reachability.

## Unattended Execution

For automated deployments, the CLI provides the `apply` command:

- **`apply`**: Runs every phase in dependency order non-interactively. It requires a complete `oap.env` file and the mandatory `--yes` flag to confirm execution.

For detailed information on the flags and behavior of each command, see the [Command Reference](./command-reference).
