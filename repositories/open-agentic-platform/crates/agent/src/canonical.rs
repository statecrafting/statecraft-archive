// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: AGENT_AUTOMATION
// Spec: spec/agent/automation.md

use anyhow::Result;
use serde::Serialize;
use sha2::{Digest, Sha256};

/// Produces a canonical JSON byte vector.
///
/// This implementation guarantees:
/// 1. Keys in objects are sorted (via `serde_json::Value` defaulting to BTreeMap).
/// 2. Compact formatting (no extra whitespace).
///
/// Ensure the JSON value is sorted by key recursively.
/// This is necessary because `serde_json` defaults to `BTreeMap` (sorted) normally,
/// BUT if the `preserve_order` feature is enabled (which `xray` does, affecting the whole workspace),
/// it uses `IndexMap` (insertion order). We must strictly enforce sorting for canonical hashes.
fn sort_json_value(v: &mut serde_json::Value) {
    match v {
        serde_json::Value::Array(arr) => {
            for element in arr {
                sort_json_value(element);
            }
        }
        serde_json::Value::Object(map) => {
            // 1. Sort children first
            for val in map.values_mut() {
                sort_json_value(val);
            }

            // 2. Sort keys of this map
            // We can't access `sort_keys` directly on the wrapper, so we rebuild it.
            // If backed by BTreeMap, this is a no-op (logical).
            // If backed by IndexMap, we extract, sort, and re-insert.
            // Note: avoiding `clone()` would be better but `serde_json::Map` ownership is tricky.
            // Efficient approach: working with existing map.
            let mut entries: Vec<(String, serde_json::Value)> =
                std::mem::take(map).into_iter().collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            *map = entries.into_iter().collect();
        }
        _ => {}
    }
}

/// This is the SINGLE SOURCE OF TRUTH for canonical JSON in the system.
pub fn to_canonical_json<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    // Convert to Value first
    let mut value: serde_json::Value = serde_json::to_value(value)?;

    // STRICTLY enforce sorting to be robust against `preserve_order` feature
    sort_json_value(&mut value);

    let bytes = serde_json::to_vec(&value)?;
    Ok(bytes)
}

/// Calculates the SHA256 hash of the canonical JSON representation of the value.
pub fn json_sha256<T: Serialize>(value: &T) -> Result<String> {
    let bytes = to_canonical_json(value)?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(hex::encode(hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    // use std::collections::HashMap;

    #[derive(Serialize, Deserialize)]
    struct MyStruct {
        b: String,
        a: String,
    }

    #[test]
    fn test_canonical_sorting() {
        let s = MyStruct {
            b: "bar".to_string(),
            a: "foo".to_string(),
        };
        let bytes = to_canonical_json(&s).unwrap();
        let json_str = String::from_utf8(bytes).unwrap();
        // Keys should be sorted: a then b
        assert_eq!(json_str, r#"{"a":"foo","b":"bar"}"#);
    }
}
