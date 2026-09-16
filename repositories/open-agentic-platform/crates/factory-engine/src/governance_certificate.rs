// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/102-governed-excellence/spec.md — FR-002 through FR-010

//! Governance Certificate — the single JSON artifact proving the full
//! intent-to-spec-to-code-to-audit chain for a factory pipeline run.
//!
//! Generated at the end of every factory pipeline run (complete or incomplete).
//! Independently verifiable via `verify-certificate`.

use crate::inter_stage_manifest::{InterStageManifest, RunKeyChain, verify_manifest};
use crate::pipeline_state::FactoryPipelineState;
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use chrono::{DateTime, Utc};
use ed25519_dalek::{Signature, Signer as Ed25519Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::Path;

/// Schema version for the governance certificate format.
///
/// 1.3.0 introduces two optional top-level fields landing in parallel:
///   * `signer` (spec 168 §FR-003) — named identity for the principal that
///     drove the run (Rauthy JWT subject or analogous identity per spec
///     106 / 137).
///   * `interStageChain` (spec 170 §FR-007) — signed inter-stage manifest
///     chain produced by [`crate::inter_stage_manifest`].
///
/// Both fields are `skip_serializing_if = "Option::is_none"` so a
/// certificate built without them serialises byte-identically to a
/// pre-1.3.0 payload — only the version string differs. Legacy 1.2.0 /
/// 1.1.0 / 1.0.0 fixtures still pass through the verifier.
///
/// 1.2.0 (spec 162 §FR-008) introduced the optional `sandboxExecution`
/// per-stage record. 1.1.0 added Ed25519 signing (spec 102 FR-008.1);
/// the hash check is no longer the authoritative provenance check after
/// that point, but it remains as a content fingerprint inside the signed
/// payload.
///
/// 1.4.0 (spec 198 FR-005/FR-009/FR-014) added the admission-binding
/// fields — `admittedEnvelopeHash`, `goalId`, `intentCapsuleHash`, all
/// inside the hash + signature (bound at emission) — and the
/// post-emission `platformCountersign`, which is EXCLUDED from both the
/// self-hash and the engine signature (zeroed before canonicalisation)
/// so platform sealing on sync-back never invalidates the offline chain.
///
/// 1.5.0 (spec 198 FR-013 c) added `consumedOverrides` — the overrides of
/// admitted factory content the run consumed, with provenance + verified
/// state, inside the hash + signature. Empty lists are skipped in
/// serialization so override-free certificates stay byte-identical to
/// 1.4.0 payloads (only the version string differs).
///
/// 1.6.0 (spec 218 FR-001) added the optional `corpusBinding` block
/// `{ corpusAttestationHash, specSpineVersion }`, recording by reference the
/// spec-spine ledger-seal attestation (spec 023-ledger-seal) in effect at run
/// emission. It sits INSIDE the hash + signature (bound at emission, like
/// `admittedEnvelopeHash`), so tampering with the binding is caught by the
/// cert's own signature check. Absent certs still verify; absent is the named
/// "unbound" state, never silently equivalent to bound-and-verified. Skipped in
/// serialization when absent so unbound certs stay byte-identical to 1.5.0
/// payloads (only the version string differs).
///
/// 1.7.0 (spec 203 FR-003) added the optional `sbomArtifactBinding` block
/// `{ bomHash, auditHash, bomToolVersion }`, binding the content hashes of the
/// produced application's CycloneDX BOM (`.factory/sbom.cdx.json`) and
/// dependency-audit artifact (`.factory/audit.json`) into the certificate.
/// Like `corpusBinding` it sits INSIDE the hash + signature (bound at
/// emission), so tampering with either artifact is caught by
/// `verify-certificate --sbom-dir`. Absent certs still verify; absent is the
/// named "unbound" state, never silently equivalent to bound-and-verified.
/// Skipped in serialization when absent so unbound certs stay byte-identical
/// to 1.6.0 payloads (only the version string differs).
///
/// 1.8.0 (spec 202 FR-005) added the optional `budgetConsumption` record: one
/// `{axis, ceiling, actual, source, breached}` row per admitted run-budget axis
/// at termination. Like `corpusBinding`/`sbomArtifactBinding` it sits INSIDE the
/// hash + signature (bound at emission). `verify-certificate` catches raw byte
/// tamper (the signature check) and a record that is internally inconsistent or
/// structurally malformed (missing/unknown/duplicate axis, non-finite or negative
/// magnitude, or `breached` disagreeing with `actual > ceiling`). A self-consistent
/// forgery of an `actual` by the signing producer is bounded by the same key-trust
/// model as `corpusBinding`/`sbomArtifactBinding` (a self-signed receipt): the
/// per-stage records carry no per-axis totals to cross-sum, so verify does not
/// independently corroborate the magnitudes. Absent certs still verify; skipped in
/// serialization when absent so pre-1.8.0 payloads stay byte-identical.
///
/// 1.9.0 (spec 210 FR-002) added the optional `agenticPostureBinding` block
/// `{ posture, defaulted, surfaces }`, recording the produced application's own
/// declared agentic surface (Least Agency applied to outputs). Like
/// `corpusBinding`/`sbomArtifactBinding` it sits INSIDE the hash + signature
/// (bound at emission). `posture` is `none | declared | governed`; `defaulted`
/// distinguishes "authored none" (someone decided) from "defaulted none" (the
/// Build Spec omitted the field, nobody asked). `verify-certificate` catches raw
/// byte tamper (the signature check) and a self-inconsistent binding
/// (declared/governed with no surfaces, none with surfaces, a governed surface
/// with no or a non-conformant inline governance envelope), and, when
/// `--sbom-dir` is supplied, cross-checks a `none` posture against the produced
/// app's CycloneDX BOM (a watchlisted agent/LLM SDK dependency contradicts the
/// declaration; spec 210 FR-003). Absent certs still verify; skipped in
/// serialization when absent so pre-1.9.0 payloads stay byte-identical.
pub const CERTIFICATE_VERSION: &str = "1.9.0";

/// Environment-variable name carrying a base64-encoded 32-byte Ed25519 seed
/// (FR-008.1). Operator-supplied keys outside the agent's write scope.
pub const ENV_SIGNING_KEY: &str = "OAP_SIGNING_KEY";

/// Environment-variable name carrying a path to a file holding a base64-
/// encoded 32-byte Ed25519 seed (FR-008.1). Alternative to `OAP_SIGNING_KEY`.
pub const ENV_SIGNING_KEY_PATH: &str = "OAP_SIGNING_KEY_PATH";

// ── Top-level Certificate ────────────────────────────────────────────

/// A Governance Certificate proves the full chain from intent to auditable output.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GovernanceCertificate {
    pub certificate_version: String,
    pub pipeline_run_id: String,
    pub timestamp: DateTime<Utc>,
    pub status: CertificateStatus,

    pub intent: IntentRecord,
    pub build_spec: BuildSpecRecord,
    pub stages: Vec<StageRecord>,
    pub verification: VerificationRecord,
    pub proof_chain: ProofChainSummary,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compliance: Option<ComplianceRecord>,

    /// Spec 168 §FR-003 / §FR-007 — identity attribution for the principal
    /// that drove the run. Required for tenant-emit mode (per-project
    /// certificates); optional on OAP-self runs to preserve byte-for-byte
    /// compatibility with pre-1.3.0 fixtures. Anonymous signing is
    /// forbidden: when set, `Signer::subject` is non-empty after trim
    /// (constructed via `Signer::new`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signer: Option<Signer>,

    /// Spec 170 §FR-007 — signed inter-stage manifest chain. Optional
    /// for runs that did not produce signed hand-offs (legacy / pre-1.3.0
    /// fixtures); `skip_serializing_if = "Option::is_none"` keeps the
    /// canonical JSON byte-identical for those payloads so their
    /// certificate hash is unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inter_stage_chain: Option<InterStageChainRecord>,

    /// Spec 198 FR-009 — hash of the admitted governance envelope this run
    /// executed under. Inside the hash + signature (bound at emission), so
    /// the certificate is reconcilable to its admission contract.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub admitted_envelope_hash: Option<String>,

    /// Spec 198 FR-005 — stable goal identifier from the run's intent
    /// capsule (ASI01 m7).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal_id: Option<String>,

    /// Spec 198 FR-005/FR-009 — SHA-256 of the run's canonical intent
    /// capsule, as presented at grant issuance.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intent_capsule_hash: Option<String>,

    /// Spec 198 FR-013(c) — overrides of admitted factory content this run
    /// consumed, as presented by the platform's admission-gated bundle
    /// (already predicate-checked against `overrides.require_verified`).
    /// Inside the hash + signature (bound at emission) so every consumed
    /// override is traceable and revocable via its content hash (FR-010).
    /// Skipped when empty so override-free certificates serialise
    /// byte-identically to pre-1.5.0 payloads.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub consumed_overrides: Vec<ConsumedOverride>,

    /// Spec 218 FR-001: chain edge to the spec-spine ledger seal. The cert
    /// builder populates this from a hash it is GIVEN (read from an upstream
    /// attestation artifact via `OAP_CORPUS_ATTESTATION_PATH`); the cert crate
    /// never recomputes the corpus. Inside the hash + signature (bound at
    /// emission). Absent = the named "unbound" state, never silently equivalent
    /// to bound-and-verified. Skipped when absent so unbound certs stay
    /// byte-identical to pre-1.6.0 payloads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corpus_binding: Option<CorpusBinding>,

    /// Spec 203 FR-003: content binding for the produced app's CycloneDX BOM
    /// and dependency-audit artifact. The builder populates this from two
    /// hashes it is GIVEN by the emission path (spec 203 FR-001/FR-002); the
    /// cert crate never regenerates the BOM. Inside the hash + signature
    /// (bound at emission). Absent = the named "unbound" state, never silently
    /// equivalent to bound-and-verified. Skipped when absent so unbound certs
    /// stay byte-identical to pre-1.7.0 payloads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sbom_artifact_binding: Option<SbomArtifactBinding>,

    /// Spec 202 FR-005: per-axis run blast-radius consumption at termination,
    /// one row per admitted budget axis (`{axis, ceiling, actual, source,
    /// breached}`). The builder populates this from the run's `RunBudgetMeter`
    /// snapshot (the engine reads the meter, never recomputes it). Inside the
    /// hash + signature (bound at emission). Absent = the named "unmetered"
    /// state, never silently equivalent to metered-and-within-budget. Skipped
    /// when absent so pre-1.8.0 payloads stay byte-identical.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub budget_consumption: Option<Vec<BudgetAxisRecord>>,

    /// Spec 210 FR-002: the produced application's declared agentic posture
    /// (`{ posture, defaulted, surfaces }`). The builder populates this from the
    /// posture read off the frozen Build Spec by the emission path (read, never
    /// recompute). Inside the hash + signature (bound at emission). Absent = the
    /// named "unstated" state (a pre-1.9.0 cert, or a run with no readable Build
    /// Spec), never silently equivalent to an authored `none`; a run whose Build
    /// Spec is read but omits the field yields a `none`/`defaulted:true` binding.
    /// Skipped when absent so pre-1.9.0 payloads stay byte-identical.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agentic_posture_binding: Option<AgenticPostureBinding>,

    /// SHA-256 of the canonical JSON of this certificate with `certificate_hash`
    /// AND `cert_signature` set to empty string. Content-binding fingerprint
    /// inside the signed payload — not the authoritative provenance check
    /// after spec 102 FR-008.1 (see `cert_signature`).
    pub certificate_hash: String,

    /// Base64-encoded Ed25519 public key (32 bytes) — verifier checks
    /// `cert_signature` against this. Empty for pre-1.1.0 fixtures and
    /// unsigned certificates; HIAS-mode verifiers reject empty.
    /// Spec 102 FR-008.2.
    #[serde(default)]
    pub signing_public_key: String,

    /// Base64-encoded Ed25519 signature (64 bytes) over canonical JSON
    /// of the certificate with `cert_signature` set to empty string and
    /// `certificate_hash` populated. Spec 102 FR-008.1.
    #[serde(default)]
    pub cert_signature: String,

    /// Trust-posture descriptor for `signing_public_key`. Spec 102 FR-008.3.
    #[serde(default)]
    pub signing_attestation: SigningAttestation,

    /// Spec 198 FR-014 — the platform countersign applied on sync-back,
    /// after statecraft verified the engine's chain against the run-grant
    /// sequence it issued. EXCLUDED from `certificate_hash` and
    /// `cert_signature` (zeroed before canonicalisation) so sealing never
    /// invalidates the offline chain. `None` = verifiable-but-unsealed —
    /// visibly so, never silently equivalent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform_countersign: Option<PlatformCountersign>,
}

/// One admitted run-budget axis as recorded in the certificate's
/// `budget_consumption` (spec 202 FR-005). `axis` and `source` are strings (the
/// enums' canonical serde forms) so the JSON stays human-readable and
/// version-independent; [`From<orchestrator::RunBudgetConsumption>`] builds
/// these from the run's meter snapshot at emission.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetAxisRecord {
    pub axis: String,
    pub ceiling: f64,
    pub actual: f64,
    pub source: String,
    pub breached: bool,
}

/// The admitted budget axis names every well-formed `budget_consumption` record
/// must carry, derived from `factory_contracts::RunBudgetAxis::ALL` (serialized
/// the same way the `From<RunBudgetConsumption>` impl serializes an axis) so the
/// list never drifts from the enum: adding a variant (e.g. spec 202 Slice D's
/// seventh axis) automatically extends both emission and the verifier's
/// completeness/closed-set checks. `apply_defaults` always yields one admitted
/// budget per axis, so a metered record names each exactly once.
fn admitted_axis_names() -> Vec<String> {
    factory_contracts::RunBudgetAxis::ALL
        .iter()
        .filter_map(|axis| {
            serde_json::to_value(axis)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
        })
        .collect()
}

impl From<orchestrator::RunBudgetConsumption> for BudgetAxisRecord {
    fn from(c: orchestrator::RunBudgetConsumption) -> Self {
        // Serialize the axis/source enums to their canonical strings via serde
        // so this never drifts from the wire form the envelope schema uses.
        let axis = serde_json::to_value(c.axis)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_default();
        let source = serde_json::to_value(c.source)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_default();
        BudgetAxisRecord {
            axis,
            ceiling: c.ceiling,
            actual: c.actual,
            source,
            breached: c.breached,
        }
    }
}

/// Spec 198 FR-014 — the platform seal on an emitted certificate. The
/// compact JWS (`typ: oap-cert-countersign+jws`) carries the claims
/// (`certificate_sha256`, `run_id`, `grant_count`, `grant_chain_sha256`,
/// `envelope_hash`, …); `kid` resolves against the platform JWKS.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCountersign {
    pub countersign_jws: String,
    pub kid: String,
    pub countersigned_at: DateTime<Utc>,
}

/// Spec 218 FR-001: the corpus attestation binding.
///
/// Records, by reference, the spec-spine ledger-seal attestation (spec
/// 023-ledger-seal) in effect when the run certificate was emitted. The
/// `corpus_attestation_hash` is the SHA-256 of the canonical `CorpusAttestation`
/// JSON, produced by calling `spec_spine_core::attest::attestation_hash` on the
/// supplied attestation (a pure payload hash, NOT a corpus recompute). The
/// `spec_spine_version` is the tool version stamp embedded in the attestation's
/// `tool.version` field, recorded so a `--recompute` verify is meaningful only
/// under the same tool version.
///
/// This field is INSIDE `certificate_hash` and `cert_signature` (bound at
/// emission), so tampering with the binding is caught by the cert's own
/// signature check. Contrast with `platform_countersign`, which is applied
/// POST-emission on sync-back and is explicitly EXCLUDED from both the hash and
/// the signature by zeroing it before canonicalisation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CorpusBinding {
    /// SHA-256 hex of the canonical `CorpusAttestation` JSON.
    pub corpus_attestation_hash: String,
    /// `spec-spine` tool version that produced the attestation.
    pub spec_spine_version: String,
}

/// Spec 203 FR-003: the produced application's BOM + dependency-audit
/// content binding.
///
/// Records, by content hash, the CycloneDX BOM (`.factory/sbom.cdx.json`) and
/// the dependency-audit artifact (`.factory/audit.json`) emitted for the
/// produced app at scaffold completion. Both hashes are SHA-256 of the
/// artifact bytes, computed by the emission path (spec 203 FR-001/FR-002) and
/// SUPPLIED to the builder; the cert crate reads them, it never regenerates the
/// BOM (read, never recompute: the spec 218 discipline).
///
/// This field is INSIDE `certificate_hash` and `cert_signature` (bound at
/// emission), so post-hoc tampering with either artifact is caught by
/// `verify-certificate --sbom-dir` (which re-hashes the on-disk artifacts and
/// compares) and, structurally, by the cert's own signature check.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SbomArtifactBinding {
    /// SHA-256 hex of the byte content of `.factory/sbom.cdx.json`.
    pub bom_hash: String,
    /// SHA-256 hex of the byte content of `.factory/audit.json`.
    pub audit_hash: String,
    /// `@cyclonedx/cyclonedx-npm` semver used to generate the BOM.
    pub bom_tool_version: String,
}

/// Spec 203 FR-002: the typed dependency-audit artifact serialised to
/// `.factory/audit.json` for the produced application.
///
/// Factory-engine owns this schema rather than embedding whatever
/// `npm audit --json` returns (which changes between npm versions and is too
/// large to bind meaningfully). `status` is a discriminated union: `Present`
/// carries findings + severity counts; `Absent` carries a `reason`. A missing
/// scanner is recorded as visible evidence of a gap (`Absent` + reason), never
/// a silent skip (the spec 200 FR-004 posture).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SbomAuditRecord {
    /// Scanner tool name (e.g. `npm-audit`).
    pub tool: String,
    /// Scanner version when known; `None` when the tool was absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_version: Option<String>,
    /// ISO-8601 UTC timestamp of the scan attempt.
    pub ran_at: String,
    /// Whether the scan ran (`Present`) or was unavailable (`Absent`).
    pub status: SbomAuditStatus,
    /// Findings, when `status == Present`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub findings: Option<Vec<SbomAuditFinding>>,
    /// Severity roll-up, when `status == Present`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity_counts: Option<SbomSeverityCounts>,
    /// Human-readable reason, populated when `status == Absent`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Spec 203 FR-002: whether a dependency-audit scan ran or was unavailable.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SbomAuditStatus {
    /// The scanner ran and produced a report.
    Present,
    /// No scanner or advisory database was available; `reason` explains why.
    Absent,
}

/// Spec 203 FR-002: severity roll-up for a dependency-audit scan.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SbomSeverityCounts {
    pub critical: u32,
    pub high: u32,
    pub moderate: u32,
    pub low: u32,
    pub info: u32,
}

/// Spec 203 FR-002: a minimal audit finding. A subset (advisory id, severity,
/// package), not the full, non-deterministic `npm audit` payload. The record
/// is evidence of scanning, not a policy gate.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SbomAuditFinding {
    pub advisory_id: String,
    pub severity: String,
    pub package: String,
}

