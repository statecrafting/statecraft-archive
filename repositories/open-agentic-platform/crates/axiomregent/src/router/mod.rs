// Feature: MCP_ROUTER
// Spec: spec/core/router.md

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::Arc;

use crate::lease::{LeaseStore, StaleLeaseError};

pub mod audit_http;
pub mod dlock;
pub mod legacy_provider;
pub mod oidc_client;
pub mod permissions;
pub mod policy_bundle;
pub mod policy_http;
pub mod provider;

pub use oidc_client::{AuthProvider, OidcM2mClient};

use policy_bundle::{PolicyBundleCache, build_tool_call_context, evaluate_loaded_policy};

#[derive(Serialize, Deserialize, Debug)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub method: String,
    pub params: Option<Value>,
    pub id: Option<Value>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub result: Option<Value>,
    pub error: Option<Value>,
    pub id: Option<Value>,
}

/// AxiomRegentError represents MCP-level errors that are surfaced to clients using
/// string error codes defined by the MCP common schema.
///
/// NOTE: We intentionally avoid adding new dependencies here (e.g. `thiserror`).
#[derive(Debug)]
pub enum AxiomRegentError {
    NotFound(String),
    InvalidArgument(String),
    RepoChanged(String),
    PermissionDenied(String),
    /// Policy kernel / compiled bundle denied the tool call (047) — distinct wire code from [`Self::PermissionDenied`].
    PolicyDenied(String),
    TooLarge(String),
    Internal(String),
}

impl AxiomRegentError {
    pub fn code(&self) -> &'static str {
        match self {
            AxiomRegentError::NotFound(_) => "NOT_FOUND",
            AxiomRegentError::InvalidArgument(_) => "INVALID_ARGUMENT",
            AxiomRegentError::RepoChanged(_) => "REPO_CHANGED",
            AxiomRegentError::PermissionDenied(_) => "PERMISSION_DENIED",
            AxiomRegentError::PolicyDenied(_) => "POLICY_DENIED",
            AxiomRegentError::TooLarge(_) => "TOO_LARGE",
            AxiomRegentError::Internal(_) => "INTERNAL",
        }
    }

    fn message(&self) -> &str {
        match self {
            AxiomRegentError::NotFound(m)
            | AxiomRegentError::InvalidArgument(m)
            | AxiomRegentError::RepoChanged(m)
            | AxiomRegentError::PermissionDenied(m)
            | AxiomRegentError::PolicyDenied(m)
            | AxiomRegentError::TooLarge(m)
            | AxiomRegentError::Internal(m) => m.as_str(),
        }
    }
}

impl std::fmt::Display for AxiomRegentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message())
    }
}

impl std::error::Error for AxiomRegentError {}

/// Spec 093: lightweight struct for feature context in router (avoids depending on featuregraph types).
#[derive(Default, Clone, Debug)]
pub struct FeatureContextInfo {
    pub feature_ids: Vec<String>,
    pub max_risk: Option<String>,
    pub statuses: Vec<String>,
}

/// 098 Slice 4: trait for featuregraph mutation preflight.
/// Implemented by [`crate::feature_tools::FeatureTools`].
#[async_trait]
pub trait MutationPreflight: Send + Sync {
    /// Check whether a mutation to the given paths is allowed by featuregraph preflight.
    /// Returns Ok(true) if allowed, Ok(false) if blocked, Err on infrastructure failure.
    async fn check_mutation(
        &self,
        repo_root: &str,
        paths: &[String],
        intent: &str,
    ) -> Result<bool, String>;

    /// Spec 093: sync feature context lookup (IDs, max risk, statuses) for affected paths.
    /// Default returns empty context (no featuregraph available).
    fn feature_context_sync(
        &self,
        _repo_root: &str,
        _paths: &[String],
    ) -> Result<FeatureContextInfo, String> {
        Ok(FeatureContextInfo::default())
    }
}

