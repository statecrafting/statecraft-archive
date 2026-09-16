// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use axiomregent::agent_tools::AgentTools;
use axiomregent::feature_tools::FeatureTools;

use axiomregent::router::JsonRpcRequest;
use axiomregent::workspace::WorkspaceTools;
use serde_json::json;
use std::sync::Arc;
use tempfile::TempDir;

mod test_helpers;
use test_helpers::make_router;

/// Create a self-contained test workspace with a minimal sharded spec registry so
/// the featuregraph scanner can initialise without requiring `spec-spine compile`.
/// Spec 217: the scanner reads the per-unit `by-spec/<id>.json` shards via
/// `load_committed_registry`, not the retired monolithic `registry.json`.
fn create_test_workspace() -> TempDir {
    let dir = TempDir::new().expect("failed to create temp dir");
    let by_spec = dir.path().join(".derived/spec-registry/by-spec");
    std::fs::create_dir_all(&by_spec).unwrap();
    std::fs::write(
        by_spec.join("test-feature.json"),
        r#"{"specVersion":"1.1.0","shardHash":"0","record":{"authors":["open-agentic-platform"],"created":"2026-01-01","domain":"tooling","extraFrontmatter":{"language":"en"},"featureBranch":"test-feature","id":"test-feature","implementation":"complete","kind":"platform-delivery","sectionHeadings":["Test Feature"],"specPath":"specs/test-feature/spec.md","status":"approved","summary":"Test feature for the featuregraph scanner.","title":"Test Feature"}}"#,
    )
    .unwrap();
    // Create a dummy source file so features.impact has something to scan
    let src_dir = dir.path().join("src");
    std::fs::create_dir_all(&src_dir).unwrap();
    std::fs::write(
        src_dir.join("feature_tools.rs"),
        "// Feature: test-feature\nfn main() {}\n",
    )
    .unwrap();
    dir
}

async fn create_router(db_dir: &std::path::Path) -> axiomregent::router::Router {
    let (client, lease_store) = test_helpers::make_client_and_lease_store(db_dir).await;

    let workspace_tools = Arc::new(WorkspaceTools::new(lease_store.clone()));
    let featuregraph_tools = Arc::new(axiomregent::featuregraph::tools::FeatureGraphTools::new());
    let feature_tools = Arc::new(FeatureTools::new());
    let xray_tools = Arc::new(axiomregent::xray::tools::XrayTools::new());
    let agent_tools = Arc::new(AgentTools::new(
        workspace_tools.clone(),
        feature_tools.clone(),
    ));

    let root = std::env::current_dir().unwrap();
    let run_tools = Arc::new(axiomregent::run_tools::RunTools::new(client, &root));

    make_router(
        lease_store,
        workspace_tools,
        featuregraph_tools,
        xray_tools,
        agent_tools,
        run_tools,
    )
    .await
}

#[tokio::test]
async fn test_features_impact() {
    let workspace = create_test_workspace();
    let db_dir = tempfile::tempdir().unwrap();
    let router = create_router(db_dir.path()).await;

    let req = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        method: "tools/call".to_string(),
        params: Some(json!({
            "name": "features.impact",
            "arguments": {
                "repo_root": workspace.path().to_string_lossy(),
                "paths": ["src/feature_tools.rs"]
            }
        })),
        id: Some(json!(1)),
    };

    let resp = router.handle_request(&req).await;
    assert!(
        resp.error.is_none(),
        "features.impact should succeed, got error: {:?}",
        resp.error
    );

    let result = resp.result.unwrap();
    let content = result.get("content").unwrap().as_array().unwrap();
    let impact_json = content[0].get("json").unwrap();

    // The response should be an object with impacts, total_paths, affected_features
    assert!(
        impact_json.get("impacts").is_some(),
        "features.impact should include impacts field, got: {:?}",
        impact_json
    );
    assert!(
        impact_json.get("affected_features").is_some(),
        "features.impact should include affected_features field"
    );
}

#[tokio::test]
async fn test_gov_drift() {
    let workspace = create_test_workspace();
    let db_dir = tempfile::tempdir().unwrap();
    let router = create_router(db_dir.path()).await;

    let req = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        method: "tools/call".to_string(),
        params: Some(json!({
            "name": "gov.drift",
            "arguments": {
                "repo_root": workspace.path().to_string_lossy()
            }
        })),
        id: Some(json!(1)),
    };

    let resp = router.handle_request(&req).await;
    assert!(
        resp.error.is_none(),
        "gov.drift should succeed, got error: {:?}",
        resp.error
    );

    let result = resp.result.unwrap();
    let content = result.get("content").unwrap().as_array().unwrap();
    let drift_json = content[0].get("json").unwrap();

    // Response must include has_violations and violations fields
    assert!(
        drift_json.get("has_violations").is_some(),
        "gov.drift must include has_violations"
    );
    assert!(
        drift_json.get("violations").is_some(),
        "gov.drift must include violations array"
    );
}
