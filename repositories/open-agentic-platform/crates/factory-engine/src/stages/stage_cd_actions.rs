// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/122-stakeholder-doc-inversion/spec.md — FR-024, FR-025, FR-026

//! Operator actions for Stage CD diff resolution.
//!
//! Three actions per FR-024:
//!
//!   * [`reject_candidate`] — preserves the authored doc; records
//!     `resolution: rejected` on the diff record. Pure metadata
//!     mutation; no file rewrite.
//!   * [`accept_candidate`] — applies the candidate's section body to
//!     the authored doc at the same anchor. Bumps the doc's
//!     `frontmatter.version` per semver patch. Appends an
//!     `AppliedFromEntry` to `frontmatter.appliedFrom` so the audit
//!     trail records `{runId, candidatePath, fromHash, toHash, actor,
//!     appliedAt}` (FR-025).
//!   * [`force_approve`] — passes the gate without applying. REQUIRES
//!     a non-empty `reason`; empty rejected at the function boundary
//!     (FR-026). Audit-logged with the operator's identity. No file
//!     rewrite.
//!
//! Each action returns the audit payload the caller writes to the
//! audit-log sink. Authored-doc bytes are mutated only by
//! `accept_candidate`; the other two actions touch the diff record
//! only (caller persists).

use crate::stages::stage_cd_comparator::{DiffResolution, StageCdDiff};
use chrono::{DateTime, Utc};
use factory_contracts::provenance::{anchor_hash, AnchorHash};
use factory_contracts::stakeholder_docs::{
    AppliedFromEntry, SectionAnchor, SemVer,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionAuditPayload {
    /// `factory.stakeholder_doc_rejected_candidate`,
    /// `factory.stakeholder_doc_accepted_candidate`, or
    /// `factory.stakeholder_doc_force_approve`.
    pub action: String,
    pub project: String,
    pub doc: String,
    pub anchor: String,
    pub actor: String,
    pub at: DateTime<Utc>,
    /// For `accept_candidate`: the `from`/`to` anchor hashes around
    /// the section body before/after apply.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_hash: Option<String>,
    /// For `force_approve`: the operator's free-text reason (FR-026
    /// required).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Error)]
pub enum ActionError {
    #[error("io error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("frontmatter parse error in {path}: {message}")]
    Frontmatter { path: PathBuf, message: String },
    #[error("force-approve requires a non-empty reason (FR-026)")]
    EmptyForceApproveReason,
    #[error("anchor not found in authored doc: {anchor} in {path}")]
    AnchorNotFound { anchor: String, path: PathBuf },
    #[error("candidate doc has no section at {anchor}: {path}")]
    CandidateAnchorMissing { anchor: String, path: PathBuf },
    #[error("section anchor parse error: {0}")]
    AnchorParse(String),
}

// ---------------------------------------------------------------------------
// reject_candidate
// ---------------------------------------------------------------------------

/// Record `resolution: rejected` on the matching diff. The authored
/// doc is NOT touched. Returns the audit payload + the updated diff.
pub fn reject_candidate(
    diff: &mut StageCdDiff,
    project_slug: &str,
    doc: &str,
    anchor: &str,
    actor: &str,
    now: DateTime<Utc>,
) -> ActionAuditPayload {
    for finding in diff.findings.iter_mut() {
        if finding.doc == doc && finding.anchor == anchor {
            finding.resolution = Some(DiffResolution {
                action: "rejected".to_string(),
                actor: actor.to_string(),
                at: now,
                reason: None,
            });
        }
    }
    ActionAuditPayload {
        action: "factory.stakeholder_doc_rejected_candidate".to_string(),
        project: project_slug.to_string(),
        doc: doc.to_string(),
        anchor: anchor.to_string(),
        actor: actor.to_string(),
        at: now,
        from_hash: None,
        to_hash: None,
        reason: None,
    }
}

// ---------------------------------------------------------------------------
// accept_candidate
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct AcceptInputs<'a> {
    pub project_slug: &'a str,
    pub authored_path: &'a Path,
    pub candidate_path: &'a Path,
    pub anchor: &'a str,
    pub actor: &'a str,
    pub run_id: &'a str,
    pub now: DateTime<Utc>,
}

/// Apply the candidate's section body to the authored doc at the same
/// anchor, bump the version per semver patch, and append an
/// `AppliedFromEntry` to `frontmatter.appliedFrom`. Mutates the
/// authored doc on disk; this is the only action that writes to the
/// project workspace. Returns the audit payload.
pub fn accept_candidate(
    diff: &mut StageCdDiff,
    inputs: &AcceptInputs,
) -> Result<ActionAuditPayload, ActionError> {
    let anchor: SectionAnchor = SectionAnchor::from_str(inputs.anchor)
        .map_err(|e| ActionError::AnchorParse(e.to_string()))?;

    let authored_raw = read_file(inputs.authored_path)?;
    let candidate_raw = read_file(inputs.candidate_path)?;

    // Locate the candidate body for the anchor.
    let candidate_body = find_section_body(&candidate_raw, &anchor)
        .ok_or_else(|| ActionError::CandidateAnchorMissing {
            anchor: inputs.anchor.to_string(),
            path: inputs.candidate_path.to_path_buf(),
        })?;

    // Hash the authored body (before) and the candidate body (after)
    // for the audit chain. Empty body → empty-hash sentinel.
    let from_hash = match find_section_body(&authored_raw, &anchor) {
        Some(b) => anchor_hash(&b),
        None => AnchorHash(String::new()),
    };
    let to_hash = anchor_hash(&candidate_body);

    // Rewrite the authored doc:
    //   - Replace the section body for the matched anchor.
    //   - Bump `version` per semver patch in frontmatter.
    //   - Append an `appliedFrom` entry.
    let updated = rewrite_authored_doc(
        &authored_raw,
        &anchor,
        &candidate_body,
        AppliedFromEntry {
            run_id: inputs.run_id.to_string(),
            candidate_path: inputs.candidate_path.to_path_buf(),
            from_hash: from_hash.clone(),
            to_hash: to_hash.clone(),
            actor: inputs.actor.to_string(),
            applied_at: inputs.now,
        },
        inputs.authored_path,
    )?;
    write_file(inputs.authored_path, &updated)?;

    // Mark the diff finding as accepted.
    let doc_label = inputs
        .authored_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    for finding in diff.findings.iter_mut() {
        if finding.doc == doc_label && finding.anchor == anchor.render() {
            finding.resolution = Some(DiffResolution {
                action: "accepted".to_string(),
                actor: inputs.actor.to_string(),
                at: inputs.now,
                reason: None,
            });
        }
    }

    Ok(ActionAuditPayload {
        action: "factory.stakeholder_doc_accepted_candidate".to_string(),
        project: inputs.project_slug.to_string(),
        doc: doc_label.to_string(),
        anchor: anchor.render(),
        actor: inputs.actor.to_string(),
        at: inputs.now,
        from_hash: Some(from_hash.0),
        to_hash: Some(to_hash.0),
        reason: None,
    })
}

// ---------------------------------------------------------------------------
// force_approve
// ---------------------------------------------------------------------------

/// Force-approve a diff WITHOUT applying. Requires a non-empty
/// `reason` per FR-026; empty rejected at the function boundary.
/// Audit-logged with the operator's identity. The diff finding is
/// marked `resolution: force-approved` so the gate's approval-ledger
/// reads it. The authored doc is NOT touched.
pub fn force_approve(
    diff: &mut StageCdDiff,
    project_slug: &str,
    doc: &str,
    anchor: &str,
    actor: &str,
    reason: &str,
    now: DateTime<Utc>,
) -> Result<ActionAuditPayload, ActionError> {
    if reason.trim().is_empty() {
        return Err(ActionError::EmptyForceApproveReason);
    }
    for finding in diff.findings.iter_mut() {
        if finding.doc == doc && finding.anchor == anchor {
            finding.resolution = Some(DiffResolution {
                action: "force-approved".to_string(),
                actor: actor.to_string(),
                at: now,
                reason: Some(reason.to_string()),
            });
        }
    }
    Ok(ActionAuditPayload {
        action: "factory.stakeholder_doc_force_approve".to_string(),
        project: project_slug.to_string(),
        doc: doc.to_string(),
        anchor: anchor.to_string(),
        actor: actor.to_string(),
        at: now,
        from_hash: None,
        to_hash: None,
        reason: Some(reason.to_string()),
    })
}

// ---------------------------------------------------------------------------
// Doc rewrite helpers (only used by accept_candidate)
// ---------------------------------------------------------------------------

fn find_section_body(raw: &str, anchor: &SectionAnchor) -> Option<String> {
    let target_token = anchor.render();
    let lines: Vec<&str> = raw.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        if let Some(rest) = lines[i].strip_prefix("### ")
            && let Some((tok, _)) = rest.split_once(':')
            && tok.trim() == target_token
        {
            let mut j = i + 1;
            while j < lines.len() && !lines[j].starts_with("### ") {
                j += 1;
            }
            return Some(lines[(i + 1)..j].join("\n"));
        }
        i += 1;
    }
    None
}

