//! Spec 207 FR-003 end-to-end: the `verify_audit_chain` binary exits 0 on a
//! clean chain written by the real `AuditLogger`, and exits non-zero after a
//! single-byte tamper (AC-1). Exercises the CLI shell, not just the library
//! function, so arg parsing, JSONL splitting, and exit codes are covered.

use open_agentic_policy_kernel::audit::{AuditEntry, AuditLogger};
use std::process::Command;

fn entry(cmd: &str) -> AuditEntry {
    AuditEntry {
        tool_name: "Bash".into(),
        file_path: None,
        command: Some(cmd.into()),
        decision: "Allow".into(),
        matched_rule: None,
    }
}

fn write_chain(path: &std::path::Path, n: usize) {
    let logger = AuditLogger::new(path.to_path_buf()).unwrap();
    for i in 0..n {
        logger.log(entry(&format!("cmd-{i}")));
    }
}

#[test]
fn clean_chain_exits_zero() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("permissions.jsonl");
    write_chain(&path, 3);

    let status = Command::new(env!("CARGO_BIN_EXE_verify_audit_chain"))
        .arg(&path)
        .status()
        .expect("spawn verifier");
    assert!(status.success(), "clean chain should verify (exit 0)");
}

#[test]
fn tampered_chain_exits_nonzero() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("permissions.jsonl");
    write_chain(&path, 3);

    // Flip one byte of content on the middle record without recomputing its
    // hash: the chain no longer self-verifies.
    let content = std::fs::read_to_string(&path).unwrap();
    let mut lines: Vec<String> = content.lines().map(String::from).collect();
    lines[1] = lines[1].replacen("cmd-1", "cmd-X", 1);
    std::fs::write(&path, lines.join("\n") + "\n").unwrap();

    let status = Command::new(env!("CARGO_BIN_EXE_verify_audit_chain"))
        .arg(&path)
        .status()
        .expect("spawn verifier");
    assert!(
        !status.success(),
        "tampered chain must fail verification (non-zero exit)"
    );
}

#[test]
fn missing_arg_exits_usage() {
    let status = Command::new(env!("CARGO_BIN_EXE_verify_audit_chain"))
        .status()
        .expect("spawn verifier");
    assert_eq!(status.code(), Some(2), "no args -> usage exit 2");
}

#[test]
fn expected_genesis_arg_checks_first_link() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("permissions.jsonl");
    write_chain(&path, 2);

    // The fresh segment's first record binds a `genesis:<id>` marker; read it
    // and feed it back as the expected anchor (the CLI's 2-arg path).
    let content = std::fs::read_to_string(&path).unwrap();
    let first: serde_json::Value = serde_json::from_str(content.lines().next().unwrap()).unwrap();
    let genesis = first["previous_record_hash"].as_str().unwrap();

    let ok = Command::new(env!("CARGO_BIN_EXE_verify_audit_chain"))
        .arg(&path)
        .arg(genesis)
        .status()
        .expect("spawn verifier");
    assert!(ok.success(), "matching expected_genesis verifies (exit 0)");

    let bad = Command::new(env!("CARGO_BIN_EXE_verify_audit_chain"))
        .arg(&path)
        .arg("sha256:not-the-anchor")
        .status()
        .expect("spawn verifier");
    assert!(
        !bad.success(),
        "wrong expected_genesis fails (non-zero exit)"
    );
}
