// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/167-born-with-spec-spine-kernel/spec.md

//! `.kernel-version` schema (spec 167 §2.3).
//!
//! The marker file is the load-bearing substrate for kernel-update
//! propagation. It records the source commit + content hash of OAP's
//! kernel at emission time, the factory-engine version that emitted it,
//! and the adapter identity + manifest hash. The propagation mechanism
//! itself is deferred to a follow-up spec (§5).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Top-level `.kernel-version` record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KernelVersion {
    pub kernel: KernelOrigin,
    pub adapter: AdapterIdentity,
    /// FR-005: chosen mode — `vendor-binaries` or `pinned-toolchain`.
    pub toolchain_mode: ToolchainMode,
    /// Spec 168 FR-001 / FR-008 — identity of the per-project
    /// governance-certificate emitter + verifier binaries the tenant
    /// inherits from the kernel emission, and the pinned factory-engine
    /// version that vouches for their behaviour. Optional in the serde
    /// layer so pre-spec-168 `.kernel-version` fixtures still round-trip;
    /// post-spec-168 emission always populates it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub certificate_toolchain: Option<CertificateToolchainRef>,
}

/// Reference to the per-project governance-certificate toolchain
/// (spec 168 FR-001 / FR-008).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CertificateToolchainRef {
    /// Name of the emitter binary the kernel installs / pins.
    /// Default: `build-certificate`.
    pub emitter: String,
    /// Name of the verifier binary the kernel installs / pins.
    /// Default: `verify-certificate`.
    pub verifier: String,
    /// Pinned `factory-engine` semver — same value as
    /// [`KernelOrigin::factory_engine_version`]; duplicated here for
    /// the FR-008 "installation recorded in `.kernel-version`" check
    /// without callers having to reach into `kernel.*`.
    pub factory_engine_version: String,
}