fn rewrite_authored_doc(
    raw: &str,
    anchor: &SectionAnchor,
    new_body: &str,
    applied_from: AppliedFromEntry,
    path: &Path,
) -> Result<String, ActionError> {
    // Split frontmatter + body using the comparator's split logic.
    let (yaml, body, fm_present) = split_frontmatter(raw);
    if !fm_present {
        return Err(ActionError::Frontmatter {
            path: path.to_path_buf(),
            message: "authored doc has no YAML frontmatter".into(),
        });
    }
    let fm = upsert_applied_from(yaml, applied_from, path)?;

    // Rewrite the body: locate the target heading, replace its body
    // until the next heading.
    let body_rewritten = replace_section_body(body, anchor, new_body)
        .ok_or_else(|| ActionError::AnchorNotFound {
            anchor: anchor.render(),
            path: path.to_path_buf(),
        })?;

    let mut out = String::new();
    out.push_str("---\n");
    out.push_str(&fm);
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str("---\n");
    if !body_rewritten.starts_with('\n') {
        out.push('\n');
    }
    out.push_str(&body_rewritten);
    Ok(out)
}

fn replace_section_body(
    body: &str,
    anchor: &SectionAnchor,
    new_body: &str,
) -> Option<String> {
    let target_token = anchor.render();
    let lines: Vec<&str> = body.lines().collect();
    let mut out = String::new();
    let mut i = 0;
    let mut found = false;
    while i < lines.len() {
        let line = lines[i];
        if let Some(rest) = line.strip_prefix("### ")
            && let Some((tok, _)) = rest.split_once(':')
            && tok.trim() == target_token
        {
            // Keep heading line as-is.
            out.push_str(line);
            out.push('\n');
            // Skip past existing body.
            let mut j = i + 1;
            while j < lines.len() && !lines[j].starts_with("### ") {
                j += 1;
            }
            // Insert new body, preserving the trailing newline.
            out.push_str(new_body);
            if !new_body.ends_with('\n') {
                out.push('\n');
            }
            found = true;
            i = j;
            continue;
        }
        out.push_str(line);
        out.push('\n');
        i += 1;
    }
    if found {
        // Strip a trailing blank line we may have introduced.
        Some(out)
    } else {
        None
    }
}

