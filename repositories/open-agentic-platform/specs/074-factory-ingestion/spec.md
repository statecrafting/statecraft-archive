---
id: "074-factory-ingestion"
title: "Factory Ingestion as First-Class Delivery Engine"
feature_branch: "feat/074-factory-ingestion"
status: approved
implementation: complete
kind: platform
domain: platform
created: "2026-04-04"
authors: ["open-agentic-platform"]
language: en
summary: >
  Ingest the Factory software factory framework into OAP as a first-class citizen,
  providing the delivery methodology layer that transforms OAP from a governed
  orchestration engine into a complete AI software factory. Defines directory
  structure, Rust contract types, adapter registry, and integration seams.
code_aliases: ["FACTORY_INGESTION", "FACTORY_CONTRACTS"]
amended: "2026-05-23"
amendment_record: "162-sandbox-execution-contract"
establishes:
  - unit: { kind: crate, id: factory-contracts }
references:
  - role: historical
    unit: { kind: directory, path: factory }
---

# Feature Specification: Factory Ingestion as First-Class Delivery Engine

> **Amended 2026-05-23 by spec 162** — `sandbox-execution-contract`.
> Spec 162 adds `crates/factory-contracts/src/sandbox.rs` (backend-agnostic
> sandbox-contract types: `SandboxRequest`, `SandboxExecution`,
> `IsolationTier`, `ResourceCeilings`, `EgressAllowlistEntry`) to the
> `factory-contracts` crate this spec establishes. The addition is
> additive — no existing factory-contracts type or module shape is
> changed. Spec 162 records the relationship via `amends: ["074"]`; this
> spec's `amendment_record` field points back at 162. The clarification
> is: factory-contracts hosts contract types for **both** the original
> Factory delivery pipeline AND the sandbox execution contract, since
> both feed the governance-certificate stage record shape
> ([spec 102](../102-governed-excellence/spec.md)) and benefit from
> sharing serde infrastructure.

## Purpose

OAP has a mature orchestration engine, governance layer, and desktop UI — but lacks a delivery methodology. It can run arbitrary DAG workflows but has no structured pipeline that turns business documents into working software.

Factory is a modular, tech-agnostic software factory framework that separates the *process* of building software (requirements, design, specification) from *implementation* details (frameworks, languages, patterns). Its 7-stage pipeline, formal contract schemas, and pluggable adapter system map 1:1 onto OAP's orchestrator, policy kernel, and agent dispatch.

This spec defines how Factory enters the OAP repository, how its contract schemas become Rust types, and how its adapters register with the platform.

## Scope

### In scope

- Git subtree ingestion of Factory into `factory/` at repository root
- New Rust crate `crates/factory-contracts/` with typed representations of all four Factory contract schemas (Build Spec, Adapter Manifest, Pipeline State, Verification Contract)
- Adapter discovery and registration mechanism
- Process agent prompt loading from `factory/process/agents/`
- Contract schema validation (YAML/JSON → typed Rust structs with serde)
- Integration with spec-compiler to register Factory artifacts in the spec registry

### Out of scope

- Orchestrator workflow changes (spec 075)
- Desktop UI panels (spec 076)
- Statecraft API endpoints (spec 077)
- Verification harness execution (spec 075)

## Requirements

### Functional Requirements

**FR-001: Repository Ingestion**
Factory lives in `factory/` at repository root as first-class OAP code. The directory structure:

```
factory/
  contract/
    schemas/           ← YAML schemas (Build Spec, Adapter Manifest, etc.)
    examples/          ← Example Build Specs (community-grant-portal, etc.)
  process/
    stages/            ← Stage definitions (00-06)
    agents/            ← Process agent prompts (7 agents)
  adapters/
    acme-vue-node/      ← Express 5 + Vue 3 adapter
    next-prisma/       ← Next.js 15 + Prisma adapter
    encore-react/      ← Encore.ts + React adapter
    rust-axum/         ← Axum + HTMX adapter
  docs/                ← Architecture, how-to, integration docs
```