pub struct Router {
    providers: Vec<Arc<dyn provider::ToolProvider>>,
    lease_store: Arc<LeaseStore>,
    policy_bundle_cache: Arc<PolicyBundleCache>,
    /// Seam B: optional fire-and-forget HTTP forwarder for audit records.
    audit_forwarder: Option<Arc<audit_http::AuditForwarder>>,
    /// Platform integration config (read from env at startup). Used by Seams C/D.
    #[allow(dead_code)]
    platform_config: crate::platform_config::PlatformConfig,
    /// Unified tool registry (spec 067). Provides schema validation and lifecycle events.
    tool_registry: crate::registry_bridge::AsyncToolRegistryHandle,
    /// 098 Slice 4: optional featuregraph mutation preflight checker.
    preflight_checker: Option<Arc<dyn MutationPreflight>>,
    /// Spec 207 FR-001/FR-002: session-scoped tamper-evident audit chain. Every
    /// governed tool dispatch decision (allowed / denied / policy_denied) is
    /// hash-chained into a rotating JSONL segment under the agent data dir, in
    /// addition to the Seam-B forward. Closed segment heads are submitted for
    /// platform countersign by the OPC duplex client (spec 207 AC-4). `None`
    /// when no audit dir was supplied or the chain could not be opened (audit
    /// must never block or panic a tool dispatch).
    audit_chain: Option<Arc<open_agentic_policy_kernel::audit::AuditLogger>>,
}

/// Spec 093: extract file paths that will be affected by a tool call.
fn extract_file_paths_from_args(
    tool_name: &str,
    args: &serde_json::Map<String, Value>,
) -> Vec<String> {
    match tool_name {
        "repo.write_file" | "workspace.write_file" | "write_file" => args
            .get("path")
            .and_then(|v| v.as_str())
            .map(|p| vec![p.to_string()])
            .unwrap_or_default(),
        "repo.delete" | "workspace.delete" => args
            .get("path")
            .and_then(|v| v.as_str())
            .map(|p| vec![p.to_string()])
            .unwrap_or_default(),
        "repo.apply_patch" | "workspace.apply_patch" => {
            let patch = args.get("patch").and_then(|v| v.as_str()).unwrap_or("");
            patch
                .lines()
                .filter_map(|line| line.strip_prefix("+++ b/").map(|r| r.to_string()))
                .collect()
        }
        _ => vec![],
    }
}

impl Router {
    pub async fn new(
        providers: Vec<Arc<dyn provider::ToolProvider>>,
        lease_store: Arc<LeaseStore>,
        preflight_checker: Option<Arc<dyn MutationPreflight>>,
    ) -> Self {
        let platform_cfg = crate::platform_config::PlatformConfig::from_env();

        // Build the AuthProvider: prefer OIDC when all three env vars are set,
        // otherwise fall back to the static M2M token.
        let auth_provider: Option<AuthProvider> = if platform_cfg.oidc_configured() {
            let endpoint = platform_cfg.oidc_endpoint.as_deref().unwrap();
            let client_id = platform_cfg.oidc_client_id.clone().unwrap();
            let client_secret = platform_cfg.oidc_client_secret.clone().unwrap();
            match OidcM2mClient::new(endpoint, client_id, client_secret).await {
                Ok(client) => {
                    eprintln!("[platform] OIDC M2M auth configured (endpoint={endpoint})");
                    Some(AuthProvider::Oidc(Arc::new(client)))
                }
                Err(e) => {
                    if platform_cfg.m2m_token.is_some() {
                        eprintln!(
                            "[platform] OIDC discovery failed: {e}; falling back to static token"
                        );
                    } else {
                        eprintln!(
                            "[platform] OIDC discovery failed: {e}; no static token configured — platform seams disabled"
                        );
                    }
                    platform_cfg.m2m_token.clone().map(AuthProvider::Static)
                }
            }
        } else {
            platform_cfg.m2m_token.clone().map(AuthProvider::Static)
        };

        let audit_forwarder = match (&platform_cfg.audit_url, &auth_provider) {
            (Some(url), Some(auth)) => {
                eprintln!("[platform] audit streaming enabled → {url}");
                Some(Arc::new(audit_http::AuditForwarder::new(
                    url.clone(),
                    auth.clone(),
                )))
            }
            _ => None,
        };
        let policy_bundle_cache = Arc::new(PolicyBundleCache::new());

        // Seam A: spawn background policy bundle refresh when PLATFORM_POLICY_URL is set.
        if let (Some(url), Some(auth)) = (&platform_cfg.policy_url, &auth_provider) {
            // Use repo root from OPC_REPO_ROOT env var (or "default" workspace).
            let repo_root = std::env::var("OPC_REPO_ROOT").unwrap_or_else(|_| "default".into());
            eprintln!("[platform] policy bundle refresh enabled → {url}");
            policy_http::spawn_policy_refresh(
                Arc::clone(&policy_bundle_cache),
                url.clone(),
                auth.clone(),
                repo_root,
            );
        }

        // Build unified tool registry (spec 067) from all providers.
        let tool_registry = Arc::new(crate::registry_bridge::build_registry(&providers, None));

        Self {
            providers,
            lease_store,
            policy_bundle_cache,
            audit_forwarder,
            platform_config: platform_cfg,
            tool_registry,
            preflight_checker,
            audit_chain: None,
        }
    }

