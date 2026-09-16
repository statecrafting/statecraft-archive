# Statecraft Service

The `statecraft` service is the central SaaS backend for the Open Agentic Platform. Built with Encore.ts, it provides the core control plane APIs for projects, audit, and factory lifecycle management.

## Core Responsibilities

- **Authentication and RBAC**: Validates Rauthy-issued OIDC tokens and manages project-level roles (viewer, developer, deployer, admin) and tool grants.
- **Project Management**: The primary unit of governance. Projects own storage buckets, knowledge corpuses, factory adapter bindings, and environments.
- **Knowledge Extraction**: Manages the pipeline for ingesting external documents (via source connectors like S3 or SharePoint), extracting content, and making it available to agents.
- **Audit Logging**: Maintains an immutable, append-only `audit_log` of all actions taken by humans and agents across the platform.
- **Factory API**: Provides the lifecycle API for the two-phase Factory engine, tracking runs, stages, and artifact hashes.
- **Webhooks**: Handles incoming events from GitHub and Slack.

## Database Schema

Statecraft uses PostgreSQL via Drizzle ORM. The schema is defined in `services/statecraft/api/db/schema.ts`. Key tables include:

- `organizations`, `projects`, `project_repos`
- `users`, `project_members`, `project_grants`
- `audit_log`
- `knowledge_objects`, `source_connectors`, `sync_runs`
- `factory_artifact_substrate`: The content-addressed storage for factory templates and agent definitions (Spec 139).

## Encore.ts Integration

Statecraft leverages the Encore.ts framework for rapid development and built-in distributed tracing. 

To run the service locally:

```bash
cd platform/services/statecraft
npm run start
```

This starts the API at `http://localhost:4000` and the Encore development dashboard at `http://localhost:9400`.
