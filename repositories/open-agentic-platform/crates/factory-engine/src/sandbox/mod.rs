// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/162-sandbox-execution-contract/spec.md — §2.3, §3 FR-001..FR-009

//! Sandbox execution contract (spec 162).
//!
//! This module hosts the backend-agnostic `SandboxClient` trait, the
//! `SandboxError` taxonomy, and the universally fail-closed
//! `NullSandboxClient`. Backend implementations (local-container, K8s,
//! WASM) live in their own modules behind this trait and depend on it,
//! not the other way around.
//!
//! The contract-level invariant codified here is FR-009: any call path
//! that cannot produce a successful `SandboxClient::execute` outcome
//! MUST halt the pipeline; there is no host-execution fallback. The
//! `NullSandboxClient` is the universal implementation of that posture
//! for a factory-engine that has not been wired to an operational
//! backend.

use async_trait::async_trait;
use factory_contracts::sandbox::{
    SandboxExecution, SandboxRequest, SandboxRequestValidationError,
};

use crate::FactoryError;
use crate::governance_certificate::SandboxExecutionRecord;

/// Errors returned by a `SandboxClient::execute` call.
///
/// The three operational branches map to the three FR-009 halt
/// conditions (162 §3 FR-009 + §2.3):
///
/// - `Unavailable` — no backend can satisfy the request. This is the
///   posture of the `NullSandboxClient` and of any operational backend
///   whose runtime substrate is unreachable (cluster down, container
///   daemon socket missing, etc.). The pipeline halts.
/// - `AdmissionRejected` — a backend was reached but the request
///   violated contract invariants the backend enforces in addition to
///   `SandboxRequest::validate` (e.g., the backend cannot satisfy the
///   requested minimum isolation tier, or the requested egress hosts
///   are not on the operator allowlist). The pipeline halts.
/// - `ExecutionFailure` — the sandbox itself was healthy, the request
///   was admitted, the execution ran, but the command inside the
///   sandbox failed. The pipeline halts at the exercise step; the
///   sandbox is not at fault.
///
/// The `RequestValidation` branch is convenience: validation that the
/// contract guarantees should hold pre-dispatch. Surfaced as a separate
/// variant so callers can distinguish "request was malformed" from
/// "request was valid but sandbox refused."
#[derive(Debug, thiserror::Error)]
pub enum SandboxError {
    #[error("no sandbox backend available to satisfy the request: {0}")]
    Unavailable(String),
    #[error("backend rejected the request on admission grounds: {0}")]
    AdmissionRejected(String),
    #[error("execution failed inside the sandbox: {0}")]
    ExecutionFailure(String),
    #[error("request validation failed: {0}")]
    RequestValidation(#[from] SandboxRequestValidationError),
}

impl SandboxError {
    /// Human-readable category label. Used in diagnostics and in the
    /// governance certificate's halt record (162 §4 SC-001 + spec 102
    /// §FR-007).
    pub fn category(&self) -> &'static str {
        match self {
            SandboxError::Unavailable(_) => "unavailable",
            SandboxError::AdmissionRejected(_) => "admission-rejected",
            SandboxError::ExecutionFailure(_) => "execution-failure",
            SandboxError::RequestValidation(_) => "request-validation",
        }
    }
}

/// Identity descriptor for a backend. Surfaced as part of
/// `runtime_descriptor` plus diagnostics; not consumed as policy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendDescriptor {
    pub name: String,
    pub version: String,
}

/// Backend-agnostic sandbox client. Implementations live in their own
/// modules (e.g., a future `local_container.rs`, a future `k8s.rs`); the
/// trait surface intentionally contains no backend-specific types so the
/// factory-engine remains decoupled from the concrete substrate.
#[async_trait]
pub trait SandboxClient: Send + Sync {
    /// Execute a single request. Returns a `SandboxExecution` on
    /// successful run (regardless of the inner command's exit code), or
    /// a `SandboxError` describing why the sandbox itself could not
    /// honour the request.
    async fn execute(
        &self,
        request: SandboxRequest,
    ) -> Result<SandboxExecution, SandboxError>;

    /// Backend identity descriptor. Surfaces in diagnostics and in the
    /// opaque `runtime_descriptor` emitted into the governance
    /// certificate.
    fn backend_descriptor(&self) -> BackendDescriptor;
}

