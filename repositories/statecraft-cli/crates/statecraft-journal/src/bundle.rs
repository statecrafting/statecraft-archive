//! The evidence bundle (specs 031 and 039, ported by spec 113 B-4): the
//! redaction policy as data, the pure assembly, the serialized bytes, the
//! structural parse, and the offline verifier that shares no code with the
//! writer.

use std::collections::BTreeSet;
use std::path::Path;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::canonical::{canonical_string, hash_value, sha256_hex};
use crate::chain::{read_records, verify_chain, JournalRecord, VerifyResult};

// --- the redaction policy (031 B-2) --------------------------------------------

#[derive(Clone, Debug)]
pub struct RedactionPolicy {
    pub version: u64,
    pub included_kinds: Vec<&'static str>,
    pub stripped_fields: Vec<&'static str>,
}

/// 031's policy at version 6 (spec 119 added the denial records and their
/// samples; spec 121 the acceptance records; spec 122 the broker's; spec 125
/// `fence.refused`; spec 128 the scan for a URL carrying userinfo): the kind
/// allowlist and the fields stripped at any depth. Reviewable data; a change
/// is a version bump, mirrored in export.ts.
pub fn redaction_policy() -> RedactionPolicy {
    RedactionPolicy {
        version: 6,
        included_kinds: vec![
            "acceptance.receipt",
            "acceptance.sensitive",
            "acceptance.unstable",
            "broker.action",
            "broker.refused",
            "control.approve",
            "control.forceHumanGate",
            "control.pause",
            "control.resume",
            "control.retryStage",
            "control.reverify",
            "control.reverify.refused",
            "control.skipSpec",
            "dag.adopted",
            "dag.adopted.refreshed",
            "dag.adoption.deferred",
            "decision.sealed",
            "decision.sealed.outcome",
            "fence.refused",
            "quota.parked",
            "quota.resumed",
            "run.created",
            "run.result",
            "session.result",
            "spec.requalified",
            "spec.requalify.failed",
            "spec.requalify.intent",
            "spec.requalify.refused",
            "specexec.created",
            "stage.build.bracket",
            "stage.build.denials",
            "stage.build.gate",
            "stage.build.result",
            "stage.crashed",
            "stage.shepherd.base",
            "stage.shepherd.merge-refused",
            "stage.shepherd.result",
            "stage.ship.result",
            "stage.verify.result",
            "stageexec.created",
            "state.transition.intent",
            "state.transition.outcome",
        ],
        stripped_fields: vec![
            "denialSamples",
            "detail",
            "dirty",
            "error",
            "firstFailure",
            "invalidFiles",
            "parseError",
            "reason",
            "refusalDetail",
            "resultTextTail",
            "samples",
            "stderrTail",
            "stdoutTail",
            "transcriptPath",
        ],
    }
}

/// B-2's value scan: a string that is or embeds an absolute or home path.
pub fn is_private_path_string(value: &str) -> bool {
    let embedded = Regex::new(r"/(Users|home|private|tmp|var)/").unwrap();
    value.starts_with('/')
        || value.starts_with('~')
        || value.contains("~/")
        || embedded.is_match(value)
}

/// 128 B-7: whether the string contains an `http` or `https` URL carrying
/// userinfo. The pattern is candidate.ts's `URL_USERINFO`, spelled so both
/// engines match the same strings: the scheme letter by letter, not `(?i)`,
/// and whitespace as its six ASCII bytes, not `\s`.
pub fn contains_url_userinfo(value: &str) -> bool {
    let userinfo = Regex::new(r"[hH][tT][tT][pP][sS]?://[^ \t\n\r\x0B\x0C/?#@]+@").unwrap();
    userinfo.is_match(value)
}

