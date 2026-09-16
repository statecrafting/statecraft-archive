---
id: "082-artifact-integrity-platform-hardening"
title: "Artifact Integrity, Cross-Run Persistence, and Seam Auth Hardening"
feature_branch: "feat/082-artifact-integrity-platform-hardening"
status: approved
implementation: complete
kind: platform
domain: platform
created: "2026-04-07"
authors: ["open-agentic-platform"]
language: en
summary: >
  Closes four architectural gaps identified through AT Protocol pattern analysis:
  SHA-256 artifact integrity across pipeline stages, cross-run artifact
  persistence for incremental pipelines, OIDC replacement of static M2M tokens
  on all platform seams, and a namespaced contract ID convention for future
  extensibility.
code_aliases: ["ARTIFACT_INTEGRITY", "SEAM_OIDC", "CROSS_RUN"]
owner: bart
risk: high
extends:
  - spec: "074-factory-ingestion"
    nature: additive
    unit: { kind: crate, id: factory-contracts }
  - spec: "004-spec-to-execution-bridge-mvp"
    nature: additive
    unit: { kind: crate, id: orchestrator }
---

# Feature Specification: Artifact Integrity and Platform Hardening

## Phases

| Phase | Title | Status |
|-------|-------|--------|
| phase-1 | Artifact Integrity (hash + validate on read) | draft |
| phase-2 | Seam Auth OIDC Upgrade | draft |
| phase-3 | Cross-Run Artifact Persistence | draft |
| phase-4 | Namespaced Contract IDs | draft |

## Purpose

The orchestrator passes artifacts between pipeline stages via the filesystem (`$OAP_ARTIFACT_DIR/<run_id>/<step_id>/<filename>`). Today, there is no mechanism to verify that an artifact written by step N is intact when step N+1 reads it. If an agent is killed mid-write or a file is corrupted, downstream stages consume invalid input silently.

Additionally:
- Factory pipeline outputs are ephemeral. A re-run regenerates everything from scratch even when business requirements haven't changed, wasting tokens and time.
- Platform seam auth is inconsistent: Seam B uses a static bearer token (`PLATFORM_M2M_TOKEN`) with string comparison, while Seams A and C have no authentication at all. The platform already operates Rauthy as an OIDC provider with proven patterns in deployd-api.
- Seven incompatible naming conventions exist across tools, adapters, specs, events, and policies, with no governance for third-party contract identifiers.

This spec addresses all four gaps as independently deployable phases.

## Current State

| Component | Today | Target |
|-----------|-------|--------|
| Artifact integrity | `StageArtifact.hash` field exists but is never populated | SHA-256 hash computed after dispatch, verified before consumption |
| Cross-run reuse | `cleanup_run()` deletes all artifacts; no cross-run references | Content-addressable artifact store; `previous_pipeline_id` linkage |
| Seam B auth | Static `PLATFORM_M2M_TOKEN` string comparison | OIDC client_credentials JWT with scope validation |
| Seam A auth | No authentication (public endpoint) | OIDC JWT with `platform:policy:read` scope |
| Seam C auth | No authentication (public endpoint) | OIDC JWT with `platform:grants:read` scope |
| Contract naming | 7+ conventions (kebab, snake, colon-hierarchy, dot-notation, numeric prefix) | `dev.oap.{domain}.{type}.{name}` for new contracts |

## Design Principles

1. **Validate on read.** Every stage boundary is a trust boundary. Consuming stages verify artifact integrity before processing, even though agents run in a trusted orchestrator. This catches corruption, partial writes, and stale artifacts.

2. **Records outlive runs.** Pipeline artifacts persist beyond the run that created them, enabling incremental re-runs and cross-project knowledge reuse.

3. **Consistent auth at every seam.** All platform API endpoints use the same OIDC JWT validation, with static bearer token as a backward-compatible fallback.

4. **Namespace governance by convention.** New contracts follow a reverse-domain convention. Existing identifiers are grandfathered with no rename churn.

---

## Phase 1: Artifact Integrity

### Scope

