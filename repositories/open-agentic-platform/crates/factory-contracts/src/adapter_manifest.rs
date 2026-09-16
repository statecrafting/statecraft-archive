// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Rust types for the Factory Adapter Manifest schema.
//!
//! An Adapter Manifest declares a technology adapter's identity, capabilities,
//! supported auth methods, commands, directory conventions, patterns, agents,
//! scaffolding, and validation.

use std::collections::HashMap;

use agent_frontmatter::SafetyTier;
use serde::{Deserialize, Serialize};

/// Current Adapter Manifest contract version. Bumped 1.0.0 → 1.1.0 by
/// spec 198 FR-012: the manifest gains a `governance:` section (the adapter
/// sub-envelope of the governance envelope). Named here per the
/// `PROVENANCE_SCHEMA_VERSION` pattern so the version has one canonical home
/// rather than living only in fixtures.
pub const ADAPTER_MANIFEST_SCHEMA_VERSION: &str = "1.1.0";

/// Schema versions this crate accepts at parse time. A 1.0.0 manifest (no
/// `governance:` section) still parses and serves — it is *servable but not
/// admissible* under the spec 198 admission gate, which requires the
/// sub-envelope. Anything outside this set fails validation closed.
pub const ADAPTER_MANIFEST_ACCEPTED_SCHEMA_VERSIONS: [&str; 2] = ["1.0.0", "1.1.0"];

// ── Top-level Adapter Manifest ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdapterManifest {
    pub schema_version: String,
    pub adapter: AdapterIdentity,
    pub stack: StackSpec,
    pub capabilities: Capabilities,
    pub supported_auth: Vec<SupportedAuth>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supported_session_stores: Option<Vec<SessionStoreEntry>>,
    pub commands: Commands,
    pub directory_conventions: DirectoryConventions,
    pub patterns: Patterns,
    pub agents: Agents,
    pub scaffold: Scaffold,
    pub validation: Validation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dual_stack: Option<DualStack>,
    /// Adapter sub-envelope of the governance envelope (spec 198 FR-012).
    /// Required at schema 1.1.0; absent on 1.0.0 manifests (which are then
    /// servable but not admissible).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub governance: Option<AdapterGovernance>,
}

// ── Governance sub-envelope (spec 198 FR-012) ─────────────────────────

/// The adapter sub-envelope: the scaffold-boundary half of the governance
/// envelope, filed inside the manifest so the declaration and its reconcile
/// evidence (`commands:`, `directory_conventions:`, `scaffold.emits:`) share
/// one content-addressed unit and one revocation key (spec 198 FR-010/FR-012).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdapterGovernance {
    /// Tier ceiling for the adapter's agents (ASI02 m1 / ASI03).
    pub max_tier: SafetyTier,
    /// Where adapter agents may create/modify/delete (ASI02 m1 / ASI05 m4).
    pub file_write_scope: Vec<String>,
    /// Real secret material and infra paths agents may never write.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub file_write_denied: Vec<String>,
    /// Key reference naming the manifest map that IS the command allowlist
    /// (one home per fact, P-4). The only defined value is `commands`.
    pub allowed_commands_from: String,
    /// Declared executable surface at scaffold time (ASI05).
    pub scaffold_execution: ScaffoldExecution,
    /// Key reference naming the manifest map whose entries are the
    /// behavioral-manifest constituents. The only defined value is `agents`.
    pub agents_from: String,
}

/// What may execute at scaffold time, and under what isolation (ASI05).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScaffoldExecution {
    /// Key references into the manifest's `scaffold:` block naming the entry
    /// points (e.g. `scaffold.entry_point`, `scaffold.entry_point_dual`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entry_points_from: Vec<String>,
    /// Key reference naming the setup-command list
    /// (e.g. `scaffold.setup_commands`).
    pub setup_commands_from: String,
    /// Isolation obligation. The only defined value is `sandbox-required`
    /// (specs 162/185/186 at run time); unknown values fail validation
    /// closed.
    pub isolation: String,
}

// ── Adapter Identity ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdapterIdentity {
    pub name: String,
    pub display_name: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