/// Spec 210 FR-002: the produced application's declared agentic posture, bound
/// into the certificate.
///
/// Records the posture level (`none | declared | governed`, as the canonical
/// wire string, version-independent like `BudgetAxisRecord`), whether it was
/// authored or defaulted (a Build Spec that omits `agentic_posture` resolves to
/// `none` with `defaulted: true`, so an auditor can tell "authored none" from
/// "nobody asked"), and the enumerated surfaces. Populated by the emission path
/// from the frozen Build Spec (read, never recompute). Inside the certificate
/// hash + signature (bound at emission), so tampering with the binding is caught
/// by the cert's own signature check.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgenticPostureBinding {
    /// Canonical wire form of the posture level: `none`, `declared`, or
    /// `governed`.
    pub posture: String,
    /// `true` when the Build Spec omitted `agentic_posture` and the posture was
    /// defaulted to `none`; `false` when the posture was authored.
    pub defaulted: bool,
    /// Enumerated agentic surfaces (non-empty for `declared`/`governed`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub surfaces: Vec<CertAgenticSurface>,
}

/// Spec 210 FR-002: one enumerated agentic surface, as bound in the certificate.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CertAgenticSurface {
    /// Canonical wire form of the surface kind (`model-api`, `tool-surface`,
    /// `memory-persistence`, `human-approval-point`).
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Inline governance envelope for a `governed` surface (spec 210 FR-004),
    /// carried verbatim; validated for SHAPE (must deserialize as a
    /// `factory_contracts::governance_envelope::GovernanceEnvelope`) at verify
    /// time, never recomputed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub governance_envelope: Option<serde_json::Value>,
}

impl AgenticPostureBinding {
    /// Build a binding from the Build Spec posture (or its absence). Absent
    /// (`None`) yields `none`/`defaulted: true`: the Build Spec was read but did
    /// not declare a posture. Present yields the authored posture with
    /// `defaulted: false`. The single construction seam the emission paths use
    /// (read, never recompute).
    pub fn from_build_spec(
        posture: Option<&factory_contracts::build_spec::AgenticPosture>,
    ) -> Self {
        match posture {
            None => AgenticPostureBinding {
                posture: factory_contracts::build_spec::PostureLevel::None
                    .as_str()
                    .to_string(),
                defaulted: true,
                surfaces: Vec::new(),
            },
            Some(p) => AgenticPostureBinding {
                posture: p.posture.as_str().to_string(),
                defaulted: false,
                surfaces: p
                    .surfaces
                    .iter()
                    .map(|s| CertAgenticSurface {
                        kind: s.kind.as_str().to_string(),
                        description: s.description.clone(),
                        governance_envelope: s.governance_envelope.clone(),
                    })
                    .collect(),
            },
        }
    }
}

/// Spec 198 FR-013(c) — one override of admitted factory content the run
/// consumed: artifact identity, content hash, author provenance (FR-013 b)
/// and the verified state at consumption time.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConsumedOverride {
    pub artifact_id: String,
    pub path: String,
    pub content_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
    pub verified: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verified_by: Option<String>,
}

/// Trust posture for the signing public key (spec 102 FR-008.3).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SigningAttestation {
    pub kind: SigningAttestationKind,
    /// Free-form note: operator email, key-rotation epoch, CI run URL, etc.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum SigningAttestationKind {
    /// No `signing_public_key` was set — pre-1.1.0 fixture or unsigned cert.
    /// HIAS-strict and non-strict verification both reject these once
    /// signing material is required by the runtime.
    #[default]
    Unsigned,
    /// Key generated for this run's lifetime; trust is "the run was
    /// internally consistent." Suitable for local dev.
    Ephemeral,
    /// Operator-supplied key via `OAP_SIGNING_KEY` or `OAP_SIGNING_KEY_PATH`.
    /// Trust is "the operator vouches for runs using this key."
    Operator,
    /// Signed by a Sigstore Fulcio-issued certificate and anchored to the
    /// Rekor transparency log. Required by HIAS-strict. Implementation
    /// landed in P0-3b (spec 102 FR-008.5).
    SigstoreRekor,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CertificateStatus {
    Complete,
    Incomplete,
}

// ── Inter-stage manifest chain (spec 170 FR-007) ─────────────────────

/// Run-level record of the signed inter-stage manifest chain.
///
/// Embeds the per-run key chain (root verifying key + stage ephemeral
/// verifying keys) alongside the ordered list of signed manifests. The
/// certificate verifier (`verify_certificate`) replays every manifest
/// against the chain offline (spec 170 FR-006).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InterStageChainRecord {
    pub key_chain: RunKeyChain,
    #[serde(default)]
    pub manifests: Vec<InterStageManifest>,
}

// ── Signer (spec 168 FR-003 / FR-007) ────────────────────────────────

/// Identity attribution for the principal that drove the pipeline run.
///
/// The `subject` is the principal identifier (typically a Rauthy JWT `sub`
/// for human-driven runs, or an agent identity for agent-driven runs per
/// spec 106 / 137). The `identityProvider` names the system that attested
/// the subject (e.g. `rauthy@<tenant-org>`, `github-actions@<repo>`,
/// `oap-self`). The `sessionId` is an optional run-scoped correlation id.
///
/// Constructed only via [`Signer::new`], which rejects empty/whitespace
/// `subject` so that anonymous signing cannot bypass FR-007 by submitting
/// an empty string.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Signer {
    pub subject: String,
    pub identity_provider: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

impl Signer {
    /// Construct a `Signer`. Returns `Err` if `subject` is empty or
    /// whitespace-only (FR-007: anonymous signing forbidden) or
    /// `identity_provider` is empty.
    pub fn new(
        subject: impl Into<String>,
        identity_provider: impl Into<String>,
    ) -> Result<Self, SignerError> {
        let subject = subject.into();
        let identity_provider = identity_provider.into();
        if subject.trim().is_empty() {
            return Err(SignerError::EmptySubject);
        }
        if identity_provider.trim().is_empty() {
            return Err(SignerError::EmptyIdentityProvider);
        }
        Ok(Self {
            subject,
            identity_provider,
            session_id: None,
        })
    }

    /// Attach an optional run-scoped session id.
    pub fn with_session_id(mut self, session_id: impl Into<String>) -> Self {
        self.session_id = Some(session_id.into());
        self
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SignerError {
    #[error("signer subject is empty or whitespace (FR-007); anonymous signing forbidden")]
    EmptySubject,
    #[error("signer identity_provider is empty")]
    EmptyIdentityProvider,
}

/// Errors raised when building a certificate via the fallible builder path.
#[derive(Debug, thiserror::Error)]
pub enum CertificateBuildError {
    /// Tenant emission requested but no signer was supplied — spec 168
    /// FR-007 ("a run with no identifiable signer halts before emitting").
    #[error("tenant emission requires a signer (spec 168 FR-007); none provided")]
    MissingSigner,
}

// ── Intent ───────────────────────────────────────────────────────────

/// Records the original intent that initiated the pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentRecord {
    /// SHA-256 hash of the concatenated input requirements documents.
    pub requirements_hash: String,
    /// The governing spec ID (if any).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec_id: Option<String>,
    /// SHA-256 hash of the governing spec.md at pipeline start.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec_hash: Option<String>,
}

// ── Build Spec ───────────────────────────────────────────────────────

/// Records the frozen Build Spec and its approval.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildSpecRecord {
    /// SHA-256 hash of the frozen Build Spec YAML.
    pub hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_record: Option<ApprovalRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRecord {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approved_by: Option<String>,
    pub approved_at: DateTime<Utc>,
    pub gate_type: String,
}

// ── Stages ───────────────────────────────────────────────────────────

/// Per-stage record in the certificate.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageRecord {
    pub stage_id: String,
    pub status: StageOutcome,
    /// SHA-256 hashes of all output artifacts, keyed by artifact name.
    pub artifact_hashes: BTreeMap<String, String>,
    pub gate_result: Option<GateResultRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    /// Spec 162 §FR-008 — sandbox-execution record. Populated when the
    /// stage exercised adapter-emitted code through a `SandboxClient`
    /// (lint / test / build / run-once). The fields bind the executed
    /// command, the input artifact hashes (pre-execution), the output
    /// artifact hashes (post-execution), the resource utilisation peak,
    /// the realised isolation tier (1/2/3), the opaque runtime
    /// descriptor, and whether the TTL fired. Pre-1.2.0 fixtures omit
    /// the field; `skip_serializing_if = "Option::is_none"` keeps the
    /// canonical JSON byte-identical for legacy stages so their
    /// certificate hash is invariant under the field's introduction.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sandbox_execution: Option<SandboxExecutionRecord>,
}

/// Per-stage sandbox-execution binding (spec 162 §FR-008).
///
/// Backend-agnostic by construction: `isolation_tier` is normalised to
/// 1/2/3 (1 = sandbox runtime, 2 = restricted container, 3 = forbidden);
/// `runtime_descriptor` is treated by the verifier as an opaque
/// base64-encoded fingerprint of backend identity + version + selected
/// runtime. Backends choose their own pre-encoded bytes, so long as the
/// bytes are deterministic for a given build.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxExecutionRecord {
    /// Executed command — argv echoed back; the verifier binds this
    /// exact form (FR-008).
    pub command: Vec<String>,
    /// Pre-execution input artifact hashes, keyed by sandbox-mount-relative
    /// path.
    pub input_artifact_hashes: BTreeMap<String, String>,
    /// Post-execution output artifact hashes, keyed by sandbox-mount-relative
    /// path.
    pub output_artifact_hashes: BTreeMap<String, String>,
    /// Peak resource utilisation observed during the execution.
    pub resource_peak: SandboxResourcePeak,
    /// Realised isolation tier — 1 = sandbox runtime (gVisor /
    /// Firecracker / Kata), 2 = restricted container (rootless OCI,
    /// RO rootfs, seccomp default). MUST NOT be 3 for a successful
    /// outcome (162 §2.2 — Tier 3 is reserved for refusal diagnostics).
    pub isolation_tier: u8,
    /// Opaque backend identity + version + runtime fingerprint, base64.
    /// Verifier treats this as bytes — no parsing.
    pub runtime_descriptor: String,
    /// True iff the TTL fired and the execution was terminated.
    pub deadline_hit: bool,
    /// Process exit code from the sandboxed command.
    pub exit_code: i32,
}

/// Peak resource utilisation observed during a sandbox execution
/// (spec 162 §FR-008).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SandboxResourcePeak {
    pub cpu_milli_peak: u32,
    pub memory_bytes_peak: u64,
    pub pid_peak: u32,
}

