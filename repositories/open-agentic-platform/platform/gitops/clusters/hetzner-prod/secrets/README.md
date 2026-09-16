# `secrets/` — SOPS-encrypted Secret manifests (placeholder)

This directory is the per-purpose-Secret surface that **spec 153** will fill in. Spec 151 ships the SOPS-age cluster runtime (Flux's `kustomize-controller` reads the in-cluster `flux-system/sops-age` Secret and decrypts manifests under this path) but does NOT migrate per-purpose application Secrets.

## Spec ownership

- **Spec 151 (this scope):** the runtime mechanism — `.sops.yaml` recipients at repo root, the `flux-system/sops-age` cluster Secret bootstrap, the `kustomize-controller` SOPS decryption-key wire-through. No per-purpose Secret YAMLs land here from spec 151.
- **Spec 153 (provisional, deferred):** the per-purpose application Secret migration — each `kubectl create secret generic` call in `platform/infra/hetzner/setup.sh` becomes a SOPS-encrypted manifest under this directory. Closes spec 143 FU-008 + FU-003 by reference.

## Filing gate for spec 153

Per [spec 151 plan.md](../../../../../specs/151-declarative-cluster-reconciliation/plan.md) §"Sequencing and gates", spec 153 cannot start until:

1. **Spec 151 is operational** — Flux reconciling ≥1 HelmRelease in production with `flux-system/sops-age` Secret present.
2. **Spec 152 has 14 days of clean operation** — CD git-write to gitops tree stable, no manual `helm upgrade --set` or `kubectl set image` against any of statecraft / deployd-api.

Either gate failing pushes 153 out, not 153's contents.

## Inventory (filled by spec 153 closure)

| Filename | Resource | setup.sh line retired | Spec 143 FU closure |
|---|---|---|---|
| _empty_ | — | — | — |

The full target list lives in [spec 151 plan.md §"Spec 153 (provisional) — Declarative cluster Secrets"](../../../../../specs/151-declarative-cluster-reconciliation/plan.md). Notable entries:

- `statecraft-knowledge-sweeper-credentials.yaml` (spec 143 FU-008)
- `extraction-staleness-sweeper.yaml`, `connector-sync-scheduler.yaml`, `factory-runs-staleness-sweeper.yaml` (spec 143 FU-003 family)
- `statecraft-audit-sweeper-credentials.yaml`, `statecraft-factory-sweeper-credentials.yaml`
- `rauthy-secrets.yaml`, `deployd-api-secrets.yaml`, `ghcr-pull-secret.yaml`, `cloudflare-dns-secret.yaml`

## Encryption convention

When spec 153 lands:

- Repo-root `.sops.yaml` declares two recipients per spec 151 §Clarification 9: operator-host laptop key + Bitwarden-stored backup key. Either private key decrypts.
- Filename pattern: `<purpose-kebab-case>.yaml` (no `.enc.` suffix — SOPS detects encryption by the presence of the `sops:` block at the bottom of the manifest).
- Encrypt with `sops --encrypt --in-place <file>`. Decrypt with `sops --decrypt <file>` (read-only view) or operate on the file directly with `sops <file>` (interactive edit).
- Rotation: `sops updatekeys <file>` after `.sops.yaml` recipient change. Spec 151 §Clarification 9 OOS v1 for the rotation tooling itself.

## Out of scope (spec 151)

- Any per-purpose Secret YAML in this directory.
- `.sops.yaml` recipients beyond the operator-host + Bitwarden pair.
- Multi-operator key custody (spec 151 §Clarification 9 OOS v1).
