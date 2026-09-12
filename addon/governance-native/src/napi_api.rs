//! napi-rs bindings. Thin wrappers over the pure modules; every function is
//! plain-JSON-in / plain-JSON-out so the Encore.ts governance service never
//! marshals native types. Compiled only under the `node` feature.
//!
//! napi-derive lower-cases snake_case to camelCase, so the JS surface reads
//! `ledgerAppend`, `gateEvaluate`, `trustSample`, `configHash`, etc.

use std::path::Path;

use napi_derive::napi;

fn to_napi(err: String) -> napi::Error {
    napi::Error::from_reason(err)
}

/// `{ canonical, sha256 }` for a JSON document.
#[napi(object)]
pub struct CanonicalResult {
    pub canonical: String,
    pub sha256: String,
}

#[napi]
pub fn canonicalize(json: String) -> napi::Result<CanonicalResult> {
    let out = crate::canon::canonicalize(&json).map_err(to_napi)?;
    Ok(CanonicalResult {
        canonical: out.canonical,
        sha256: out.sha256,
    })
}

/// A portable call's error. A refusal throws with `code` set to its reason
/// code (`duplicate-member`, `non-integer-number`, `unsafe-integer`,
/// `invalid-unicode`) and a message naming the JSON pointer; any other
/// failure throws exactly what the lenient function throws.
fn portable_to_napi(err: crate::portable::PortableError) -> napi::Error<String> {
    match err {
        crate::portable::PortableError::Refused(refusal) => {
            napi::Error::new(refusal.reason.code().to_string(), refusal.to_string())
        }
        crate::portable::PortableError::Lenient(reason) => {
            napi::Error::new(napi::Status::GenericFailure.as_ref().to_string(), reason)
        }
    }
}

/// `canonicalize` for portable input only (spec 010 A-3): the same result
/// for everything it admits.
#[napi]
pub fn canonicalize_portable(json: String) -> napi::Result<CanonicalResult, String> {
    let out = crate::portable::canonicalize(&json).map_err(portable_to_napi)?;
    Ok(CanonicalResult {
        canonical: out.canonical,
        sha256: out.sha256,
    })
}

/// `{ seq, recordHash, chainHash }` after an append.
#[napi(object)]
pub struct AppendResult {
    pub seq: u32,
    pub record_hash: String,
    pub chain_hash: String,
}

#[napi]
pub fn ledger_append(state_dir: String, record: String) -> napi::Result<AppendResult> {
    let out = crate::ledger::append(Path::new(&state_dir), &record).map_err(to_napi)?;
    Ok(AppendResult {
        seq: out.seq,
        record_hash: out.record_hash,
        chain_hash: out.chain_hash,
    })
}

/// `ledgerAppend` for portable input only (spec 010 A-3): the same record,
/// hash and chain for everything it admits; a refusal writes nothing.
#[napi]
pub fn ledger_append_portable(
    state_dir: String,
    record: String,
) -> napi::Result<AppendResult, String> {
    let out = crate::portable::append(Path::new(&state_dir), &record).map_err(portable_to_napi)?;
    Ok(AppendResult {
        seq: out.seq,
        record_hash: out.record_hash,
        chain_hash: out.chain_hash,
    })
}

/// `{ ok, seq, error? }` from an independent chain verification.
#[napi(object)]
pub struct VerifyResult {
    pub ok: bool,
    pub seq: u32,
    pub error: Option<String>,
}

#[napi]
pub fn ledger_verify(state_dir: String) -> napi::Result<VerifyResult> {
    let out = crate::ledger::verify(Path::new(&state_dir)).map_err(to_napi)?;
    Ok(VerifyResult {
        ok: out.ok,
        seq: out.seq,
        error: out.error,
    })
}

/// Sign the genesis anchor with an Ed25519 key (base64 32-byte seed) and
/// return the anchor JSON.
#[napi]
pub fn ledger_anchor(state_dir: String, key_ref: String) -> napi::Result<String> {
    crate::ledger::anchor(Path::new(&state_dir), &key_ref).map_err(to_napi)
}

/// A gate decision plus the gate's stable config hash.
#[napi(object)]
pub struct GateResult {
    pub outcome: String,
    pub reason: String,
    pub check_ids: Vec<String>,
    pub blocking: bool,
    pub config_hash: String,
}

#[napi]
pub fn gate_evaluate(
    config_json: String,
    action_context_json: String,
) -> napi::Result<GateResult> {
    let out = crate::gate::evaluate(&config_json, &action_context_json).map_err(to_napi)?;
    Ok(GateResult {
        outcome: out.outcome,
        reason: out.reason,
        check_ids: out.check_ids,
        blocking: out.blocking,
        config_hash: out.config_hash,
    })
}

#[napi]
pub fn trust_sample(
    snapshot_json: Option<String>,
    sample_json: String,
) -> napi::Result<String> {
    crate::trust::sample(snapshot_json.as_deref(), &sample_json).map_err(to_napi)
}

/// `{ level, score }` for a trust snapshot.
#[napi(object)]
pub struct TrustLevelResult {
    pub level: String,
    pub score: f64,
}

#[napi]
pub fn trust_level(snapshot_json: String) -> napi::Result<TrustLevelResult> {
    let out = crate::trust::level(&snapshot_json).map_err(to_napi)?;
    Ok(TrustLevelResult {
        level: out.level,
        score: out.score,
    })
}