/// B-2's scan as a whole, since policy version 6: a private path, or a URL
/// carrying userinfo anywhere in the string, withholds the field holding it.
pub fn is_withheld_value_string(value: &str) -> bool {
    is_private_path_string(value) || contains_url_userinfo(value)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RedactedPayload {
    pub payload: Option<Value>,
    pub withheld_payload: bool,
    pub withheld_fields: Vec<String>,
}

struct Scrubbed {
    value: Value,
    bare: bool,
}

fn scrub(value: &Value, stripped: &BTreeSet<&str>, removed: &mut BTreeSet<String>) -> Scrubbed {
    match value {
        Value::String(s) => Scrubbed {
            value: value.clone(),
            bare: is_withheld_value_string(s),
        },
        Value::Null | Value::Bool(_) | Value::Number(_) => Scrubbed {
            value: value.clone(),
            bare: false,
        },
        Value::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            let mut bare = false;
            for item in items {
                let s = scrub(item, stripped, removed);
                if s.bare {
                    bare = true;
                }
                out.push(s.value);
            }
            Scrubbed {
                value: Value::Array(out),
                bare,
            }
        }
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, v) in map {
                if stripped.contains(key.as_str()) {
                    removed.insert(key.clone());
                    continue;
                }
                let s = scrub(v, stripped, removed);
                if s.bare {
                    removed.insert(key.clone());
                    continue;
                }
                out.insert(key.clone(), s.value);
            }
            Scrubbed {
                value: Value::Object(out),
                bare: false,
            }
        }
    }
}

/// `redactPayload`: kind off the allowlist is hash-only; on it, named fields
/// and private-path values are stripped by name; a bare private-path
/// payload degrades to fully withheld.
pub fn redact_payload(kind: &str, payload: &Value, policy: &RedactionPolicy) -> RedactedPayload {
    if !policy.included_kinds.contains(&kind) {
        return RedactedPayload {
            payload: None,
            withheld_payload: true,
            withheld_fields: Vec::new(),
        };
    }
    let stripped: BTreeSet<&str> = policy.stripped_fields.iter().copied().collect();
    let mut removed = BTreeSet::new();
    let scrubbed = scrub(payload, &stripped, &mut removed);
    if scrubbed.bare {
        return RedactedPayload {
            payload: None,
            withheld_payload: true,
            withheld_fields: Vec::new(),
        };
    }
    RedactedPayload {
        payload: Some(scrubbed.value),
        withheld_payload: false,
        withheld_fields: removed.into_iter().collect(),
    }
}

