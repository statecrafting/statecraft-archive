---
id: "073-axiomregent-unification"
title: "Axiomregent Unification: Crate Absorption, Hiqlite Storage, and GitHub Org Integration"
feature_branch: "073-axiomregent-unification"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-04-03"
authors: ["open-agentic-platform"]
language: en
code_aliases: ["AXIOM_UNIFY", "HIQLITE_MIGRATION", "GITHUB_ORG"]
sources: ["gitctx", "blockoli", "stackwalk", "titor", "github-app"]
extends:
  - spec: "037-cross-platform-axiomregent"
    nature: wrapping
    unit: { kind: crate, id: axiomregent }
supersedes:
  - spec: "038-titor-tauri-command-wiring"
    scope: full
  - spec: "040-blockoli-semantic-search-wiring"
    scope: full
establishes:
  - unit: { kind: directory, path: platform/services/deployd-api-rs }
references:
  - role: historical
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/titor.rs }
  - role: historical
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/search.rs }
summary: >
  Consolidates five standalone crates and services (gitctx, blockoli, stackwalk, titor, github-app)
  into axiomregent and statecraft. Migrates axiomregent from synchronous rusqlite to async hiqlite
  for unified storage, distributed coordination, and cross-session event propagation. Introduces
  GitHub organisation-level integration via a platform-brokered App installation token flow with
  per-tool scope narrowing. Rewrites deployd-api from Node.js/Express to Rust with hiqlite-backed
  persistent deployment state. Eliminates five standalone codebases and nine fragmented storage
  backends in favour of two unified layers: hiqlite (structured data + coordination) and filesystem
  (large binary blobs).
---

# Feature Specification: Axiomregent Unification

## Purpose

Axiomregent is the governed MCP server at the centre of every Claude Code session in OAP. Today it
operates as a single-process, single-session binary with a synchronous router, nine fragmented
storage backends, and no awareness of GitHub, semantic search, or checkpointing — those live in
separate binaries (gitctx, blockoli, titor) that run as sidecars or subprocesses with no shared
state, governance, or coordination.

This spec addresses five structural problems:

1. **Fragmented tool surface.** Claude Code sessions access GitHub via a separate gitctx-mcp
   process (spawned fresh per request, defeating its cache), semantic search via blockoli (library
   in desktop only, not exposed via MCP), and checkpointing via titor (library in desktop only).
   None of these go through axiomregent's governance layer (tier enforcement, policy evaluation,
   audit).

2. **Ephemeral state.** Leases, run history, feature graph caches, and policy bundles are in-memory
   HashMaps that vanish on process restart. There is no cross-session coordination — two concurrent
   Claude sessions on the same repo have no awareness of each other's leases or mutations.

3. **Synchronous I/O on the tokio thread.** The router is a sync function inside `#[tokio::main]`.
   Every git subprocess, SQLite query, and filesystem scan blocks the tokio executor thread,
   stalling the probe port listener and policy refresh task.

4. **No GitHub organisation integration.** gitctx uses personal access tokens scoped to a single
   repo. There is no org-level webhook handling, no installation token brokering, and no governed
   GitHub API access through the platform.

5. **deployd-api is a Node.js POC with in-memory state.** Deployment records are lost on every
   restart. It cannot participate in the hiqlite coordination layer or share the Rust type system
   with the rest of the platform.

## Scope

### In scope

- Absorb gitctx's GitHub client modules into axiomregent as `github.*` tools
- Absorb blockoli's embedding + vector store into axiomregent as `search.*` tools
- Absorb stackwalk's tree-sitter parsing as internal modules within axiomregent
- Replace axiomregent's `snapshot/` subsystem with a hiqlite-backed implementation incorporating
  titor's checkpoint, restore, fork, GC, and Merkle verification capabilities
- Migrate axiomregent from rusqlite to hiqlite as the unified storage and coordination layer
- Refactor axiomregent's router from sync to async (required by hiqlite's async-only API)
- Implement GitHub App installation token brokering in statecraft (new Seam E)
- Absorb github-app's Probot webhook handlers into statecraft
- Per-tool GitHub token scope narrowing in the statecraft token broker
- Rewrite deployd-api in Rust with hiqlite-backed deployment state persistence
- Delete `crates/gitctx/`, `crates/blockoli/`, `crates/stackwalk/`, `crates/titor/`,
  `platform/services/github-app/` after absorption
- Update CI workflows, Tauri sidecar config, and desktop app integration points

### Out of scope

- Multi-node axiomregent cluster deployment (hiqlite supports it; this spec builds the foundation
  but does not define the K8s StatefulSet deployment model for axiomregent)
