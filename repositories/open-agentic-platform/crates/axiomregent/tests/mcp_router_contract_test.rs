// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use axiomregent::router::{JsonRpcRequest, Router};
use serde_json::json;
use std::sync::Arc;

mod test_helpers;
use test_helpers::make_router;

// Feature: MCP_ROUTER_CONTRACT
// Spec: spec/core/contract.md

#[tokio::test]
async fn test_router_contract_routing() {
    // Tools
    use axiomregent::workspace::WorkspaceTools;

    let dir = tempfile::tempdir().unwrap();
    let db_sub = dir.path().join("db");
    std::fs::create_dir_all(&db_sub).unwrap();
    let (client, lease_store) = test_helpers::make_client_and_lease_store(&db_sub).await;

    let workspace_tools = Arc::new(WorkspaceTools::new(lease_store.clone()));
    let featuregraph_tools = Arc::new(axiomregent::featuregraph::tools::FeatureGraphTools::new());
    let feature_tools = Arc::new(axiomregent::feature_tools::FeatureTools::new());
    let xray_tools = Arc::new(axiomregent::xray::tools::XrayTools::new());
    let agent_tools = Arc::new(axiomregent::agent_tools::AgentTools::new(
        workspace_tools.clone(),
        feature_tools.clone(),
    ));
    let run_tools = Arc::new(axiomregent::run_tools::RunTools::new(client, dir.path()));

    let router: Router = make_router(
        lease_store,
        workspace_tools,
        featuregraph_tools,
        xray_tools,
        agent_tools,
        run_tools,
    )
    .await;

    // 1. Unknown Method -> Error -32601
    let req = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        method: "unknown/method".to_string(),
        params: None,
        id: Some(json!(1)),
    };
    let resp = router.handle_request(&req).await;
    assert!(resp.error.is_some());
    let err = resp.error.unwrap();
    assert_eq!(err["code"], -32601);

    // 2. initialize -> OK
    let req = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        method: "initialize".to_string(),
        params: Some(json!({})),
        id: Some(json!(2)),
    };
    let resp = router.handle_request(&req).await;
    assert!(resp.result.is_some());
    let res = resp.result.unwrap();
    assert!(res["capabilities"].is_object());
    assert!(res["serverInfo"].is_object());
}