**FR-002: Contract Types Crate**
A new crate `crates/factory-contracts/` SHALL provide Rust types for all four Factory contract schemas:

- `BuildSpec` — tech-agnostic application specification (project, auth, data_model, business_rules, api, ui, integrations, notifications, audit, security, traceability)
- `AdapterManifest` — adapter capability declaration (stack, capabilities, commands, directory_conventions, patterns, agents, scaffold, validation)
- `PipelineState` — durable execution state (pipeline identity, stage progress, scaffolding progress, verification results, error log, audit trail)
- `VerificationContract` — gate check definitions (pre-flight, stage gates, scaffolding gates, final validation)

All types SHALL derive `Serialize`, `Deserialize`, `Debug`, `Clone`. Enums SHALL use `#[serde(rename_all = "kebab-case")]` to match YAML conventions.

**FR-003: Schema Validation**
The crate SHALL expose validation functions:

```rust
pub fn validate_build_spec(path: &Path) -> Result<BuildSpec, Vec<ValidationError>>;
pub fn validate_adapter_manifest(path: &Path) -> Result<AdapterManifest, Vec<ValidationError>>;
pub fn validate_pipeline_state(path: &Path) -> Result<PipelineState, Vec<ValidationError>>;
```

Validation SHALL check:
- YAML/JSON parsing (serde errors)
- Required field presence
- Enum value validity (variant, auth method, page_type, etc.)
- Cross-reference integrity (e.g., operations reference existing entities)

**FR-004: Adapter Registry**
An `AdapterRegistry` SHALL discover and load all adapter manifests from `factory/adapters/*/manifest.yaml`:

```rust
pub struct AdapterRegistry {
    adapters: HashMap<String, AdapterManifest>,
}

impl AdapterRegistry {
    pub fn discover(factory_root: &Path) -> Result<Self, DiscoveryError>;
    pub fn get(&self, name: &str) -> Option<&AdapterManifest>;
    pub fn list(&self) -> Vec<&str>;
    pub fn capabilities_match(&self, name: &str, spec: &BuildSpec) -> CapabilityReport;
}
```

`capabilities_match` SHALL verify that the adapter's declared capabilities satisfy the Build Spec's requirements (e.g., if spec uses `variant: dual`, adapter must have `dual_stack: true`).

**FR-005: Agent Prompt Loader**
A `ProcessAgentLoader` SHALL read agent prompt files from `factory/process/agents/` and adapter-specific agents from `factory/adapters/{name}/agents/`:

```rust
pub struct AgentPrompt {
    pub id: String,
    pub role: String,
    pub tier: u8,              // 1 = read-only (process), 2 = read-write (scaffold)
    pub prompt_text: String,
    pub model_hint: Option<String>,  // "opus" for process, "sonnet" for scaffold
}

pub fn load_process_agents(factory_root: &Path) -> Result<Vec<AgentPrompt>, LoadError>;
pub fn load_adapter_agents(adapter_path: &Path) -> Result<Vec<AgentPrompt>, LoadError>;
```

Process agents (stages 1-5) are Tier 1 (read-only). Scaffold agents (stage 6) are Tier 2 (read-write).

**FR-006: Pattern File Access**
Adapter pattern files SHALL be accessible via the artifact system. The `PatternResolver` resolves pattern references from adapter manifests to absolute file paths:

```rust
pub struct PatternResolver {
    adapter_root: PathBuf,
    manifest: AdapterManifest,
}

impl PatternResolver {
    pub fn resolve_api_pattern(&self, kind: &str) -> Option<PathBuf>;  // "service", "controller", etc.
    pub fn resolve_ui_pattern(&self, kind: &str) -> Option<PathBuf>;
    pub fn resolve_data_pattern(&self, kind: &str) -> Option<PathBuf>;
    pub fn resolve_page_type_pattern(&self, page_type: &str) -> Option<PathBuf>;
}
```