/// Universally fail-closed sandbox client. Every `execute` call returns
/// `SandboxError::Unavailable`. The correct default for a factory-engine
/// that has not been wired to an operational backend (162 §2.4): with no
/// backend installed, the engine MUST refuse to exercise
/// adapter-emitted code rather than fall back to host execution.
///
/// FR-009 is a contract invariant — not a backend choice. `NullSandboxClient`
/// is the universal implementation of that invariant.
pub struct NullSandboxClient {
    diagnostic: String,
}

impl NullSandboxClient {
    pub fn new() -> Self {
        Self {
            diagnostic:
                "no sandbox backend registered (factory-engine fail-closed default per spec 162 FR-009)"
                    .to_string(),
        }
    }

    pub fn with_diagnostic(diagnostic: impl Into<String>) -> Self {
        Self {
            diagnostic: diagnostic.into(),
        }
    }

    pub fn diagnostic(&self) -> &str {
        &self.diagnostic
    }
}

impl Default for NullSandboxClient {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl SandboxClient for NullSandboxClient {
    async fn execute(
        &self,
        _request: SandboxRequest,
    ) -> Result<SandboxExecution, SandboxError> {
        Err(SandboxError::Unavailable(self.diagnostic.clone()))
    }

    fn backend_descriptor(&self) -> BackendDescriptor {
        BackendDescriptor {
            name: "null-fail-closed".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}

// ── FR-001 / FR-009 dispatcher ───────────────────────────────────────

/// Dispatch one adapter-emitted-code exercise through a `SandboxClient`,
/// honouring FR-001 (every exercise dispatches through `execute`) and
/// FR-009 (any unsuccessful path halts the pipeline; no host fallback).
///
/// This helper is the canonical surface a stage runner uses to exercise
/// adapter-emitted code. It:
///
/// 1. Validates the request via `SandboxRequest::validate` (cheap, local).
/// 2. Calls `client.execute(request)`.
/// 3. On `Ok(execution)` — wraps the outcome into a
///    [`SandboxExecutionRecord`] ready for the governance-certificate
///    stage and returns it (the inner exit code is preserved so the
///    stage runner can decide whether the *command* succeeded; this
///    helper does not interpret it).
/// 4. On `Err(SandboxError::Unavailable|AdmissionRejected|...)` —
///    converts to [`FactoryError::SandboxRefusal`] with a category
///    label and diagnostic, so the pipeline halts cleanly. The
///    factory-engine does not fall back to host execution under any
///    error variant.
///
/// FR-009 is a contract invariant: this helper applies it uniformly
/// across `NullSandboxClient`, the (future) local-container backend,
/// and the (future) K8s backend.
pub async fn exercise(
    client: &dyn SandboxClient,
    request: SandboxRequest,
) -> Result<SandboxExecutionRecord, FactoryError> {
    if let Err(e) = request.validate() {
        return Err(FactoryError::SandboxRefusal {
            category: "request-validation",
            diagnostic: e.to_string(),
        });
    }
    match client.execute(request).await {
        Ok(execution) => Ok(SandboxExecutionRecord::from_outcome(execution)),
        Err(e) => Err(FactoryError::SandboxRefusal {
            category: e.category(),
            diagnostic: e.to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use factory_contracts::sandbox::{
        EgressAllowlistEntry, IsolationTier, ResourceCeilings, SandboxRequest,
        DEFAULT_PID_LIMIT, DEFAULT_TTL_SECONDS,
    };
    use std::collections::BTreeMap;

    fn request() -> SandboxRequest {
        SandboxRequest {
            command: vec!["echo".into(), "hi".into()],
            input_artifacts: vec![],
            egress_allowlist: vec![EgressAllowlistEntry {
                hostname: "registry.npmjs.org".into(),
            }],
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
    async fn null_client_always_fails_closed() {
        let client = NullSandboxClient::new();
        let outcome = client.execute(request()).await;
        match outcome {
            Err(SandboxError::Unavailable(msg)) => {
                assert!(msg.contains("fail-closed") || msg.contains("no sandbox backend"));
            }
            other => panic!("expected Unavailable, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn null_client_preserves_custom_diagnostic() {
        let client = NullSandboxClient::with_diagnostic("cluster unreachable: dns timeout");
        let err = client.execute(request()).await.unwrap_err();
        match err {
            SandboxError::Unavailable(msg) => {
                assert_eq!(msg, "cluster unreachable: dns timeout");
            }
            other => panic!("expected Unavailable, got {other:?}"),
        }
    }

    #[test]
    fn null_client_backend_descriptor() {
        let client = NullSandboxClient::new();
        let bd = client.backend_descriptor();
        assert_eq!(bd.name, "null-fail-closed");
        assert!(!bd.version.is_empty());
    }

    #[test]
    fn error_category_labels() {
        let validation_err: SandboxRequestValidationError =
            SandboxRequestValidationError::EmptyCommand;
        assert_eq!(
            SandboxError::Unavailable("x".into()).category(),
            "unavailable"
        );
        assert_eq!(
            SandboxError::AdmissionRejected("x".into()).category(),
            "admission-rejected"
        );
        assert_eq!(
            SandboxError::ExecutionFailure("x".into()).category(),
            "execution-failure"
        );
        assert_eq!(
            SandboxError::RequestValidation(validation_err).category(),
            "request-validation"
        );
    }

    // ── exercise() dispatcher (FR-001 + FR-009) ─────────────────────

    #[tokio::test]
    async fn exercise_halts_on_null_client() {
        let client = NullSandboxClient::new();
        let err = super::exercise(&client, request()).await.unwrap_err();
        match err {
            FactoryError::SandboxRefusal { category, diagnostic } => {
                assert_eq!(category, "unavailable");
                assert!(
                    diagnostic.contains("fail-closed")
                        || diagnostic.contains("no sandbox backend")
                );
            }
            other => panic!("expected SandboxRefusal::unavailable, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn exercise_rejects_invalid_request_before_dispatch() {
        let client = NullSandboxClient::new();
        let mut bad = request();
        bad.command.clear();
        let err = super::exercise(&client, bad).await.unwrap_err();
        match err {
            FactoryError::SandboxRefusal { category, diagnostic } => {
                assert_eq!(category, "request-validation");
                assert!(diagnostic.contains("command"));
            }
            other => panic!("expected SandboxRefusal::request-validation, got {other:?}"),
        }
    }

    // A trivial backend that always succeeds — used to verify the
    // success path of exercise() converts cleanly into the cert record.
    struct AlwaysOkBackend;

    #[async_trait]
    impl SandboxClient for AlwaysOkBackend {
        async fn execute(
            &self,
            request: SandboxRequest,
        ) -> Result<SandboxExecution, SandboxError> {
            Ok(SandboxExecution {
                command: request.command,
                input_artifact_hashes: BTreeMap::new(),
                output_artifact_hashes: BTreeMap::new(),
                resource_peak: factory_contracts::sandbox::ResourcePeak::default(),
                isolation_tier: IsolationTier::RestrictedContainer,
                runtime_descriptor: "test-backend-v0".into(),
                deadline_hit: false,
                exit_code: 0,
            })
        }
        fn backend_descriptor(&self) -> BackendDescriptor {
            BackendDescriptor {
                name: "test-always-ok".into(),
                version: "0.0.1".into(),
            }
        }
    }

    #[tokio::test]
    async fn exercise_success_produces_cert_record_with_numeric_tier() {
        let client = AlwaysOkBackend;
        let record = super::exercise(&client, request()).await.unwrap();
        assert_eq!(record.isolation_tier, 2);
        assert_eq!(record.command, vec!["echo", "hi"]);
        assert_eq!(record.runtime_descriptor, "test-backend-v0");
        assert!(!record.deadline_hit);
        assert_eq!(record.exit_code, 0);
    }

    // A backend that rejects on admission — verifies FR-009 halts
    // identically across error categories.
    struct AlwaysAdmissionRejectedBackend;

    #[async_trait]
    impl SandboxClient for AlwaysAdmissionRejectedBackend {
        async fn execute(
            &self,
            _request: SandboxRequest,
        ) -> Result<SandboxExecution, SandboxError> {
            Err(SandboxError::AdmissionRejected(
                "minimum isolation tier unmet".into(),
            ))
        }
        fn backend_descriptor(&self) -> BackendDescriptor {
            BackendDescriptor {
                name: "test-admission-reject".into(),
                version: "0.0.1".into(),
            }
        }
    }

    #[tokio::test]
    async fn exercise_halts_on_admission_rejection() {
        let client = AlwaysAdmissionRejectedBackend;
        let err = super::exercise(&client, request()).await.unwrap_err();
        match err {
            FactoryError::SandboxRefusal { category, diagnostic } => {
                assert_eq!(category, "admission-rejected");
                assert!(diagnostic.contains("minimum isolation tier"));
            }
            other => panic!("expected SandboxRefusal::admission-rejected, got {other:?}"),
        }
    }
}
