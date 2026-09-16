use featuregraph::enrichment::enrich_features_with_metrics;
use featuregraph::preflight::compute_blast_radius;
use featuregraph::scanner::Scanner;
use featuregraph::tools::FeatureGraphTools;
use serde::Serialize;
use serde_json::{Value, json};
use specta::Type;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::command;
use xray::scan_target;

#[command]
pub async fn xray_scan_project(path: String) -> Result<serde_json::Value, String> {
    let target = PathBuf::from(&path);
    let index = scan_target(&target, None).map_err(|e| e.to_string())?;
    serde_json::to_value(&index).map_err(|e| e.to_string())
}

/// Governance + inspect: compiled **registry** summary plus **featuregraph** scan.
/// The graph scan prefers `build/spec-registry/registry.json` (via `spec-compiler`), then `spec/features.yaml` — see `featuregraph::scanner::Scanner::scan`.
#[command]
pub async fn featuregraph_overview(
    features_yaml_path: String,
) -> Result<serde_json::Value, String> {
    let repo_root = resolve_repo_root(&features_yaml_path);
    // Spec 217 engine swap: the committed registry is the sharded `by-spec`
    // tree, read via the spec-spine library from repo_root.
    let registry_path = repo_root.join(".derived/spec-registry/by-spec");

    let registry = match read_registry_summary(&repo_root) {
        Ok(summary) => json!({
            "status": "ok",
            "path": registry_path,
            "summary": summary,
        }),
        Err(err) => json!({
            "status": "unavailable",
            "path": registry_path,
            "message": err,
        }),
    };

    let fg_tools = FeatureGraphTools::new();
    let featuregraph = match fg_tools.features_overview(&repo_root, None) {
        Ok(graph) => {
            let feature_count = graph
                .get("features")
                .and_then(Value::as_array)
                .map(|items| items.len())
                .unwrap_or(0);
            let violations_count = graph
                .get("violations")
                .and_then(Value::as_array)
                .map(|items| items.len())
                .unwrap_or(0);

            json!({
                "status": "ok",
                "summary": {
                    "featureCount": feature_count,
                    "violationsCount": violations_count,
                },
            })
        }
        Err(err) => json!({
            "status": "unavailable",
            "message": err.to_string(),
        }),
    };

    let overall_status = if registry["status"] == "ok" && featuregraph["status"] == "ok" {
        "success"
    } else {
        "degraded"
    };

    Ok(json!({
        "status": overall_status,
        "repoRoot": repo_root,
        "registry": registry,
        "featuregraph": featuregraph,
    }))
}

/// Read-only labels for safety tiers (governance UI).
/// Change tiers: `featuregraph::preflight::ChangeTier` (classifies file changes).
/// Tool tiers: `agent::safety::ToolTier` (classifies MCP tool dispatch).
#[derive(Debug, Clone, Serialize, Type)]
pub struct SafetyTierRef {
    pub id: String,
    pub label: String,
    pub description: String,
}

#[command]
#[specta::specta]
pub fn get_preflight_safety_tier_reference() -> Vec<SafetyTierRef> {
    vec![
        SafetyTierRef {
            id: "tier1".into(),
            label: "Tier 1".into(),
            description: "Autonomous".into(),
        },
        SafetyTierRef {
            id: "tier2".into(),
            label: "Tier 2".into(),
            description: "Gated".into(),
        },
        SafetyTierRef {
            id: "tier3".into(),
            label: "Tier 3".into(),
            description: "Manual".into(),
        },
    ]
}

/// Per-tool tier assignments for governance UI (Feature 036).
#[derive(Debug, Clone, Serialize, Type)]
pub struct ToolTierEntry {
    pub tool: String,
    pub tier: String,
}

#[command]
#[specta::specta]
pub fn get_tool_tier_assignments() -> Vec<ToolTierEntry> {
    agent::safety::explicitly_classified_tools()
        .iter()
        .map(|name| ToolTierEntry {
            tool: name.to_string(),
            tier: agent::safety::get_tool_tier(name).as_str().to_string(),
        })
        .collect()
}

