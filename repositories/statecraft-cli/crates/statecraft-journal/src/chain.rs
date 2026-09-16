//! The hash-linked chain of spec 011 (spec 113 B-1): an append-only JSONL
//! journal of sealed records `{seq, ts, kind, payload, prevHash,
//! recordHash}`, the genesis record bound to an anchor stored beside it.
//! State is never trusted from memory: it is recovered by folding the
//! journal. A chain the TypeScript writer wrote opens, verifies and extends
//! here; one written here does the same there.

use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::canonical::{canonical_string, hash_value, sha256_hex, NotPortable};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JournalRecord {
    pub seq: u64,
    pub ts: String,
    pub kind: String,
    pub payload: Value,
    pub prev_hash: String,
    pub record_hash: String,
}

impl JournalRecord {
    /// `{seq, ts, kind, payload, prevHash}`: what `recordHash` seals.
    pub fn base(&self) -> Value {
        json!({
            "seq": self.seq,
            "ts": self.ts,
            "kind": self.kind,
            "payload": self.payload,
            "prevHash": self.prev_hash,
        })
    }
}

/// `computeRecordHash`: sha256 over the canonical base.
pub fn compute_record_hash(
    seq: u64,
    ts: &str,
    kind: &str,
    payload: &Value,
    prev_hash: &str,
) -> Result<String, NotPortable> {
    hash_value(&json!({
        "seq": seq,
        "ts": ts,
        "kind": kind,
        "payload": payload,
        "prevHash": prev_hash,
    }))
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Anchor {
    pub anchor_hash: String,
    pub created_at: String,
}

/// The fold: the records grouped by kind (011's honest minimum).
#[derive(Clone, Debug, Default)]
pub struct FoldedState {
    pub records: Vec<JournalRecord>,
    pub by_kind: BTreeMap<String, Vec<JournalRecord>>,
}

pub fn fold_state(records: &[JournalRecord]) -> FoldedState {
    let mut by_kind: BTreeMap<String, Vec<JournalRecord>> = BTreeMap::new();
    for r in records {
        by_kind.entry(r.kind.clone()).or_default().push(r.clone());
    }
    FoldedState {
        records: records.to_vec(),
        by_kind,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum VerifyResult {
    Ok { count: usize },
    Broken { broken_seq: u64, reason: String },
}

impl VerifyResult {
    pub fn is_ok(&self) -> bool {
        matches!(self, VerifyResult::Ok { .. })
    }
}

/// The four filenames a chain lives under (011): the default names for
/// the work journal, a basename-derived set for a second chain in the same
/// directory.
#[derive(Clone, Debug)]
pub struct ChainFiles {
    pub journal: PathBuf,
    pub anchor: PathBuf,
    pub torn: PathBuf,
    pub lock: PathBuf,
}

pub fn chain_files(dir: &Path, basename: Option<&str>) -> ChainFiles {
    match basename {
        None => ChainFiles {
            journal: dir.join("journal.jsonl"),
            anchor: dir.join("anchor.json"),
            torn: dir.join("journal.jsonl.torn"),
            lock: dir.join("journal.lock"),
        },
        Some(b) => ChainFiles {
            journal: dir.join(format!("{b}.jsonl")),
            anchor: dir.join(format!("{b}.anchor.json")),
            torn: dir.join(format!("{b}.jsonl.torn")),
            lock: dir.join(format!("{b}.lock")),
        },
    }
}

#[derive(Debug)]
pub struct ChainError(pub String);

impl std::fmt::Display for ChainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ChainError {}

impl From<std::io::Error> for ChainError {
    fn from(e: std::io::Error) -> ChainError {
        ChainError(e.to_string())
    }
}

impl From<NotPortable> for ChainError {
    fn from(e: NotPortable) -> ChainError {
        ChainError(e.to_string())
    }
}

fn write_durable(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut f = File::create(path)?;
    f.write_all(bytes)?;
    f.sync_all()
}

fn now_iso() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

pub fn load_or_create_anchor(path: &Path) -> Result<Anchor, ChainError> {
    if path.exists() {
        let text = fs::read_to_string(path)?;
        let parsed: Value = serde_json::from_str(&text).map_err(|_| {
            ChainError(format!(
                "anchor corrupted: {}: run verifyChain() to diagnose",
                path.display()
            ))
        })?;
        let anchor_hash = parsed.get("anchorHash").and_then(Value::as_str);
        let created_at = parsed.get("createdAt").and_then(Value::as_str);
        return match (anchor_hash, created_at) {
            (Some(h), Some(c)) => Ok(Anchor {
                anchor_hash: h.to_string(),
                created_at: c.to_string(),
            }),
            _ => Err(ChainError(format!(
                "anchor corrupted: {}: run verifyChain() to diagnose",
                path.display()
            ))),
        };
    }
    let created_at = now_iso();
    let anchor_hash =
        hash_value(&json!({"kind": "orchestrator-journal-anchor", "createdAt": created_at}))?;
    let anchor = Anchor {
        anchor_hash,
        created_at,
    };
    write_durable(
        path,
        format!(
            "{}\n",
            serde_json::to_string(&anchor).expect("anchor serializes")
        )
        .as_bytes(),
    )?;
    Ok(anchor)
}

pub fn read_anchor(path: &Path) -> Result<Anchor, ChainError> {
    if !path.exists() {
        return Err(ChainError(format!(
            "no anchor at {}: nothing to verify",
            path.display()
        )));
    }
    let text = fs::read_to_string(path)?;
    let anchor: Anchor =
        serde_json::from_str(&text).map_err(|e| ChainError(format!("anchor unreadable: {e}")))?;
    Ok(anchor)
}

fn parse_record(line: &str, seq: usize) -> Result<JournalRecord, String> {
    let parsed: Value =
        serde_json::from_str(line).map_err(|_| "line is not valid JSON".to_string())?;
    let obj = parsed
        .as_object()
        .ok_or_else(|| "unexpected record shape".to_string())?;
    let rec_seq = obj.get("seq").and_then(Value::as_u64);
    let ts = obj.get("ts").and_then(Value::as_str);
    let kind = obj.get("kind").and_then(Value::as_str);
    let prev = obj.get("prevHash").and_then(Value::as_str);
    let hash = obj.get("recordHash").and_then(Value::as_str);
    match (rec_seq, ts, kind, obj.get("payload"), prev, hash) {
        (Some(s), Some(ts), Some(kind), Some(payload), Some(prev), Some(hash))
            if s == seq as u64 =>
        {
            Ok(JournalRecord {
                seq: s,
                ts: ts.to_string(),
                kind: kind.to_string(),
                payload: payload.clone(),
                prev_hash: prev.to_string(),
                record_hash: hash.to_string(),
            })
        }
        _ => Err("unexpected record shape".to_string()),
    }
}

fn lines_of(bytes: &[u8]) -> Vec<&str> {
    if bytes.is_empty() {
        return Vec::new();
    }
    let text = std::str::from_utf8(bytes).unwrap_or("");
    text.split('\n').filter(|l| !l.is_empty()).collect()
}

struct Recovered {
    records: Vec<JournalRecord>,
    torn_recovered: bool,
}

/// `readAndRecover`: move a torn tail aside, parse and shape-check every
/// line, and check only the tail's link and hash (B-3 of 011).
fn read_and_recover(files: &ChainFiles, anchor_hash: &str) -> Result<Recovered, ChainError> {
    let raw = if files.journal.exists() {
        fs::read(&files.journal)?
    } else {
        Vec::new()
    };
    let mut torn_recovered = false;
    let good: &[u8] = if raw.is_empty() {
        &raw
    } else {
        match raw.iter().rposition(|b| *b == b'\n') {
            Some(last) if last == raw.len() - 1 => &raw,
            Some(last) => {
                write_durable(&files.torn, &raw[last + 1..])?;
                let f = OpenOptions::new().write(true).open(&files.journal)?;
                f.set_len((last + 1) as u64)?;
                f.sync_all()?;
                torn_recovered = true;
                &raw[..last + 1]
            }
            None => {
                write_durable(&files.torn, &raw)?;
                let f = OpenOptions::new().write(true).open(&files.journal)?;
                f.set_len(0)?;
                f.sync_all()?;
                torn_recovered = true;
                &[]
            }
        }
    };
    let mut records = Vec::new();
    for (i, line) in lines_of(good).iter().enumerate() {
        let record = parse_record(line, i).map_err(|reason| {
            ChainError(format!(
                "journal corrupted at seq {i} ({reason}): run verifyChain() to diagnose"
            ))
        })?;
        records.push(record);
    }
    if let Some(tail) = records.last() {
        let expected_prev = if records.len() > 1 {
            records[records.len() - 2].record_hash.clone()
        } else {
            anchor_hash.to_string()
        };
        if tail.prev_hash != expected_prev {
            return Err(ChainError(format!(
                "journal corrupted at seq {} (prevHash does not link to its predecessor): run verifyChain() to diagnose",
                tail.seq
            )));
        }
        let recomputed = compute_record_hash(
            tail.seq,
            &tail.ts,
            &tail.kind,
            &tail.payload,
            &tail.prev_hash,
        )?;
        if recomputed != tail.record_hash {
            return Err(ChainError(format!(
                "journal corrupted at seq {} (recordHash does not match its content): run verifyChain() to diagnose",
                tail.seq
            )));
        }
    }
    Ok(Recovered {
        records,
        torn_recovered,
    })
}

/// An open chain: one writer, the lock held until `close` or drop.
pub struct Chain {
    pub dir: PathBuf,
    files: ChainFiles,
    records: Vec<JournalRecord>,
    head_seq: i64,
    head_hash: String,
    pub torn_recovered: bool,
    file: Option<File>,
    closed: bool,
}

impl Chain {
    /// `openJournal`.
    pub fn open(dir: &Path, basename: Option<&str>) -> Result<Chain, ChainError> {
        fs::create_dir_all(dir)?;
        let files = chain_files(dir, basename);
        // One writer per journal: creation fails atomically when the lock
        // exists, which is what makes this exclusive.
        let mut lock = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&files.lock)
        {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(ChainError(format!(
                    "journal locked: another writer holds {} (remove it once that writer is confirmed dead)",
                    files.lock.display()
                )));
            }
            Err(e) => return Err(e.into()),
        };
        lock.write_all(format!("{}\n", std::process::id()).as_bytes())?;
        lock.sync_all()?;
        let opened = (|| -> Result<Chain, ChainError> {
            let anchor = load_or_create_anchor(&files.anchor)?;
            if !files.journal.exists() {
                write_durable(&files.journal, b"")?;
            }
            let recovered = read_and_recover(&files, &anchor.anchor_hash)?;
            let file = OpenOptions::new().append(true).open(&files.journal)?;
            let (head_seq, head_hash) = match recovered.records.last() {
                Some(last) => (last.seq as i64, last.record_hash.clone()),
                None => (-1, anchor.anchor_hash.clone()),
            };
            Ok(Chain {
                dir: dir.to_path_buf(),
                files: files.clone(),
                records: recovered.records,
                head_seq,
                head_hash,
                torn_recovered: recovered.torn_recovered,
                file: Some(file),
                closed: false,
            })
        })();
        if opened.is_err() {
            let _ = fs::remove_file(&files.lock);
        }
        opened
    }

    pub fn head_seq(&self) -> i64 {
        self.head_seq
    }

    pub fn records(&self) -> &[JournalRecord] {
        &self.records
    }

    pub fn fold(&self) -> FoldedState {
        fold_state(&self.records)
    }

    /// One hash, one write, one fsync; no re-read of prior records.
    pub fn append(&mut self, kind: &str, payload: Value) -> Result<JournalRecord, ChainError> {
        if self.closed {
            return Err(ChainError("journal is closed".to_string()));
        }
        let seq = (self.head_seq + 1) as u64;
        let ts = now_iso();
        let record_hash = compute_record_hash(seq, &ts, kind, &payload, &self.head_hash)?;
        let record = JournalRecord {
            seq,
            ts,
            kind: kind.to_string(),
            payload,
            prev_hash: self.head_hash.clone(),
            record_hash,
        };
        let line = format!(
            "{}\n",
            canonical_string(&serde_json::to_value(&record).expect("record serializes"))?
        );
        let file = self
            .file
            .as_mut()
            .ok_or_else(|| ChainError("journal is closed".to_string()))?;
        file.write_all(line.as_bytes())?;
        file.sync_all()?;
        self.head_seq = seq as i64;
        self.head_hash = record.record_hash.clone();
        self.records.push(record.clone());
        Ok(record)
    }

    pub fn close(&mut self) {
        if self.closed {
            return;
        }
        self.closed = true;
        self.file = None;
        let _ = fs::remove_file(&self.files.lock);
    }
}

impl Drop for Chain {
    fn drop(&mut self) {
        self.close();
    }
}

/// `verifyChain`: recompute every hash and link from the anchor forward.
pub fn verify_chain(dir: &Path, basename: Option<&str>) -> Result<VerifyResult, ChainError> {
    let files = chain_files(dir, basename);
    let anchor = read_anchor(&files.anchor)?;
    if !files.journal.exists() {
        return Ok(VerifyResult::Ok { count: 0 });
    }
    let raw = fs::read(&files.journal)?;
    let lines = lines_of(&raw);
    let mut prev_hash = anchor.anchor_hash;
    for (i, line) in lines.iter().enumerate() {
        let record = match parse_record(line, i) {
            Ok(r) => r,
            Err(reason) => {
                return Ok(VerifyResult::Broken {
                    broken_seq: i as u64,
                    reason,
                })
            }
        };
        if record.prev_hash != prev_hash {
            return Ok(VerifyResult::Broken {
                broken_seq: i as u64,
                reason: "prevHash does not link to its predecessor".to_string(),
            });
        }
        let recomputed = match compute_record_hash(
            record.seq,
            &record.ts,
            &record.kind,
            &record.payload,
            &record.prev_hash,
        ) {
            Ok(h) => h,
            Err(e) => {
                return Ok(VerifyResult::Broken {
                    broken_seq: i as u64,
                    reason: e.to_string(),
                })
            }
        };
        if recomputed != record.record_hash {
            return Ok(VerifyResult::Broken {
                broken_seq: i as u64,
                reason: "recordHash does not match its content".to_string(),
            });
        }
        prev_hash = record.record_hash;
    }
    Ok(VerifyResult::Ok { count: lines.len() })
}

/// Read a chain's records without opening it for writing (no lock, no
/// anchor created): what export does (031 B-4).
pub fn read_records(
    dir: &Path,
    basename: Option<&str>,
) -> Result<(Anchor, Vec<JournalRecord>), ChainError> {
    let files = chain_files(dir, basename);
    let anchor = read_anchor(&files.anchor)?;
    if !files.journal.exists() {
        return Ok((anchor, Vec::new()));
    }
    let raw = fs::read(&files.journal)?;
    let mut records = Vec::new();
    for (i, line) in lines_of(&raw).iter().enumerate() {
        records
            .push(parse_record(line, i).map_err(|reason| {
                ChainError(format!("journal corrupted at seq {i} ({reason})"))
            })?);
    }
    Ok((anchor, records))
}

// --- intent/outcome bracket (011 B-4) ---------------------------------------------

pub const INTENT_SUFFIX: &str = ".intent";
pub const OUTCOME_SUFFIX: &str = ".outcome";

/// An intent with no later outcome of the same op, order-aware per op.
pub fn unresolved_intents(records: &[JournalRecord]) -> Vec<JournalRecord> {
    let mut pending: BTreeMap<String, std::collections::VecDeque<JournalRecord>> = BTreeMap::new();
    for r in records {
        if let Some(op) = r.kind.strip_suffix(INTENT_SUFFIX) {
            pending
                .entry(op.to_string())
                .or_default()
                .push_back(r.clone());
        } else if let Some(op) = r.kind.strip_suffix(OUTCOME_SUFFIX) {
            if let Some(queue) = pending.get_mut(op) {
                queue.pop_front();
            }
        }
    }
    let mut out: Vec<JournalRecord> = pending.into_values().flatten().collect();
    out.sort_by_key(|r| r.seq);
    out
}

/// A handful of bytes read back for tests and diagnostics.
pub fn read_to_string(path: &Path) -> std::io::Result<String> {
    let mut s = String::new();
    File::open(path)?.read_to_string(&mut s)?;
    Ok(s)
}

pub fn sha256_of_text(text: &str) -> String {
    sha256_hex(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "journal-chain-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn open_append_verify_and_reopen() {
        let dir = fresh();
        {
            let mut chain = Chain::open(&dir, None).unwrap();
            assert_eq!(chain.head_seq(), -1);
            assert!(dir.join("anchor.json").exists());
            let r0 = chain
                .append("run.created", json!({"id": "r1", "n": 1}))
                .unwrap();
            let r1 = chain.append("x.intent", json!({"k": [1, 2]})).unwrap();
            assert_eq!(r0.seq, 0);
            assert_eq!(r1.prev_hash, r0.record_hash);
            assert!(
                Chain::open(&dir, None).is_err(),
                "the lock refuses a second writer"
            );
        }
        assert!(!dir.join("journal.lock").exists());
        assert_eq!(
            verify_chain(&dir, None).unwrap(),
            VerifyResult::Ok { count: 2 }
        );
        let chain = Chain::open(&dir, None).unwrap();
        assert_eq!(chain.head_seq(), 1);
        assert_eq!(unresolved_intents(chain.records()).len(), 1);
        let line = read_to_string(&dir.join("journal.jsonl")).unwrap();
        assert!(
            line.starts_with(r#"{"kind":"run.created","payload":{"id":"r1","n":1},"prevHash":""#)
        );
    }

    #[test]
    fn a_torn_tail_is_moved_aside_and_the_chain_reopens() {
        let dir = fresh();
        {
            let mut chain = Chain::open(&dir, Some("decisions")).unwrap();
            chain.append("a", json!(1)).unwrap();
        }
        let mut f = OpenOptions::new()
            .append(true)
            .open(dir.join("decisions.jsonl"))
            .unwrap();
        f.write_all(b"{\"seq\":1,\"partial").unwrap();
        drop(f);
        let chain = Chain::open(&dir, Some("decisions")).unwrap();
        assert!(chain.torn_recovered);
        assert_eq!(chain.head_seq(), 0);
        assert_eq!(
            read_to_string(&dir.join("decisions.jsonl.torn")).unwrap(),
            "{\"seq\":1,\"partial"
        );
        drop(chain);
        assert_eq!(
            verify_chain(&dir, Some("decisions")).unwrap(),
            VerifyResult::Ok { count: 1 }
        );
    }

    #[test]
    fn verify_names_each_corruption() {
        let dir = fresh();
        {
            let mut chain = Chain::open(&dir, None).unwrap();
            chain.append("a", json!({"v": 1})).unwrap();
            chain.append("b", json!({"v": 2})).unwrap();
        }
        let path = dir.join("journal.jsonl");
        let original = read_to_string(&path).unwrap();
        let lines: Vec<&str> = original.lines().collect();

        fs::write(&path, format!("{}\nnot json\n", lines[0])).unwrap();
        assert_eq!(
            verify_chain(&dir, None).unwrap(),
            VerifyResult::Broken {
                broken_seq: 1,
                reason: "line is not valid JSON".into()
            }
        );

        fs::write(&path, format!("{}\n{}\n", lines[0], lines[0])).unwrap();
        assert_eq!(
            verify_chain(&dir, None).unwrap(),
            VerifyResult::Broken {
                broken_seq: 1,
                reason: "unexpected record shape".into()
            }
        );

        let tampered = lines[1].replace(r#""v":2"#, r#""v":3"#);
        fs::write(&path, format!("{}\n{}\n", lines[0], tampered)).unwrap();
        assert_eq!(
            verify_chain(&dir, None).unwrap(),
            VerifyResult::Broken {
                broken_seq: 1,
                reason: "recordHash does not match its content".into()
            }
        );

        fs::write(&path, format!("{}\n", lines[1])).unwrap();
        assert_eq!(
            verify_chain(&dir, None).unwrap(),
            VerifyResult::Broken {
                broken_seq: 0,
                reason: "unexpected record shape".into()
            }
        );

        let re = regex::Regex::new(r#""prevHash":"[0-9a-f]{64}""#).unwrap();
        let relinked = re
            .replace(
                lines[1],
                format!("\"prevHash\":\"{}\"", "0".repeat(64)).as_str(),
            )
            .into_owned();
        fs::write(&path, format!("{}\n{}\n", lines[0], relinked)).unwrap();
        assert_eq!(
            verify_chain(&dir, None).unwrap(),
            VerifyResult::Broken {
                broken_seq: 1,
                reason: "prevHash does not link to its predecessor".into()
            }
        );
    }

    #[test]
    fn a_non_portable_payload_is_refused_before_disk() {
        let dir = fresh();
        let mut chain = Chain::open(&dir, None).unwrap();
        assert!(chain.append("a", json!({"f": 1.5})).is_err());
        assert_eq!(chain.head_seq(), -1);
        assert_eq!(read_to_string(&dir.join("journal.jsonl")).unwrap(), "");
    }
}
