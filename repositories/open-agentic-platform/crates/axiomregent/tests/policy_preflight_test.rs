//! 047 Phase 6: policy kernel runs after permission grants; `POLICY_DENIED` is distinct from `PERMISSION_DENIED`.

use axiomregent::lease::{LeaseStore, PermissionGrants};
use axiomregent::router::{JsonRpcRequest, Router};
use hiqlite::Client;
use serde_json::json;
use std::collections::BTreeMap;
use std::sync::Arc;

use open_agentic_policy_kernel::{PolicyBundle, PolicyRule};

mod test_helpers;
use test_helpers::make_router;

async fn router_with_lease(client: Client, lease_store: Arc<LeaseStore>) -> Router {
    let workspace_tools = Arc::new(axiomregent::workspace::WorkspaceTools::new(
        lease_store.clone(),
    ));
    let featuregraph_tools = Arc::new(axiomregent::featuregraph::tools::FeatureGraphTools::new());
    let xray_tools = Arc::new(axiomregent::xray::tools::XrayTools::new());
    let feature_tools = Arc::new(axiomregent::feature_tools::FeatureTools::new());
    let agent_tools = Arc::new(axiomregent::agent_tools::AgentTools::new(
        workspace_tools.clone(),
        feature_tools.clone(),
    ));
    let run_tools = Arc::new(axiomregent::run_tools::RunTools::new(
        client,
        std::path::Path::new("."),
    ));
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

async fn minimal_router() -> Router {
    let db_dir = tempfile::tempdir().unwrap();
    let (client, lease_store) = test_helpers::make_client_and_lease_store(db_dir.path()).await;
    // Keep db_dir alive by leaking it for this test (short-lived)
    std::mem::forget(db_dir);
    router_with_lease(client, lease_store).await
}

#[tokio::test]
async fn policy_denied_wire_code_when_allowlist_excludes_tool() {
    let tmp = tempfile::TempDir::new().expect("tmp");
    let repo = tmp.path();
    std::fs::create_dir_all(repo.join(".derived/policy-bundles")).expect("dirs");
    let bundle = PolicyBundle {
        constitution: vec![PolicyRule {
            id: "AL-1".into(),
            description: "restrict tools".into(),
            mode: "enforce".into(),
            scope: "global".into(),
            gate: Some("tool_allowlist".into()),
            source_path: "CLAUDE.md".into(),
            allow_destructive: None,
            allowed_tools: Some(vec!["gov.preflight".into()]),
            max_diff_lines: None,
            max_diff_bytes: None,
        }],
        shards: BTreeMap::new(),
    };
    let json = serde_json::json!({
        "policyBundleVersion": "1",
        "constitution": bundle.constitution,
        "shards": bundle.shards,
    });
    std::fs::write(
        repo.join(".derived/policy-bundles/policy-bundle.json"),
        serde_json::to_vec_pretty(&json).expect("json"),
    )
    .expect("write bundle");

    let router = minimal_router().await;
    let repo_str = repo.to_str().expect("utf8");
    let req = JsonRpcRequest {
        jsonrpc: "2.0".into(),
        method: "tools/call".into(),
        params: Some(json!({
            "name": "features.impact",
            "arguments": {
                "repo_root": repo_str,
                "paths": ["src/lib.rs"]
            }
        })),
        id: Some(json!(1)),
    };
    let resp = router.handle_request(&req).await;
    let err = resp.error.expect("expected policy denial");
    assert_eq!(err.get("code"), Some(&json!("POLICY_DENIED")));
}

#[tokio::test]
async fn permission_denied_still_permission_code() {
    let db_dir = tempfile::tempdir().unwrap();
    let client = axiomregent::db::init_hiqlite(db_dir.path()).await.unwrap();
    let lease_store = Arc::new(LeaseStore::with_default_grants(
        client.clone(),
        PermissionGrants {
            enable_file_read: true,
            enable_file_write: false,
            enable_network: false,
            max_tier: 3,
        },
    ));
    let router = router_with_lease(client, lease_store).await;
    let req = JsonRpcRequest {
        jsonrpc: "2.0".into(),
        method: "tools/call".into(),
        params: Some(json!({
            "name": "workspace.write_file",
            "arguments": {
                "repo_root": "/tmp",
                "path": "x",
                "content": "y"
            }
        })),
        id: Some(json!(2)),
    };
    let resp = router.handle_request(&req).await;
    let err = resp.error.expect("expected permission error");
    assert_eq!(err.get("code"), Some(&json!("PERMISSION_DENIED")));
}
