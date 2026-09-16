// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/186-sandbox-k8s-backend/spec.md

//! K8s sandbox backend (spec 186).
//!
//! Concrete implementation of the [`SandboxClient`] contract defined in
//! spec 162. Targets the cluster execution surface (Surface B in spec
//! 162 §1): kube-rs against the operator's cluster, per-execution Pod
//! and NetworkPolicy synthesis, RuntimeClass-driven isolation tier
//! selection.
//!
//! ## Module layout
//!
//! - [`admission`] — cluster-independent Phase 1 admission rules
//!   (FR-A1, FR-A2). Runs before any cluster I/O.
//! - [`runtime_class`] — pure RuntimeClass-name → tier selection
//!   (§2.4) plus the FR-A3 admission check.
//! - [`pod_spec`] — pure `SandboxRequest → Pod` builder (§2.2).
//! - [`network_policy`] — pure `SandboxRequest → NetworkPolicy`
//!   builder (§2.3).
//! - [`descriptor`] — opaque `runtime_descriptor` encoder (§2.7).
//! - [`hashing`] — SHA-256 over a tar stream representing the output
//!   emptyDir contents.
//! - [`runtime`] — kube-rs probe (`Client::try_default` + namespace
//!   verify + RuntimeClass list).
//! - [`lifecycle`] — apply NP → apply Pod → watch → harvest → cleanup.
//!
//! All Phase 1 admission rules + the pure builders are fully unit-
//! tested without a live cluster. Integration tests gated by
//! `KUBE_SANDBOX_INTEGRATION=1` exercise the lifecycle against an
//! operator-provided cluster (see `tests/integration_lifecycle.rs`).

mod admission;
mod descriptor;
mod hashing;
mod lifecycle;
mod network_policy;
mod pod_spec;
mod runtime;
mod runtime_class;

use async_trait::async_trait;

use factory_contracts::sandbox::{SandboxExecution, SandboxRequest};
use factory_engine::sandbox::{BackendDescriptor, SandboxClient, SandboxError};

use runtime::RuntimeState;

/// K8s sandbox backend.
///
/// See spec 186 §2 for the design and §3 for the per-FR behaviour.
///
/// Construction is async because the kube-rs probe sequence
/// (`Client::try_default` + namespace verify + RuntimeClass list)
/// involves apiserver I/O. Use [`K8sSandboxClient::new`] for the
/// default execution namespace (`oap-sandbox`) and the standard
/// alpine base image, or [`K8sSandboxClient::with_namespace_and_image`]
/// for custom deployments.
pub struct K8sSandboxClient {
    runtime: RuntimeState,
    image: String,
}

impl K8sSandboxClient {
    /// Default execution namespace name per spec 186 §2.1. Operators
    /// pre-create this namespace with PodSecurity `restricted`
    /// admission labels.
    pub const DEFAULT_NAMESPACE: &'static str = "oap-sandbox";

    /// Default base image per spec 186 §2.2. FU-004 will make this
    /// operator-configurable through factory-engine config.
    pub const DEFAULT_IMAGE: &'static str = "docker.io/library/alpine:3.20";

    /// Construct a client using kube-rs's default probe sequence
    /// (in-cluster → kubeconfig → none) against the default execution
    /// namespace + default image.
    pub async fn new() -> Self {
        Self::with_namespace_and_image(Self::DEFAULT_NAMESPACE, Self::DEFAULT_IMAGE).await
    }

    /// Construct a client against an explicit execution namespace +
    /// base image. The probe sequence is the same as [`Self::new`].
    pub async fn with_namespace_and_image(namespace: &str, image: &str) -> Self {
        let runtime = RuntimeState::probe(namespace).await;
        Self {
            runtime,
            image: image.to_string(),
        }
    }

