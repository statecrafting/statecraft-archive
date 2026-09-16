// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Rust types for the Factory Build Spec schema.
//!
//! A Build Spec is a tech-agnostic application specification covering project
//! identity, auth, data model, business rules, API, UI, integrations,
//! notifications, audit, security, health checks, error handling, data
//! ingestion, file storage, and traceability.

use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;

/// Current Build Spec contract version. Bumped 1.0.0 → 1.1.0 by spec 197
/// (open-standard extensions: per-audience `provisioning_model`,
/// per-integration `implementation_status`), then 1.1.0 → 1.2.0 by spec 210
/// (top-level `agentic_posture` object). Every addition is optional, so a
/// 1.0.0 or 1.1.0 Build Spec still deserializes unchanged.
pub const BUILD_SPEC_SCHEMA_VERSION: &str = "1.2.0";

// ── Top-level Build Spec ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildSpec {
    #[serde(default)]
    pub schema_version: String,
    pub project: ProjectSpec,
    pub auth: AuthSpec,
    pub data_model: DataModelSpec,
    pub business_rules: Vec<BusinessRule>,
    pub api: ApiSpec,
    pub ui: UiSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integrations: Option<Vec<Integration>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notifications: Option<NotificationSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audit: Option<AuditSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub security: Option<SecuritySpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub health_checks: Option<HealthChecks>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_handling: Option<ErrorHandling>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_ingestion: Option<Vec<DataIngestion>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_storage: Option<Vec<FileStorage>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traceability: Option<TraceabilitySpec>,
    /// The produced application's declared agentic surface (spec 210). Absent
    /// ⇒ `none`, and the governance certificate records that default AS
    /// defaulted (spec 210 FR-002). Optional/additive (schema 1.2.0).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agentic_posture: Option<AgenticPosture>,
}

// ── Agentic posture (spec 210) ──────────────────────────────────────────────────

/// The produced application's declared agentic surface (spec 210 FR-001).
///
/// Least Agency applied to outputs: a produced app's autonomy is a stated
/// choice, never a silent acquisition. Absent from a Build Spec means `none`,
/// and the governance certificate records that default AS defaulted
/// (spec 210 FR-002), so an auditor can tell "authored none" (someone decided)
/// from "defaulted none" (nobody asked).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgenticPosture {
    /// Declared agentic level.
    pub posture: PostureLevel,
    /// Enumerated agentic surfaces. Required non-empty for `declared` and
    /// `governed`; empty for `none`. Enforced by [`AgenticPosture::validate`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub surfaces: Vec<AgenticSurface>,
}

/// Declared agentic level of a produced application (spec 210 FR-001).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PostureLevel {
    /// No model calls, agent loops, tool surfaces, or persistent agent memory.
    None,
    /// Agentic surfaces exist and are enumerated.
    Declared,
    /// Declared, plus every surface carries a governance envelope.
    Governed,
}

impl PostureLevel {
    /// Canonical wire string (matches the schema enum and serde form).
    pub fn as_str(&self) -> &'static str {
        match self {
            PostureLevel::None => "none",
            PostureLevel::Declared => "declared",
            PostureLevel::Governed => "governed",
        }
    }
}

/// One enumerated agentic surface (spec 210 FR-001).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AgenticSurface {
    pub kind: SurfaceKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Inline governance envelope (the spec 198 schema, reused at application
    /// level). Required for every surface under `governed`; validated for
    /// SHAPE (must deserialize as a [`crate::governance_envelope::GovernanceEnvelope`])
    /// by [`AgenticPosture::validate`]. Carried as a raw value so the
    /// certificate binding can bind it verbatim (read, never recompute).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub governance_envelope: Option<serde_json::Value>,
}

/// Kind of an agentic surface (spec 210 FR-001).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SurfaceKind {
    ModelApi,
    ToolSurface,
    MemoryPersistence,
    HumanApprovalPoint,
}

