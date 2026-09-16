// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/162-sandbox-execution-contract/spec.md — §2.3, §3 FR-001..FR-009

//! Backend-agnostic sandbox contract types (spec 162).
//!
//! These types describe the *contract* every sandbox backend must honour;
//! they intentionally carry no K8s, Podman, or OCI types. Backends translate
//! a `SandboxRequest` into backend-specific primitives and translate their
//! backend-specific outcomes into a `SandboxExecution`.
//!
//! The trait itself (`SandboxClient`) lives in `factory-engine/src/sandbox/`
//! because it is async and orchestration-shaped; the types here are pure
//! data so they can be serialised into the governance certificate
//! (`sandbox-execution` stage record, spec 102 §FR-007 extended by 162
//! §FR-008) without dragging the orchestration runtime into the
//! verifier's dependency closure.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

// ── Tier normalisation (162 §2.2) ────────────────────────────────────

/// Isolation strength tier reported by a sandbox backend.
///
/// Normalised across all backends so the governance-certificate verifier
/// reasons about isolation strength without parsing backend-specific
/// fields. Per 162 §2.2 the tiers are:
///
/// - `SandboxRuntime` (Tier 1) — purpose-built isolation runtime: gVisor,
///   Firecracker, Kata. Strongest.
/// - `RestrictedContainer` (Tier 2) — rootless OCI container with
///   read-only rootfs, seccomp default, no host mounts beyond the
///   per-execution input/output pair.
/// - `Forbidden` (Tier 3) — "no usable isolation available." Reserved
///   for refusal diagnostics; MUST NOT appear in a successful
///   `SandboxExecution` outcome. FR-009 codifies the refusal.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum IsolationTier {
    SandboxRuntime,
    RestrictedContainer,
    Forbidden,
}

impl IsolationTier {
    /// Numeric form (1/2/3) for emission into the certificate. Matches
    /// 162 §2.2 wording.
    pub fn as_numeric(self) -> u8 {
        match self {
            IsolationTier::SandboxRuntime => 1,
            IsolationTier::RestrictedContainer => 2,
            IsolationTier::Forbidden => 3,
        }
    }
}

// ── Request shape (162 FR-002..FR-007) ───────────────────────────────

/// Hard ceiling on TTL — 15 minutes (162 §3 FR-003).
pub const TTL_HARD_CEILING_SECONDS: u32 = 900;
/// Default TTL — 5 minutes (162 §3 FR-003).
pub const DEFAULT_TTL_SECONDS: u32 = 300;
/// Default PID ceiling.
pub const DEFAULT_PID_LIMIT: u32 = 1024;

/// Per-execution resource ceilings — required on every request (FR-004).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceCeilings {
    pub cpu_milli_limit: u32,
    pub cpu_milli_request: u32,
    pub memory_bytes_limit: u64,
    pub memory_bytes_request: u64,
    pub pid_limit: u32,
}

/// Egress allowlist entry — TLS-verified hostname (FR-002).
///
/// Bare hostname only. No port (backends honour 443 for HTTPS-only egress);
/// no IP address (FR-002 forbids pinning to IPs because IP rotation in
/// modern CDNs makes them brittle and the TLS verification is the
/// integrity-binding act).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct EgressAllowlistEntry {
    pub hostname: String,
}

/// Input artifact mounted read-only into the sandbox.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InputArtifact {
    /// Sandbox-mount-relative path the command will see.
    pub path: String,
    /// SHA-256 of the content at request-build time.
    pub sha256: String,
}

/// Output artifact emitted by the sandbox after execution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OutputArtifact {
    pub path: String,
    pub sha256: String,
}

/// A single request to a `SandboxClient`. Backend-agnostic.
///
/// Backends MUST call [`SandboxRequest::validate`] before any
/// backend-specific admission; rejection at validation produces
/// [`SandboxRequestValidationError`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxRequest {
    /// Argv. Backends MUST NOT shell-interpret.
    pub command: Vec<String>,
    pub input_artifacts: Vec<InputArtifact>,
    /// Egress allowlist (default empty == no egress) — FR-002.
    #[serde(default)]
    pub egress_allowlist: Vec<EgressAllowlistEntry>,
    /// TTL in seconds. Default 300; ceiling 900 — FR-003.
    pub ttl_seconds: u32,
    /// Resource ceilings — required (FR-004).
    pub resource_ceilings: ResourceCeilings,
    /// Minimum isolation tier the caller requires. A backend that cannot
    /// satisfy returns `AdmissionRejected`. `Forbidden` is not a valid
    /// minimum (rejected at validation).
    pub minimum_isolation_tier: IsolationTier,
    /// Environment variables to set inside the sandbox.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SandboxRequestValidationError {
    #[error("command must be non-empty")]
    EmptyCommand,
    #[error("ttl_seconds must be > 0")]
    ZeroTtl,
    #[error("ttl_seconds={requested} exceeds hard ceiling {ceiling}")]
    TtlOverCeiling { requested: u32, ceiling: u32 },
    #[error("{0} request value exceeds limit value")]
    RequestExceedsLimit(&'static str),
    #[error("resource ceilings must be non-zero (cpu_milli_limit / memory_bytes_limit / pid_limit)")]
    MissingCeiling,
    #[error("minimum_isolation_tier may not be Forbidden")]
    ForbiddenMinTier,
    #[error("egress allowlist entry must be a TLS-verified hostname, got {0:?}")]
    AllowlistMustBeHostname(String),
}