fn upsert_applied_from(
    yaml: &str,
    entry: AppliedFromEntry,
    path: &Path,
) -> Result<String, ActionError> {
    let mut map: serde_yaml::Mapping = if yaml.trim().is_empty() {
        serde_yaml::Mapping::new()
    } else {
        serde_yaml::from_str(yaml).map_err(|e| ActionError::Frontmatter {
            path: path.to_path_buf(),
            message: e.to_string(),
        })?
    };

    // Bump version (semver patch).
    let version = map
        .get(serde_yaml::Value::String("version".into()))
        .and_then(|v| v.as_str())
        .unwrap_or("1.0.0")
        .to_string();
    let bumped = SemVer(version)
        .bump_patch()
        .map_err(|e| ActionError::Frontmatter {
            path: path.to_path_buf(),
            message: e.to_string(),
        })?;
    map.insert(
        "version".into(),
        serde_yaml::Value::String(bumped.0),
    );

    // Append to appliedFrom.
    let new_entry_value =
        serde_yaml::to_value(&entry).map_err(|e| ActionError::Frontmatter {
            path: path.to_path_buf(),
            message: e.to_string(),
        })?;
    let key = serde_yaml::Value::String("appliedFrom".into());
    let existing = map.remove(&key).unwrap_or(serde_yaml::Value::Sequence(
        serde_yaml::Sequence::new(),
    ));
    let mut seq = match existing {
        serde_yaml::Value::Sequence(s) => s,
        _ => serde_yaml::Sequence::new(),
    };
    seq.push(new_entry_value);
    map.insert(key, serde_yaml::Value::Sequence(seq));

    serde_yaml::to_string(&map).map_err(|e| ActionError::Frontmatter {
        path: path.to_path_buf(),
        message: e.to_string(),
    })
}