impl SandboxExecutionRecord {
    /// Convert a backend-agnostic `factory_contracts::sandbox::SandboxExecution`
    /// into the certificate-shaped record. The conversion is the
    /// canonical boundary between the trait surface (which carries the
    /// `IsolationTier` enum) and the certificate (which carries the
    /// numeric 1/2/3 normalisation per 162 §2.2).
    pub fn from_outcome(outcome: factory_contracts::sandbox::SandboxExecution) -> Self {
        Self {
            command: outcome.command,
            input_artifact_hashes: outcome.input_artifact_hashes,
            output_artifact_hashes: outcome.output_artifact_hashes,
            resource_peak: SandboxResourcePeak {
                cpu_milli_peak: outcome.resource_peak.cpu_milli_peak,
                memory_bytes_peak: outcome.resource_peak.memory_bytes_peak,
                pid_peak: outcome.resource_peak.pid_peak,
            },
            isolation_tier: outcome.isolation_tier.as_numeric(),
            runtime_descriptor: outcome.runtime_descriptor,
            deadline_hit: outcome.deadline_hit,
            exit_code: outcome.exit_code,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StageOutcome {
    Passed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateResultRecord {
    pub passed: bool,
    pub checks_run: u32,
    pub checks_failed: u32,
}

// ── Verification ─────────────────────────────────────────────────────

/// Aggregate verification outcomes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationRecord {
    pub compile: VerificationOutcome,
    pub test: VerificationOutcome,
    pub lint: VerificationOutcome,
    pub typecheck: VerificationOutcome,
    pub security_scan: VerificationOutcome,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VerificationOutcome {
    Passed,
    Failed,
    Skipped,
}

// ── Proof Chain ──────────────────────────────────────────────────────

/// Summary of the proof chain from policy-kernel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofChainSummary {
    pub record_count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_record_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_record_hash: Option<String>,
    pub chain_integrity: ChainIntegrity,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChainIntegrity {
    Verified,
    Unverified,
    Empty,
}

// ── Compliance ───────────────────────────────────────────────────────

/// Compliance mapping for the pipeline run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceRecord {
    pub frameworks: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mappings: Vec<ComplianceMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComplianceMapping {
    pub control: String,
    pub mechanism: String,
    pub status: String,
}

// ── Certificate Builder ──────────────────────────────────────────────

/// Builder for constructing a GovernanceCertificate from pipeline state.
pub struct CertificateBuilder {
    pipeline_run_id: String,
    intent: IntentRecord,
    build_spec_hash: String,
    approval_record: Option<ApprovalRecord>,
    stages: Vec<StageRecord>,
    verification: VerificationRecord,
    proof_chain: ProofChainSummary,
    compliance: Option<ComplianceRecord>,
    signer: Option<Signer>,
    inter_stage_chain: Option<InterStageChainRecord>,
    admitted_envelope_hash: Option<String>,
    goal_id: Option<String>,
    intent_capsule_hash: Option<String>,
    consumed_overrides: Vec<ConsumedOverride>,
    corpus_binding: Option<CorpusBinding>,
    sbom_artifact_binding: Option<SbomArtifactBinding>,
    budget_consumption: Option<Vec<BudgetAxisRecord>>,
    agentic_posture_binding: Option<AgenticPostureBinding>,
}

impl CertificateBuilder {
    /// Create a new builder with the minimum required fields.
    pub fn new(pipeline_run_id: impl Into<String>, intent: IntentRecord) -> Self {
        Self {
            pipeline_run_id: pipeline_run_id.into(),
            intent,
            build_spec_hash: String::new(),
            approval_record: None,
            stages: Vec::new(),
            verification: VerificationRecord {
                compile: VerificationOutcome::Skipped,
                test: VerificationOutcome::Skipped,
                lint: VerificationOutcome::Skipped,
                typecheck: VerificationOutcome::Skipped,
                security_scan: VerificationOutcome::Skipped,
            },
            proof_chain: ProofChainSummary {
                record_count: 0,
                first_record_hash: None,
                last_record_hash: None,
                chain_integrity: ChainIntegrity::Empty,
            },
            compliance: None,
            signer: None,
            inter_stage_chain: None,
            admitted_envelope_hash: None,
            goal_id: None,
            intent_capsule_hash: None,
            consumed_overrides: Vec::new(),
            corpus_binding: None,
            sbom_artifact_binding: None,
            budget_consumption: None,
            agentic_posture_binding: None,
        }
    }

    pub fn build_spec_hash(mut self, hash: impl Into<String>) -> Self {
        self.build_spec_hash = hash.into();
        self
    }

    pub fn approval_record(mut self, record: ApprovalRecord) -> Self {
        self.approval_record = Some(record);
        self
    }

    pub fn stages(mut self, stages: Vec<StageRecord>) -> Self {
        self.stages = stages;
        self
    }

    pub fn add_stage(mut self, stage: StageRecord) -> Self {
        self.stages.push(stage);
        self
    }

    pub fn verification(mut self, verification: VerificationRecord) -> Self {
        self.verification = verification;
        self
    }

    pub fn proof_chain(mut self, summary: ProofChainSummary) -> Self {
        self.proof_chain = summary;
        self
    }

    pub fn compliance(mut self, compliance: ComplianceRecord) -> Self {
        self.compliance = Some(compliance);
        self
    }

    /// Attach the run's signed inter-stage manifest chain (spec 170 FR-007).
    pub fn inter_stage_chain(mut self, chain: InterStageChainRecord) -> Self {
        self.inter_stage_chain = Some(chain);
        self
    }

    /// Attach a [`Signer`] identifying the principal that drove the run
    /// (spec 168 §FR-003). Required for tenant emission; optional on
    /// OAP-self runs.
    pub fn signer(mut self, signer: Signer) -> Self {
        self.signer = Some(signer);
        self
    }

    /// Spec 198 FR-009 — bind the admitted envelope hash the run executed
    /// under into the certificate (inside hash + signature).
    pub fn admitted_envelope_hash(mut self, hash: impl Into<String>) -> Self {
        self.admitted_envelope_hash = Some(hash.into());
        self
    }

    /// Spec 198 FR-005 — bind the run's intent capsule (stable goal id +
    /// canonical capsule hash) into the certificate.
    pub fn intent_capsule(
        mut self,
        goal_id: impl Into<String>,
        capsule_hash: impl Into<String>,
    ) -> Self {
        self.goal_id = Some(goal_id.into());
        self.intent_capsule_hash = Some(capsule_hash.into());
        self
    }

    /// Spec 198 FR-013(c) — bind the overrides the run consumed (as
    /// presented by the platform's admission-gated bundle) into the
    /// certificate.
    pub fn consumed_overrides(mut self, overrides: Vec<ConsumedOverride>) -> Self {
        self.consumed_overrides = overrides;
        self
    }

    /// Spec 218 FR-001: bind the corpus attestation hash and the spec-spine
    /// tool version into the certificate (inside hash + signature). The hash is
    /// the SHA-256 of the canonical `CorpusAttestation` JSON, produced by the
    /// caller via `spec_spine_core::attest::attestation_hash` on the attestation
    /// object. The builder DOES NOT call `attest` or `verify_recompute`; the
    /// hash is always a supplied value (read, never recompute).
    pub fn corpus_binding(
        mut self,
        hash: impl Into<String>,
        spec_spine_version: impl Into<String>,
    ) -> Self {
        self.corpus_binding = Some(CorpusBinding {
            corpus_attestation_hash: hash.into(),
            spec_spine_version: spec_spine_version.into(),
        });
        self
    }

    /// Spec 203 FR-003: bind the produced app's BOM + audit artifact content
    /// hashes and the BOM tool version into the certificate (inside hash +
    /// signature). Both hashes are SUPPLIED by the emission path (spec 203
    /// FR-001/FR-002); the builder never regenerates the BOM (read, never
    /// recompute).
    pub fn sbom_artifact_binding(
        mut self,
        bom_hash: impl Into<String>,
        audit_hash: impl Into<String>,
        bom_tool_version: impl Into<String>,
    ) -> Self {
        self.sbom_artifact_binding = Some(SbomArtifactBinding {
            bom_hash: bom_hash.into(),
            audit_hash: audit_hash.into(),
            bom_tool_version: bom_tool_version.into(),
        });
        self
    }

    /// Spec 202 FR-005: bind the run's per-axis budget consumption (from the
    /// `RunBudgetMeter` snapshot at termination) into the certificate (inside
    /// hash + signature). Empty input leaves the field absent so unmetered runs
    /// stay byte-identical to pre-1.8.0 payloads.
    pub fn budget_consumption(mut self, records: Vec<BudgetAxisRecord>) -> Self {
        self.budget_consumption = if records.is_empty() {
            None
        } else {
            Some(records)
        };
        self
    }

    /// Spec 210 FR-002: bind the produced application's declared agentic posture
    /// (from the frozen Build Spec, read by the emission path; read, never
    /// recompute) into the certificate (inside hash + signature). The binding is
    /// always present when the emission path saw a Build Spec: an omitted
    /// `agentic_posture` yields `none`/`defaulted: true` (visibly defaulted,
    /// never silently equivalent to authored `none`).
    pub fn agentic_posture_binding(mut self, binding: AgenticPostureBinding) -> Self {
        self.agentic_posture_binding = Some(binding);
        self
    }

    /// Fallible build path for tenant emission (spec 168 §FR-007).
    ///
    /// Returns [`CertificateBuildError::MissingSigner`] when no
    /// [`Signer`] has been attached. The tenant pipeline runner calls
    /// this entry point so a misconfigured-identity run halts before
    /// emitting a certificate, rather than producing one with a null
    /// signer.
    pub fn build_tenant(self) -> Result<GovernanceCertificate, CertificateBuildError> {
        if self.signer.is_none() {
            return Err(CertificateBuildError::MissingSigner);
        }
        Ok(self.build())
    }

    /// Build the certificate, computing the self-authenticating hash (FR-008)
    /// AND the Ed25519 signature (FR-008.1). Signing key is resolved via
    /// `resolve_signing_material()` — operator env vars take precedence,
    /// ephemeral fallback for local dev.
    pub fn build(self) -> GovernanceCertificate {
        let has_failure = self.stages.iter().any(|s| s.status == StageOutcome::Failed);

        let status = if has_failure {
            CertificateStatus::Incomplete
        } else {
            CertificateStatus::Complete
        };

        let (signing_key, attestation) = resolve_signing_material();
        let public_key_b64 = B64.encode(signing_key.verifying_key().to_bytes());

        let mut cert = GovernanceCertificate {
            certificate_version: CERTIFICATE_VERSION.into(),
            pipeline_run_id: self.pipeline_run_id,
            timestamp: Utc::now(),
            status,
            intent: self.intent,
            build_spec: BuildSpecRecord {
                hash: self.build_spec_hash,
                approval_record: self.approval_record,
            },
            stages: self.stages,
            verification: self.verification,
            proof_chain: self.proof_chain,
            compliance: self.compliance,
            signer: self.signer,
            inter_stage_chain: self.inter_stage_chain,
            admitted_envelope_hash: self.admitted_envelope_hash,
            goal_id: self.goal_id,
            intent_capsule_hash: self.intent_capsule_hash,
            consumed_overrides: self.consumed_overrides,
            corpus_binding: self.corpus_binding,
            sbom_artifact_binding: self.sbom_artifact_binding,
            budget_consumption: self.budget_consumption,
            agentic_posture_binding: self.agentic_posture_binding,
            certificate_hash: String::new(),
            signing_public_key: public_key_b64,
            cert_signature: String::new(),
            signing_attestation: attestation,
            platform_countersign: None,
        };

        // FR-008 (revised): content-binding hash. Zeros cert_hash AND
        // cert_signature so the hash is stable across signing.
        cert.certificate_hash = compute_certificate_hash(&cert);

        // FR-008.1: Ed25519 signature over canonical JSON with cert_signature
        // zeroed and cert_hash populated. Signing happens after hashing so
        // the signature attests both the content and its content-binding
        // fingerprint.
        cert.cert_signature = compute_certificate_signature(&cert, &signing_key);
        cert
    }
}

// ── Signing-key Resolution ───────────────────────────────────────────

/// Resolve the Ed25519 signing key per spec 102 FR-008.1:
///   1. `OAP_SIGNING_KEY` env var (base64, 32-byte seed) — `Operator` kind.
///   2. `OAP_SIGNING_KEY_PATH` env var (file path) — `Operator` kind.
///   3. Ephemeral key generated for this run — `Ephemeral` kind.
///
/// Returns the signing key plus the attestation describing the trust
/// posture. Malformed operator-supplied material panics — the caller
/// should not silently fall back to ephemeral when the operator
/// expressly attempted to supply a key (that would be a quiet downgrade).
pub fn resolve_signing_material() -> (SigningKey, SigningAttestation) {
    if let Ok(b64) = std::env::var(ENV_SIGNING_KEY) {
        let seed = decode_seed(&b64).unwrap_or_else(|e| {
            panic!("{ENV_SIGNING_KEY} is set but malformed: {e}");
        });
        return (
            SigningKey::from_bytes(&seed),
            SigningAttestation {
                kind: SigningAttestationKind::Operator,
                note: Some(format!("source={ENV_SIGNING_KEY}")),
            },
        );
    }
    if let Ok(path) = std::env::var(ENV_SIGNING_KEY_PATH) {
        let contents = std::fs::read_to_string(&path).unwrap_or_else(|e| {
            panic!("{ENV_SIGNING_KEY_PATH}={path} unreadable: {e}");
        });
        let seed = decode_seed(contents.trim()).unwrap_or_else(|e| {
            panic!("{ENV_SIGNING_KEY_PATH}={path} content malformed: {e}");
        });
        return (
            SigningKey::from_bytes(&seed),
            SigningAttestation {
                kind: SigningAttestationKind::Operator,
                note: Some(format!("source={ENV_SIGNING_KEY_PATH}:{path}")),
            },
        );
    }
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed).expect("OS RNG unavailable");
    (
        SigningKey::from_bytes(&seed),
        SigningAttestation {
            kind: SigningAttestationKind::Ephemeral,
            note: Some("auto-generated for pipeline run".into()),
        },
    )
}

fn decode_seed(s: &str) -> Result<[u8; 32], String> {
    let bytes = B64.decode(s.trim()).map_err(|e| format!("base64: {e}"))?;
    bytes
        .try_into()
        .map_err(|v: Vec<u8>| format!("seed length {} != 32", v.len()))
}

// ── Hash + Signature Computation ─────────────────────────────────────

/// Compute the content-binding SHA-256 hash of a certificate (FR-008 revised).
///
/// Zeros both `certificate_hash` AND `cert_signature` so the hash is
/// invariant under signing — the signature can be re-computed without
/// invalidating the hash. The hash is no longer the authoritative
/// provenance check (see `compute_certificate_signature` + FR-008.4); it
/// remains as a content fingerprint and an accidental-corruption guard
/// inside the signed payload.
pub fn compute_certificate_hash(cert: &GovernanceCertificate) -> String {
    let mut cert_for_hash = cert.clone();
    cert_for_hash.certificate_hash = String::new();
    cert_for_hash.cert_signature = String::new();
    // Spec 198 FR-014 — the platform countersign is applied AFTER emission
    // (sync-back patch); excluding it keeps the offline chain valid across
    // sealing.
    cert_for_hash.platform_countersign = None;

    // Canonical JSON: serde_json produces deterministic output for BTreeMap.
    // For Vec fields, order is preserved as inserted.
    let canonical = serde_json::to_string(&cert_for_hash).expect("certificate serialises to JSON");

    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Compute the Ed25519 signature of a certificate (FR-008.1).
///
/// Signs the canonical JSON of the certificate with `cert_signature` set
/// to empty string and `certificate_hash` *populated* — the signature
/// attests both the content and the content-binding fingerprint. Returns
/// the base64-encoded 64-byte signature.
pub fn compute_certificate_signature(cert: &GovernanceCertificate, key: &SigningKey) -> String {
    let mut cert_for_sig = cert.clone();
    cert_for_sig.cert_signature = String::new();
    // Spec 198 FR-014 — see compute_certificate_hash: the post-emission
    // countersign is outside the engine signature too.
    cert_for_sig.platform_countersign = None;
    let canonical =
        serde_json::to_string(&cert_for_sig).expect("certificate serialises to JSON for signing");
    let sig: Signature = key.sign(canonical.as_bytes());
    B64.encode(sig.to_bytes())
}

/// Verify the Ed25519 signature on a certificate. Returns `Err` with a
/// specific diagnostic on failure (FR-008.4).
fn verify_certificate_signature(cert: &GovernanceCertificate) -> Result<(), String> {
    if cert.signing_public_key.is_empty() {
        return Err(
            "certificate is unsigned (signing_public_key empty) — rejected per FR-008.2".into(),
        );
    }
    if cert.cert_signature.is_empty() {
        return Err(
            "certificate is unsigned (cert_signature empty) — rejected per FR-008.1".into(),
        );
    }
    let pk_bytes: [u8; 32] = B64
        .decode(&cert.signing_public_key)
        .map_err(|e| format!("signing_public_key base64 decode: {e}"))?
        .try_into()
        .map_err(|v: Vec<u8>| format!("signing_public_key length {} != 32", v.len()))?;
    let verifying_key = VerifyingKey::from_bytes(&pk_bytes)
        .map_err(|e| format!("signing_public_key not a valid Ed25519 point: {e}"))?;
    let sig_bytes: [u8; 64] = B64
        .decode(&cert.cert_signature)
        .map_err(|e| format!("cert_signature base64 decode: {e}"))?
        .try_into()
        .map_err(|v: Vec<u8>| format!("cert_signature length {} != 64", v.len()))?;
    let sig = Signature::from_bytes(&sig_bytes);

    let mut cert_for_sig = cert.clone();
    cert_for_sig.cert_signature = String::new();
    // Spec 198 FR-014 — the countersign is patched in after signing;
    // strip it so a sealed certificate's engine signature still verifies.
    cert_for_sig.platform_countersign = None;
    let canonical = serde_json::to_string(&cert_for_sig)
        .map_err(|e| format!("certificate re-serialises to JSON for verification: {e}"))?;

    verifying_key
        .verify(canonical.as_bytes(), &sig)
        .map_err(|e| format!("Ed25519 signature verification failed: {e}"))
}

// ── Generation from Pipeline State ───────────────────────────────────

/// OAP's canonical s0..s5 stage list (spec 102).
///
/// Tenant pipelines (spec 168 §2.4) pass their own stage IDs to
/// [`generate_certificate_with_stage_ids`]; the OAP-side
/// [`generate_certificate`] keeps this fixed list as its default for
/// byte-equivalence with pre-1.3.0 fixtures.
pub const OAP_STAGE_IDS: &[&str] = &[
    "s0-preflight",
    "s1-business-requirements",
    "s2-service-requirements",
    "s3-data-model",
    "s4-api-specification",
    "s5-ui-specification",
];

/// Generate a governance certificate from a completed (or halted) pipeline.
///
/// FR-003: called at the end of every factory pipeline run.
/// FR-005: computes SHA-256 of each stage output artifact on disk.
///
/// Uses [`OAP_STAGE_IDS`] as the stage list. Tenant pipelines with
/// different stage grammars (spec 168 §2.4) call
/// [`generate_certificate_with_stage_ids`] instead.
pub fn generate_certificate(
    pipeline_state: &FactoryPipelineState,
    requirements_hash: &str,
    artifact_dir: &Path,
    proof_chain_summary: Option<ProofChainSummary>,
) -> GovernanceCertificate {
    generate_certificate_with_stage_ids(
        pipeline_state,
        requirements_hash,
        artifact_dir,
        proof_chain_summary,
        OAP_STAGE_IDS,
    )
}

/// Generate a governance certificate using a caller-supplied stage list
/// (spec 168 §2.4).
///
/// `stage_ids` controls which subdirectories of `artifact_dir` are
/// scanned and the order in which their [`StageRecord`]s appear in the
/// certificate. When the slice is empty, every subdirectory of
/// `artifact_dir` is scanned in lexicographic order — useful for tenant
/// pipelines that emit stages dynamically and want filesystem discovery
/// instead of an explicit list.
///
/// Per spec 168 §2.4, the tenant's stage shape is opaque to the
/// certificate format: any stage representable as `(stage_id,
/// artifact_hashes)` round-trips through the verifier untouched.
pub fn generate_certificate_with_stage_ids(
    pipeline_state: &FactoryPipelineState,
    requirements_hash: &str,
    artifact_dir: &Path,
    proof_chain_summary: Option<ProofChainSummary>,
    stage_ids: &[&str],
) -> GovernanceCertificate {
    generate_certificate_bound(
        pipeline_state,
        requirements_hash,
        artifact_dir,
        proof_chain_summary,
        stage_ids,
        None,
        Vec::new(),
    )
}

/// Spec 198 FR-005/FR-009 — the admission + intent-capsule facts a
/// grant-governed run binds into its certificate at emission.
#[derive(Debug, Clone)]
pub struct CapsuleBinding {
    pub admitted_envelope_hash: String,
    pub goal_id: String,
    pub intent_capsule_hash: String,
    /// Spec 198 FR-013(c) — overrides the run consumed, from the bundle's
    /// admission block (platform predicate-checked).
    pub consumed_overrides: Vec<ConsumedOverride>,
}

/// [`generate_certificate_with_stage_ids`] plus the spec 198 capsule
/// binding. `binding: None` produces a byte-identical certificate to the
/// unbound path (the optional fields are skipped in serialization).
pub fn generate_certificate_bound(
    pipeline_state: &FactoryPipelineState,
    requirements_hash: &str,
    artifact_dir: &Path,
    proof_chain_summary: Option<ProofChainSummary>,
    stage_ids: &[&str],
    binding: Option<&CapsuleBinding>,
    budget_consumption: Vec<BudgetAxisRecord>,
) -> GovernanceCertificate {
    let intent = IntentRecord {
        requirements_hash: requirements_hash.to_string(),
        spec_id: None,
        spec_hash: None,
    };

    let build_spec_hash = pipeline_state.build_spec_hash.clone().unwrap_or_default();

    let stages = if stage_ids.is_empty() {
        collect_stage_records_from_dir(artifact_dir)
    } else {
        collect_stage_records(artifact_dir, stage_ids)
    };

    let verification = VerificationRecord {
        compile: VerificationOutcome::Skipped,
        test: VerificationOutcome::Skipped,
        lint: VerificationOutcome::Skipped,
        typecheck: VerificationOutcome::Skipped,
        security_scan: VerificationOutcome::Skipped,
    };

    let proof_chain = proof_chain_summary.unwrap_or(ProofChainSummary {
        record_count: 0,
        first_record_hash: None,
        last_record_hash: None,
        chain_integrity: ChainIntegrity::Empty,
    });

    let mut builder = CertificateBuilder::new(&pipeline_state.pipeline_id, intent)
        .build_spec_hash(build_spec_hash)
        .stages(stages)
        .verification(verification)
        .proof_chain(proof_chain);
    if let Some(b) = binding {
        builder = builder
            .admitted_envelope_hash(b.admitted_envelope_hash.clone())
            .intent_capsule(b.goal_id.clone(), b.intent_capsule_hash.clone())
            .consumed_overrides(b.consumed_overrides.clone());
    }
    // Spec 202 FR-005: bind the run's per-axis budget consumption (empty leaves
    // the field absent for unmetered/legacy callers).
    builder = builder.budget_consumption(budget_consumption);
    builder.build()
}

/// Scan the artifact directory for stage output files using a
/// caller-supplied ordered stage list.
fn collect_stage_records(artifact_dir: &Path, stage_ids: &[&str]) -> Vec<StageRecord> {
    let mut stages = Vec::new();
    for stage_id in stage_ids {
        stages.push(stage_record_for(artifact_dir, stage_id));
    }
    stages
}

/// Scan the artifact directory's subdirectories and emit a stage record
/// per subdirectory, in lexicographic order. Used when the caller passes
/// an empty stage-id list to [`generate_certificate_with_stage_ids`].
fn collect_stage_records_from_dir(artifact_dir: &Path) -> Vec<StageRecord> {
    let Ok(entries) = std::fs::read_dir(artifact_dir) else {
        return Vec::new();
    };

    let mut stage_dirs: Vec<String> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().to_str().map(|s| s.to_string()))
        .collect();
    stage_dirs.sort();

    stage_dirs
        .iter()
        .map(|sid| stage_record_for(artifact_dir, sid))
        .collect()
}

/// Build a single [`StageRecord`] for the named stage by scanning
/// `artifact_dir/<stage_id>/`.
fn stage_record_for(artifact_dir: &Path, stage_id: &str) -> StageRecord {
    let stage_dir = artifact_dir.join(stage_id);
    let mut artifact_hashes = BTreeMap::new();

    if stage_dir.is_dir()
        && let Ok(entries) = std::fs::read_dir(&stage_dir)
    {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file()
                && let Ok(contents) = std::fs::read(&path)
            {
                let hash = sha256_bytes(&contents);
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                artifact_hashes.insert(name, hash);
            }
        }
    }

    let status = if artifact_hashes.is_empty() {
        StageOutcome::Skipped
    } else {
        StageOutcome::Passed
    };

    StageRecord {
        stage_id: stage_id.to_string(),
        status,
        artifact_hashes,
        gate_result: None,
        duration_ms: None,
        sandbox_execution: None,
    }
}

/// SHA-256 hash of raw bytes, returned as lowercase hex.
pub fn sha256_bytes(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

/// SHA-256 hash of a file's contents.
pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let data = std::fs::read(path)?;
    Ok(sha256_bytes(&data))
}

// ── Persistence (FR-009) ─────────────────────────────────────────────

/// Persist the certificate as `governance-certificate.json` in the given directory.
pub fn persist_certificate(cert: &GovernanceCertificate, output_dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(output_dir)?;
    let path = output_dir.join("governance-certificate.json");
    let json = serde_json::to_string_pretty(cert).map_err(std::io::Error::other)?;
    std::fs::write(path, json)
}

/// Spec 198 FR-014 — patch the platform countersign into a persisted
/// certificate on sync-back.
///
/// Verifies the countersign JWS against the platform JWKS (typ
/// `oap-cert-countersign+jws`) and requires its claims to bind THIS
/// certificate (`certificate_sha256` == the cert's self-hash, `run_id` ==
/// the cert's pipeline run id) before writing. The patch does not touch
/// `certificate_hash` / `cert_signature` — both exclude the countersign
/// by construction, so the offline chain stays valid.
pub fn apply_countersign(
    certificate_path: &Path,
    countersign_jws: &str,
    jwks: &crate::platform_jws::PlatformJwks,
    expected_platform_run_id: Option<&str>,
) -> Result<(), String> {
    let json = std::fs::read_to_string(certificate_path)
        .map_err(|e| format!("cannot read {}: {e}", certificate_path.display()))?;
    let mut cert: GovernanceCertificate =
        serde_json::from_str(&json).map_err(|e| format!("invalid certificate JSON: {e}"))?;

    let verified = crate::platform_jws::verify_compact_jws(
        countersign_jws,
        jwks,
        crate::platform_jws::TYP_CERT_COUNTERSIGN,
    )
    .map_err(|e| format!("countersign rejected: {e}"))?;

    // The certificate hash is the authoritative binding — it is unique to
    // these exact bytes. The countersign's `run_id` claim carries the
    // PLATFORM run identity (factory_runs.id), which is distinct from the
    // engine-minted `pipeline_run_id`; the caller that knows the platform
    // run id passes it for the equality check.
    let claimed_hash = verified.payload["certificate_sha256"].as_str().unwrap_or("");
    if claimed_hash != cert.certificate_hash {
        return Err(format!(
            "countersign binds certificate hash {claimed_hash} but this certificate's hash is {}",
            cert.certificate_hash
        ));
    }
    if let Some(expected) = expected_platform_run_id {
        let claimed_run = verified.payload["run_id"].as_str().unwrap_or("");
        if claimed_run != expected {
            return Err(format!(
                "countersign binds platform run {claimed_run} but this run is {expected}"
            ));
        }
    }

    cert.platform_countersign = Some(PlatformCountersign {
        countersign_jws: countersign_jws.to_string(),
        kid: verified.header.kid,
        countersigned_at: Utc::now(),
    });
    let out =
        serde_json::to_string_pretty(&cert).map_err(|e| format!("re-serialise failed: {e}"))?;
    std::fs::write(certificate_path, out)
        .map_err(|e| format!("cannot write {}: {e}", certificate_path.display()))
}

// ── Verification (FR-007) ────────────────────────────────────────────

/// Result of certificate verification.
#[derive(Debug)]
pub struct VerificationResult {
    pub valid: bool,
    pub errors: Vec<String>,
    /// Non-fatal observations (spec 198 FR-014): e.g. the
    /// "verifiable-but-unsealed" notice for a certificate with no platform
    /// countersign — visible, never silently equivalent to sealed.
    pub notices: Vec<String>,
}

/// Spec 210 FR-003/FR-004: structural self-consistency of an
/// `agenticPostureBinding`, independent of any SBOM. Returns the list of
/// inconsistency diagnostics (empty when consistent). Rules:
/// - `none`: no surfaces.
/// - `declared`/`governed`: at least one surface.
/// - `governed`: every surface carries an inline governance envelope that
///   deserializes as a spec-198 [`factory_contracts::governance_envelope::GovernanceEnvelope`]
///   (shape validation, FR-004).
/// - any other posture string is an unknown-posture error.
///
/// The binding is signed into the certificate payload, so raw byte tamper is
/// already caught by the signature check; this rejects a validly-signed but
/// self-inconsistent binding. The SBOM cross-check (posture vs the produced
/// app's dependency tree, FR-003) is separate and needs the on-disk BOM.
pub fn agentic_posture_binding_inconsistencies(binding: &AgenticPostureBinding) -> Vec<String> {
    let mut errors = Vec::new();
    match binding.posture.as_str() {
        "none" => {
            if !binding.surfaces.is_empty() {
                errors.push(format!(
                    "agentic_posture_binding: `none` must enumerate no surfaces, found {}",
                    binding.surfaces.len()
                ));
            }
        }
        "declared" | "governed" => {
            if binding.surfaces.is_empty() {
                errors.push(format!(
                    "agentic_posture_binding: `{}` requires a non-empty surface enumeration",
                    binding.posture
                ));
            }
        }
        other => {
            errors.push(format!(
                "agentic_posture_binding: unknown posture `{other}` \
                 (expected none|declared|governed)"
            ));
        }
    }
    if binding.posture == "governed" {
        for (i, s) in binding.surfaces.iter().enumerate() {
            match &s.governance_envelope {
                None => errors.push(format!(
                    "agentic_posture_binding: `governed` surface #{i} ({}) is missing its \
                     governance_envelope (spec 210 FR-004)",
                    s.kind
                )),
                Some(env) => {
                    if let Err(e) = serde_json::from_value::<
                        factory_contracts::governance_envelope::GovernanceEnvelope,
                    >(env.clone())
                    {
                        errors.push(format!(
                            "agentic_posture_binding: `governed` surface #{i} ({}) has a \
                             non-conformant governance_envelope: {e}",
                            s.kind
                        ));
                    }
                }
            }
        }
    }
    errors
}

/// Verify a governance certificate by re-deriving hashes and checking integrity.
///
/// FR-007: exits 0 on success, 1 on any mismatch.
///
/// Spec 102 FR-008.4: signature verification runs FIRST and is the
/// authoritative provenance check. The content-binding hash check is
/// retained but is now defence-in-depth, not the primary check.
pub fn verify_certificate(
    cert: &GovernanceCertificate,
    artifact_dir: Option<&Path>,
) -> VerificationResult {
    let mut errors = Vec::new();

    // 0. Verify Ed25519 signature first (FR-008.4). This is the authoritative
    //    provenance check post-amendment — a tamper-with-resign attack that
    //    only updates the SHA-256 hash but cannot mint a valid signature
    //    over the modified content is caught here.
    if let Err(diagnostic) = verify_certificate_signature(cert) {
        errors.push(diagnostic);
    }

    // 1. Verify certificate self-hash (FR-008 revised — content binding,
    //    defence-in-depth).
    let expected_hash = compute_certificate_hash(cert);
    if cert.certificate_hash != expected_hash {
        errors.push(format!(
            "certificate hash mismatch: expected {expected_hash}, got {}",
            cert.certificate_hash
        ));
    }

    // 2. Verify artifact hashes against files on disk (FR-005).
    if let Some(dir) = artifact_dir {
        for stage in &cert.stages {
            let stage_dir = dir.join(&stage.stage_id);
            for (artifact_name, recorded_hash) in &stage.artifact_hashes {
                let artifact_path = stage_dir.join(artifact_name);
                match std::fs::read(&artifact_path) {
                    Ok(contents) => {
                        let actual_hash = sha256_bytes(&contents);
                        if &actual_hash != recorded_hash {
                            errors.push(format!(
                                "artifact hash mismatch: {}/{}: expected {recorded_hash}, got {actual_hash}",
                                stage.stage_id, artifact_name
                            ));
                        }
                    }
                    Err(e) => {
                        errors.push(format!(
                            "cannot read artifact {}/{}: {e}",
                            stage.stage_id, artifact_name
                        ));
                    }
                }
            }
        }
    }

    // 3. Verify version.
    if cert.certificate_version != CERTIFICATE_VERSION {
        errors.push(format!(
            "unsupported certificate version: {}",
            cert.certificate_version
        ));
    }

    // 3b. Spec 202 FR-005/AC-4: budget-consumption record integrity. The record
    //     is signed into the payload, so raw byte tamper is already caught by
    //     the signature check (0). These structural checks reject a validly-signed
    //     but malformed record: per-axis magnitude (finite, non-negative) and
    //     consistency (breached iff actual > ceiling), plus a closed-set shape
    //     (every admitted axis present exactly once, no unknown axes). The axis
    //     set is derived from RunBudgetAxis::ALL so it never drifts. A coherent
    //     self-consistent forgery of an actual by the signing producer is out of
    //     reach (the cert carries no per-stage per-axis totals to corroborate).
    //     Skipped when absent (pre-1.8.0 certs), the named "unmetered" state.
    if let Some(records) = &cert.budget_consumption {
        for r in records {
            if !r.ceiling.is_finite() || !r.actual.is_finite() || r.ceiling < 0.0 || r.actual < 0.0
            {
                errors.push(format!(
                    "budget_consumption: axis '{}' has a negative or non-finite magnitude (ceiling={}, actual={})",
                    r.axis, r.ceiling, r.actual
                ));
            }
            if r.breached != (r.actual > r.ceiling) {
                errors.push(format!(
                    "budget_consumption: axis '{}' inconsistent: breached={} but actual={} ceiling={}",
                    r.axis, r.breached, r.actual, r.ceiling
                ));
            }
        }
        let admitted = admitted_axis_names();
        // Completeness: every admitted axis present.
        for axis in &admitted {
            if !records.iter().any(|r| &r.axis == axis) {
                errors.push(format!("budget_consumption: missing admitted axis '{axis}'"));
            }
        }
        // Closed set: reject unknown and duplicate axes.
        let mut seen = std::collections::HashSet::new();
        for r in records {
            if !admitted.iter().any(|a| a == &r.axis) {
                errors.push(format!("budget_consumption: unknown axis '{}'", r.axis));
            }
            if !seen.insert(r.axis.as_str()) {
                errors.push(format!("budget_consumption: duplicate axis '{}'", r.axis));
            }
        }
    }

    // 3c. Spec 210 FR-003/FR-004: agentic-posture binding self-consistency. The
    //     binding is signed into the payload, so raw byte tamper is already
    //     caught by the signature check (0). These structural checks reject a
    //     validly-signed but self-inconsistent binding: declared/governed with
    //     no surfaces; none with surfaces; a governed surface with no inline
    //     governance envelope or one that does not deserialize as a spec-198
    //     GovernanceEnvelope (shape validation, FR-004). The SBOM cross-check
    //     (posture vs the produced app's dependency tree, FR-003) needs the
    //     on-disk BOM and lives in the verify bin's --sbom-dir path. Skipped when
    //     absent (pre-1.9.0 / unstated), never silently equivalent to authored
    //     none.
    if let Some(binding) = &cert.agentic_posture_binding {
        errors.extend(agentic_posture_binding_inconsistencies(binding));
    }

    // 4. Spec 170 FR-007 — verify the signed inter-stage manifest chain
    //    if present. Each manifest must validate against the run's key
    //    chain offline; tampered or cross-run manifests are surfaced as
    //    distinct errors so the auditor can attribute failures.
    if let Some(chain_record) = &cert.inter_stage_chain {
        if chain_record.key_chain.run_id != cert.pipeline_run_id {
            errors.push(format!(
                "inter-stage chain run_id {} does not match certificate pipeline_run_id {}",
                chain_record.key_chain.run_id, cert.pipeline_run_id
            ));
        }
        for manifest in &chain_record.manifests {
            if let Err(e) = verify_manifest(manifest, &chain_record.key_chain, None) {
                errors.push(format!(
                    "inter-stage manifest {}→{} failed verification: {e}",
                    manifest.from_stage, manifest.to_stage
                ));
            }
        }
    }

    VerificationResult {
        valid: errors.is_empty(),
        errors,
        notices: Vec::new(),
    }
}

/// Spec 198 FR-014/AC-4 — full verification including the platform seal.
///
/// Runs [`verify_certificate`] (the producer-untrusted offline chain,
/// unchanged), then adjudicates the countersign:
///
/// - **Unsealed** (`platform_countersign: None`): a notice is emitted —
///   "verifiable-but-unsealed". Fails only under `require_sealed`.
/// - **Sealed + JWKS provided**: the countersign JWS must verify against
///   the keyset and its claims must bind this certificate's hash and run
///   id; any failure is an error.
/// - **Sealed + no JWKS**: the seal cannot be adjudicated — a notice under
///   the default posture, an error under `require_sealed` (fail closed).
pub fn verify_certificate_with_platform(
    cert: &GovernanceCertificate,
    artifact_dir: Option<&Path>,
    platform_jwks: Option<&crate::platform_jws::PlatformJwks>,
    require_sealed: bool,
) -> VerificationResult {
    let mut result = verify_certificate(cert, artifact_dir);

    match (&cert.platform_countersign, platform_jwks) {
        (None, _) => {
            if require_sealed {
                result.errors.push(
                    "certificate is verifiable-but-UNSEALED (no platform countersign) — \
                     rejected under --require-sealed (spec 198 FR-014)"
                        .into(),
                );
            } else {
                result.notices.push(
                    "certificate is verifiable-but-UNSEALED: the offline chain holds, but no \
                     platform countersign binds this run to its admission contract (spec 198 FR-014)"
                        .into(),
                );
            }
        }
        (Some(seal), Some(jwks)) => {
            match crate::platform_jws::verify_compact_jws(
                &seal.countersign_jws,
                jwks,
                crate::platform_jws::TYP_CERT_COUNTERSIGN,
            ) {
                Ok(verified) => {
                    // The certificate hash is the authoritative binding —
                    // unique to these exact bytes. The countersign's
                    // `run_id` claim is the PLATFORM run identity, distinct
                    // from the engine-minted `pipeline_run_id`; it is
                    // surfaced informationally, not compared.
                    let claimed_hash =
                        verified.payload["certificate_sha256"].as_str().unwrap_or("");
                    if claimed_hash != cert.certificate_hash {
                        result.errors.push(format!(
                            "platform countersign binds certificate hash {claimed_hash} but this \
                             certificate's hash is {}",
                            cert.certificate_hash
                        ));
                    }
                    if result.errors.is_empty() {
                        result.notices.push(format!(
                            "platform countersign VERIFIED (kid {}, platform run {}, {} grant(s) in chain)",
                            verified.header.kid,
                            verified.payload["run_id"].as_str().unwrap_or("?"),
                            verified.payload["grant_count"].as_u64().unwrap_or(0)
                        ));
                    }
                }
                Err(e) => {
                    result.errors.push(format!("platform countersign invalid: {e}"));
                }
            }
        }
        (Some(_), None) => {
            if require_sealed {
                result.errors.push(
                    "certificate carries a platform countersign but no JWKS was provided to \
                     verify it — supply --platform-jwks <file> or --jwks-url (fail-closed under \
                     --require-sealed)"
                        .into(),
                );
            } else {
                result.notices.push(
                    "certificate carries a platform countersign, NOT verified (no JWKS provided \
                     — supply --platform-jwks <file> or --jwks-url)"
                        .into(),
                );
            }
        }
    }

    result.valid = result.errors.is_empty();
    result
}

/// Spec 218 FR-003 / FR-004: the outcome of checking a certificate's corpus
/// binding against a supplied attestation artifact.
#[derive(Debug, PartialEq, Eq)]
pub enum CorpusBindingOutcome {
    /// No `corpus_binding` field on the cert: the named "unbound" state.
    Unbound,
    /// `corpus_binding` present and its hash matches the supplied attestation.
    Verified { hash: String },
}

/// Spec 218 FR-003 / FR-004: verify the corpus binding link by reference,
/// offline, without recomputing the corpus.
///
/// Outcomes:
/// - Absent binding: `Ok(CorpusBindingOutcome::Unbound)` (a notice, not error).
/// - Present + attestation supplied + hashes match: `Ok(Verified)`.
/// - Present + attestation supplied + mismatch: `Err(...)` with a named diagnostic.
/// - Present + no attestation supplied: `Err(...)` "PRESENT-BUT-UNVERIFIED"
///   (fail-closed; skip-as-pass is forbidden, per the spec 200 FR-004 posture).
///
/// This function calls ONLY `spec_spine_core::attest::attestation_hash`, a pure
/// hash over the SUPPLIED attestation payload. It never calls `attest` or
/// `verify_recompute`: verifying the attestation's OWN truth (corpus recompute
/// or detached seal) is delegated to `spec-spine verify-attestation`. Two
/// verifiers, two responsibilities, composed by reference (FR-003 / AC-5).
pub fn verify_corpus_binding(
    cert: &GovernanceCertificate,
    attestation_path: Option<&Path>,
) -> Result<CorpusBindingOutcome, String> {
    match (&cert.corpus_binding, attestation_path) {
        (None, _) => Ok(CorpusBindingOutcome::Unbound),
        (Some(binding), Some(path)) => {
            let raw = std::fs::read_to_string(path).map_err(|e| {
                format!("cannot read corpus attestation {}: {e}", path.display())
            })?;
            let attestation: spec_spine_types::attest::CorpusAttestation =
                serde_json::from_str(&raw)
                    .map_err(|e| format!("invalid CorpusAttestation JSON: {e}"))?;
            let actual_hash = spec_spine_core::attest::attestation_hash(&attestation)
                .map_err(|e| format!("attestation_hash failed: {e}"))?;
            if actual_hash == binding.corpus_attestation_hash {
                Ok(CorpusBindingOutcome::Verified { hash: actual_hash })
            } else {
                Err(format!(
                    "corpus binding hash mismatch: cert claims {}, supplied attestation hashes to {}",
                    binding.corpus_attestation_hash, actual_hash
                ))
            }
        }
        (Some(_), None) => Err(
            "corpus binding present but PRESENT-BUT-UNVERIFIED: supply --corpus-attestation <file> \
             to verify the link (spec-spine verify-attestation verifies the attestation's own truth)"
                .into(),
        ),
    }
}

/// Spec 203 FR-003: relative path of the produced app's CycloneDX BOM, under
/// the produced-app root supplied via `--sbom-dir`.
pub const SBOM_BOM_RELPATH: &str = ".factory/sbom.cdx.json";

/// Spec 203 FR-003: relative path of the produced app's dependency-audit
/// artifact, under the produced-app root supplied via `--sbom-dir`.
pub const SBOM_AUDIT_RELPATH: &str = ".factory/audit.json";

/// Spec 203 FR-003: the outcome of checking a certificate's SBOM artifact
/// binding against the on-disk BOM + audit artifacts.
#[derive(Debug, PartialEq, Eq)]
pub enum SbomBindingOutcome {
    /// No `sbom_artifact_binding` on the cert: the named "unbound" state.
    Unbound,
    /// Binding present and both artifact hashes match the on-disk files.
    Verified { bom_hash: String, audit_hash: String },
}

/// Spec 203 FR-003: verify the SBOM artifact binding by re-hashing the on-disk
/// BOM + audit artifacts, offline. Mirrors `verify_corpus_binding`'s
/// four-outcome, fail-closed pattern.
///
/// Outcomes:
/// - Absent binding: `Ok(SbomBindingOutcome::Unbound)` (a notice, not error).
/// - Present + dir supplied + both hashes match: `Ok(Verified { .. })`.
/// - Present + dir supplied + any mismatch: `Err(...)` naming the file (BOM or audit).
/// - Present + no dir supplied: `Err(...)` "PRESENT-BUT-UNVERIFIED" (fail-closed;
///   skip-as-pass is forbidden, per the spec 200 FR-004 posture).
///
/// `sbom_dir` is the produced application's root; the artifacts are read from
/// `<sbom_dir>/.factory/sbom.cdx.json` and `<sbom_dir>/.factory/audit.json`.
pub fn verify_sbom_binding(
    cert: &GovernanceCertificate,
    sbom_dir: Option<&Path>,
) -> Result<SbomBindingOutcome, String> {
    match (&cert.sbom_artifact_binding, sbom_dir) {
        (None, _) => Ok(SbomBindingOutcome::Unbound),
        (Some(binding), Some(dir)) => {
            let bom_path = dir.join(SBOM_BOM_RELPATH);
            let audit_path = dir.join(SBOM_AUDIT_RELPATH);
            let bom_hash = sha256_file(&bom_path)
                .map_err(|e| format!("cannot read SBOM {}: {e}", bom_path.display()))?;
            let audit_hash = sha256_file(&audit_path)
                .map_err(|e| format!("cannot read audit artifact {}: {e}", audit_path.display()))?;
            if bom_hash != binding.bom_hash {
                return Err(format!(
                    "sbom binding bom hash mismatch: cert claims {}, {} hashes to {}",
                    binding.bom_hash,
                    bom_path.display(),
                    bom_hash
                ));
            }
            if audit_hash != binding.audit_hash {
                return Err(format!(
                    "sbom binding audit hash mismatch: cert claims {}, {} hashes to {}",
                    binding.audit_hash,
                    audit_path.display(),
                    audit_hash
                ));
            }
            Ok(SbomBindingOutcome::Verified {
                bom_hash,
                audit_hash,
            })
        }
        (Some(_), None) => Err(
            "sbom artifact binding present but PRESENT-BUT-UNVERIFIED: supply --sbom-dir <dir> \
             to verify the BOM (.factory/sbom.cdx.json) and audit (.factory/audit.json) hashes \
             (spec 203 FR-003)"
                .into(),
        ),
    }
}

// ── Agentic-posture SBOM cross-check (spec 210 FR-003) ───────────────────────

/// The agent/LLM SDK watchlist, versioned with the standard and embedded into
/// the verifier so the binary is self-contained and deterministic. The file is
/// the single source of truth (spec 210 FR-003); a build-time-tested invariant
/// keeps it well-formed and non-empty.
const AGENTIC_SDK_WATCHLIST_YAML: &str =
    include_str!("../../../standards/schemas/factory/agentic-sdk-watchlist.yaml");

/// Parsed shape of `agentic-sdk-watchlist.yaml`.
#[derive(Debug, Clone, Deserialize)]
struct AgenticSdkWatchlist {
    #[allow(dead_code)]
    schema_version: String,
    packages: Vec<WatchlistEntry>,
}

#[derive(Debug, Clone, Deserialize)]
struct WatchlistEntry {
    #[allow(dead_code)]
    ecosystem: String,
    name: String,
    #[serde(default)]
    #[allow(dead_code)]
    note: Option<String>,
}

/// Parse the embedded watchlist. Malformed is a build-time invariant violation
/// (the file is committed and tested), so this panics rather than fail-soft.
fn load_agentic_sdk_watchlist() -> AgenticSdkWatchlist {
    serde_yaml::from_str(AGENTIC_SDK_WATCHLIST_YAML)
        .expect("embedded agentic-sdk-watchlist.yaml is malformed (build-time invariant)")
}

/// A CycloneDX `purl` carries the watchlist package name as its name segment.
/// Tolerates the npm scope encoding (`%40` for `@`): a scoped package
/// `@anthropic-ai/sdk` appears as `pkg:npm/%40anthropic-ai/sdk@<version>`.
fn purl_matches(purl: &str, name: &str) -> bool {
    let decoded = purl.replace("%40", "@");
    decoded.contains(&format!("/{name}@")) || decoded.ends_with(&format!("/{name}"))
}

/// Walk a CycloneDX BOM's `components[]` (recursively, since cyclonedx-npm may
/// nest) and return the first watchlisted package name found, if any. A missing
/// or unparseable BOM yields `None` (the caller treats a miss as a stated
/// residual, not a pass).
fn first_watchlist_match_in_bom(bom_bytes: &[u8]) -> Option<String> {
    let v: serde_json::Value = serde_json::from_slice(bom_bytes).ok()?;
    let watchlist = load_agentic_sdk_watchlist();

    fn walk(node: &serde_json::Value, wl: &AgenticSdkWatchlist) -> Option<String> {
        let arr = node.get("components")?.as_array()?;
        for c in arr {
            let name = c.get("name").and_then(|n| n.as_str());
            let purl = c.get("purl").and_then(|p| p.as_str());
            for entry in &wl.packages {
                if name == Some(entry.name.as_str())
                    || purl.is_some_and(|p| purl_matches(p, &entry.name))
                {
                    return Some(entry.name.clone());
                }
            }
            if let Some(hit) = walk(c, wl) {
                return Some(hit);
            }
        }
        None
    }

    walk(&v, &watchlist)
}

/// Spec 210 FR-003: the outcome of cross-checking a certificate's agentic
/// posture against the produced app's CycloneDX SBOM.
#[derive(Debug, PartialEq, Eq)]
pub enum PostureCrossCheckOutcome {
    /// No `agentic_posture_binding` on the cert: nothing to cross-check.
    Unbound,
    /// Posture is `declared`/`governed`: agency was declared, so a watchlist
    /// match is not a contradiction.
    Declared,
    /// Posture `none` and no watchlisted package found in the BOM. NOTE: a
    /// watchlist miss is a STATED RESIDUAL (absence of a match is not proof of
    /// absence of agency), surfaced by the caller as a notice.
    ConsistentNone,
    /// Posture `none` (authored or defaulted) contradicted by a watchlisted
    /// agent/LLM SDK dependency in the BOM. Names the package + the posture.
    Contradicted { package: String, posture: String },
    /// Binding present but no `--sbom-dir` supplied: cannot cross-check.
    UnverifiedNoDir,
    /// Binding present, `--sbom-dir` supplied, but the BOM was unreadable.
    BomUnreadable { path: String, error: String },
}

/// Spec 210 FR-003: cross-check a certificate's bound agentic posture against
/// the produced app's CycloneDX BOM (`<sbom_dir>/.factory/sbom.cdx.json`). Only
/// a `none` posture (authored OR defaulted) is falsifiable this way:
/// `declared`/`governed` already acknowledge agency. A `none` posture whose BOM
/// carries a watchlisted agent/LLM SDK dependency is `Contradicted` (the caller
/// folds this into an error naming the package). A miss is `ConsistentNone` (a
/// stated residual). Absent binding is `Unbound`; a binding with no `--sbom-dir`
/// is `UnverifiedNoDir` (a notice, not fail-closed: unlike the SBOM *hash*
/// binding, this is a declaration cross-check whose evidence is optional).
pub fn cross_check_agentic_posture(
    cert: &GovernanceCertificate,
    sbom_dir: Option<&Path>,
) -> PostureCrossCheckOutcome {
    let Some(binding) = &cert.agentic_posture_binding else {
        return PostureCrossCheckOutcome::Unbound;
    };
    if binding.posture != "none" {
        return PostureCrossCheckOutcome::Declared;
    }
    let Some(dir) = sbom_dir else {
        return PostureCrossCheckOutcome::UnverifiedNoDir;
    };
    let bom_path = dir.join(SBOM_BOM_RELPATH);
    let bom_bytes = match std::fs::read(&bom_path) {
        Ok(b) => b,
        Err(e) => {
            return PostureCrossCheckOutcome::BomUnreadable {
                path: bom_path.display().to_string(),
                error: e.to_string(),
            };
        }
    };
    match first_watchlist_match_in_bom(&bom_bytes) {
        Some(package) => PostureCrossCheckOutcome::Contradicted {
            package,
            posture: binding.posture.clone(),
        },
        None => PostureCrossCheckOutcome::ConsistentNone,
    }
}

// ── Cut D W-10: spec_id resolution validation (spec 102 G-2) ─────────
//
// Validates that a governance certificate's `intent.spec_id` resolves
// against `build/spec-registry/registry.json` via the typed-reader
// library introduced in W-03. Default: warn-only. Env-gated
// `OAP_REQUIRE_SPEC_ID_RESOLUTION=1` promotes any unresolved id to a
// hard error.
//
// Per Phase 6 § "Surprises #3", validation results live in a sibling
// `validation-warnings.json` file rather than the cert itself. This
// keeps the cert struct immutable (no version bump, signature
// invariant, every existing fixture survives).

/// A single spec-id-resolution finding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ValidationWarning {
    /// `intent.spec_id` was set but no spec with that id exists in
    /// the spec-spine registry.
    SpecIdNotResolved {
        spec_id: String,
        registry_path: String,
    },
    /// The registry was not loadable at the expected path. By
    /// default this surfaces as a warning, not an error, because
    /// the cert is authoritative independent of the registry's
    /// existence on this filesystem.
    RegistryNotLoadable {
        registry_path: String,
        error: String,
    },
}

impl ValidationWarning {
    /// Stable string id for the finding kind. Used by the env-gate
    /// to decide whether to promote a warning to an error.
    pub fn kind(&self) -> &'static str {
        match self {
            ValidationWarning::SpecIdNotResolved { .. } => "spec-id-not-resolved",
            ValidationWarning::RegistryNotLoadable { .. } => "registry-not-loadable",
        }
    }
}

