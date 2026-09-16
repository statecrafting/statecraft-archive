// SPDX-License-Identifier: Apache-2.0

//! `app-model.json`: the members the kernel reads, and integrity verification.
//!
//! The contract is enrahitu spec 020 (the app-model extraction contract); this
//! module consumes it and does not own it. Only the members the kernel
//! enforces are deserialized into typed DTOs; everything else passes through
//! the integrity hash untouched. The model hash used everywhere in this crate
//! is the verified `integrity.hash`: sha256 over the canonical bytes of the
//! document with the `integrity` member removed (020 section 3.5).

use serde::Deserialize;
use serde_json::Value;
use trust_window::{Direction, Level};

/// The one integrity algorithm the v0.1 kernel understands.
pub const INTEGRITY_ALGORITHM: &str = "sha256-canonical-keysort-v1";
/// The contract this kernel consumes.
pub const CONTRACT_NAME: &str = "app-model";

#[derive(Debug, Clone, Deserialize)]
pub struct Contract {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AppIdentity {
    pub name: String,
    pub org: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Integrity {
    pub algorithm: String,
    pub hash: String,
}

/// One entry of the grant catalog (`capabilities[]`).
#[derive(Debug, Clone, Deserialize)]
pub struct CapabilityDecl {
    pub id: String,
    pub kind: String,
    /// The granted resource name, or `"*"` where the kind has no named
    /// resource.
    pub resource: String,
    #[serde(default)]
    pub constraints: Option<Constraints>,
}

/// Kind-specific narrowing of a grant. `deny_unknown_fields` is the fail-closed
/// rule of spec 004 section 3.3: a constraint key the kernel cannot enforce is
/// a boot refusal, because a declared constraint silently skipped would be a
/// hole in the ceiling.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Constraints {
    #[serde(default)]
    pub tables: Option<Vec<String>>,
    #[serde(default)]
    pub key_prefix: Option<String>,
    #[serde(default)]
    pub domains: Option<Vec<String>>,
    #[serde(default)]
    pub topics: Option<Vec<String>>,
    #[serde(default)]
    pub tools: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServiceDecl {
    pub name: String,
    /// `"ts"` | `"rust"`. Enforcement semantics derive from it upstream; the
    /// v0.1 kernel adjudicates both identically.
    #[allow(dead_code)]
    pub tier: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentTrustDecl {
    pub initial: Level,
    #[allow(dead_code)]
    pub direction: Direction,
    #[serde(default)]
    pub ceiling: Option<Level>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentDecl {
    pub name: String,
    pub service: String,
    pub trust: AgentTrustDecl,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateDecl {
    pub checks: Vec<String>,
    /// The pinned roster hash; boot refuses when the assembled roster's
    /// `config_hash()` differs (spec 004 section 3.3, refusal 8).
    pub config_hash: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustDecl {
    /// Opaque pass-through per the schema; must deserialize as trust-window's
    /// `WindowConfig` when present.
    #[serde(default)]
    pub window_config: Option<Value>,
}

/// The members of `app-model.json` the kernel reads. Unknown members are
/// ignored here (they are covered by the integrity hash, not by enforcement).
#[derive(Debug, Clone, Deserialize)]
pub struct AppModel {
    pub contract: Contract,
    pub app: AppIdentity,
    #[serde(default)]
    pub capabilities: Vec<CapabilityDecl>,
    #[serde(default)]
    pub services: Vec<ServiceDecl>,
    #[serde(default)]
    pub agents: Vec<AgentDecl>,
    pub trust: TrustDecl,
    pub gate: GateDecl,
    pub integrity: Integrity,
}

/// Canonical bytes per 020 section 3.5: `canonical-keysort-json`
/// `to_canonical_string` output, UTF-8, single trailing newline.
pub fn canonical_bytes(value: &Value) -> Vec<u8> {
    let mut s = canonical_keysort_json::to_canonical_string(value);
    s.push('\n');
    s.into_bytes()
}

/// The model hash: `sha256:<hex>` over the canonical bytes of `doc` with the
/// `integrity` member removed. Pure; usable by producers and verifiers alike.
pub fn compute_model_hash(doc: &Value) -> Result<String, String> {
    let mut doc = doc.clone();
    let obj = doc
        .as_object_mut()
        .ok_or_else(|| "document is not a JSON object".to_string())?;
    obj.remove("integrity");
    Ok(attest_ledger_core::sha256_hex(&canonical_bytes(&doc)))
}

/// Parse a raw document and return its recomputed model hash without full
/// verification. Used to decide whether a second `boot` carries the same model.
pub fn document_hash(model_json: &str) -> Result<String, String> {
    let doc: Value = serde_json::from_str(model_json).map_err(|e| e.to_string())?;
    compute_model_hash(&doc)
}

fn version_in_range(version: &str) -> bool {
    let mut parts = version.split('.');
    matches!((parts.next(), parts.next()), (Some("0"), Some("1")))
}

/// Parse and verify an `app-model.json`: contract identity and version range,
/// integrity algorithm and hash. Returns the typed model and its verified
/// model hash. Every failure is a refusal to start.
pub fn parse_and_verify(model_json: &str) -> Result<(AppModel, String), String> {
    let doc: Value =
        serde_json::from_str(model_json).map_err(|e| format!("model does not parse: {e}"))?;
    let model: AppModel = serde_json::from_value(doc.clone())
        .map_err(|e| format!("model is missing a member the kernel reads: {e}"))?;

    if model.contract.name != CONTRACT_NAME {
        return Err(format!(
            "contract.name is '{}', expected '{CONTRACT_NAME}'",
            model.contract.name
        ));
    }
    if !version_in_range(&model.contract.version) {
        return Err(format!(
            "contract.version {} is outside the kernel's pinned range >=0.1.0 <0.2.0",
            model.contract.version
        ));
    }
    if model.integrity.algorithm != INTEGRITY_ALGORITHM {
        return Err(format!(
            "integrity.algorithm is '{}', expected '{INTEGRITY_ALGORITHM}'",
            model.integrity.algorithm
        ));
    }
    let computed = compute_model_hash(&doc)?;
    if computed != model.integrity.hash {
        return Err(format!(
            "integrity mismatch: declared {} but recomputed {computed}",
            model.integrity.hash
        ));
    }
    Ok((model, computed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn version_range() {
        assert!(version_in_range("0.1.0"));
        assert!(version_in_range("0.1.7"));
        assert!(!version_in_range("0.2.0"));
        assert!(!version_in_range("1.0.0"));
    }

    #[test]
    fn canonical_bytes_sort_keys_and_end_in_newline() {
        let bytes = canonical_bytes(&json!({"b": 1, "a": {"z": 1, "y": 2}}));
        assert_eq!(
            String::from_utf8(bytes).unwrap(),
            "{\"a\":{\"y\":2,\"z\":1},\"b\":1}\n"
        );
    }

    #[test]
    fn model_hash_is_stable_and_ignores_integrity() {
        let without = json!({"a": 1});
        let with = json!({"a": 1, "integrity": {"algorithm": "x", "hash": "y"}});
        assert_eq!(
            compute_model_hash(&without).unwrap(),
            compute_model_hash(&with).unwrap()
        );
        assert!(compute_model_hash(&without).unwrap().starts_with("sha256:"));
    }

    #[test]
    fn unknown_constraint_key_refuses() {
        let c: Result<Constraints, _> =
            serde_json::from_value(json!({"domains": ["a.example"], "regions": ["us"]}));
        assert!(c.is_err(), "an unenforceable constraint key must refuse");
    }
}
