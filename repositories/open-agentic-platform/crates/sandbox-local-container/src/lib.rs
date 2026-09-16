// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/185-sandbox-local-container-backend/spec.md

//! Local-container sandbox backend (spec 185).
//!
//! Concrete implementation of the [`SandboxClient`] contract defined in
//! spec 162. Targets the developer-workstation / OPC-laptop execution
//! surface: rootless Podman (preferred) or Docker via the Docker
//! Engine API.
//!
//! ## Phase boundary
//!
//! - Phase 1 — scaffolding (universally `Unavailable`).
//! - Phase 2 — runtime detection (probe Docker / Podman sockets).
//! - **Phase 3 — execute() happy path** (this phase): container
//!   lifecycle with all isolation flags applied, TTL kill, output
//!   artifact hashing, runtime descriptor. Resource peak still
//!   reported as zero — phase 4 wires the stats-polling task.

mod admission;
mod descriptor;
mod hashing;
mod lifecycle;
mod peak;
mod runtime;

use async_trait::async_trait;
use std::path::PathBuf;

use factory_contracts::sandbox::{SandboxExecution, SandboxRequest};
use factory_engine::sandbox::{
    BackendDescriptor, SandboxClient, SandboxError,
};

pub use runtime::DetectedRuntime;

use runtime::{
    classify_runtime, default_socket_candidates, format_probe_failures, probe_socket,
    ProbeFailure, RuntimeState,
};

/// Local-container sandbox backend.
///
/// See spec 185 §2 for the design and §3 for the per-FR backend
/// behaviour. Construct via [`LocalContainerSandboxClient::new`] for
/// the default socket-probe sequence + default base image, or
/// [`LocalContainerSandboxClient::with_candidates_and_image`] for
/// tests / custom deployments.
pub struct LocalContainerSandboxClient {
    runtime: RuntimeState,
    image: String,
}

impl LocalContainerSandboxClient {
    /// Construct a client using the default socket-probe sequence
    /// (spec 185 §2.1) and the default base image
    /// ([`DEFAULT_IMAGE`]).
    pub async fn new() -> Self {
        Self::with_candidates_and_image(default_socket_candidates(), DEFAULT_IMAGE.to_string())
            .await
    }

    /// Construct a client by probing an explicit ordered list of
    /// socket candidates, keeping the default base image.
    pub async fn with_candidates(candidates: Vec<PathBuf>) -> Self {
        Self::with_candidates_and_image(candidates, DEFAULT_IMAGE.to_string()).await
    }

    /// Construct a client by probing an explicit ordered list of
    /// socket candidates *and* picking a non-default base image. The
    /// image reference is passed verbatim to the runtime; the backend
    /// does NOT manage pull policy, signing, or registry credentials
    /// (FU-003 / FU-005 future scope).
    pub async fn with_candidates_and_image(
        candidates: Vec<PathBuf>,
        image: String,
    ) -> Self {
        if candidates.is_empty() {
            return Self {
                runtime: RuntimeState::Unavailable {
                    diagnostic:
                        "no socket candidates provided to LocalContainerSandboxClient::with_candidates"
                            .into(),
                },
                image,
            };
        }
        let mut failures: Vec<ProbeFailure> = Vec::new();
        for socket in candidates {
            match probe_socket(&socket).await {
                Ok((docker, version)) => {
                    let detected = classify_runtime(&version);
                    return Self {
                        runtime: RuntimeState::Connected {
                            docker,
                            socket,
                            runtime: detected,
                            version: Box::new(version),
                        },
                        image,
                    };
                }
                Err(reason) => failures.push(ProbeFailure { socket, reason }),
            }
        }
        Self {
            runtime: RuntimeState::Unavailable {
                diagnostic: format_probe_failures(&failures),
            },
            image,
        }
    }

    /// Reports whether a runtime is currently connected.
    pub fn is_available(&self) -> bool {
        matches!(self.runtime, RuntimeState::Connected { .. })
    }

    /// Detected runtime family when connected, `None` otherwise.
    pub fn detected_runtime(&self) -> Option<DetectedRuntime> {
        match &self.runtime {
            RuntimeState::Connected { runtime, .. } => Some(*runtime),
            RuntimeState::Unavailable { .. } => None,
        }
    }

    /// Configured base image reference.
    pub fn image(&self) -> &str {
        &self.image
    }
}

