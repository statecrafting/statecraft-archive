// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Audit logging for permission decisions (spec 068, NF-003), made
//! tamper-evident by spec 207.
//!
//! Append-only hash-chained JSONL log at `~/.claude/audit/permissions.jsonl`.
//! Every record carries the hash of its predecessor (`previous_record_hash`)
//! and a `record_hash` over its own canonical JSON, reusing the spec 047
//! proof-chain linkage primitive ([`crate::proof_chain::link_record_hash`])
//! rather than inventing a second chain shape (spec 207 FR-001).
//!
//! The log rotates at 10 MB, retaining the last 5 rotations (R-003
//! mitigation). Rotation closes a segment with a **segment head** record
//! capturing `{segment_id, record_count, first/last timestamp}` (spec 207
//! FR-002, local half): the head's hash anchors the closed segment, the
//! next segment's genesis binds it (AC-5 continuity), and its `record_count`
//! is the truncation tripwire for a closed segment (AC-2).
//!
//! Honest residual (FR-004): the chain makes tampering EVIDENT only against
//! the external anchor. A self-referential chain catches edits that DON'T
//! recompute downstream hashes (in-place edits, mid-segment deletion,
//! reordering: the link or `record_hash` breaks). It does NOT, on its own,
//! catch an edit that re-establishes internal consistency: an attacker with
//! write access to an OPEN, not-yet-anchored segment can re-genesis and
//! recompute every `record_hash` (whole-segment rewrite, head-prefix
//! deletion, tail deletion) and the walker passes. Detecting that class is
//! what FR-002 anchoring buys (run-certificate / platform countersign,
//! Phase 2): the anchor is the external trust root the open chain lacks.
//! The independent [`verify_audit_chain`] walker shares no state with the
//! writer; pass the prior segment's anchored head as `expected_genesis` to
//! extend evidence across a rotation boundary.

use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use serde::Serialize;
use serde_json::{Value, json};

use crate::permission::MatchedRule;
use crate::proof_chain::link_record_hash;

/// A single audit log entry (NF-003).
#[derive(Debug, Clone, Serialize)]
pub struct AuditEntry {
    pub tool_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    pub decision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_rule: Option<MatchedRule>,
}

const MAX_SIZE_BYTES: u64 = 10 * 1024 * 1024; // 10 MB
const MAX_ROTATIONS: usize = 5;

/// Mutable logger state guarded by one lock: the file writer plus the chain
/// head and the running segment accounting needed to write a segment head at
/// rotation. Held under a single `Mutex` so the chain-head advance and the
/// file write cannot interleave.
struct LoggerState {
    writer: Option<BufWriter<File>>,
    /// Chain head: the `record_hash` of the last record written (or the
    /// genesis marker for a fresh segment). The next record's
    /// `previous_record_hash`.
    last_hash: String,
    /// Cosmetic segment identity stamped into the segment head. Not part of
    /// chain linkage (records link by hash), so regenerating it on restart
    /// is harmless.
    segment_id: String,
    record_count: u64,
    first_ts: Option<String>,
    last_ts: Option<String>,
}

/// Thread-safe append-only, hash-chained audit logger.
pub struct AuditLogger {
    path: PathBuf,
    /// Rotation threshold in bytes (production default [`MAX_SIZE_BYTES`]).
    max_size: u64,
    state: Mutex<LoggerState>,
}

impl AuditLogger {
    /// Create a logger writing to the given path.
    /// Creates parent directories if needed and recovers the chain head from
    /// an existing non-empty file so a process restart continues the chain.
    pub fn new(path: PathBuf) -> std::io::Result<Self> {
        Self::with_max_size(path, MAX_SIZE_BYTES)
    }

    /// Construct with an explicit rotation threshold. Crate-internal so tests
    /// can exercise the segment-head / rotation path without writing 10 MB;
    /// `new` is the production entry point.
    pub(crate) fn with_max_size(path: PathBuf, max_size: u64) -> std::io::Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new().create(true).append(true).open(&path)?;

        let (last_hash, segment_id, record_count, first_ts, last_ts) = recover_state(&path);