impl SandboxRequest {
    /// Validate against contract invariants (162 §3 FR-002..FR-004).
    pub fn validate(&self) -> Result<(), SandboxRequestValidationError> {
        if self.command.is_empty() {
            return Err(SandboxRequestValidationError::EmptyCommand);
        }
        if self.ttl_seconds == 0 {
            return Err(SandboxRequestValidationError::ZeroTtl);
        }
        if self.ttl_seconds > TTL_HARD_CEILING_SECONDS {
            return Err(SandboxRequestValidationError::TtlOverCeiling {
                requested: self.ttl_seconds,
                ceiling: TTL_HARD_CEILING_SECONDS,
            });
        }
        let r = &self.resource_ceilings;
        if r.cpu_milli_limit == 0 || r.memory_bytes_limit == 0 || r.pid_limit == 0 {
            return Err(SandboxRequestValidationError::MissingCeiling);
        }
        if r.cpu_milli_request > r.cpu_milli_limit {
            return Err(SandboxRequestValidationError::RequestExceedsLimit("cpu"));
        }
        if r.memory_bytes_request > r.memory_bytes_limit {
            return Err(SandboxRequestValidationError::RequestExceedsLimit("memory"));
        }
        if matches!(self.minimum_isolation_tier, IsolationTier::Forbidden) {
            return Err(SandboxRequestValidationError::ForbiddenMinTier);
        }
        for entry in &self.egress_allowlist {
            if entry.hostname.is_empty()
                || entry.hostname.parse::<std::net::IpAddr>().is_ok()
            {
                return Err(SandboxRequestValidationError::AllowlistMustBeHostname(
                    entry.hostname.clone(),
                ));
            }
        }
        Ok(())
    }
}

// ── Outcome shape (FR-008) ───────────────────────────────────────────

/// Peak resource utilisation observed during execution.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResourcePeak {
    pub cpu_milli_peak: u32,
    pub memory_bytes_peak: u64,
    pub pid_peak: u32,
}

