// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/185-sandbox-local-container-backend/spec.md — §4 SC-001..SC-008

//! Integration tests for the local-container sandbox backend.
//!
//! Every test in this file is **gated by the env var
//! `OAP_SANDBOX_LOCAL_INTEGRATION=1`** and a reachable Docker- or
//! Podman-compatible socket. With the env var unset, each test returns
//! early (effectively skipping). This matches the same posture the
//! factory-engine integration suite uses for live-runtime tests.
//!
//! Prerequisites when the gate IS set:
//!   - Docker Engine or rootless Podman reachable via the spec 185 §2.1
//!     socket-probe sequence.
//!   - The default image (`docker.io/library/alpine:3.20`) pulled
//!     locally (or pullable by the daemon — image pull policy is the
//!     operator's concern; the backend passes the reference through).
//!
//! To run locally:
//!   docker pull alpine:3.20
//!   OAP_SANDBOX_LOCAL_INTEGRATION=1 cargo test -p sandbox-local-container --test integration_runtime

use std::collections::BTreeMap;

use factory_contracts::sandbox::{
    EgressAllowlistEntry, InputArtifact, IsolationTier, ResourceCeilings, SandboxRequest,
    DEFAULT_PID_LIMIT, DEFAULT_TTL_SECONDS,
};
use factory_engine::sandbox::{SandboxClient, SandboxError};
use sandbox_local_container::LocalContainerSandboxClient;

const ENV_GATE: &str = "OAP_SANDBOX_LOCAL_INTEGRATION";

fn integration_enabled() -> bool {
    std::env::var(ENV_GATE).ok().as_deref() == Some("1")
}