**FR-007: Spec Registry Integration**
The spec-compiler SHALL be extended to recognize Factory Build Specs as compilable artifacts. When a project has a frozen Build Spec at `.factory/build-spec.yaml`, the compiler SHALL:
- Index it in `.derived/spec-registry/registry.json` under a new `factory_projects` section
- Track the Build Spec hash for drift detection
- Link to the adapter used

### Non-Functional Requirements

**NF-001: Schema Fidelity**
Rust types SHALL be a faithful 1:1 representation of the YAML schemas. No fields dropped, no types simplified. Round-trip `YAML → Rust → YAML` SHALL produce semantically identical output.

**NF-002: Backward Compatibility**
Factory subtree updates SHALL NOT require changes to OAP code outside `crates/factory-contracts/`. The contract crate is the only coupling point.

**NF-003: Adapter Extensibility**
Adding a new adapter SHALL require only creating a new directory under `factory/adapters/{name}/` with a valid `manifest.yaml`. No code changes to OAP.

## Architecture

### Dependency Graph

```
crates/factory-contracts/
  ├── depends on: serde, serde_yaml, serde_json, thiserror
  ├── consumed by: crates/orchestrator (spec 075)
  ├── consumed by: product/apps/opc (spec 076)
  ├── consumed by: crates/axiomregent (policy shards)
  └── consumed by: tools/spec-spine/spec-compiler (registry integration)
```

