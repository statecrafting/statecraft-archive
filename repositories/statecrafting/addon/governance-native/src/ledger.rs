//! Append-only, tamper-evident attestation store over a `stateDir`.
//!
//! `attest-ledger` is deliberately storage-agnostic: it gives us the record
//! envelope, the hash chaining, anchor signing, and independent verification,
//! but no on-disk format. This module owns the file layout:
//!
//! - `<stateDir>/anchor.json`   the genesis [`ChainAnchor`] (unsigned until
//!   [`anchor`] signs it with an operator key)
//! - `<stateDir>/records.jsonl` one JSON [`LedgerRecord`] per line, appended
//!
//! `seq` is the 0-based line index of a record; the chain head after an append
//! is that record's `record_hash`. The whole file is the authority; the
//! service keeps only an index for queries (statecraft spec 008 §2).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use attest_ledger_types::{ChainAnchor, GenesisAttestation, GenesisAttestationKind, LedgerRecord};
use attest_ledger_core::{sha256_hex, sign_anchor, verify_chain, verify_chain_with_anchor, RecordChain};
use base64::Engine;
use serde_json::Value;

/// Fixed genesis marker; the anchor root is its SHA-256 so a fresh `stateDir`
/// starts from a stable, self-describing root rather than an ephemeral key.
const GENESIS_SEED: &str = "statecraft.governance.ledger/v1";
const CHAIN_ID: &str = "governance";

/// Result of a successful [`append`].
pub struct Appended {
    /// 0-based index of the appended record.
    pub seq: u32,
    /// hash of the appended record.
    pub record_hash: String,
    /// chain head after the append (equal to `record_hash` for the newest record).
    pub chain_hash: String,
}

/// Result of [`verify`].
pub struct Verified {
    pub ok: bool,
    /// number of records in the chain.
    pub seq: u32,
    pub error: Option<String>,
}

fn records_path(dir: &Path) -> PathBuf {
    dir.join("records.jsonl")
}

fn anchor_path(dir: &Path) -> PathBuf {
    dir.join("anchor.json")
}

fn genesis_root() -> String {
    sha256_hex(GENESIS_SEED.as_bytes())
}

fn read_records(dir: &Path) -> Result<Vec<LedgerRecord>, String> {
    let path = records_path(dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content =
        fs::read_to_string(&path).map_err(|err| format!("read {}: {err}", path.display()))?;
    let mut records = Vec::new();
    for (line_no, line) in content.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let record: LedgerRecord = serde_json::from_str(line)
            .map_err(|err| format!("record on line {line_no}: {err}"))?;
        records.push(record);
    }
    Ok(records)
}

fn read_anchor(dir: &Path) -> Result<Option<ChainAnchor>, String> {
    let path = anchor_path(dir);
    if !path.exists() {
        return Ok(None);
    }
    let content =
        fs::read_to_string(&path).map_err(|err| format!("read {}: {err}", path.display()))?;
    let anchor: ChainAnchor =
        serde_json::from_str(&content).map_err(|err| format!("anchor: {err}"))?;
    Ok(Some(anchor))
}

fn write_anchor(dir: &Path, anchor: &ChainAnchor) -> Result<(), String> {
    let path = anchor_path(dir);
    let serialized =
        serde_json::to_string_pretty(anchor).map_err(|err| format!("serialize anchor: {err}"))?;
    fs::write(&path, serialized).map_err(|err| format!("write {}: {err}", path.display()))
}

/// Load the genesis anchor, creating an unsigned one on first use.
fn ensure_anchor(dir: &Path) -> Result<ChainAnchor, String> {
    if let Some(anchor) = read_anchor(dir)? {
        return Ok(anchor);
    }
    let anchor = ChainAnchor {
        chain_id: CHAIN_ID.to_string(),
        anchor_hash: genesis_root(),
        genesis_timestamp: String::new(),
        genesis_public_key: String::new(),
        genesis_signature: String::new(),
        genesis_attestation: GenesisAttestation::default(),
    };
    write_anchor(dir, &anchor)?;
    Ok(anchor)
}