impl CertificateToolchainRef {
    /// Construct the canonical reference for a given factory-engine version.
    pub fn for_version(factory_engine_version: impl Into<String>) -> Self {
        Self {
            emitter: "build-certificate".into(),
            verifier: "verify-certificate".into(),
            factory_engine_version: factory_engine_version.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KernelOrigin {
    /// OAP commit SHA the kernel was lifted from. Empty string when
    /// emission runs outside a git working tree (test fixtures).
    pub source_commit: String,
    /// Content hash over the gathered kernel files (gather.rs).
    pub source_hash: String,
    /// `factory-engine` semver at emission time. Sourced from CARGO_PKG_VERSION.
    pub factory_engine_version: String,
    /// ISO-8601 UTC timestamp. Excluded from determinism comparisons —
    /// callers verifying FR-009 must compare `source_hash` instead.
    pub emitted_at: DateTime<Utc>,
    /// The exact-pinned `spec-spine` npm devDependency version the project
    /// was born under (spec 209 FR-004: npm-pin verification). The statecraft
    /// Create flow's `.kernel-version` stamp (kernelVersionStamp.ts) writes
    /// this under the npm distribution shape. Optional in serde so pre-spec-209
    /// `.kernel-version` fixtures and the non-npm engine fallback (which has no
    /// npm pin) still round-trip, and so a Rust read no longer silently drops
    /// the field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec_spine_version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdapterIdentity {
    pub id: String,
    pub version: String,
    /// Content hash of the adapter manifest (or adapter-scopes entry) that
    /// drove this emission. Lets propagation distinguish kernels emitted
    /// under different adapter revisions.
    pub manifest_hash: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolchainMode {
    /// Tenant-resident binaries shipped under `<project>/tools/spec-spine/`.
    VendorBinaries,
    /// Tenant CI references a pinned OAP toolchain distribution.
    PinnedToolchain,
}

impl KernelVersion {
    /// Serialise to canonical YAML for the `.kernel-version` file.
    pub fn to_yaml(&self) -> Result<String, serde_yaml::Error> {
        serde_yaml::to_string(self)
    }

    /// Parse a `.kernel-version` YAML payload.
    pub fn from_yaml(s: &str) -> Result<Self, serde_yaml::Error> {
        serde_yaml::from_str(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn sample() -> KernelVersion {
        KernelVersion {
            kernel: KernelOrigin {
                source_commit: "0e334041".into(),
                source_hash: "abc123".into(),
                factory_engine_version: "0.1.0".into(),
                emitted_at: Utc.with_ymd_and_hms(2026, 5, 23, 12, 0, 0).unwrap(),
                spec_spine_version: Some("0.2.0".into()),
            },
            adapter: AdapterIdentity {
                id: "acme-vue-encore".into(),
                version: "0.1.0".into(),
                manifest_hash: "def456".into(),
            },
            toolchain_mode: ToolchainMode::VendorBinaries,
            certificate_toolchain: Some(CertificateToolchainRef::for_version("0.1.0")),
        }
    }

    #[test]
    fn round_trip_yaml() {
        let v = sample();
        let yaml = v.to_yaml().unwrap();
        let parsed = KernelVersion::from_yaml(&yaml).unwrap();
        assert_eq!(v, parsed);
    }

    #[test]
    fn toolchain_mode_serialises_kebab_case() {
        let yaml = serde_yaml::to_string(&ToolchainMode::VendorBinaries).unwrap();
        assert!(yaml.contains("vendor-binaries"));
        let yaml = serde_yaml::to_string(&ToolchainMode::PinnedToolchain).unwrap();
        assert!(yaml.contains("pinned-toolchain"));
    }

    #[test]
    fn certificate_toolchain_round_trips_in_yaml_and_omits_when_absent() {
        // Spec 168 FR-008 — populated field round-trips intact.
        let v = sample();
        let yaml = v.to_yaml().unwrap();
        assert!(yaml.contains("certificate_toolchain"));
        assert!(yaml.contains("emitter: build-certificate"));
        assert!(yaml.contains("verifier: verify-certificate"));
        let parsed = KernelVersion::from_yaml(&yaml).unwrap();
        assert_eq!(parsed.certificate_toolchain, v.certificate_toolchain);

        // Pre-spec-168 fixture (no certificate_toolchain field) still
        // round-trips with the field deserialising to None.
        let mut legacy = sample();
        legacy.certificate_toolchain = None;
        let legacy_yaml = legacy.to_yaml().unwrap();
        assert!(!legacy_yaml.contains("certificate_toolchain"));
        let parsed_legacy = KernelVersion::from_yaml(&legacy_yaml).unwrap();
        assert!(parsed_legacy.certificate_toolchain.is_none());
    }

    #[test]
    fn certificate_toolchain_for_version_populates_canonical_binaries() {
        let r = CertificateToolchainRef::for_version("1.2.3");
        assert_eq!(r.emitter, "build-certificate");
        assert_eq!(r.verifier, "verify-certificate");
        assert_eq!(r.factory_engine_version, "1.2.3");
    }

    #[test]
    fn spec_spine_version_round_trips_and_omits_when_absent() {
        // Spec 209 FR-004: the npm pin the TS `.kernel-version` stamp writes
        // round-trips through the Rust struct instead of being dropped.
        let v = sample();
        let yaml = v.to_yaml().unwrap();
        assert!(yaml.contains("spec_spine_version: 0.2.0"));
        let parsed = KernelVersion::from_yaml(&yaml).unwrap();
        assert_eq!(parsed.kernel.spec_spine_version.as_deref(), Some("0.2.0"));

        // A pre-spec-209 stamp without the field deserialises to None and the
        // field is omitted on re-serialisation (no churn for legacy fixtures).
        let mut legacy = sample();
        legacy.kernel.spec_spine_version = None;
        let legacy_yaml = legacy.to_yaml().unwrap();
        assert!(!legacy_yaml.contains("spec_spine_version"));
        let parsed_legacy = KernelVersion::from_yaml(&legacy_yaml).unwrap();
        assert!(parsed_legacy.kernel.spec_spine_version.is_none());
    }

    #[test]
    fn ts_stamp_shape_does_not_yet_round_trip_through_rust() {
        // Spec 209 finding: the statecraft TS `.kernel-version` stamp
        // (kernelVersionStamp.ts) writes a reduced `kernel` shape
        // (source_commit, spec_spine_version, emitted_at) and omits the
        // `source_hash` + `factory_engine_version` this struct requires.
        // Adding `spec_spine_version` lets Rust recognise the pin, but a full
        // Rust read of the TS stamp still fails on the missing required fields.
        // FR-004's vended-tool npm-pin check therefore reads the pin in the
        // tenant CI (template), NOT via this struct, until a TS<->Rust
        // `.kernel-version` schema reconciliation lands. This test pins that
        // boundary so the residual stays visible, not silent.
        let ts_stamp = r#"
schema_version: "1.0.0"
toolchain_mode: pinned-toolchain
kernel:
  source_commit: "abc1234"
  spec_spine_version: "0.2.0"
  emitted_at: "2026-06-15T12:00:00Z"
adapter:
  id: "acme-vue-encore"
  version: "0.1.0"
  manifest_hash: "def456"
"#;
        assert!(
            KernelVersion::from_yaml(ts_stamp).is_err(),
            "TS stamp unexpectedly round-trips; if the struct was reconciled, \
             update FR-004's read path and this test"
        );
    }
}