/// Outcome of a successful `SandboxClient::execute` call.
///
/// The certificate verifier binds this to the audited stage record by
/// hashing `(command, input_artifact_hashes, output_artifact_hashes,
/// isolation_tier, runtime_descriptor)` — see spec 102 §FR-007 +
/// 162 §FR-008. `runtime_descriptor` is treated as opaque content by the
/// verifier; backends use it to convey diagnostic identity (backend name +
/// version + selected runtime) without leaking backend-specific
/// primitives into the certificate shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxExecution {
    /// Argv echoed back — the verifier binds this exact form.
    pub command: Vec<String>,
    /// Pre-execution input hashes (binding). Sorted-by-path BTreeMap so
    /// canonical-JSON output is stable.
    pub input_artifact_hashes: BTreeMap<String, String>,
    /// Post-execution output hashes (binding).
    pub output_artifact_hashes: BTreeMap<String, String>,
    /// Peak resource utilisation observed.
    pub resource_peak: ResourcePeak,
    /// Realised isolation tier. MUST NOT be `Forbidden` for a successful
    /// outcome — the contract forbids it (FR-009).
    pub isolation_tier: IsolationTier,
    /// Opaque backend identity + version, base64-encoded. Verifier treats
    /// this as a binary fingerprint. Backends are free to format the
    /// pre-encoded bytes however they want (compact JSON, MessagePack,
    /// custom) so long as the bytes are deterministic for a given
    /// backend build + runtime selection.
    pub runtime_descriptor: String,
    /// True iff the TTL fired and the execution was terminated.
    pub deadline_hit: bool,
    /// Process exit code.
    pub exit_code: i32,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn baseline_ceilings() -> ResourceCeilings {
        ResourceCeilings {
            cpu_milli_limit: 500,
            cpu_milli_request: 100,
            memory_bytes_limit: 512 * 1024 * 1024,
            memory_bytes_request: 128 * 1024 * 1024,
            pid_limit: DEFAULT_PID_LIMIT,
        }
    }

    fn baseline_request() -> SandboxRequest {
        SandboxRequest {
            command: vec!["echo".into(), "hello".into()],
            input_artifacts: vec![],
            egress_allowlist: vec![],
            ttl_seconds: DEFAULT_TTL_SECONDS,
            resource_ceilings: baseline_ceilings(),
            minimum_isolation_tier: IsolationTier::RestrictedContainer,
            env: BTreeMap::new(),
        }
    }

    #[test]
    fn baseline_request_validates() {
        assert!(baseline_request().validate().is_ok());
    }

    #[test]
    fn empty_command_rejected() {
        let mut r = baseline_request();
        r.command.clear();
        assert_eq!(
            r.validate().unwrap_err(),
            SandboxRequestValidationError::EmptyCommand
        );
    }

    #[test]
    fn zero_ttl_rejected() {
        let mut r = baseline_request();
        r.ttl_seconds = 0;
        assert_eq!(
            r.validate().unwrap_err(),
            SandboxRequestValidationError::ZeroTtl
        );
    }

    #[test]
    fn ttl_over_ceiling_rejected() {
        let mut r = baseline_request();
        r.ttl_seconds = TTL_HARD_CEILING_SECONDS + 1;
        match r.validate().unwrap_err() {
            SandboxRequestValidationError::TtlOverCeiling { requested, ceiling } => {
                assert_eq!(requested, TTL_HARD_CEILING_SECONDS + 1);
                assert_eq!(ceiling, TTL_HARD_CEILING_SECONDS);
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn requests_exceeding_limits_rejected() {
        let mut r = baseline_request();
        r.resource_ceilings.cpu_milli_request = r.resource_ceilings.cpu_milli_limit + 1;
        assert_eq!(
            r.validate().unwrap_err(),
            SandboxRequestValidationError::RequestExceedsLimit("cpu")
        );

        let mut r = baseline_request();
        r.resource_ceilings.memory_bytes_request =
            r.resource_ceilings.memory_bytes_limit + 1;
        assert_eq!(
            r.validate().unwrap_err(),
            SandboxRequestValidationError::RequestExceedsLimit("memory")
        );
    }

    #[test]
    fn zero_ceiling_rejected() {
        let mut r = baseline_request();
        r.resource_ceilings.cpu_milli_limit = 0;
        assert_eq!(
            r.validate().unwrap_err(),
            SandboxRequestValidationError::MissingCeiling
        );
    }

    #[test]
    fn forbidden_min_tier_rejected() {
        let mut r = baseline_request();
        r.minimum_isolation_tier = IsolationTier::Forbidden;
        assert_eq!(
            r.validate().unwrap_err(),
            SandboxRequestValidationError::ForbiddenMinTier
        );
    }

    #[test]
    fn ip_in_allowlist_rejected() {
        let mut r = baseline_request();
        r.egress_allowlist.push(EgressAllowlistEntry {
            hostname: "1.2.3.4".into(),
        });
        match r.validate().unwrap_err() {
            SandboxRequestValidationError::AllowlistMustBeHostname(h) => {
                assert_eq!(h, "1.2.3.4");
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn empty_hostname_rejected() {
        let mut r = baseline_request();
        r.egress_allowlist.push(EgressAllowlistEntry {
            hostname: "".into(),
        });
        assert!(matches!(
            r.validate().unwrap_err(),
            SandboxRequestValidationError::AllowlistMustBeHostname(_)
        ));
    }

    #[test]
    fn valid_hostnames_accepted() {
        let mut r = baseline_request();
        r.egress_allowlist.push(EgressAllowlistEntry {
            hostname: "registry.npmjs.org".into(),
        });
        r.egress_allowlist.push(EgressAllowlistEntry {
            hostname: "ghcr.io".into(),
        });
        assert!(r.validate().is_ok());
    }

    #[test]
    fn request_serde_roundtrip() {
        let r = baseline_request();
        let json = serde_json::to_string(&r).unwrap();
        let r2: SandboxRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(r, r2);
    }

    #[test]
    fn execution_serde_roundtrip() {
        let mut input = BTreeMap::new();
        input.insert("/in/source.rs".to_string(), "abcd".repeat(16));
        let mut output = BTreeMap::new();
        output.insert("/out/binary".to_string(), "1234".repeat(16));
        let ex = SandboxExecution {
            command: vec!["cargo".into(), "test".into()],
            input_artifact_hashes: input,
            output_artifact_hashes: output,
            resource_peak: ResourcePeak {
                cpu_milli_peak: 250,
                memory_bytes_peak: 1024 * 1024,
                pid_peak: 42,
            },
            isolation_tier: IsolationTier::RestrictedContainer,
            runtime_descriptor: "AAECAw==".into(),
            deadline_hit: false,
            exit_code: 0,
        };
        let json = serde_json::to_string(&ex).unwrap();
        let ex2: SandboxExecution = serde_json::from_str(&json).unwrap();
        assert_eq!(ex, ex2);
    }

    #[test]
    fn isolation_tier_numeric() {
        assert_eq!(IsolationTier::SandboxRuntime.as_numeric(), 1);
        assert_eq!(IsolationTier::RestrictedContainer.as_numeric(), 2);
        assert_eq!(IsolationTier::Forbidden.as_numeric(), 3);
    }

    #[test]
    fn isolation_tier_serde_kebab() {
        let json = serde_json::to_string(&IsolationTier::SandboxRuntime).unwrap();
        assert_eq!(json, "\"sandbox-runtime\"");
        let json = serde_json::to_string(&IsolationTier::RestrictedContainer).unwrap();
        assert_eq!(json, "\"restricted-container\"");
        let json = serde_json::to_string(&IsolationTier::Forbidden).unwrap();
        assert_eq!(json, "\"forbidden\"");
    }
}
