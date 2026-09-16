# Prerequisites

Before running `oap-bootstrap`, ensure you have the necessary tools installed and the required accounts and tokens prepared.

## Required Tools

The CLI shells out to several external tools during the provisioning process. The `doctor` phase checks your `PATH` for these dependencies:

- `git`: Required to fork and clone the upstream repository.
- `gh`: The GitHub CLI, used to configure the GitHub App and set Actions secrets.
- `hetzner-k3s`: Required by the upstream `setup.sh` to create the K3s cluster.
- `flux`: Required to bootstrap GitOps.
- `kubectl`: Used to apply manifests and read cluster state.
- `helm`: Used to deploy charts.
- `sops`: Required to encrypt `oap.env` at rest.
- `age`: The key backend for `sops`.

### Optional Tools

- `age-keygen`: Used to derive the age recipient from your private key.
- `spec-spine`: Used to govern the fork's own specifications (if you intend to modify them).

## Accounts and Tokens

`oap-bootstrap` assumes that the target cloud provider accounts and DNS zones already exist. You must supply tokens with the appropriate scopes during the `init` phase:

- **GitHub Organization**: You need an existing target organization to fork into.
- **GitHub Token**: A Personal Access Token (PAT) with `admin:org` and `repo` scopes. This is used to fork the repository, register the GitHub App, and configure Actions secrets. Note that this token is only used during bootstrap; steady-state GitOps uses a deploy key.
- **GitHub Container Registry (GHCR) PAT**: A token with `read:packages` scope to pull images.
- **Hetzner Cloud Project**: An existing Hetzner Cloud project.
- **Hetzner Cloud API Token**: A token with `Read & Write` permissions for the target project.
- **DNS Zone**: An existing domain.
- **Cloudflare API Token**: A token with `Zone:Edit` permissions to automatically create the required `A` records. If you do not provide a token, the CLI will print the required records and wait for you to create them manually.

## Secrets at Rest

`oap-bootstrap` uses a single `oap.env` file as its source of truth. To keep your secrets secure, the CLI encrypts secret-classed keys at rest using SOPS and age. 

You must have an existing age key pair. By default, the CLI looks for your key at `~/.config/sops/age/keys.txt`. You can override this location by setting the `SOPS_AGE_KEY_FILE` environment variable. 

If `sops` or `age` are not installed, the CLI will fall back to writing secrets in plaintext, but it will emit a loud warning.
