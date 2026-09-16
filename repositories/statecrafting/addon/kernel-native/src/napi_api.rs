// SPDX-License-Identifier: Apache-2.0

//! The napi-rs addon surface: thin `#[napi]` delegators to [`crate::wire`].
//!
//! All logic lives in `wire`; this layer only maps the `String` error onto
//! `napi::Error`, so the addon has no untested behaviour of its own. Present
//! only under the `napi` feature.

use napi_derive::napi;

use crate::wire;

fn map(r: Result<String, String>) -> napi::Result<String> {
    r.map_err(napi::Error::from_reason)
}

/// See [`wire::boot`].
#[napi]
pub fn boot(model_json: String) -> napi::Result<String> {
    map(wire::boot(&model_json))
}

/// See [`wire::adjudicate`].
#[napi]
pub fn adjudicate(request_json: String) -> napi::Result<String> {
    map(wire::adjudicate(&request_json))
}

/// See [`wire::genesis_payload`].
#[napi]
pub fn genesis_payload(model_json: String) -> napi::Result<String> {
    map(wire::genesis_payload(&model_json))
}

/// See [`wire::gate_config_hash`].
#[napi]
pub fn gate_config_hash(checks_json: String) -> napi::Result<String> {
    map(wire::gate_config_hash(&checks_json))
}

/// See [`wire::build_record`].
#[napi]
pub fn build_record(
    prev_hash: String,
    id: String,
    timestamp: String,
    effect_decision_json: String,
) -> napi::Result<String> {
    map(wire::build_record(
        &prev_hash,
        &id,
        &timestamp,
        &effect_decision_json,
    ))
}

/// See [`wire::verify_chain`].
#[napi]
pub fn verify_chain(records_json: String) -> napi::Result<String> {
    map(wire::verify_chain(&records_json))
}

/// See [`wire::score`].
#[napi]
pub fn score(
    config_json: String,
    snapshot_json: Option<String>,
    samples_json: String,
) -> napi::Result<String> {
    map(wire::score(
        &config_json,
        snapshot_json.as_deref(),
        &samples_json,
    ))
}

/// See [`wire::default_window_config`].
#[napi]
pub fn default_window_config() -> napi::Result<String> {
    map(wire::default_window_config())
}