    /// Construct a backend pinned to [`SandboxError::Unavailable`] with
    /// a custom diagnostic. Used by tests + for explicit "cluster is
    /// down" injection by operators.
    pub fn unavailable(diagnostic: String) -> Self {
        Self {
            runtime: RuntimeState::Unavailable { diagnostic },
            image: Self::DEFAULT_IMAGE.to_string(),
        }
    }

    /// Reports whether a kube-rs client is currently connected.
    pub fn is_available(&self) -> bool {
        matches!(self.runtime, RuntimeState::Connected { .. })
    }
}

impl Default for K8sSandboxClient {
    fn default() -> Self {
        Self::unavailable(
            "K8sSandboxClient::default() — explicit unavailable (use ::new() to probe)".into(),
        )
    }
}

#[async_trait]
impl SandboxClient for K8sSandboxClient {
    async fn execute(
        &self,
        request: SandboxRequest,
    ) -> Result<SandboxExecution, SandboxError> {
        // Cluster-independent admission first; FR-A1..A2 short-circuit
        // before the runtime is consulted so misconfigured requests
        // fail closed even when the cluster is unreachable.
        admission::check(&request)?;

        match &self.runtime {
            RuntimeState::Unavailable { diagnostic } => {
                Err(SandboxError::Unavailable(diagnostic.clone()))
            }
            RuntimeState::Connected {
                client,
                namespace,
                kube_version,
                selection,
            } => {
                // FR-A3: cluster-aware admission needs the realised
                // selection; runs only on the Connected arm.
                if let Err(diag) = runtime_class::admission_for_tier1_requirement(
                    request.minimum_isolation_tier,
                    selection,
                ) {
                    return Err(SandboxError::AdmissionRejected(diag));
                }

                lifecycle::run(lifecycle::Inputs {
                    client,
                    namespace,
                    request,
                    selection: selection.clone(),
                    image: &self.image,
                    kube_version,
                    backend_version: env!("CARGO_PKG_VERSION"),
                })
                .await
            }
        }
    }