fn baseline_request(command: Vec<String>, ttl: u32) -> SandboxRequest {
    SandboxRequest {
        command,
        input_artifacts: vec![],
        egress_allowlist: vec![],
        ttl_seconds: ttl,
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

/// SC-001 — with a reachable socket, the client constructs successfully
/// and `backend_descriptor()` returns the expected name + version.
#[tokio::test]
async fn sc_001_client_constructs_against_live_runtime() {
    if !integration_enabled() {
        eprintln!("skipped: set {ENV_GATE}=1 to run");
        return;
    }
    let client = LocalContainerSandboxClient::new().await;
    assert!(
        client.is_available(),
        "expected a reachable runtime; integration gate is set but probe failed"
    );
    let descriptor = client.backend_descriptor();
    assert_eq!(descriptor.name, "local-container");
    assert!(!descriptor.version.is_empty());
    let runtime = client.detected_runtime();
    assert!(runtime.is_some(), "expected a detected runtime");
    eprintln!(
        "integration: detected runtime = {:?}, descriptor = {descriptor:?}",
        runtime.unwrap()
    );
}

/// SC-002 — happy path. Run `echo hello` and verify the
/// `SandboxExecution` shape.
#[tokio::test]
async fn sc_002_echo_hello_happy_path() {
    if !integration_enabled() {
        eprintln!("skipped: set {ENV_GATE}=1 to run");
        return;
    }
    let client = LocalContainerSandboxClient::new().await;
    assert!(client.is_available());

    let request = baseline_request(
        vec!["/bin/echo".into(), "hello".into()],
        DEFAULT_TTL_SECONDS,
    );
    let execution = client.execute(request).await.expect("execute failed");
    assert_eq!(execution.command, vec!["/bin/echo", "hello"]);
    assert_eq!(execution.exit_code, 0);
    assert!(!execution.deadline_hit);
    assert!(!execution.runtime_descriptor.is_empty());
    assert_eq!(execution.isolation_tier, IsolationTier::RestrictedContainer);
    eprintln!(
        "integration: peak={:?} descriptor={}",
        execution.resource_peak, execution.runtime_descriptor
    );
}

/// SC-003 — TTL enforcement. `sleep 9999` with `ttl_seconds=2` must
/// terminate inside the TTL bound and report `deadline_hit=true`,
/// `exit_code=137`.
#[tokio::test]
async fn sc_003_ttl_fires_on_long_running_command() {
    if !integration_enabled() {
        eprintln!("skipped: set {ENV_GATE}=1 to run");
        return;
    }
    let client = LocalContainerSandboxClient::new().await;
    assert!(client.is_available());

    let request = baseline_request(vec!["/bin/sleep".into(), "9999".into()], 2);
    let start = std::time::Instant::now();
    let execution = client.execute(request).await.expect("execute failed");
    let elapsed = start.elapsed();

    assert!(
        execution.deadline_hit,
        "expected deadline_hit, got {execution:?}"
    );
    assert_eq!(execution.exit_code, 137);
    // 2 s TTL + bollard kill latency. Allow a generous upper bound for
    // slow runners (e.g., Podman Machine cold starts).
    assert!(
        elapsed < std::time::Duration::from_secs(30),
        "TTL wall-clock elapsed: {elapsed:?} (expected < 30s)"
    );
}

/// SC-004 — non-empty egress allowlist refused at admission.
/// Works without a live runtime too; included here for completeness in
/// the SC mapping.
#[tokio::test]
async fn sc_004_non_empty_allowlist_refused() {
    if !integration_enabled() {
        eprintln!("skipped: set {ENV_GATE}=1 to run");
        return;
    }
    let client = LocalContainerSandboxClient::new().await;
    let mut request = baseline_request(vec!["/bin/true".into()], DEFAULT_TTL_SECONDS);
    request.egress_allowlist.push(EgressAllowlistEntry {
        hostname: "registry.npmjs.org".into(),
    });
    match client.execute(request).await {
        Err(SandboxError::AdmissionRejected(msg)) => {
            assert!(msg.contains("FU-001"), "diagnostic: {msg}");
        }
        other => panic!("expected AdmissionRejected, got {other:?}"),
    }
}

/// SC-005 — sandbox-runtime tier refused (Phase 1 backend realises
/// only Tier 2). Works without a live runtime too.
#[tokio::test]
async fn sc_005_sandbox_runtime_tier_refused() {
    if !integration_enabled() {
        eprintln!("skipped: set {ENV_GATE}=1 to run");
        return;
    }
    let client = LocalContainerSandboxClient::new().await;
    let mut request = baseline_request(vec!["/bin/true".into()], DEFAULT_TTL_SECONDS);
    request.minimum_isolation_tier = IsolationTier::SandboxRuntime;
    match client.execute(request).await {
        Err(SandboxError::AdmissionRejected(msg)) => {
            assert!(msg.contains("FU-002"), "diagnostic: {msg}");
        }
        other => panic!("expected AdmissionRejected, got {other:?}"),
    }
}

/// SC-006 — non-empty input_artifacts refused (FU-006). Works without
/// a live runtime.
#[tokio::test]
async fn sc_006_input_artifacts_refused() {
    if !integration_enabled() {
        eprintln!("skipped: set {ENV_GATE}=1 to run");
        return;
    }
    let client = LocalContainerSandboxClient::new().await;
    let mut request = baseline_request(vec!["/bin/true".into()], DEFAULT_TTL_SECONDS);
    request.input_artifacts.push(InputArtifact {
        path: "/in/source.rs".into(),
        sha256: "a".repeat(64),
    });
    match client.execute(request).await {
        Err(SandboxError::AdmissionRejected(msg)) => {
            assert!(msg.contains("FU-006"), "diagnostic: {msg}");
        }
        other => panic!("expected AdmissionRejected, got {other:?}"),
    }
}

/// SC-008 — end-to-end through the spec 162 `exercise()` dispatcher.
/// Confirms the `SandboxExecutionRecord` shape with `isolation_tier == 2`.
#[tokio::test]
async fn sc_008_exercise_dispatcher_returns_record_with_numeric_tier() {
    if !integration_enabled() {
        eprintln!("skipped: set {ENV_GATE}=1 to run");
        return;
    }
    let client = LocalContainerSandboxClient::new().await;
    assert!(client.is_available());

    let request = baseline_request(
        vec!["/bin/echo".into(), "exercise".into()],
        DEFAULT_TTL_SECONDS,
    );
    let record = factory_engine::sandbox::exercise(&client, request)
        .await
        .expect("exercise failed");
    assert_eq!(record.isolation_tier, 2);
    assert_eq!(record.command, vec!["/bin/echo", "exercise"]);
    assert!(!record.deadline_hit);
    assert_eq!(record.exit_code, 0);
    assert!(!record.runtime_descriptor.is_empty());
}

/// Exit-code passthrough — a non-zero exit code from inside the
/// sandbox is reported faithfully (the sandbox did its job; the
/// command failed).
#[tokio::test]
async fn exit_code_passthrough_non_zero() {
    if !integration_enabled() {
        eprintln!("skipped: set {ENV_GATE}=1 to run");
        return;
    }
    let client = LocalContainerSandboxClient::new().await;
    let request = baseline_request(
        vec!["/bin/sh".into(), "-c".into(), "exit 42".into()],
        DEFAULT_TTL_SECONDS,
    );
    let execution = client.execute(request).await.expect("execute failed");
    assert_eq!(execution.exit_code, 42);
    assert!(!execution.deadline_hit);
}