        Ok(Self {
            path,
            max_size,
            state: Mutex::new(LoggerState {
                writer: Some(BufWriter::new(file)),
                last_hash,
                segment_id,
                record_count,
                first_ts,
                last_ts,
            }),
        })
    }

    /// Create a logger at the default path (`~/.claude/audit/permissions.jsonl`).
    pub fn default_path() -> Option<PathBuf> {
        dirs::home_dir().map(|h| h.join(".claude").join("audit").join("permissions.jsonl"))
    }

    /// Log a permission decision, chained to its predecessor. Thin typed
    /// wrapper over [`Self::log_value`]: the `AuditEntry` is serialised and
    /// chained identically to any other JSON record (spec 207 FR-001).
    pub fn log(&self, entry: AuditEntry) {
        let body = serde_json::to_value(&entry).expect("audit entry serialises to JSON");
        self.log_value(body);
    }

    /// Append an arbitrary JSON object to the chain (spec 207 FR-001,
    /// content-agnostic). Reuses the spec 047 [`link_record_hash`] linkage so
    /// any producer (the permission audit writer here; the axiomregent
    /// tool-dispatch audit) hardens its records with the same chain shape
    /// rather than inventing a second. The record gains `timestamp`,
    /// `previous_record_hash`, and `record_hash` fields. A non-object value
    /// cannot carry chain fields and is dropped (auditing must never panic the
    /// host).
    pub fn log_value(&self, mut record: Value) {
        let timestamp = Utc::now().to_rfc3339();

        // Recover a poisoned lock rather than dropping every future record
        // silently: a prior panic with the guard held must not permanently
        // blind the audit surface. The chain state is plain data, so resuming
        // from it is safe (auditing must not panic the host either way).
        let mut guard = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        // Inject the timestamp + predecessor link, then hash and stamp the
        // record hash. Canonical-JSON hashing is key-order-independent, so the
        // field insertion order here does not affect the chain.
        match record {
            Value::Object(ref mut m) => {
                m.insert("timestamp".into(), Value::String(timestamp.clone()));
                m.insert(
                    "previous_record_hash".into(),
                    Value::String(guard.last_hash.clone()),
                );
            }
            _ => return,
        }
        let record_hash = link_record_hash(record.clone(), "record_hash");
        if let Value::Object(ref mut m) = record {
            m.insert("record_hash".into(), Value::String(record_hash.clone()));
        }

        if !self.write_and_advance(&mut guard, &record, record_hash, &timestamp) {
            return;
        }
        self.maybe_rotate(&mut guard);
    }

    /// Durably write a fully-formed record line (already carrying its
    /// `record_hash`) and advance the chain head, segment count, and time
    /// range. Returns false when the write fails (disk full, no writer): the
    /// on-disk tail stays the chain head so the next record links the last
    /// record that actually landed, never a phantom (otherwise the verifier
    /// would report a false tamper).
    fn write_and_advance(
        &self,
        guard: &mut LoggerState,
        record: &Value,
        record_hash: String,
        timestamp: &str,
    ) -> bool {
        let written = if let Some(writer) = guard.writer.as_mut() {
            match serde_json::to_string(record) {
                Ok(line) => writeln!(writer, "{line}")
                    .and_then(|()| writer.flush())
                    .is_ok(),
                Err(_) => false,
            }
        } else {
            false
        };
        if !written {
            return false;
        }

        guard.last_hash = record_hash;
        guard.record_count += 1;
        if guard.first_ts.is_none() {
            guard.first_ts = Some(timestamp.to_string());
        }
        guard.last_ts = Some(timestamp.to_string());
        true
    }

    fn maybe_rotate(&self, guard: &mut LoggerState) {
        let size = fs::metadata(&self.path).map(|m| m.len()).unwrap_or(0);
        if size < self.max_size {
            return;
        }

        // Close the segment with a head record. Its hash anchors the closed
        // segment and binds the next segment's genesis (AC-5); its
        // record_count is the closed-segment truncation tripwire (AC-2).
        let mut head = build_head(
            &guard.segment_id,
            guard.record_count,
            guard.first_ts.as_deref(),
            guard.last_ts.as_deref(),
            &guard.last_hash,
        );
        let head_hash = link_record_hash(head.clone(), "record_hash");
        if let Value::Object(ref mut m) = head {
            m.insert("record_hash".into(), Value::String(head_hash.clone()));
        }
        if let Some(writer) = guard.writer.as_mut() {
            match serde_json::to_string(&head) {
                Ok(line) => {
                    if let Err(e) = writeln!(writer, "{line}") {
                        eprintln!(
                            "[audit] segment-head write failed for segment {}: {e}; \
                             the tamper-evident anchor for this segment was NOT written",
                            guard.segment_id
                        );
                    } else if let Err(e) = writer.flush() {
                        eprintln!(
                            "[audit] segment-head flush failed for segment {}: {e}; \
                             the tamper-evident anchor for this segment may be lost",
                            guard.segment_id
                        );
                    }
                }
                Err(e) => eprintln!(
                    "[audit] failed to serialize segment-head record for segment {}: {e}",
                    guard.segment_id
                ),
            }
        }

        // Close current writer before renaming.
        guard.writer = None;

        // Shift existing rotations: .jsonl -> .1 -> .2 -> ... -> .5 (delete oldest).
        for i in (1..MAX_ROTATIONS).rev() {
            let from = rotation_path(&self.path, i);
            let to = rotation_path(&self.path, i + 1);
            if from.exists()
                && let Err(e) = fs::rename(&from, &to)
            {
                eprintln!(
                    "[audit] rotation shift failed ({} -> {}): {e}",
                    from.display(),
                    to.display()
                );
            }
        }
        if let Err(e) = fs::rename(&self.path, rotation_path(&self.path, 1)) {
            eprintln!(
                "[audit] failed to rotate {} to {}: {e}; the closed segment stays at the live \
                 path and may be appended to or overwritten by the next reopen",
                self.path.display(),
                rotation_path(&self.path, 1).display()
            );
        }
        let oldest = rotation_path(&self.path, MAX_ROTATIONS + 1);
        if oldest.exists()
            && let Err(e) = fs::remove_file(&oldest)
        {
            eprintln!(
                "[audit] failed to remove oldest rotation {}: {e}",
                oldest.display()
            );
        }

        // Reopen a fresh segment whose genesis binds the closed head.
        match OpenOptions::new().create(true).append(true).open(&self.path) {
            Ok(file) => guard.writer = Some(BufWriter::new(file)),
            Err(e) => eprintln!(
                "[audit] failed to reopen {} after rotation: {e}; audit logging is now \
                 disabled until the process restarts or the path becomes writable",
                self.path.display()
            ),
        }
        guard.last_hash = head_hash; // continuity: next genesis binds prior head
        guard.segment_id = new_segment_id();
        guard.record_count = 0;
        guard.first_ts = None;
        guard.last_ts = None;
    }
}