/// Validate `cert.intent.spec_id` against the spec spine.
///
/// Returns the list of [`ValidationWarning`]s (possibly empty). When
/// `intent.spec_id` is `None`, returns an empty list — the cert does
/// not claim a spec governance and there is nothing to validate.
pub fn validate_spec_id_resolution(
    cert: &GovernanceCertificate,
    repo_root: &Path,
) -> Vec<ValidationWarning> {
    let Some(spec_id) = cert.intent.spec_id.as_deref() else {
        return Vec::new();
    };
    // Spec 217 engine swap: read the committed registry shards
    // (`.derived/spec-registry/by-spec/*.json`) via the spec-spine library
    // rather than the in-tree monolithic registry.json reader.
    let registry_path = repo_root.join(".derived/spec-registry/by-spec");
    let cfg = load_spec_spine_config(repo_root);
    let registry = match spec_spine_core::load_committed_registry(&cfg, repo_root) {
        Ok(r) => r,
        Err(e) => {
            return vec![ValidationWarning::RegistryNotLoadable {
                registry_path: registry_path.display().to_string(),
                error: format!("{e}"),
            }];
        }
    };
    if registry.specs.iter().any(|r| r.id == spec_id) {
        return Vec::new();
    }
    vec![ValidationWarning::SpecIdNotResolved {
        spec_id: spec_id.to_string(),
        registry_path: registry_path.display().to_string(),
    }]
}

