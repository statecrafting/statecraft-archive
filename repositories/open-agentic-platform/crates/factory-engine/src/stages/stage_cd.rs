// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/122-stakeholder-doc-inversion/spec.md — FR-013 to FR-017

//! Stage CD orchestration shell (spec 122).
//!
//! Stage CD is split into two phases:
//!
//!   * **Phase 1 — candidate generation** (this module). Reads the
//!     Stage 1 BRD and produces `charter.candidate.md` and
//!     `client-document.candidate.md` UNDER THE ARTIFACT STORE ONLY.
//!     Never touches `requirements/stakeholder/*.md`.
//!   * **Phase 2 — comparator** (`stage_cd_comparator.rs`). Pairs
//!     candidate sections to authored sections, classifies each diff
//!     into one of six classes, writes `stage-cd-diff.json`, and
//!     evaluates `QG-CD-01_StakeholderDocAlignment`.
//!
//! Mode detection (FR-014): `seed` when no authored doc exists at the
//! canonical path, `compare` otherwise. `seed` mode runs Phase 1 only,
//! emits `stage-cd-seed-ready`, and does NOT block the gate. `compare`
//! mode runs both phases.
//!
//! Hard invariant (FR-017): Stage CD MUST NOT write to the project
//! workspace under any mode. Authored docs are only modified by an
//! explicit operator `Accept candidate` action (FR-025) or by the
//! migration tool (FR-008). The
//! `compare_mode_does_not_modify_authored_doc_bytes` integration test
//! pins this invariant byte-for-byte.

use crate::agent_resolver::{AgentReference, AgentResolver};
use crate::stages::stage_cd_comparator::{
    self, ComparatorMode, StageCdDiff,
};
use provenance_validator::CorpusEntry;
use chrono::{DateTime, Utc};
use factory_contracts::provenance::anchor_hash;
use factory_contracts::stakeholder_docs::{
    AnchorKind, DocKind, SectionAnchor,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Clone)]