### Key Types (Build Spec — Partial)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildSpec {
    pub project: ProjectSpec,
    pub auth: AuthSpec,
    pub data_model: DataModelSpec,
    pub business_rules: Vec<BusinessRule>,
    pub api: ApiSpec,
    pub ui: UiSpec,
    pub integrations: Option<Vec<Integration>>,
    pub notifications: Option<NotificationSpec>,
    pub audit: Option<AuditSpec>,
    pub security: Option<SecuritySpec>,
    pub traceability: Option<TraceabilitySpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSpec {
    pub name: String,
    pub display_name: String,
    pub org: String,
    pub description: String,
    pub variant: Variant,  // single-public | single-internal | dual
    pub domain: Option<String>,
    pub fiscal_context: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Variant {
    SinglePublic,
    SingleInternal,
    Dual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    pub name: String,
    pub fields: Vec<Field>,
    pub unique_constraints: Option<Vec<UniqueConstraint>>,
    pub check_constraints: Option<Vec<CheckConstraint>>,
    pub indexes: Option<Vec<Index>>,
    pub business_rules: Option<Vec<String>>,  // BR-XXX references
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FieldType {
    String, Text, Integer, Decimal, Boolean, Uuid,
    Date, Datetime, Timestamp, Enum, Json, Reference,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Operation {
    pub id: String,
    pub method: HttpMethod,
    pub path: String,
    pub description: Option<String>,
    pub audience: Vec<String>,
    pub auth: AuthRequirement,  // required | optional | service-only | public
    pub required_roles: Option<Vec<String>>,
    pub stack: Option<StackTarget>,  // public | internal | both
    pub request: Option<RequestSpec>,
    pub response: ResponseSpec,
    pub business_rules: Option<Vec<String>>,
    pub use_cases: Option<Vec<String>>,
    pub test_cases: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PageType {
    Landing, Dashboard, List, Detail, Form,
    Content, Help, Profile, Login, Error,
}
```

### Key Types (Adapter Manifest — Partial)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdapterManifest {
    pub adapter: AdapterIdentity,
    pub stack: StackSpec,
    pub capabilities: Capabilities,
    pub supported_auth: Vec<SupportedAuth>,
    pub supported_session_stores: Option<Vec<SessionStore>>,
    pub commands: Commands,
    pub directory_conventions: DirectoryConventions,
    pub patterns: PatternPaths,
    pub agents: AgentPaths,
    pub scaffold: ScaffoldSpec,
    pub validation: ValidationSpec,
    pub dual_stack: Option<DualStackMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capabilities {
    pub dual_stack: bool,
    pub bff_pattern: bool,
    pub single_stack: bool,
    pub session_auth: bool,
    pub token_auth: bool,
    pub api_key_auth: bool,
    pub module_system: bool,
    pub file_uploads: bool,
    pub background_jobs: bool,
    pub realtime: bool,
    pub email_notifications: bool,
    pub audit_logging: bool,
    pub direct_sql: bool,
    pub orm_based: bool,
    pub api_proxy: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Commands {
    pub install: String,
    pub compile: String,
    pub test: String,
    pub lint: String,
    pub dev: String,
    pub format_check: Option<String>,
    pub type_check: Option<String>,
    pub feature_verify: Vec<String>,
}
```

## Implementation Approach

### Phase 1: Factory Integration (completed)

Factory is integrated as first-class OAP code in `factory/`. The verification
harness has been rewritten in Rust within `crates/factory-engine/` (checks,
preflight, gate, state modules) with a `factory-harness` CLI binary.

### Phase 2: Contract Types Crate (3-4 days)

1. Create `crates/factory-contracts/Cargo.toml` with dependencies
2. Implement `build_spec.rs` — all Build Spec types from schema
3. Implement `adapter_manifest.rs` — all Adapter Manifest types from schema
4. Implement `pipeline_state.rs` — all Pipeline State types from schema
5. Implement `verification.rs` — all Verification Contract types from schema
6. Implement validation functions with error accumulation
7. Write tests: round-trip parse of `factory/contract/examples/*.yaml`

### Phase 3: Registry & Loaders (2 days)

1. Implement `AdapterRegistry::discover()` — glob `factory/adapters/*/manifest.yaml`
2. Implement `capabilities_match()` — cross-check adapter vs Build Spec
3. Implement `ProcessAgentLoader` — parse agent frontmatter + prompt text
4. Implement `PatternResolver` — path resolution from manifest

### Phase 4: Spec Compiler Extension (1 day)

1. Add `factory_projects` section to registry schema
2. Detect `.factory/build-spec.yaml` during compilation
3. Index project name, adapter, hash, stage status

### Phase 5: Schema Relocation (2026-05-05 follow-up)

Spec 108 §8 retired the in-tree `factory/` tree, which removed the canonical
`factory/contract/schemas/` location these typed representations were derived
from. The OAP-owned schemas now live under
`standards/schemas/factory/` (four top-level: `adapter-manifest`,
`build-spec`, `pipeline-state`, `verification`; five under `stage-outputs/`).
The statecraft sync pipeline reads them via `api/factory/oapContracts.ts`,
which walks up looking for `standards/schemas/factory/` and
respects an `OAP_FACTORY_SCHEMAS_DIR` env override for production
containers.

## Success Criteria

- **SC-001**: All four Factory contract examples parse without error into Rust types
- **SC-002**: `AdapterRegistry::discover()` finds all 4 adapters and validates their manifests
- **SC-003**: `capabilities_match()` correctly identifies capability gaps (e.g., `acme-vue-node` supports `dual`, `next-prisma` does not)
- **SC-004**: Round-trip `YAML → Rust → YAML` produces semantically identical output for Build Spec examples
- **SC-005**: `cargo build --release` succeeds for `crates/factory-contracts/`

## Dependencies

| Spec | Relationship |
|------|-------------|
| 075-factory-workflow-engine | Consumes contract types for manifest generation |
| 076-factory-desktop-panel | Consumes contract types for UI rendering |
| 077-statecraft-factory-api | Consumes adapter registry for project init |
| 067-tool-registry | Factory agents register as tool-registry entries |

## Risks

| Risk | Mitigation |
|------|-----------|
| Schema drift between YAML and Rust types | CI test: parse all examples on every PR |
| Factory subtree update breaks contract types | NF-002: contract crate is sole coupling point; version-pin subtree |
| Large subtree bloats repo | Factory is ~2MB total (mostly markdown + YAML); negligible |