/// Load the spec-spine [`Config`](spec_spine_types::Config) for `repo_root`
/// (spec 217 engine swap). Reads the committed `spec-spine.toml` when present,
/// falling back to `Config::default()` (which points `derived_dir` at
/// `.derived`) for trees without a manifest.
fn load_spec_spine_config(repo_root: &Path) -> spec_spine_types::Config {
    std::fs::read_to_string(repo_root.join("spec-spine.toml"))
        .ok()
        .and_then(|src| spec_spine_types::load_config(&src).ok())
        .unwrap_or_default()
}

/// Write the validation warnings to a sibling
/// `validation-warnings.json` next to the certificate (no-op when
/// the slice is empty — sibling-file absence == no warnings).
pub fn write_validation_warnings(
    warnings: &[ValidationWarning],
    cert_path: &Path,
) -> Result<Option<std::path::PathBuf>, std::io::Error> {
    if warnings.is_empty() {
        return Ok(None);
    }
    let sibling = cert_path
        .parent()
        .unwrap_or(Path::new("."))
        .join("validation-warnings.json");
    let body = serde_json::to_string_pretty(&serde_json::json!({
        "certificateHash": "see governance-certificate.json",
        "warnings": warnings,
    }))
    .expect("validation warnings serialize");
    std::fs::write(&sibling, body)?;
    Ok(Some(sibling))
}

/// Returns true when the operator has opted into hard-failure mode
/// via `OAP_REQUIRE_SPEC_ID_RESOLUTION=1`. Default: false (warnings
/// remain warnings).
pub fn require_spec_id_resolution_enabled() -> bool {
    matches!(
        std::env::var("OAP_REQUIRE_SPEC_ID_RESOLUTION").as_deref(),
        Ok("1") | Ok("true") | Ok("yes")
    )
}

// ── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod w10_validation_tests {
    //! Cut D W-10 (spec 102 G-2) — spec_id resolution validation.

    use super::*;
    use std::fs;

    /// Repo root, resolved from the crate manifest so tests are independent of
    /// cargo's working directory. Spec 217: the committed registry is the
    /// sharded `by-spec` tree under repo root, read via the spec-spine library.
    fn repo_root() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
    }

    /// True when the committed registry shards exist (skip real-corpus tests on
    /// a fresh clone before `spec-spine compile`).
    fn shards_present(root: &Path) -> bool {
        root.join(".derived/spec-registry/by-spec").is_dir()
    }

    fn cert_with_spec_id(spec_id: Option<&str>) -> GovernanceCertificate {
        CertificateBuilder::new(
            "run-w10",
            IntentRecord {
                requirements_hash: "h".to_string(),
                spec_id: spec_id.map(String::from),
                spec_hash: None,
            },
        )
        .build_spec_hash("bs")
        .build()
    }

    #[test]
    fn validate_returns_empty_when_intent_spec_id_is_none() {
        // No spec_id -> nothing to validate, regardless of the registry.
        let cert = cert_with_spec_id(None);
        let warnings = validate_spec_id_resolution(&cert, &repo_root());
        assert!(warnings.is_empty());
    }

    #[test]
    fn validate_returns_empty_when_spec_id_resolves() {
        let root = repo_root();
        if !shards_present(&root) {
            return;
        }
        // A real corpus spec id resolves through the committed shards.
        let cert = cert_with_spec_id(Some("042-multi-provider-agent-registry"));
        let warnings = validate_spec_id_resolution(&cert, &root);
        assert!(
            warnings.is_empty(),
            "known spec id should resolve: {warnings:?}"
        );
    }

    #[test]
    fn validate_emits_warning_for_unknown_spec_id() {
        let root = repo_root();
        if !shards_present(&root) {
            return;
        }
        let cert = cert_with_spec_id(Some("999-nonexistent"));
        let warnings = validate_spec_id_resolution(&cert, &root);
        assert_eq!(warnings.len(), 1);
        match &warnings[0] {
            ValidationWarning::SpecIdNotResolved { spec_id, .. } => {
                assert_eq!(spec_id, "999-nonexistent");
            }
            other => panic!("expected SpecIdNotResolved, got {other:?}"),
        }
    }

    #[test]
    fn validate_emits_warning_when_registry_missing() {
        // A tempdir has no committed shards, so the library read fails.
        let dir = tempfile::tempdir().unwrap();
        let cert = cert_with_spec_id(Some("042-multi-provider-agent-registry"));
        let warnings = validate_spec_id_resolution(&cert, dir.path());
        assert_eq!(warnings.len(), 1);
        assert!(matches!(
            warnings[0],
            ValidationWarning::RegistryNotLoadable { .. }
        ));
    }

    #[test]
    fn write_validation_warnings_skips_empty() {
        let dir = tempfile::tempdir().unwrap();
        let cert_path = dir.path().join("governance-certificate.json");
        fs::write(&cert_path, "{}").unwrap();
        let out = write_validation_warnings(&[], &cert_path).unwrap();
        assert!(out.is_none());
        assert!(!dir.path().join("validation-warnings.json").exists());
    }

    #[test]
    fn write_validation_warnings_emits_sibling_when_non_empty() {
        let dir = tempfile::tempdir().unwrap();
        let cert_path = dir.path().join("governance-certificate.json");
        fs::write(&cert_path, "{}").unwrap();
        let warnings = vec![ValidationWarning::SpecIdNotResolved {
            spec_id: "999-x".to_string(),
            registry_path: "registry.json".to_string(),
        }];
        let out = write_validation_warnings(&warnings, &cert_path).unwrap();
        let path = out.expect("sibling path returned");
        assert!(path.exists());
        let body: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(body["warnings"][0]["kind"], "spec-id-not-resolved");
        assert_eq!(body["warnings"][0]["spec_id"], "999-x");
    }

    #[test]
    fn require_resolution_env_gate_default_and_enabled() {
        // Single test for the env-gate so test parallelism doesn't
        // race over the shared global env var. SAFETY: env::set_var
        // and remove_var are unsafe under multi-threaded test
        // invocation; bracketing the assertions here keeps the
        // mutation self-contained.
        unsafe { std::env::remove_var("OAP_REQUIRE_SPEC_ID_RESOLUTION") };
        assert!(!require_spec_id_resolution_enabled());
        unsafe { std::env::set_var("OAP_REQUIRE_SPEC_ID_RESOLUTION", "1") };
        assert!(require_spec_id_resolution_enabled());
        unsafe { std::env::set_var("OAP_REQUIRE_SPEC_ID_RESOLUTION", "true") };
        assert!(require_spec_id_resolution_enabled());
        unsafe { std::env::set_var("OAP_REQUIRE_SPEC_ID_RESOLUTION", "no") };
        assert!(!require_spec_id_resolution_enabled());
        unsafe { std::env::remove_var("OAP_REQUIRE_SPEC_ID_RESOLUTION") };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn certificate_round_trip_and_hash() {
        let cert = CertificateBuilder::new(
            "run-001",
            IntentRecord {
                requirements_hash: "abc123".into(),
                spec_id: None,
                spec_hash: None,
            },
        )
        .build_spec_hash("def456")
        .build();

        assert_eq!(cert.certificate_version, CERTIFICATE_VERSION);
        assert_eq!(cert.status, CertificateStatus::Complete);
        assert!(!cert.certificate_hash.is_empty());

        // Round-trip serialisation.
        let json = serde_json::to_string_pretty(&cert).unwrap();
        let restored: GovernanceCertificate = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.certificate_hash, cert.certificate_hash);
        assert_eq!(restored.pipeline_run_id, "run-001");
    }

    #[test]
    fn self_authenticating_hash_detects_tampering() {
        let cert = CertificateBuilder::new(
            "run-002",
            IntentRecord {
                requirements_hash: "orig".into(),
                spec_id: None,
                spec_hash: None,
            },
        )
        .build_spec_hash("spec-hash")
        .build();

        // Tamper with a field. The naive tamper (no resign) trips BOTH the
        // signature check (FR-008.4 — authoritative) AND the hash check
        // (FR-008 revised — content binding). Either is sufficient.
        let mut tampered = cert.clone();
        tampered.intent.requirements_hash = "TAMPERED".into();

        let result = verify_certificate(&tampered, None);
        assert!(!result.valid);
        assert!(
            result
                .errors
                .iter()
                .any(|e| e.contains("certificate hash mismatch")),
            "expected hash mismatch error among: {:?}",
            result.errors
        );
        assert!(
            result
                .errors
                .iter()
                .any(|e| e.contains("Ed25519 signature verification failed")),
            "expected signature failure among: {:?}",
            result.errors
        );
    }

    /// HIAS finding closure: the report's load-bearing claim was that an
    /// adversary with write access could tamper a field AND recompute the
    /// SHA-256 hash, producing a tampered cert that still passes
    /// `verify_certificate`. Post FR-008.1 amendment, the signature is the
    /// authoritative provenance check — recomputing the hash without access
    /// to the signing key cannot mint a valid signature, so the tamper is
    /// caught at step 0 of `verify_certificate`.
    #[test]
    fn tamper_with_hash_resign_attack_is_caught_by_signature() {
        let cert = CertificateBuilder::new(
            "run-hias-001",
            IntentRecord {
                requirements_hash: "orig".into(),
                spec_id: None,
                spec_hash: None,
            },
        )
        .build_spec_hash("spec-hash")
        .build();

        // Adversary: tamper a field, then re-mint the SHA-256 hash so the
        // cert is internally hash-consistent. Under the pre-amendment
        // FR-008 contract, this would have passed verification — the
        // exact attack the HIAS readiness assessment surfaced as Critical.
        let mut tampered = cert.clone();
        tampered.intent.requirements_hash = "TAMPERED-BUT-RESIGNED".into();
        tampered.certificate_hash = compute_certificate_hash(&tampered);

        // Hash check alone now passes — the attack succeeded against
        // FR-008 (revised, content-binding only).
        let hash_only = compute_certificate_hash(&tampered);
        assert_eq!(
            tampered.certificate_hash, hash_only,
            "hash-only check is no longer authoritative — this is expected"
        );

        // But the Ed25519 signature was computed by the original key over
        // the ORIGINAL canonical bytes (cert_signature blank + original
        // certificate_hash). The adversary lacks the signing key and
        // cannot mint a new signature. Verification MUST fail at the
        // signature step (FR-008.4).
        let result = verify_certificate(&tampered, None);
        assert!(
            !result.valid,
            "tamper-with-resign attack should fail signature check (FR-008.4); errors: {:?}",
            result.errors
        );
        assert!(
            result
                .errors
                .iter()
                .any(|e| e.contains("Ed25519 signature verification failed")),
            "expected Ed25519 signature failure; errors: {:?}",
            result.errors
        );
    }

    /// Sanity: a clean certificate verifies cleanly under signature + hash
    /// + version checks. Regression guard against the signing path being
    ///   off-by-one with the hash path (e.g., wrong field-zeroing order).
    #[test]
    fn clean_certificate_verifies() {
        let cert = CertificateBuilder::new(
            "run-clean",
            IntentRecord {
                requirements_hash: "abc".into(),
                spec_id: None,
                spec_hash: None,
            },
        )
        .build_spec_hash("spec")
        .build();

        // Built cert should be self-consistent.
        assert!(!cert.signing_public_key.is_empty(), "public key set");
        assert!(!cert.cert_signature.is_empty(), "signature set");
        assert_eq!(
            cert.signing_attestation.kind,
            SigningAttestationKind::Ephemeral,
            "test env has no OAP_SIGNING_KEY → ephemeral fallback"
        );

        let result = verify_certificate(&cert, None);
        assert!(
            result.valid,
            "clean cert must verify cleanly; errors: {:?}",
            result.errors
        );
    }

    #[test]
    fn incomplete_certificate_on_failure() {
        let cert = CertificateBuilder::new(
            "run-003",
            IntentRecord {
                requirements_hash: "req".into(),
                spec_id: None,
                spec_hash: None,
            },
        )
        .add_stage(StageRecord {
            stage_id: "s0-preflight".into(),
            status: StageOutcome::Passed,
            artifact_hashes: BTreeMap::new(),
            gate_result: None,
            duration_ms: None,
            sandbox_execution: None,
        })
        .add_stage(StageRecord {
            stage_id: "s1-business-requirements".into(),
            status: StageOutcome::Failed,
            artifact_hashes: BTreeMap::new(),
            gate_result: Some(GateResultRecord {
                passed: false,
                checks_run: 3,
                checks_failed: 1,
            }),
            duration_ms: None,
            sandbox_execution: None,
        })
        .build();

        assert_eq!(cert.status, CertificateStatus::Incomplete);
    }

    #[test]
    fn persist_and_verify_with_artifacts() {
        let dir = tempfile::tempdir().unwrap();
        let artifact_dir = dir.path().join("artifacts");
        let stage_dir = artifact_dir.join("s0-preflight");
        fs::create_dir_all(&stage_dir).unwrap();

        // Write a test artifact.
        let artifact_content = b"preflight output data";
        fs::write(stage_dir.join("preflight.json"), artifact_content).unwrap();

        let artifact_hash = sha256_bytes(artifact_content);

        let cert = CertificateBuilder::new(
            "run-004",
            IntentRecord {
                requirements_hash: "req-hash".into(),
                spec_id: None,
                spec_hash: None,
            },
        )
        .add_stage(StageRecord {
            stage_id: "s0-preflight".into(),
            status: StageOutcome::Passed,
            artifact_hashes: BTreeMap::from([("preflight.json".into(), artifact_hash.clone())]),
            gate_result: None,
            duration_ms: None,
            sandbox_execution: None,
        })
        .build();

        // Persist.
        let cert_dir = dir.path().join("output");
        persist_certificate(&cert, &cert_dir).unwrap();
        assert!(cert_dir.join("governance-certificate.json").exists());

        // Verify against untampered artifacts.
        let result = verify_certificate(&cert, Some(&artifact_dir));
        assert!(result.valid, "errors: {:?}", result.errors);

        // Tamper with the artifact on disk.
        fs::write(stage_dir.join("preflight.json"), b"TAMPERED").unwrap();
        let result = verify_certificate(&cert, Some(&artifact_dir));
        assert!(!result.valid);
        assert!(result.errors[0].contains("artifact hash mismatch"));
    }

    #[test]
    fn generate_certificate_from_pipeline_state() {
        let dir = tempfile::tempdir().unwrap();
        let artifact_dir = dir.path().join("artifacts");
        let stage_dir = artifact_dir.join("s1-business-requirements");
        fs::create_dir_all(&stage_dir).unwrap();
        fs::write(stage_dir.join("entity-model.json"), b"{}").unwrap();

        let mut state = FactoryPipelineState::new("run-005", "acme-vue-encore");
        state.transition_to_scaffolding("build-spec-hash-xyz".into());
        state.mark_complete();

        let cert = generate_certificate(&state, "requirements-hash", &artifact_dir, None);

        assert_eq!(cert.pipeline_run_id, "run-005");
        assert_eq!(cert.build_spec.hash, "build-spec-hash-xyz");
        assert_eq!(cert.intent.requirements_hash, "requirements-hash");

        // s1 should have the artifact.
        let s1 = cert
            .stages
            .iter()
            .find(|s| s.stage_id == "s1-business-requirements")
            .unwrap();
        assert_eq!(s1.status, StageOutcome::Passed);
        assert!(s1.artifact_hashes.contains_key("entity-model.json"));

        // Self-hash should verify.
        let result = verify_certificate(&cert, Some(&artifact_dir));
        assert!(result.valid, "errors: {:?}", result.errors);
    }

    // ── Spec 162 sandbox-execution stage record (§FR-008) ───────────

    fn sandbox_outcome_for_tests() -> factory_contracts::sandbox::SandboxExecution {
        use factory_contracts::sandbox::{
            IsolationTier as ContractTier, ResourcePeak, SandboxExecution,
        };
        let mut inputs = BTreeMap::new();
        inputs.insert("/in/source.rs".to_string(), "i".repeat(64));
        let mut outputs = BTreeMap::new();
        outputs.insert("/out/binary".to_string(), "o".repeat(64));
        SandboxExecution {
            command: vec!["cargo".into(), "test".into()],
            input_artifact_hashes: inputs,
            output_artifact_hashes: outputs,
            resource_peak: ResourcePeak {
                cpu_milli_peak: 250,
                memory_bytes_peak: 1024 * 1024,
                pid_peak: 42,
            },
            isolation_tier: ContractTier::RestrictedContainer,
            runtime_descriptor: "AAECAw==".into(),
            deadline_hit: false,
            exit_code: 0,
        }
    }

    #[test]
    fn sandbox_execution_record_from_outcome_normalises_tier_to_numeric() {
        let outcome = sandbox_outcome_for_tests();
        let record = SandboxExecutionRecord::from_outcome(outcome);
        assert_eq!(record.isolation_tier, 2);
        assert_eq!(record.command, vec!["cargo", "test"]);
        assert!(record.input_artifact_hashes.contains_key("/in/source.rs"));
        assert!(record.output_artifact_hashes.contains_key("/out/binary"));
        assert_eq!(record.resource_peak.cpu_milli_peak, 250);
        assert_eq!(record.exit_code, 0);
        assert!(!record.deadline_hit);
    }

    #[test]
    fn sandbox_record_tier_1_for_sandbox_runtime() {
        use factory_contracts::sandbox::IsolationTier as ContractTier;
        let mut outcome = sandbox_outcome_for_tests();
        outcome.isolation_tier = ContractTier::SandboxRuntime;
        let record = SandboxExecutionRecord::from_outcome(outcome);
        assert_eq!(record.isolation_tier, 1);
    }

    #[test]
    fn sandbox_execution_record_serde_round_trip() {
        let record = SandboxExecutionRecord::from_outcome(sandbox_outcome_for_tests());
        let json = serde_json::to_string(&record).unwrap();
        let restored: SandboxExecutionRecord = serde_json::from_str(&json).unwrap();
        assert_eq!(restored, record);
    }

    #[test]
    fn legacy_stage_record_hash_invariant_under_field_introduction() {
        // A stage record with sandbox_execution: None MUST serialise
        // identically to the pre-1.2.0 canonical form so that pre-existing
        // certificates carry an unchanged certificateHash. The
        // skip_serializing_if = "Option::is_none" attribute is the
        // load-bearing piece — guard against accidental removal.
        let stage = StageRecord {
            stage_id: "s0-preflight".into(),
            status: StageOutcome::Passed,
            artifact_hashes: BTreeMap::from([("preflight.json".into(), "h".repeat(64))]),
            gate_result: None,
            duration_ms: None,
            sandbox_execution: None,
        };
        let json = serde_json::to_string(&stage).unwrap();
        assert!(
            !json.contains("sandboxExecution"),
            "Option::is_none must be skipped; got: {json}"
        );
    }

    #[test]
    fn sandbox_stage_certificate_hash_binds_command_and_tier() {
        let outcome_a = sandbox_outcome_for_tests();
        let mut outcome_b = sandbox_outcome_for_tests();
        outcome_b.command = vec!["cargo".into(), "build".into()]; // distinct command

        let mut hashes_a = BTreeMap::new();
        hashes_a.insert("out.tar".into(), "h".repeat(64));

        let cert_a = CertificateBuilder::new(
            "run-sbx-a",
            IntentRecord {
                requirements_hash: "req".into(),
                spec_id: None,
                spec_hash: None,
            },
        )
        .add_stage(StageRecord {
            stage_id: "s6-build".into(),
            status: StageOutcome::Passed,
            artifact_hashes: hashes_a.clone(),
            gate_result: None,
            duration_ms: None,
            sandbox_execution: Some(SandboxExecutionRecord::from_outcome(outcome_a)),
        })
        .build();

        let cert_b = CertificateBuilder::new(
            "run-sbx-a", // same run id intentionally
            IntentRecord {
                requirements_hash: "req".into(),
                spec_id: None,
                spec_hash: None,
            },
        )
        .add_stage(StageRecord {
            stage_id: "s6-build".into(),
            status: StageOutcome::Passed,
            artifact_hashes: hashes_a,
            gate_result: None,
            duration_ms: None,
            sandbox_execution: Some(SandboxExecutionRecord::from_outcome(outcome_b)),
        })
        .build();

        assert_ne!(
            cert_a.certificate_hash, cert_b.certificate_hash,
            "certificate hash must bind the sandbox command — SC-004"
        );
    }

    #[test]
    fn cert_without_inter_stage_chain_omits_field_in_json() {
        // Spec 170 FR-007 invariance: a cert built without the chain
        // must serialise byte-identically to a pre-1.3.0 payload at
        // the inter-stage layer — only the version string differs.
        let cert = CertificateBuilder::new(
            "run-no-chain",
            IntentRecord {
                requirements_hash: "h".into(),
                spec_id: None,
                spec_hash: None,
            },
        )
        .build_spec_hash("bs")
        .build();
        let json = serde_json::to_string(&cert).unwrap();
        assert!(
            !json.contains("interStageChain"),
            "Option::is_none must be skipped; got: {json}"
        );
    }

    #[test]
    fn cert_with_inter_stage_chain_round_trips_and_verifies() {
        use crate::inter_stage_manifest::{RunKeyChain, StageHandoffSigner};
        let tmp = tempfile::tempdir().unwrap();
        let run_dir = tmp.path().to_path_buf();
        let mut signer = StageHandoffSigner::establish("run-cert-chain", &run_dir).unwrap();
        let m1 = signer
            .sign_handoff("s0", "s1", BTreeMap::new(), BTreeMap::new())
            .unwrap();
        let m2 = signer
            .sign_handoff("s1", "s2", BTreeMap::new(), BTreeMap::new())
            .unwrap();
        let chain: RunKeyChain = signer.finalize();
        let chain_record = InterStageChainRecord {
            key_chain: chain,
            manifests: vec![m1, m2],
        };

        let cert = CertificateBuilder::new(
            "run-cert-chain",
            IntentRecord {
                requirements_hash: "h".into(),
                spec_id: None,
                spec_hash: None,
            },
        )
        .build_spec_hash("bs")
        .inter_stage_chain(chain_record)
        .build();

        let json = serde_json::to_string(&cert).unwrap();
        assert!(json.contains("interStageChain"), "field should serialise");
        let restored: GovernanceCertificate = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.certificate_hash, cert.certificate_hash);
        let result = verify_certificate(&restored, None);
        assert!(
            result.valid,
            "cert with chain should verify; errors: {:?}",
            result.errors
        );
    }

    #[test]
    fn cert_with_tampered_inter_stage_manifest_fails_verification() {
        use crate::inter_stage_manifest::StageHandoffSigner;
        let tmp = tempfile::tempdir().unwrap();
        let run_dir = tmp.path().to_path_buf();
        let mut signer = StageHandoffSigner::establish("run-tamper", &run_dir).unwrap();
        let mut m1 = signer
            .sign_handoff(
                "s0",
                "s1",
                BTreeMap::from([("preflight.json".into(), "h0".into())]),
                BTreeMap::new(),
            )
            .unwrap();
        // Tamper the manifest after signing.
        m1.artifact_hashes
            .insert("preflight.json".into(), "tampered".into());

        let chain_record = InterStageChainRecord {
            key_chain: signer.finalize(),
            manifests: vec![m1],
        };

        let cert = CertificateBuilder::new(
            "run-tamper",
            IntentRecord {
                requirements_hash: "h".into(),
                spec_id: None,
                spec_hash: None,
            },
        )
        .build_spec_hash("bs")
        .inter_stage_chain(chain_record)
        .build();

        let result = verify_certificate(&cert, None);
        assert!(!result.valid, "tampered manifest should fail");
        assert!(
            result
                .errors
                .iter()
                .any(|e| e.contains("inter-stage manifest s0→s1")),
            "expected manifest-level diagnostic; got: {:?}",
            result.errors
        );
    }

    #[test]
    fn cert_rejects_chain_with_mismatched_run_id() {
        use crate::inter_stage_manifest::StageHandoffSigner;
        let tmp = tempfile::tempdir().unwrap();
        let run_dir = tmp.path().to_path_buf();
        let mut signer = StageHandoffSigner::establish("run-A", &run_dir).unwrap();
        let m = signer
            .sign_handoff("s0", "s1", BTreeMap::new(), BTreeMap::new())
            .unwrap();
        let chain_record = InterStageChainRecord {
            key_chain: signer.finalize(),
            manifests: vec![m],
        };

        // Certificate claims run-B but embeds a chain from run-A.
        let cert = CertificateBuilder::new(
            "run-B",
            IntentRecord {
                requirements_hash: "h".into(),
                spec_id: None,
                spec_hash: None,
            },
        )
        .build_spec_hash("bs")
        .inter_stage_chain(chain_record)
        .build();

        let result = verify_certificate(&cert, None);
        assert!(!result.valid, "mismatched run_id should fail");
        assert!(
            result
                .errors
                .iter()
                .any(|e| e.contains("does not match certificate pipeline_run_id")),
            "got: {:?}",
            result.errors
        );
    }

    #[test]
    fn sandbox_stage_certificate_round_trips() {
        let outcome = sandbox_outcome_for_tests();
        let cert = CertificateBuilder::new(
            "run-sbx-rt",
            IntentRecord {
                requirements_hash: "req".into(),
                spec_id: None,
                spec_hash: None,
            },
        )
        .add_stage(StageRecord {
            stage_id: "s6-build".into(),
            status: StageOutcome::Passed,
            artifact_hashes: BTreeMap::new(),
            gate_result: None,
            duration_ms: None,
            sandbox_execution: Some(SandboxExecutionRecord::from_outcome(outcome)),
        })
        .build();

        let json = serde_json::to_string(&cert).unwrap();
        assert!(json.contains("sandboxExecution"));
        assert!(json.contains("\"isolationTier\":2"));

        let restored: GovernanceCertificate = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.certificate_hash, cert.certificate_hash);
        let stage = &restored.stages[0];
        let sbx = stage.sandbox_execution.as_ref().unwrap();
        assert_eq!(sbx.isolation_tier, 2);
        assert_eq!(sbx.command, vec!["cargo", "test"]);
    }

    // ── spec 168 §FR-003 / §FR-007: signer field + halt-if-no-signer ──

    fn intent_for_signer_tests() -> IntentRecord {
        IntentRecord {
            requirements_hash: sha256_bytes(b"reqs"),
            spec_id: None,
            spec_hash: None,
        }
    }

    #[test]
    fn signer_constructor_rejects_empty_or_whitespace_subject() {
        assert!(matches!(
            Signer::new("", "rauthy"),
            Err(SignerError::EmptySubject)
        ));
        assert!(matches!(
            Signer::new("   \t  ", "rauthy"),
            Err(SignerError::EmptySubject)
        ));
        assert!(matches!(
            Signer::new("alice@example.com", ""),
            Err(SignerError::EmptyIdentityProvider)
        ));
    }

    #[test]
    fn build_tenant_halts_when_no_signer_attached() {
        let result = CertificateBuilder::new("run-1", intent_for_signer_tests())
            .build_spec_hash("bs")
            .build_tenant();
        assert!(matches!(
            result,
            Err(CertificateBuildError::MissingSigner)
        ));
    }

    #[test]
    fn build_tenant_succeeds_when_signer_attached() {
        let signer =
            Signer::new("alice@tenant.example.com", "rauthy@tenant-org").unwrap();
        let cert = CertificateBuilder::new("run-1", intent_for_signer_tests())
            .build_spec_hash("bs")
            .signer(signer.clone())
            .build_tenant()
            .unwrap();
        let attached = cert.signer.as_ref().unwrap();
        assert_eq!(attached.subject, signer.subject);
        assert_eq!(attached.identity_provider, signer.identity_provider);
        assert_eq!(cert.certificate_version, CERTIFICATE_VERSION);
    }

    #[test]
    fn oap_build_still_omits_signer_when_unset() {
        // Backward compatibility: legacy OAP-side builders that don't
        // attach a signer must still produce a valid (signer-less) cert
        // via the infallible `build()` entry point. The serialised form
        // omits the `signer` field entirely.
        let cert = CertificateBuilder::new("run-1", intent_for_signer_tests())
            .build_spec_hash("bs")
            .build();
        assert!(cert.signer.is_none());
        let json = serde_json::to_string(&cert).unwrap();
        assert!(!json.contains("\"signer\""));
    }

    #[test]
    fn signer_field_binds_into_certificate_hash() {
        // Two certs identical except for signer must produce different
        // hashes — the signer is part of the canonical content the
        // hash + signature attest.
        let bare = CertificateBuilder::new("run-1", intent_for_signer_tests())
            .build_spec_hash("bs")
            .build();
        let signed = CertificateBuilder::new("run-1", intent_for_signer_tests())
            .build_spec_hash("bs")
            .signer(Signer::new("a@b", "rauthy").unwrap())
            .build();
        assert_ne!(bare.certificate_hash, signed.certificate_hash);
    }

    // ── spec 168 §2.4: stage-shape flexibility for tenant grammars ──

    fn write_stage_artifact(root: &Path, stage_id: &str, name: &str, body: &[u8]) {
        let stage_dir = root.join(stage_id);
        std::fs::create_dir_all(&stage_dir).unwrap();
        std::fs::write(stage_dir.join(name), body).unwrap();
    }

    fn pipeline_state_for_stage_tests() -> FactoryPipelineState {
        let mut state = FactoryPipelineState::new("tenant-run-1", "acme-vue-encore");
        state.transition_to_scaffolding("bs".into());
        state
    }

    #[test]
    fn tenant_stage_ids_round_trip_through_generate_certificate() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        write_stage_artifact(dir, "tenant-codegen", "app.rs", b"fn main(){}");
        write_stage_artifact(dir, "tenant-bundle", "bundle.tar", b"<bytes>");

        let state = pipeline_state_for_stage_tests();
        let cert = generate_certificate_with_stage_ids(
            &state,
            "req-hash",
            dir,
            None,
            &["tenant-codegen", "tenant-bundle"],
        );

        assert_eq!(cert.stages.len(), 2);
        assert_eq!(cert.stages[0].stage_id, "tenant-codegen");
        assert_eq!(cert.stages[1].stage_id, "tenant-bundle");
        assert_eq!(cert.stages[0].status, StageOutcome::Passed);
        assert!(cert.stages[0].artifact_hashes.contains_key("app.rs"));

        let result = verify_certificate(&cert, Some(dir));
        assert!(result.valid, "errors: {:?}", result.errors);
    }

    #[test]
    fn empty_stage_id_slice_falls_back_to_filesystem_discovery() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        write_stage_artifact(dir, "z-final", "z.txt", b"z");
        write_stage_artifact(dir, "a-prepare", "a.txt", b"a");
        write_stage_artifact(dir, "m-middle", "m.txt", b"m");

        let state = pipeline_state_for_stage_tests();
        let cert = generate_certificate_with_stage_ids(&state, "req-hash", dir, None, &[]);

        // Filesystem discovery yields lexicographic order.
        assert_eq!(cert.stages.len(), 3);
        assert_eq!(cert.stages[0].stage_id, "a-prepare");
        assert_eq!(cert.stages[1].stage_id, "m-middle");
        assert_eq!(cert.stages[2].stage_id, "z-final");
    }

    #[test]
    fn oap_default_stage_list_unchanged() {
        // Backward-compat: the OAP-side generate_certificate() must still
        // produce stages s0..s5 in canonical order regardless of which
        // subdirectories actually exist on disk (skipped → empty hashes).
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        write_stage_artifact(dir, "s0-preflight", "ok.json", b"{}");

        let state = pipeline_state_for_stage_tests();
        let cert = generate_certificate(&state, "req-hash", dir, None);

        assert_eq!(cert.stages.len(), 6);
        for (i, expected) in OAP_STAGE_IDS.iter().enumerate() {
            assert_eq!(&cert.stages[i].stage_id, expected);
        }
        assert_eq!(cert.stages[0].status, StageOutcome::Passed);
        assert_eq!(cert.stages[1].status, StageOutcome::Skipped);
    }

    #[test]
    fn cert_with_signer_round_trips_through_json() {
        let signer = Signer::new("bart@tenant.example", "rauthy@tenant-org")
            .unwrap()
            .with_session_id("sess-42");
        let cert = CertificateBuilder::new("run-1", intent_for_signer_tests())
            .build_spec_hash("bs")
            .signer(signer)
            .build_tenant()
            .unwrap();

        let json = serde_json::to_string(&cert).unwrap();
        assert!(json.contains("\"signer\""));
        assert!(json.contains("\"subject\":\"bart@tenant.example\""));
        assert!(json.contains("\"identityProvider\":\"rauthy@tenant-org\""));
        assert!(json.contains("\"sessionId\":\"sess-42\""));

        let restored: GovernanceCertificate = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.certificate_hash, cert.certificate_hash);
        let s = restored.signer.as_ref().unwrap();
        assert_eq!(s.subject, "bart@tenant.example");
        assert_eq!(s.identity_provider, "rauthy@tenant-org");
        assert_eq!(s.session_id.as_deref(), Some("sess-42"));

        // Verifier accepts a signed tenant cert.
        let result = verify_certificate(&restored, None);
        assert!(result.valid, "errors: {:?}", result.errors);
    }

    // Spec 198 FR-013(c) — consumed overrides are bound inside the hash +
    // signature: round-trip, tamper detection, and the empty-list
    // byte-compat guarantee.
    #[test]
    fn consumed_overrides_bound_and_tamper_evident() {
        let overrides = vec![ConsumedOverride {
            artifact_id: "art-1".into(),
            path: "process/stages/01-analyse.md".into(),
            content_hash: "ab".repeat(32),
            author: Some("user-1".into()),
            modified_at: Some("2026-06-10T00:00:00.000Z".into()),
            verified: true,
            verified_by: Some("admin-1".into()),
        }];
        let cert = CertificateBuilder::new("run-ov", intent_for_signer_tests())
            .build_spec_hash("bs")
            .consumed_overrides(overrides)
            .build();

        let json = serde_json::to_string(&cert).unwrap();
        assert!(json.contains("\"consumedOverrides\""));
        assert!(json.contains("\"artifactId\":\"art-1\""));
        assert!(json.contains("\"verified\":true"));

        let restored: GovernanceCertificate = serde_json::from_str(&json).unwrap();
        let result = verify_certificate(&restored, None);
        assert!(result.valid, "errors: {:?}", result.errors);

        // Flipping the verified state after emission must break the chain.
        let mut tampered = restored.clone();
        tampered.consumed_overrides[0].verified = false;
        let result = verify_certificate(&tampered, None);
        assert!(!result.valid, "tampered override state must fail verify");
    }

    #[test]
    fn empty_consumed_overrides_serialises_without_key() {
        let cert = CertificateBuilder::new("run-no-ov", intent_for_signer_tests())
            .build_spec_hash("bs")
            .build();
        let json = serde_json::to_string(&cert).unwrap();
        assert!(!json.contains("consumedOverrides"));
        let restored: GovernanceCertificate = serde_json::from_str(&json).unwrap();
        assert!(restored.consumed_overrides.is_empty());
    }
}

