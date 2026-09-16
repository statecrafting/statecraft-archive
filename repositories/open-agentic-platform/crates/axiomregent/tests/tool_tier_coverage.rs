// Feature 036 — safety tier governance
// Asserts that every tool in the router's tools/list has an explicit tier assignment.
// Adding a tool to the router without classifying it in get_tool_tier() will fail this test.

use axiomregent::checkpoint::blobs::BlobStore as CheckpointBlobStore;
use axiomregent::checkpoint::provider::CheckpointProvider;
use axiomregent::checkpoint::store::CheckpointStore;
use axiomregent::router::legacy_provider::LegacyToolProvider;
use axiomregent::router::provider::ToolProvider;
use axiomregent::router::{JsonRpcRequest, Router};
use serde_json::json;
use std::collections::HashSet;
use std::sync::Arc;

mod test_helpers;

async fn create_router() -> Router {
    let db_dir = tempfile::tempdir().unwrap();
    let (client, lease_store) = test_helpers::make_client_and_lease_store(db_dir.path()).await;

    let workspace_tools = Arc::new(axiomregent::workspace::WorkspaceTools::new(
        lease_store.clone(),
    ));
    let featuregraph_tools = Arc::new(axiomregent::featuregraph::tools::FeatureGraphTools::new());
    let feature_tools = Arc::new(axiomregent::feature_tools::FeatureTools::new());
    let xray_tools = Arc::new(axiomregent::xray::tools::XrayTools::new());
    let agent_tools = Arc::new(axiomregent::agent_tools::AgentTools::new(
        workspace_tools.clone(),
        feature_tools.clone(),
    ));
    let root = std::env::current_dir().unwrap();
    let run_tools = Arc::new(axiomregent::run_tools::RunTools::new(client.clone(), &root));

    let legacy: Arc<dyn ToolProvider> = Arc::new(LegacyToolProvider {
        workspace_tools,
        featuregraph_tools,
        xray_tools,
        agent_tools,
        run_tools,
    });

    let checkpoint_blobs =
        CheckpointBlobStore::new(db_dir.path().join("blobs").join("checkpoints"))
            .expect("CheckpointBlobStore init");
    let checkpoint_store = Arc::new(CheckpointStore::new(client, checkpoint_blobs));
    let checkpoint_provider: Arc<dyn ToolProvider> =
        Arc::new(CheckpointProvider::new(checkpoint_store));

    let providers: Vec<Arc<dyn ToolProvider>> = vec![legacy, checkpoint_provider];

    // Forget TempDir to keep it alive for the router's lifetime
    std::mem::forget(db_dir);

    Router::new(providers, lease_store, None).await
}

#[tokio::test]
async fn every_router_tool_has_explicit_tier() {
    let router = create_router().await;

    // Get tools/list response
    let req = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        method: "tools/list".to_string(),
        params: None,
        id: Some(json!(1)),
    };
    let resp = router.handle_request(&req).await;
    let result = resp.result.expect("tools/list should return result");
    let tools = result["tools"]
        .as_array()
        .expect("tools should be an array");

    let router_tool_names: HashSet<&str> = tools
        .iter()
        .map(|t| t["name"].as_str().expect("tool name should be string"))
        .collect();

    let classified: HashSet<&str> = agent::safety::explicitly_classified_tools()
        .iter()
        .copied()
        .collect();

    // Every router tool must be in the explicitly classified set
    let unclassified: Vec<&&str> = router_tool_names
        .iter()
        .filter(|name| !classified.contains(**name))
        .collect();

    assert!(
        unclassified.is_empty(),
        "FR-002 FAIL: The following router tools have no explicit tier assignment \
         (they fall through to the Tier3 catch-all). Add them to get_tool_tier() \
         in crates/agent/src/safety.rs:\n  {:?}",
        unclassified
    );

    // Sanity: classified set should cover all router tools
    eprintln!(
        "Tool tier coverage: {}/{} router tools explicitly classified",
        router_tool_names.len(),
        router_tool_names.len()
    );
}

#[tokio::test]
async fn explicitly_classified_tools_matches_router() {
    let router = create_router().await;

    // Get tools/list response
    let req = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        method: "tools/list".to_string(),
        params: None,
        id: Some(json!(1)),
    };
    let resp = router.handle_request(&req).await;
    let result = resp.result.expect("tools/list should return result");
    let tools = result["tools"]
        .as_array()
        .expect("tools should be an array");

    let router_tool_names: HashSet<&str> = tools
        .iter()
        .map(|t| t["name"].as_str().expect("tool name should be string"))
        .collect();

    let classified: HashSet<&str> = agent::safety::explicitly_classified_tools()
        .iter()
        .copied()
        .collect();

    // Every explicitly classified tool MUST exist in the router,
    // EXCEPT "write_file", which is a legacy alias kept for internal use.
    let missing_in_router: Vec<&&str> = classified
        .iter()
        .filter(|&&name| name != "write_file" && !router_tool_names.contains(name))
        .collect();

    assert!(
        missing_in_router.is_empty(),
        "The following tools are listed in explicitly_classified_tools() but DO NOT exist in the router:\n  {:?}",
        missing_in_router
    );
}
