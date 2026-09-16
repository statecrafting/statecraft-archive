// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Canonical JSON: recursive lex-sort of object keys at the serialization
//! boundary.
//!
//! # Why this crate exists
//!
//! `serde_json`'s `preserve_order` feature flips `serde_json::Map`'s
//! iteration order from lexicographic (BTreeMap-style) to insertion order
//! (IndexMap-style). Under Cargo's resolver 2 the feature unifies
//! monotonically across the workspace: any crate enabling
//! `preserve_order` enables it for every dependent of that crate's
//! transitive closure that also pulls `serde_json`.
//!
//! This means a workspace where one crate needs `preserve_order` (today
//! `crates/xray`) silently flips key order for every other crate that
//! emits JSON. The fix is **explicit canonicalization at the emission
//! boundary**: callers route through [`canonicalize_value`] (or a
//! convenience wrapper) so the lex-key-order contract is upheld
//! regardless of `preserve_order`'s state elsewhere in the workspace.
//!
//! The principle: **ordering requirements are explicit at the
//! serialization boundary, never implicit via shared-dep feature flags.**

use serde_json::Value;

/// Canonicalize a [`Value`] to lexicographically-sorted object keys,
/// recursively. Arrays and scalars pass through unchanged; callers are
/// responsible for any array-ordering invariants.
///
/// This is the load-bearing helper. The recursion descends through every
/// nested object so deeply-nested keys are sorted at every level, not
/// just the top.
pub fn canonicalize_value(v: Value) -> Value {
    match v {
        Value::Object(map) => {
            let mut entries: Vec<(String, Value)> = map.into_iter().collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            let mut out = serde_json::Map::new();
            for (k, v) in entries {
                out.insert(k, canonicalize_value(v));
            }
            Value::Object(out)
        }
        Value::Array(arr) => Value::Array(arr.into_iter().map(canonicalize_value).collect()),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sorts_top_level_keys_lexicographically() {
        let input = json!({ "z": 1, "a": 2, "m": 3 });
        let canon = canonicalize_value(input);
        let serialized = serde_json::to_string(&canon).unwrap();
        assert_eq!(serialized, r#"{"a":2,"m":3,"z":1}"#);
    }

    #[test]
    fn sorts_nested_object_keys_recursively() {
        let input = json!({
            "outer": { "z": 1, "a": 2 },
            "alpha": { "y": 3, "b": 4 }
        });
        let canon = canonicalize_value(input);
        let serialized = serde_json::to_string(&canon).unwrap();
        assert_eq!(
            serialized,
            r#"{"alpha":{"b":4,"y":3},"outer":{"a":2,"z":1}}"#
        );
    }

    #[test]
    fn descends_into_arrays_of_objects() {
        let input = json!([
            { "z": 1, "a": 2 },
            { "y": 3, "b": 4 }
        ]);
        let canon = canonicalize_value(input);
        let serialized = serde_json::to_string(&canon).unwrap();
        assert_eq!(serialized, r#"[{"a":2,"z":1},{"b":4,"y":3}]"#);
    }

    #[test]
    fn passes_through_scalars_unchanged() {
        assert_eq!(canonicalize_value(json!(null)), json!(null));
        assert_eq!(canonicalize_value(json!(42)), json!(42));
        assert_eq!(canonicalize_value(json!(true)), json!(true));
        assert_eq!(canonicalize_value(json!("hello")), json!("hello"));
    }

    #[test]
    fn idempotent_on_already_canonical_input() {
        let input = json!({ "a": 1, "b": { "c": 2, "d": 3 } });
        let once = canonicalize_value(input.clone());
        let twice = canonicalize_value(once.clone());
        assert_eq!(serde_json::to_string(&once).unwrap(), serde_json::to_string(&twice).unwrap());
    }

    #[test]
    fn handles_deeply_nested_arrays_and_objects() {
        let input = json!({
            "z": [
                { "deep": { "z": 1, "a": 2 } },
                { "shallow": [3, 1, 2] }
            ],
            "a": "leaf"
        });
        let canon = canonicalize_value(input);
        let serialized = serde_json::to_string(&canon).unwrap();
        // Outer object: a before z; deep object: a before z; shallow array
        // preserves insertion order (canonicalize_value does NOT sort array
        // elements — array ordering is the caller's responsibility).
        assert_eq!(
            serialized,
            r#"{"a":"leaf","z":[{"deep":{"a":2,"z":1}},{"shallow":[3,1,2]}]}"#
        );
    }
}