    /// 098 Slice 4: setter to configure the mutation preflight checker after construction.
    pub fn set_preflight_checker(&mut self, checker: Arc<dyn MutationPreflight>) {
        self.preflight_checker = Some(checker);
    }

    /// Spec 207 FR-001/FR-002: open the session-scoped tamper-evident audit
    /// chain under `<audit_dir>/permissions.jsonl` (mirrors the
    /// `set_preflight_checker` post-construction setter). The OPC sidecar
    /// passes `<AXIOMREGENT_DATA_DIR>/audit`, a path the desktop side can
    /// recompute to read closed segment heads for platform countersign (AC-4).
    /// An open failure disables the chain rather than aborting startup;
    /// auditing must never block or panic the host.
    pub fn set_audit_chain(&mut self, audit_dir: PathBuf) {
        // Stderr writes must be best-effort: the OPC sidecar (and the
        // stdio_integrity test) stop reading stderr after the startup banner,
        // so a later write hits a broken pipe. `eprintln!` PANICS on write
        // failure, which would abort the host mid-startup; mirror the
        // error-ignoring `let _ = writeln!(stderr, …)` discipline in main.rs.
        use std::io::Write as _;
        let chain_path = audit_dir.join("permissions.jsonl");
        self.audit_chain =
            match open_agentic_policy_kernel::audit::AuditLogger::new(chain_path.clone()) {
                Ok(logger) => {
                    let _ = writeln!(
                        std::io::stderr(),
                        "[platform] session audit chain → {}",
                        chain_path.display()
                    );
                    Some(Arc::new(logger))
                }
                Err(e) => {
                    let _ = writeln!(
                        std::io::stderr(),
                        "[platform] session audit chain disabled (open failed: {e}) → {}",
                        chain_path.display()
                    );
                    None
                }
            };
    }

    /// Spec 093: sync lookup of feature context for a tool call's affected paths.
    fn lookup_feature_context(
        &self,
        tool_name: &str,
        args: &serde_json::Map<String, Value>,
    ) -> Option<FeatureContextInfo> {
        let checker = self.preflight_checker.as_ref()?;
        let repo_root = args.get("repo_root").and_then(|v| v.as_str())?;
        let paths = extract_file_paths_from_args(tool_name, args);
        if paths.is_empty() {
            return None;
        }
        checker.feature_context_sync(repo_root, &paths).ok()
    }

    /// Forward an audit payload to the platform if the forwarder is configured (Seam B).
    fn maybe_forward_audit(&self, payload: &serde_json::Value) {
        if let Some(fwd) = &self.audit_forwarder {
            fwd.forward(payload.clone());
        }
    }