- GitHub Discussions, Projects v2, or Milestones API coverage
- GitHub OAuth federation in Rauthy for user SSO (separate concern from App installation tokens)
- Migrating statecraft from PostgreSQL to hiqlite (statecraft keeps Postgres via Encore.ts)
- Changes to the spec compiler, registry consumer, or spec-lint tools
- OPC desktop frontend changes beyond updating import paths for absorbed crate APIs

## Requirements

### Functional

**FR-001** Axiomregent SHALL expose `github.*` MCP tools covering: repository navigation
(`github.find_repo`, `github.list_dir`, `github.read_file`, `github.read_files`,
`github.get_tree`, `github.switch_branch`), issues (`github.search_issues`, `github.get_issue`,
`github.list_issue_comments`), pull requests (`github.search_prs`, `github.get_pr`,
`github.list_pr_comments`), commits (`github.list_commits`, `github.get_commit`,
`github.compare_commits`, `github.blame_file`), releases (`github.list_releases`,
`github.get_release`, `github.compare_releases`), and insights (`github.get_contributors`,
`github.get_repo_stats`, `github.get_dependency_graph`). All tools SHALL be subject to
axiomregent's tier enforcement, policy evaluation, and audit pipeline.

**FR-002** Axiomregent SHALL expose `search.index` and `search.semantic` MCP tools for semantic
code search using tree-sitter parsing and embedding-based vector similarity. The embedding model
(all-MiniLM-L6-v2 via fastembed/ONNX Runtime) SHALL be included in the default build with no
feature gate.

**FR-003** Axiomregent SHALL expose checkpoint tools: `checkpoint.create`, `checkpoint.restore`,
`checkpoint.list`, `checkpoint.timeline`, `checkpoint.fork`, `checkpoint.diff`,
`checkpoint.verify`, `checkpoint.gc`, `checkpoint.status`, `checkpoint.info`. These SHALL replace
the existing `snapshot.*` tools. The `snapshot.*` tool names SHALL be retained as aliases during a
deprecation period of one release cycle.

**FR-004** All axiomregent structured state (snapshot/checkpoint metadata, manifests, leases, run
history, embeddings, GitHub token cache, policy bundles, feature graph metadata) SHALL be stored in
a single hiqlite instance. Large binary content (file blobs, compressed snapshots) SHALL remain on
the filesystem in the existing sharded layout.

**FR-005** The hiqlite KV cache SHALL store GitHub installation tokens with a 50-minute TTL
(tokens expire after 60 minutes), serialised kd-trees for indexed projects, and policy bundles
keyed by repo root.

**FR-006** Hiqlite `listen/notify` SHALL propagate the following events across axiomregent sessions
sharing the same hiqlite instance: `checkpoint.created`, `index.updated`, `lease.acquired`,
`lease.released`, `policy.updated`.

**FR-007** Hiqlite distributed locks (`dlock`) SHALL coordinate exclusive write access when
multiple axiomregent sessions operate on the same repository. Tools classified as Tier 2 or Tier 3
that mutate the worktree SHALL acquire a dlock keyed by the canonical repo root path before
proceeding.

**FR-008** Statecraft SHALL expose `POST /api/github/token` accepting `repo` (owner/name) and
`scope` (GitHub permission string) parameters. It SHALL look up the `githubInstallId` from the
`projectRepos` table, sign an RS256 JWT as the GitHub App, exchange it for a scoped installation
access token via `POST /app/installations/{id}/access_tokens`, and return the short-lived token.
The endpoint SHALL require a valid M2M bearer token (existing Rauthy OIDC flow).

**FR-009** Statecraft SHALL narrow GitHub installation token permissions to the minimum required
for the requesting tool's operation. The scope mapping SHALL be:

| Tool category | GitHub token permissions |
|---------------|------------------------|
| `github.read_file`, `github.list_dir`, `github.get_tree`, `github.search_code` | `contents: read` |
| `github.search_issues`, `github.get_issue`, `github.list_issue_comments` | `issues: read` |
| `github.search_prs`, `github.get_pr`, `github.list_pr_comments` | `pull_requests: read` |
| `github.list_commits`, `github.get_commit`, `github.compare_commits`, `github.blame_file` | `contents: read` |
| `github.list_releases`, `github.get_release`, `github.compare_releases` | `contents: read` |
| `github.get_contributors`, `github.get_repo_stats`, `github.get_dependency_graph` | `metadata: read` |

**FR-010** Statecraft SHALL handle GitHub App webhook events: `installation.created` (store
installation_id), `repository.created` (auto-register in `projectRepos`), `push` to default branch
(trigger governance checks), `pull_request.*` (PR preview deploy + governed review checks),
`check_suite.completed` (update deployment status), `member`/`team` (sync org membership). This
replaces the standalone github-app Probot service.