- SHA-256 hashing of output artifacts after agent dispatch
- Hash verification of input artifacts before agent dispatch
- Population of the existing `StageArtifact.hash` field in factory pipeline state
- Hash propagation through `DispatchResult`, `StepSummaryEntry`, and `summary.json`

### FR-001: Artifact Hashing in ArtifactManager

`ArtifactManager` (`crates/orchestrator/src/artifact.rs`) SHALL expose two new methods:

```rust
impl ArtifactManager {
    /// SHA-256 hash of the file at `path`, hex-encoded (64 chars).
    pub fn hash_artifact(path: &Path) -> io::Result<String>;

    /// Returns `true` if the file at `path` hashes to `expected_hash`.
    pub fn verify_artifact(path: &Path, expected_hash: &str) -> io::Result<bool>;
}
```

The implementation mirrors the existing `hash_file()` in `crates/factory-engine/src/preflight.rs:17-22` using `sha2::Sha256`.

### FR-002: Hash Propagation in Dispatch Types

`DispatchResult` (`crates/orchestrator/src/lib.rs:124-127`) SHALL gain a hash map:

```rust
pub struct DispatchResult {
    pub tokens_used: Option<u64>,
    pub output_hashes: HashMap<String, String>,  // filename -> SHA-256 hex
}
```

`StepSummaryEntry` (`crates/orchestrator/src/lib.rs:114-122`) SHALL gain a hash map:

```rust
pub struct StepSummaryEntry {
    // ... existing fields ...
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub output_hashes: HashMap<String, String>,
}
```

The `#[serde(default)]` attribute ensures backward compatibility when reading older `summary.json` files that lack this field.

### FR-003: Post-Dispatch Hashing

After `GovernedExecutor::dispatch_step()` completes successfully, the executor SHALL hash every file declared in `request.output_artifacts`:

1. For each path in `output_artifacts`, call `ArtifactManager::hash_artifact(path)`
2. Collect results into `DispatchResult.output_hashes` keyed by filename (not full path)
3. If a declared output file does not exist, this is an error (existing behavior in the dispatch loop)

The `ClaudeCodeExecutor` (`crates/orchestrator/src/claude_executor.rs`) is the primary executor. The hashing occurs in the dispatch loop after the executor returns, not inside the executor itself, so all `GovernedExecutor` implementations benefit.

### FR-004: Pre-Dispatch Verification

Before dispatching a step, the orchestrator SHALL verify the integrity of all input artifacts that reference a previous step's output:

1. Maintain a `HashMap<String, HashMap<String, String>>` accumulating `step_id -> {filename -> hash}` from completed steps' `DispatchResult.output_hashes`
2. For each input of the form `step_id/filename`, look up the expected hash
3. Call `ArtifactManager::verify_artifact(path, expected_hash)`
4. On hash mismatch, return `OrchestratorError::DependencyMissing` with a message including expected vs. actual hash values

Inputs that reference external files (absolute paths, not `step_id/filename` format) are NOT verified — they are outside orchestrator control.

### FR-005: Factory StageArtifact Hash Population

When the factory harness updates stage state via `update_stage()` in `crates/factory-engine/src/harness_state.rs`, all `StageArtifact` records SHALL have their `hash` field populated by calling the existing `hash_file()` from `crates/factory-engine/src/preflight.rs`.

Currently, callers construct `StageArtifact` with empty `hash: String::new()`. After this change, they SHALL call `hash_file(&artifact_path)` and pass the result.

### NF-001: Hashing Performance

SHA-256 hashing of typical factory artifacts (markdown, YAML, source code files under 1 MB each) SHALL complete in under 10ms per file. No async I/O is required — the synchronous `std::io::copy` approach in the existing `hash_file()` is sufficient.

### Success Criteria

- **SC-001**: After a 2-step pipeline run, `summary.json` contains non-empty `output_hashes` for every completed step
- **SC-002**: `pipeline-state.json` `StageArtifact.hash` fields are 64-char hex strings (not empty)
- **SC-003**: Tampering with an output file between steps produces `OrchestratorError::DependencyMissing` with hash mismatch detail