pub struct StageCdInputs {
    pub project: PathBuf,
    pub run_id: String,
    /// Run-scoped artifact store root. The candidate documents and the
    /// `stage-cd-diff.json` artefact land under this directory.
    pub artifact_store: PathBuf,
    /// Stage 1 BRD content. The candidate generator scans `### `
    /// headings and produces matching anchored candidate sections.
    pub brd: String,
    pub now: DateTime<Utc>,
    /// Pre-loaded extraction corpus entries used by Phase 2 for
    /// allowlist derivation + citation re-validation. Empty in seed
    /// mode (Phase 2 doesn't run).
    pub corpus: Vec<CorpusEntry>,
    pub project_name: String,
    pub project_slug: String,
    pub workspace_name: String,
    pub known_owners: Vec<String>,
    /// Optional agent resolver. When supplied along with
    /// `comparator_agent_ref`, the resolver is called before Phase 1
    /// to pin the comparator agent's `content_hash` into the audit
    /// record (spec 123 §8.2, A-8).
    ///
    /// `None` is the safe default: the pipeline runs without agent
    /// identity pinning. Tests that exercise pure comparator logic
    /// leave this unset.
    pub agent_resolver: Option<std::sync::Arc<AgentResolver>>,
    /// The org catalog reference for the Stage CD comparator agent,
    /// if the pipeline binds one (spec 123). Only consulted when
    /// `agent_resolver` is `Some`.
    pub comparator_agent_ref: Option<AgentReference>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StageCdMode {
    Seed,
    Compare,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StageCdEvent {
    /// Seed candidates ready for operator review (FR-015).
    StageCdSeedReady,
    /// Compare mode produced a `stage-cd-diff.json`; gate evaluates
    /// downstream.
    StageCdCompareReady,
    /// Authored docs were present on a prior run and have since been
    /// deleted; this run falls back to seed (FR-015 edge case).
    StageCdModeFallbackToSeed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageCdResult {
    pub mode: StageCdMode,
    pub event: StageCdEvent,
    pub candidate_charter_path: PathBuf,
    pub candidate_client_document_path: PathBuf,
    /// Compare-mode only. `None` in seed mode (FR-015).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_path: Option<PathBuf>,
    /// Spec 123 §8.2 — content hash of the org catalog agent that was
    /// resolved as the comparator agent for this run, if an agent
    /// resolver was supplied in the inputs. Two runs against different
    /// projects but the same org agent will carry byte-identical hashes
    /// here (acceptance criterion A-8).
    ///
    /// `None` when no resolver / agent reference was provided.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_content_hash: Option<String>,
}

#[derive(Debug, Error)]
pub enum StageCdError {
    #[error("io error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("duplicate anchor in authored doc {path}: comparator refuses to run until W-122-003 is resolved")]
    DuplicateAnchor { path: PathBuf },
    #[error("comparator error: {0}")]
    Comparator(String),
    /// Spec 123 §8.2 — the agent resolver failed to resolve the
    /// comparator agent. The pipeline halts rather than running with
    /// an unverified agent identity.
    #[error("agent resolve error: {0}")]
    AgentResolve(String),
}

// ---------------------------------------------------------------------------
// Mode history file — stamps each Stage CD invocation so subsequent
// runs can detect the "authored doc deleted between runs" fallback.
// ---------------------------------------------------------------------------

const MODE_HISTORY_FILENAME: &str = "stage-cd-mode-history.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct StageCdModeHistory {
    /// Last mode the stage ran in for this project, if any.
    last_mode: Option<StageCdMode>,
    /// Run-id that produced `last_mode`.
    last_run_id: Option<String>,
    /// Timestamp of the prior run.
    last_run_at: Option<DateTime<Utc>>,
}

fn history_path(artifact_store: &Path) -> PathBuf {
    artifact_store.join(MODE_HISTORY_FILENAME)
}

fn read_history(artifact_store: &Path) -> StageCdModeHistory {
    let path = history_path(artifact_store);
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_history(
    artifact_store: &Path,
    history: &StageCdModeHistory,
) -> Result<(), StageCdError> {
    let path = history_path(artifact_store);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| StageCdError::Io {
            path: parent.to_path_buf(),
            source: e,
        })?;
    }
    let body = serde_json::to_string_pretty(history).map_err(|e| {
        StageCdError::Io {
            path: path.clone(),
            source: std::io::Error::other(e.to_string()),
        }
    })?;
    fs::write(&path, body).map_err(|e| StageCdError::Io { path, source: e })
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

pub async fn run_stage_cd(inputs: &StageCdInputs) -> Result<StageCdResult, StageCdError> {
    let stakeholder_dir = inputs.project.join("requirements/stakeholder");
    let authored_charter = stakeholder_dir.join(DocKind::Charter.canonical_filename());
    let authored_client = stakeholder_dir.join(DocKind::ClientDocument.canonical_filename());
    let authored_present = authored_charter.is_file() || authored_client.is_file();

    let history = read_history(&inputs.artifact_store);

    let (mode, event) = if !authored_present {
        if matches!(history.last_mode, Some(StageCdMode::Compare)) {
            // Authored docs were present on the prior run, gone now —
            // fallback-to-seed (FR-015 edge case).
            (StageCdMode::Seed, StageCdEvent::StageCdModeFallbackToSeed)
        } else {
            (StageCdMode::Seed, StageCdEvent::StageCdSeedReady)
        }
    } else {
        (StageCdMode::Compare, StageCdEvent::StageCdCompareReady)
    };

    // Spec 123 §8.2 — resolve the comparator agent from the org catalog
    // and pin its content_hash into the audit record BEFORE Phase 1
    // executes. This ensures two runs against different projects but the
    // same org agent record an identical hash (A-8).
    let agent_content_hash: Option<String> =
        match (&inputs.agent_resolver, &inputs.comparator_agent_ref) {
            (Some(resolver), Some(agent_ref)) => {
                let resolved = resolver
                    .resolve(agent_ref.clone())
                    .await
                    .map_err(|e| StageCdError::AgentResolve(e.to_string()))?;
                Some(resolved.content_hash)
            }
            _ => None,
        };

    // Phase 1 — always run, writes ONLY to artifact store.
    let candidate_dir = inputs.artifact_store.join("stage-cd");
    fs::create_dir_all(&candidate_dir).map_err(|e| StageCdError::Io {
        path: candidate_dir.clone(),
        source: e,
    })?;
    let candidate_charter = candidate_dir.join("charter.candidate.md");
    let candidate_client = candidate_dir.join("client-document.candidate.md");

    let charter_body = generate_candidate(
        DocKind::Charter,
        &inputs.brd,
        &inputs.run_id,
        inputs.now,
    );
    let client_body = generate_candidate(
        DocKind::ClientDocument,
        &inputs.brd,
        &inputs.run_id,
        inputs.now,
    );
    write_file(&candidate_charter, &charter_body)?;
    write_file(&candidate_client, &client_body)?;

    // Phase 2 — comparator. In compare mode, runs the (Phase 4) full
    // comparator. In seed mode, FR-015 forbids running Phase 2.
    let diff_path = match mode {
        StageCdMode::Seed => None,
        StageCdMode::Compare => {
            let diff = stage_cd_comparator::run(
                &stage_cd_comparator::ComparatorInputs {
                    project: inputs.project.clone(),
                    artifact_store: inputs.artifact_store.clone(),
                    candidate_charter: candidate_charter.clone(),
                    candidate_client_document: candidate_client.clone(),
                    authored_charter: authored_charter.clone(),
                    authored_client_document: authored_client.clone(),
                    mode: ComparatorMode::Standard,
                    now: inputs.now,
                    corpus: inputs.corpus.clone(),
                    project_name: inputs.project_name.clone(),
                    project_slug: inputs.project_slug.clone(),
                    workspace_name: inputs.workspace_name.clone(),
                    known_owners: inputs.known_owners.clone(),
                },
            )
            .map_err(|e| match e {
                stage_cd_comparator::ComparatorError::DuplicateAnchor {
                    path,
                } => StageCdError::DuplicateAnchor { path },
                other => StageCdError::Comparator(other.to_string()),
            })?;
            Some(write_diff(&inputs.artifact_store, &diff)?)
        }
    };

    let new_history = StageCdModeHistory {
        last_mode: Some(mode),
        last_run_id: Some(inputs.run_id.clone()),
        last_run_at: Some(inputs.now),
    };
    write_history(&inputs.artifact_store, &new_history)?;

    Ok(StageCdResult {
        mode,
        event,
        candidate_charter_path: candidate_charter,
        candidate_client_document_path: candidate_client,
        diff_path,
        agent_content_hash,
    })
}

fn write_diff(
    artifact_store: &Path,
    diff: &StageCdDiff,
) -> Result<PathBuf, StageCdError> {
    let path = artifact_store.join("stage-cd").join("stage-cd-diff.json");
    let body = serde_json::to_string_pretty(diff).map_err(|e| StageCdError::Io {
        path: path.clone(),
        source: std::io::Error::other(e.to_string()),
    })?;
    write_file(&path, &body)?;
    Ok(path)
}

// ---------------------------------------------------------------------------
// Candidate generator
// ---------------------------------------------------------------------------

/// Deterministic Phase 1 candidate generator. Reads the BRD's `###`
/// headings, classifies each heading into an `AnchorKind`, and emits a
/// matching anchored candidate section. Per-anchor index counters are
/// monotonic per kind. The output carries:
///
///   * Frontmatter (`status: draft`, `kind`, `version: 0.0.0`,
///     `runId`).
///   * One section per BRD `### ` heading, with body copied verbatim.
///   * An inline `<!-- anchorHash: sha256:... -->` comment per FR-029
///     so downstream tooling can audit pairing decisions.
///
/// The function is byte-deterministic for a given `(brd, run_id, now)`
/// triple, which Phase 4's byte-determinism property test relies on.
pub fn generate_candidate(
    kind: DocKind,
    brd: &str,
    run_id: &str,
    now: DateTime<Utc>,
) -> String {
    let mut counts: BTreeMap<AnchorKind, u32> = BTreeMap::new();
    let mut sections: Vec<String> = Vec::new();

    let lines: Vec<&str> = brd.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if let Some(rest) = line.strip_prefix("### ") {
            let heading = rest.trim();
            // If the BRD heading itself already has an anchor, copy it
            // through.
            let (anchor, heading_text) =
                if let Some((tok, body)) = heading.split_once(':') {
                    if let Ok(parsed) = tok.trim().parse::<SectionAnchor>() {
                        (parsed, body.trim().to_string())
                    } else {
                        let kind = classify_heading(heading);
                        let next = counts.entry(kind).or_insert(0);
                        *next += 1;
                        (
                            SectionAnchor::new(kind, *next),
                            heading.to_string(),
                        )
                    }
                } else {
                    let kind = classify_heading(heading);
                    let next = counts.entry(kind).or_insert(0);
                    *next += 1;
                    (
                        SectionAnchor::new(kind, *next),
                        heading.to_string(),
                    )
                };

            // Body is everything until the next `### ` heading or
            // end-of-input.
            let mut j = i + 1;
            while j < lines.len() && !lines[j].starts_with("### ") {
                j += 1;
            }
            let body = lines[(i + 1)..j].join("\n");
            let hash = anchor_hash(&heading_text);
            sections.push(format!(
                "### {}: {} <!-- anchorHash: sha256:{} -->\n{}",
                anchor.render(),
                heading_text,
                hash.0,
                body,
            ));
            i = j;
        } else {
            i += 1;
        }
    }

    let kind_str = match kind {
        DocKind::Charter => "charter",
        DocKind::ClientDocument => "client-document",
    };

    let mut out = String::new();
    out.push_str("---\n");
    out.push_str(&format!("kind: {kind_str}\n"));
    out.push_str("status: draft\n");
    out.push_str("owner: factory\n");
    out.push_str("version: \"0.0.0\"\n");
    out.push_str(&format!("runId: {run_id}\n"));
    out.push_str(&format!("generatedAt: {}\n", now.to_rfc3339()));
    out.push_str("---\n\n");
    out.push_str(&format!(
        "# {}\n\n*Generated by Stage CD Phase 1 from the Stage 1 BRD. This is a candidate, not authored truth — review against `requirements/stakeholder/{}` before applying.*\n\n",
        match kind {
            DocKind::Charter => "Project Charter (Candidate)",
            DocKind::ClientDocument => "Client Document (Candidate)",
        },
        kind.canonical_filename(),
    ));
    if sections.is_empty() {
        out.push_str(
            "_BRD contained no `### ` headings; candidate is empty._\n",
        );
    } else {
        for s in sections {
            out.push_str(&s);
            if !out.ends_with('\n') {
                out.push('\n');
            }
            out.push('\n');
        }
    }
    out
}

/// Classify a `### ` heading text into an `AnchorKind`. Mirrors the
/// migration tool's heuristic so a project that runs migration first
/// then Stage CD gets stable anchor pairings.
pub(crate) fn classify_heading(heading: &str) -> AnchorKind {
    let lower = heading.to_lowercase();
    if lower.contains("out of scope")
        || lower.contains("out-of-scope")
        || lower.contains("excluded")
        || lower.contains("not in scope")
    {
        return AnchorKind::OutScope;
    }
    if lower.contains("in scope")
        || lower.contains("in-scope")
        || lower.contains("scope")
    {
        return AnchorKind::InScope;
    }
    if lower.starts_with("objective") || lower.starts_with("goal") {
        return AnchorKind::Obj;
    }
    if lower.starts_with("outcome") {
        return AnchorKind::Outcome;
    }
    if lower.starts_with("stakeholder") {
        return AnchorKind::Stakeholder;
    }
    if lower.starts_with("owner") || lower.starts_with("accountable") {
        return AnchorKind::Owner;
    }
    if lower.starts_with("assumption") {
        return AnchorKind::Assumption;
    }
    if lower.starts_with("risk") {
        return AnchorKind::Risk;
    }
    AnchorKind::Obj
}

// ---------------------------------------------------------------------------
// IO helper
// ---------------------------------------------------------------------------

fn write_file(p: &Path, body: &str) -> Result<(), StageCdError> {
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| StageCdError::Io {
            path: parent.to_path_buf(),
            source: e,
        })?;
    }
    fs::write(p, body).map_err(|e| StageCdError::Io {
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
    use chrono::TimeZone;

    fn fixed_now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 4, 30, 12, 0, 0).unwrap()
    }

    fn example_brd() -> &'static str {
        r#"# BRD