/// Build the canonical record body for an entry (timestamp + entry fields +
/// the predecessor link). The `record_hash` is added by the caller after
/// hashing this body. Test-only since [`AuditLogger::log`] now delegates to
/// the content-agnostic [`AuditLogger::log_value`]; retained for the
/// deterministic `ChainBuilder` test fixture.
#[cfg(test)]
fn build_record(timestamp: &str, entry: &AuditEntry, previous_hash: &str) -> Value {
    let mut v = serde_json::to_value(entry).expect("audit entry serialises to JSON");
    if let Value::Object(ref mut m) = v {
        m.insert("timestamp".into(), Value::String(timestamp.into()));
        m.insert(
            "previous_record_hash".into(),
            Value::String(previous_hash.into()),
        );
    }
    v
}

/// Build a segment head record (FR-002 local half). `record_hash` added by caller.
fn build_head(
    segment_id: &str,
    record_count: u64,
    first_ts: Option<&str>,
    last_ts: Option<&str>,
    previous_hash: &str,
) -> Value {
    json!({
        "segment_head": true,
        "segment_id": segment_id,
        "record_count": record_count,
        "first_timestamp": first_ts.unwrap_or(""),
        "last_timestamp": last_ts.unwrap_or(""),
        "previous_record_hash": previous_hash,
    })
}

/// Generate a fresh cosmetic segment id (8 random bytes, hex). Not chain-load-bearing.
fn new_segment_id() -> String {
    let mut b = [0u8; 8];
    let _ = getrandom::fill(&mut b);
    hex::encode(b)
}

