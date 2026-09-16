//! FR-009 / FR-010 / NF-004 / SC-009 — append-only proof records, hash chain, independent verification.
//!
//! Spec 047 amendment 2026-05-11 (FR-009.1–FR-009.3) adds Ed25519 signing
//! over the chain's genesis anchor `{ chain_id, policy_bundle_hash,
//! genesis_timestamp }`, companion to spec 102 FR-008.6. The genesis
//! signature is the chain-side analog of the cert-side signature: without
//! it, an adversary who can regenerate the chain produces a consistent-
//! looking hash sequence with no external trust root. The same key
//! resolution semantics as factory-engine's `resolve_signing_material`
//! apply (`OAP_SIGNING_KEY` / `OAP_SIGNING_KEY_PATH` / ephemeral fallback).

use crate::canonical_json_sorted;
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Environment variable carrying base64-encoded 32-byte Ed25519 seed (FR-009.1).
/// Shared with factory-engine's cert signing for a single key-custody story.
pub const ENV_SIGNING_KEY: &str = "OAP_SIGNING_KEY";

/// Environment variable carrying a file path to the base64-encoded seed.
pub const ENV_SIGNING_KEY_PATH: &str = "OAP_SIGNING_KEY_PATH";

/// Serialized `decision` field on a proof record (`allow` | `deny` | `degrade`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProofRecordDecision {
    Allow,
    Deny,
    Degrade,
}

/// Serialized `privilege_level` field (`full` | `restricted` | `read-only` | `suspended`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProofPrivilege {
    Full,
    Restricted,
    #[serde(rename = "read-only")]
    ReadOnly,
    Suspended,
}

/// One proof record (FR-009). `record_hash` hashes canonical JSON of this object **without** `record_hash`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProofRecord {
    pub id: String,
    pub timestamp: String,
    pub policy_bundle_hash: String,
    pub rule_ids: Vec<String>,
    pub input_context_hash: String,
    pub decision: ProofRecordDecision,
    pub privilege_level: ProofPrivilege,
    pub previous_record_hash: String,
    pub record_hash: String,
}

/// NF-004: per-record payload budget excluding the variable-sized context hash field body.
pub const NF004_MAX_BYTES_EXCLUDING_CONTEXT: usize = 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProofChainError {
    EmptyChain,
    FirstPreviousNotBundleHash,
    PolicyBundleHashMismatch {
        index: usize,
    },
    RecordHashMismatch {
        index: usize,
    },
    BrokenLink {
        index: usize,
    },
    Nf004Exceeded {
        index: usize,
        bytes: usize,
    },
    /// FR-009.2: chain genesis anchor signature did not verify, or anchor
    /// is unsigned when the verifier required a signature. The diagnostic
    /// distinguishes the two cases.
    AnchorSignature(String),
    /// The supplied anchor's `policy_bundle_hash` does not match the
    /// expected bundle hash — the anchor and the chain disagree on which
    /// bundle they pin.
    AnchorBundleHashMismatch,
}

impl std::fmt::Display for ProofChainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyChain => write!(f, "empty chain"),
            Self::FirstPreviousNotBundleHash => write!(
                f,
                "first record previous_record_hash does not match policy bundle hash"
            ),
            Self::PolicyBundleHashMismatch { index } => {
                write!(f, "policy_bundle_hash mismatch at index {index}")
            }
            Self::RecordHashMismatch { index } => {
                write!(f, "record_hash mismatch at index {index}")
            }
            Self::BrokenLink { index } => write!(f, "broken chain link at index {index}"),
            Self::Nf004Exceeded { index, bytes } => {
                write!(
                    f,
                    "NF-004 size budget exceeded at index {index} ({bytes} bytes)"
                )
            }
            Self::AnchorSignature(diag) => write!(f, "chain anchor signature: {diag}"),
            Self::AnchorBundleHashMismatch => {
                write!(f, "chain anchor policy_bundle_hash does not match expected")
            }
        }
    }
}

impl std::error::Error for ProofChainError {}

/// Generic hash-chain linkage shared by the spec 047 policy proof chain and
/// the spec 207 audit chain (FR-001: reuse the linkage discipline, do not
/// invent a second chain shape). Computes `sha256:<hex>` over the canonical
/// JSON of `value` with `hash_field` removed, so a record never hashes its
/// own hash field. Both chains compute their record hash through this one
/// function, differing only in the record body and the field name.
pub fn link_record_hash(value: Value, hash_field: &str) -> String {
    // Spec 231: delegate to the extracted attest-ledger primitive. Byte-identical
    // to the previous in-tree implementation (same canonical-JSON sort, same
    // `sha256:` prefix), so existing chains verify unchanged.
    attest_ledger_core::link_record_hash(value, hash_field)
}

