// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/186-sandbox-k8s-backend/spec.md — §2.6, §3 FR-006, FR-007, FR-008

//! Per-execution lifecycle.
//!
//! Spec 186 §2.6 step-by-step:
//!
//! 1. Validate request (caller did this via [`SandboxRequest::validate`]).
//! 2. Admission (caller did this via [`crate::admission::check`] +
//!    [`crate::runtime_class::admission_for_tier1_requirement`]).
//! 3. Synthesise Pod + NetworkPolicy (pure builders).
//! 4. Apply NetworkPolicy → Pod (order matters — policy before Pod).
//! 5. Watch Pod with deadline ceiling; on terminal phase branch.
//! 6. Harvest exit code + output artifact hashes via `Api::exec(tar c /out)`.
//! 7. Cleanup Pod + NetworkPolicy explicitly.
//! 8. Emit [`SandboxExecution`] with realised tier + descriptor.

use std::collections::BTreeMap;
use std::time::Duration;

use factory_contracts::sandbox::{ResourcePeak, SandboxExecution, SandboxRequest};
use factory_engine::sandbox::SandboxError;
use k8s_openapi::api::core::v1::Pod;
use k8s_openapi::api::networking::v1::NetworkPolicy;
use kube::api::{Api, AttachParams, DeleteParams, PostParams};
use kube::runtime::{conditions, wait};
use kube::Client;
use tokio::io::AsyncReadExt;

use crate::descriptor::{encode as encode_descriptor, Descriptor};
use crate::hashing::hash_tar_stream;
use crate::network_policy;
use crate::pod_spec::{self, BuildInputs, CONTAINER_NAME, OUTPUT_MOUNT_PATH};
use crate::runtime_class::Selection;

/// Inputs to [`run`].
pub(crate) struct Inputs<'a> {
    pub client: &'a Client,
    pub namespace: &'a str,
    pub request: SandboxRequest,
    pub selection: Selection,
    pub image: &'a str,
    pub kube_version: &'a str,
    pub backend_version: &'a str,
}

/// Per-execution lifecycle entry point. See module docs.
pub(crate) async fn run(inputs: Inputs<'_>) -> Result<SandboxExecution, SandboxError> {
    let Inputs {
        client,
        namespace,
        request,
        selection,
        image,
        kube_version,
        backend_version,
    } = inputs;

    let uuid = uuid::Uuid::new_v4().to_string();
    let pod_name = pod_spec::pod_name(&uuid);
    let np_name = network_policy::network_policy_name(&uuid);

    let pod = pod_spec::build(BuildInputs {
        request: &request,
        namespace,
        uuid: &uuid,
        runtime_class_name: selection.runtime_class_name.as_deref(),
        image,
    });
    let np = network_policy::build(&uuid, namespace);

    let pods: Api<Pod> = Api::namespaced(client.clone(), namespace);
    let nps: Api<NetworkPolicy> = Api::namespaced(client.clone(), namespace);

    // Step 4: NetworkPolicy first, then Pod.
    if let Err(e) = nps.create(&PostParams::default(), &np).await {
        return Err(SandboxError::ExecutionFailure(format!(
            "spec 186: NetworkPolicy create failed for {np_name}: {e}"
        )));
    }
    if let Err(e) = pods.create(&PostParams::default(), &pod).await {
        let _ = nps.delete(&np_name, &DeleteParams::default()).await;
        return Err(SandboxError::ExecutionFailure(format!(
            "spec 186: Pod create failed for {pod_name}: {e}"
        )));
    }

    // Step 5: wait for Running, then for terminal phase. Local
    // timeout = TTL + 60s safety margin; the in-cluster TTL
    // (activeDeadlineSeconds) is the actual ceiling, this is just
    // a watchdog in case the apiserver event stream stalls.
    let watcher_ttl = Duration::from_secs(u64::from(request.ttl_seconds).saturating_add(60));
    let running_outcome = tokio::time::timeout(
        watcher_ttl,
        wait::await_condition(pods.clone(), &pod_name, conditions::is_pod_running()),
    )
    .await;
    if running_outcome.is_err() {
        cleanup(&pods, &pod_name, &nps, &np_name).await;
        return Err(SandboxError::ExecutionFailure(format!(
            "spec 186: Pod {pod_name} never reached Running within {}s",
            watcher_ttl.as_secs()
        )));
    }

    let terminal_outcome = tokio::time::timeout(
        watcher_ttl,
        wait::await_condition(pods.clone(), &pod_name, is_pod_terminated()),
    )
    .await;

    let terminal_pod = match terminal_outcome {
        Ok(Ok(Some(pod))) => pod,
        Ok(Ok(None)) => {
            cleanup(&pods, &pod_name, &nps, &np_name).await;
            return Err(SandboxError::ExecutionFailure(format!(
                "spec 186: Pod {pod_name} watcher returned None terminal state"
            )));
        }
        Ok(Err(e)) => {
            cleanup(&pods, &pod_name, &nps, &np_name).await;
            return Err(SandboxError::ExecutionFailure(format!(
                "spec 186: Pod {pod_name} watcher errored: {e}"
            )));
        }
        Err(_) => {
            cleanup(&pods, &pod_name, &nps, &np_name).await;
            return Err(SandboxError::ExecutionFailure(format!(
                "spec 186: Pod {pod_name} did not reach terminal phase within {}s",
                watcher_ttl.as_secs()
            )));
        }
    };

    let (exit_code, deadline_hit) = harvest_exit_status(&terminal_pod);
    let output_hashes = harvest_output_hashes(&pods, &pod_name).await;

    cleanup(&pods, &pod_name, &nps, &np_name).await;

    let runtime_descriptor = encode_descriptor(&Descriptor {
        backend: crate::BACKEND_NAME,
        backend_version: backend_version.to_string(),
        kube_version: kube_version.to_string(),
        runtime_class: selection.descriptor_name.clone(),
        isolation_tier: selection.realised_tier.as_numeric(),
    });

    Ok(SandboxExecution {
        command: request.command.clone(),
        input_artifact_hashes: BTreeMap::new(),
        output_artifact_hashes: output_hashes,
        resource_peak: ResourcePeak::default(),
        isolation_tier: selection.realised_tier,
        runtime_descriptor,
        deadline_hit,
        exit_code,
    })
}