impl SurfaceKind {
    /// Canonical wire string (matches the schema enum and serde form).
    pub fn as_str(&self) -> &'static str {
        match self {
            SurfaceKind::ModelApi => "model-api",
            SurfaceKind::ToolSurface => "tool-surface",
            SurfaceKind::MemoryPersistence => "memory-persistence",
            SurfaceKind::HumanApprovalPoint => "human-approval-point",
        }
    }
}

impl AgenticPosture {
    /// Well-formedness (spec 210 FR-001 / FR-004):
    /// - `none`: no surfaces.
    /// - `declared`: at least one surface.
    /// - `governed`: at least one surface, and every surface carries an inline
    ///   governance envelope that deserializes as a
    ///   [`crate::governance_envelope::GovernanceEnvelope`] (shape validation;
    ///   the spec 198 schema reused at application level). Shape only: runtime
    ///   admission of the app's own agents is out of scope (the tenant
    ///   deployment's concern).
    pub fn validate(&self) -> Result<(), String> {
        match self.posture {
            PostureLevel::None => {
                if !self.surfaces.is_empty() {
                    return Err(format!(
                        "agentic_posture `none` must enumerate no surfaces, found {}",
                        self.surfaces.len()
                    ));
                }
            }
            PostureLevel::Declared | PostureLevel::Governed => {
                if self.surfaces.is_empty() {
                    return Err(format!(
                        "agentic_posture `{}` requires a non-empty surface enumeration",
                        self.posture.as_str()
                    ));
                }
            }
        }
        if self.posture == PostureLevel::Governed {
            for (i, s) in self.surfaces.iter().enumerate() {
                let Some(env) = &s.governance_envelope else {
                    return Err(format!(
                        "agentic_posture `governed` surface #{i} ({}) is missing its \
                         governance_envelope (spec 210 FR-004)",
                        s.kind.as_str()
                    ));
                };
                serde_json::from_value::<crate::governance_envelope::GovernanceEnvelope>(env.clone())
                    .map_err(|e| {
                        format!(
                            "agentic_posture `governed` surface #{i} ({}) has a \
                             non-conformant governance_envelope: {e}",
                            s.kind.as_str()
                        )
                    })?;
            }
        }
        Ok(())
    }
}

// ── Project ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSpec {
    pub name: String,
    pub display_name: String,
    #[serde(default)]
    pub org: String,
    pub description: String,
    pub variant: Variant,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fiscal_context: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Variant {
    SinglePublic,
    SingleInternal,
    Dual,
}

