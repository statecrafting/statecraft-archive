//! Standalone verifier (FR-010): `verify_proof_chain <policy_bundle_hash> <chain.json>`

use open_agentic_policy_kernel::{ProofRecord, verify_proof_chain};
use std::fs;
use std::process;

fn main() {
    let mut args = std::env::args().skip(1);
    let bundle_hash = match args.next() {
        Some(s) => s,
        None => {
            eprintln!("usage: verify_proof_chain <policy_bundle_hash> <chain.json>");
            process::exit(2);
        }
    };
    let path = match args.next() {
        Some(s) => s,
        None => {
            eprintln!("usage: verify_proof_chain <policy_bundle_hash> <chain.json>");
            process::exit(2);
        }
    };
    let json = fs::read_to_string(&path).unwrap_or_else(|e| {
        eprintln!("verify_proof_chain: read {path}: {e}");
        process::exit(1);
    });
    let records: Vec<ProofRecord> = serde_json::from_str(&json).unwrap_or_else(|e| {
        eprintln!("verify_proof_chain: json: {e}");
        process::exit(1);
    });
    if let Err(e) = verify_proof_chain(&records, &bundle_hash) {
        eprintln!("verify_proof_chain: {e}");
        process::exit(1);
    }
    println!("ok");
}
