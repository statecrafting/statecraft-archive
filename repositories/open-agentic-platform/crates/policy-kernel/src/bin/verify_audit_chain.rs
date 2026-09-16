//! Spec 207 FR-003: independent audit-chain verifier.
//!
//! `verify_audit_chain <segment.jsonl> [expected_genesis_hash]`
//!
//! Walks a hash-chained audit segment (one JSON record per line, as written
//! by [`open_agentic_policy_kernel::AuditLogger`]) and exits non-zero naming
//! the first broken record. Shares no state with the producer and runs
//! offline. When `expected_genesis_hash` is supplied, the first record's
//! `previous_record_hash` must bind it (cross-segment continuity, AC-5);
//! pass the closed predecessor segment's head `record_hash` to chain checks
//! across a rotation boundary.

use open_agentic_policy_kernel::audit::verify_audit_chain;
use serde_json::Value;
use std::fs;
use std::process;

/// Defensive read cap: production segments rotate at 10 MB, so a generous
/// 128 MB ceiling refuses a crafted oversized path (or a symlink to an
/// endless source) before the unbounded read can exhaust memory.
const MAX_INPUT_BYTES: u64 = 128 * 1024 * 1024;

fn main() {
    let mut args = std::env::args().skip(1);
    let path = match args.next() {
        Some(s) => s,
        None => {
            eprintln!("usage: verify_audit_chain <segment.jsonl> [expected_genesis_hash]");
            process::exit(2);
        }
    };
    let expected_genesis = args.next();

    if let Ok(meta) = fs::metadata(&path) {
        if meta.len() > MAX_INPUT_BYTES {
            eprintln!(
                "verify_audit_chain: {path}: {} bytes exceeds {MAX_INPUT_BYTES}-byte cap",
                meta.len()
            );
            process::exit(1);
        }
    }

    let content = fs::read_to_string(&path).unwrap_or_else(|e| {
        eprintln!("verify_audit_chain: read {path}: {e}");
        process::exit(1);
    });

    let mut records: Vec<Value> = Vec::new();
    for (lineno, line) in content.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str(line) {
            Ok(v) => records.push(v),
            Err(e) => {
                eprintln!(
                    "verify_audit_chain: {path}:{}: invalid JSON: {e}",
                    lineno + 1
                );
                process::exit(1);
            }
        }
    }

    if let Err(e) = verify_audit_chain(&records, expected_genesis.as_deref()) {
        eprintln!("verify_audit_chain: {e}");
        process::exit(1);
    }
    // State what was actually verified: an unanchored walk proves only internal
    // consistency (a whole-segment re-hash by a write-capable adversary passes),
    // so do not let "ok" read as "untampered" without an anchor.
    match expected_genesis.as_deref() {
        Some(anchor) => println!(
            "ok ({} record(s); genesis bound to anchor {anchor})",
            records.len()
        ),
        None => println!(
            "ok ({} record(s); internal chain only: no external anchor checked. \
             Supply the predecessor segment's anchored head to verify the genesis link.)",
            records.len()
        ),
    }
}
