//! Golden record hashes (spec 010 A-2): the construction as the published
//! 0.1.0 binaries write it, pinned so a change of float formatter fails a
//! pull request instead of a verification years later.
//!
//! The two lines below were written by
//! `@statecrafting/governance-native-darwin-arm64@0.1.0` (`.node` sha256
//! `9fd21982...d8fc5`) and, byte for byte, by the deployed
//! `@statecrafting/governance-native-linux-x64-gnu@0.1.0` (`3177f701...de8e2`),
//! appending `{"id":"x","kind":"stamp"}` then
//! `{"id":"y","kind":"evidence","big":12345678901234567890123}` to a fresh
//! state directory. The first is the flat-string shape statecraft's live
//! chain holds; the second carries a number `serde_json` holds as a float,
//! whose spelling (`e+22` under zmij, `e22` under ryu) is inside the hash.

use std::fs;
use std::path::PathBuf;

const FLAT_RECORD: &str = r#"{"id":"x","kind":"stamp"}"#;
const FLOAT_RECORD: &str = r#"{"id":"y","kind":"evidence","big":12345678901234567890123}"#;

const FLAT_HASH: &str = "sha256:2c3427b0c57b4ad93304148378b7b99f558b3399d20db6bd3b2c3efc77a6d4e3";
const FLOAT_HASH: &str = "sha256:ebb921eca125708cf88b5c6934493f5aab06d2886252060cb8aa198274df5b7c";

const PUBLISHED_RECORDS: &str = concat!(
    r#"{"id":"x","timestamp":"","previous_record_hash":"sha256:7d7f6941ed034b8b632d451ec886a502b5cf777287b3d179519ae9c8b5b34012","record_hash":"sha256:2c3427b0c57b4ad93304148378b7b99f558b3399d20db6bd3b2c3efc77a6d4e3","payload":{"id":"x","kind":"stamp"}}"#,
    "\n",
    r#"{"id":"y","timestamp":"","previous_record_hash":"sha256:2c3427b0c57b4ad93304148378b7b99f558b3399d20db6bd3b2c3efc77a6d4e3","record_hash":"sha256:ebb921eca125708cf88b5c6934493f5aab06d2886252060cb8aa198274df5b7c","payload":{"big":1.2345678901234568e+22,"id":"y","kind":"evidence"}}"#,
    "\n",
);

const PUBLISHED_ANCHOR: &str = r#"{
  "chain_id": "governance",
  "anchor_hash": "sha256:7d7f6941ed034b8b632d451ec886a502b5cf777287b3d179519ae9c8b5b34012",
  "genesis_timestamp": "",
  "genesis_public_key": "",
  "genesis_signature": "",
  "genesis_attestation": {
    "kind": "unsigned"
  }
}"#;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("gov-native-golden-{name}"));
    let _ = fs::remove_dir_all(&dir);
    dir
}

#[test]
fn a_chain_the_published_binaries_wrote_verifies() {
    let dir = scratch("published");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("anchor.json"), PUBLISHED_ANCHOR).unwrap();
    fs::write(dir.join("records.jsonl"), PUBLISHED_RECORDS).unwrap();

    let verified = crate::ledger::verify(&dir).unwrap();
    assert!(verified.ok, "a 0.1.0 chain must verify: {:?}", verified.error);
    assert_eq!(verified.seq, 2);
}

#[test]
fn appends_reproduce_the_published_record_hashes_and_bytes() {
    let dir = scratch("reproduce");
    let flat = crate::ledger::append(&dir, FLAT_RECORD).unwrap();
    let float = crate::ledger::append(&dir, FLOAT_RECORD).unwrap();

    assert_eq!(flat.record_hash, FLAT_HASH);
    assert_eq!(float.record_hash, FLOAT_HASH);
    assert_eq!(fs::read_to_string(dir.join("records.jsonl")).unwrap(), PUBLISHED_RECORDS);
    assert_eq!(fs::read_to_string(dir.join("anchor.json")).unwrap(), PUBLISHED_ANCHOR);
}