#[async_trait]
impl SandboxClient for LocalContainerSandboxClient {
    async fn execute(
        &self,
        request: SandboxRequest,
    ) -> Result<SandboxExecution, SandboxError> {
        // Backend-specific admission rules first; FR-A1..FR-A5
        // short-circuit before any container API call.
        admission::check(&request)?;

        match &self.runtime {
            RuntimeState::Unavailable { diagnostic } => {
                Err(SandboxError::Unavailable(diagnostic.clone()))
            }
            RuntimeState::Connected {
                docker,
                runtime,
                version,
                ..
            } => {
                lifecycle::run(
                    docker,
                    &self.image,
                    request,
                    *runtime,
                    version,
                    env!("CARGO_PKG_VERSION"),
                )
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

/// Backend identity. Surfaces via [`BackendDescriptor::name`] (spec 185 FR-002).
pub const BACKEND_NAME: &str = "local-container";

/// Default base image (spec 185 §2.2). Operator-configurable in FU-005;
/// the configured image is the *only* image the backend will pull /
/// resolve.
pub const DEFAULT_IMAGE: &str = "docker.io/library/alpine:3.20";

#[cfg(test)]
mod tests {
    use super::*;
    use factory_contracts::sandbox::{
        EgressAllowlistEntry, IsolationTier, ResourceCeilings, SandboxRequest,
        DEFAULT_PID_LIMIT, DEFAULT_TTL_SECONDS,
    };
    use std::collections::BTreeMap;

    fn request_with_empty_allowlist() -> SandboxRequest {
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

    fn request_with_egress_allowlist() -> SandboxRequest {
        let mut r = request_with_empty_allowlist();
        r.egress_allowlist.push(EgressAllowlistEntry {
            hostname: "registry.npmjs.org".into(),
        });
        r
    }

    #[tokio::test]
    async fn no_candidates_returns_unavailable_with_diagnostic() {
        let client = LocalContainerSandboxClient::with_candidates(vec![]).await;
        assert!(!client.is_available());
        assert_eq!(client.detected_runtime(), None);
        let err = client
            .execute(request_with_empty_allowlist())
            .await
            .unwrap_err();
        match err {
            SandboxError::Unavailable(msg) => {
                assert!(msg.contains("no socket candidates"));
            }
            other => panic!("expected Unavailable, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn nonexistent_paths_yield_compound_diagnostic() {
        let bogus = vec![
            PathBuf::from("/tmp/oap-test-nonexistent-sock-a"),
            PathBuf::from("/tmp/oap-test-nonexistent-sock-b"),
        ];
        let client = LocalContainerSandboxClient::with_candidates(bogus).await;
        assert!(!client.is_available());
        let err = client
            .execute(request_with_empty_allowlist())
            .await
            .unwrap_err();
        match err {
            SandboxError::Unavailable(msg) => {
                assert!(msg.contains("/tmp/oap-test-nonexistent-sock-a"));
                assert!(msg.contains("/tmp/oap-test-nonexistent-sock-b"));
                assert!(msg.contains("does not exist"));
                assert!(msg.contains("spec 185"));
            }
            other => panic!("expected Unavailable, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn socket_not_listening_yields_probe_failure() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let candidates = vec![tmp.path().to_path_buf()];
        let client = LocalContainerSandboxClient::with_candidates(candidates).await;
        assert!(!client.is_available());
        let err = client
            .execute(request_with_empty_allowlist())
            .await
            .unwrap_err();
        match err {
            SandboxError::Unavailable(msg) => {
                assert!(msg.contains("/version probe failed"));
            }
            other => panic!("expected Unavailable, got {other:?}"),
        }
    }

    #[test]
    fn backend_descriptor_reports_local_container() {
        // Construct without async probe — the descriptor is stable
        // across runtime states.
        let client = LocalContainerSandboxClient {
            runtime: RuntimeState::Unavailable {
                diagnostic: "test".into(),
            },
            image: DEFAULT_IMAGE.to_string(),
        };
        let descriptor = client.backend_descriptor();
        assert_eq!(descriptor.name, BACKEND_NAME);
        assert_eq!(descriptor.name, "local-container");
        assert!(!descriptor.version.is_empty());
        assert_eq!(client.image(), DEFAULT_IMAGE);
    }

    /// Admission rejects non-empty egress allowlist BEFORE any runtime
    /// probe — this works even with a non-connected client.
    #[tokio::test]
    async fn egress_allowlist_rejected_at_admission_even_without_runtime() {
        let client = LocalContainerSandboxClient::with_candidates(vec![]).await;
        let err = client
            .execute(request_with_egress_allowlist())
            .await
            .unwrap_err();
        match err {
            SandboxError::AdmissionRejected(msg) => {
                assert!(msg.contains("FU-001"));
                assert!(msg.contains("registry.npmjs.org"));
            }
            other => panic!("expected AdmissionRejected, got {other:?}"),
        }
    }

    /// End-to-end with the spec 162 `exercise()` dispatcher — the
    /// not-connected + invalid-admission client honours FR-009
    /// fail-closed-by-default.
    #[tokio::test]
    async fn exercise_halts_on_unavailable() {
        let client = LocalContainerSandboxClient::with_candidates(vec![]).await;
        let err = factory_engine::sandbox::exercise(&client, request_with_empty_allowlist())
            .await
            .unwrap_err();
        match err {
            factory_engine::FactoryError::SandboxRefusal {
                category,
                diagnostic,
            } => {
                assert_eq!(category, "unavailable");
                assert!(diagnostic.contains("no socket candidates"));
            }
            other => panic!("expected SandboxRefusal::unavailable, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn exercise_halts_on_admission_rejection() {
        let client = LocalContainerSandboxClient::with_candidates(vec![]).await;
        let err = factory_engine::sandbox::exercise(&client, request_with_egress_allowlist())
            .await
            .unwrap_err();
        match err {
            factory_engine::FactoryError::SandboxRefusal {
                category,
                diagnostic,
            } => {
                assert_eq!(category, "admission-rejected");
                assert!(diagnostic.contains("FU-001"));
            }
            other => panic!("expected SandboxRefusal::admission-rejected, got {other:?}"),
        }
    }

    #[test]
    fn default_image_is_alpine_3_20() {
        assert_eq!(DEFAULT_IMAGE, "docker.io/library/alpine:3.20");
    }
}
