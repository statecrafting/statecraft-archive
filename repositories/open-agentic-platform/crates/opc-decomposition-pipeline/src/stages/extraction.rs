// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
//
// Stage 1 — extraction. Invokes the spec-120 deterministic extractor
// in `artifact-extract` over each file in `config.knowledge_bundle`.
// Outputs:
//   s1-extraction/
//     index.json           # ExtractionIndex (summary)
//     objects/<basename>.json   # per-file ExtractionOutput

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};

use artifact_extract::{
    DETERMINISTIC_TEXT_MIMES, DOCX_MIME, ExtractError, PDF_MIME, extract_deterministic,
};

use crate::error::PipelineError;
use crate::persistence::{RunDirectory, hash_stage_dir};
use crate::types::{DegradedReason, PipelineConfig, StageId, StageRecord, StageStatus};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionIndex {
    pub source_bundle: Option<String>,
    pub objects: Vec<ExtractionEntry>,
    pub counts: ExtractionCounts,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionEntry {
    pub source_relpath: String,
    pub mime: String,
    pub outcome: ExtractionOutcome,
    /// Output JSON written under `objects/`, relative to the stage dir.
    /// `None` when the file was not extracted (RequiresAgent / Error).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_relpath: Option<String>,
    /// Set when outcome != Ok.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ExtractionOutcome {
    Ok,
    RequiresAgent,
    Skipped,
    Error,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionCounts {
    pub ok: u64,
    pub requires_agent: u64,
    pub skipped: u64,
    pub error: u64,
}

pub fn run(config: &PipelineConfig, run_dir: &RunDirectory) -> Result<StageRecord, PipelineError> {
    let started_at = Utc::now();
    let stage_dir = run_dir.stage_dir(StageId::Extraction);
    let objects_dir = stage_dir.join("objects");
    fs::create_dir_all(&objects_dir).map_err(|e| PipelineError::io(&objects_dir, e))?;

    let bundle = match &config.knowledge_bundle {
        Some(b) if b.is_dir() => Some(b.clone()),
        _ => None,
    };

    let mut index = ExtractionIndex {
        source_bundle: bundle.as_ref().map(|p| p.display().to_string()),
        objects: Vec::new(),
        counts: ExtractionCounts::default(),
    };
    let mut degraded: Option<DegradedReason> = None;

    if let Some(bundle_dir) = bundle.as_ref() {
        let mut entries: Vec<PathBuf> = fs::read_dir(bundle_dir)
            .map_err(|e| PipelineError::io(bundle_dir, e))?
            .filter_map(|e| e.ok().map(|d| d.path()))
            .filter(|p| p.is_file())
            .collect();
        entries.sort();

        for path in entries {
            let basename = path
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            let mime = sniff_mime(&path);
            match extract_deterministic(&path, &mime) {
                Ok(output) => {
                    let dst = objects_dir.join(format!("{basename}.json"));
                    let bytes = serde_json::to_vec_pretty(&output)?;
                    fs::write(&dst, bytes).map_err(|e| PipelineError::io(&dst, e))?;
                    index.objects.push(ExtractionEntry {
                        source_relpath: basename.clone(),
                        mime,
                        outcome: ExtractionOutcome::Ok,
                        output_relpath: Some(format!("objects/{basename}.json")),
                        message: None,
                    });
                    index.counts.ok += 1;
                }
                Err(ExtractError::RequiresAgent { reason, .. }) => {
                    index.objects.push(ExtractionEntry {
                        source_relpath: basename,
                        mime,
                        outcome: ExtractionOutcome::RequiresAgent,
                        output_relpath: None,
                        message: Some(reason),
                    });
                    index.counts.requires_agent += 1;
                }
                Err(ExtractError::EmptyInput) => {
                    index.objects.push(ExtractionEntry {
                        source_relpath: basename,
                        mime,
                        outcome: ExtractionOutcome::Skipped,
                        output_relpath: None,
                        message: Some("empty input".into()),
                    });
                    index.counts.skipped += 1;
                }
                Err(e) => {
                    index.objects.push(ExtractionEntry {
                        source_relpath: basename,
                        mime,
                        outcome: ExtractionOutcome::Error,
                        output_relpath: None,
                        message: Some(e.to_string()),
                    });
                    index.counts.error += 1;
                }
            }
        }
    } else {
        degraded = Some(DegradedReason::NoKnowledgeBundle);
    }

    let index_path = stage_dir.join("index.json");
    let bytes = serde_json::to_vec_pretty(&index)?;
    fs::write(&index_path, bytes).map_err(|e| PipelineError::io(&index_path, e))?;

    let content_hash = hash_stage_dir(&stage_dir)?;
    let status = if degraded.is_some() {
        StageStatus::Degraded
    } else {
        StageStatus::Complete
    };
    Ok(StageRecord {
        id: StageId::Extraction,
        status,
        content_hash,
        output_relpath: StageId::Extraction.dir_name(),
        started_at,
        completed_at: Utc::now(),
        degraded,
    })
}

fn sniff_mime(path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());
    let mime: &str = match ext.as_deref() {
        Some("txt") | Some("log") | Some("text") => "text/plain",
        Some("md") | Some("markdown") => "text/markdown",
        Some("json") => "application/json",
        Some("csv") => "text/csv",
        Some("pdf") => PDF_MIME,
        Some("docx") => DOCX_MIME,
        _ => "application/octet-stream",
    };
    debug_assert!(
        !matches!(ext.as_deref(), Some("txt") | Some("log") | Some("text"))
            || DETERMINISTIC_TEXT_MIMES.contains(&mime),
        "text mime drifted from DETERMINISTIC_TEXT_MIMES",
    );
    mime.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    use crate::types::PipelineConfig;

    fn fresh_run_dir(out: &Path) -> RunDirectory {
        let rid = crate::types::RunId(String::from("test-run"));
        let d = RunDirectory::new(out, rid);
        d.ensure().unwrap();
        d
    }

    #[test]
    fn degraded_when_no_bundle() {
        let project = tempdir().unwrap();
        let out = tempdir().unwrap();
        let cfg = PipelineConfig::new(project.path());
        let rd = fresh_run_dir(out.path());
        let rec = run(&cfg, &rd).unwrap();
        assert_eq!(rec.status, StageStatus::Degraded);
        assert_eq!(rec.degraded, Some(DegradedReason::NoKnowledgeBundle));
        let idx_bytes = fs::read(rd.stage_dir(StageId::Extraction).join("index.json")).unwrap();
        let idx: ExtractionIndex = serde_json::from_slice(&idx_bytes).unwrap();
        assert!(idx.objects.is_empty());
    }

    #[test]
    fn extracts_text_files_from_bundle() {
        let bundle = tempdir().unwrap();
        fs::write(bundle.path().join("notes.md"), "# Hello\n\nbody.").unwrap();
        fs::write(bundle.path().join("config.json"), r#"{"k":"v"}"#).unwrap();

        let project = tempdir().unwrap();
        let out = tempdir().unwrap();
        let cfg = PipelineConfig::new(project.path())
            .with_knowledge_bundle(bundle.path().to_path_buf());
        let rd = fresh_run_dir(out.path());
        let rec = run(&cfg, &rd).unwrap();
        assert_eq!(rec.status, StageStatus::Complete);
        let idx_bytes = fs::read(rd.stage_dir(StageId::Extraction).join("index.json")).unwrap();
        let idx: ExtractionIndex = serde_json::from_slice(&idx_bytes).unwrap();
        assert_eq!(idx.counts.ok, 2);
        assert_eq!(idx.counts.requires_agent, 0);
        assert!(rd.stage_dir(StageId::Extraction).join("objects/notes.md.json").is_file());
    }

    #[test]
    fn marks_unsupported_as_requires_agent() {
        let bundle = tempdir().unwrap();
        fs::write(bundle.path().join("image.png"), [0x89, 0x50, 0x4E, 0x47]).unwrap();

        let project = tempdir().unwrap();
        let out = tempdir().unwrap();
        let cfg = PipelineConfig::new(project.path())
            .with_knowledge_bundle(bundle.path().to_path_buf());
        let rd = fresh_run_dir(out.path());
        let rec = run(&cfg, &rd).unwrap();
        assert_eq!(rec.status, StageStatus::Complete);
        let idx_bytes = fs::read(rd.stage_dir(StageId::Extraction).join("index.json")).unwrap();
        let idx: ExtractionIndex = serde_json::from_slice(&idx_bytes).unwrap();
        assert_eq!(idx.counts.requires_agent, 1);
        assert_eq!(idx.objects[0].outcome, ExtractionOutcome::RequiresAgent);
    }
}