### Objectives

Reduce form-correction cycles by 50%.

### In Scope

Online intake.

### Out of Scope

Payment processing (Finance systems).

### Stakeholders

PMO.
"#
    }

    fn make_inputs(root: &Path) -> StageCdInputs {
        StageCdInputs {
            project: root.to_path_buf(),
            run_id: "run-001".into(),
            artifact_store: root.join("artifact-store/run-001"),
            brd: example_brd().to_string(),
            now: fixed_now(),
            corpus: vec![],
            project_name: "example".into(),
            project_slug: "example".into(),
            workspace_name: "ws".into(),
            known_owners: vec![],
            agent_resolver: None,
            comparator_agent_ref: None,
        }
    }

    #[tokio::test]
    async fn seed_mode_when_authored_absent() {
        let dir = tempfile::tempdir().unwrap();
        let inputs = make_inputs(dir.path());
        let result = run_stage_cd(&inputs).await.unwrap();
        assert_eq!(result.mode, StageCdMode::Seed);
        assert_eq!(result.event, StageCdEvent::StageCdSeedReady);
        assert!(result.diff_path.is_none());
        assert!(result.candidate_charter_path.is_file());
        assert!(result.candidate_client_document_path.is_file());
    }

    #[tokio::test]
    async fn compare_mode_when_authored_present() {
        let dir = tempfile::tempdir().unwrap();
        let stk = dir.path().join("requirements/stakeholder");
        fs::create_dir_all(&stk).unwrap();
        fs::write(
            stk.join("charter.md"),
            r#"---
status: authored
owner: o
version: "1.0.0"
kind: charter
---

### OBJ-1: Reduce cycles

Body.
"#,
        )
        .unwrap();
        let inputs = make_inputs(dir.path());
        let result = run_stage_cd(&inputs).await.unwrap();
        assert_eq!(result.mode, StageCdMode::Compare);
        assert_eq!(result.event, StageCdEvent::StageCdCompareReady);
        assert!(result.diff_path.is_some());
        assert!(result.diff_path.as_ref().unwrap().is_file());
    }

    #[tokio::test]
    async fn fallback_to_seed_when_authored_deleted_between_runs() {
        let dir = tempfile::tempdir().unwrap();
        let stk = dir.path().join("requirements/stakeholder");
        fs::create_dir_all(&stk).unwrap();
        fs::write(
            stk.join("charter.md"),
            r#"---
status: authored
owner: o
version: "1.0.0"
kind: charter
---

### OBJ-1: Cycles

Body.
"#,
        )
        .unwrap();
        let inputs = make_inputs(dir.path());
        let r1 = run_stage_cd(&inputs).await.unwrap();
        assert_eq!(r1.mode, StageCdMode::Compare);

        // Operator deletes authored docs between runs.
        fs::remove_file(stk.join("charter.md")).unwrap();
        let r2 = run_stage_cd(&inputs).await.unwrap();
        assert_eq!(r2.mode, StageCdMode::Seed);
        assert_eq!(r2.event, StageCdEvent::StageCdModeFallbackToSeed);
    }

    /// The structural fix (FR-017): Stage CD MUST NOT write to the
    /// project workspace under any mode. This test pins the bytes of
    /// the authored doc on disk before and after a run and asserts
    /// they are identical down to the byte. A regression here would
    /// reintroduce the contamination amplifier the spec exists to
    /// prevent.
    #[tokio::test]
    async fn compare_mode_does_not_modify_authored_doc_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let stk = dir.path().join("requirements/stakeholder");
        fs::create_dir_all(&stk).unwrap();
        let charter_path = stk.join("charter.md");
        let original_bytes = b"---\nstatus: authored\nowner: o\nversion: \"1.0.0\"\nkind: charter\n---\n\n### OBJ-1: Reduce form-correction cycles\n\nThe applicant must be a registered partner organization.\n";
        fs::write(&charter_path, original_bytes).unwrap();

        let before = fs::read(&charter_path).unwrap();
        let inputs = make_inputs(dir.path());
        run_stage_cd(&inputs).await.unwrap();
        let after = fs::read(&charter_path).unwrap();
        assert_eq!(
            before, after,
            "Stage CD must not mutate the authored doc bytes"
        );
    }

    #[tokio::test]
    async fn seed_mode_does_not_create_anything_under_project_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let inputs = make_inputs(dir.path());
        run_stage_cd(&inputs).await.unwrap();
        // The only top-level dir under the project (other than the
        // artifact store) is `artifact-store/`. No
        // `requirements/stakeholder/` should exist.
        assert!(!dir.path().join("requirements/stakeholder").exists());
        // Candidates must live under the artifact store.
        assert!(dir
            .path()
            .join("artifact-store/run-001/stage-cd/charter.candidate.md")
            .is_file());
    }

    #[tokio::test]
    async fn candidate_carries_anchor_hash_inline() {
        let dir = tempfile::tempdir().unwrap();
        let inputs = make_inputs(dir.path());
        let result = run_stage_cd(&inputs).await.unwrap();
        let charter = fs::read_to_string(&result.candidate_charter_path).unwrap();
        // Each generated heading must carry the inline anchorHash
        // comment per FR-029.
        let count = charter
            .matches("<!-- anchorHash: sha256:")
            .count();
        assert!(
            count >= 4,
            "expected ≥4 anchor headings, got {count}: {charter}"
        );
    }

    /// FR-036 no-reverse-cascade invariant. A change to the authored
    /// stakeholder doc between Stage CD runs MUST NOT trigger any
    /// rewrite of Stage 1 outputs. The cascade is one-way: BRD →
    /// candidate stakeholder docs (FR-016). The authored side never
    /// flows back to Stage 1 unless the operator explicitly re-runs
    /// Stage 1 (FR-037, reserved for a future spec).
    ///
    /// This test pins it byte-for-byte: a synthetic BRD on disk plus
    /// a Stage 1 provenance.json must have identical bytes before and
    /// after multiple Stage CD runs that include an authored-doc
    /// edit between them.
    #[tokio::test]
    async fn authored_doc_edit_between_runs_does_not_modify_stage1_outputs() {
        let dir = tempfile::tempdir().unwrap();
        let stk = dir.path().join("requirements/stakeholder");
        fs::create_dir_all(&stk).unwrap();
        let charter_path = stk.join("charter.md");
        fs::write(
            &charter_path,
            r#"---
status: authored
owner: o
version: "1.0.0"
kind: charter
---

### OBJ-1: Reduce form-correction cycles

The applicant must be a registered partner organization.
"#,
        )
        .unwrap();

        // Synthetic Stage 1 outputs that the BRD-rewriting cascade
        // would touch if FR-036 ever leaked.
        let stage1_dir = dir.path().join("requirements");
        let brd_path =
            stage1_dir.join("business_requirements_document.md");
        let brd_bytes =
            b"# BRD\n\n### Objectives\n\nReduce form-correction cycles by 50%.\n";
        fs::write(&brd_path, brd_bytes).unwrap();
        let prov_path = dir.path().join(".artifacts/provenance.json");
        fs::create_dir_all(prov_path.parent().unwrap()).unwrap();
        let prov_bytes = b"{\"schemaVersion\":\"1.0.0\",\"claims\":[]}";
        fs::write(&prov_path, prov_bytes).unwrap();

        let inputs = make_inputs(dir.path());
        run_stage_cd(&inputs).await.unwrap();
        assert_eq!(fs::read(&brd_path).unwrap(), brd_bytes);
        assert_eq!(fs::read(&prov_path).unwrap(), prov_bytes);

        // Operator edits the authored doc between runs. The next
        // Stage CD run must still leave Stage 1 outputs untouched.
        fs::write(
            &charter_path,
            r#"---
status: authored
owner: o
version: "1.0.0"
kind: charter
---

### OBJ-1: Reduce form-correction cycles

Edited authored body — comparator may now diff this against the
candidate, but Stage 1 outputs MUST NOT be rewritten.
"#,
        )
        .unwrap();
        run_stage_cd(&inputs).await.unwrap();
        assert_eq!(
            fs::read(&brd_path).unwrap(),
            brd_bytes,
            "FR-036 violation: BRD bytes changed after authored-doc edit"
        );
        assert_eq!(
            fs::read(&prov_path).unwrap(),
            prov_bytes,
            "FR-036 violation: Stage 1 provenance.json changed after authored-doc edit"
        );
    }

    #[test]
    fn candidate_generation_is_deterministic() {
        let dir = tempfile::tempdir().unwrap();
        let inputs = make_inputs(dir.path());
        let a = generate_candidate(
            DocKind::Charter,
            &inputs.brd,
            &inputs.run_id,
            inputs.now,
        );
        let b = generate_candidate(
            DocKind::Charter,
            &inputs.brd,
            &inputs.run_id,
            inputs.now,
        );
        assert_eq!(a, b);
    }
}
