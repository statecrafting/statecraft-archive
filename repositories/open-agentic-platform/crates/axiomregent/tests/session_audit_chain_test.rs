// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
//! Spec 207 FR-001/FR-002 (producer): the axiomregent router, when given a
//! session audit dir, hash-chains every governed tool-dispatch decision into a
//! rotating JSONL segment. This is the local session chain whose closed segment
//! heads the OPC duplex client submits for platform countersign (AC-4).
//!
//! The chain is the SAME shape the independent `verify_audit_chain` walker
//! validates, so a tampered record is evident offline (the run-cert /
//! countersign anchor closes the open-segment residual, FR-004).

use axiomregent::lease::{LeaseStore, PermissionGrants};
use axiomregent::router::legacy_provider::LegacyToolProvider;
use axiomregent::router::provider::ToolProvider;
use axiomregent::router::{JsonRpcRequest, Router};
use hiqlite::Client;
use open_agentic_policy_kernel::audit::{AuditChainError, verify_audit_chain};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;

/// Build a router whose session audit chain writes under `audit_dir`. Mirrors
/// the production provider wiring but pins a test-local audit dir (the shared
/// `make_router` helper passes `None`).
async fn router_with_audit(
    client: Client,
    lease_store: Arc<LeaseStore>,
    audit_dir: &Path,
) -> Router {
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
    let run_tools = Arc::new(axiomregent::run_tools::RunTools::new(client, Path::new(".")));
    let legacy = Arc::new(LegacyToolProvider {
        workspace_tools,
        featuregraph_tools,
        xray_tools,
        agent_tools,
        run_tools,
    });
    let providers: Vec<Arc<dyn ToolProvider>> = vec![legacy];
    let mut router = Router::new(providers, lease_store, None).await;
    router.set_audit_chain(audit_dir.to_path_buf());
    router
}

fn read_chain(path: &Path) -> Vec<Value> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("chain line is JSON"))
        .collect()
}

/// A `tools/call` that fails its grant check still records a dispatch decision;
/// the audit fires in `preflight_tool_permission` BEFORE execution, so a denial
/// is a deterministic record source that needs no repo or policy bundle.
fn write_file_call(id: i64) -> JsonRpcRequest {
    JsonRpcRequest {
        jsonrpc: "2.0".into(),
        method: "tools/call".into(),
        params: Some(json!({
            "name": "workspace.write_file",
            "arguments": { "repo_root": "/tmp", "path": "x", "content": "y" }
        })),
        id: Some(json!(id)),
    }
}

#[tokio::test]
async fn every_dispatch_is_hash_chained_and_verifies() {
    let db_dir = tempfile::tempdir().unwrap();
    let audit_dir = tempfile::tempdir().unwrap();
    let chain_path = audit_dir.path().join("permissions.jsonl");

    let client = axiomregent::db::init_hiqlite(db_dir.path())
        .await
        .expect("init_hiqlite");
    // Write disabled so each workspace.write_file is denied at the grant check;
    // the denial is what we want to chain (governed evidence per FR-001).
    let lease_store = Arc::new(LeaseStore::with_default_grants(
        client.clone(),
        PermissionGrants {
            enable_file_read: true,
            enable_file_write: false,
            enable_network: false,
            max_tier: 3,
        },
    ));
    let router = router_with_audit(client, lease_store, audit_dir.path()).await;

    // Two governed dispatches → two chained records.
    let r1 = router.handle_request(&write_file_call(1)).await;
    assert_eq!(
        r1.error.expect("denied").get("code"),
        Some(&json!("PERMISSION_DENIED"))
    );
    let r2 = router.handle_request(&write_file_call(2)).await;
    assert!(r2.error.is_some());

    let recs = read_chain(&chain_path);
    assert_eq!(recs.len(), 2, "one chained record per governed dispatch");
    assert_eq!(recs[0]["op"], "axiomregent.tool_audit");
    assert_eq!(recs[0]["tool"], "workspace.write_file");
    assert_eq!(recs[0]["decision"], "denied_no_lease");
    // Genesis-marked first record; record 1 binds record 0.
    assert!(
        recs[0]["previous_record_hash"]
            .as_str()
            .unwrap()
            .starts_with("genesis:")
    );
    assert_eq!(recs[1]["previous_record_hash"], recs[0]["record_hash"]);

    verify_audit_chain(&recs, None).expect("session dispatch chain verifies offline");

    // Tampering record 0 is evident against the independent walker (AC-1).
    let mut tampered = recs.clone();
    tampered[0]["decision"] = Value::String("allowed".into());
    assert_eq!(
        verify_audit_chain(&tampered, None).unwrap_err(),
        AuditChainError::RecordHashMismatch { index: 0 },
    );

    std::mem::forget(db_dir);
    std::mem::forget(audit_dir);
}

#[tokio::test]
async fn no_audit_dir_means_no_chain_file() {
    // Sanity: the producer is opt-in. A router built via the shared path
    // (audit_dir = None) writes no chain, so generic tests stay hermetic.
    let db_dir = tempfile::tempdir().unwrap();
    let audit_dir = tempfile::tempdir().unwrap();
    let chain_path = audit_dir.path().join("permissions.jsonl");

    let client = axiomregent::db::init_hiqlite(db_dir.path())
        .await
        .expect("init_hiqlite");
    let lease_store = Arc::new(LeaseStore::new(client.clone()));
    // Construct directly with audit_dir = None.
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
    let run_tools = Arc::new(axiomregent::run_tools::RunTools::new(client, Path::new(".")));
    let legacy = Arc::new(LegacyToolProvider {
        workspace_tools,
        featuregraph_tools,
        xray_tools,
        agent_tools,
        run_tools,
    });
    let providers: Vec<Arc<dyn ToolProvider>> = vec![legacy];
    // No set_audit_chain call → the producer stays off (default None).
    let router = Router::new(providers, lease_store, None).await;

    let _ = router.handle_request(&write_file_call(1)).await;
    assert!(
        !chain_path.exists(),
        "no audit dir → no chain file is created"
    );

    std::mem::forget(db_dir);
    std::mem::forget(audit_dir);
}