/// Kube-rs `await_condition` predicate firing when the Pod has reached
/// a terminal phase (`Succeeded` or `Failed`).
fn is_pod_terminated() -> impl Fn(Option<&Pod>) -> bool + Send + Sync + 'static {
    |obj| {
        let Some(pod) = obj else {
            return false;
        };
        let Some(status) = &pod.status else {
            return false;
        };
        matches!(status.phase.as_deref(), Some("Succeeded") | Some("Failed"))
    }
}

/// Extract `(exit_code, deadline_hit)` from a Pod that has reached
/// terminal phase. Looks at the first container's terminated state;
/// the per-execution Pod has exactly one container by construction.
fn harvest_exit_status(pod: &Pod) -> (i32, bool) {
    let status = pod.status.as_ref();
    let deadline_hit = status
        .and_then(|s| s.reason.as_deref())
        .map(|r| r == "DeadlineExceeded")
        .unwrap_or(false);
    let exit_code = status
        .and_then(|s| s.container_statuses.as_ref())
        .and_then(|cs| cs.iter().find(|c| c.name == CONTAINER_NAME))
        .and_then(|c| c.state.as_ref())
        .and_then(|s| s.terminated.as_ref())
        .map(|t| t.exit_code)
        .unwrap_or(if deadline_hit { 124 } else { -1 });
    (exit_code, deadline_hit)
}

/// Harvest output artifacts by exec-ing `tar c /out` and streaming the
/// tar through [`hash_tar_stream`]. Best-effort: returns empty on
/// failure with `tracing::warn!`. The cert binds whatever was hashed.
async fn harvest_output_hashes(pods: &Api<Pod>, pod_name: &str) -> BTreeMap<String, String> {
    let params = AttachParams::default()
        .container(CONTAINER_NAME)
        .stdin(false)
        .stdout(true)
        .stderr(false);
    let cmd = vec![
        "tar".to_string(),
        "c".to_string(),
        OUTPUT_MOUNT_PATH.to_string(),
    ];
    let mut attached = match pods.exec(pod_name, cmd, &params).await {
        Ok(a) => a,
        Err(e) => {
            tracing::warn!(
                pod = pod_name,
                error = %e,
                "spec 186: output harvest exec failed; emitting empty output_artifact_hashes",
            );
            return BTreeMap::new();
        }
    };
    let Some(mut stdout) = attached.stdout() else {
        tracing::warn!(pod = pod_name, "spec 186: attached exec returned no stdout");
        return BTreeMap::new();
    };
    let mut buf = Vec::new();
    if let Err(e) = stdout.read_to_end(&mut buf).await {
        tracing::warn!(
            pod = pod_name,
            error = %e,
            "spec 186: tar stream read failed; emitting empty output_artifact_hashes",
        );
        return BTreeMap::new();
    }
    let _ = attached.join().await;
    match hash_tar_stream(&buf[..]) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!(
                pod = pod_name,
                error = %e,
                "spec 186: tar stream hash failed; emitting empty output_artifact_hashes",
            );
            BTreeMap::new()
        }
    }
}