// ── Stack ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackSpec {
    /// e.g., "typescript", "rust", "go", "java", "csharp"
    pub language: String,
    /// e.g., "node-22", "deno-2", "bun-1", "jvm-21", "dotnet-9"
    pub runtime: String,
    pub backend: BackendSpec,
    pub frontend: FrontendSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<DatabaseSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendSpec {
    /// e.g., "express-5", "axum", "spring-boot-3", "fastapi"
    pub framework: String,
    /// How the backend is structured
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendSpec {
    /// e.g., "vue-3", "react-19", "svelte-5", "htmx", "server-rendered"
    pub framework: String,
    /// e.g., "pinia", "zustand", "signals", "none"
    pub state_management: String,
    /// e.g., "acme-web-components", "shadcn", "none"
    pub design_system: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseSpec {
    /// e.g., ["postgresql", "mysql", "sqlite"]
    pub supported: Vec<String>,
    /// e.g., "custom-ddl", "prisma", "diesel", "flyway", "alembic"
    pub migration_tool: String,
    /// e.g., "none", "prisma", "diesel", "sqlalchemy", "typeorm"
    pub orm: String,
}

// ── Capabilities ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Capabilities {
    // Deployment topology
    #[serde(default)]
    pub dual_stack: bool,
    #[serde(default)]
    pub bff_pattern: bool,
    #[serde(default)]
    pub single_stack: bool,

    // Auth patterns
    #[serde(default)]
    pub session_auth: bool,
    #[serde(default)]
    pub token_auth: bool,
    #[serde(default)]
    pub api_key_auth: bool,

    // Features
    #[serde(default)]
    pub module_system: bool,
    #[serde(default)]
    pub file_uploads: bool,
    #[serde(default)]
    pub background_jobs: bool,
    #[serde(default)]
    pub realtime: bool,
    #[serde(default)]
    pub email_notifications: bool,
    #[serde(default)]
    pub audit_logging: bool,

    // Data access
    #[serde(default)]
    pub direct_sql: bool,
    #[serde(default)]
    pub orm_based: bool,
    #[serde(default)]
    pub api_proxy: bool,

    /// Adapter-specific capabilities not in the standard set.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_yaml::Value>,
}

// ── Supported Auth ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SupportedAuth {
    /// Matches auth.audiences.<name>.method in Build Spec
    pub method: String,
    /// Adapter's internal driver name
    pub driver: String,
    /// Supported identity providers (empty = any)
    #[serde(default)]
    pub providers: Vec<String>,
    pub description: String,
}

// ── Supported Session Stores ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStoreEntry {
    /// e.g., "redis", "postgresql", "memory", "dynamodb"
    #[serde(rename = "type")]
    pub store_type: String,
    pub description: String,
}

// ── Commands ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Commands {
    pub install: String,
    pub compile: String,
    pub test: String,
    pub lint: String,
    pub dev: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format_check: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_check: Option<String>,
    /// Seed / fixture runner (spec 197). Declared in the manifest schema but
    /// previously absorbed by `extra`, so the engine could not see it; now a
    /// typed field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<String>,
    /// Per-feature verification (fast checks only, not full build)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub feature_verify: Vec<String>,

    /// Adapter-specific commands not in the standard set.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_yaml::Value>,
}

// ── Directory Conventions ─────────────────────────────────────────────
//
// Template strings for file paths. Placeholders:
//   {stack}     — "api", "api-public", "api-internal", "web", "web-public", "web-internal"
//   {resource}  — Kebab-case resource name (e.g., "funding-requests")
//   {Resource}  — PascalCase (e.g., "FundingRequests")
//   {entity}    — Kebab-case entity (e.g., "funding-request")
//   {Entity}    — PascalCase entity (e.g., "FundingRequest")
//   {PageName}  — PascalCase page name (e.g., "Dashboard")
//   {org}       — Organization slug from Build Spec
//   {timestamp} — Migration timestamp (e.g., "20260327100000")
//   {name}      — Migration name (e.g., "create_organizations")