**FR-011** deployd-api SHALL be rewritten in Rust as a standalone binary using axum for HTTP,
hiqlite for persistent deployment state, and the `kube` crate for Kubernetes API interaction.
Deployment records SHALL survive process restarts. The existing REST API contract (`POST
/v1/deployments`, `GET /v1/deployments/:releaseId/status`, `GET
/v1/deployments/:releaseId/logs`) SHALL be preserved.

**FR-012** deployd-api SHALL authenticate inbound requests by verifying Rauthy-issued JWTs against
the OIDC discovery document, preserving the existing `deployd:deploy` scope requirement.

**FR-013** Axiomregent's `handle_request` SHALL be an `async fn`. All `std::process::Command`
calls SHALL be replaced with `tokio::process::Command`. All `std::sync::Mutex`-guarded state SHALL
be migrated to hiqlite tables or `tokio::sync::Mutex` where hiqlite is not applicable.

**FR-014** All timestamps in hiqlite write queries SHALL be generated in Rust application code
(not via SQL `NOW()` or `DATETIME('now')`), as required by hiqlite's deterministic Raft state
machine.

### Non-functional

**NF-001** Axiomregent single-node startup time SHALL remain under 500ms including hiqlite
initialisation and schema migration.

**NF-002** GitHub API response caching via hiqlite KV SHALL achieve sub-millisecond cache hits
(comparable to or faster than the current in-memory HashMap).

**NF-003** Semantic search via `search.semantic` SHALL return results within 2 seconds for
projects with up to 50,000 code blocks indexed.

**NF-004** The hiqlite data directory SHALL be configurable via `AXIOMREGENT_DATA_DIR` environment
variable, defaulting to `<repo_root>/.axiomregent/`.

**NF-005** deployd-api Rust binary SHALL start in under 200ms and handle 100 concurrent deployment
status queries without degradation.

**NF-006** The axiomregent binary size increase from absorbing blockoli (ONNX Runtime) SHALL not
exceed 80MB over the current baseline.

## Architecture

### Axiomregent Internal Architecture (Post-Unification)

```
axiomregent binary
│
├── main.rs                    — #[tokio::main], async stdio loop, hiqlite::start_node()
│
├── router/
│   ├── mod.rs                 — async fn handle_request(), ToolProvider trait dispatch
│   ├── permissions.rs         — tier/grant enforcement (unchanged logic, async interface)
│   ├── policy_bundle.rs       — policy kernel evaluation (bundle from hiqlite KV cache)
│   ├── audit.rs               — audit line to hiqlite table + optional HTTP (Seam B)
│   └── policy_refresh.rs      — background policy fetch (Seam A, unchanged)
│
├── github/                    — absorbed from gitctx
│   ├── client.rs              — octocrab client, platform-brokered token resolution
│   ├── context.rs             — GitHubContext (selected repo, branch, token)
│   ├── cache.rs               — hiqlite KV cache adapter (replaces in-memory LRU)
│   ├── commits.rs, issues.rs, pulls.rs, releases.rs, search.rs, stats.rs
│   └── tools.rs               — github.* MCP tool definitions
│
├── search/                    — absorbed from blockoli + stackwalk
│   ├── parser.rs              — tree-sitter AST parsing (from stackwalk)
│   ├── indexer.rs             — directory indexing + block extraction (from stackwalk)
│   ├── call_graph.rs          — call graph generation (from stackwalk)
│   ├── embeddings.rs          — fastembed encoder (from blockoli)
│   ├── store.rs               — hiqlite embeddings table (replaces blockoli SQLite)
│   └── tools.rs               — search.index, search.semantic MCP tools
│
├── checkpoint/                — replaces snapshot/, incorporates titor concepts
│   ├── store.rs               — hiqlite tables for checkpoint metadata + manifests
│   ├── blobs.rs               — filesystem CAS (sharded, LZ4 compressed)
│   ├── lease.rs               — hiqlite-backed leases + dlock coordination
│   ├── merkle.rs              — SHA-256 Merkle tree (from titor)
│   ├── verification.rs        — checkpoint + timeline integrity checks (from titor)
│   └── tools.rs               — checkpoint.* MCP tools (+ snapshot.* aliases)
│
├── workspace/mod.rs           — write_file, delete, apply_patch (async subprocess)
├── agent_tools.rs             — propose, execute, verify (uses checkpoint/ instead of snapshot/)
├── feature_tools.rs           — feature graph with hiqlite KV cache
├── run_tools.rs               — run history in hiqlite table (persistent across restarts)
├── internal_client.rs         — McpClient impl (updated for async + checkpoint/)
│
├── platform_config.rs         — env-var config (adds PLATFORM_GITHUB_TOKEN_URL)
├── config/mod.rs              — StorageConfig (hiqlite NodeConfig + blob dir)
└── build.rs                   — cc compilation of tree-sitter grammars from grammars/
```