// ── Auth ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSpec {
    /// Map of audience name (e.g. "citizen", "staff") to audience definition.
    pub audiences: HashMap<String, Audience>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_to_service: Option<ServiceToService>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session: Option<SessionPolicy>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Audience {
    pub method: AudienceMethod,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    pub roles: Vec<Role>,
    /// How users of this audience gain access (spec 197). **Required** per
    /// audience — an explicit, auditable access-control decision with no silent
    /// default (a missing value is a hard parse error, not a permissive
    /// fallback). Per-audience by design: a dual-variant project may set e.g.
    /// `citizen: open-authenticated` and `staff: admin-only`.
    pub provisioning_model: ProvisioningModel,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AudienceMethod {
    Saml,
    Oidc,
    Session,
    ApiKey,
    Basic,
    Mock,
}

/// How a principal of an audience obtains an application account (spec 197).
/// Generalizes the observed app-level `provisioningModel` to a per-audience
/// concept without coupling the contract to any org.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ProvisioningModel {
    /// User records are pre-created by an administrator; an unknown
    /// authenticated principal is denied. Selects admin user-CRUD endpoints
    /// and a user-management page for the audience.
    AdminOnly,
    /// Any IdP-authenticated principal gains access; the user record is
    /// auto-created on first login. No user-management page is generated.
    OpenAuthenticated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Role {
    pub role_code: String,
    pub display_name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceToService {
    pub method: S2sMethod,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_validation: Option<TokenValidation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_cache: Option<TokenCache>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum S2sMethod {
    ClientCredentials,
    MutualTls,
    ApiKey,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenValidation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issuer: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audience: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_clients: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenCache {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_buffer_seconds: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionPolicy {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_minutes: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub require_recent_auth_for: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persistence: Option<SessionPersistence>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store_type_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SessionPersistence {
    None,
    Persistent,
}

// ── Data Model ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataModelSpec {
    pub entities: Vec<Entity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationships: Option<Vec<Relationship>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub fields: Vec<Field>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unique_constraints: Option<Vec<UniqueConstraint>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check_constraints: Option<Vec<CheckConstraint>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indexes: Option<Vec<Index>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub business_rules: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Field {
    pub name: String,
    #[serde(rename = "type")]
    pub field_type: FieldType,
    /// Whether this field is the primary key.
    #[serde(default)]
    pub primary: bool,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unique: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_yaml::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    // For enum type
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enum_values: Option<Vec<String>>,
    // For decimal type
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub precision: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<u32>,
    // For string type
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_length: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_length: Option<u32>,
    // For reference type — flat (not nested struct)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ref_entity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ref_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ref_on_delete: Option<RefOnDelete>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FieldType {
    String,
    Text,
    Integer,
    Decimal,
    Boolean,
    Uuid,
    Date,
    Datetime,
    Timestamp,
    Enum,
    Json,
    Reference,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RefOnDelete {
    Cascade,
    Restrict,
    SetNull,
    NoAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UniqueConstraint {
    pub name: String,
    pub fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckConstraint {
    pub name: String,
    /// Human-readable description of the constraint (not SQL).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Index {
    pub fields: Vec<String>,
    #[serde(default)]
    pub unique: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Relationship {
    #[serde(rename = "type")]
    pub rel_type: RelationType,
    pub from: String,
    pub to: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub through: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RelationType {
    OneToOne,
    OneToMany,
    ManyToMany,
}

// ── Business Rules ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusinessRule {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(rename = "type")]
    pub rule_type: BusinessRuleType,
    pub enforced_at: EnforcedAt,
    pub entities: Vec<String>,
    // State-machine fields
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub states: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transitions: Option<Vec<Transition>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal_states: Option<Vec<String>>,
    // Computation fields
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inputs: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    // Validation fields
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub condition: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum BusinessRuleType {
    StateMachine,
    Validation,
    Computation,
    Authorization,
    Constraint,
    Privacy,
    Retention,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EnforcedAt {
    Service,
    Database,
    Both,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transition {
    pub from: String,
    pub to: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires_role: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conditions: Option<Vec<String>>,
}

// ── API ───────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_path: Option<String>,
    pub resources: Vec<ApiResource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_endpoints: Option<Vec<SystemEndpoint>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResource {
    pub name: String,
    pub entity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Optional parent resource for nested routes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<ResourceParent>,
    pub operations: Vec<Operation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceParent {
    pub resource: String,
    pub param: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Operation {
    pub id: String,
    pub method: HttpMethod,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub audience: Vec<String>,
    pub auth: AuthRequirement,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_roles: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stack: Option<StackTarget>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request: Option<RequestSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response: Option<ResponseSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub business_rules: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_cases: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_cases: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Head,
    Options,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AuthRequirement {
    Required,
    Optional,
    ServiceOnly,
    Public,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StackTarget {
    Public,
    Internal,
    Both,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Vec<Param>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<Vec<Param>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<RequestBody>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestBody {
    /// Entity name for request body (when body is entity-derived).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity: Option<String>,
    /// Subset of entity fields accepted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<Vec<String>>,
    /// Inline schema override when not entity-derived.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<serde_yaml::Value>,
    /// MIME type for the request body (e.g. `multipart/form-data`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Param {
    pub name: String,
    #[serde(rename = "type")]
    pub param_type: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseSpec {
    #[serde(rename = "type")]
    pub response_type: ResponseType,
    /// Entity name for response body.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity: Option<String>,
    /// Subset of entity fields returned (empty = all).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<Vec<String>>,
    /// Inline schema override when not entity-derived.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<serde_yaml::Value>,
    /// MIME type for the response (e.g. `application/octet-stream` for binary).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    /// Human-readable description of the response.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Related entities to eager-load with the response.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub includes: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ResponseType {
    Single,
    List,
    Paginated,
    Empty,
    Binary,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemEndpoint {
    pub id: String,
    pub method: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub auth: AuthRequirement,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_roles: Option<Vec<String>>,
}

// ── UI ────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiSpec {
    pub pages: Vec<Page>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub navigation: Option<Navigation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Page {
    pub id: String,
    pub title: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub page_type: PageType,
    /// Audience name from auth section.
    pub audience: String,
    pub view_type: ViewType,
    #[serde(default)]
    pub requires_auth: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_roles: Option<Vec<String>>,
    #[serde(default)]
    pub guest_only: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_sources: Option<Vec<DataSource>>,
    /// Operation ID this form page submits to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submits_to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nav_section: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nav_order: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nav_icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_cases: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_cases: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PageType {
    Landing,
    Dashboard,
    List,
    Detail,
    Form,
    Content,
    Help,
    Profile,
    Login,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ViewType {
    Public,
    PublicAuthenticated,
    PrivateAuthenticated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataSource {
    pub operation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purpose: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger: Option<DataSourceTrigger>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DataSourceTrigger {
    OnLoad,
    OnAction,
    OnSubmit,
    OnInterval,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Navigation {
    pub sections: Vec<NavSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavSection {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audience: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view_type: Option<String>,
}

// ── Integrations ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Integration {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub integration_type: IntegrationType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_params: Option<Vec<ConfigParam>>,
    /// Cron expression or keyword (for data-ingestion type).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync_schedule: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub business_rules: Option<Vec<String>>,
    /// Implementation lifecycle of this integration (spec 197). Absent ⇒
    /// unspecified (the adapter decides). `stub` ⇒ the adapter surfaces a
    /// "service pending" indicator rather than failing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub implementation_status: Option<ImplementationStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum IntegrationType {
    FileStorage,
    DataIngestion,
    Email,
    IdentityProvider,
    ExternalApi,
    MessageQueue,
}

/// Implementation lifecycle status of an integration (spec 197). GoA's
/// catalogue-specific `catalog-auto` is deliberately not modelled — a catalogue
/// presumes org infrastructure, which is not a contract concept (FR-005).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ImplementationStatus {
    /// Implemented and wired to a real backing service.
    Live,
    /// Stubbed; the adapter surfaces a "service pending" indicator.
    Stub,
    /// Declared but intentionally not yet implemented.
    Deferred,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigParam {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub sensitive: bool,
    #[serde(default)]
    pub required: bool,
}

// ── Notifications ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationSpec {
    pub events: Vec<NotificationEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationEvent {
    pub id: String,
    pub trigger: String,
    pub recipient: String,
    pub channel: NotificationChannel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject_template: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery: Option<NotificationDelivery>,
    /// Only meaningful for `async-with-retry` delivery.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_attempts: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NotificationChannel {
    Email,
    InApp,
    Both,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NotificationDelivery {
    FireAndForget,
    AsyncWithRetry,
    Guaranteed,
}

// ── Audit ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditSpec {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tracked_actions: Option<Vec<TrackedAction>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retention: Option<AuditRetention>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub business_rules: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackedAction {
    pub action_code: String,
    pub entities: Vec<String>,
    pub captures: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditRetention {
    pub policy: String,
    #[serde(default)]
    pub immutable: bool,
}

// ── Security ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecuritySpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rate_limiting: Option<Vec<RateLimitTier>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cors: Option<CorsSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_validation: Option<HostValidation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub csp: Option<CspSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub csrf: Option<CsrfSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<CorrelationId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitTier {
    pub tier: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub max_requests: u32,
    pub window_seconds: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub applies_to: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorsSpec {
    #[serde(default)]
    pub allow_credentials: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_policy: Option<CorsOriginPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CorsOriginPolicy {
    Explicit,
    SameOrigin,
    Wildcard,
}

#[derive(Debug, Clone, Serialize)]
pub struct HostValidation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub policy: Option<HostValidationPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Accept either a bare string (`host_validation: required`) as shorthand for
/// the policy, or the full struct form (`host_validation: { policy: required }`).
impl<'de> Deserialize<'de> for HostValidation {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum StringOrStruct {
            String(String),
            Struct {
                #[serde(default)]
                policy: Option<HostValidationPolicy>,
                #[serde(default)]
                description: Option<String>,
            },
        }

        match StringOrStruct::deserialize(deserializer)? {
            StringOrStruct::String(s) => {
                let policy = serde_yaml::from_str::<HostValidationPolicy>(&format!("\"{s}\""))
                    .map_err(serde::de::Error::custom)?;
                Ok(HostValidation {
                    policy: Some(policy),
                    description: None,
                })
            }
            StringOrStruct::Struct {
                policy,
                description,
            } => Ok(HostValidation {
                policy,
                description,
            }),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum HostValidationPolicy {
    Required,
    Optional,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CspSpec {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub reporting_endpoint: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CsrfSpec {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub applies_to: Option<CsrfScope>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CsrfScope {
    StateChanging,
    All,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorrelationId {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header_name: Option<String>,
    #[serde(default)]
    pub propagate_to_downstream: bool,
}

// ── Health Checks ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthChecks {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub liveness: Option<HealthProbe>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub readiness: Option<ReadinessProbe>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub info: Option<InfoProbe>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthProbe {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadinessProbe {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dependencies: Option<Vec<HealthDependency>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthDependency {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u32>,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InfoProbe {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub redact_in_production: bool,
}

// ── Error Handling ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorHandling {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub envelope: Option<ErrorEnvelope>,
    #[serde(default)]
    pub suppress_details_in_production: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorEnvelope {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_subfields: Option<Vec<ErrorSubfield>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorSubfield {
    pub name: String,
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(default)]
    pub required: bool,
}

// ── Data Ingestion ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataIngestion {
    /// References `integrations[].id`.
    pub integration_id: String,
    #[serde(default)]
    pub manual_trigger: bool,
    #[serde(default)]
    pub status_endpoint: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partial_failure: Option<PartialFailurePolicy>,
    #[serde(default)]
    pub staleness_tracking: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub privacy_rules: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PartialFailurePolicy {
    Abort,
    Continue,
    ContinueAndLog,
}

// ── File Storage ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileStorage {
    /// References `integrations[].id`.
    pub integration_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upload: Option<FileTransferSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub download: Option<FileTransferSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub virus_scanning: Option<VirusScanSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_file_size_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_mime_types: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTransferSpec {
    pub method: FileTransferMethod,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url_expiry_seconds: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FileTransferMethod {
    PreSignedUrl,
    DirectUpload,
    Multipart,
    Proxy,
    Direct,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VirusScanSpec {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub scan_before_available: bool,
}

// ── Traceability ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceabilitySpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_cases: Option<Vec<UseCase>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_cases: Option<Vec<TestCase>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UseCase {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestCase {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub covers_use_case: Option<String>,
    #[serde(rename = "type")]
    pub test_type: TestCaseType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TestCaseType {
    Unit,
    Integration,
    E2e,
    Smoke,
    Manual,
}

// ── Tests (spec 197 — open-standard 1.1.0 extensions) ──────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // provisioning_model is REQUIRED (spec 197) — a missing value is a HARD
    // parse error, never a permissive default. This is the AI-review A01
    // hardening: every audience makes an explicit, auditable access decision.
    #[test]
    fn audience_requires_provisioning_model() {
        let yaml = "method: oidc\nprovider: entra-id\nroles:\n  - role_code: staff\n    display_name: Staff\n    description: Internal staff\n    permissions: [\"case.read\"]\n";
        assert!(serde_yaml::from_str::<Audience>(yaml).is_err());
    }

    // AC-2: both provisioning_model values parse; an unknown value is an error.
    #[test]
    fn provisioning_model_values_parse() {
        let admin: Audience =
            serde_yaml::from_str("method: oidc\nroles: []\nprovisioning_model: admin-only\n")
                .unwrap();
        assert_eq!(admin.provisioning_model, ProvisioningModel::AdminOnly);

        let open: Audience = serde_yaml::from_str(
            "method: saml\nroles: []\nprovisioning_model: open-authenticated\n",
        )
        .unwrap();
        assert_eq!(
            open.provisioning_model,
            ProvisioningModel::OpenAuthenticated
        );
    }

    #[test]
    fn provisioning_model_invalid_is_error() {
        assert!(serde_yaml::from_str::<Audience>(
            "method: saml\nroles: []\nprovisioning_model: self-service\n"
        )
        .is_err());
    }

    // AC-3: implementation_status parses; the rejected `catalog-auto` errors.
    #[test]
    fn integration_implementation_status_parses() {
        let i: Integration = serde_yaml::from_str(
            "id: INT-001\nname: Blob Storage\ntype: file-storage\nimplementation_status: stub\n",
        )
        .unwrap();
        assert_eq!(i.implementation_status, Some(ImplementationStatus::Stub));

        let none: Integration =
            serde_yaml::from_str("id: INT-002\nname: Email\ntype: email\n").unwrap();
        assert!(none.implementation_status.is_none());
    }

    #[test]
    fn integration_catalog_auto_rejected() {
        assert!(serde_yaml::from_str::<Integration>(
            "id: INT-003\nname: SAP\ntype: external-api\nimplementation_status: catalog-auto\n"
        )
        .is_err());
    }

    #[test]
    fn build_spec_schema_version_is_1_2_0() {
        assert_eq!(BUILD_SPEC_SCHEMA_VERSION, "1.2.0");
    }

    // ── Agentic posture (spec 210) ──────────────────────────────────────────

    /// A minimal, shape-conformant governance envelope (spec 198 schema),
    /// reused at application level for a `governed` surface. Mirrors the
    /// 1.x envelope shape asserted in governance_envelope.rs tests.
    fn conformant_envelope_value() -> serde_json::Value {
        serde_json::json!({
            "schema_version": crate::GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
            "process": {
                "id": "app-agent",
                "objective_class": "Assist the user within the app",
                "goal_identifier_scheme": "app:<feature>"
            },
            "ceilings": { "max_tier": "tier1", "max_mutation": "read-only" },
            "gates": [{ "predicate": "human-approval-before-tool-call" }],
            "emits": [{ "kind": "assistant-response" }],
            "constituents": { "agents": "app/agents/*.md" },
            "overrides": { "require_verified": false }
        })
    }

    fn surface(kind: SurfaceKind, envelope: Option<serde_json::Value>) -> AgenticSurface {
        AgenticSurface {
            kind,
            description: Some("surface".to_string()),
            governance_envelope: envelope,
        }
    }

    #[test]
    fn posture_none_authored_parses_and_validates() {
        // `none` with no surfaces: authored none, well-formed.
        let p: AgenticPosture = serde_yaml::from_str("posture: none\n").unwrap();
        assert_eq!(p.posture, PostureLevel::None);
        assert!(p.surfaces.is_empty());
        assert!(p.validate().is_ok());
    }

    #[test]
    fn posture_none_with_surfaces_is_rejected() {
        let p = AgenticPosture {
            posture: PostureLevel::None,
            surfaces: vec![surface(SurfaceKind::ModelApi, None)],
        };
        assert!(p.validate().is_err());
    }

    #[test]
    fn posture_declared_requires_non_empty_surfaces() {
        let empty = AgenticPosture {
            posture: PostureLevel::Declared,
            surfaces: vec![],
        };
        assert!(empty.validate().is_err());

        let ok = AgenticPosture {
            posture: PostureLevel::Declared,
            surfaces: vec![surface(SurfaceKind::ModelApi, None)],
        };
        assert!(ok.validate().is_ok());
    }

    #[test]
    fn posture_governed_requires_conformant_envelope_per_surface() {
        // Missing envelope on a governed surface.
        let missing = AgenticPosture {
            posture: PostureLevel::Governed,
            surfaces: vec![surface(SurfaceKind::ToolSurface, None)],
        };
        assert!(missing.validate().is_err());

        // Present but non-conformant (does not deserialize as a GovernanceEnvelope).
        let malformed = AgenticPosture {
            posture: PostureLevel::Governed,
            surfaces: vec![surface(
                SurfaceKind::ToolSurface,
                Some(serde_json::json!({ "not": "an envelope" })),
            )],
        };
        assert!(malformed.validate().is_err());

        // Conformant inline envelope: passes shape validation.
        let ok = AgenticPosture {
            posture: PostureLevel::Governed,
            surfaces: vec![surface(
                SurfaceKind::ToolSurface,
                Some(conformant_envelope_value()),
            )],
        };
        assert!(
            ok.validate().is_ok(),
            "conformant envelope should pass shape validation: {:?}",
            ok.validate()
        );
    }

    #[test]
    fn posture_round_trips_through_yaml() {
        let p = AgenticPosture {
            posture: PostureLevel::Declared,
            surfaces: vec![
                surface(SurfaceKind::ModelApi, None),
                surface(SurfaceKind::HumanApprovalPoint, None),
            ],
        };
        let yaml = serde_yaml::to_string(&p).unwrap();
        let back: AgenticPosture = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(p, back);
    }

    #[test]
    fn surface_kind_and_posture_level_wire_forms() {
        assert_eq!(PostureLevel::None.as_str(), "none");
        assert_eq!(PostureLevel::Declared.as_str(), "declared");
        assert_eq!(PostureLevel::Governed.as_str(), "governed");
        assert_eq!(SurfaceKind::ModelApi.as_str(), "model-api");
        assert_eq!(SurfaceKind::HumanApprovalPoint.as_str(), "human-approval-point");
        // Serde form matches the schema enum (kebab-case).
        let k: SurfaceKind = serde_yaml::from_str("memory-persistence").unwrap();
        assert_eq!(k, SurfaceKind::MemoryPersistence);
    }

    // The sibling contract version consts are also pinned, so a typo in either
    // adapter_manifest.rs or pipeline_state.rs fails CI (they bumped to named
    // consts in spec 197 but were otherwise untested). Adapter manifest is
    // 1.1.0 since spec 198 FR-012 (governance sub-envelope section).
    #[test]
    fn sibling_contract_schema_versions_are_pinned() {
        assert_eq!(crate::ADAPTER_MANIFEST_SCHEMA_VERSION, "1.1.0");
        assert_eq!(crate::PIPELINE_STATE_SCHEMA_VERSION, "1.0.0");
        assert_eq!(crate::GOVERNANCE_ENVELOPE_SCHEMA_VERSION, "1.3.0");
        assert!(crate::ADAPTER_MANIFEST_ACCEPTED_SCHEMA_VERSIONS.contains(&"1.0.0"));
        assert!(crate::ADAPTER_MANIFEST_ACCEPTED_SCHEMA_VERSIONS
            .contains(&crate::ADAPTER_MANIFEST_SCHEMA_VERSION));
    }
}
