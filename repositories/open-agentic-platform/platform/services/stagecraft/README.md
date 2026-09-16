# Statecraft — SaaS Control Plane

Statecraft is the organisational control plane for Open Agentic Platform, built on [Encore.ts](https://encore.dev). It provides identity, workspace management, knowledge intake, deployment governance, and audit infrastructure.

## What it does

| Domain | Capabilities |
|--------|-------------|
| **Auth & Identity** | Signup/signin, session management, RBAC (user/admin), admin bootstrap |
| **Workspaces** | Org → workspace → project hierarchy, member access control |
| **Knowledge Intake** | Source connectors (upload, SharePoint, S3, Azure Blob, GCS), knowledge object lifecycle (imported → extracting → extracted → classified → available), document bindings to projects |
| **GitHub Integration** | Webhook ingestion, PR preview deployments, token brokering (absorbed from github-app/Probot) |
| **Monitoring** | Uptime monitoring with Slack notifications |
| **Admin** | User management, audit log, org settings |
| **Factory Lifecycle** | Project init, stage confirmation, pipeline audit trail (spec 077) |

## Stack

- **Backend**: Encore.ts (type-safe APIs with built-in infra primitives)
- **ORM**: Drizzle (PostgreSQL)
- **Frontend**: React Router v7 (in `web/`)
- **Package manager**: npm (not pnpm — excluded from root workspace)

## Local Development

```bash
npm run start
# App: http://localhost:4000 | Encore dashboard: http://localhost:9400
```

### Admin Bootstrap

There is no default admin password. Set `BOOTSTRAP_ADMIN_EMAIL` so the first signup with that email is auto-promoted to admin:

```bash
BOOTSTRAP_ADMIN_EMAIL=admin@example.com npm run encore
```

Then open http://localhost:4000 and sign up with that email.

## Testing

```bash
encore test          # Recommended — sets up test databases, isolated infra per test
npm test             # Direct vitest without infra setup
```

## Key Files

| Path | Purpose |
|------|---------|
| `api/auth/` | Authentication endpoints and middleware |
| `api/admin/` | Admin panel API |
| `api/monitor/` | Uptime monitoring service |
| `api/slack/` | Slack integration |
| `api/github/` | GitHub webhook handling and token brokering |
| `api/db/schema.ts` | Drizzle ORM schema (all tables) |
| `web/` | React Router v7 frontend |
| `docs/encore-ts-reference.md` | Full Encore.ts API reference |
| `CLAUDE.md` | Encore.ts conventions for AI-assisted development |

## Deployment

Deployed to Azure AKS via Helm chart (`platform/charts/statecraft/`). Docker images built with `encore build docker`. See `platform/CLAUDE.md` for infrastructure details.

## Specs

- Spec 077 — Statecraft Factory API
- Spec 087 — Unified Workspace Architecture (workspace entity model, knowledge intake domain)