---

## Phase 2: Seam Auth OIDC Upgrade

### Scope

- Rust OIDC client_credentials token exchange for axiomregent
- JWT validation middleware for all three statecraft platform seams
- Backward-compatible fallback to static `PLATFORM_M2M_TOKEN`
- Scope-based access control on each seam endpoint

### Current Auth Analysis

| Seam | Direction | Current Auth | Endpoint |
|------|-----------|-------------|----------|
| A (policy) | axiomregent -> statecraft | None (public) | `GET /api/policy-bundle/:workspaceId` |
| B (audit) | axiomregent -> statecraft | Static bearer token | `POST /api/audit-records` |
| C (grants) | axiomregent -> statecraft | None (public) | `GET /api/grants/:userId/:workspaceId` |

Proven OIDC patterns already exist:
- **Rust JWT validation**: `platform/services/deployd-api-rs/src/auth.rs` — RS256 JWKS with 10-min cache
- **TS client_credentials flow**: `platform/services/statecraft/api/deploy/oidcM2m.ts` — `fetchClientCredentialsToken()` + `getCachedDeploydAuthHeader()`
- **TS JWT validation**: `platform/services/statecraft/api/auth/rauthy.ts` — `validateJwt()` with 1-hour JWKS cache

### FR-010: Rust OIDC Client for axiomregent

A new module `crates/axiomregent/src/router/oidc_client.rs` SHALL implement OIDC client_credentials token exchange:

```rust
pub struct OidcM2mClient {
    client: reqwest::Client,
    token_endpoint: String,
    client_id: String,
    client_secret: String,
    cache: Mutex<Option<CachedToken>>,
}

struct CachedToken {
    access_token: String,
    expires_at: Instant,
}

impl OidcM2mClient {
    pub fn new(oidc_endpoint: String, client_id: String, client_secret: String) -> Self;

    /// Returns a valid bearer token, refreshing from the OIDC provider if expired.
    /// Tokens are cached with a 30-second safety margin before expiry.
    pub async fn get_bearer_token(&self, scope: &str) -> Result<String, OidcError>;
}
```

The token endpoint SHALL be discovered from `{oidc_endpoint}/.well-known/openid-configuration` (same pattern as `deployd-api-rs/src/auth.rs`). The token request uses `grant_type=client_credentials` (same pattern as `oidcM2m.ts`).

### FR-011: PlatformConfig OIDC Extension

`PlatformConfig` (`crates/axiomregent/src/platform_config.rs`) SHALL gain three optional fields:

```rust
pub struct PlatformConfig {
    // ... existing fields ...
    pub oidc_endpoint: Option<String>,      // PLATFORM_OIDC_ENDPOINT
    pub oidc_client_id: Option<String>,     // PLATFORM_OIDC_CLIENT_ID
    pub oidc_client_secret: Option<String>, // PLATFORM_OIDC_CLIENT_SECRET
}
```

Auth mode determination:
- If all three OIDC vars are set: OIDC mode (use `OidcM2mClient`)
- If only `m2m_token` is set: static token mode (current behavior)
- If neither: local-only mode (no platform auth, seam calls omit auth headers)

### FR-012: Auth Provider Abstraction

An enum SHALL abstract over the two auth modes:

```rust
pub enum AuthProvider {
    Oidc(Arc<OidcM2mClient>),
    Static(String),
}

impl AuthProvider {
    pub async fn get_bearer_token(&self, scope: &str) -> Result<String, AuthError>;
}
```

`AuditForwarder` and `spawn_policy_refresh()` SHALL accept `AuthProvider` instead of a raw `String` token.

### FR-013: Seam B Upgrade (Audit Forwarding)

`AuditForwarder` (`crates/axiomregent/src/router/audit_http.rs`) SHALL:
1. Accept `AuthProvider` in its constructor instead of `token: String`
2. In `forward()`, resolve the bearer token via `auth.get_bearer_token("platform:audit:write")` before POSTing
3. Token refresh failures are logged to stderr but do not block dispatch (fire-and-forget preserved)

