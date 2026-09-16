//! Load `build/policy-bundles/policy-bundle.json` per repo root (047 Phase 6).
//! Missing or invalid bundles fall back to tier+permission-only enforcement (spec R-002).

use open_agentic_policy_kernel::{
    PolicyBundle, PolicyDecision, PolicyOutcome, PolicyRule, ToolCallContext, evaluate,
};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Arc, RwLock};

/// In-memory cache keyed by `repo_root` string to avoid re-reading the bundle on every tool call.
pub struct PolicyBundleCache {
    cache: RwLock<std::collections::HashMap<String, Option<Arc<PolicyBundle>>>>,
}

impl Default for PolicyBundleCache {
    fn default() -> Self {
        Self::new()
    }
}

impl PolicyBundleCache {
    pub fn new() -> Self {
        Self {
            cache: RwLock::new(std::collections::HashMap::new()),
        }
    }

    /// Upsert a policy bundle fetched from the platform (Seam A).
    pub fn update_bundle(&self, repo_root: &str, bundle: PolicyBundle) {
        let key = Path::new(repo_root).to_string_lossy().to_string();
        self.cache
            .write()
            .expect("policy bundle cache poisoned")
            .insert(key, Some(Arc::new(bundle)));
    }

    /// Returns [`None`] when the bundle file is absent or cannot be parsed (fallback path).
    pub fn bundle_for_repo_root(&self, repo_root: &str) -> Option<Arc<PolicyBundle>> {
        let key = Path::new(repo_root).to_string_lossy().to_string();
        {
            let guard = self.cache.read().expect("policy bundle cache poisoned");
            if let Some(hit) = guard.get(&key) {
                return hit.clone();
            }
        }
        let path = Path::new(repo_root).join(".derived/policy-bundles/policy-bundle.json");
        let loaded = load_bundle_file(&path).map(Arc::new);
        self.cache
            .write()
            .expect("policy bundle cache poisoned")
            .insert(key, loaded.clone());
        loaded
    }
}

fn load_bundle_file(path: &Path) -> Option<PolicyBundle> {
    if !path.is_file() {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    let constitution: Vec<PolicyRule> =
        serde_json::from_value(v.get("constitution")?.clone()).ok()?;
    let shards: BTreeMap<String, Vec<PolicyRule>> =
        serde_json::from_value(v.get("shards")?.clone()).ok()?;
    Some(PolicyBundle {
        constitution,
        shards,
    })
}

fn active_shard_scopes_from_env() -> Vec<String> {
    std::env::var("OPC_POLICY_ACTIVE_SHARDS")
        .ok()
        .map(|s| {
            s.split(',')
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Builds a [`ToolCallContext`] for kernel evaluation from MCP tool arguments (NF-003: host supplies all inputs).
pub fn build_tool_call_context(tool_name: &str, args: &Map<String, Value>) -> ToolCallContext {
    let arguments_summary =
        serde_json::to_string(&Value::Object(args.clone())).unwrap_or_else(|_| "{}".into());
    let mut proposed_file_content = None;
    for key in ["content", "patch", "text", "body"] {
        if let Some(Value::String(s)) = args.get(key) {
            proposed_file_content = Some(s.clone());
            break;
        }
    }
    let diff_lines = proposed_file_content
        .as_ref()
        .map(|s| s.lines().count() as u32);
    let diff_bytes = proposed_file_content.as_ref().map(|s| s.len() as u64);
    ToolCallContext {
        tool_name: tool_name.to_string(),
        arguments_summary,
        proposed_file_content,
        diff_lines,
        diff_bytes,
        active_shard_scopes: active_shard_scopes_from_env(),
        // Spec 093: populated by caller when featuregraph context is available.
        feature_ids: vec![],
        max_spec_risk: None,
        spec_statuses: vec![],
        spec_impl_statuses: vec![],
    }
}

/// Runs policy kernel evaluation when a bundle is present; [`None`] means allow (or no bundle).
pub fn evaluate_loaded_policy(
    bundle: &PolicyBundle,
    ctx: &ToolCallContext,
) -> Option<PolicyDecision> {
    let d = evaluate(ctx, bundle);
    match d.outcome {
        PolicyOutcome::Allow => None,
        PolicyOutcome::Deny | PolicyOutcome::Degrade => Some(d),
    }
}