/// Directory convention templates. All fields are optional because different
/// adapters use different project structures (e.g., Encore uses services not
/// controllers). Extra adapter-specific keys are captured in `extra`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DirectoryConventions {
    // Backend
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_service: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_controller: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_route: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_test: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_types: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_middleware: Option<String>,

    // Frontend
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_view: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_store: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_route_config: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_test: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui_component: Option<String>,

    // Data layer
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub migration: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_types: Option<String>,

    // Shared
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_file: Option<String>,
    /// For dual-stack: per-stack env file paths keyed by "public" / "internal"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_file_per_stack: Option<HashMap<String, String>>,

    /// Adapter-specific conventions not covered by the standard fields.
    #[serde(flatten)]
    pub extra: HashMap<String, serde_yaml::Value>,
}

// ── Patterns ──────────────────────────────────────────────────────────
//
// Pointers to code-generation pattern files. Each pattern is a focused
// document (<200 lines) containing convention, template code, naming rules,
// and a concrete example. Scaffolding agents load ONE pattern at a time.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Patterns {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api: Option<ApiPatterns>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ui: Option<UiPatterns>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<DataPatterns>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_types: Option<PageTypePatterns>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ApiPatterns {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub controller: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub middleware: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub types: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UiPatterns {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DataPatterns {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub migration: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fixture_factory: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub validation_schema: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PageTypePatterns {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub landing: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dashboard: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub list: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub form: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub login: Option<String>,
}

// ── Agents ────────────────────────────────────────────────────────────
//
// Pointers to agent prompt files. Each agent is a focused Markdown file
// (<2K tokens) that a scaffolding agent reads before generating code.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agents {
    // Required agents
    /// Generates service + controller + route + test for one endpoint
    pub api_scaffolder: String,
    /// Generates view + state + route + test for one page
    pub ui_scaffolder: String,
    /// Generates DDL/migration + types for entities
    pub data_scaffolder: String,
    /// Applies project identity, fills env vars, wires auth
    pub configurer: String,
    /// Removes unused scaffold artifacts
    pub trimmer: String,

    // Optional agents
    /// Generates seed data and fixture factories after data scaffolding
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed_generator: Option<String>,
    /// Reviews generated code for quality/consistency
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reviewer: Option<String>,
    /// Checks for security issues
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub security_auditor: Option<String>,
}

// ── Scaffold ──────────────────────────────────────────────────────────

/// How an adapter's base scaffold is sourced.
///
/// `Local` is the legacy shape — a relative path under the adapter root
/// pointing at a vendored copy of the scaffold. `Upstream` is the spec 112
/// §8 "pointer-not-repo" shape: the scaffold lives in an upstream git
/// repo and statecraft is the sole consumer that resolves and seeds it
/// into the project repo at create-time. OPC's factory-engine never
/// fetches an upstream scaffold; it operates on the seeded project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ScaffoldSource {
    /// Vendored local scaffold; relative path under the adapter root.
    Local(String),
    /// Upstream git pointer — resolved by statecraft only.
    Upstream {
        kind: String,
        remote: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        default_ref: Option<String>,
    },
}

impl Default for ScaffoldSource {
    fn default() -> Self {
        ScaffoldSource::Local(String::new())
    }
}

impl ScaffoldSource {
    /// Returns the local relative path when present, or `None` for an
    /// upstream pointer. Callers in OPC's execution layer should treat
    /// `None` as "statecraft has already provisioned the project; nothing
    /// to copy locally."
    pub fn as_local_path(&self) -> Option<&str> {
        match self {
            ScaffoldSource::Local(p) => Some(p.as_str()),
            ScaffoldSource::Upstream { .. } => None,
        }
    }