The statecraft audit endpoint (`platform/services/statecraft/api/audit/audit.ts`) SHALL:
1. Extract the Bearer token from `req.authorization`
2. Attempt `validateJwt()` (from `rauthy.ts`) and check for `platform:audit:write` in the `scope` claim
3. If JWT validation fails and `PLATFORM_M2M_TOKEN` is configured, fall back to static string comparison
4. If both fail, return `APIError.unauthenticated()`

### FR-014: Seam A Upgrade (Policy Refresh)

`spawn_policy_refresh()` and `fetch_bundle()` in `crates/axiomregent/src/router/policy_http.rs` SHALL use `AuthProvider` with scope `platform:policy:read`.

The statecraft policy endpoint (`platform/services/statecraft/api/policy/policy.ts`) SHALL validate the request using the same JWT + fallback pattern as Seam B, requiring scope `platform:policy:read`.

### FR-015: Seam C Upgrade (Grants)

The statecraft grants endpoint (`platform/services/statecraft/api/grants/grants.ts`) SHALL validate the request using the same JWT + fallback pattern, requiring scope `platform:grants:read`.

### FR-016: Shared Validation Middleware

A shared helper SHALL be created at `platform/services/statecraft/api/auth/m2mAuth.ts`:

```typescript
export async function validateM2mRequest(
    authorization: string | undefined,
    requiredScope: string
): Promise<void>;
```

Logic:
1. Extract bearer token from `authorization` header
2. Try `validateJwt(token)` from `rauthy.ts`
3. If valid JWT: check that `scope` claim (space-separated) includes `requiredScope`
4. If JWT fails and `process.env.PLATFORM_M2M_TOKEN` is set: compare token to static value
5. If both fail: throw `APIError.unauthenticated("invalid or missing bearer token")`

All three seam endpoints SHALL delegate auth to this helper.

### FR-017: Router Wiring

In `crates/axiomregent/src/router/mod.rs` (lines 104-114), the `AuditForwarder` and policy refresh initialization SHALL:
1. Check if OIDC config is complete in `PlatformConfig`
2. If yes: construct `AuthProvider::Oidc(Arc::new(OidcM2mClient::new(...)))`
3. If no: construct `AuthProvider::Static(token.clone())`
4. Pass the `AuthProvider` to `AuditForwarder::new()` and `spawn_policy_refresh()`

### NF-010: Token Caching

OIDC tokens SHALL be cached in memory with a 30-second safety margin (same as `oidcM2m.ts`). The `OidcM2mClient` SHALL NOT fetch a new token for every request — only when the cached token is within 30 seconds of expiry.

### NF-011: Backward Compatibility

Deployments with only `PLATFORM_M2M_TOKEN` configured (no OIDC vars) SHALL continue to work without any changes. The OIDC upgrade is additive.

### Success Criteria

- **SC-010**: axiomregent can POST audit records using an OIDC JWT acquired via client_credentials flow
- **SC-011**: statecraft audit endpoint accepts OIDC JWTs with `platform:audit:write` scope
- **SC-012**: statecraft audit endpoint still accepts static bearer tokens when `PLATFORM_M2M_TOKEN` is set
- **SC-013**: statecraft policy and grants endpoints reject unauthenticated requests

---

## Phase 3: Cross-Run Artifact Persistence

**Prerequisite**: Phase 1 (artifact hashing must be in place)

### Scope

- Content-addressable local artifact store
- `factory_artifacts` table in statecraft PostgreSQL
- `previous_pipeline_id` linkage between factory pipeline runs
- Cache-hit detection at stage boundaries (presented as checkpoint gate, not automatic skip)

### FR-020: Content-Addressable Artifact Store

A new module `crates/factory-engine/src/artifact_store.rs` SHALL implement:

```rust
pub trait ArtifactStore: Send + Sync {
    /// Store a file by its content hash. Returns the storage path.
    fn store(&self, content_hash: &str, source_path: &Path) -> io::Result<String>;

    /// Retrieve a stored artifact to the target path.
    fn retrieve(&self, content_hash: &str, target_path: &Path) -> io::Result<()>;

    /// Check whether an artifact with this hash exists in the store.
    fn exists(&self, content_hash: &str) -> bool;
}
```

