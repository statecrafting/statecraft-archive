# CLAUDE.md — Platform Layer

The platform layer is the organisational control plane for OAP. It provides identity, deployment orchestration, and audit infrastructure running on Azure Kubernetes Service.

**Imported from:** `statecrafting/platform` (git subtree, 2026-03-31)

## Services

| Service | Stack | Port | Purpose |
|---------|-------|------|---------|
| **statecraft** | Encore.ts, Drizzle ORM, React Router v7 | 4000 | SaaS platform: auth, admin, uptime monitoring, Slack integration; `api/github/` handles webhook ingestion and token brokering (absorbed from github-app) |
| **deployd-api-rs** | Rust (axum, hiqlite) | 8080 | K8s deployment orchestration with Helm, OIDC JWT auth |

> **github-app** (Probot) has been absorbed into statecraft. Webhook handling and PR preview deployment logic now lives in `services/statecraft/api/github/`.

## Package Manager

Platform services use **npm** (not pnpm). They are excluded from the root `pnpm-workspace.yaml`. Each service has its own `package.json` and `package-lock.json`.

## Database

Statecraft uses PostgreSQL via Drizzle ORM. Schema is in `services/statecraft/api/db/schema.ts`. Spec 119 (2026-04-29) collapsed the workspace abstraction into project; the entity hierarchy is now `organization → project → repo`.

- `users` — accounts with roles (user/admin), email, password hash
- `sessions` — session tokens with 14-day TTL, user/admin kinds
- `audit_log` — append-only audit trail (actor, action, target, metadata JSONB)
- `organizations` — top-level org (name, slug, GitHub identity)
- `projects` — top-level unit of governance under organization (org_id, name, slug, description, object_store_bucket, factory_adapter_id). Owns the storage bucket, knowledge corpus, source connectors, sync runs, runtime threading, permission grants, factory adapter binding, environments, and members.
- `project_repos` — GitHub repo links (project_id, github_org, repo_name, default_branch)
- `environments` — deployment targets (project_id, name, kind, k8s_namespace, auto_deploy_branch)
- `project_members` — team access (project_id, user_id, role: viewer/developer/deployer/admin)
- `project_grants` — runtime tool permissions for OPC governance (user_id, project_id, enable_file_read/write, enable_network, max_tier). Replaces the prior workspace_grants table per spec 119 §6.4.
- `source_connectors` — external knowledge sources (project_id, type: upload/sharepoint/s3/azure-blob/gcs, config, sync schedule) (spec 087 Phase 2)
- `knowledge_objects` — canonical normalised documents in the project object store (project_id, storage_key, filename, mime_type, content_hash, state lifecycle: imported→extracting→extracted→classified→available, provenance JSONB) (spec 087 Phase 2)
- `sync_runs` — connector sync execution history (connector_id, project_id, status: running/completed/failed, objects_created/updated/skipped, delta_token for incremental sync) (spec 087 Phase 4)
- `factory_artifact_substrate` / `factory_artifact_substrate_audit` / `factory_bindings` — content-addressed factory substrate (spec 139). One row per upstream file (verbatim mirror); per-org `user_body` overrides; universal `factory_bindings` pinning. Org-scoped agent definitions (spec 111) live as `(origin='user-authored', kind='agent')` rows; `factory_bindings` replaces `project_agent_bindings` (spec 123). Replaces spec 108's `factory_adapters` / `factory_contracts` / `factory_processes` bucket-blob trio. The `agent_catalog`, `agent_catalog_audit`, `project_agent_bindings`, and four legacy `factory_upstreams` per-side columns were dropped by migrations 34 (Phase 4 narrow) and 35 (Phase 4b). The spec 108/111/123 wire shapes project from the substrate at read time.

## Identity

Authentication is handled by **Rauthy** (self-hosted OIDC/OAuth2 provider, Rust-based). Helm chart in `charts/rauthy/`. Uses hiqlite (embedded Raft SQLite) for HA — no external database required. Machine-to-machine auth uses standard OIDC client credentials flow.

## Local Development

```bash
# Statecraft (requires Encore CLI: https://encore.dev/docs/install)
cd services/statecraft && npm run start
# → http://localhost:4000 (app), http://localhost:9400 (Encore dashboard)

# Deployd-API (Rust)
cargo build --release --manifest-path services/deployd-api-rs/Cargo.toml
# → http://localhost:8080
```

## Infrastructure

Two-layer Terraform in `infra/terraform/`:
1. **Core** (`envs/dev/core/`) — Azure Resource Group, AKS cluster, ACR, Key Vault
2. **Cluster** (`envs/dev/cluster/`) — Ingress-nginx, cert-manager, CSI secrets provider

```bash
make tf-init      # Init both layers
make tf-apply     # Create Azure resources + deploy
make docker-push  # Build and push container images to ACR
make tf-destroy   # Tear down everything
```

## Helm Charts

- `charts/statecraft/` — Main SaaS service (ingress: statecraft.localdev.online)
- `charts/deployd-api/` — Deployment orchestrator
- `charts/rauthy/` — Rauthy OIDC identity provider (ingress: rauthy.localdev.online)

## Key Integration Points with OPC

- **Policy bundle serving** — statecraft can serve compiled policy bundles to axiomregent over HTTP at `/api/policy-bundle/:projectId` (renamed from per-workspace by spec 119 §4.5).
- **Audit streaming** — axiomregent can POST audit records to statecraft's `audit_log` table.
- **Permission grants** — statecraft auth can provide project-scoped grants (`project_grants`) to the desktop app.
- **Agent authorization** — statecraft can validate agent execution against org-level policies.
- **Duplex sync** — `/api/sync/duplex` is org-scoped; one OPC connection observes every project in the user's org. Per-event `projectId` carries on each variant for desktop-side filtering.

## Policy Rules

```policy
id: SHARD-PLATFORM-infra-guard
description: "Block terraform destroy in platform layer without confirmation"
mode: enforce
scope: domain:platform
gate: destructive_operation
```
