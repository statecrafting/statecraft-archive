// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/185-sandbox-local-container-backend/spec.md — §3 FR-A1..FR-A4

//! Admission rule checks for the local-container backend.
//!
//! Spec 162's `SandboxRequest::validate` covers contract-level
//! invariants. These admission rules layer the **backend-specific**
//! refusals on top: things the local-container backend cannot do given
//! Phase 1 scope (no egress proxy yet) or Phase 1 constraints
//! (no input materialisation surface yet).
//!
//! Each rule returns `Result<(), SandboxError::AdmissionRejected>` so
//! the dispatcher can short-circuit cleanly before any container API
//! call.

use factory_contracts::sandbox::{IsolationTier, SandboxRequest};
use factory_engine::sandbox::SandboxError;

/// Run every Phase 1 admission rule for the local-container backend.
///
/// Order matters only for diagnostic clarity — the first violation
/// short-circuits.
pub(crate) fn check(request: &SandboxRequest) -> Result<(), SandboxError> {
    egress_allowlist_must_be_empty(request)?;
    minimum_tier_must_be_realisable(request)?;
    input_artifacts_must_be_empty(request)?;
    Ok(())
}

/// FR-A1 — non-empty egress allowlist is rejected until the egress
/// proxy follow-up (FU-001) lands.
fn egress_allowlist_must_be_empty(request: &SandboxRequest) -> Result<(), SandboxError> {
    if request.egress_allowlist.is_empty() {
        return Ok(());
    }
    let hostnames: Vec<&str> = request
        .egress_allowlist
        .iter()
        .map(|e| e.hostname.as_str())
        .collect();
    Err(SandboxError::AdmissionRejected(format!(
        "non-empty egress allowlist {hostnames:?} requires the egress-proxy follow-up (spec 185 FU-001); \
         Phase 1 supports only network=none execution"
    )))
}

/// FR-A2 — `IsolationTier::SandboxRuntime` (Tier 1) is not realisable
/// by the local-container backend until the sandbox-runtime
/// auto-detection follow-up (FU-002) lands.
fn minimum_tier_must_be_realisable(request: &SandboxRequest) -> Result<(), SandboxError> {
    match request.minimum_isolation_tier {
        IsolationTier::SandboxRuntime => Err(SandboxError::AdmissionRejected(
            "requested minimum isolation tier sandbox-runtime; backend realises restricted-container (tier 2) — \
             upgrade requires the runtime-class probe follow-up (spec 185 FU-002)"
                .into(),
        )),
        // Forbidden is rejected at request validation; we never see it
        // here, but keep the match exhaustive.
        IsolationTier::Forbidden => Err(SandboxError::AdmissionRejected(
            "minimum_isolation_tier forbidden is rejected at request validation; reached admission unexpectedly"
                .into(),
        )),
        IsolationTier::RestrictedContainer => Ok(()),
    }
}

/// FR-A5 (added) — input materialisation surface is not yet defined
/// (spec 162's `InputArtifact` carries path + sha256 but no bytes
/// source). FU-006 will define it; Phase 1 rejects non-empty input
/// lists rather than guessing where the bytes come from.
fn input_artifacts_must_be_empty(request: &SandboxRequest) -> Result<(), SandboxError> {
    if request.input_artifacts.is_empty() {
        return Ok(());
    }
    Err(SandboxError::AdmissionRejected(format!(
        "non-empty input_artifacts ({} entries) require the input-materialisation surface (spec 185 FU-006); \
         Phase 1 supports only empty input lists",
        request.input_artifacts.len()
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

    fn baseline() -> SandboxRequest {
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

    #[test]
    fn baseline_passes() {
        assert!(check(&baseline()).is_ok());
    }

    #[test]
    fn non_empty_egress_allowlist_rejected_with_fu_001() {
        let mut r = baseline();
        r.egress_allowlist.push(EgressAllowlistEntry {
            hostname: "registry.npmjs.org".into(),
        });
        match check(&r).unwrap_err() {
            SandboxError::AdmissionRejected(msg) => {
                assert!(msg.contains("registry.npmjs.org"));
                assert!(msg.contains("FU-001"));
                assert!(msg.contains("network=none"));
            }
            other => panic!("expected AdmissionRejected, got {other:?}"),
        }
    }

    #[test]
    fn sandbox_runtime_tier_rejected_with_fu_002() {
        let mut r = baseline();
        r.minimum_isolation_tier = IsolationTier::SandboxRuntime;
        match check(&r).unwrap_err() {
            SandboxError::AdmissionRejected(msg) => {
                assert!(msg.contains("sandbox-runtime"));
                assert!(msg.contains("FU-002"));
                assert!(msg.contains("tier 2"));
            }
            other => panic!("expected AdmissionRejected, got {other:?}"),
        }
    }

    #[test]
    fn non_empty_input_artifacts_rejected_with_fu_006() {
        let mut r = baseline();
        r.input_artifacts.push(InputArtifact {
            path: "/in/source.rs".into(),
            sha256: "a".repeat(64),
        });
        match check(&r).unwrap_err() {
            SandboxError::AdmissionRejected(msg) => {
                assert!(msg.contains("input_artifacts"));
                assert!(msg.contains("FU-006"));
                assert!(msg.contains("1 entries"));
            }
            other => panic!("expected AdmissionRejected, got {other:?}"),
        }
    }
}