Default implementation `LocalArtifactStore`:
- Base directory: `$OAP_ARTIFACT_STORE` env var, defaulting to `~/.oap/artifact-store`
- Storage layout: `<base>/<hash[0..2]>/<hash>/<original_filename>`
- Deduplicates identical artifacts across runs by content hash
- Copy-on-store (source file remains untouched)

### FR-021: Database Schema Extension

A new migration SHALL add:

```sql
ALTER TABLE factory_pipelines
  ADD COLUMN previous_pipeline_id UUID REFERENCES factory_pipelines(id);

CREATE TABLE factory_artifacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id   UUID NOT NULL REFERENCES factory_pipelines(id) ON DELETE CASCADE,
  stage_id      VARCHAR(50) NOT NULL,
  artifact_type VARCHAR(100) NOT NULL,
  content_hash  VARCHAR(64) NOT NULL,
  storage_path  TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_factory_artifacts_pipeline ON factory_artifacts(pipeline_id, stage_id);
CREATE INDEX idx_factory_artifacts_hash ON factory_artifacts(content_hash);
```

The `previousPipelineId` column and `factoryArtifacts` table SHALL also be added to the Drizzle schema in `platform/services/statecraft/api/db/schema.ts`.

### FR-022: Previous Pipeline Linkage

When `FactoryEngine::start_pipeline()` initializes a new pipeline, it SHALL:
1. Query the platform for the most recent pipeline with status `completed` for the same `project_id` and `adapter_name`
2. If found, set `previous_pipeline_id` on the new pipeline record
3. Add `previous_pipeline_id: Option<String>` to `FactoryPipelineState` in `crates/factory-engine/src/pipeline_state.rs`

### FR-023: Artifact Recording After Stage Completion

After each stage completes (in `update_stage()` within `crates/factory-engine/src/harness_state.rs`):
1. For each `StageArtifact` with a populated `hash` (from Phase 1 FR-005):
   - Store the artifact in the `LocalArtifactStore`
   - POST artifact metadata to `POST /api/projects/:id/factory/artifacts` (new platform endpoint)

### FR-024: Cache-Hit Detection

Before running a stage, the factory engine SHALL:
1. Check if `previous_pipeline_id` is set
2. If set, query `GET /api/projects/:id/factory/artifacts/lookup?content_hash=<input_hash>&stage_id=<stage>`
3. If a matching artifact exists from the previous pipeline, present a checkpoint gate: "Previous run produced identical output for stage {stage_id}. Skip? [y/n]"
4. If the user approves, copy the artifact from the store and mark the stage as completed without dispatching an agent
5. If the user rejects, proceed with normal dispatch

This respects orchestrator rule #3 (stop at checkpoints — wait for explicit user approval).

### FR-025: Platform Artifact API

Two new endpoints in `platform/services/statecraft/api/factory/`:
- `POST /api/projects/:id/factory/artifacts` — record artifact metadata (pipeline_id, stage_id, artifact_type, content_hash, storage_path, size_bytes)
- `GET /api/projects/:id/factory/artifacts/lookup` — query by `content_hash` and `stage_id`, returns matching artifact metadata from previous pipelines

Both endpoints SHALL require M2M auth (using the Phase 2 JWT validation middleware).

### NF-020: Storage Cleanup

`LocalArtifactStore` SHALL provide a cleanup method that removes artifacts whose associated pipeline is older than a configurable retention period (default: 30 days). This is invoked manually or via a scheduled task — not automatically.

### Success Criteria

- **SC-020**: After pipeline completion, all stage artifacts are stored in the content-addressable store with correct hashes
- **SC-021**: Starting a new pipeline for the same project sets `previous_pipeline_id`
- **SC-022**: Cache-hit detection correctly identifies matching artifacts from previous runs
- **SC-023**: User can skip a stage via checkpoint gate when cache hit is detected

