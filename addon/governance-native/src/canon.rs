//! Canonical JSON + its content hash.
//!
//! Wraps `canonical-keysort-json` (recursive lexicographic key sort at the
//! serialization boundary) and appends a SHA-256 over the canonical bytes.
//! The pair `{canonical, sha256}` is the substrate every other governance
//! primitive hashes over: a payloadHash is the `sha256` of an action payload.
//!
//! The canonical form is of the parse, not of the submitted bytes (spec 010
//! 3.1). The input becomes a `serde_json::Value` first, so whitespace and
//! escape spellings are dropped, the last of two duplicate members wins, and
//! a number with a fraction or exponent, `-0`, or an integer beyond
//! `u64`/`i64` becomes an `f64` spelled by whichever float formatter the
//! linked `serde_json` uses (3.4; the committed `Cargo.lock` pins it). A third
//! party reproduces the hash only by reproducing that key order (UTF-8 byte
//! order) and that number formatting. [`crate::portable::canonicalize`]
//! refuses the inputs where either would matter.

use serde_json::Value;
use sha2::{Digest, Sha256};

/// The canonical form of a JSON document and the hex SHA-256 of its bytes.
pub struct Canonical {
    pub canonical: String,
    /// lowercase hex, no `sha256:` prefix (the bare digest of `canonical`).
    pub sha256: String,
}

/// Parse `json`, canonicalize it (recursive key sort), and hash the result.
pub fn canonicalize(json: &str) -> Result<Canonical, String> {
    let value: Value =
        serde_json::from_str(json).map_err(|err| format!("invalid JSON: {err}"))?;
    let canonical = canonical_keysort_json::to_canonical_string(&value);
    let sha256 = hex::encode(Sha256::digest(canonical.as_bytes()));
    Ok(Canonical { canonical, sha256 })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Vectors lifted from canonical-keysort-json's own test suite: object keys
    // sort recursively; array element order is preserved.
    #[test]
    fn sorts_object_keys_recursively() {
        let out =
            canonicalize(r#"{"z":1,"a":{"n":2,"b":3},"m":[{"y":4,"x":5}]}"#).unwrap();
        assert_eq!(
            out.canonical,
            r#"{"a":{"b":3,"n":2},"m":[{"x":5,"y":4}],"z":1}"#
        );
    }

    #[test]
    fn preserves_array_order_and_descends() {
        let out = canonicalize(
            r#"{"z":[{"deep":{"z":1,"a":2}},{"shallow":[3,1,2]}],"a":"leaf"}"#,
        )
        .unwrap();
        assert_eq!(
            out.canonical,
            r#"{"a":"leaf","z":[{"deep":{"a":2,"z":1}},{"shallow":[3,1,2]}]}"#
        );
    }

    #[test]
    fn key_order_does_not_change_the_hash() {
        let a = canonicalize(r#"{"z":1,"a":{"n":2,"b":3}}"#).unwrap();
        let b = canonicalize(r#"{"a":{"b":3,"n":2},"z":1}"#).unwrap();
        assert_eq!(a.canonical, b.canonical);
        assert_eq!(a.sha256, b.sha256);
    }

    #[test]
    fn sha256_is_the_digest_of_the_canonical_bytes() {
        let out = canonicalize(r#"{"b":2,"a":1}"#).unwrap();
        assert_eq!(out.canonical, r#"{"a":1,"b":2}"#);
        // independently recomputed digest of the expected canonical string
        let expected = hex::encode(Sha256::digest(r#"{"a":1,"b":2}"#.as_bytes()));
        assert_eq!(out.sha256, expected);
        assert_eq!(out.sha256.len(), 64);
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(canonicalize("{not json").is_err());
    }
}