#[cfg(test)]
mod corpus_binding_tests {
    //! Spec 218 (run-cert corpus binding) AC-1 through AC-5.
    use super::*;
    use spec_spine_types::attest::{
        CompileVerdict, CorpusAttestation, LintVerdict, ToolStamp, Verdicts,
    };

    fn sample_attestation(registry_hash: &str) -> CorpusAttestation {
        CorpusAttestation {
            schema_version: spec_spine_types::attest::ATTESTATION_SCHEMA_VERSION.into(),
            tool: ToolStamp {
                name: "spec-spine".into(),
                version: "0.8.0".into(),
            },
            inputs_manifest_hash: "inputs-abc".into(),
            registry_hash: registry_hash.into(),
            verdicts: Verdicts {
                compile: CompileVerdict { ok: true },
                lint: LintVerdict {
                    ok: true,
                    findings_hash: "findings-0".into(),
                },
                couple: None,
            },
        }
    }

    fn cert_with_binding(binding: Option<(&str, &str)>) -> GovernanceCertificate {
        let mut b = CertificateBuilder::new(
            "run-218",
            IntentRecord {
                requirements_hash: "req".into(),
                spec_id: None,
                spec_hash: None,
            },
        )
        .build_spec_hash("spec-hash");
        if let Some((hash, ver)) = binding {
            b = b.corpus_binding(hash, ver);
        }
        b.build()
    }

    /// AC-1: the binding is INSIDE the content-binding hash + signature, and it
    /// serialises camelCase as `corpusBinding`.
    #[test]
    fn binding_is_inside_hash_and_serialises_camel_case() {
        let bound = cert_with_binding(Some(("deadbeef", "0.8.0")));
        let unbound = cert_with_binding(None);
        assert_ne!(
            bound.certificate_hash, unbound.certificate_hash,
            "binding must change the content-binding hash (proves it is inside the hash)"
        );
        let json = serde_json::to_string(&bound).unwrap();
        assert!(json.contains("corpusBinding"));
        assert!(json.contains("corpusAttestationHash"));
        assert!(json.contains("specSpineVersion"));
        // The bound cert still verifies cleanly (the signature spans the binding).
        let result = verify_certificate(&bound, None);
        assert!(
            result.valid,
            "bound cert must verify; errors: {:?}",
            result.errors
        );
    }

    /// AC-2: the four verify outcomes (verified / mismatch / present-but-unverified / unbound).
    #[test]
    fn verify_outcomes_cover_supply_mismatch_and_absence() {
        let dir = tempfile::tempdir().unwrap();
        let att = sample_attestation("registry-1");
        let expected = spec_spine_core::attest::attestation_hash(&att).unwrap();
        let att_path = dir.path().join("attestation.json");
        std::fs::write(&att_path, serde_json::to_string(&att).unwrap()).unwrap();

        let bound = cert_with_binding(Some((expected.as_str(), "0.8.0")));

        // (a) matching attestation -> Verified
        match verify_corpus_binding(&bound, Some(&att_path)) {
            Ok(CorpusBindingOutcome::Verified { hash }) => assert_eq!(hash, expected),
            other => panic!("expected Verified, got {other:?}"),
        }

        // (b) mismatched attestation -> Err naming the mismatch
        let other_att = sample_attestation("registry-DIFFERENT");
        let other_path = dir.path().join("other.json");
        std::fs::write(&other_path, serde_json::to_string(&other_att).unwrap()).unwrap();
        let err = verify_corpus_binding(&bound, Some(&other_path)).unwrap_err();
        assert!(err.contains("mismatch"), "got: {err}");

        // (c) binding present, no attestation supplied -> PRESENT-BUT-UNVERIFIED (fail-closed)
        let err = verify_corpus_binding(&bound, None).unwrap_err();
        assert!(err.contains("PRESENT-BUT-UNVERIFIED"), "got: {err}");

        // (d) no binding, no attestation -> Unbound (notice, not error)
        let unbound = cert_with_binding(None);
        assert_eq!(
            verify_corpus_binding(&unbound, None).unwrap(),
            CorpusBindingOutcome::Unbound
        );
    }

    /// AC-3 / AC-4: additive and byte-identical when absent; an unbound cert
    /// (no `corpusBinding` key, the pre-1.6.0 shape) round-trips and verifies.
    #[test]
    fn absent_binding_is_skipped_and_legacy_certs_verify() {
        let unbound = cert_with_binding(None);
        let json = serde_json::to_string(&unbound).unwrap();
        assert!(
            !json.contains("corpusBinding"),
            "absent binding must be skipped in serialisation"
        );
        let restored: GovernanceCertificate = serde_json::from_str(&json).unwrap();
        assert!(restored.corpus_binding.is_none());
        let result = verify_certificate(&restored, None);
        assert!(
            result.valid,
            "unbound cert must verify; errors: {:?}",
            result.errors
        );
    }

    /// AC-5: the verify path re-hashes the SUPPLIED attestation payload only,
    /// via `attestation_hash`. It never calls `attest` / `verify_recompute`
    /// (enforced structurally by clippy.toml disallowed-methods; documented
    /// here for readers).
    #[test]
    fn verify_uses_payload_hash_not_corpus_recompute() {
        let dir = tempfile::tempdir().unwrap();
        let att = sample_attestation("registry-ac5");
        let att_path = dir.path().join("a.json");
        std::fs::write(&att_path, serde_json::to_string(&att).unwrap()).unwrap();
        let hash = spec_spine_core::attest::attestation_hash(&att).unwrap();
        let bound = cert_with_binding(Some((hash.as_str(), "0.8.0")));
        assert!(matches!(
            verify_corpus_binding(&bound, Some(&att_path)),
            Ok(CorpusBindingOutcome::Verified { .. })
        ));
    }

    /// Spec 218 FR-002 durability guard. clippy only WARNS (never errors) on a
    /// `disallowed-methods` path that stops resolving, so a future spec-spine
    /// rename would silently make the attestation-emit ban inert; factory-engine
    /// never references those functions, so nothing else would catch it. These
    /// imports fail to COMPILE if any banned path stops resolving, forcing
    /// `clippy.toml` to be updated in lockstep. Importing (not calling) does not
    /// trip `disallowed_methods`, which is call-site only.
    #[test]
    fn banned_attestation_emit_paths_still_resolve() {
        #[allow(unused_imports)]
        use spec_spine_core::attest::{attest, verify_recompute};
        #[allow(unused_imports)]
        use spec_spine_core::{attest_json, verify_attestation_json};
    }
}

#[cfg(test)]
mod sbom_binding_tests {
    //! Spec 203 (produced-app SBOM + dependency-audit attestation) AC-2/AC-3
    //! cert-side contract, plus the audit-record schema round-trip (FR-002).
    use super::*;

    fn cert_with_sbom(binding: Option<(&str, &str, &str)>) -> GovernanceCertificate {
        let mut b = CertificateBuilder::new(
            "run-203",
            IntentRecord {
                requirements_hash: "req".into(),
                spec_id: None,
                spec_hash: None,
            },
        )
        .build_spec_hash("spec-hash");
        if let Some((bom, audit, ver)) = binding {
            b = b.sbom_artifact_binding(bom, audit, ver);
        }
        b.build()
    }

    /// AC-3: the binding is INSIDE the content-binding hash + signature, and it
    /// serialises camelCase as `sbomArtifactBinding`.
    #[test]
    fn binding_is_inside_hash_and_serialises_camel_case() {
        let bound = cert_with_sbom(Some(("bomdeadbeef", "auditcafe", "1.19.0")));
        let unbound = cert_with_sbom(None);
        assert_ne!(
            bound.certificate_hash, unbound.certificate_hash,
            "binding must change the content-binding hash (proves it is inside the hash)"
        );
        let json = serde_json::to_string(&bound).unwrap();
        assert!(json.contains("sbomArtifactBinding"));
        assert!(json.contains("bomHash"));
        assert!(json.contains("auditHash"));
        assert!(json.contains("bomToolVersion"));
        // The bound cert still verifies cleanly (the signature spans the binding).
        let result = verify_certificate(&bound, None);
        assert!(
            result.valid,
            "bound cert must verify; errors: {:?}",
            result.errors
        );
    }

    /// AC-2: the four verify outcomes (verified / bom-mismatch / audit-mismatch /
    /// present-but-unverified / unbound), re-hashing the on-disk artifacts.
    #[test]
    fn verify_outcomes_cover_supply_mismatch_and_absence() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let factory = root.join(".factory");
        std::fs::create_dir_all(&factory).unwrap();
        let bom_bytes = br#"{"bomFormat":"CycloneDX","specVersion":"1.6"}"#;
        let audit_bytes = br#"{"tool":"npm-audit","status":"absent"}"#;
        std::fs::write(factory.join("sbom.cdx.json"), bom_bytes).unwrap();
        std::fs::write(factory.join("audit.json"), audit_bytes).unwrap();
        let bom_hash = sha256_bytes(bom_bytes);
        let audit_hash = sha256_bytes(audit_bytes);

        let bound = cert_with_sbom(Some((&bom_hash, &audit_hash, "1.19.0")));

        // (a) matching dir -> Verified with both hashes echoed back.
        match verify_sbom_binding(&bound, Some(root)) {
            Ok(SbomBindingOutcome::Verified {
                bom_hash: b,
                audit_hash: a,
            }) => {
                assert_eq!(b, bom_hash);
                assert_eq!(a, audit_hash);
            }
            other => panic!("expected Verified, got {other:?}"),
        }

        // (b) tampered BOM -> Err naming the BOM mismatch.
        std::fs::write(factory.join("sbom.cdx.json"), b"TAMPERED").unwrap();
        let err = verify_sbom_binding(&bound, Some(root)).unwrap_err();
        assert!(err.contains("bom hash mismatch"), "got: {err}");
        std::fs::write(factory.join("sbom.cdx.json"), bom_bytes).unwrap();

        // (c) tampered audit -> Err naming the audit mismatch.
        std::fs::write(factory.join("audit.json"), b"TAMPERED").unwrap();
        let err = verify_sbom_binding(&bound, Some(root)).unwrap_err();
        assert!(err.contains("audit hash mismatch"), "got: {err}");
        std::fs::write(factory.join("audit.json"), audit_bytes).unwrap();

        // (d) binding present, no dir -> PRESENT-BUT-UNVERIFIED (fail-closed).
        let err = verify_sbom_binding(&bound, None).unwrap_err();
        assert!(err.contains("PRESENT-BUT-UNVERIFIED"), "got: {err}");