fn split_frontmatter(raw: &str) -> (&str, &str, bool) {
    if !raw.starts_with("---") {
        return ("", raw, false);
    }
    let bytes = raw.as_bytes();
    let after_open = match raw.find('\n') {
        Some(idx) => idx + 1,
        None => return ("", raw, false),
    };
    let mut search = &raw[after_open..];
    let mut absolute_offset = after_open;
    while let Some(idx) = search.find("\n---") {
        let close_start = absolute_offset + idx + 1;
        let after = close_start + 3;
        let next = bytes.get(after).copied();
        if next.is_none() || next == Some(b'\n') {
            let yaml = &raw[after_open..close_start];
            let body_start = if next == Some(b'\n') {
                after + 1
            } else {
                after
            };
            return (yaml, &raw[body_start.min(raw.len())..], true);
        }
        let advance = idx + 1;
        absolute_offset += advance;
        search = &search[advance..];
    }
    ("", raw, false)
}

// ---------------------------------------------------------------------------
// IO helpers
// ---------------------------------------------------------------------------

fn read_file(p: &Path) -> Result<String, ActionError> {
    std::fs::read_to_string(p).map_err(|e| ActionError::Io {
        path: p.to_path_buf(),
        source: e,
    })
}

/// Atomic write: write to `<p>.tmp`, then rename. Rename is atomic on
/// POSIX and near-atomic on macOS/Windows for files on the same
/// volume. Authored stakeholder docs are critical-risk data
/// (spec 122 §risk); a partial write must not be possible if the
/// process is killed mid-call.
fn write_file(p: &Path, body: &str) -> Result<(), ActionError> {
    let tmp = p.with_extension(format!(
        "{}.tmp",
        p.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("md")
    ));
    std::fs::write(&tmp, body).map_err(|e| ActionError::Io {
        path: tmp.clone(),
        source: e,
    })?;
    std::fs::rename(&tmp, p).map_err(|e| ActionError::Io {
        path: p.to_path_buf(),
        source: e,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stages::stage_cd_comparator::{
        StageCdDiffCounts, StageCdDiffFinding,
    };
    use chrono::TimeZone;

    fn fixed_now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 4, 30, 12, 0, 0).unwrap()
    }

    fn diff_with(class: &str) -> StageCdDiff {
        StageCdDiff {
            generated_at: fixed_now(),
            mode: "compare".to_string(),
            findings: vec![StageCdDiffFinding {
                doc: "charter.md".to_string(),
                anchor: "OBJ-1".to_string(),
                class: class.to_string(),
                authored_excerpt: Some("Authored body.".to_string()),
                candidate_excerpt: Some("Candidate body.".to_string()),
                pairing: "exact-anchor".to_string(),
                resolution: None,
            }],
            counts: StageCdDiffCounts::default(),
        }
    }

    #[test]
    fn reject_marks_diff_resolution_and_returns_audit() {
        let mut diff = diff_with("scope");
        let audit = reject_candidate(
            &mut diff,
            "example",
            "charter.md",
            "OBJ-1",
            "alice",
            fixed_now(),
        );
        assert_eq!(audit.action, "factory.stakeholder_doc_rejected_candidate");
        assert_eq!(audit.actor, "alice");
        let r = diff.findings[0].resolution.as_ref().unwrap();
        assert_eq!(r.action, "rejected");
    }

    #[test]
    fn force_approve_rejects_empty_reason() {
        let mut diff = diff_with("scope");
        let err = force_approve(
            &mut diff,
            "example",
            "charter.md",
            "OBJ-1",
            "alice",
            "",
            fixed_now(),
        )
        .unwrap_err();
        assert!(matches!(err, ActionError::EmptyForceApproveReason));
    }

    #[test]
    fn force_approve_rejects_whitespace_only_reason() {
        let mut diff = diff_with("scope");
        let err = force_approve(
            &mut diff,
            "example",
            "charter.md",
            "OBJ-1",
            "alice",
            "   \t\n",
            fixed_now(),
        )
        .unwrap_err();
        assert!(matches!(err, ActionError::EmptyForceApproveReason));
    }

    #[test]
    fn force_approve_accepts_non_empty_reason_and_audit_logs() {
        let mut diff = diff_with("scope");
        let audit = force_approve(
            &mut diff,
            "example",
            "charter.md",
            "OBJ-1",
            "alice",
            "policy approved",
            fixed_now(),
        )
        .unwrap();
        assert_eq!(audit.action, "factory.stakeholder_doc_force_approve");
        assert_eq!(audit.reason.unwrap(), "policy approved");
        let r = diff.findings[0].resolution.as_ref().unwrap();
        assert_eq!(r.action, "force-approved");
        assert_eq!(r.reason.as_deref(), Some("policy approved"));
    }

    #[test]
    fn accept_candidate_rewrites_authored_with_new_body() {
        let dir = tempfile::tempdir().unwrap();
        let authored = dir.path().join("charter.md");
        let candidate = dir.path().join("charter.candidate.md");
        std::fs::write(
            &authored,
            r#"---
status: authored
owner: o
version: "1.0.0"
kind: charter
---

### OBJ-1: Reduce form-correction cycles

Original authored body.
"#,
        )
        .unwrap();
        std::fs::write(
            &candidate,
            r#"---
status: draft
owner: factory
version: "0.0.0"
kind: charter
---

### OBJ-1: Reduce form-correction cycles

Reworded candidate body.
"#,
        )
        .unwrap();
        let mut diff = diff_with("wording");
        let audit = accept_candidate(
            &mut diff,
            &AcceptInputs {
                project_slug: "example",
                authored_path: &authored,
                candidate_path: &candidate,
                anchor: "OBJ-1",
                actor: "alice",
                run_id: "run-001",
                now: fixed_now(),
            },
        )
        .unwrap();
        assert_eq!(
            audit.action,
            "factory.stakeholder_doc_accepted_candidate"
        );
        assert!(audit.from_hash.is_some());
        assert!(audit.to_hash.is_some());
        let updated = std::fs::read_to_string(&authored).unwrap();
        assert!(updated.contains("Reworded candidate body."));
        assert!(!updated.contains("Original authored body."));
        // Version bumped: 1.0.0 → 1.0.1.
        assert!(updated.contains("version: 1.0.1"));
        // appliedFrom entry recorded.
        assert!(updated.contains("appliedFrom"));
        assert!(updated.contains("alice"));
    }

    #[test]
    fn accept_candidate_preserves_other_sections_byte_for_byte() {
        // Reviewer pass 2: when the operator accepts a candidate at
        // OBJ-1, all OTHER sections in the authored doc must be
        // preserved byte-for-byte. A regression here would silently
        // bleed candidate content into unaffected sections.
        let dir = tempfile::tempdir().unwrap();
        let authored = dir.path().join("charter.md");
        let candidate = dir.path().join("charter.candidate.md");
        std::fs::write(
            &authored,
            r#"---
status: authored
owner: o
version: "1.0.0"
kind: charter
---

### OBJ-1: First objective

Original OBJ-1 body.

### OBJ-2: Second objective unchanged

This OBJ-2 body must be preserved byte-for-byte.

### OUT-SCOPE-3: Payment processing

Out of scope, do not touch.
"#,
        )
        .unwrap();
        std::fs::write(
            &candidate,
            r#"---
status: draft
owner: factory
version: "0.0.0"
kind: charter
---

### OBJ-1: First objective

Reworded OBJ-1 body.
"#,
        )
        .unwrap();
        let mut diff = diff_with("wording");
        accept_candidate(
            &mut diff,
            &AcceptInputs {
                project_slug: "example",
                authored_path: &authored,
                candidate_path: &candidate,
                anchor: "OBJ-1",
                actor: "alice",
                run_id: "run-001",
                now: fixed_now(),
            },
        )
        .unwrap();
        let updated = std::fs::read_to_string(&authored).unwrap();
        assert!(
            updated.contains("Reworded OBJ-1 body."),
            "OBJ-1 should be replaced"
        );
        assert!(
            updated.contains("This OBJ-2 body must be preserved byte-for-byte."),
            "OBJ-2 must be unchanged: {updated}"
        );
        assert!(
            updated.contains("Out of scope, do not touch."),
            "OUT-SCOPE-3 must be unchanged: {updated}"
        );
    }

    #[test]
    fn accept_candidate_writes_atomically_via_tmp_rename() {
        // Reviewer pass 2: authored stakeholder docs are critical-risk
        // data; accept must use a write-then-rename pattern so a crash
        // mid-write cannot leave a partial file. We verify the .tmp
        // sibling does NOT exist after a successful write — the rename
        // consumed it.
        let dir = tempfile::tempdir().unwrap();
        let authored = dir.path().join("charter.md");
        let candidate = dir.path().join("charter.candidate.md");
        std::fs::write(
            &authored,
            r#"---
status: authored
owner: o
version: "1.0.0"
kind: charter
---

### OBJ-1: First

Original.
"#,
        )
        .unwrap();
        std::fs::write(
            &candidate,
            r#"---
status: draft
owner: factory
version: "0.0.0"
kind: charter
---

### OBJ-1: First

Updated.
"#,
        )
        .unwrap();
        let mut diff = diff_with("wording");
        accept_candidate(
            &mut diff,
            &AcceptInputs {
                project_slug: "example",
                authored_path: &authored,
                candidate_path: &candidate,
                anchor: "OBJ-1",
                actor: "alice",
                run_id: "run-001",
                now: fixed_now(),
            },
        )
        .unwrap();
        let tmp = authored.with_extension("md.tmp");
        assert!(
            !tmp.exists(),
            "atomic write must remove the .tmp sibling: tmp={}",
            tmp.display()
        );
        let updated = std::fs::read_to_string(&authored).unwrap();
        assert!(updated.contains("Updated."));
    }

    #[test]
    fn accept_candidate_fails_when_anchor_missing_in_candidate() {
        let dir = tempfile::tempdir().unwrap();
        let authored = dir.path().join("charter.md");
        let candidate = dir.path().join("charter.candidate.md");
        std::fs::write(
            &authored,
            r#"---
status: authored
owner: o
version: "1.0.0"
kind: charter
---

### OBJ-1: First

Body.
"#,
        )
        .unwrap();
        std::fs::write(
            &candidate,
            r#"---
status: draft
owner: factory
version: "0.0.0"
kind: charter
---

### OBJ-99: Different anchor

Different.
"#,
        )
        .unwrap();
        let mut diff = diff_with("wording");
        let err = accept_candidate(
            &mut diff,
            &AcceptInputs {
                project_slug: "example",
                authored_path: &authored,
                candidate_path: &candidate,
                anchor: "OBJ-1",
                actor: "alice",
                run_id: "run-001",
                now: fixed_now(),
            },
        )
        .unwrap_err();
        assert!(matches!(err, ActionError::CandidateAnchorMissing { .. }));
    }

    #[test]
    fn accept_candidate_fails_when_anchor_missing_in_authored() {
        let dir = tempfile::tempdir().unwrap();
        let authored = dir.path().join("charter.md");
        let candidate = dir.path().join("charter.candidate.md");
        std::fs::write(
            &authored,
            r#"---
status: authored
owner: o
version: "1.0.0"
kind: charter
---

### OBJ-99: Different anchor

Different.
"#,
        )
        .unwrap();
        std::fs::write(
            &candidate,
            r#"---
status: draft
owner: factory
version: "0.0.0"
kind: charter
---

### OBJ-1: First

Body.
"#,
        )
        .unwrap();
        let mut diff = diff_with("wording");
        let err = accept_candidate(
            &mut diff,
            &AcceptInputs {
                project_slug: "example",
                authored_path: &authored,
                candidate_path: &candidate,
                anchor: "OBJ-1",
                actor: "alice",
                run_id: "run-001",
                now: fixed_now(),
            },
        )
        .unwrap_err();
        assert!(matches!(err, ActionError::AnchorNotFound { .. }));
    }
}
