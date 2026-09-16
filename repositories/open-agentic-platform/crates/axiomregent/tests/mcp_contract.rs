// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use axiomregent::agent_tools::AgentTools;
use axiomregent::feature_tools::FeatureTools;
use axiomregent::router::{JsonRpcRequest, Router};
use axiomregent::workspace::WorkspaceTools;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use tempfile::tempdir;

mod test_helpers;
use test_helpers::make_router;

async fn make_test_router(dir: &std::path::Path) -> Router {
    let db_sub = dir.join("db");
    std::fs::create_dir_all(&db_sub).unwrap();
    let (client, lease_store) = test_helpers::make_client_and_lease_store(&db_sub).await;

    let workspace_tools = Arc::new(WorkspaceTools::new(lease_store.clone()));
    let featuregraph_tools = Arc::new(axiomregent::featuregraph::tools::FeatureGraphTools::new());
    let feature_tools = Arc::new(FeatureTools::new());
    let xray_tools = Arc::new(axiomregent::xray::tools::XrayTools::new());
    let agent_tools = Arc::new(AgentTools::new(
        workspace_tools.clone(),
        feature_tools.clone(),
    ));
    let run_tools = Arc::new(axiomregent::run_tools::RunTools::new(client, dir));

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
async fn test_mcp_tools_list_contract() {
    // 1. Setup minimal harness
    let dir = tempdir().unwrap();
    let router = make_test_router(dir.path()).await;

    // 2. Call tools/list
    let req = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        method: "tools/list".to_string(),
        params: None,
        id: Some(json!(1)),
    };
    let resp = router.handle_request(&req).await;

    assert!(resp.error.is_none());
    let result = resp.result.unwrap();

    // 3. Serialize and save/compare (Golden test)
    // Sort tools by name for deterministic comparison (HashMap iteration order varies).
    let mut result_sorted = result.clone();
    if let Some(tools) = result_sorted
        .as_object_mut()
        .and_then(|o| o.get_mut("tools"))
        && let Some(arr) = tools.as_array_mut()
    {
        arr.sort_by(|a, b| {
            let a_name = a.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let b_name = b.get("name").and_then(|n| n.as_str()).unwrap_or("");
            a_name.cmp(b_name)
        });
    }
    let actual_json = serde_json::to_string_pretty(&result_sorted).unwrap();

    let golden_path = PathBuf::from("tests/golden/tools_list.json");

    // If UPDATE_GOLDEN env var is set, update the golden file
    if std::env::var("UPDATE_GOLDEN").is_ok() {
        std::fs::write(&golden_path, &actual_json).unwrap();
    }

    // If golden file exists, compare
    if golden_path.exists() {
        let expected = std::fs::read_to_string(&golden_path).unwrap();
        let expected = expected.replace("\r\n", "\n");
        let actual = actual_json.replace("\r\n", "\n");

        assert_eq!(
            expected, actual,
            "Protocol contract mismatch! Run with UPDATE_GOLDEN=1 to update."
        );
    } else {
        // First run initialization
        std::fs::write(&golden_path, &actual_json).unwrap();
    }
}