    /// Record a tool-dispatch audit payload on every governed path (spec 207
    /// FR-001): forward it to the platform (Seam B) AND append it to the local
    /// tamper-evident session chain when configured. Both are best-effort and
    /// independent: a disabled forwarder or chain is a silent no-op, and the
    /// chain write never blocks or panics the dispatch.
    fn record_audit(&self, payload: &serde_json::Value) {
        self.maybe_forward_audit(payload);
        if let Some(chain) = &self.audit_chain {
            chain.log_value(payload.clone());
        }
    }

    /// 098 Slice 4: auto-run featuregraph preflight before mutation tools.
    /// Returns Some(error response) if mutation is blocked; None if allowed or not applicable.
    async fn run_mutation_preflight(
        &self,
        id: Option<Value>,
        tool_name: &str,
        args: &serde_json::Map<String, Value>,
    ) -> Option<JsonRpcResponse> {
        let checker = self.preflight_checker.as_ref()?;

        // Only run preflight for file-writing tools.
        let meta = agent::safety::get_tool_metadata(tool_name);
        if !meta.requires_file_write {
            return None;
        }

        let repo_root = match args.get("repo_root").and_then(|v| v.as_str()) {
            Some(r) => r,
            None => {
                // Mutation tools require repo_root for governance preflight (098 Slice 4).
                // Missing repo_root must not silently bypass — return error.
                return Some(json_rpc_error(
                    id,
                    -32602, // Invalid params
                    "Mutation preflight requires 'repo_root' parameter",
                ));
            }
        };

        // Extract the paths that will be mutated and infer intent from the tool name.
        let (changed_paths, intent) = match tool_name {
            "repo.write_file" | "workspace.write_file" | "write_file" => {
                let path = args.get("path").and_then(|v| v.as_str())?;
                (vec![path.to_string()], "edit")
            }
            "repo.delete" | "workspace.delete" => {
                let path = args.get("path").and_then(|v| v.as_str())?;
                (vec![path.to_string()], "delete")
            }
            "repo.apply_patch" | "workspace.apply_patch" => {
                let patch = args.get("patch").and_then(|v| v.as_str()).unwrap_or("");
                let paths: Vec<String> = patch
                    .lines()
                    .filter_map(|line| {
                        if let Some(rest) = line.strip_prefix("+++ b/") {
                            Some(rest.to_string())
                        } else {
                            // Only include "--- a/" paths when there's no "+++ b/" counterpart —
                            // in practice we prefer "+++ b/" (the target); deduplicate later.
                            line.strip_prefix("--- a/").map(|rest| rest.to_string())
                        }
                    })
                    .collect::<std::collections::HashSet<_>>()
                    .into_iter()
                    .collect();
                if paths.is_empty() {
                    return None;
                }
                (paths, "refactor")
            }
            _ => return None,
        };

        match checker
            .check_mutation(repo_root, &changed_paths, intent)
            .await
        {
            Ok(true) => None,
            Ok(false) => Some(json_rpc_error(
                id,
                -32603,
                "Mutation blocked by governance preflight: affected features have violations",
            )),
            // Fail-open on infrastructure errors — do not block the tool call,
            // but log the error so it is observable (spec 090: no silent bypass).
            Err(e) => {
                eprintln!("[governance] WARN: mutation preflight check failed (fail-open): {e}");
                None
            }
        }
    }