    /// True when the variant carries no usable source identifier.
    pub fn is_empty(&self) -> bool {
        match self {
            ScaffoldSource::Local(p) => p.is_empty(),
            ScaffoldSource::Upstream { remote, .. } => remote.is_empty(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Scaffold {
    /// How the base project template is sourced. See `ScaffoldSource`.
    #[serde(default)]
    pub source: ScaffoldSource,
    /// What the scaffold provides out of the box
    #[serde(default)]
    pub description: String,
    /// Which modules to install per deployment variant (variant → list of module names)
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub modules: HashMap<String, Vec<String>>,
    /// Commands run after copying the scaffold, before feature scaffolding
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub setup_commands: Vec<String>,

    // ── Spec 112 §8 additions ──────────────────────────────────────
    /// Relative path to the scaffold entry script (e.g. "scripts/setup.ts"). Required by the
    /// statecraft Create path (spec 112 §5.3) — adapters without this field are not
    /// Create-eligible via the web UI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry_point: Option<String>,
    /// Execution runtime (e.g. "node-24", "deno-2"). Statecraft Create MVP runs only
    /// `node-24` adapters; other runtimes are Import-only until a future spec.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime: Option<String>,
    /// Optional JSON Schema (serde_json::Value) describing the --args accepted by the
    /// entry point. Statecraft validates user-supplied scaffold arguments against this
    /// before invoking the entry point.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args_schema: Option<serde_json::Value>,
    /// Declared variant/profile combinations. Statecraft Create surfaces these as
    /// dropdown options in `/app/projects/new`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub profiles: Vec<ScaffoldProfile>,
    /// Paths the scaffold produces, relative to project root. Informational; used by
    /// the absorbed template-distributor cache layer (spec 112 §5.3) for pre-warming.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub emits: Vec<ScaffoldEmit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScaffoldProfile {
    pub name: String,
    /// Matches Build Spec `project.variant` (e.g. "single-public", "single-internal", "dual").
    pub variant: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub modules: Vec<String>,
    #[serde(default)]
    pub default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScaffoldEmit {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

// ── Validation ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Validation {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub invariants: Vec<Invariant>,
    /// Optional path to an external invariants file (resolved relative to adapter root).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub invariants_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Invariant {
    /// e.g., "INV-001"
    pub id: String,
    /// Human-readable description
    pub description: String,
    pub check: InvariantCheck,
    pub severity: Severity,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvariantCheck {
    /// How to evaluate this invariant
    #[serde(rename = "type")]
    pub check_type: CheckType,
    /// Regex for grep, glob for file, or shell command
    pub pattern: String,
    /// Where to check (e.g., "apps/", "packages/", ".")
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CheckType {
    /// Pattern must NOT appear in codebase
    GrepAbsent,
    /// Pattern must appear in codebase
    GrepPresent,
    /// File must exist
    FileExists,
    /// File must not exist
    FileAbsent,
    /// Shell command must exit 0
    CommandSucceeds,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Severity {
    Error,
    Warning,
}

// ── Dual Stack (variant model) ─────────────────────────────────────────
//
// A "variant" is a standalone top-level copy of the base scaffold (not an
// in-tree stack). This mirrors the canonical factory adapter-manifest
// schema (`contract/schemas/adapter-manifest.schema.yaml`); the legacy
// `audience_to_stack`/`stacks` naming was the pre-factory shape.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DualStack {
    /// Generator that emits the dual deployment (optional),
    /// e.g. "scripts/setup-dual-app.ts".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generator: Option<String>,
    /// Maps audience name → variant name (e.g., "citizen" → "public").
    pub audience_to_variant: HashMap<String, String>,
    /// Named variants, each a standalone top-level copy with its own
    /// apps, ports, and auth driver.
    pub variants: DualStackVariants,
    /// Data flow constraints per variant name (e.g., "public" → "proxy").
    pub data_access: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DualStackVariants {
    pub public: VariantEndpoint,
    pub internal: VariantEndpoint,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariantEndpoint {
    /// Top-level copy directory for this variant (e.g., "public").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dir: Option<String>,
    /// Backend app path used in the {variant} placeholder (e.g., "apps/api").
    pub api: String,
    /// Web app (SPA) served by this variant (e.g., "apps/web").
    pub web: String,
    /// Port number for the API application.
    pub port_api: u16,
    /// Port number for the web application.
    pub port_web: u16,
    /// App-level auth driver for this variant: "mock" (dev) or "rauthy"
    /// (prod) only (spec 229). Upstream IdPs (github/google/auth0/entra/
    /// SAML-via-Google-Workspace) are Rauthy upstream-provider config, not
    /// values of this field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_driver: Option<String>,
    /// Per-variant env example file (e.g., ".env.external.example").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_example: Option<String>,
}