/// `record_hash = SHA-256(canonical_json(record without record_hash field))` per spec.
pub fn compute_record_hash(record: &ProofRecord) -> String {
    link_record_hash(
        serde_json::to_value(record).expect("proof record json"),
        "record_hash",
    )
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    // Spec 231: delegate to the extracted attest-ledger primitive (same
    // `sha256:<hex>` construction).
    attest_ledger_core::sha256_hex(bytes)
}

/// Approximate size of the fixed fields as JSON with `input_context_hash` emptied (NF-004).
pub fn nf004_payload_bytes(record: &ProofRecord) -> usize {
    let mut r = record.clone();
    r.input_context_hash.clear();
    serde_json::to_string(&r).expect("json").len()
}

/// Trust posture for the chain genesis signing key (spec 047 FR-009.3).
/// Mirrors `factory-engine::governance_certificate::SigningAttestationKind`
/// — kept structurally identical so the cert-side and chain-side
/// attestation tell the same story to a HIAS reviewer.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum GenesisAttestationKind {
    /// No genesis signature was set — pre-FR-009.1 chain or unsigned writer.
    #[default]
    Unsigned,
    /// Key generated for this writer's lifetime only. Local-dev posture.
    Ephemeral,
    /// Operator-supplied key via env var or file. Out of agent write scope.
    Operator,
    /// Sigstore Fulcio + Rekor anchored. Required by HIAS-strict (deferred).
    SigstoreRekor,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GenesisAttestation {
    pub kind: GenesisAttestationKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// Chain-genesis anchor (FR-009.1). The `genesis_signature` covers the
/// canonical JSON of `{ chain_id, policy_bundle_hash, genesis_timestamp }`
/// — the trio that pins the chain's starting point. Verifiers check the
/// anchor signature FIRST, before walking record hashes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofChainAnchor {
    pub chain_id: String,
    pub policy_bundle_hash: String,
    pub genesis_timestamp: String,
    /// Base64 Ed25519 public key (32 bytes). Empty for unsigned chains;
    /// HIAS verification rejects empty.
    #[serde(default)]
    pub genesis_public_key: String,
    /// Base64 Ed25519 signature (64 bytes) over canonical JSON of the
    /// anchor with `genesis_signature` zeroed.
    #[serde(default)]
    pub genesis_signature: String,
    #[serde(default)]
    pub genesis_attestation: GenesisAttestation,
}

impl ProofChainAnchor {
    /// Compute the Ed25519 signature for this anchor (FR-009.1).
    pub fn compute_signature(&self, key: &SigningKey) -> String {
        let mut a = self.clone();
        a.genesis_signature = String::new();
        let canonical =
            canonical_json_sorted(serde_json::to_value(&a).expect("anchor serialises to JSON"));
        let sig: Signature = key.sign(canonical.as_bytes());
        B64.encode(sig.to_bytes())
    }

    /// Verify the anchor's Ed25519 signature (FR-009.2). Returns `Err` with
    /// a specific diagnostic distinguishing "unsigned" from "invalid".
    pub fn verify_signature(&self) -> Result<(), String> {
        if self.genesis_public_key.is_empty() {
            return Err(
                "chain genesis is unsigned (genesis_public_key empty) — FR-009.3 rejected".into(),
            );
        }
        if self.genesis_signature.is_empty() {
            return Err(
                "chain genesis is unsigned (genesis_signature empty) — FR-009.1 rejected".into(),
            );
        }
        let pk_bytes: [u8; 32] = B64
            .decode(&self.genesis_public_key)
            .map_err(|e| format!("genesis_public_key base64 decode: {e}"))?
            .try_into()
            .map_err(|v: Vec<u8>| format!("genesis_public_key length {} != 32", v.len()))?;
        let verifying_key = VerifyingKey::from_bytes(&pk_bytes)
            .map_err(|e| format!("genesis_public_key not a valid Ed25519 point: {e}"))?;
        let sig_bytes: [u8; 64] = B64
            .decode(&self.genesis_signature)
            .map_err(|e| format!("genesis_signature base64 decode: {e}"))?
            .try_into()
            .map_err(|v: Vec<u8>| format!("genesis_signature length {} != 64", v.len()))?;
        let sig = Signature::from_bytes(&sig_bytes);

        let mut a = self.clone();
        a.genesis_signature = String::new();
        let canonical = canonical_json_sorted(
            serde_json::to_value(&a).map_err(|e| format!("anchor re-serialise: {e}"))?,
        );

        verifying_key
            .verify(canonical.as_bytes(), &sig)
            .map_err(|e| format!("Ed25519 chain genesis signature verification failed: {e}"))
    }
}

