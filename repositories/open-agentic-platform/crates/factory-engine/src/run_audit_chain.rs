// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Spec 207 FR-001 / FR-002 (AC-3): serialize a factory run's audit trail as a
//! hash-chained segment and write it to the run directory so the governance
//! certificate can anchor it.
//!
//! The run chain reuses [`policy_kernel::proof_chain::link_record_hash`], the
//! SAME linkage primitive the permission audit chain uses (FR-001: one chain
//! shape, not two). Each record is the run `AuditEntry` JSON plus
//! `previous_record_hash` + `record_hash`; the segment is verifiable offline by
//! `policy_kernel::audit::verify_audit_chain` (content-agnostic, so the run
//! record shape works), and its whole-file hash is bound into the run
//! certificate's artifact list. Any tamper then fails `verify-certificate`
//! with the existing artifact-hash diagnostic (FR-002, AC-3). The per-record
//! chain supplies the granular "which record" diagnostic; the certificate is
//! the external trust root the open chain otherwise lacks.

use std::path::{Path, PathBuf};

use factory_contracts::pipeline_state::AuditEntry;
use policy_kernel::proof_chain::link_record_hash;
use serde_json::Value;

/// Stage id under which the run-audit segment is anchored in the certificate.
/// The certificate generator scans `<run_dir>/<RUN_AUDIT_STAGE_ID>/` and hashes
/// every file, so the segment enters the artifact list with no bespoke cert
/// code, and the existing verifier loop checks it.
pub const RUN_AUDIT_STAGE_ID: &str = "run-audit";

/// Segment file name within the run-audit stage dir.
pub const RUN_AUDIT_SEGMENT: &str = "run-audit.jsonl";

/// Serialize `audit` into a hash-chained JSONL segment at
/// `<run_dir>/run-audit/run-audit.jsonl`, genesis-linked to `genesis:<run_id>`.
/// Returns the segment path. The chain shape is identical to the permission
/// chain (FR-001): `record_hash = sha256(canonical_json(record without
/// record_hash))`, each record binding its predecessor.
pub fn write_run_audit_segment(
    run_dir: &Path,
    run_id: &str,
    audit: &[AuditEntry],
) -> std::io::Result<PathBuf> {
    let dir = run_dir.join(RUN_AUDIT_STAGE_ID);
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(RUN_AUDIT_SEGMENT);

    let mut prev = format!("genesis:{run_id}");
    let mut buf = String::new();
    for entry in audit {
        let mut body = serde_json::to_value(entry).expect("audit entry serialises to JSON");
        if let Value::Object(ref mut m) = body {
            m.insert("previous_record_hash".into(), Value::String(prev.clone()));
        }
        let record_hash = link_record_hash(body.clone(), "record_hash");
        if let Value::Object(ref mut m) = body {
            m.insert("record_hash".into(), Value::String(record_hash.clone()));
        }
        buf.push_str(&serde_json::to_string(&body).expect("record serialises"));
        buf.push('\n');
        prev = record_hash;
    }
    std::fs::write(&path, buf)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use factory_contracts::pipeline_state::AuditEvent;
    use policy_kernel::audit::verify_audit_chain;
    use tempfile::TempDir;

    fn entry(stage: &str) -> AuditEntry {
        AuditEntry {
            timestamp: chrono::Utc::now(),
            event: AuditEvent::StageConfirmed,
            stage: Some(stage.into()),
            details: None,
        }
    }

    fn read_segment(path: &Path) -> Vec<Value> {
        std::fs::read_to_string(path)
            .unwrap()
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    #[test]
    fn segment_chains_and_verifies() {
        let tmp = TempDir::new().unwrap();
        let audit = vec![entry("phase-1"), entry("transition"), entry("phase-2")];
        let path =
            write_run_audit_segment(tmp.path(), "11111111-2222-3333-4444-555555555555", &audit)
                .unwrap();

        let recs = read_segment(&path);
        assert_eq!(recs.len(), 3);
        // Genesis binds the run id; records chain to predecessors.
        assert_eq!(
            recs[0]["previous_record_hash"].as_str().unwrap(),
            "genesis:11111111-2222-3333-4444-555555555555"
        );
        assert_eq!(recs[1]["previous_record_hash"], recs[0]["record_hash"]);
        verify_audit_chain(&recs, None).expect("run-audit segment verifies");
    }

    #[test]
    fn tampering_a_record_breaks_the_chain() {
        let tmp = TempDir::new().unwrap();
        let audit = vec![entry("a"), entry("b"), entry("c")];
        let path = write_run_audit_segment(tmp.path(), "run-x", &audit).unwrap();
        let mut recs = read_segment(&path);
        recs[1]["stage"] = Value::String("TAMPERED".into());
        assert!(verify_audit_chain(&recs, None).is_err());
    }

    #[test]
    fn empty_audit_writes_empty_segment() {
        let tmp = TempDir::new().unwrap();
        let path = write_run_audit_segment(tmp.path(), "run-empty", &[]).unwrap();
        assert!(path.exists());
        assert!(read_segment(&path).is_empty());
    }
}
