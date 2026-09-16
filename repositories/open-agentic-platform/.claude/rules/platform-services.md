---
paths:
  - "platform/**"
---

# Platform services — Encore.ts and deployd-api

## statecraft (Encore.ts)

- TypeScript SaaS in `platform/services/statecraft/`.
- Uses **npm**, not pnpm — explicitly excluded from the pnpm workspace.
- Local dev: `cd platform/services/statecraft && npm run start` (Encore.ts on :4000).
- Slack, Atlassian, GitHub webhook handling, admin, monitoring live here.

## deployd-api-rs (Rust)

- axum + hiqlite K8s deployment orchestrator.
- Build: `cargo build --release --manifest-path platform/services/deployd-api-rs/Cargo.toml`.
- Excluded from the root workspace; treat as a separate cargo project.

## Infrastructure

```bash
cd platform && make tf-init    # Init Terraform
cd platform && make tf-apply   # Full Azure deployment
```

- Terraform modules: Azure AKS, ACR, KeyVault.
- Helm charts: statecraft, deployd-api, rauthy.
- Baseline K8s policies: network deny, resource quotas (`platform/k8s/`).

## Combined dev loop

`make dev-platform` from the repo root starts statecraft + deployd-api
in the background.