/// Append `record_json` (an attestation payload) to the chain under `dir`.
///
/// Optional top-level `id` / `timestamp` string fields in the payload become
/// the record envelope's id/timestamp; when absent, `id` defaults to the
/// zero-padded sequence and `timestamp` to the empty string.
///
/// The payload is not stored opaquely (spec 010 3.1). It is parsed into a
/// `serde_json::Value`, so the stored line holds that parse re-serialized
/// (keys sorted, whitespace and escape spellings dropped, the last duplicate
/// member kept, out-of-range integers and non-integers as `f64`), and the
/// record hash covers the parse, not the submitted bytes. Distinct inputs can
/// therefore share a record hash, and a float's spelling inside the hash
/// depends on the linked `serde_json` (3.4). [`crate::portable::append`]
/// refuses the inputs this rewrites.
pub fn append(dir: &Path, record_json: &str) -> Result<Appended, String> {
    fs::create_dir_all(dir).map_err(|err| format!("create {}: {err}", dir.display()))?;
    let anchor = ensure_anchor(dir)?;
    let records = read_records(dir)?;

    let previous = records
        .last()
        .map(|record| record.record_hash.clone())
        .unwrap_or_else(|| anchor.anchor_hash.clone());

    let payload: Value =
        serde_json::from_str(record_json).map_err(|err| format!("record payload: {err}"))?;
    let id = payload
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("{:08}", records.len()));
    let timestamp = payload
        .get("timestamp")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_default();

    // RecordChain::new(previous) seeds last_link_hash = previous, so append()
    // links this record onto the current chain head deterministically.
    let mut chain = RecordChain::new(previous);
    let record = chain.append(id, timestamp, payload);

    let line = serde_json::to_string(&record).map_err(|err| format!("serialize record: {err}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(records_path(dir))
        .map_err(|err| format!("open records: {err}"))?;
    writeln!(file, "{line}").map_err(|err| format!("append record: {err}"))?;

    Ok(Appended {
        seq: records.len() as u32,
        record_hash: record.record_hash.clone(),
        chain_hash: record.record_hash,
    })
}

/// Independently verify the whole chain under `dir`.
pub fn verify(dir: &Path) -> Result<Verified, String> {
    let records = read_records(dir)?;
    let seq = records.len() as u32;
    if records.is_empty() {
        // A fresh (or anchor-only) ledger is vacuously valid.
        return Ok(Verified { ok: true, seq: 0, error: None });
    }
    let anchor = read_anchor(dir)?;

    // IIFE so `?` returns from this closure (mapped to `Verified` below),
    // not from `verify` itself.
    let result: Result<(), String> = (|| {
        match &anchor {
            Some(anchor) if !anchor.genesis_public_key.is_empty() => {
                verify_chain_with_anchor(anchor, &records).map_err(|err| err.to_string())
            }
            Some(anchor) => {
                verify_chain(&records).map_err(|err| err.to_string())?;
                match records.first() {
                    Some(first) if first.previous_record_hash == anchor.anchor_hash => Ok(()),
                    Some(first) => Err(format!(
                        "genesis link mismatch: first record previous {} != anchor {}",
                        first.previous_record_hash, anchor.anchor_hash
                    )),
                    None => Ok(()),
                }
            }
            None => verify_chain(&records).map_err(|err| err.to_string()),
        }
    })();

    match result {
        Ok(()) => Ok(Verified { ok: true, seq, error: None }),
        Err(error) => Ok(Verified { ok: false, seq, error: Some(error) }),
    }
}

/// Sign the genesis anchor with an Ed25519 key (base64-encoded 32-byte seed,
/// supplied from an Encore secret) and persist it. Returns the anchor JSON.
pub fn anchor(dir: &Path, key_seed_b64: &str) -> Result<String, String> {
    fs::create_dir_all(dir).map_err(|err| format!("create {}: {err}", dir.display()))?;
    let mut anchor = ensure_anchor(dir)?;

    let raw = base64::engine::general_purpose::STANDARD
        .decode(key_seed_b64.trim())
        .map_err(|err| format!("key seed base64: {err}"))?;
    let seed: [u8; 32] = raw
        .as_slice()
        .try_into()
        .map_err(|_| format!("key seed must be 32 bytes, got {}", raw.len()))?;
    let key = ed25519_dalek::SigningKey::from_bytes(&seed);

    anchor.genesis_attestation = GenesisAttestation {
        kind: GenesisAttestationKind::Operator,
        note: Some("statecraft governance anchor".to_string()),
    };
    sign_anchor(&mut anchor, &key);
    write_anchor(dir, &anchor)?;

    serde_json::to_string(&anchor).map_err(|err| format!("serialize anchor: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gov-native-{name}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn record(kind: &str, subject: &str) -> String {
        format!(
            r#"{{"id":"{subject}-{kind}","kind":"{kind}","subject":"{subject}","payloadHash":"deadbeef","actor":"agent:test"}}"#
        )
    }

    #[test]
    fn append_grows_the_chain_and_verifies() {
        let dir = scratch("append-verify");
        let a = append(&dir, &record("stamp", "app-1")).unwrap();
        assert_eq!(a.seq, 0);
        assert!(a.record_hash.starts_with("sha256:"));
        assert_eq!(a.record_hash, a.chain_hash);

        let b = append(&dir, &record("deploy", "app-1")).unwrap();
        assert_eq!(b.seq, 1);
        assert_ne!(a.record_hash, b.record_hash);

        append(&dir, &record("backup", "app-1")).unwrap();

        let v = verify(&dir).unwrap();
        assert!(v.ok, "unexpected: {:?}", v.error);
        assert_eq!(v.seq, 3);
    }

    #[test]
    fn verify_detects_a_tampered_byte() {
        let dir = scratch("tamper");
        append(&dir, &record("stamp", "app-2")).unwrap();
        append(&dir, &record("deploy", "app-2")).unwrap();
        assert!(verify(&dir).unwrap().ok);

        // Flip one byte inside a stored payload; the record hash no longer
        // recomputes, so the chain must fail verification.
        let path = records_path(&dir);
        let content = fs::read_to_string(&path).unwrap();
        let tampered = content.replacen("deadbeef", "deadbeee", 1);
        assert_ne!(content, tampered);
        fs::write(&path, tampered).unwrap();

        let v = verify(&dir).unwrap();
        assert!(!v.ok);
        assert!(v.error.is_some());
    }

    #[test]
    fn empty_ledger_is_vacuously_valid() {
        let dir = scratch("empty");
        let v = verify(&dir).unwrap();
        assert!(v.ok);
        assert_eq!(v.seq, 0);
    }

    #[test]
    fn anchor_signs_and_the_signed_chain_still_verifies() {
        let dir = scratch("anchor");
        append(&dir, &record("stamp", "app-3")).unwrap();
        // 32-byte seed, base64. All-ones is a valid Ed25519 seed.
        let seed = base64::engine::general_purpose::STANDARD.encode([1u8; 32]);
        let anchor_json = anchor(&dir, &seed).unwrap();
        assert!(anchor_json.contains("genesis_signature"));

        let v = verify(&dir).unwrap();
        assert!(v.ok, "signed chain must verify: {:?}", v.error);
    }
}