/// Recover chain state from an existing file. Returns
/// `(last_hash, segment_id, record_count, first_ts, last_ts)`. A fresh or
/// unparseable-tail file starts a new genesis segment.
fn recover_state(path: &Path) -> (String, String, u64, Option<String>, Option<String>) {
    let segment_id = new_segment_id();
    let genesis = format!("genesis:{segment_id}");

    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return (genesis, segment_id, 0, None, None),
    };
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.is_empty() {
        // A fresh empty file after rotation must still bind the closed
        // segment's head (AC-5 continuity), even when the process restarts in
        // the window between rotation and the first new write. Recover the
        // prior segment's head hash from the most recent rotation if present;
        // a true first-ever segment (no rotation) falls back to genesis.
        let last_hash = rotation_tail_hash(path).unwrap_or(genesis);
        return (last_hash, segment_id, 0, None, None);
    }

    // Continue from the last record's hash if it parses; else start fresh
    // genesis (the boundary discontinuity is surfaced by the verifier rather
    // than silently bridged).
    let last: Value = match serde_json::from_str(lines[lines.len() - 1]) {
        Ok(v) => v,
        Err(_) => return (genesis, segment_id, 0, None, None),
    };
    let last_hash = match last.get("record_hash").and_then(Value::as_str) {
        Some(h) => h.to_string(),
        None => return (genesis, segment_id, 0, None, None),
    };

    let record_count = lines
        .iter()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| v.get("segment_head").and_then(Value::as_bool) != Some(true))
        .count() as u64;
    let first_ts = serde_json::from_str::<Value>(lines[0])
        .ok()
        .and_then(|v| v.get("timestamp").and_then(Value::as_str).map(String::from));
    // Data records carry `timestamp`; a (rare, rename-failure-edge) trailing
    // head carries `last_timestamp` instead.
    let last_ts = last
        .get("timestamp")
        .or_else(|| last.get("last_timestamp"))
        .and_then(Value::as_str)
        .map(String::from);

    (last_hash, segment_id, record_count, first_ts, last_ts)
}

fn rotation_path(base: &Path, n: usize) -> PathBuf {
    let mut p = base.as_os_str().to_owned();
    p.push(format!(".{n}"));
    PathBuf::from(p)
}

/// Read the `record_hash` of the last record in the most recent rotation
/// (`<path>.1`), used to bind a fresh segment's genesis to the prior closed
/// segment's head across a rotate-then-restart (AC-5). Returns `None` when no
/// rotation exists or its tail is unreadable.
fn rotation_tail_hash(path: &Path) -> Option<String> {
    let content = fs::read_to_string(rotation_path(path, 1)).ok()?;
    let last = content.lines().rfind(|l| !l.trim().is_empty())?;
    let v: Value = serde_json::from_str(last).ok()?;
    v.get("record_hash")
        .and_then(Value::as_str)
        .map(String::from)
}

/// Verification failure, naming the first broken record (FR-003).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuditChainError {
    EmptyChain,
    MissingField {
        index: usize,
        field: &'static str,
    },
    RecordHashMismatch {
        index: usize,
    },
    BrokenLink {
        index: usize,
    },
    GenesisMismatch {
        expected: String,
        found: String,
    },
    /// Segment head present but its `record_count` disagrees with the number
    /// of data records before it (closed-segment tail truncation, AC-2).
    CountMismatch {
        expected: u64,
        found: u64,
    },
    /// A segment head appeared before the final position.
    MisplacedHead {
        index: usize,
    },
}

impl std::fmt::Display for AuditChainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyChain => write!(f, "empty chain"),
            Self::MissingField { index, field } => {
                write!(f, "record {index}: missing required field `{field}`")
            }
            Self::RecordHashMismatch { index } => {
                write!(
                    f,
                    "record {index}: record_hash mismatch (content was altered)"
                )
            }
            Self::BrokenLink { index } => {
                write!(
                    f,
                    "record {index}: broken chain link (predecessor deleted or reordered)"
                )
            }
            Self::GenesisMismatch { expected, found } => {
                write!(
                    f,
                    "record 0: genesis link {found} does not bind expected anchor {expected}"
                )
            }
            Self::CountMismatch { expected, found } => write!(
                f,
                "segment head record_count {expected} != {found} data records (tail truncated)"
            ),
            Self::MisplacedHead { index } => {
                write!(f, "record {index}: segment head before end of segment")
            }
        }
    }
}

impl std::error::Error for AuditChainError {}

