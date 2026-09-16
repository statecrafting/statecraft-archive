// SPDX-License-Identifier: Apache-2.0

//! The `decision/v1` ledger payload and record construction over attest-ledger.
//!
//! The ledger core treats the payload as an opaque, key-sorted JSON value;
//! this typed wrapper is the kernel's view of it. Binding both the model hash
//! and the gate's config hash makes each recorded Decision provable against
//! the exact ceiling and roster that produced it. Grants append exactly like
//! denials: a human override carries its `approver`.

use attest_ledger_core::{LedgerRecord, RecordChain, VerifyError, verify_chain};
use serde::{Deserialize, Serialize};

use crate::adjudicate::CapabilityRef;
use crate::model;

/// The `decision/v1` payload carried inside a generic attest-ledger
/// [`LedgerRecord`]. Assembled by the consumer from an adjudication result
/// plus its own context hash.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectDecision {
    /// The booted model's verified `integrity.hash`.
    pub model_hash: String,
    /// The roster gate's `config_hash()`.
    pub gate_config_hash: String,
    pub service: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    pub capability: CapabilityRef,
    /// Hash of the exact context bundle the effect was proposed from.
    pub context_hash: String,
    /// `"allow"` | `"deny"` | `"degrade"`.
    pub outcome: String,
    pub reason: String,
    pub check_ids: Vec<String>,
    /// The approving principal (a rauthy subject) on a human-granted override.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approver: Option<String>,
}

/// The deploy-time genesis payload (020 section 3.6). The genesis instance
/// lives only in the ledger, never in the model: no circularity.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenesisPayload {
    pub model_hash: String,
    pub gate_config_hash: String,
    pub contract_version: String,
}

/// Derive the genesis payload from a verified model. Refuses (like boot) when
/// the model does not verify.
pub fn genesis_payload(model_json: &str) -> Result<GenesisPayload, String> {
    let (parsed, model_hash) = model::parse_and_verify(model_json)?;
    Ok(GenesisPayload {
        model_hash,
        gate_config_hash: parsed.gate.config_hash,
        contract_version: parsed.contract.version,
    })
}

/// Build a single hash-linked ledger record for an `EffectDecision`, linking
/// to `prev_hash`.
///
/// Stateless by design: the chain state (the previous record hash) is owned by
/// the consumer's store, not by this crate. `timestamp` is caller-supplied (no
/// wall clock), so the record hash is reproducible: same inputs, same hash, on
/// every platform. For the very first record of a chain, pass the anchor hash
/// as `prev_hash`.
pub fn build_record(
    prev_hash: &str,
    id: String,
    timestamp: String,
    decision: &EffectDecision,
) -> LedgerRecord {
    let payload = serde_json::to_value(decision).expect("EffectDecision serializes to JSON");
    let mut chain = RecordChain::new(prev_hash.to_string());
    chain.append(id, timestamp, payload)
}

/// Verify a full Decision chain (integrity only): re-hash every record and
/// check the links. Exactly what the stock `attest-ledger verify` CLI does, so
/// an exported chain verifies with no bespoke code.
pub fn verify_effect_chain(records: &[LedgerRecord]) -> Result<(), VerifyError> {
    verify_chain(records)
}