/// Resolve the Ed25519 signing key (spec 047 FR-009.1, mirrors spec 102
/// FR-008.1 resolution). Same semantics as factory-engine, intentionally
/// duplicated to keep policy-kernel free of factory-engine dependency.
pub fn resolve_signing_material() -> (SigningKey, GenesisAttestation) {
    if let Ok(b64) = std::env::var(ENV_SIGNING_KEY) {
        let seed = decode_seed(&b64)
            .unwrap_or_else(|e| panic!("{ENV_SIGNING_KEY} is set but malformed: {e}"));
        return (
            SigningKey::from_bytes(&seed),
            GenesisAttestation {
                kind: GenesisAttestationKind::Operator,
                note: Some(format!("source={ENV_SIGNING_KEY}")),
            },
        );
    }
    if let Ok(path) = std::env::var(ENV_SIGNING_KEY_PATH) {
        let contents = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("{ENV_SIGNING_KEY_PATH}={path} unreadable: {e}"));
        let seed = decode_seed(contents.trim())
            .unwrap_or_else(|e| panic!("{ENV_SIGNING_KEY_PATH}={path} content malformed: {e}"));
        return (
            SigningKey::from_bytes(&seed),
            GenesisAttestation {
                kind: GenesisAttestationKind::Operator,
                note: Some(format!("source={ENV_SIGNING_KEY_PATH}:{path}")),
            },
        );
    }
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed).expect("OS RNG unavailable");
    (
        SigningKey::from_bytes(&seed),
        GenesisAttestation {
            kind: GenesisAttestationKind::Ephemeral,
            note: Some("auto-generated for chain lifetime".into()),
        },
    )
}

fn decode_seed(s: &str) -> Result<[u8; 32], String> {
    let bytes = B64.decode(s.trim()).map_err(|e| format!("base64: {e}"))?;
    bytes
        .try_into()
        .map_err(|v: Vec<u8>| format!("seed length {} != 32", v.len()))
}

/// Append-only writer: first record's `previous_record_hash` is the bundle hash (genesis link).
pub struct ProofChainWriter {
    bundle_hash: String,
    last_link_hash: String,
}

impl ProofChainWriter {
    pub fn new(bundle_hash: String) -> Self {
        Self {
            last_link_hash: bundle_hash.clone(),
            bundle_hash,
        }
    }

    /// Build a signed `ProofChainAnchor` for this chain (FR-009.1+).
    /// The anchor is the chain-side analog of the cert signature: it
    /// gives an external verifier something to anchor trust to beyond
    /// the chain's own self-referential hashes. Signing key resolved via
    /// `resolve_signing_material()`.
    pub fn build_anchor(&self, chain_id: String, genesis_timestamp: String) -> ProofChainAnchor {
        let (key, attestation) = resolve_signing_material();
        let public_key_b64 = B64.encode(key.verifying_key().to_bytes());
        let mut anchor = ProofChainAnchor {
            chain_id,
            policy_bundle_hash: self.bundle_hash.clone(),
            genesis_timestamp,
            genesis_public_key: public_key_b64,
            genesis_signature: String::new(),
            genesis_attestation: attestation,
        };
        anchor.genesis_signature = anchor.compute_signature(&key);
        anchor
    }

    pub fn last_link_hash(&self) -> &str {
        &self.last_link_hash
    }

    pub fn append(
        &mut self,
        id: String,
        timestamp: String,
        rule_ids: Vec<String>,
        input_context_hash: String,
        decision: ProofRecordDecision,
        privilege_level: ProofPrivilege,
    ) -> ProofRecord {
        let mut record = ProofRecord {
            id,
            timestamp,
            policy_bundle_hash: self.bundle_hash.clone(),
            rule_ids,
            input_context_hash,
            decision,
            privilege_level,
            previous_record_hash: self.last_link_hash.clone(),
            record_hash: String::new(),
        };
        record.record_hash = compute_record_hash(&record);
        self.last_link_hash.clone_from(&record.record_hash);
        record
    }
}

