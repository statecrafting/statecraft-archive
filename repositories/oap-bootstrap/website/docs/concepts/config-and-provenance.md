# Configuration and Provenance

The `oap.env` file is the single source of truth for an `oap-bootstrap` deployment. It contains every key required by the CLI and the upstream setup scripts. To manage this complexity, every configuration key is strictly classified by its provenance—how it comes into existence.

The configuration model is defined by a central `Registry` in the Go codebase, which dictates what the `init` command prompts for, what it generates, and what it computes.

## The Four Provenances

| Provenance | Description | Examples |
|------------|-------------|----------|
| **User-Supplied** | Values the operator must provide, such as tokens, target domains, and API keys. The `init` phase prompts for these if they are missing. | `HCLOUD_TOKEN`, `DOMAIN`, `GITHUB_TOKEN`, `ORG`, `REPO` |
| **Generated** | Cryptographically secure random values minted by the CLI. These are generated automatically during `init` if they do not already exist. | `POSTGRES_PASSWORD`, `SESSION_SECRET`, `RAUTHY_API_SECRET` |
| **Provider-Produced** | Credentials returned by external services during the provisioning process. These are never prompted or generated locally; they are populated by the `github` and `identity` phases. | `GITHUB_APP_ID`, `OIDC_SPA_CLIENT_ID`, `NODE_IP` |
| **Derived** | Values computed deterministically from other configuration keys. These are never prompted or generated; they are recalculated dynamically. | `APP_BASE_URL`, `RAUTHY_URL`, `FLUX_OWNER` |

## The Fork Seams

A critical capability of `oap-bootstrap` is allowing a newly forked repository to operate independently without requiring manual source code edits. This is achieved through derived "fork seams" injected into the configuration.

The CLI derives `FLUX_OWNER`, `FLUX_REPO`, and `FLUX_BRANCH` from the user-supplied `ORG` and `REPO` values. When the `cluster` phase runs, these variables point the `flux bootstrap` process at the new fork, ensuring the GitOps loop reconciles from the correct location rather than the upstream repository.

Similarly, the CLI derives the `GH_REPO` variable. During the `platform` phase, the upstream script uses this variable when syncing the `KUBECONFIG_HETZNER` and `GHCR_PAT` Actions secrets. Without this derived seam, the script would attempt to push the fork's cluster credentials to the upstream repository, resulting in a cross-repository secret leak or a hard failure.
