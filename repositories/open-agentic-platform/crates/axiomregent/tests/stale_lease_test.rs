// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use axiomregent::agent_tools::AgentTools;
use axiomregent::feature_tools::FeatureTools;
use axiomregent::router::JsonRpcRequest;
use axiomregent::workspace::WorkspaceTools;
use serde_json::json;
use std::process::Command;
use std::sync::Arc;
use tempfile::TempDir;

mod test_helpers;
use test_helpers::make_router;

fn setup_repo() -> TempDir {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();

    // Ignore output to avoid clogging test logs
    let _ = Command::new("git")
        .arg("init")
        .current_dir(root)
        .output()
        .unwrap();
    let _ = Command::new("git")
        .arg("config")
        .arg("user.email")
        .arg("test@example.com")
        .current_dir(root)
        .output()
        .unwrap();
    let _ = Command::new("git")
        .arg("config")
        .arg("user.name")
        .arg("Test")
        .current_dir(root)
        .output()
        .unwrap();

    // Create initial commit
    std::fs::write(root.join("file.txt"), "initial").unwrap();
    // Use proper git commands
    let _ = Command::new("git")
        .args(["add", "."])
        .current_dir(root)
        .output()
        .unwrap();
    let _ = Command::new("git")
        .args(["commit", "-m", "initial"])
        .current_dir(root)
        .output()
        .unwrap();

    dir
}

#[tokio::test]
async fn test_stale_lease_error_structure() {
    let repo = setup_repo();
    let repo_path = repo.path().to_str().unwrap();

    let db_dir = tempfile::tempdir().unwrap();
    let (client, lease_store) = test_helpers::make_client_and_lease_store(db_dir.path()).await;

    let workspace_tools = Arc::new(WorkspaceTools::new(lease_store.clone()));
    let featuregraph_tools = Arc::new(axiomregent::featuregraph::tools::FeatureGraphTools::new());
    let feature_tools = Arc::new(FeatureTools::new());
    let xray_tools = Arc::new(axiomregent::xray::tools::XrayTools::new());
    let agent_tools = Arc::new(AgentTools::new(
        workspace_tools.clone(),
        feature_tools.clone(),
    ));
    let run_tools = Arc::new(axiomregent::run_tools::RunTools::new(client, repo.path()));

    let router = make_router(
        lease_store.clone(),
        workspace_tools,
        featuregraph_tools,
        xray_tools,
        agent_tools,
        run_tools,
    )
    .await;

    // 1. Issue a lease directly via LeaseStore
    let fp = axiomregent::lease::Fingerprint::compute(repo.path())
        .await
        .unwrap();
    let lease_id = lease_store.issue(fp).await.unwrap();

    // 2. Modify repo (commit a change to change HEAD oid) — makes lease stale
    std::fs::write(repo.path().join("new_file.txt"), "modified").unwrap();
    let _ = Command::new("git")
        .args(["add", "."])
        .current_dir(repo.path())
        .output()
        .unwrap();
    let _ = Command::new("git")
        .args(["commit", "-m", "update"])
        .current_dir(repo.path())
        .output()
        .unwrap();

    // 3. Try to write a file with the stale lease — should trigger STALE_LEASE error
    // Write content to a temp file for testing
    std::fs::write(repo.path().join("test_write.txt"), "content").unwrap();
    let req2 = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        method: "tools/call".to_string(),
        params: Some(json!({
            "name": "workspace.write_file",
            "arguments": {
                "repo_root": repo_path,
                "path": "test_write.txt",
                "content_base64": "new content",
                "lease_id": lease_id
            }
        })),
        id: Some(json!(2)),
    };
    let resp2 = router.handle_request(&req2).await;

    // 4. Expect Error
    let err = resp2.error.expect("Should return error for stale lease");
    println!("Error details: {:?}", err);

    assert_eq!(err["code"], "STALE_LEASE");
    assert_eq!(err["message"], "Lease is stale (repo changed)");
    let data = &err["data"];
    assert!(data["current_fingerprint"].is_object());
    assert!(data["current_fingerprint"]["head_oid"].is_string());
    assert_eq!(data["lease_id"], lease_id);
}