/// Spec 093 — Governance preflight: given a set of changed files, returns safety tier,
/// affected features, and violations from the featuregraph preflight checker.
#[command]
pub async fn governance_preflight(
    changed_files: Vec<String>,
    repo_root: String,
) -> Result<serde_json::Value, String> {
    let root = resolve_repo_root(&repo_root);
    let fg_tools = FeatureGraphTools::new();
    let request = json!({
        "intent": "edit",
        "mode": "worktree",
        "changed_paths": changed_files,
    });
    let preflight = fg_tools
        .governance_preflight(&root, request)
        .map_err(|e| e.to_string())?;

    // Enrich with affected feature details from impact analysis
    let impact = fg_tools
        .features_impact(&root.to_string_lossy(), &changed_files)
        .map_err(|e| e.to_string())?;

    // Spec 096 Slice 4: enrich with blast radius when xray scan available
    let blast_radius = match scan_target(&root, None) {
        Ok(index) => {
            let scanner = featuregraph::scanner::Scanner::new(&root);
            match scanner.scan() {
                Ok(graph) => {
                    let br = compute_blast_radius(&graph, &index, &changed_files);
                    Some(serde_json::to_value(&br).unwrap_or(Value::Null))
                }
                Err(_) => None,
            }
        }
        Err(_) => None,
    };

    Ok(json!({
        "preflight": preflight,
        "impact": impact,
        "blastRadius": blast_radius,
    }))
}

/// Spec 096 Slice 3: Governance drift detection — returns features with violations
/// (e.g., `// Feature:` headers that don't match any registry entry).
#[command]
pub async fn governance_drift(repo_root: String) -> Result<serde_json::Value, String> {
    let root = resolve_repo_root(&repo_root);
    let fg_tools = FeatureGraphTools::new();
    fg_tools.governance_drift(&root).map_err(|e| e.to_string())
}

/// Spec 096 Slice 4 — Portfolio overview: enriched feature list with structural metrics.
#[command]
pub async fn portfolio_overview(repo_root: String) -> Result<serde_json::Value, String> {
    let root = resolve_repo_root(&repo_root);

    let scanner = Scanner::new(&root);
    let graph = scanner.scan().map_err(|e| e.to_string())?;

    let index = scan_target(&root, None).map_err(|e| e.to_string())?;
    let features = enrich_features_with_metrics(&graph, &index);

    // Compute aggregates.
    let total_features = features.len();
    let total_loc: u64 = features.iter().map(|f| f.total_loc).sum();
    let avg_test_coverage = if total_features > 0 {
        features.iter().map(|f| f.test_coverage_ratio).sum::<f64>() / total_features as f64
    } else {
        0.0
    };

    let mut by_status: HashMap<String, usize> = HashMap::new();
    let mut by_risk: HashMap<String, usize> = HashMap::new();
    for f in &features {
        *by_status.entry(f.status.clone()).or_default() += 1;
        // Derive risk from complexity + test coverage.
        let risk = if f.max_complexity > 20 && f.test_coverage_ratio < 0.1 {
            "high"
        } else if f.max_complexity > 10 || f.test_coverage_ratio < 0.2 {
            "medium"
        } else {
            "low"
        };
        *by_risk.entry(risk.to_string()).or_default() += 1;
    }

    Ok(json!({
        "features": features,
        "aggregates": {
            "totalFeatures": total_features,
            "totalLoc": total_loc,
            "avgTestCoverage": avg_test_coverage,
            "byStatus": by_status,
            "byRisk": by_risk,
        },
    }))
}

