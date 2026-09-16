//! The decision record (spec 020 B-1) and its content hash (D-2 there),
//! ported by spec 113 B-3. Sealing a drop-box into the chain is the
//! engine's writer path and moves with the engine; what a decision *is*,
//! and which bytes its dedup key is taken over, lives here.

use std::collections::BTreeSet;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::canonical::hash_value;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DecisionRecord {
    pub id: String,
    pub spec_id: String,
    pub scope: Vec<String>,
    pub title: String,
    pub decision: String,
    pub rationale: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alternatives: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supersedes: Option<String>,
}

pub const CHAIN_KIND: &str = "decision.sealed";
pub const OUTCOME_KIND: &str = "decision.sealed.outcome";
pub const QUARANTINE_DIRNAME: &str = "invalid";

const REQUIRED_FIELDS: [&str; 6] = ["id", "specId", "scope", "title", "decision", "rationale"];
const ALLOWED_FIELDS: [&str; 8] = [
    "id",
    "specId",
    "scope",
    "title",
    "decision",
    "rationale",
    "alternatives",
    "supersedes",
];

/// The canonical, chain-storable shape: exactly B-1's fields, optional
/// fields omitted rather than null.
pub fn decision_payload(record: &DecisionRecord) -> Value {
    let mut payload = json!({
        "id": record.id,
        "specId": record.spec_id,
        "scope": record.scope,
        "title": record.title,
        "decision": record.decision,
        "rationale": record.rationale,
    });
    if let Some(alts) = &record.alternatives {
        payload["alternatives"] = json!(alts);
    }
    if let Some(s) = &record.supersedes {
        payload["supersedes"] = json!(s);
    }
    payload
}

/// The dedup key: sha256 over the canonical JSON of the record's own fields.
pub fn content_hash(record: &DecisionRecord) -> String {
    hash_value(&decision_payload(record)).expect("a validated record is portable")
}

fn non_portable_number_path(value: &Value, path: &str) -> Option<String> {
    match value {
        Value::Number(n) => {
            if n.is_i64() || n.is_u64() {
                None
            } else {
                Some(if path.is_empty() {
                    "<root>".to_string()
                } else {
                    path.to_string()
                })
            }
        }
        Value::Array(items) => items
            .iter()
            .enumerate()
            .find_map(|(i, v)| non_portable_number_path(v, &format!("{path}[{i}]"))),
        Value::Object(map) => map.iter().find_map(|(k, v)| {
            let p = if path.is_empty() {
                k.clone()
            } else {
                format!("{path}.{k}")
            };
            non_portable_number_path(v, &p)
        }),
        _ => None,
    }
}

fn is_plausible_repo_path_prefix(entry: &str) -> bool {
    if entry.is_empty() || entry.starts_with('/') || entry.contains("..") {
        return false;
    }
    let re = Regex::new(r"^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*/?$").unwrap();
    re.is_match(entry)
}

fn string_array(v: &Value) -> Option<Vec<String>> {
    let items = v.as_array()?;
    items.iter().map(|x| x.as_str().map(String::from)).collect()
}

/// `validateDecisionRecord`: B-1's shape and FR-001's rejection classes,
/// with 020's messages.
pub fn validate(raw: &Value, known_spec_ids: &BTreeSet<String>) -> Result<DecisionRecord, String> {
    let obj: &Map<String, Value> = match raw {
        Value::Object(m) => m,
        _ => return Err("payload is not a JSON object".to_string()),
    };
    if let Some(path) = non_portable_number_path(raw, "") {
        return Err(format!(
            "field \"{path}\" is a non-integer number (floats are not portable)"
        ));
    }
    for key in obj.keys() {
        if !ALLOWED_FIELDS.contains(&key.as_str()) {
            return Err(format!("unknown field \"{key}\""));
        }
    }
    for field in REQUIRED_FIELDS {
        if !obj.contains_key(field) {
            return Err(format!("missing field \"{field}\""));
        }
    }
    let id = match obj["id"].as_str() {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return Err("field \"id\" must be a non-empty string".to_string()),
    };
    let spec_id = match obj["specId"].as_str() {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return Err("field \"specId\" must be a non-empty string".to_string()),
    };
    let scope = string_array(&obj["scope"])
        .ok_or_else(|| "field \"scope\" must be an array of strings".to_string())?;
    let title = obj["title"]
        .as_str()
        .ok_or_else(|| "field \"title\" must be a string".to_string())?
        .to_string();
    let decision = obj["decision"]
        .as_str()
        .ok_or_else(|| "field \"decision\" must be a string".to_string())?
        .to_string();
    let rationale = obj["rationale"]
        .as_str()
        .ok_or_else(|| "field \"rationale\" must be a string".to_string())?
        .to_string();
    // D-7: an explicit null on an optional field reads as absent.
    let alternatives = match obj.get("alternatives") {
        None | Some(Value::Null) => None,
        Some(v) => Some(
            string_array(v)
                .ok_or_else(|| "field \"alternatives\" must be an array of strings".to_string())?,
        ),
    };
    let supersedes = match obj.get("supersedes") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        Some(_) => return Err("field \"supersedes\" must be a non-empty string".to_string()),
    };
    for entry in &scope {
        if !known_spec_ids.contains(entry) && !is_plausible_repo_path_prefix(entry) {
            return Err(format!(
                "scope entry \"{entry}\" is neither a known spec id nor a plausible repo path prefix"
            ));
        }
    }
    Ok(DecisionRecord {
        id,
        spec_id,
        scope,
        title,
        decision,
        rationale,
        alternatives,
        supersedes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known() -> BTreeSet<String> {
        ["012-spec-dag-readiness".to_string()].into_iter().collect()
    }

    #[test]
    fn validates_and_hashes_like_020() {
        let raw = json!({
            "id": "d1", "specId": "012-spec-dag-readiness", "scope": ["012-spec-dag-readiness", "src/dag.ts"],
            "title": "t", "decision": "d", "rationale": "r", "alternatives": null
        });
        let record = validate(&raw, &known()).unwrap();
        assert!(record.alternatives.is_none());
        let payload = decision_payload(&record);
        assert!(payload.get("alternatives").is_none());
        assert_eq!(content_hash(&record).len(), 64);
        assert_eq!(
            validate(&json!({"id": "x", "bogus": 1}), &known()).unwrap_err(),
            "unknown field \"bogus\""
        );
        assert_eq!(
            validate(&json!({"id": "x"}), &known()).unwrap_err(),
            "missing field \"specId\""
        );
        assert_eq!(
            validate(&json!({"id": "x", "n": 1.5}), &known()).unwrap_err(),
            "field \"n\" is a non-integer number (floats are not portable)"
        );
        let bad_scope = json!({"id": "d", "specId": "s", "scope": ["/abs"], "title": "t", "decision": "d", "rationale": "r"});
        assert!(validate(&bad_scope, &known())
            .unwrap_err()
            .contains("neither a known spec id"));
    }
}