        // (e) no binding, no dir -> Unbound (notice, not error).
        let unbound = cert_with_sbom(None);
        assert_eq!(
            verify_sbom_binding(&unbound, None).unwrap(),
            SbomBindingOutcome::Unbound
        );
    }

    /// Additive + byte-identical when absent: an unbound cert (no
    /// `sbomArtifactBinding` key, the pre-1.7.0 shape) round-trips and verifies.
    #[test]
    fn absent_binding_is_skipped_and_legacy_certs_verify() {
        let unbound = cert_with_sbom(None);
        let json = serde_json::to_string(&unbound).unwrap();
        assert!(
            !json.contains("sbomArtifactBinding"),
            "absent binding must be skipped in serialisation"
        );
        let restored: GovernanceCertificate = serde_json::from_str(&json).unwrap();
        assert!(restored.sbom_artifact_binding.is_none());
        let result = verify_certificate(&restored, None);
        assert!(
            result.valid,
            "unbound cert must verify; errors: {:?}",
            result.errors
        );
    }

    /// The current certificate version is the load-bearing contract marker for
    /// every schema-extending spec (1.6.0 corpus binding spec 218, 1.7.0 SBOM
    /// binding spec 203, 1.8.0 budget consumption spec 202).
    #[test]
    fn certificate_version_is_current() {
        assert_eq!(CERTIFICATE_VERSION, "1.9.0");
    }

    // ── Agentic posture binding (spec 210 FR-002) ───────────────────────

    fn posture_binding(
        posture: &str,
        defaulted: bool,
        surfaces: Vec<CertAgenticSurface>,
    ) -> AgenticPostureBinding {
        AgenticPostureBinding {
            posture: posture.into(),
            defaulted,
            surfaces,
        }
    }

    fn cert_with_posture(binding: Option<AgenticPostureBinding>) -> GovernanceCertificate {
        let mut b = CertificateBuilder::new(
            "run-210",
            IntentRecord {
                requirements_hash: "req".into(),
                spec_id: None,
                spec_hash: None,
            },
        )
        .build_spec_hash("spec-hash");
        if let Some(pb) = binding {
            b = b.agentic_posture_binding(pb);
        }
        b.build()
    }

    /// FR-002: the binding is INSIDE the content hash + signature and serialises
    /// camelCase as `agenticPostureBinding`; a bound cert still verifies.
    #[test]
    fn posture_binding_is_inside_hash_and_serialises_camel_case() {
        let bound = cert_with_posture(Some(posture_binding("none", true, vec![])));
        let unbound = cert_with_posture(None);
        assert_ne!(
            bound.certificate_hash, unbound.certificate_hash,
            "binding must change the content-binding hash (proves it is inside the hash)"
        );
        let json = serde_json::to_string(&bound).unwrap();
        assert!(json.contains("agenticPostureBinding"));
        assert!(json.contains("\"defaulted\":true"));
        let result = verify_certificate(&bound, None);
        assert!(
            result.valid,
            "bound cert must verify; errors: {:?}",
            result.errors
        );
    }

    /// FR-002 / AC-2: tampering the bound posture after signing fails verify
    /// (the signature spans the binding).
    #[test]
    fn tampering_bound_posture_fails_verify() {
        let mut bound = cert_with_posture(Some(posture_binding("none", false, vec![])));
        // Flip the recorded posture: the signature no longer covers this content.
        bound.agentic_posture_binding.as_mut().unwrap().posture = "governed".into();
        let result = verify_certificate(&bound, None);
        assert!(!result.valid, "tampered posture must fail verify");
    }

    /// FR-002 / AC-2 + spec 220 regression guard: a posture-free cert (a
    /// 220-style tenant cert, or any pre-1.9.0 shape) stays byte-identical when
    /// absent and still verifies. Spec 210 must not perturb the delivered 220
    /// certificate.
    #[test]
    fn absent_posture_binding_is_skipped_and_legacy_certs_verify() {
        let unbound = cert_with_posture(None);
        let json = serde_json::to_string(&unbound).unwrap();
        assert!(
            !json.contains("agenticPostureBinding"),
            "absent binding must be skipped in serialisation"
        );
        let restored: GovernanceCertificate = serde_json::from_str(&json).unwrap();
        assert!(restored.agentic_posture_binding.is_none());
        let result = verify_certificate(&restored, None);
        assert!(
            result.valid,
            "posture-free cert must verify; errors: {:?}",
            result.errors
        );
    }

    /// FR-002: `from_build_spec(None)` yields the defaulted-none binding (Build
    /// Spec read, field omitted); `Some(authored none)` yields authored none with
    /// `defaulted: false` (the "authored none" vs "nobody asked" distinction).
    #[test]
    fn posture_binding_from_build_spec_defaulting() {
        use factory_contracts::build_spec::{AgenticPosture, PostureLevel};
        let defaulted = AgenticPostureBinding::from_build_spec(None);
        assert_eq!(defaulted.posture, "none");
        assert!(defaulted.defaulted);
        assert!(defaulted.surfaces.is_empty());

        let authored = AgenticPosture {
            posture: PostureLevel::None,
            surfaces: vec![],
        };
        let bound = AgenticPostureBinding::from_build_spec(Some(&authored));
        assert_eq!(bound.posture, "none");
        assert!(!bound.defaulted, "authored none must NOT be marked defaulted");
    }

    /// A minimal shape-conformant governance envelope (spec 198 schema), reused
    /// at application level for a `governed` surface.
    fn conformant_envelope() -> serde_json::Value {
        serde_json::json!({
            "schema_version": factory_contracts::GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
            "process": {
                "id": "app-agent",
                "objective_class": "Assist the user within the app",
                "goal_identifier_scheme": "app:<feature>"
            },
            "ceilings": { "max_tier": "tier1", "max_mutation": "read-only" },
            "gates": [{ "predicate": "human-approval-before-tool-call" }],
            "emits": [{ "kind": "assistant-response" }],
            "constituents": { "agents": "app/agents/*.md" },
            "overrides": { "require_verified": false }
        })
    }

    fn cert_surface(kind: &str, env: Option<serde_json::Value>) -> CertAgenticSurface {
        CertAgenticSurface {
            kind: kind.into(),
            description: Some("s".into()),
            governance_envelope: env,
        }
    }

    /// FR-003 (internal half): declared/governed with no surfaces, and none with
    /// surfaces, are inconsistent.
    #[test]
    fn posture_binding_surface_cardinality_consistency() {
        assert!(agentic_posture_binding_inconsistencies(&posture_binding("none", false, vec![])).is_empty());
        assert!(
            !agentic_posture_binding_inconsistencies(&posture_binding(
                "none",
                false,
                vec![cert_surface("model-api", None)]
            ))
            .is_empty(),
            "none with surfaces must be inconsistent"
        );
        assert!(
            !agentic_posture_binding_inconsistencies(&posture_binding("declared", false, vec![])).is_empty(),
            "declared with no surfaces must be inconsistent"
        );
        assert!(agentic_posture_binding_inconsistencies(&posture_binding(
            "declared",
            false,
            vec![cert_surface("model-api", None)]
        ))
        .is_empty());
        // Unknown posture string is rejected.
        assert!(!agentic_posture_binding_inconsistencies(&posture_binding("maybe", false, vec![])).is_empty());
    }

    /// FR-004: a `governed` surface requires a conformant inline governance
    /// envelope; missing or non-conformant fails, conformant passes shape.
    #[test]
    fn governed_surface_requires_conformant_envelope() {
        // missing envelope
        let missing = posture_binding("governed", false, vec![cert_surface("tool-surface", None)]);
        assert!(!agentic_posture_binding_inconsistencies(&missing).is_empty());

        // present but non-conformant
        let malformed = posture_binding(
            "governed",
            false,
            vec![cert_surface("tool-surface", Some(serde_json::json!({ "not": "an envelope" })))],
        );
        assert!(!agentic_posture_binding_inconsistencies(&malformed).is_empty());

        // conformant
        let ok = posture_binding(
            "governed",
            false,
            vec![cert_surface("tool-surface", Some(conformant_envelope()))],
        );
        assert!(
            agentic_posture_binding_inconsistencies(&ok).is_empty(),
            "conformant envelope must pass: {:?}",
            agentic_posture_binding_inconsistencies(&ok)
        );
    }

    /// FR-003/FR-004 wired through `verify_certificate`: a validly-signed but
    /// self-inconsistent binding fails verification; a consistent one passes.
    #[test]
    fn inconsistent_bound_posture_fails_verify_certificate() {
        // declared with no surfaces: inconsistent, but validly signed.
        let bad = cert_with_posture(Some(posture_binding("declared", false, vec![])));
        let result = verify_certificate(&bad, None);
        assert!(!result.valid, "self-inconsistent binding must fail verify");
        assert!(
            result.errors.iter().any(|e| e.contains("agentic_posture_binding")),
            "diagnostic must name the binding: {:?}",
            result.errors
        );

        // governed with a conformant envelope: consistent, verifies.
        let good = cert_with_posture(Some(posture_binding(
            "governed",
            false,
            vec![cert_surface("tool-surface", Some(conformant_envelope()))],
        )));
        assert!(verify_certificate(&good, None).valid);
    }

    // ── FR-003 SBOM cross-check + watchlist ─────────────────────────────

    /// The embedded watchlist parses and is non-empty (build-time invariant).
    #[test]
    fn embedded_watchlist_is_well_formed_and_non_empty() {
        let wl = load_agentic_sdk_watchlist();
        assert!(!wl.packages.is_empty(), "watchlist must be non-empty");
        assert!(
            wl.packages.iter().any(|e| e.name == "@anthropic-ai/sdk"),
            "watchlist should include the @anthropic-ai/sdk-class entry"
        );
    }

    fn bom_with(names: &[(&str, &str)]) -> Vec<u8> {
        let components: Vec<serde_json::Value> = names
            .iter()
            .map(|(name, ver)| {
                serde_json::json!({
                    "type": "library",
                    "name": name,
                    "version": ver,
                    "purl": format!("pkg:npm/{}@{}", name.replace('@', "%40"), ver)
                })
            })
            .collect();
        serde_json::to_vec(&serde_json::json!({
            "bomFormat": "CycloneDX",
            "specVersion": "1.6",
            "components": components
        }))
        .unwrap()
    }

    #[test]
    fn watchlist_matcher_hits_sdk_misses_plain_deps() {
        let hit = bom_with(&[("react", "18.0.0"), ("@anthropic-ai/sdk", "0.30.0")]);
        assert_eq!(
            first_watchlist_match_in_bom(&hit).as_deref(),
            Some("@anthropic-ai/sdk")
        );
        let miss = bom_with(&[("react", "18.0.0"), ("express", "4.19.0")]);
        assert_eq!(first_watchlist_match_in_bom(&miss), None);
    }

    fn write_bom(bytes: &[u8]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let factory = dir.path().join(".factory");
        std::fs::create_dir_all(&factory).unwrap();
        std::fs::write(factory.join("sbom.cdx.json"), bytes).unwrap();
        dir
    }

    /// AC-3: `none` posture + an `@anthropic-ai/sdk`-class dependency in the BOM
    /// is Contradicted, naming the package + posture. Both authored and
    /// defaulted `none` are falsified.
    #[test]
    fn cross_check_none_with_sdk_is_contradicted() {
        let dir = write_bom(&bom_with(&[("@anthropic-ai/sdk", "0.30.0")]));

        for defaulted in [false, true] {
            let cert = cert_with_posture(Some(posture_binding("none", defaulted, vec![])));
            match cross_check_agentic_posture(&cert, Some(dir.path())) {
                PostureCrossCheckOutcome::Contradicted { package, posture } => {
                    assert_eq!(package, "@anthropic-ai/sdk");
                    assert_eq!(posture, "none");
                }
                other => panic!("expected Contradicted (defaulted={defaulted}), got {other:?}"),
            }
        }
    }

    /// AC-3: removing the dependency (a plain-web BOM) passes; declaring the
    /// agency (`declared`) passes even with the SDK present.
    #[test]
    fn cross_check_passes_without_sdk_or_when_declared() {
        // none + no watchlisted dep -> ConsistentNone (a stated-residual pass).
        let clean = write_bom(&bom_with(&[("react", "18.0.0"), ("express", "4.19.0")]));
        let none_cert = cert_with_posture(Some(posture_binding("none", false, vec![])));
        assert_eq!(
            cross_check_agentic_posture(&none_cert, Some(clean.path())),
            PostureCrossCheckOutcome::ConsistentNone
        );

        // declared + SDK present -> Declared (agency acknowledged, not a contradiction).
        let with_sdk = write_bom(&bom_with(&[("@anthropic-ai/sdk", "0.30.0")]));
        let declared_cert = cert_with_posture(Some(posture_binding(
            "declared",
            false,
            vec![cert_surface("model-api", None)],
        )));
        assert_eq!(
            cross_check_agentic_posture(&declared_cert, Some(with_sdk.path())),
            PostureCrossCheckOutcome::Declared
        );
    }

    /// Absent binding -> Unbound; binding with no --sbom-dir -> UnverifiedNoDir.
    #[test]
    fn cross_check_unbound_and_no_dir_outcomes() {
        let unbound = cert_with_posture(None);
        assert_eq!(
            cross_check_agentic_posture(&unbound, None),
            PostureCrossCheckOutcome::Unbound
        );
        let none_cert = cert_with_posture(Some(posture_binding("none", true, vec![])));
        assert_eq!(
            cross_check_agentic_posture(&none_cert, None),
            PostureCrossCheckOutcome::UnverifiedNoDir
        );
    }

    /// FR-002: the audit-record schema round-trips for both `present` and
    /// `absent`, and skips finding/severity fields when absent (visible-absence
    /// posture, no silent zero-count noise).
    #[test]
    fn sbom_audit_record_serde_round_trip() {
        let present = SbomAuditRecord {
            tool: "npm-audit".into(),
            tool_version: Some("10.8.0".into()),
            ran_at: "2026-07-01T00:00:00Z".into(),
            status: SbomAuditStatus::Present,
            findings: Some(vec![SbomAuditFinding {
                advisory_id: "GHSA-xxxx".into(),
                severity: "high".into(),
                package: "left-pad".into(),
            }]),
            severity_counts: Some(SbomSeverityCounts {
                critical: 0,
                high: 1,
                moderate: 0,
                low: 0,
                info: 0,
            }),
            reason: None,
        };
        let json = serde_json::to_string(&present).unwrap();
        assert!(json.contains("\"status\":\"present\""));
        assert!(json.contains("severityCounts"));
        let back: SbomAuditRecord = serde_json::from_str(&json).unwrap();
        assert_eq!(back, present);

        let absent = SbomAuditRecord {
            tool: "npm-audit".into(),
            tool_version: None,
            ran_at: "2026-07-01T00:00:00Z".into(),
            status: SbomAuditStatus::Absent,
            findings: None,
            severity_counts: None,
            reason: Some("npm audit unavailable at scaffold time".into()),
        };
        let json = serde_json::to_string(&absent).unwrap();
        assert!(json.contains("\"status\":\"absent\""));
        assert!(
            !json.contains("severityCounts"),
            "absent record must skip severityCounts"
        );
        assert!(
            !json.contains("findings"),
            "absent record must skip findings"
        );
        let back: SbomAuditRecord = serde_json::from_str(&json).unwrap();
        assert_eq!(back, absent);
    }

    // ── Spec 202 FR-005 / AC-4: budget consumption binding ──────────────────

    /// All admitted axes, internally consistent (none breached).
    fn full_budget_record() -> Vec<BudgetAxisRecord> {
        admitted_axis_names()
            .into_iter()
            .map(|axis| BudgetAxisRecord {
                axis,
                ceiling: 100.0,
                actual: 10.0,
                source: "platform-default".to_string(),
                breached: false,
            })
            .collect()
    }

    fn budget_intent() -> IntentRecord {
        IntentRecord {
            requirements_hash: "req".into(),
            spec_id: None,
            spec_hash: None,
        }
    }

    /// AC-4: a certificate carrying a complete, consistent budget_consumption
    /// record verifies cleanly and round-trips through camelCase JSON.
    #[test]
    fn budget_consumption_record_verifies_and_round_trips() {
        let cert = CertificateBuilder::new("run-budget", budget_intent())
            .build_spec_hash("spec")
            .budget_consumption(full_budget_record())
            .build();

        let result = verify_certificate(&cert, None);
        assert!(
            result.valid,
            "clean budget cert must verify; errors: {:?}",
            result.errors
        );

        let json = serde_json::to_string(&cert).unwrap();
        assert!(
            json.contains("budgetConsumption"),
            "camelCase field must be present"
        );
        let back: GovernanceCertificate = serde_json::from_str(&json).unwrap();
        assert_eq!(back.budget_consumption, cert.budget_consumption);
    }

    /// AC-4: a record left internally INCONSISTENT (actual over ceiling but
    /// breached=false), e.g. a careless third-party or partial tamper, fails
    /// verification with an axis-specific diagnostic even though the certificate
    /// is validly signed. A coherent self-consistent forgery by the signing
    /// producer is out of verify's reach (self-signed key-trust model, same as
    /// corpus/sbom bindings).
    #[test]
    fn budget_consumption_inconsistent_breach_flag_fails_verify() {
        let mut records = full_budget_record();
        let tokens = records.iter_mut().find(|r| r.axis == "tokens").unwrap();
        tokens.ceiling = 100.0;
        tokens.actual = 150.0;
        tokens.breached = false; // inconsistent: 150 > 100 but "not breached"

        let cert = CertificateBuilder::new("run-budget-tamper", budget_intent())
            .build_spec_hash("spec")
            .budget_consumption(records)
            .build();

        let result = verify_certificate(&cert, None);
        assert!(!result.valid, "inconsistent record must fail verification");
        assert!(
            result
                .errors
                .iter()
                .any(|e| e.contains("tokens") && e.contains("inconsistent")),
            "diagnostic must name the axis: {:?}",
            result.errors
        );
    }

    /// AC-4: a record missing an admitted axis fails the completeness check
    /// with the missing axis named.
    #[test]
    fn budget_consumption_missing_axis_fails_verify() {
        let mut records = full_budget_record();
        records.retain(|r| r.axis != "tokens");

        let cert = CertificateBuilder::new("run-missing-axis", budget_intent())
            .build_spec_hash("spec")
            .budget_consumption(records)
            .build();

        let result = verify_certificate(&cert, None);
        assert!(!result.valid, "missing admitted axis must fail verification");
        assert!(
            result
                .errors
                .iter()
                .any(|e| e.contains("missing admitted axis 'tokens'")),
            "diagnostic must name the missing axis: {:?}",
            result.errors
        );
    }

    /// Backward-compat: a certificate with no budget_consumption (pre-1.8.0
    /// shape) verifies cleanly and skips the field in serialization.
    #[test]
    fn absent_budget_consumption_verifies_and_is_skipped() {
        let cert = CertificateBuilder::new("run-nobudget", budget_intent())
            .build_spec_hash("spec")
            .build();
        assert!(cert.budget_consumption.is_none(), "absent by default");

        let result = verify_certificate(&cert, None);
        assert!(
            result.valid,
            "absent budget must still verify; errors: {:?}",
            result.errors
        );

        let json = serde_json::to_string(&cert).unwrap();
        assert!(
            !json.contains("budgetConsumption"),
            "absent field must be skipped in JSON (byte-identical to pre-1.8.0)"
        );
    }

    /// FR-005 serde contract: every `RunBudgetAxis::ALL` variant converts (via the
    /// production `From` impl) to a snake_case axis string the verifier's admitted
    /// set recognises, and the conversions cover exactly that set. Locks the enum's
    /// serde form to the completeness check so a rename cannot silently break every
    /// production certificate (the AC-4 tests otherwise hardcode the strings).
    #[test]
    fn budget_axis_record_from_run_consumption_matches_admitted_axes() {
        let admitted = admitted_axis_names();
        let mut converted: Vec<String> = Vec::new();
        for axis in factory_contracts::RunBudgetAxis::ALL {
            let record = BudgetAxisRecord::from(orchestrator::RunBudgetConsumption {
                axis,
                ceiling: 100.0,
                actual: 1.0,
                source: factory_contracts::BudgetSource::PlatformDefault,
                breached: false,
            });
            assert!(!record.axis.is_empty(), "axis must serialize non-empty");
            assert!(
                admitted.contains(&record.axis),
                "axis '{}' must be an admitted axis {:?}",
                record.axis,
                admitted
            );
            assert_eq!(record.source, "platform-default", "source serde form");
            converted.push(record.axis);
        }
        converted.sort();
        let mut expected = admitted.clone();
        expected.sort();
        assert_eq!(
            converted, expected,
            "ALL variants must cover exactly the admitted axis set"
        );
    }

    /// AC-4: a duplicate axis row (two `tokens`) fails the closed-set check.
    #[test]
    fn budget_consumption_duplicate_axis_fails_verify() {
        let mut records = full_budget_record();
        let dup = records.iter().find(|r| r.axis == "tokens").unwrap().clone();
        records.push(dup);

        let cert = CertificateBuilder::new("run-dup-axis", budget_intent())
            .build_spec_hash("spec")
            .budget_consumption(records)
            .build();

        let result = verify_certificate(&cert, None);
        assert!(!result.valid, "duplicate axis must fail verification");
        assert!(
            result
                .errors
                .iter()
                .any(|e| e.contains("duplicate axis 'tokens'")),
            "diagnostic must name the duplicate axis: {:?}",
            result.errors
        );
    }

    /// AC-4: an unknown axis name fails the closed-set check.
    #[test]
    fn budget_consumption_unknown_axis_fails_verify() {
        let mut records = full_budget_record();
        records.push(BudgetAxisRecord {
            axis: "bogus_axis".to_string(),
            ceiling: 100.0,
            actual: 1.0,
            source: "platform-default".to_string(),
            breached: false,
        });

        let cert = CertificateBuilder::new("run-unknown-axis", budget_intent())
            .build_spec_hash("spec")
            .budget_consumption(records)
            .build();

        let result = verify_certificate(&cert, None);
        assert!(!result.valid, "unknown axis must fail verification");
        assert!(
            result
                .errors
                .iter()
                .any(|e| e.contains("unknown axis 'bogus_axis'")),
            "diagnostic must name the unknown axis: {:?}",
            result.errors
        );
    }
}
