// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use axiomregent::router::JsonRpcRequest;
use axiomregent::workspace::WorkspaceTools;
use serde_json::json;
use std::fs;
use std::sync::Arc;

mod test_helpers;
use test_helpers::make_router;

#[tokio::test]
async fn test_agent_verify_flow() {
    let dir = tempfile::tempdir().unwrap();
    let repo_root = dir.path().to_path_buf();

    // Init git repo for drift check
    std::process::Command::new("git")
        .arg("init")
        .current_dir(&repo_root)
        .output()
        .expect("Failed to init git");

    // Setup Storage
    let db_dir = tempfile::tempdir().unwrap();
    let (client, lease_store) = test_helpers::make_client_and_lease_store(db_dir.path()).await;

    let workspace_tools = Arc::new(WorkspaceTools::new(lease_store.clone()));

    let featuregraph_tools = Arc::new(axiomregent::featuregraph::tools::FeatureGraphTools::new());
    let feature_tools = Arc::new(axiomregent::feature_tools::FeatureTools::new());
    let xray_tools = Arc::new(axiomregent::xray::tools::XrayTools::new());
    let agent_tools = Arc::new(axiomregent::agent_tools::AgentTools::new(
        workspace_tools.clone(),
        feature_tools.clone(),
    ));
    let run_tools = Arc::new(axiomregent::run_tools::RunTools::new(client, &repo_root));

    let router = make_router(
        lease_store,
        workspace_tools,
        featuregraph_tools,
        xray_tools,
        agent_tools,
        run_tools,
    )
    .await;

    // 1. Setup Repo State
    // Create spec/verification.yaml
    let spec_dir = repo_root.join("spec");
    fs::create_dir(&spec_dir).unwrap();

    let verification_yaml = r#"
version: 1
defaults:
  workdir: "."
  timeout_ms: 1000
  network: "deny"
  read_only: "tracked"
profiles:
  pr:
    include:
      - verify.test
skills:
  verify.test:
    description: "Git version check"
    determinism: "D0"
    tier: 1
    steps:
      - name: "git_version"
        cmd: ["git", "--version"]
        timeout_ms: 5000
    "#;
    fs::write(spec_dir.join("verification.yaml"), verification_yaml).unwrap();

    // Create Changeset
    let changeset_id = "001_verify_test";
    let changes_dir = repo_root.join("changes").join(changeset_id);
    fs::create_dir_all(&changes_dir).unwrap();

    // 05-status.json (executed)
    let status_json = json!({
        "schema_version": "v1",
        "state": "executed",
        "validation": { "state": "valid", "checks": [] },
        "execution": {
             "state": "completed",
             "steps_completed": 1,
             "error": null,
             "log": []
        }
    });
    fs::write(
        changes_dir.join("05-status.json"),
        serde_json::to_vec(&status_json).unwrap(),
    )
    .unwrap();

    // Gitignore all data store files so snapshot operations don't pollute drift detection.
    // Store::new with data_dir=repo_root creates store.sqlite and blobs/ directly in the repo root.
    fs::write(
        repo_root.join(".gitignore"),
        ".axiomregent/\nstore.sqlite\nblobs/\n",
    )
    .unwrap();

    // Commit all files to make repo clean
    std::process::Command::new("git")
        .args(["config", "user.email", "test@example.com"])
        .current_dir(&repo_root)
        .output()
        .expect("Failed to set user.email");
    std::process::Command::new("git")
        .args(["config", "user.name", "Test User"])
        .current_dir(&repo_root)
        .output()
        .expect("Failed to set user.name");
    std::process::Command::new("git")
        .args(["add", "."])
        .current_dir(&repo_root)
        .output()
        .expect("Failed to git add");
    std::process::Command::new("git")
        .args(["commit", "-m", "Initial"])
        .current_dir(&repo_root)
        .output()
        .expect("Failed to git commit");

    // 2. Call agent.verify
    let req = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        method: "tools/call".to_string(),
        params: Some(json!({
            "name": "agent.verify",
            "arguments": {
                "repo_root": repo_root.to_str().unwrap(),
                "changeset_id": changeset_id,
                "profile": "pr"
            }
        })),
        id: Some(json!(1)),
    };

    let resp = router.handle_request(&req).await;

    // Check for error first
    if let Some(err) = &resp.error {
        panic!("Tool call failed: {:?}", err);
    }

    assert!(resp.result.is_some());
    let res = resp.result.unwrap();
    let content = &res["content"][0]["json"];
    assert_eq!(content["status"], "verified");

    // 3. Verify Artifacts
    let verify_dir = changes_dir.join("verify");
    assert!(verify_dir.exists());

    let artifact_path = verify_dir.join("verify.test.json");
    if !artifact_path.exists() {
        // Maybe name sanitization changed?
        // skill id "verify.test" -> "verify.test.json" or "verify_test.json"?
        // Code: skill_id.replace("/", "_")
        // "verify.test" -> "verify.test".
        // So it should be verify.test.json
        let files: Vec<_> = fs::read_dir(&verify_dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        panic!(
            "Artifact verify.test.json not found in {:?}. Found: {:?}",
            verify_dir, files
        );
    }

    let artifact_bytes = fs::read(&artifact_path).unwrap();
    let artifact: serde_json::Value = serde_json::from_slice(&artifact_bytes).unwrap();

    assert_eq!(artifact["skill"], "verify.test");
    assert_eq!(artifact["summary"]["overall_exit_code"], 0);

    // Check steps
    let steps = artifact["steps"].as_array().unwrap();
    assert_eq!(steps.len(), 1);
    assert_eq!(steps[0]["name"], "git_version");
    // "echo test_verify" should output "test_verify\n" ideally, but ConstrainedRunner might capture it.
    // Check stdout_preview if available (truncated/utf8).

    // 4. Verify Status Update
    let status_bytes = fs::read(changes_dir.join("05-status.json")).unwrap();
    let status: serde_json::Value = serde_json::from_slice(&status_bytes).unwrap();

    assert!(status["verification"].is_object());
    assert_eq!(status["verification"]["last_run"]["outcome"], "passed");
}