---

## Phase 4: Namespaced Contract IDs

### Scope

- Convention spec document
- Validation utility in `factory-contracts`
- Advisory integration (no renames of existing identifiers)

### FR-030: Namespace Convention

All **new** contract identifiers created after this spec is adopted SHALL follow the pattern:

```
dev.oap.{domain}.{type}.{name}
```

Where:
- `dev.oap` is the organization prefix (reverse-domain)
- `{domain}` is one of: `tool`, `factory`, `policy`, `event`, `adapter`
- `{type}` is a domain-specific category
- `{name}` is the specific identifier

Examples:
| Domain | Type | Full ID | Current equivalent |
|--------|------|---------|-------------------|
| tool | core | `dev.oap.tool.core.file_read` | `file_read` |
| factory | stage | `dev.oap.factory.stage.s1-business-requirements` | `s1-business-requirements` |
| policy | gate | `dev.oap.policy.gate.secrets_scanner` | `policy:deny:secrets_scanner:pattern_match` |
| event | workflow | `dev.oap.event.workflow.step_completed` | `step_completed` |
| adapter | stack | `dev.oap.adapter.stack.next-prisma` | `next-prisma` |

**Grandfathering rule**: existing identifiers across all systems keep their current names. No rename churn. The convention applies only to newly created contracts. Third-party adapters contributing new schemas use their own reverse-domain prefix (e.g., `com.example.adapter.stack.custom-stack`).

### FR-031: Validation Utility

A new module `crates/factory-contracts/src/namespace.rs` SHALL provide:

```rust
/// Check whether a string conforms to the OAP namespace convention.
pub fn is_valid_namespace(id: &str) -> bool;

/// Parse a namespaced ID into its components.
pub fn parse_namespace(id: &str) -> Option<NamespaceParts>;

pub struct NamespaceParts {
    pub org: String,        // e.g., "dev.oap"
    pub domain: String,     // e.g., "tool"
    pub type_name: String,  // e.g., "core"
    pub name: String,       // e.g., "file_read"
}

// Well-known prefixes
pub const NS_TOOL: &str = "dev.oap.tool";
pub const NS_FACTORY: &str = "dev.oap.factory";
pub const NS_POLICY: &str = "dev.oap.policy";
pub const NS_EVENT: &str = "dev.oap.event";
pub const NS_ADAPTER: &str = "dev.oap.adapter";
```

Validation regex: `^[a-z][a-z0-9]*(\.[a-z][a-z0-9_-]*){3,}$`

### NF-030: No Breaking Changes

The namespace utility is advisory. Existing `ToolDef::name()` implementations, adapter directory names, spec IDs, event types, and policy reasons are NOT modified. The utility is available for new code to use but is not enforced at registration time.

### Success Criteria

- **SC-030**: `is_valid_namespace("dev.oap.tool.core.file_read")` returns `true`
- **SC-031**: `is_valid_namespace("file_read")` returns `false` (legacy format, not namespaced)
- **SC-032**: `parse_namespace()` correctly extracts domain, type, and name components

---

## Architecture

### Phase Dependency Graph

```
Phase 1 (Artifact Integrity)    Phase 2 (OIDC Upgrade)
         |                              |
         v                      (independent)
Phase 3 (Cross-Run Persistence)
                        Phase 4 (Namespaces) — independent
```

Phases 1 and 2 can be implemented in parallel. Phase 3 requires Phase 1. Phase 4 is standalone.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| SHA-256 hashing vs Ed25519 signing | SHA-256 only | Threat model is accidental corruption, not adversarial tampering. Agents run in the trusted orchestrator. If adversarial agents become a concern (e.g., remote untrusted MCP tools), an optional `signature: Option<String>` field can be added to `StageArtifact` alongside `hash`. |
| Artifact storage model | Content-addressable filesystem + DB metadata | Factory artifacts are source code files (KB-MB). PostgreSQL blob storage would bloat backups. The hash provides a natural content-address key. The `factory_artifacts` DB table stores only metadata. |
| OIDC upgrade scope | All three seams | The shared `m2mAuth.ts` middleware and shared `AuthProvider` enum make the incremental cost negligible per seam. |
| Namespace adoption strategy | New identifiers only | Renaming existing identifiers across 7+ systems would be massive churn with no functional benefit. |
| Cross-run cache skip | Checkpoint gate (user confirms) | Automatic skipping violates orchestrator rule #3. The user decides whether to reuse cached output. |