/// FR-010 / SC-009 + spec 047 FR-009.2: verify chain integrity AND the
/// genesis anchor signature. The anchor signature is verified FIRST —
/// it is the authoritative external trust root post-amendment.
pub fn verify_proof_chain_with_anchor(
    records: &[ProofRecord],
    anchor: &ProofChainAnchor,
    expected_bundle_hash: &str,
) -> Result<(), ProofChainError> {
    // 1. Anchor signature first (FR-009.2). A chain rooted in an unsigned
    //    or forged anchor is not trustworthy regardless of how well its
    //    per-record hashes line up.
    anchor
        .verify_signature()
        .map_err(ProofChainError::AnchorSignature)?;
    // 2. Anchor must pin the bundle we expect (cross-check).
    if anchor.policy_bundle_hash != expected_bundle_hash {
        return Err(ProofChainError::AnchorBundleHashMismatch);
    }
    // 3. Existing per-record verification.
    verify_proof_chain(records, expected_bundle_hash)
}

/// FR-010 / SC-009: verify chain integrity given the expected policy bundle content hash.
///
/// This is the pre-amendment chain check (no genesis-anchor signature
/// verification). Callers wanting the FR-009.2 authoritative provenance
/// check should use `verify_proof_chain_with_anchor`.
pub fn verify_proof_chain(
    records: &[ProofRecord],
    expected_bundle_hash: &str,
) -> Result<(), ProofChainError> {
    if records.is_empty() {
        return Err(ProofChainError::EmptyChain);
    }
    for (i, rec) in records.iter().enumerate() {
        if rec.policy_bundle_hash != expected_bundle_hash {
            return Err(ProofChainError::PolicyBundleHashMismatch { index: i });
        }
        let computed = compute_record_hash(rec);
        if computed != rec.record_hash {
            return Err(ProofChainError::RecordHashMismatch { index: i });
        }
        let n = nf004_payload_bytes(rec);
        if n > NF004_MAX_BYTES_EXCLUDING_CONTEXT {
            return Err(ProofChainError::Nf004Exceeded { index: i, bytes: n });
        }
        if i == 0 {
            if rec.previous_record_hash != expected_bundle_hash {
                return Err(ProofChainError::FirstPreviousNotBundleHash);
            }
        } else if rec.previous_record_hash != records[i - 1].record_hash {
            return Err(ProofChainError::BrokenLink { index: i });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_bundle_hash() -> String {
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()
    }

    #[test]
    fn sc009_hundred_record_chain_verifies() {
        let bundle = sample_bundle_hash();
        let mut w = ProofChainWriter::new(bundle.clone());
        let mut chain = Vec::new();
        for i in 0..100 {
            let id = format!("{:08x}-0000-4000-8000-{:012x}", i, i);
            let rec = w.append(
                id,
                format!("2026-03-30T12:{:02}:00Z", i % 60),
                vec!["R-001".into()],
                format!("sha256:{:064x}", i),
                ProofRecordDecision::Allow,
                ProofPrivilege::Full,
            );
            chain.push(rec);
        }
        verify_proof_chain(&chain, &bundle).expect("chain should verify");
    }

    #[test]
    fn genesis_previous_is_bundle_hash() {
        let bundle = sample_bundle_hash();
        let mut w = ProofChainWriter::new(bundle.clone());
        let r = w.append(
            "00000000-0000-4000-8000-000000000001".into(),
            "2026-03-30T12:00:00Z".into(),
            vec!["R-1".into()],
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".into(),
            ProofRecordDecision::Deny,
            ProofPrivilege::Restricted,
        );
        assert_eq!(r.previous_record_hash, bundle);
        verify_proof_chain(&[r], &bundle).unwrap();
    }

    #[test]
    fn broken_link_fails() {
        let bundle = sample_bundle_hash();
        let mut w = ProofChainWriter::new(bundle.clone());
        let a = w.append(
            "a".into(),
            "t".into(),
            vec![],
            "sha256:00".into(),
            ProofRecordDecision::Allow,
            ProofPrivilege::Full,
        );
        let mut b = w.append(
            "b".into(),
            "t".into(),
            vec![],
            "sha256:11".into(),
            ProofRecordDecision::Allow,
            ProofPrivilege::Full,
        );
        b.previous_record_hash = "sha256:deadbeef".into();
        b.record_hash = compute_record_hash(&b);
        let err = verify_proof_chain(&[a, b], &bundle).unwrap_err();
        assert!(matches!(err, ProofChainError::BrokenLink { index: 1 }));
    }

    /// FR-009.1 / FR-009.2: a clean chain with a signed anchor verifies.
    #[test]
    fn signed_anchor_chain_verifies() {
        let bundle = sample_bundle_hash();
        let mut w = ProofChainWriter::new(bundle.clone());
        let anchor = w.build_anchor("chain-001".into(), "2026-05-11T00:00:00Z".into());
        let r = w.append(
            "00000000-0000-4000-8000-000000000001".into(),
            "2026-05-11T00:00:01Z".into(),
            vec!["R-1".into()],
            "sha256:bb".into(),
            ProofRecordDecision::Allow,
            ProofPrivilege::Full,
        );

        assert!(!anchor.genesis_public_key.is_empty(), "pub key set");
        assert!(!anchor.genesis_signature.is_empty(), "signature set");
        assert_eq!(
            anchor.genesis_attestation.kind,
            GenesisAttestationKind::Ephemeral,
            "test env has no OAP_SIGNING_KEY → ephemeral fallback"
        );
        anchor.verify_signature().expect("clean anchor verifies");

        verify_proof_chain_with_anchor(&[r], &anchor, &bundle)
            .expect("signed anchor + clean chain verifies");
    }

    /// FR-009.2: a tampered anchor (any field flipped) MUST fail signature
    /// verification — the chain-side analog of the cert-side tamper-with-
    /// resign attack closure.
    #[test]
    fn tamper_anchor_fails_signature() {
        let bundle = sample_bundle_hash();
        let w = ProofChainWriter::new(bundle.clone());
        let anchor = w.build_anchor("chain-002".into(), "2026-05-11T00:00:00Z".into());

        // Adversary edits the chain_id but cannot mint a new signature
        // without the signing key.
        let mut tampered = anchor.clone();
        tampered.chain_id = "ADVERSARY-INJECTED-CHAIN".into();

        let err = tampered.verify_signature().unwrap_err();
        assert!(
            err.contains("Ed25519 chain genesis signature verification failed"),
            "expected signature mismatch; got: {err}"
        );

        let chain_err = verify_proof_chain_with_anchor(&[], &tampered, &bundle).unwrap_err();
        assert!(matches!(chain_err, ProofChainError::AnchorSignature(_)));
    }

    /// FR-009.2 also catches the case where the anchor is internally
    /// consistent (signature valid for *its* bundle hash) but the chain
    /// it's presented with claims a different bundle hash. Anchor and
    /// chain must agree.
    #[test]
    fn anchor_bundle_hash_mismatch_fails() {
        let bundle_a = sample_bundle_hash();
        let w = ProofChainWriter::new(bundle_a.clone());
        let anchor = w.build_anchor("chain-003".into(), "2026-05-11T00:00:00Z".into());

        let bundle_b = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
        let err = verify_proof_chain_with_anchor(&[], &anchor, bundle_b).unwrap_err();
        assert_eq!(err, ProofChainError::AnchorBundleHashMismatch);
    }

    /// FR-009.3 attestation taxonomy: ephemeral fallback when no env var.
    /// `Operator` and `SigstoreRekor` kinds are exercised by integration
    /// tests in factory-engine (which sets the env var) and by P0-3b's
    /// Sigstore CI workflow respectively.
    #[test]
    fn unsigned_anchor_is_rejected() {
        let bundle = sample_bundle_hash();
        let anchor = ProofChainAnchor {
            chain_id: "chain-unsigned".into(),
            policy_bundle_hash: bundle.clone(),
            genesis_timestamp: "2026-05-11T00:00:00Z".into(),
            genesis_public_key: String::new(),
            genesis_signature: String::new(),
            genesis_attestation: GenesisAttestation {
                kind: GenesisAttestationKind::Unsigned,
                note: None,
            },
        };
        let err = anchor.verify_signature().unwrap_err();
        assert!(
            err.contains("unsigned"),
            "expected unsigned diagnostic; got: {err}"
        );
    }

    #[test]
    fn nf004_small_record_ok() {
        let bundle = sample_bundle_hash();
        let mut w = ProofChainWriter::new(bundle.clone());
        let r = w.append(
            "id".into(),
            "2026-03-30T12:00:00Z".into(),
            vec!["R-1".into()],
            "sha256:cc".into(),
            ProofRecordDecision::Allow,
            ProofPrivilege::Full,
        );
        assert!(nf004_payload_bytes(&r) <= NF004_MAX_BYTES_EXCLUDING_CONTEXT);
    }
}