#[command]
pub async fn featuregraph_impact(
    file_paths: Vec<String>,
    features_yaml_path: String,
) -> Result<serde_json::Value, String> {
    let repo_root = resolve_repo_root(&features_yaml_path);
    let fg_tools = FeatureGraphTools::new();
    fg_tools
        .features_impact(&repo_root.to_string_lossy(), &file_paths)
        .map_err(|e| e.to_string())
}

fn resolve_repo_root(input: &str) -> PathBuf {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    }
    PathBuf::from(trimmed)
}

/// Load the spec-spine config for `repo_root` (spec 217 engine swap): reads the
/// committed `spec-spine.toml` when present, else `Config::default()`.
fn load_spec_spine_config(repo_root: &Path) -> spec_spine_types::Config {
    std::fs::read_to_string(repo_root.join("spec-spine.toml"))
        .ok()
        .and_then(|src| spec_spine_types::load_config(&src).ok())
        .unwrap_or_default()
}

/// Serialize the typed `Status` enum to its lowercase string form (the keys the
/// governance UI expects), matching what the in-tree reader emitted as a string.
fn status_str(status: &spec_spine_types::Status) -> String {
    serde_json::to_value(status)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_else(|| "unknown".to_string())
}

fn read_registry_summary(repo_root: &Path) -> Result<Value, String> {
    // Spec 217 engine swap: read the committed registry shards
    // (`.derived/spec-registry/by-spec/*.json`) via the spec-spine library
    // instead of the in-tree monolithic registry.json reader. The library
    // assembles the typed `Registry` from the shard tree under repo_root.
    let cfg = load_spec_spine_config(repo_root);
    let registry = spec_spine_core::load_committed_registry(&cfg, repo_root)
        .map_err(|e| format!("Failed reading registry: {e}"))?;

    let validation_passed = registry.validation.passed;
    let violations_count = registry.validation.violations.len();

    let mut status_counts = serde_json::Map::new();
    for f in &registry.specs {
        let status = status_str(&f.status);
        let prev = status_counts
            .get(&status)
            .and_then(Value::as_u64)
            .unwrap_or(0);
        status_counts.insert(status, Value::from(prev + 1));
    }

    let mut feature_summaries = Vec::new();
    for f in &registry.specs {
        if f.spec_path.is_empty() {
            continue;
        }
        feature_summaries.push(json!({
            "id": f.id,
            "title": f.title,
            "specPath": f.spec_path,
        }));
    }

    Ok(json!({
        "featureCount": registry.specs.len(),
        "validationPassed": validation_passed,
        "violationsCount": violations_count,
        "statusCounts": status_counts,
        "featureSummaries": feature_summaries,
    }))
}

#[cfg(test)]
mod tests {
    use super::read_registry_summary;
    use std::path::Path;

    /// Repo root from the crate manifest (src-tauri is 4 levels deep), so the
    /// test is independent of cargo's working directory.
    fn repo_root() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..")
    }

    #[test]
    fn read_registry_summary_parses_counts_from_committed_shards() {
        let root = repo_root();
        if !root.join(".derived/spec-registry/by-spec").is_dir() {
            return; // shards absent (fresh clone) -> skip
        }
        let summary = read_registry_summary(&root).expect("summary");
        assert!(summary["featureCount"].as_u64().unwrap() >= 200);
        assert_eq!(summary["validationPassed"], true);
        // Lowercase status keys are preserved through the typed-enum round-trip.
        assert!(summary["statusCounts"]["approved"].as_u64().unwrap() > 0);
        let fs = summary["featureSummaries"]
            .as_array()
            .expect("featureSummaries");
        assert!(!fs.is_empty());
        assert!(fs[0]["specPath"].as_str().unwrap().starts_with("specs/"));
    }

    #[test]
    fn read_registry_summary_errors_without_shards() {
        // A bare tempdir has no committed shards, so the library read fails.
        let dir = tempfile::tempdir().expect("tempdir");
        let err = read_registry_summary(dir.path()).expect_err("expected error");
        assert!(err.contains("Failed reading registry"), "got: {err}");
    }
}