    fn backend_descriptor(&self) -> BackendDescriptor {
        BackendDescriptor {
            name: BACKEND_NAME.to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}

/// Backend identity per spec 186 §FR-002. Surfaced through
/// [`BackendDescriptor::name`].
pub const BACKEND_NAME: &str = "k8s";

#[cfg(test)]
mod tests {
    use super::*;
    use factory_contracts::sandbox::{
        EgressAllowlistEntry, InputArtifact, IsolationTier, ResourceCeilings, SandboxRequest,
        DEFAULT_PID_LIMIT, DEFAULT_TTL_SECONDS,
    };
    use std::collections::BTreeMap;

    fn baseline_request() -> SandboxRequest {
        SandboxRequest {
            command: vec!["echo".into(), "hello".into()],
            input_artifacts: vec![],
            egress_allowlist: vec![],
            ttl_seconds: DEFAULT_TTL_SECONDS,
            resource_ceilings: ResourceCeilings {
                cpu_milli_limit: 500,
                cpu_milli_request: 100,
                memory_bytes_limit: 256 * 1024 * 1024,
                memory_bytes_request: 64 * 1024 * 1024,
                pid_limit: DEFAULT_PID_LIMIT,
            },
            minimum_isolation_tier: IsolationTier::RestrictedContainer,
            env: BTreeMap::new(),
        }
    }

    #[tokio::test]
    async fn unavailable_constructor_returns_unavailable_error() {
        let client = K8sSandboxClient::unavailable("test unavailable diagnostic".into());
        assert!(!client.is_available());
        let err = client.execute(baseline_request()).await.unwrap_err();
        match err {
            SandboxError::Unavailable(msg) => {
                assert_eq!(msg, "test unavailable diagnostic");
            }
            other => panic!("expected Unavailable, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn default_constructor_explicit_unavailable() {
        let client = K8sSandboxClient::default();
        assert!(!client.is_available());
        let err = client.execute(baseline_request()).await.unwrap_err();
        match err {
            SandboxError::Unavailable(msg) => {
                assert!(msg.contains("default()"));
            }
            other => panic!("expected Unavailable, got {other:?}"),
        }
    }

    #[test]
    fn backend_descriptor_reports_k8s() {
        let client = K8sSandboxClient::unavailable("test".into());
        let d = client.backend_descriptor();
        assert_eq!(d.name, BACKEND_NAME);
        assert_eq!(d.name, "k8s");
        assert!(!d.version.is_empty());
    }

    #[test]
    fn default_namespace_and_image_constants() {
        assert_eq!(K8sSandboxClient::DEFAULT_NAMESPACE, "oap-sandbox");
        assert_eq!(K8sSandboxClient::DEFAULT_IMAGE, "docker.io/library/alpine:3.20");
    }

    /// FR-A1 — non-empty egress allowlist rejected at admission BEFORE
    /// runtime probe, even on an Unavailable client.
    #[tokio::test]
    async fn fr_a1_egress_allowlist_rejected_pre_probe() {
        let client = K8sSandboxClient::unavailable("would-not-be-reached".into());
        let mut req = baseline_request();
        req.egress_allowlist.push(EgressAllowlistEntry {
            hostname: "registry.npmjs.org".into(),
        });
        let err = client.execute(req).await.unwrap_err();
        match err {
            SandboxError::AdmissionRejected(msg) => {
                assert!(msg.contains("FU-001"));
                assert!(msg.contains("registry.npmjs.org"));
            }
            other => panic!("expected AdmissionRejected, got {other:?}"),
        }
    }

    /// FR-A2 — non-empty input artifacts rejected at admission BEFORE
    /// runtime probe.
    #[tokio::test]
    async fn fr_a2_input_artifacts_rejected_pre_probe() {
        let client = K8sSandboxClient::unavailable("would-not-be-reached".into());
        let mut req = baseline_request();
        req.input_artifacts.push(InputArtifact {
            path: "/in/main.rs".into(),
            sha256: "00".repeat(32),
        });
        let err = client.execute(req).await.unwrap_err();
        match err {
            SandboxError::AdmissionRejected(msg) => {
                assert!(msg.contains("FU-002"));
                assert!(msg.contains("/in/main.rs"));
            }
            other => panic!("expected AdmissionRejected, got {other:?}"),
        }
    }

    /// SC-004 / end-to-end with spec 162 dispatcher — fail-closed
    /// posture honours FR-009 on the K8s backend the same way spec
    /// 185 does on the local-container backend.
    #[tokio::test]
    async fn exercise_halts_on_unavailable() {
        let client = K8sSandboxClient::unavailable(
            "spec 186 §2.1: synthetic test diagnostic".into(),
        );
        let err = factory_engine::sandbox::exercise(&client, baseline_request())
            .await
            .unwrap_err();
        match err {
            factory_engine::FactoryError::SandboxRefusal {
                category,
                diagnostic,
            } => {
                assert_eq!(category, "unavailable");
                assert!(diagnostic.contains("spec 186"));
            }
            other => panic!("expected SandboxRefusal::unavailable, got {other:?}"),
        }
    }

    /// FR-A1 takes precedence over runtime state: even on a probe-
    /// constructed client (where ::new() may yield Connected in test
    /// envs that have a kubeconfig pointing at a cluster), the
    /// admission rules run first. Test against the Unavailable
    /// constructor for determinism — the rule order is the contract.
    #[tokio::test]
    async fn admission_runs_before_runtime_lookup() {
        let client = K8sSandboxClient::unavailable("unreachable".into());
        let mut req = baseline_request();
        req.egress_allowlist.push(EgressAllowlistEntry {
            hostname: "x.example".into(),
        });
        // Should hit FR-A1 (AdmissionRejected), NOT Unavailable.
        let err = client.execute(req).await.unwrap_err();
        assert!(matches!(err, SandboxError::AdmissionRejected(_)));
    }
}