### ToolProvider Trait (Router Refactor)

The current monolithic match expression in `router/mod.rs` (~1,332 lines) SHALL be replaced with
a trait-based dispatch system:

```rust
#[async_trait]
pub trait ToolProvider: Send + Sync {
    fn tool_schemas(&self) -> Vec<serde_json::Value>;
    async fn handle(&self, name: &str, args: &Map<String, Value>) -> Option<Result<Value>>;
    fn tier(&self, name: &str) -> Option<ToolTier>;
    fn permissions(&self, name: &str) -> ToolPermissions;
}
```

The router iterates `Vec<Arc<dyn ToolProvider>>` in registration order, calling `handle()` on each
until one returns `Some`. Tier/grant/policy checks run before dispatch using `tier()` and
`permissions()` from the matched provider.

### Hiqlite Schema

```sql
-- Checkpoint / snapshot metadata
CREATE TABLE checkpoints (
    checkpoint_id   TEXT PRIMARY KEY,
    repo_root       TEXT NOT NULL,
    parent_id       TEXT,
    label           TEXT,
    head_sha        TEXT,
    fingerprint     TEXT NOT NULL,       -- JSON: {head_oid, index_oid, status_hash}
    state_hash      TEXT NOT NULL,       -- SHA-256 of checkpoint struct
    merkle_root     TEXT NOT NULL,       -- SHA-256 Merkle root of all file entries
    file_count      INTEGER NOT NULL,
    total_bytes     INTEGER NOT NULL,
    created_at      TEXT NOT NULL,       -- ISO 8601, app-generated
    metadata        TEXT                 -- JSON blob for extensible metadata
);

-- File manifest entries (queryable per-path)
CREATE TABLE manifest_entries (
    checkpoint_id   TEXT NOT NULL,
    path            TEXT NOT NULL,
    blob_hash       TEXT NOT NULL,
    size_bytes      INTEGER NOT NULL,
    permissions     INTEGER,
    PRIMARY KEY (checkpoint_id, path)
);

-- Blob reference counts
CREATE TABLE blob_refs (
    blob_hash       TEXT PRIMARY KEY,
    ref_count       INTEGER NOT NULL DEFAULT 1,
    size_bytes      INTEGER NOT NULL,
    compression     TEXT NOT NULL DEFAULT 'lz4'
);

-- Governance leases (persistent, replaces in-memory HashMap)
CREATE TABLE leases (
    lease_id        TEXT PRIMARY KEY,
    repo_root       TEXT NOT NULL,
    fingerprint     TEXT NOT NULL,       -- JSON
    touched_files   TEXT NOT NULL,       -- JSON array
    grants          TEXT NOT NULL,       -- JSON: PermissionGrants
    issued_at       TEXT NOT NULL,
    expires_at      TEXT NOT NULL
);

-- Run history (persistent, replaces in-memory HashMap)
CREATE TABLE runs (
    run_id          TEXT PRIMARY KEY,
    skill_name      TEXT NOT NULL,
    repo_root       TEXT NOT NULL,
    status          TEXT NOT NULL,       -- pending, running, completed, failed
    exit_code       INTEGER,
    log_path        TEXT,
    started_at      TEXT NOT NULL,
    completed_at    TEXT
);

-- Semantic search embeddings
CREATE TABLE embeddings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name    TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    block_type      TEXT NOT NULL,       -- function, method, class, module
    function_name   TEXT,
    code_content    TEXT NOT NULL,
    vector          BLOB NOT NULL,       -- 384 x f32 = 1536 bytes
    call_edges      TEXT,                -- JSON array of outgoing calls
    indexed_at      TEXT NOT NULL
);
CREATE INDEX idx_embeddings_project ON embeddings(project_name);

-- Audit log (local, supplements HTTP forwarding to Seam B)
CREATE TABLE audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name       TEXT NOT NULL,
    tier            INTEGER NOT NULL,
    repo_root       TEXT,
    lease_id        TEXT,
    policy_decision TEXT,
    timestamp       TEXT NOT NULL,
    metadata        TEXT                 -- JSON
);

-- Deployment records (deployd-api)
CREATE TABLE deployments (
    deployment_id   TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    app_id          TEXT NOT NULL,
    env_id          TEXT NOT NULL,
    release_sha     TEXT NOT NULL,
    artifact_ref    TEXT NOT NULL,
    lane            TEXT NOT NULL,       -- LANE_A, LANE_B
    status          TEXT NOT NULL,       -- PENDING, APPLYING, ROLLED_OUT, FAILED, ROLLED_BACK
    app_slug        TEXT,
    env_slug        TEXT,
    desired_routes  TEXT,                -- JSON
    endpoints       TEXT,                -- JSON
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_deployments_composite
    ON deployments(app_id, env_id, release_sha);

-- Deployment events (append-only log)
CREATE TABLE deployment_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    deployment_id   TEXT NOT NULL REFERENCES deployments(deployment_id),
    event_type      TEXT NOT NULL,
    message         TEXT,
    timestamp       TEXT NOT NULL
);
```