    async fn preflight_tool_permission(
        &self,
        id: Option<Value>,
        tool_name: &str,
        args: &serde_json::Map<String, Value>,
    ) -> Option<JsonRpcResponse> {
        // Spec 093: lookup feature context for risk ceiling.
        let feature_ctx = self.lookup_feature_context(tool_name, args);
        let spec_risk = feature_ctx.as_ref().and_then(|fc| fc.max_risk.as_deref());

        let lease_id_str = args.get("lease_id").and_then(|v| v.as_str());
        let lease = match lease_id_str {
            Some(lid) => self.lease_store.get_lease(lid).await,
            None => None,
        };

        // When no lease is found, fall back to the store's default grants so that
        // tool calls without a lease_id are still subject to tier + permission checks
        // rather than silently bypassing enforcement (Risk 1 fix — post-035 hardening).
        let tier_label = agent::safety::get_tool_tier(tool_name).as_str();
        match &lease {
            Some(l) => match permissions::check_grants(tool_name, &l.grants, spec_risk) {
                Ok(()) => {
                    let audit = permissions::audit_tool_dispatch(
                        tool_name,
                        tier_label,
                        "allowed",
                        lease_id_str,
                    );
                    self.record_audit(&audit);
                    self.policy_preflight_response(id, tool_name, args, lease_id_str)
                }
                Err(e) => {
                    let audit = permissions::audit_tool_dispatch(
                        tool_name,
                        tier_label,
                        "denied",
                        lease_id_str,
                    );
                    self.record_audit(&audit);
                    Some(json_rpc_permission_denied(id, &e.to_string()))
                }
            },
            None => {
                let fallback = self.lease_store.default_grants();
                match permissions::check_grants(tool_name, &fallback, spec_risk) {
                    Ok(()) => {
                        let audit = permissions::audit_tool_dispatch(
                            tool_name,
                            tier_label,
                            "allowed_no_lease",
                            None,
                        );
                        self.record_audit(&audit);
                        self.policy_preflight_response(id, tool_name, args, None)
                    }
                    Err(e) => {
                        let audit = permissions::audit_tool_dispatch(
                            tool_name,
                            tier_label,
                            "denied_no_lease",
                            None,
                        );
                        self.record_audit(&audit);
                        Some(json_rpc_permission_denied(id, &e.to_string()))
                    }
                }
            }
        }
    }

    /// 047: after tier + permission grants pass, evaluate compiled policy bundle when `repo_root` + bundle exist.
    fn policy_preflight_response(
        &self,
        id: Option<Value>,
        tool_name: &str,
        args: &serde_json::Map<String, Value>,
        lease_id_for_audit: Option<&str>,
    ) -> Option<JsonRpcResponse> {
        let repo_root = args.get("repo_root").and_then(|v| v.as_str())?;
        let bundle = self.policy_bundle_cache.bundle_for_repo_root(repo_root)?;
        let mut ctx = build_tool_call_context(tool_name, args);

        // Spec 093: enrich ToolCallContext with featuregraph data when available.
        if let Some(fc) = self.lookup_feature_context(tool_name, args) {
            ctx.feature_ids = fc.feature_ids;
            ctx.max_spec_risk = fc.max_risk;
            ctx.spec_statuses = fc.statuses;
        }

        let decision = evaluate_loaded_policy(&bundle, &ctx)?;
        let tier_label = agent::safety::get_tool_tier(tool_name).as_str();
        let audit = permissions::audit_tool_dispatch(
            tool_name,
            tier_label,
            "policy_denied",
            lease_id_for_audit,
        );
        self.record_audit(&audit);
        let msg = format!("{} {:?}", decision.reason, decision.rule_ids);
        Some(json_rpc_policy_denied(id, &msg))
    }