/// Best-effort cleanup: delete Pod, delete NetworkPolicy. Errors are
/// logged but not surfaced — spec 186 FR-007.
async fn cleanup(
    pods: &Api<Pod>,
    pod_name: &str,
    nps: &Api<NetworkPolicy>,
    np_name: &str,
) {
    if let Err(e) = pods.delete(pod_name, &DeleteParams::default()).await {
        tracing::warn!(pod = pod_name, error = %e, "spec 186 FR-007: pod delete failed");
    }
    if let Err(e) = nps.delete(np_name, &DeleteParams::default()).await {
        tracing::warn!(
            networkpolicy = np_name,
            error = %e,
            "spec 186 FR-007: networkpolicy delete failed",
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use k8s_openapi::api::core::v1::{
        ContainerState, ContainerStateTerminated, ContainerStatus, PodStatus,
    };

    fn pod_with_status(phase: &str, reason: Option<&str>, exit_code: Option<i32>) -> Pod {
        let cs = ContainerStatus {
            name: CONTAINER_NAME.to_string(),
            ready: false,
            restart_count: 0,
            image: "test:latest".to_string(),
            image_id: String::new(),
            state: Some(ContainerState {
                terminated: exit_code.map(|c| ContainerStateTerminated {
                    exit_code: c,
                    reason: reason.map(|r| r.to_string()),
                    ..ContainerStateTerminated::default()
                }),
                ..ContainerState::default()
            }),
            ..ContainerStatus::default()
        };
        Pod {
            status: Some(PodStatus {
                phase: Some(phase.to_string()),
                reason: reason.map(|r| r.to_string()),
                container_statuses: Some(vec![cs]),
                ..PodStatus::default()
            }),
            ..Pod::default()
        }
    }

    #[test]
    fn is_pod_terminated_fires_on_succeeded() {
        let p = pod_with_status("Succeeded", None, Some(0));
        let pred = is_pod_terminated();
        assert!(pred(Some(&p)));
    }

    #[test]
    fn is_pod_terminated_fires_on_failed() {
        let p = pod_with_status("Failed", None, Some(1));
        let pred = is_pod_terminated();
        assert!(pred(Some(&p)));
    }

    #[test]
    fn is_pod_terminated_does_not_fire_on_running() {
        let p = pod_with_status("Running", None, None);
        let pred = is_pod_terminated();
        assert!(!pred(Some(&p)));
    }

    #[test]
    fn is_pod_terminated_does_not_fire_on_pending() {
        let p = pod_with_status("Pending", None, None);
        let pred = is_pod_terminated();
        assert!(!pred(Some(&p)));
    }

    #[test]
    fn is_pod_terminated_does_not_fire_on_none() {
        let pred = is_pod_terminated();
        assert!(!pred(None));
    }

    #[test]
    fn harvest_exit_status_succeeded_returns_zero() {
        let p = pod_with_status("Succeeded", None, Some(0));
        let (exit, deadline_hit) = harvest_exit_status(&p);
        assert_eq!(exit, 0);
        assert!(!deadline_hit);
    }

    #[test]
    fn harvest_exit_status_failed_non_deadline_returns_container_exit() {
        let p = pod_with_status("Failed", Some("Error"), Some(2));
        let (exit, deadline_hit) = harvest_exit_status(&p);
        assert_eq!(exit, 2);
        assert!(!deadline_hit);
    }

    #[test]
    fn harvest_exit_status_failed_deadline_sets_deadline_hit_with_container_exit() {
        let p = pod_with_status("Failed", Some("DeadlineExceeded"), Some(137));
        let (exit, deadline_hit) = harvest_exit_status(&p);
        assert_eq!(exit, 137);
        assert!(deadline_hit);
    }

    #[test]
    fn harvest_exit_status_failed_deadline_surrogate_exit_124_when_no_container_state() {
        let p = pod_with_status("Failed", Some("DeadlineExceeded"), None);
        let (exit, deadline_hit) = harvest_exit_status(&p);
        assert_eq!(exit, 124);
        assert!(deadline_hit);
    }

    #[test]
    fn harvest_exit_status_no_status_yields_neg_one() {
        let p = Pod {
            status: None,
            ..Pod::default()
        };
        let (exit, deadline_hit) = harvest_exit_status(&p);
        assert_eq!(exit, -1);
        assert!(!deadline_hit);
    }
}
