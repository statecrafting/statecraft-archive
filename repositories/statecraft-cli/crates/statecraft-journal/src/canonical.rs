//! One canonical form (spec 113 B-2): `canonical-keysort-json`'s bytes over
//! the portability set. A value outside the set is refused before it is
//! hashed or written, on both sides of the seam.

use serde_json::Value;
use sha2::{Digest, Sha256};

/// The largest integer every runtime in the family represents exactly.
pub const MAX_SAFE_INTEGER: i128 = 9_007_199_254_740_991;

/// Why a value is not portable.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NotPortable(pub String);

impl std::fmt::Display for NotPortable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "canonicalize: {}", self.0)
    }
}

impl std::error::Error for NotPortable {}

/// Check a value against the portability set: null, booleans, strings,
/// integers within `±2^53`, arrays and objects of the same.
pub fn check_portable(value: &Value) -> Result<(), NotPortable> {
    match value {
        Value::Null | Value::Bool(_) | Value::String(_) => Ok(()),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                if (i as i128).abs() > MAX_SAFE_INTEGER {
                    return Err(NotPortable(format!(
                        "integer {i} is outside the safe range (integers within 2^53 only)"
                    )));
                }
                Ok(())
            } else if let Some(u) = n.as_u64() {
                if (u as i128) > MAX_SAFE_INTEGER {
                    return Err(NotPortable(format!(
                        "integer {u} is outside the safe range (integers within 2^53 only)"
                    )));
                }
                Ok(())
            } else {
                Err(NotPortable(format!(
                    "non-integer number {n} is not portable (integers only)"
                )))
            }
        }
        Value::Array(items) => items.iter().try_for_each(check_portable),
        Value::Object(map) => map.values().try_for_each(check_portable),
    }
}

/// The canonical bytes of a portable value: keys sorted by UTF-8 byte order
/// at every depth, no whitespace.
pub fn canonical_string(value: &Value) -> Result<String, NotPortable> {
    check_portable(value)?;
    Ok(canonical_keysort_json::to_canonical_string(value))
}

pub fn sha256_hex(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    let digest = hasher.finalize();
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// `sha256(canonical(value))`.
pub fn hash_value(value: &Value) -> Result<String, NotPortable> {
    Ok(sha256_hex(&canonical_string(value)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keys_sort_by_byte_order_including_integer_like_keys() {
        // FR-002: JavaScript enumerates "10" before "9" and both before "a";
        // the canonical form sorts them as strings.
        let v = json!({"a": 1, "9": 2, "10": 3});
        assert_eq!(canonical_string(&v).unwrap(), r#"{"10":3,"9":2,"a":1}"#);
    }

    #[test]
    fn the_portability_set_is_closed() {
        assert!(canonical_string(&json!(1.5)).is_err());
        assert!(canonical_string(&json!(9007199254740992i64)).is_err());
        assert!(canonical_string(&json!(-9007199254740992i64)).is_err());
        assert!(canonical_string(&json!(9007199254740991i64)).is_ok());
        assert!(canonical_string(&json!({"a": [1, "x", null, true, {"b": 2}]})).is_ok());
    }

    #[test]
    fn sha256_matches_a_known_vector() {
        assert_eq!(
            sha256_hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