/// Walk an audit segment chain (FR-003). Recomputes each record's hash,
/// checks each `previous_record_hash` binds its predecessor, and (if the
/// final record is a segment head) checks its `record_count` against the
/// data records. When `expected_genesis` is given, the first record's
/// `previous_record_hash` must equal it (cross-segment continuity, AC-5);
/// otherwise the first record's predecessor link is the segment boundary and
/// is not failed. Shares no state with the writer and runs offline.
pub fn verify_audit_chain(
    records: &[Value],
    expected_genesis: Option<&str>,
) -> Result<(), AuditChainError> {
    if records.is_empty() {
        return Err(AuditChainError::EmptyChain);
    }

    let last = records.len() - 1;
    for (i, rec) in records.iter().enumerate() {
        let is_head = rec.get("segment_head").and_then(Value::as_bool) == Some(true);
        if is_head && i != last {
            return Err(AuditChainError::MisplacedHead { index: i });
        }

        let stored = rec.get("record_hash").and_then(Value::as_str).ok_or(
            AuditChainError::MissingField {
                index: i,
                field: "record_hash",
            },
        )?;
        if link_record_hash(rec.clone(), "record_hash") != stored {
            return Err(AuditChainError::RecordHashMismatch { index: i });
        }

        let prev = rec
            .get("previous_record_hash")
            .and_then(Value::as_str)
            .ok_or(AuditChainError::MissingField {
                index: i,
                field: "previous_record_hash",
            })?;
        if i == 0 {
            if let Some(g) = expected_genesis {
                if prev != g {
                    return Err(AuditChainError::GenesisMismatch {
                        expected: g.to_string(),
                        found: prev.to_string(),
                    });
                }
            }
        } else {
            let prior = records[i - 1]
                .get("record_hash")
                .and_then(Value::as_str)
                .unwrap_or("");
            if prev != prior {
                return Err(AuditChainError::BrokenLink { index: i });
            }
        }
    }

    // Closed-segment truncation tripwire (AC-2): a trailing head's stated
    // record_count must equal the data records preceding it.
    let trailing_head = records
        .last()
        .filter(|h| h.get("segment_head").and_then(Value::as_bool) == Some(true));
    if let Some(head) = trailing_head {
        let expected = head.get("record_count").and_then(Value::as_u64).ok_or(
            AuditChainError::MissingField {
                index: last,
                field: "record_count",
            },
        )?;
        let found = last as u64; // every record except the head is a data record
        if expected != found {
            return Err(AuditChainError::CountMismatch { expected, found });
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn entry(cmd: &str) -> AuditEntry {
        AuditEntry {
            tool_name: "Bash".into(),
            file_path: None,
            command: Some(cmd.into()),
            decision: "Allow".into(),
            matched_rule: None,
        }
    }

    fn read_records(path: &Path) -> Vec<Value> {
        fs::read_to_string(path)
            .unwrap()
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    #[test]
    fn creates_parent_dirs_and_chains() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("audit").join("permissions.jsonl");
        let logger = AuditLogger::new(path.clone()).unwrap();

        logger.log(entry("cargo test"));
        logger.log(entry("cargo build"));

        let recs = read_records(&path);
        assert_eq!(recs.len(), 2);
        assert!(recs[0]["timestamp"].as_str().is_some());
        assert_eq!(recs[0]["tool_name"], "Bash");
        // Genesis marker on the first record.
        assert!(
            recs[0]["previous_record_hash"]
                .as_str()
                .unwrap()
                .starts_with("genesis:")
        );
        // Record 1 binds record 0.
        assert_eq!(recs[1]["previous_record_hash"], recs[0]["record_hash"]);
        verify_audit_chain(&recs, None).expect("clean chain verifies");
    }

    /// Spec 207 FR-001: `log_value` chains an arbitrary JSON object and the
    /// content-agnostic verifier accepts it. The axiomregent tool-dispatch
    /// audit feeds records this way (not via the typed `AuditEntry`).
    #[test]
    fn log_value_chains_arbitrary_records() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("dispatch.jsonl");
        let logger = AuditLogger::new(path.clone()).unwrap();

        logger.log_value(json!({
            "op": "axiomregent.tool_audit", "tool": "read_file", "decision": "allowed"
        }));
        logger.log_value(json!({
            "op": "axiomregent.tool_audit", "tool": "write_file", "decision": "denied"
        }));

        let recs = read_records(&path);
        assert_eq!(recs.len(), 2);
        assert_eq!(recs[0]["tool"], "read_file");
        assert!(recs[0]["timestamp"].as_str().is_some());
        assert!(
            recs[0]["previous_record_hash"]
                .as_str()
                .unwrap()
                .starts_with("genesis:")
        );
        assert_eq!(recs[1]["previous_record_hash"], recs[0]["record_hash"]);
        verify_audit_chain(&recs, None).expect("arbitrary-record chain verifies");
    }

    /// A non-object value cannot carry chain fields; it is dropped without
    /// panicking or advancing the chain head, so the next object still binds
    /// the genesis marker.
    #[test]
    fn log_value_non_object_is_dropped() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("d.jsonl");
        let logger = AuditLogger::new(path.clone()).unwrap();

        logger.log_value(json!("not-an-object"));
        logger.log_value(json!({ "tool": "x", "decision": "allowed" }));

        let recs = read_records(&path);
        assert_eq!(recs.len(), 1, "the scalar was dropped; the object landed");
        assert!(
            recs[0]["previous_record_hash"]
                .as_str()
                .unwrap()
                .starts_with("genesis:")
        );
        verify_audit_chain(&recs, None).expect("chain intact after dropped scalar");
    }

    /// AC-1: flipping one byte in record N is caught, naming N.
    #[test]
    fn ac1_byte_flip_detected() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("a.jsonl");
        let logger = AuditLogger::new(path.clone()).unwrap();
        for i in 0..5 {
            logger.log(entry(&format!("cmd-{i}")));
        }
        let mut recs = read_records(&path);
        // Tamper record 2's content without recomputing its hash.
        recs[2]["command"] = Value::String("TAMPERED".into());
        let err = verify_audit_chain(&recs, None).unwrap_err();
        assert_eq!(err, AuditChainError::RecordHashMismatch { index: 2 });
    }

    /// AC-2: deleting a mid-segment record breaks the link at the splice.
    #[test]
    fn ac2_mid_segment_deletion_detected() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("a.jsonl");
        let logger = AuditLogger::new(path.clone()).unwrap();
        for i in 0..5 {
            logger.log(entry(&format!("cmd-{i}")));
        }
        let mut recs = read_records(&path);
        recs.remove(2); // delete the middle record
        let err = verify_audit_chain(&recs, None).unwrap_err();
        // What was record 3 is now at index 2 and its previous_record_hash
        // points at the deleted record.
        assert_eq!(err, AuditChainError::BrokenLink { index: 2 });
    }

    /// AC-2: truncating a closed segment's tail trips the head record_count.
    #[test]
    fn ac2_closed_segment_truncation_detected() {
        // Build a segment with a head by hand (rotation needs 10 MB).
        let mut w = ChainBuilder::genesis("genesis:seg");
        let mut recs: Vec<Value> = (0..4).map(|i| w.data(&entry(&format!("c{i}")))).collect();
        let head = w.head("seg", 4);
        recs.push(head);
        verify_audit_chain(&recs, None).expect("intact closed segment verifies");

        // Drop one data record and re-link the head to the new tail so only
        // the count is wrong (proves count, not linkage, catches it).
        let mut truncated = recs.clone();
        truncated.remove(3);
        let new_prev = truncated[2]["record_hash"].as_str().unwrap().to_string();
        truncated[3]["previous_record_hash"] = Value::String(new_prev);
        let relinked = link_record_hash(truncated[3].clone(), "record_hash");
        truncated[3]["record_hash"] = Value::String(relinked);
        let err = verify_audit_chain(&truncated, None).unwrap_err();
        assert_eq!(
            err,
            AuditChainError::CountMismatch {
                expected: 4,
                found: 3
            }
        );
    }

    /// AC-5: rotation writes a head and the next segment's genesis binds it.
    #[test]
    fn ac5_rotation_continuity() {
        let mut w = ChainBuilder::genesis("genesis:seg-n");
        let mut seg_n: Vec<Value> = (0..3).map(|i| w.data(&entry(&format!("n{i}")))).collect();
        let head = w.head("seg-n", 3);
        let head_hash = head["record_hash"].as_str().unwrap().to_string();
        seg_n.push(head);
        verify_audit_chain(&seg_n, None).expect("segment N verifies");

        // Segment N+1 genesis must bind segment N's head hash.
        let mut w2 = ChainBuilder::genesis(&head_hash);
        let seg_n1: Vec<Value> = (0..2).map(|i| w2.data(&entry(&format!("m{i}")))).collect();
        verify_audit_chain(&seg_n1, Some(&head_hash)).expect("segment N+1 binds N's head");
        // Wrong anchor is rejected.
        let err = verify_audit_chain(&seg_n1, Some("sha256:wrong")).unwrap_err();
        assert!(matches!(err, AuditChainError::GenesisMismatch { .. }));
    }

    /// A restart on a non-empty file continues the chain unbroken.
    #[test]
    fn restart_continues_chain() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("a.jsonl");
        {
            let logger = AuditLogger::new(path.clone()).unwrap();
            logger.log(entry("before"));
            logger.log(entry("restart"));
        }
        let logger = AuditLogger::new(path.clone()).unwrap();
        logger.log(entry("after"));
        let recs = read_records(&path);
        assert_eq!(recs.len(), 3);
        verify_audit_chain(&recs, None).expect("chain survives restart");
    }

    /// Drives the REAL writer rotation path (small threshold) and proves the
    /// closed segment verifies with a correct head record_count (FR-002), and
    /// that a restart in the post-rotation empty-file window still binds the
    /// next genesis to the prior head (AC-5 continuity across rotate+restart).
    #[test]
    fn rotation_head_and_restart_continuity() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("permissions.jsonl");
        let rotated = rotation_path(&path, 1);

        // Tiny threshold so a couple of records force a rotation.
        {
            let logger = AuditLogger::with_max_size(path.clone(), 200).unwrap();
            for i in 0..8 {
                logger.log(entry(&format!("rot-{i}")));
                if rotated.exists() {
                    break;
                }
            }
            assert!(rotated.exists(), "expected a rotation to occur");
        }

        // The closed segment (.1) ends with a head whose record_count equals
        // its data records, and it verifies clean.
        let closed = read_records(&rotated);
        let head = closed.last().unwrap();
        assert_eq!(head["segment_head"], Value::Bool(true));
        let data_count = closed.len() as u64 - 1;
        assert_eq!(head["record_count"].as_u64().unwrap(), data_count);
        verify_audit_chain(&closed, None).expect("closed segment verifies");
        let head_hash = head["record_hash"].as_str().unwrap().to_string();

        // The current file is empty post-rotation. A restart here must recover
        // the prior head as the binding (not a fresh genesis).
        assert!(
            read_records(&path).is_empty(),
            "post-rotation file is empty"
        );
        let logger = AuditLogger::new(path.clone()).unwrap();
        logger.log(entry("after-restart"));
        let next = read_records(&path);
        assert_eq!(
            next[0]["previous_record_hash"].as_str().unwrap(),
            head_hash,
            "fresh segment genesis binds the prior segment's head"
        );
        verify_audit_chain(&next, Some(&head_hash))
            .expect("continuity holds across rotate+restart");
    }

    #[test]
    fn empty_chain_is_error() {
        assert_eq!(
            verify_audit_chain(&[], None).unwrap_err(),
            AuditChainError::EmptyChain
        );
    }

    #[test]
    fn rotation_path_format() {
        let base = PathBuf::from("/tmp/permissions.jsonl");
        assert_eq!(
            rotation_path(&base, 1),
            PathBuf::from("/tmp/permissions.jsonl.1")
        );
        assert_eq!(
            rotation_path(&base, 5),
            PathBuf::from("/tmp/permissions.jsonl.5")
        );
    }

    /// Test-only chain builder mirroring the writer's hashing, so segment-head
    /// behaviour can be exercised without writing 10 MB to trigger rotation.
    struct ChainBuilder {
        last_hash: String,
    }
    impl ChainBuilder {
        fn genesis(anchor: &str) -> Self {
            Self {
                last_hash: anchor.to_string(),
            }
        }
        fn data(&mut self, e: &AuditEntry) -> Value {
            let mut body = build_record("2026-06-19T00:00:00Z", e, &self.last_hash);
            let h = link_record_hash(body.clone(), "record_hash");
            body["record_hash"] = Value::String(h.clone());
            self.last_hash = h;
            body
        }
        fn head(&mut self, seg: &str, count: u64) -> Value {
            let mut head = build_head(
                seg,
                count,
                Some("2026-06-19T00:00:00Z"),
                Some("2026-06-19T00:00:09Z"),
                &self.last_hash,
            );
            let h = link_record_hash(head.clone(), "record_hash");
            head["record_hash"] = Value::String(h.clone());
            self.last_hash = h;
            head
        }
    }
}
