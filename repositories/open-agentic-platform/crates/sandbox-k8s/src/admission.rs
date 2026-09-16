// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/186-sandbox-k8s-backend/spec.md — §2.5, §3 FR-A1..FR-A3

//! Phase 1 admission rules for the K8s sandbox backend.
//!
//! Spec 186 §2.5 names three input-shape constraints that are
//! enforced at admission and deferred as named FU items. The two
//! cluster-independent rules (FR-A1, FR-A2) live here; the
//! Tier 1-availability check (FR-A3) lives in `runtime_class.rs`
//! because it needs cluster state. Admission runs BEFORE the
//! kube-rs probe so misconfigured requests fail closed even on a
//! [`crate::K8sSandboxClient::unavailable`] client.

use factory_contracts::sandbox::SandboxRequest;
use factory_engine::sandbox::SandboxError;

/// Run the cluster-independent admission rules. Returns `Ok(())` to
/// hand off to the runtime; `Err(SandboxError::AdmissionRejected)`
/// otherwise.
pub fn check(request: &SandboxRequest) -> Result<(), SandboxError> {
    reject_non_empty_egress(request)?;
    reject_non_empty_input_artifacts(request)?;
    Ok(())
}

/// FR-A1 — non-empty `egress_allowlist` is rejected.
///
/// Phase 1 does not yet wire FQDN egress rules into the
/// per-execution NetworkPolicy. The reasons are operational and
/// documented in spec 186 §2.5 / FU-001. Until that wiring lands,
/// any request that declares allowlist entries is refused — the
/// alternative would be to silently downgrade the request to
/// "all egress denied," which would violate the contract's
/// principle of explicit refusal (spec 162 §2.1).
fn reject_non_empty_egress(request: &SandboxRequest) -> Result<(), SandboxError> {
    if request.egress_allowlist.is_empty() {
        return Ok(());
    }
    let hosts: Vec<String> = request
        .egress_allowlist
        .iter()
        .map(|e| e.hostname.clone())
        .collect();
    Err(SandboxError::AdmissionRejected(format!(
        "spec 186 FU-001: K8s backend has not yet wired FQDN egress NetworkPolicy \
         rules; cannot honour egress_allowlist {hosts:?}. Set egress_allowlist=[] \
         (deny-all) or wait for the FU-001 follow-up under spec 186."
    )))
}

/// FR-A2 — non-empty `input_artifacts` is rejected.
///
/// Phase 1 does not yet wire the streaming-tar input path
/// (`kube::Api::<Pod>::exec` against `tar -x`). Documented in spec
/// 186 §2.5 / FU-002. Until that wiring lands, a request that
/// carries input artifacts cannot be admitted — the alternative
/// would be to silently drop the inputs, which would produce a
/// certificate binding that does not reflect what the sandbox
/// actually saw.
fn reject_non_empty_input_artifacts(request: &SandboxRequest) -> Result<(), SandboxError> {
    if request.input_artifacts.is_empty() {
        return Ok(());
    }
    let paths: Vec<String> = request
        .input_artifacts
        .iter()
        .map(|a| a.path.clone())
        .collect();
    Err(SandboxError::AdmissionRejected(format!(
        "spec 186 FU-002: K8s backend has not yet wired streaming-tar input \
         artifact injection; cannot honour input_artifacts {paths:?}. Set \
         input_artifacts=[] or wait for the FU-002 follow-up under spec 186."
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use factory_contracts::sandbox::{
        EgressAllowlistEntry, InputArtifact, IsolationTier, ResourceCeilings,
        SandboxRequest, DEFAULT_PID_LIMIT, DEFAULT_TTL_SECONDS,
    };
    use std::collections::BTreeMap;

    fn baseline_request() -> SandboxRequest {
        SandboxRequest {
            command: vec!["echo".into(), "hi".into()],
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

    #[test]
    fn empty_allowlist_and_inputs_admitted() {
        assert!(check(&baseline_request()).is_ok());
    }

    #[test]
    fn non_empty_egress_rejected_with_fu_001() {
        let mut req = baseline_request();
        req.egress_allowlist.push(EgressAllowlistEntry {
            hostname: "registry.npmjs.org".into(),
        });
        let err = check(&req).unwrap_err();
        match err {
            SandboxError::AdmissionRejected(msg) => {
                assert!(msg.contains("FU-001"));
                assert!(msg.contains("registry.npmjs.org"));
                assert!(msg.contains("spec 186"));
            }
            other => panic!("expected AdmissionRejected, got {other:?}"),
        }
    }

    #[test]
    fn multiple_allowlist_entries_all_named_in_diagnostic() {
        let mut req = baseline_request();
        req.egress_allowlist.push(EgressAllowlistEntry {
            hostname: "registry.npmjs.org".into(),
        });
        req.egress_allowlist.push(EgressAllowlistEntry {
            hostname: "ghcr.io".into(),
        });
        let err = check(&req).unwrap_err();
        match err {
            SandboxError::AdmissionRejected(msg) => {
                assert!(msg.contains("registry.npmjs.org"));
                assert!(msg.contains("ghcr.io"));
            }
            other => panic!("expected AdmissionRejected, got {other:?}"),
        }
    }

    #[test]
    fn non_empty_input_artifacts_rejected_with_fu_002() {
        let mut req = baseline_request();
        req.input_artifacts.push(InputArtifact {
            path: "/in/main.rs".into(),
            sha256: "ab".repeat(32),
        });
        let err = check(&req).unwrap_err();
        match err {
            SandboxError::AdmissionRejected(msg) => {
                assert!(msg.contains("FU-002"));
                assert!(msg.contains("/in/main.rs"));
                assert!(msg.contains("spec 186"));
            }
            other => panic!("expected AdmissionRejected, got {other:?}"),
        }
    }

    #[test]
    fn egress_checked_before_input_artifacts() {
        // Both bad — egress error wins (rule ordering matches §2.5
        // ordering of FU-001 then FU-002).
        let mut req = baseline_request();
        req.egress_allowlist.push(EgressAllowlistEntry {
            hostname: "x.example".into(),
        });
        req.input_artifacts.push(InputArtifact {
            path: "/in/y".into(),
            sha256: "00".repeat(32),
        });
        let err = check(&req).unwrap_err();
        match err {
            SandboxError::AdmissionRejected(msg) => {
                assert!(msg.contains("FU-001"));
                assert!(!msg.contains("FU-002"));
            }
            other => panic!("expected AdmissionRejected, got {other:?}"),
        }
    }
}