### Key Files

| File | Phase | Change |
|------|-------|--------|
| `crates/orchestrator/src/artifact.rs` | 1 | Add `hash_artifact()`, `verify_artifact()` |
| `crates/orchestrator/src/lib.rs` | 1 | Add `output_hashes` to `DispatchResult`, `StepSummaryEntry`; verify inputs |
| `crates/orchestrator/src/claude_executor.rs` | 1 | Hash outputs after dispatch |
| `crates/orchestrator/Cargo.toml` | 1 | Add `sha2 = "0.10"` |
| `crates/factory-engine/src/harness_state.rs` | 1, 3 | Populate `StageArtifact.hash`; record to artifact store |
| `crates/axiomregent/src/router/oidc_client.rs` | 2 | New: OIDC client_credentials |
| `crates/axiomregent/src/platform_config.rs` | 2 | Add OIDC env vars |
| `crates/axiomregent/src/router/audit_http.rs` | 2 | Use `AuthProvider` |
| `crates/axiomregent/src/router/policy_http.rs` | 2 | Use `AuthProvider` |
| `crates/axiomregent/src/router/mod.rs` | 2 | Wire `AuthProvider` |
| `platform/services/statecraft/api/auth/m2mAuth.ts` | 2 | New: shared JWT+fallback middleware |
| `platform/services/statecraft/api/audit/audit.ts` | 2 | Use `validateM2mRequest()` |
| `platform/services/statecraft/api/policy/policy.ts` | 2 | Use `validateM2mRequest()` |
| `platform/services/statecraft/api/grants/grants.ts` | 2 | Use `validateM2mRequest()` |
| `crates/factory-engine/src/artifact_store.rs` | 3 | New: `ArtifactStore` trait + `LocalArtifactStore` |
| `crates/factory-engine/src/pipeline_state.rs` | 3 | Add `previous_pipeline_id` |
| `crates/factory-engine/src/engine.rs` | 3 | Query previous pipeline on init |
| `platform/services/statecraft/api/db/schema.ts` | 3 | Add `previousPipelineId`, `factoryArtifacts` table |
| `platform/services/statecraft/api/factory/factory.ts` | 3 | Artifact record/lookup endpoints |
| `crates/factory-contracts/src/namespace.rs` | 4 | New: validation utility |
| `crates/factory-contracts/src/lib.rs` | 4 | Add `pub mod namespace` |

## Dependencies

| Spec | Relationship |
|------|-------------|
| 044-multi-agent-orchestration | Base orchestrator types (`ArtifactManager`, `DispatchResult`, `WorkflowManifest`) |
| 052-state-persistence | `WorkflowStore`, `summary.json` format |
| 074-factory-ingestion | `StageArtifact`, `PipelineState`, `BuildSpecInfo` |
| 075-factory-workflow-engine | Dispatch loop, verification hooks, harness state |
| 077-statecraft-factory-api | `factory_pipelines`, `factory_stages` DB tables |
| 080-github-identity-onboarding | Rauthy OIDC infrastructure, `validateJwt()` |

## Risks

| Risk | Mitigation |
|------|-----------|
| Hash computation slows dispatch loop | SHA-256 of <1MB files takes <10ms. Benchmark and confirm. |
| OIDC token endpoint unavailable | `OidcM2mClient` falls through to static token. Log warning. |
| Content-addressable store grows unbounded | Configurable retention + manual cleanup command. |
| Cross-run cache hit on modified business requirements | Cache-hit is a checkpoint gate — user validates before skipping. |
| `StageArtifact.hash` format change breaks existing state files | Field was always empty string; `#[serde(default)]` handles absent field. |
