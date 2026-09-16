# Developer Guide

## Prerequisites

| Tool | Install | Notes |
|------|---------|-------|
| Rust | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` | Spec compiler and crates |
| Node.js >=18 | `brew install node` | |
| pnpm | `brew install pnpm` | Root workspace only |
| bun | `brew install bun` | |
| Docker | [docker.com](https://docker.com) | Required for platform services |
| Encore CLI | `brew install encoredev/tap/encore` | Only needed for statecraft |

Run `make check-deps` to verify the core tools are installed.

**Alternative:** Open in VS Code with the [devcontainer](../.devcontainer/devcontainer.json) for a pre-configured environment.

### Hetzner GitOps operator (spec 151)

Required only if you operate (bootstrap, recover, or migrate) the Hetzner production cluster. The desktop app and platform services build without these.

| Tool | Install | Notes |
|------|---------|-------|
| hetzner-k3s | `brew install vitobotta/tap/hetzner_k3s` | Cluster bootstrap driver; reads `platform/infra/hetzner/cluster.yaml` |
| flux | `brew install fluxcd/tap/flux` | v2.8.7 pinned; runs `flux bootstrap github` to install controllers in-cluster |
| sops | `brew install sops` | Decrypts SOPS-encrypted manifests under `platform/gitops/clusters/hetzner-prod/secrets/` |
| age | `brew install age` | SOPS recipient backend; `age-keygen` generates operator + Bitwarden-stored recovery keys |

One-liner: `brew install vitobotta/tap/hetzner_k3s fluxcd/tap/flux sops age`.

Version pair (current pin / Phase 1 prep, 2026-05-18):

- **Current cluster:** k3s `v1.31.4+k3s1` (per `platform/infra/hetzner/cluster.yaml`). Flux not yet bootstrapped.
- **Target pair for T-007 (Phase 1 closure PR):** k3s `v1.33.11+k3s1` ↔ Flux `v2.8.7`. dr-baseline.md §F4 specifies that the k3s bump and the `flux bootstrap` step land in the **same PR** so cluster shape and GitOps runtime stay atomically aligned.

Bumping either side post-T-007: open a PR that updates both edits and re-runs the DR Stage 2 exercise (spec 151 SC-003).

## Quick Start

```bash
make setup          # one-time: install deps, build spec compiler, compile registry
make dev            # desktop app only (Tauri + Vite, hot-reload)
make dev-platform   # platform services (statecraft + deployd-api, background)
make dev-all        # desktop + platform services
make stop           # kill background platform services
```

## Admin Bootstrap

> **There is no default admin password.** The `BOOTSTRAP_ADMIN_EMAIL` environment variable
> does not seed a user account. It flags an email address so that the first **signup** with
> that email is auto-promoted to the `admin` role. You choose the password yourself during
> registration.

How to create your admin account:

1. Start statecraft: `make dev-statecraft` (or `make dev-platform`)
   - The npm script already sets `BOOTSTRAP_ADMIN_EMAIL=admin@example.com`
2. Open http://localhost:4000 and click **Sign Up**
3. Enter `admin@example.com`, pick a name and password
4. Your account is created with `role=admin`
5. All subsequent signups get `role=user`

To use a different admin email, override the env var:

```bash
BOOTSTRAP_ADMIN_EMAIL=you@company.com npm run encore
```

See [`platform/services/statecraft/api/auth/auth.ts:120-122`](../platform/services/statecraft/api/auth/auth.ts) for the bootstrap logic.

## Platform Services

| Service | Stack | Port | URL |
|---------|-------|------|-----|
| statecraft | Encore.ts, Drizzle ORM | 4000 | http://localhost:4000 |
| deployd-api-rs | Rust (axum + hiqlite) | 8080 | http://localhost:8080 |

> **Note:** GitHub webhook handling and token brokering were absorbed into statecraft (in `api/github/`). The former standalone github-app (Probot) service no longer exists.

Statecraft also exposes the Encore development dashboard at http://localhost:9400.

## Package Managers

- **JS workspace** uses **pnpm** — covers `product/apps/opc/` and `product/packages/*`. Tools and crates under `tools/` and `crates/` are Rust (managed by `cargo`, not pnpm).
- **Platform services** use **npm** (each has its own `package-lock.json`)

Platform services are excluded from `pnpm-workspace.yaml`. Do not run `pnpm install` inside `platform/services/*`.

## Further Reading

- [README.md](../README.md) — architecture overview and system vision
- [platform/CLAUDE.md](../platform/CLAUDE.md) — platform layer technical reference
- [platform/services/statecraft/README.md](../platform/services/statecraft/README.md) — full statecraft service docs
- [product/apps/opc/README.md](../product/apps/opc/README.md) — OPC desktop app