// --- the attestation (039) --------------------------------------------------------

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundleAttestation {
    pub attested: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attestation_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// 039 D-5's fixed vocabulary of recorded absences.
pub mod attest_absent {
    pub const NOT_RUN: &str = "the export ran no attest";
    pub const NOT_SELF_HOSTED: &str = "the export ran outside the exported project's checkout";
    pub const TOOL_MISSING: &str = "spec-spine is not on PATH";
    pub const TOOL_FAILED: &str = "spec-spine attest --with-coupling failed";
    pub const UNPARSED_OUTPUT: &str =
        "spec-spine attest --with-coupling named no attestation path and hash";
    pub const UNREADABLE: &str = "the attestation document spec-spine named could not be read";
    pub const HASH_MISMATCH: &str =
        "the attestation document did not match the hash spec-spine minted";
}

pub fn attestation_absent(reason: &str) -> BundleAttestation {
    BundleAttestation {
        attested: false,
        document: None,
        attestation_hash: None,
        reason: Some(reason.to_string()),
    }
}

/// `runCorpusAttest`: `spec-spine attest --with-coupling --repo <dir>`, the
/// document copied as opaque bytes, every failure a recorded absence.
pub fn run_corpus_attest(repo_dir: &Path) -> BundleAttestation {
    let output = match std::process::Command::new("spec-spine")
        .args(["attest", "--with-coupling", "--repo"])
        .arg(repo_dir)
        .output()
    {
        Ok(o) => o,
        Err(_) => return attestation_absent(attest_absent::TOOL_MISSING),
    };
    if !output.status.success() {
        let code = output
            .status
            .code()
            .map(|c| c.to_string())
            .unwrap_or_else(|| "signal".to_string());
        return attestation_absent(&format!("{} (exit {code})", attest_absent::TOOL_FAILED));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let path_re = Regex::new(r"->\s*(\S.*?)\s*$").unwrap();
    let hash_re = Regex::new(r"^\s*attestationHash:\s*([0-9a-f]{64})\s*$").unwrap();
    let mut document_path = None;
    let mut attestation_hash = None;
    for line in stdout.lines() {
        if document_path.is_none() {
            if let Some(c) = path_re.captures(line) {
                document_path = Some(c[1].to_string());
            }
        }
        if attestation_hash.is_none() {
            if let Some(c) = hash_re.captures(line) {
                attestation_hash = Some(c[1].to_string());
            }
        }
    }
    let (Some(path), Some(hash)) = (document_path, attestation_hash) else {
        return attestation_absent(attest_absent::UNPARSED_OUTPUT);
    };
    let Ok(document) = std::fs::read_to_string(&path) else {
        return attestation_absent(attest_absent::UNREADABLE);
    };
    if sha256_hex(&document) != hash {
        return attestation_absent(attest_absent::HASH_MISMATCH);
    }
    BundleAttestation {
        attested: true,
        document: Some(document),
        attestation_hash: Some(hash),
        reason: None,
    }
}

// --- the bundle shape (031 B-1) ------------------------------------------------------

pub const BUNDLE_FORMAT: &str = "observatory-journal-export";
pub const BUNDLE_FORMAT_VERSION: u64 = 1;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundleRecord {
    pub seq: u64,
    pub ts: String,
    pub kind: String,
    pub prev_hash: String,
    pub record_hash: String,
    pub payload_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    pub withheld_payload: bool,
    pub withheld_fields: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BundleChain {
    pub chain: String,
    pub file: String,
    pub anchor_hash: String,
    pub record_count: u64,
    pub head_record_hash: Option<String>,
    pub records: Vec<BundleRecord>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JournalBundle {
    pub format: String,
    pub format_version: u64,
    pub policy_version: u64,
    pub project: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attestation: Option<BundleAttestation>,
    pub chains: Vec<BundleChain>,
}

pub struct ChainSource {
    pub anchor_hash: String,
    pub records: Vec<JournalRecord>,
}

fn to_bundle_record(record: &JournalRecord, policy: &RedactionPolicy) -> BundleRecord {
    let redacted = redact_payload(&record.kind, &record.payload, policy);
    BundleRecord {
        seq: record.seq,
        ts: record.ts.clone(),
        kind: record.kind.clone(),
        prev_hash: record.prev_hash.clone(),
        record_hash: record.record_hash.clone(),
        payload_hash: hash_value(&record.payload).expect("a chained payload is portable"),
        payload: if redacted.withheld_payload {
            None
        } else {
            redacted.payload
        },
        withheld_payload: redacted.withheld_payload,
        withheld_fields: redacted.withheld_fields,
    }
}

fn to_bundle_chain(
    chain: &str,
    file: &str,
    source: &ChainSource,
    policy: &RedactionPolicy,
) -> BundleChain {
    let records: Vec<BundleRecord> = source
        .records
        .iter()
        .map(|r| to_bundle_record(r, policy))
        .collect();
    BundleChain {
        chain: chain.to_string(),
        file: file.to_string(),
        anchor_hash: source.anchor_hash.clone(),
        record_count: records.len() as u64,
        head_record_hash: records.last().map(|r| r.record_hash.clone()),
        records,
    }
}

/// Pure assembly (031 B-5): same inputs, same bundle.
pub fn build_bundle(
    project: Option<&str>,
    work: &ChainSource,
    decisions: &ChainSource,
    policy: &RedactionPolicy,
    attestation: Option<BundleAttestation>,
) -> JournalBundle {
    JournalBundle {
        format: BUNDLE_FORMAT.to_string(),
        format_version: BUNDLE_FORMAT_VERSION,
        policy_version: policy.version,
        project: project.map(String::from),
        attestation: Some(
            attestation.unwrap_or_else(|| attestation_absent(attest_absent::NOT_RUN)),
        ),
        chains: vec![
            to_bundle_chain("work", "journal.jsonl", work, policy),
            to_bundle_chain("decisions", "decisions.jsonl", decisions, policy),
        ],
    }
}

/// `serializeBundle`: canonical key order, two-space indent, trailing
/// newline, byte-identical to `JSON.stringify(canonicalizeValue(b), null, 2)`.
pub fn serialize_bundle(bundle: &JournalBundle) -> String {
    let value = canonical_keysort_json::canonicalize_value(
        serde_json::to_value(bundle).expect("bundle serializes"),
    );
    let mut out = pretty(&value, 0);
    out.push('\n');
    out
}

// JavaScript's pretty printer with a two-space indent: empty containers
// print as `[]` and `{}`, every other container one item per line.
fn pretty(value: &Value, depth: usize) -> String {
    let pad = "  ".repeat(depth + 1);
    let close = "  ".repeat(depth);
    match value {
        Value::Array(items) if !items.is_empty() => {
            let inner: Vec<String> = items
                .iter()
                .map(|v| format!("{pad}{}", pretty(v, depth + 1)))
                .collect();
            format!("[\n{}\n{close}]", inner.join(",\n"))
        }
        Value::Object(map) if !map.is_empty() => {
            let inner: Vec<String> = map
                .iter()
                .map(|(k, v)| format!("{pad}{}: {}", js_string(k), pretty(v, depth + 1)))
                .collect();
            format!("{{\n{}\n{close}}}", inner.join(",\n"))
        }
        Value::String(s) => js_string(s),
        other => serde_json::to_string(other).expect("scalar serializes"),
    }
}

/// `JSON.stringify` of a string: the same escapes serde_json emits.
fn js_string(s: &str) -> String {
    serde_json::to_string(s).expect("string serializes")
}

/// `exportBundleFromRoot`: read both chains without a lock, refuse a broken
/// one by name, assemble.
pub fn export_from_root(
    state_root: &Path,
    project: Option<&str>,
    policy: &RedactionPolicy,
    attestation: Option<BundleAttestation>,
) -> Result<JournalBundle, String> {
    let work = read_chain_source(state_root, "work", None)?;
    let decisions = read_chain_source(state_root, "decisions", Some("decisions"))?;
    Ok(build_bundle(
        project,
        &work,
        &decisions,
        policy,
        attestation,
    ))
}

fn read_chain_source(
    state_root: &Path,
    chain: &str,
    basename: Option<&str>,
) -> Result<ChainSource, String> {
    let files = crate::chain::chain_files(state_root, basename);
    if !files.anchor.exists() {
        return Err(format!(
            "the {chain} chain has no anchor at {}: nothing to export",
            files.anchor.display()
        ));
    }
    let anchor = crate::chain::read_anchor(&files.anchor)
        .map_err(|e| format!("the {chain} chain's anchor is unreadable: {e}"))?;
    match verify_chain(state_root, basename).map_err(|e| e.to_string())? {
        VerifyResult::Ok { .. } => {}
        VerifyResult::Broken { broken_seq, reason } => {
            return Err(format!(
                "the {chain} chain is broken at seq {broken_seq} ({reason}): refusing to export"
            ))
        }
    }
    let (_, records) = read_records(state_root, basename).map_err(|e| e.to_string())?;
    Ok(ChainSource {
        anchor_hash: anchor.anchor_hash,
        records,
    })
}

// --- parsing a bundle back (031) ---------------------------------------------------------

fn is_bundle_record_shape(v: &Value) -> bool {
    let Some(r) = v.as_object() else { return false };
    r.get("seq").is_some_and(Value::is_u64)
        && r.get("ts").is_some_and(Value::is_string)
        && r.get("kind").is_some_and(Value::is_string)
        && r.get("prevHash").is_some_and(Value::is_string)
        && r.get("recordHash").is_some_and(Value::is_string)
        && r.get("payloadHash").is_some_and(Value::is_string)
        && r.get("withheldPayload").is_some_and(Value::is_boolean)
        && r.get("withheldFields")
            .and_then(Value::as_array)
            .is_some_and(|a| a.iter().all(Value::is_string))
}

fn is_bundle_chain_shape(v: &Value) -> bool {
    let Some(c) = v.as_object() else { return false };
    matches!(
        c.get("chain").and_then(Value::as_str),
        Some("work") | Some("decisions")
    ) && c.get("file").is_some_and(Value::is_string)
        && c.get("anchorHash").is_some_and(Value::is_string)
        && c.get("recordCount").is_some_and(Value::is_u64)
        && c.get("headRecordHash")
            .is_some_and(|h| h.is_null() || h.is_string())
        && c.get("records")
            .and_then(Value::as_array)
            .is_some_and(|a| a.iter().all(is_bundle_record_shape))
}

fn is_attestation_shape(v: &Value) -> bool {
    let Some(a) = v.as_object() else { return false };
    match a.get("attested").and_then(Value::as_bool) {
        Some(true) => {
            a.get("document").is_some_and(Value::is_string)
                && a.get("attestationHash").is_some_and(Value::is_string)
        }
        Some(false) => a.get("reason").is_some_and(Value::is_string),
        None => false,
    }
}

/// Structural validation only, with 031's refusals; whether the content is
/// intact is `verify_bundle`'s question.
pub fn parse_bundle(text: &str) -> Result<JournalBundle, String> {
    let parsed: Value =
        serde_json::from_str(text).map_err(|e| format!("the bundle is not valid JSON: {e}"))?;
    let obj = parsed
        .as_object()
        .ok_or_else(|| "the bundle is not a JSON object".to_string())?;
    if obj.get("format").and_then(Value::as_str) != Some(BUNDLE_FORMAT) {
        return Err(format!(
            "unknown bundle format {}",
            obj.get("format")
                .map(|v| v.to_string())
                .unwrap_or_else(|| "undefined".to_string())
        ));
    }
    if obj.get("formatVersion").and_then(Value::as_u64) != Some(BUNDLE_FORMAT_VERSION) {
        return Err(format!(
            "unsupported bundle format version {} (this binary reads version {BUNDLE_FORMAT_VERSION})",
            obj.get("formatVersion").map(|v| v.to_string()).unwrap_or_else(|| "undefined".to_string())
        ));
    }
    if !obj.get("policyVersion").is_some_and(Value::is_u64) {
        return Err("the bundle carries no integer policyVersion".to_string());
    }
    if !obj
        .get("project")
        .is_some_and(|p| p.is_null() || p.is_string())
    {
        return Err("the bundle's project is neither a string nor null".to_string());
    }
    if let Some(att) = obj.get("attestation") {
        if !is_attestation_shape(att) {
            return Err(
                "the bundle's attestation block is neither an attestation nor a recorded absence"
                    .to_string(),
            );
        }
    }
    let chains = obj.get("chains").and_then(Value::as_array);
    let Some(chains) = chains.filter(|c| c.len() == 2 && c.iter().all(is_bundle_chain_shape))
    else {
        return Err("the bundle does not carry exactly the work and decisions chains".to_string());
    };
    if chains[0]["chain"] != "work" || chains[1]["chain"] != "decisions" {
        return Err("the bundle's chains are not [work, decisions]".to_string());
    }
    serde_json::from_value(parsed).map_err(|e| format!("the bundle does not deserialize: {e}"))
}

// --- offline verification (031 B-3, 039 B-2) -----------------------------------------------

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChainVerification {
    pub chain: String,
    pub records: u64,
    pub payloads_verified: u64,
    pub payloads_redacted: u64,
    pub payloads_withheld: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "ok")]
pub enum BundleVerifyResult {
    #[serde(rename = "true")]
    Ok { chains: Vec<ChainVerification> },
    #[serde(rename = "false")]
    Broken {
        chain: String,
        seq: Option<u64>,
        reason: String,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum AttestationVerification {
    Intact {
        #[serde(rename = "attestationHash")]
        attestation_hash: String,
    },
    Mismatch {
        #[serde(rename = "attestationHash")]
        attestation_hash: String,
        #[serde(rename = "computedHash")]
        computed_hash: String,
    },
    Malformed {
        reason: String,
    },
    Absent {
        reason: String,
    },
}

pub const NO_ATTESTATION_BLOCK: &str = "the bundle predates the attestation block";

pub fn verify_attestation(bundle: &JournalBundle) -> AttestationVerification {
    let Some(att) = &bundle.attestation else {
        return AttestationVerification::Absent {
            reason: NO_ATTESTATION_BLOCK.to_string(),
        };
    };
    if !att.attested {
        return AttestationVerification::Absent {
            reason: att
                .reason
                .clone()
                .unwrap_or_else(|| "no reason recorded".to_string()),
        };
    }
    let (Some(document), Some(hash)) = (&att.document, &att.attestation_hash) else {
        return AttestationVerification::Malformed {
            reason: "the block claims an attestation it does not carry".to_string(),
        };
    };
    let computed = sha256_hex(document);
    if &computed != hash {
        return AttestationVerification::Mismatch {
            attestation_hash: hash.clone(),
            computed_hash: computed,
        };
    }
    AttestationVerification::Intact {
        attestation_hash: hash.clone(),
    }
}

fn fail(chain: &str, seq: Option<u64>, reason: impl Into<String>) -> BundleVerifyResult {
    BundleVerifyResult::Broken {
        chain: chain.to_string(),
        seq,
        reason: reason.into(),
    }
}

/// No daemon, no original journal, no network: link continuity across every
/// record of both chains, full recomputation for every verbatim payload,
/// and an honest three-way count.
pub fn verify_bundle(bundle: &JournalBundle) -> BundleVerifyResult {
    let mut chains = Vec::new();
    for chain in &bundle.chains {
        if chain.records.len() as u64 != chain.record_count {
            return fail(
                &chain.chain,
                None,
                format!(
                    "the chain declares {} records but carries {} (truncated or padded)",
                    chain.record_count,
                    chain.records.len()
                ),
            );
        }
        let (mut verified, mut redacted, mut withheld) = (0u64, 0u64, 0u64);
        let mut prev_hash = chain.anchor_hash.clone();
        for (i, record) in chain.records.iter().enumerate() {
            if record.seq != i as u64 {
                return fail(
                    &chain.chain,
                    Some(record.seq),
                    format!(
                        "record sequence breaks at position {i} (found seq {})",
                        record.seq
                    ),
                );
            }
            if record.prev_hash != prev_hash {
                return fail(
                    &chain.chain,
                    Some(record.seq),
                    "prevHash does not link to its predecessor",
                );
            }
            if record.withheld_payload {
                if record.payload.is_some() {
                    return fail(
                        &chain.chain,
                        Some(record.seq),
                        "a record marked withheld carries a payload",
                    );
                }
                withheld += 1;
            } else {
                let Some(payload) = &record.payload else {
                    return fail(
                        &chain.chain,
                        Some(record.seq),
                        "an included record carries no payload and no withheld annotation",
                    );
                };
                if record.withheld_fields.is_empty() {
                    let payload_hash = match hash_value(payload) {
                        Ok(h) => h,
                        Err(e) => return fail(&chain.chain, Some(record.seq), e.to_string()),
                    };
                    if payload_hash != record.payload_hash {
                        return fail(
                            &chain.chain,
                            Some(record.seq),
                            "included payload does not match its payload hash",
                        );
                    }
                    let recomputed = hash_value(&json!({
                        "seq": record.seq,
                        "ts": record.ts,
                        "kind": record.kind,
                        "payload": payload,
                        "prevHash": record.prev_hash,
                    }))
                    .expect("a hashed payload is portable");
                    if recomputed != record.record_hash {
                        return fail(
                            &chain.chain,
                            Some(record.seq),
                            "recordHash does not match the included record content",
                        );
                    }
                    verified += 1;
                } else {
                    redacted += 1;
                }
            }
            prev_hash = record.record_hash.clone();
        }
        let head = chain.records.last().map(|r| r.record_hash.clone());
        if head != chain.head_record_hash {
            return fail(
                &chain.chain,
                None,
                "the chain head does not match the declared head (truncated tail)",
            );
        }
        chains.push(ChainVerification {
            chain: chain.chain.clone(),
            records: chain.records.len() as u64,
            payloads_verified: verified,
            payloads_redacted: redacted,
            payloads_withheld: withheld,
        });
    }
    BundleVerifyResult::Ok { chains }
}

/// Convenience for callers that only have bytes: the canonical string of a
/// value, for tests comparing against the TypeScript side.
pub fn canonical_of(value: &Value) -> String {
    canonical_string(value).expect("portable")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redaction_strips_named_fields_and_private_paths_and_withholds_unknown_kinds() {
        let policy = redaction_policy();
        let r = redact_payload(
            "session.result",
            &json!({"classification": "completed", "detail": "x", "transcriptPath": "/Users/u/t", "nested": {"path": "/tmp/x", "ok": 1}, "list": ["/home/u"]}),
            &policy,
        );
        assert!(!r.withheld_payload);
        assert_eq!(
            r.withheld_fields,
            // The nested private path strips its own field, not its parent.
            vec!["detail", "list", "path", "transcriptPath"]
        );
        assert_eq!(
            r.payload.unwrap(),
            json!({"classification": "completed", "nested": {"ok": 1}})
        );
        let bare = redact_payload("session.result", &json!("/Users/u"), &policy);
        assert!(bare.withheld_payload);
        let off = redact_payload("run.blocked", &json!({"a": 1}), &policy);
        assert!(off.withheld_payload);
    }

    #[test]
    fn policy_six_withholds_a_string_containing_a_url_with_userinfo() {
        let policy = redaction_policy();
        assert_eq!(policy.version, 6);
        let r = redact_payload(
            "acceptance.receipt",
            &json!({
                "repo": {"origin": "https://x-access-token:ghp_fabricated@github.com/org/repo.git", "keep": "https://github.com/org/repo.git"},
                "suite": {"commands": [["git", "ls-remote", "https://user:secret@example.com/r"]], "digest": "d"},
                "note": "clone from HTTPS://tok@example.com/r",
                "scp": "git@github.com:org/repo.git",
                "query": "https://example.com/path?user=a@b"
            }),
            &policy,
        );
        assert!(!r.withheld_payload);
        // The leaf field is named, not its parent (128 FR-006): `origin`, not `repo`.
        assert_eq!(r.withheld_fields, vec!["commands", "note", "origin"]);
        let text = r.payload.unwrap().to_string();
        assert!(!text.contains("ghp_fabricated"));
        assert!(!text.contains("secret"));
        assert!(text.contains("git@github.com:org/repo.git"));
        assert!(text.contains("https://example.com/path?user=a@b"));
        assert!(!contains_url_userinfo("https://github.com/org/repo.git"));
        assert!(contains_url_userinfo("see https://tok@github.com/x"));
    }

    #[test]
    fn serialize_prints_like_json_stringify_with_two_spaces() {
        let bundle = JournalBundle {
            format: BUNDLE_FORMAT.into(),
            format_version: 1,
            policy_version: 1,
            project: None,
            attestation: Some(attestation_absent(attest_absent::NOT_RUN)),
            chains: vec![BundleChain {
                chain: "work".into(),
                file: "journal.jsonl".into(),
                anchor_hash: "a".into(),
                record_count: 0,
                head_record_hash: None,
                records: vec![],
            }],
        };
        let text = serialize_bundle(&bundle);
        assert!(text.starts_with("{\n  \"attestation\": {\n    \"attested\": false,\n    \"reason\": \"the export ran no attest\"\n  },\n  \"chains\": [\n    {\n      \"anchorHash\": \"a\",\n      \"chain\": \"work\",\n      \"file\": \"journal.jsonl\",\n      \"headRecordHash\": null,\n      \"recordCount\": 0,\n      \"records\": []\n    }\n  ],\n"));
        assert!(text.ends_with("\"project\": null\n}\n"));
    }

    #[test]
    fn parse_refuses_the_031_shapes() {
        assert!(parse_bundle("nope")
            .unwrap_err()
            .starts_with("the bundle is not valid JSON"));
        assert_eq!(
            parse_bundle("[]").unwrap_err(),
            "the bundle is not a JSON object"
        );
        assert_eq!(
            parse_bundle(r#"{"format":"x"}"#).unwrap_err(),
            "unknown bundle format \"x\""
        );
    }
}