Note: all `TEXT NOT NULL` timestamp columns are populated by Rust application code, never by SQL
date functions (FR-014).

### GitHub Token Brokering Flow

```
                                    GitHub API
                                        ^
                                        | (3) scoped installation token
                                        |
axiomregent                         statecraft
    |                                   |
    | (1) GET /api/github/token         |
    |     ?repo=owner/name              |
    |     &scope=contents:read          |
    |     Authorization: Bearer <m2m>   |
    | --------------------------------> |
    |                                   | (2) look up githubInstallId
    |                                   |     sign RS256 JWT as App
    |                                   |     POST /app/installations/{id}/access_tokens
    |                                   |       permissions: { contents: "read" }
    |                                   |
    | <-------------------------------- |
    | (4) { token, expires_at }         |
    |                                   |
    | --> hiqlite KV cache (50min TTL)  |
    |                                   |
    | (5) octocrab::builder()           |
    |       .personal_token(token)      |
    |       .build()                    |
    v                                   v
  GitHub API call with scoped token
```

Cache key format: `github:token:{owner}/{repo}:{scope}` — ensures different scope requests for
the same repo get separate cached tokens.

### Statecraft GitHub Webhook Absorption

The Probot service is replaced by new Encore.ts API routes in statecraft:

```
platform/services/statecraft/api/github/
├── webhook.ts          — POST /api/github/webhook (signature verification, event dispatch)
├── token.ts            — POST /api/github/token (installation token broker, FR-008)
├── installations.ts    — installation.created handler → store in projectRepos
├── repositories.ts     — repository.created handler → auto-register
├── pullRequests.ts     — pull_request.* handler → preview deploy + governed checks
├── pushes.ts           — push handler → governance check trigger
├── membership.ts       — member/team handler → org membership sync
└── types.ts            — GitHub webhook payload types
```

GitHub App webhook signature verification uses `@octokit/webhooks-methods` to validate the
`X-Hub-Signature-256` header against the app's webhook secret.

### deployd-api Rust Architecture

```
platform/services/deployd-api-rs/
├── Cargo.toml          — axum, hiqlite, kube, tower-http, jsonwebtoken
├── src/
│   ├── main.rs         — hiqlite::start_node(), axum router, graceful shutdown
│   ├── auth.rs         — Rauthy OIDC JWT verification (JWKS discovery + cache)
│   ├── routes/
│   │   ├── deployments.rs  — POST /v1/deployments, GET status, GET logs
│   │   └── health.rs       — GET /healthz
│   ├── k8s/
│   │   ├── deploy.rs       — Helm upgrade --install via kube crate
│   │   ├── namespace.rs    — namespace creation + baseline policy application
│   │   └── policies.rs     — network policy, resource quota, limit range
│   ├── store.rs        — hiqlite deployments + deployment_events tables
│   └── config.rs       — env-var config (OIDC endpoint, audience, HQL_* vars)
├── Dockerfile          — multi-stage Rust build
└── migrations/         — hiqlite embedded migrations
```

deployd-api-rs uses hiqlite in single-node mode for MVP. The deployment records and event log
persist across restarts. The same binary can later scale to a multi-node hiqlite cluster for HA
with only configuration changes.

### Cross-Session Event Propagation

When multiple axiomregent instances share a hiqlite data directory (or cluster), events flow via
hiqlite `listen/notify`:

| Event | Emitted by | Consumed by | Action |
|-------|-----------|-------------|--------|
| `checkpoint.created` | `checkpoint.create` tool | Other sessions on same repo | Re-validate lease fingerprint |
| `index.updated` | `search.index` tool | Other sessions on same project | Invalidate kd-tree in KV cache |
| `lease.acquired` | Lease issuance (dlock) | Other sessions on same repo | Display "repo locked by session X" |
| `lease.released` | Lease release / expiry | Other sessions on same repo | Clear lock indicator |
| `policy.updated` | Policy refresh task | All sessions | Reload policy bundle from KV cache |

