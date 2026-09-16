// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/186-sandbox-k8s-backend/spec.md — §4 SC-001..SC-003

//! Integration tests for the K8s sandbox backend.
//!
//! Gated behind `KUBE_SANDBOX_INTEGRATION=1` because they require a
//! real cluster (kind, k3d, hetzner-k3s, etc.) with:
//!
//! - A reachable kubeconfig OR in-cluster service account.
//! - The execution namespace `oap-sandbox` present, with PodSecurity
//!   admission labels enforcing the `restricted` profile.
//! - RBAC for the test identity to create + list + delete `Pod` and
//!   `NetworkPolicy` resources in that namespace, plus list
//!   `RuntimeClass` cluster-wide.
//!
//! All other CI / local runs skip these tests via the env-var gate.
//! Unit tests under `crates/sandbox-k8s/src/**` cover the pure logic
//! (pod_spec, network_policy, runtime_class, descriptor, hashing) and
//! the cluster-independent admission rules (FR-A1, FR-A2) without
//! needing a cluster.

use factory_contracts::sandbox::{
    IsolationTier, ResourceCeilings, SandboxRequest, DEFAULT_PID_LIMIT,
};
use factory_engine::sandbox::{SandboxClient, SandboxError};
use sandbox_k8s::K8sSandboxClient;
use std::collections::BTreeMap;

fn integration_enabled() -> bool {
    std::env::var("KUBE_SANDBOX_INTEGRATION")
        .map(|v| v == "1")
        .unwrap_or(false)
}

fn baseline_request(cmd: Vec<&str>) -> SandboxRequest {
    SandboxRequest {
        command: cmd.into_iter().map(String::from).collect(),
        input_artifacts: vec![],
        egress_allowlist: vec![],
        ttl_seconds: 60,
        resource_ceilings: ResourceCeilings {
            cpu_milli_limit: 500,
            cpu_milli_request: 100,
            memory_bytes_limit: 64 * 1024 * 1024,
            memory_bytes_request: 16 * 1024 * 1024,
            pid_limit: DEFAULT_PID_LIMIT,
        },
        minimum_isolation_tier: IsolationTier::RestrictedContainer,
        env: BTreeMap::new(),
    }
}

/// SC-001 — end-to-end happy path. Pod runs `echo hello`, exits 0,
/// no deadline hit, isolation_tier matches the cluster's selection.
#[tokio::test]
async fn sc_001_happy_path_echo() {
    if !integration_enabled() {
        eprintln!("KUBE_SANDBOX_INTEGRATION!=1 — skipping");
        return;
    }
    let client = K8sSandboxClient::new().await;
    assert!(
        client.is_available(),
        "test setup precondition: kubeconfig + oap-sandbox namespace must exist"
    );
    let outcome = client
        .execute(baseline_request(vec!["echo", "hello"]))
        .await
        .expect("execute should succeed");
    assert_eq!(outcome.exit_code, 0);
    assert!(!outcome.deadline_hit);
    assert!(!matches!(outcome.isolation_tier, IsolationTier::Forbidden));
    assert!(!outcome.runtime_descriptor.is_empty());
}

/// SC-002 — admission rejects a Tier 1 request when no Tier 1
/// RuntimeClass is installed in the cluster. The test assumes the
/// operator-provided cluster has no Tier 1 class (kind/k3d default).
#[tokio::test]
async fn sc_002_tier1_required_but_unavailable_rejected() {
    if !integration_enabled() {
        eprintln!("KUBE_SANDBOX_INTEGRATION!=1 — skipping");
        return;
    }
    let client = K8sSandboxClient::new().await;
    if !client.is_available() {
        panic!("test setup precondition: kubeconfig + namespace must be reachable");
    }
    let mut req = baseline_request(vec!["echo", "hi"]);
    req.minimum_isolation_tier = IsolationTier::SandboxRuntime;
    let err = client.execute(req).await.unwrap_err();
    match err {
        SandboxError::AdmissionRejected(msg) => {
            assert!(
                msg.contains("FR-A3"),
                "expected FR-A3 diagnostic, got {msg}"
            );
        }
        other => panic!("expected AdmissionRejected, got {other:?}"),
    }
}

/// SC-003 — TTL fires; `deadline_hit: true` is reported.
///
/// `sleep 999` is well above the request's 5s ttl; the Pod's
/// `activeDeadlineSeconds` should fire and the watcher should see
/// `reason == DeadlineExceeded`.
#[tokio::test]
async fn sc_003_ttl_fires_sets_deadline_hit() {
    if !integration_enabled() {
        eprintln!("KUBE_SANDBOX_INTEGRATION!=1 — skipping");
        return;
    }
    let client = K8sSandboxClient::new().await;
    if !client.is_available() {
        panic!("test setup precondition: kubeconfig + namespace must be reachable");
    }
    let mut req = baseline_request(vec!["sleep", "999"]);
    req.ttl_seconds = 5;
    let outcome = client.execute(req).await.expect("execute should succeed");
    assert!(outcome.deadline_hit, "expected deadline_hit=true");
}

/// SC-004 — fail-closed when no cluster is reachable. Constructed
/// from the explicit Unavailable path; the spec 162 exercise()
/// dispatcher maps to `SandboxRefusal { category: "unavailable" }`.
#[tokio::test]
async fn sc_004_no_cluster_yields_unavailable() {
    // Always runs — doesn't need a real cluster.
    let client = K8sSandboxClient::unavailable("test: no cluster reachable".into());
    let err = factory_engine::sandbox::exercise(&client, baseline_request(vec!["echo", "hi"]))
        .await
        .unwrap_err();
    match err {
        factory_engine::FactoryError::SandboxRefusal {
            category,
            diagnostic,
        } => {
            assert_eq!(category, "unavailable");
            assert!(diagnostic.contains("test: no cluster reachable"));
        }
        other => panic!("expected SandboxRefusal::unavailable, got {other:?}"),
    }
}