    pub async fn handle_request(&self, req: &JsonRpcRequest) -> JsonRpcResponse {
        match req.method.as_str() {
            "initialize" => json_rpc_ok(
                req.id.clone(),
                json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": get_server_capabilities(),
                    "serverInfo": { "name": "mcp", "version": "0.1.0" }
                }),
            ),
            "tools/list" => {
                let all_tools = self.tool_registry.list_schemas();
                json_rpc_ok(req.id.clone(), json!({ "tools": all_tools }))
            }
            "tools/call" => {
                let params = match req.params.as_ref().and_then(|p| p.as_object()) {
                    Some(p) => p,
                    None => return json_rpc_error(req.id.clone(), -32602, "Invalid params"),
                };
                let name = match params.get("name").and_then(|n| n.as_str()) {
                    Some(n) => n,
                    None => return json_rpc_error(req.id.clone(), -32602, "Missing tool name"),
                };
                let args = match params.get("arguments").and_then(|a| a.as_object()) {
                    Some(a) => a,
                    None => return json_rpc_error(req.id.clone(), -32602, "Missing arguments"),
                };

                // Preflight permission check
                if let Some(resp) = self
                    .preflight_tool_permission(req.id.clone(), name, args)
                    .await
                {
                    return resp;
                }

                // Mutation preflight enforcement (098 Slice 4).
                if let Some(resp) = self
                    .run_mutation_preflight(req.id.clone(), name, args)
                    .await
                {
                    return resp;
                }

                // Acquire dlock for Tier2/3 tools that mutate the worktree (FR-007).
                let tool_tier = agent::safety::get_tool_tier(name);
                let repo_root_for_lock = args.get("repo_root").and_then(|v| v.as_str());
                let needs_lock = matches!(
                    tool_tier,
                    agent::safety::ToolTier::Tier2 | agent::safety::ToolTier::Tier3
                ) && repo_root_for_lock.is_some();

                let _lock_guard = if needs_lock {
                    match repo_root_for_lock {
                        Some(root) => {
                            match dlock::acquire_repo_lock(self.lease_store.client(), root).await {
                                Ok(guard) => Some(guard),
                                Err(e) => {
                                    return json_rpc_error(req.id.clone(), -32603, &e.to_string());
                                }
                            }
                        }
                        None => None,
                    }
                } else {
                    None
                };

                // Dispatch to first matching provider.
                // _lock_guard drops here, releasing the dlock (if held).
                {
                    let mut dispatch_result = None;
                    for p in &self.providers {
                        if let Some(result) = p.handle(name, args).await {
                            dispatch_result =
                                Some(handle_tool_result_value(req.id.clone(), result));
                            break;
                        }
                    }
                    dispatch_result.unwrap_or_else(|| {
                        json_rpc_error(req.id.clone(), -32601, &format!("Tool not found: {}", name))
                    })
                }
            }
            _ => json_rpc_error(req.id.clone(), -32601, "Method not found"),
        }
    }
}

fn json_rpc_ok(id: Option<Value>, result: Value) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        result: Some(result),
        error: None,
        id,
    }
}

fn json_rpc_error(id: Option<Value>, code: i64, message: &str) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        result: None,
        error: Some(json!({
            "code": code,
            "message": message
        })),
        id,
    }
}

fn json_rpc_permission_denied(id: Option<Value>, message: &str) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        result: None,
        error: Some(json!({
            "code": AxiomRegentError::PermissionDenied(message.to_string()).code(),
            "message": message,
        })),
        id,
    }
}

fn json_rpc_policy_denied(id: Option<Value>, message: &str) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        result: None,
        error: Some(json!({
            "code": AxiomRegentError::PolicyDenied(message.to_string()).code(),
            "message": message,
        })),
        id,
    }
}

fn get_server_capabilities() -> Value {
    json!({
        "tools": {
            "listChanged": true
        },
        "logging": {}
    })
}

fn handle_tool_result_value(id: Option<Value>, result: anyhow::Result<Value>) -> JsonRpcResponse {
    match result {
        Ok(val) => json_rpc_ok(id, json!({ "content": [{ "type": "json", "json": val }] })),
        Err(e) => handle_tool_error(id, e),
    }
}

fn handle_tool_error(id: Option<Value>, e: anyhow::Error) -> JsonRpcResponse {
    if let Some(stale) = e.downcast_ref::<StaleLeaseError>() {
        return JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            result: None,
            error: Some(json!({
                "code": "STALE_LEASE",
                "message": stale.msg,
                "data": {
                    "lease_id": stale.lease_id,
                    "current_fingerprint": stale.current_fingerprint
                }
            })),
            id,
        };
    }
    json_rpc_error(id, -32603, &format!("Tool failed: {}", e))
}