### Crate Elimination Plan

| Crate/Service | Absorbed Into | What Moves | What Is Dropped |
|---------------|--------------|------------|-----------------|
| `crates/gitctx/` | axiomregent `github/` | `github/` client modules, `context.rs`, `cache.rs` | rmcp server layer, `mcp_main.rs`, standalone binary, `auth/` PAT flow |
| `crates/blockoli/` | axiomregent `search/` | `embeddings/encoder.rs`, `vector_store/sqlite.rs` types, `blocks.rs` | actix-web HTTP server, `routes.rs`, `main.rs`, qdrant-client dep |
| `crates/stackwalk/` | axiomregent `search/` | All 7 modules (`parser`, `indexer`, `call_graph`, `call_stack`, `config`, `block`, `utils`) | Standalone crate boundary, `build.rs` (merged into axiomregent's) |
| `crates/titor/` | axiomregent `checkpoint/` | `merkle.rs`, `verification.rs`, compression strategy, timeline DAG concepts | Filesystem CAS (replaced by hiqlite + blob FS), CLI binary, MCP example |
| `platform/services/github-app/` | statecraft `api/github/` | Webhook event handling logic (3 handlers) | Probot framework, standalone Dockerfile, smee-client dev proxy |
| `platform/services/deployd-api/` | `platform/services/deployd-api-rs/` | REST API contract, K8s deployment logic | Node.js/Express, in-memory Map store, npm dependencies |

After absorption, the following directories are deleted:
- `crates/gitctx/`
- `crates/blockoli/`
- `crates/stackwalk/`
- `crates/titor/`
- `platform/services/github-app/`
- `platform/services/deployd-api/` (replaced by `deployd-api-rs/`)

The `grammars/` directory at repo root is retained (tree-sitter C sources, now compiled by
axiomregent's `build.rs`).

## Implementation Approach

### Phase 1: Hiqlite Foundation + Async Router

1. Add `hiqlite` dependency to axiomregent with features `sqlite`, `dlock`, `listen_notify_local`, `cache`
2. Define the hiqlite schema (checkpoints, manifest_entries, blob_refs, leases, runs, audit_log)
3. Implement `hiqlite::start_node()` in `main.rs` with single-node config
   - *Amended 2026-06-01:* the single node's `addr_raft`/`addr_api` are
     resolved to concrete free loopback ports (`bind 127.0.0.1:0` → read
     `local_addr()` → release both listeners → advertise the concrete ports
     to `start_node`, which rebinds them) — the same resolve-back pattern
     `main.rs` already uses for the stderr-announced probe port. Advertising
     `127.0.0.1:0` directly recorded port 0 in Raft membership, so the
     in-process client's background WS stream dialed an unconnectable address
     and flooded stderr with `EADDRNOTAVAIL` (os error 49) once per second.
     The single-node data path runs in-process regardless of that stream
     (`is_leader_*_with_state()` short-circuits to local Raft), so this is a
     log-noise fix, not a data-path change. Site:
     `crates/axiomregent/src/db/mod.rs::init_hiqlite` (the init landed here
     rather than `main.rs` as Phase 1 originally sketched).
   - *Amended 2026-06-01 (follow-up hardening):* the resolve-ports →
     `start_node` step is now wrapped in a bounded retry
     (`HIQLITE_BIND_ATTEMPTS = 3`). Because hiqlite has no fd-passing API, the
     freed ports are exposed to a TOCTOU window where another process can
     claim one before hiqlite rebinds; a lost race now re-resolves a fresh
     pair (`free_loopback_pair()`) and retries rather than failing startup.
     `migrate()` stays outside the retry — a DDL error is a real failure to
     propagate, not a bind race to retry.
4. Introduce `ToolProvider` trait and refactor router from monolithic match to trait dispatch
5. Make `handle_request` async; migrate all `std::process::Command` to `tokio::process::Command`
6. Migrate `snapshot/store.rs` from rusqlite to hiqlite tables
7. Migrate `LeaseStore` from in-memory HashMap to hiqlite `leases` table + dlock
8. Migrate `RunTools` from in-memory HashMap to hiqlite `runs` table
9. Migrate `FeatureTools` cache and `PolicyBundleCache` to hiqlite KV cache

**Checkpoint:** All existing 24 tools work with hiqlite backend. No new tools yet.

### Phase 2: Checkpoint Unification (Titor Absorption)

1. Extract titor's Merkle tree, verification, and compression modules into `checkpoint/`
2. Implement `checkpoint.create` backed by hiqlite metadata + filesystem blobs with LZ4
3. Implement `checkpoint.restore`, `checkpoint.fork`, `checkpoint.gc`, `checkpoint.verify`,
   `checkpoint.list`, `checkpoint.timeline`, `checkpoint.diff`, `checkpoint.status`,
   `checkpoint.info`
4. Wire `snapshot.*` names as aliases to `checkpoint.*` tools
5. Implement `listen/notify` for `checkpoint.created` events
6. Remove old `snapshot/` module
7. Delete `crates/titor/`

**Checkpoint:** Checkpoint tools fully operational. Titor crate removed.

### Phase 3: Search Absorption (Blockoli + Stackwalk)

1. Move stackwalk's 7 modules into `axiomregent/src/search/`
2. Merge stackwalk's `build.rs` grammar compilation into axiomregent's `build.rs`
3. Move blockoli's embedding encoder into `search/embeddings.rs`
4. Implement `search.index` tool: tree-sitter parse + embed + store in hiqlite `embeddings` table
5. Implement `search.semantic` tool: embed query + kd-tree search (kd-tree cached in hiqlite KV)
6. Implement `listen/notify` for `index.updated` events
7. Remove dead qdrant-client dependency
8. Delete `crates/blockoli/` and `crates/stackwalk/`
9. Update desktop app to call axiomregent MCP tools instead of direct library imports

**Checkpoint:** Semantic search available in Claude Code sessions. Two crates removed.

### Phase 4: GitHub Integration (gitctx Absorption + Platform Token Broker)

1. Move gitctx's `github/` client modules into `axiomregent/src/github/`
2. Strip gitctx's rmcp server layer; adapt tools as `ToolProvider` implementations
3. Replace PAT-based auth with platform token resolution:
   a. Check `PLATFORM_GITHUB_TOKEN_URL` env var
   b. If set, call statecraft `POST /api/github/token` with repo + scope
   c. Cache token in hiqlite KV with 50-minute TTL
   d. Fall back to `GITHUB_TOKEN` / `GH_TOKEN` env vars for local-only mode
4. Implement `POST /api/github/token` in statecraft (FR-008, FR-009)
5. Implement GitHub webhook handling in statecraft `api/github/` (FR-010)
6. Update `app.yml` permissions: add `checks: write`, `actions: write`, `pull_requests: write`,
   `contents: read`, `members: read`, `organization_administration: read`
7. Remove gitctx binary from Tauri `externalBin` and `tauri.conf.json`
8. Delete `crates/gitctx/` and `platform/services/github-app/`

**Checkpoint:** Governed GitHub access in Claude Code sessions. GitHub App is org-level.

### Phase 5: deployd-api Rust Rewrite

1. Create `platform/services/deployd-api-rs/` with axum + hiqlite + kube
2. Implement OIDC JWT verification against Rauthy
3. Implement `POST /v1/deployments` with hiqlite-backed state
4. Implement `GET /v1/deployments/:releaseId/status` and `/logs`
5. Implement K8s namespace creation + Helm deployment via kube crate
6. Apply baseline policies (network deny, resource quota, limit range)
7. Create Dockerfile and update Helm chart
8. Integration test against the existing API contract
9. Delete `platform/services/deployd-api/` (Node.js)

**Checkpoint:** deployd-api is Rust with persistent deployment state.

### Phase 6: Cleanup + CI

1. Update `.github/workflows/ci-axiomregent.yml` path filters for absorbed crate directories
2. Update `.github/workflows/build-axiomregent.yml` to include tree-sitter grammar compilation
3. Remove `.github/workflows/build-gitctx-mcp.yml`
4. Update `product/apps/opc/src-tauri/Cargo.toml` — remove gitctx, blockoli, stackwalk, titor deps
5. Update `product/apps/opc/src-tauri/tauri.conf.json` — remove gitctx-mcp from `externalBin`
6. Update desktop `commands/search.rs` and `commands/titor.rs` to use axiomregent MCP calls
7. Update `CLAUDE.md` crate table, build commands, and repository structure
8. Update `Makefile` targets

## Success Criteria

**SC-001** All 24 existing axiomregent MCP tools pass their current test suites against the
hiqlite backend with no regressions.

**SC-002** `github.*` tools return identical results to the standalone gitctx-mcp binary for the
same inputs, verified by a comparative test harness.

**SC-003** `search.semantic` returns relevant code blocks (top-5 precision >= 0.6) for a reference
set of 20 natural-language queries against the OAP codebase itself.

**SC-004** `checkpoint.create` followed by `checkpoint.restore` produces a byte-identical directory
state, verified by Merkle root comparison.

**SC-005** Leases persist across axiomregent process restart: a lease issued before restart is
valid after restart if the repo fingerprint has not changed.

**SC-006** Two concurrent axiomregent sessions on the same repo coordinate via dlock: the second
session's Tier 2/3 tool call blocks until the first session's lock is released.

**SC-007** `deployd-api-rs POST /v1/deployments` creates a deployment record that survives process
restart, verified by `GET /v1/deployments/:id/status` returning the correct state after restart.

**SC-008** Statecraft `POST /api/github/token` returns a scoped installation token that
successfully authenticates against the GitHub API for the requested permission scope and fails for
permissions not included in the scope.

**SC-009** `crates/gitctx/`, `crates/blockoli/`, `crates/stackwalk/`, `crates/titor/`,
`platform/services/github-app/`, and `platform/services/deployd-api/` are fully deleted with no
remaining references in any `Cargo.toml`, `package.json`, CI workflow, or documentation file.

**SC-010** Axiomregent binary size does not exceed current baseline + 80MB (ONNX Runtime overhead).

## Dependencies

| Spec | Relationship |
|------|-------------|
| 044-multi-agent-orchestration | Orchestrator already uses hiqlite; shared patterns for store trait + migration |
| 047-governance-control-plane | Policy kernel evaluation unchanged; policy bundle source migrates to hiqlite KV |
| 052-state-persistence | State persistence patterns (SQLite schema, SSE replay) inform hiqlite schema design |
| 067-tool-registry | Tool registry crate (currently orphaned) may align with the new ToolProvider trait |
| 072-multi-cloud-k8s-portability | deployd-api-rs Helm chart must follow multi-cloud values pattern |

## Risk

**R-001** ONNX Runtime binary size bloat. The fastembed dependency adds ~50-80MB to the axiomregent
binary. Mitigation: accept the cost per user decision; monitor actual size in CI; strip debug
symbols in release builds.

**R-002** Hiqlite deterministic SQL constraint. Using `NOW()` or `RANDOM()` in write statements
panics the process. Mitigation: enforce via clippy lint or grep-based CI check; all timestamps
generated in Rust code (FR-014).

**R-003** Tree-sitter grammar compilation in axiomregent `build.rs`. The `../../grammars/` relative
path from `crates/axiomregent/` must resolve correctly. Mitigation: CI build step validates grammar
path; `build.rs` fails fast with a clear error if grammars directory is missing.

**R-004** rusqlite linking conflict. Axiomregent, blockoli, and the desktop app all bundle
rusqlite. Hiqlite also depends on rusqlite internally. Mitigation: hiqlite replaces direct
rusqlite usage in axiomregent; the desktop app remains in its isolated workspace; blockoli's
rusqlite usage is eliminated (replaced by hiqlite tables).

**R-005** GitHub App webhook secret management. Absorbing webhook handling into statecraft requires
the App's private key and webhook secret as CSI-mounted secrets. Mitigation: follow the existing
CSI secrets pattern used for OIDC M2M credentials; add secrets to the statecraft Helm chart values.

**R-006** Distributed lock timeout (10 seconds). Long-running tools like `workspace.apply_patch`
on large repos may exceed the dlock timeout. Mitigation: acquire dlock only for the mutation
window (not the entire tool call); release immediately after the git subprocess completes.

**R-007** Migration path from existing axiomregent data. Users with existing `.axiomregent/`
directories containing `store.sqlite` data need a migration to hiqlite. Mitigation: implement a
one-time migration that reads the old SQLite tables and writes to hiqlite on first startup;
skip if no legacy data exists.

## Release Markers

- **axiomregent v0.1.5 (2026-05-05):** crate-level version bump cut alongside OPC desktop v0.3.2. Carries the substrate_version.rs clippy fix and absorbs the spec 119 workspace-symbol cleanup that touched axiomregent-adjacent code. Version-only edits to `crates/axiomregent/Cargo.toml` and the inherited `crates/Cargo.lock` do not change spec semantics; recording the release here documents the artefact lineage for the spec/code coupling gate.


## Security hardening amendment (2026-07-02)

Added tenant-ownership binding (owner_sub) plus owner-or-admin checks on the deployd-api read and delete routes, a scope gate on the status and logs read handlers, fail-closed handling of an empty required scope, mandatory hiqlite raft/API secrets (dev-only fallback behind DEPLOYD_DEV), and DNS-label validation of the caller-supplied deploy namespace. Hardened the axiomregent workspace path guard (resolve_target_path) to lexically normalize and reject traversal, and recovered from mutex poisoning in feature_tools instead of panicking.

Recorded during the cross-subsystem security-hardening sweep; couples the security fixes in the code paths this spec authors to their owning spec per the spec 127 coupling gate.
