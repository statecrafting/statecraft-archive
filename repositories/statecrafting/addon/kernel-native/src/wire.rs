// SPDX-License-Identifier: Apache-2.0

//! The JSON-in / JSON-out boundary the consuming Encore.ts app drives.
//!
//! Every function here is napi-free `&str -> Result<String, String>`, so the
//! whole boundary compiles and tests under a plain `cargo test`. The `#[napi]`
//! layer (`src/napi_api.rs`, behind the `napi` feature) is a thin delegator
//! that only maps the `String` error onto `napi::Error`.
//!
//! Serialization contract: kernel-owned DTOs (the boot receipt, the
//! adjudication result, `EffectDecision`, the genesis payload) are camelCase,
//! matching the app-model vocabulary. Family-crate types (`WindowConfig`,
//! `Sample`, `WindowSnapshot`, `LedgerRecord`) cross the boundary in their
//! native serde shapes, so donor chains and snapshots stay verifiable and
//! recomputable byte-for-byte.
//!
//! `boot` and `adjudicate` operate on the process-global booted kernel (the
//! one honest piece of state, spec 004 section 3.2); everything else is a
//! pure function of its arguments.

use action_gate_core::{Decision, Outcome};
use serde::Serialize;
use trust_window::{Sample, WindowConfig, WindowSnapshot};

use crate::adjudicate::EffectRequest;
use crate::kernel;
use crate::ladder;
use crate::payload::{self, EffectDecision};

/// A serializable view of a gate [`Decision`].
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DecisionDto {
    /// `"allow"` | `"deny"` | `"degrade"`.
    outcome: String,
    reason: String,
    check_ids: Vec<String>,
    blocking: bool,
}

impl DecisionDto {
    fn from_decision(d: &Decision) -> Self {
        let outcome = match d.outcome {
            Outcome::Allow => "allow",
            Outcome::Deny => "deny",
            Outcome::Degrade => "degrade",
        };
        Self {
            outcome: outcome.to_string(),
            reason: d.reason.clone(),
            check_ids: d.check_ids.clone(),
            blocking: d.blocking,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdjudicationDto {
    decision: DecisionDto,
    config_hash: String,
    model_hash: String,
}

#[derive(Serialize)]
struct VerifyDto {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn e<E: std::fmt::Display>(ctx: &str, err: E) -> String {
    format!("kernel-native {ctx}: {err}")
}

/// Boot the kernel from an `app-model.json`. Verifies the contract range, the
/// integrity hash, and the pinned gate hash; compiles the enforcement tables;
/// holds them write-once. Output: the boot receipt
/// `{modelHash, gateConfigHash, contractVersion, app, services, agents,
/// capabilities}`. Any verification failure is an error: a refusal to start.
pub fn boot(model_json: &str) -> Result<String, String> {
    let receipt = kernel::boot(model_json).map_err(|err| e("boot", err))?;
    serde_json::to_string(&receipt).map_err(|err| e("receipt", err))
}

/// Adjudicate one effect against the booted tables. Input: an `EffectRequest`
/// JSON. Output:
/// `{"decision": {outcome, reason, checkIds, blocking}, "configHash": "...",
/// "modelHash": "..."}`.
pub fn adjudicate(request_json: &str) -> Result<String, String> {
    let booted = kernel::booted().map_err(|err| e("adjudicate", err))?;
    let req: EffectRequest = serde_json::from_str(request_json).map_err(|err| e("request", err))?;
    let result = booted.adjudicate(&req);
    let dto = AdjudicationDto {
        decision: DecisionDto::from_decision(&result.decision),
        config_hash: result.gate_config_hash,
        model_hash: result.model_hash,
    };
    serde_json::to_string(&dto).map_err(|err| e("result", err))
}

/// Derive the deploy-time genesis payload
/// `{modelHash, gateConfigHash, contractVersion}` from a verified model.
/// Refuses (like boot) when the model does not verify. Needs no booted kernel:
/// the deploy runs it before the app starts.
pub fn genesis_payload(model_json: &str) -> Result<String, String> {
    let payload = payload::genesis_payload(model_json).map_err(|err| e("genesis", err))?;
    serde_json::to_string(&payload).map_err(|err| e("genesis payload", err))
}

/// The `config_hash()` the roster in `checks_json` (a JSON array of check ids)
/// assembles to. Producers use it to pin `gate.configHash` at extraction time.
/// Output: the bare `sha256:<hex>` string.
pub fn gate_config_hash(checks_json: &str) -> Result<String, String> {
    let checks: Vec<String> = serde_json::from_str(checks_json).map_err(|err| e("checks", err))?;
    crate::gate::roster_config_hash(&checks).map_err(|err| e("gate", err))
}

/// Build one hash-linked ledger record for an `EffectDecision`, linking to
/// `prev_hash` (the chain's anchor hash for the first record). Output: a
/// `LedgerRecord` JSON. `timestamp` is caller-supplied (no wall clock).
pub fn build_record(
    prev_hash: &str,
    id: &str,
    timestamp: &str,
    effect_decision_json: &str,
) -> Result<String, String> {
    let decision: EffectDecision =
        serde_json::from_str(effect_decision_json).map_err(|err| e("effect_decision", err))?;
    let record = payload::build_record(prev_hash, id.to_string(), timestamp.to_string(), &decision);
    serde_json::to_string(&record).map_err(|err| e("record", err))
}

/// Verify a full Decision chain (integrity only). Input: a JSON array of
/// `LedgerRecord`. Output: `{ "ok": bool, "error"?: String }`. Equivalent to
/// the stock `attest-ledger verify` CLI over the same records.
pub fn verify_chain(records_json: &str) -> Result<String, String> {
    let records: Vec<attest_ledger_core::LedgerRecord> =
        serde_json::from_str(records_json).map_err(|err| e("records", err))?;
    let res = payload::verify_effect_chain(&records);
    let dto = VerifyDto {
        ok: res.is_ok(),
        error: res.err().map(|x| x.to_string()),
    };
    serde_json::to_string(&dto).map_err(|err| e("verify", err))
}

/// Score new samples against a trust window. Inputs: a `WindowConfig` JSON, an
/// optional `WindowSnapshot` JSON (omit for a fresh window), and a JSON array
/// of `Sample`. Output: `{ score, level, snapshot }`.
pub fn score(
    config_json: &str,
    snapshot_json: Option<&str>,
    samples_json: &str,
) -> Result<String, String> {
    let config: WindowConfig = serde_json::from_str(config_json).map_err(|err| e("config", err))?;
    let snapshot: Option<WindowSnapshot> = match snapshot_json {
        Some(s) => Some(serde_json::from_str(s).map_err(|err| e("snapshot", err))?),
        None => None,
    };
    let samples: Vec<Sample> =
        serde_json::from_str(samples_json).map_err(|err| e("samples", err))?;
    let result = ladder::score(config, snapshot, &samples);
    serde_json::to_string(&result).map_err(|err| e("score", err))
}

/// trust-window's default `WindowConfig` as JSON, for consumers persisting a
/// reproducible config alongside fresh ladder state.
pub fn default_window_config() -> Result<String, String> {
    serde_json::to_string(&WindowConfig::default()).map_err(|err| e("window_config", err))
}
