// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
//
// Stage 5 — temporal lineage. Shells out to `git log --follow` per
// file referenced by stage 3's clusters. Emits one JSON record per
// unit under `s5-lineage/lineage.jsonl`.

use std::collections::BTreeSet;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::Command;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::error::PipelineError;
use crate::persistence::{RunDirectory, hash_stage_dir};
use crate::stages::clustering;
use crate::types::{DegradedReason, LogicalUnit, PipelineConfig, StageId, StageRecord, StageStatus};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LineageRecord {
    pub unit: LogicalUnit,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_commit: Option<String>,
    pub churn: u64,
    /// `git`, `unknown`. Set to `unknown` when no `.git` is present
    /// or `git log` produced no output (untracked file).
    pub source: String,
}

pub fn run(config: &PipelineConfig, run_dir: &RunDirectory) -> Result<StageRecord, PipelineError> {
    let started_at = Utc::now();
    let stage_dir = run_dir.stage_dir(StageId::Lineage);
    let out_path = stage_dir.join("lineage.jsonl");

    let git_root_present = config.project_root.join(".git").exists();
    let mut records = Vec::new();
    let mut degraded: Option<DegradedReason> = None;

    let clusters = clustering::load_clusters(run_dir)?;
    // Deduplicate paths across clusters; sort for determinism.
    let mut paths: BTreeSet<String> = BTreeSet::new();
    for c in &clusters.clusters {
        for p in &c.paths {
            paths.insert(p.clone());
        }
    }

    if !git_root_present {
        degraded = Some(DegradedReason::NoGitHistory);
        for p in paths {
            records.push(LineageRecord {
                unit: LogicalUnit { kind: "file".into(), path: p },
                first_commit: None,
                last_commit: None,
                churn: 0,
                source: "unknown".into(),
            });
        }
    } else {
        for p in paths {
            let rec = git_log_for(&config.project_root, &p)?;
            records.push(rec);
        }
    }

    let mut f = fs::File::create(&out_path).map_err(|e| PipelineError::io(&out_path, e))?;
    for r in &records {
        let line = serde_json::to_string(r)?;
        writeln!(f, "{line}").map_err(|e| PipelineError::io(&out_path, e))?;
    }
    drop(f);

    let content_hash = hash_stage_dir(&stage_dir)?;
    let status = if degraded.is_some() {
        StageStatus::Degraded
    } else {
        StageStatus::Complete
    };
    Ok(StageRecord {
        id: StageId::Lineage,
        status,
        content_hash,
        output_relpath: StageId::Lineage.dir_name(),
        started_at,
        completed_at: Utc::now(),
        degraded,
    })
}

fn git_log_for(project_root: &Path, rel_path: &str) -> Result<LineageRecord, PipelineError> {
    // `--reverse` flips chronological order; combined with `--format=%H`
    // we get oldest first, so head() is first_commit and last() is last.
    let out = Command::new("git")
        .arg("-C")
        .arg(project_root)
        .arg("log")
        .arg("--follow")
        .arg("--format=%H")
        .arg(rel_path)
        .output()
        .map_err(|e| PipelineError::Git(format!("spawn failed: {e}")))?;
    let unit = LogicalUnit {
        kind: "file".into(),
        path: rel_path.to_string(),
    };
    if !out.status.success() {
        // File not tracked (e.g., new file in working tree) — common
        // for fresh decomposition runs. Treat as unknown, do not fail.
        return Ok(LineageRecord {
            unit,
            first_commit: None,
            last_commit: None,
            churn: 0,
            source: "unknown".into(),
        });
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let hashes: Vec<&str> = stdout.lines().filter(|l| !l.trim().is_empty()).collect();
    if hashes.is_empty() {
        return Ok(LineageRecord {
            unit,
            first_commit: None,
            last_commit: None,
            churn: 0,
            source: "unknown".into(),
        });
    }
    // git log emits newest first; oldest is the last element.
    let last_commit = Some(hashes.first().copied().unwrap_or_default().to_string());
    let first_commit = Some(hashes.last().copied().unwrap_or_default().to_string());
    Ok(LineageRecord {
        unit,
        first_commit,
        last_commit,
        churn: hashes.len() as u64,
        source: "git".into(),
    })
}

pub fn load_lineage(run_dir: &RunDirectory) -> Result<Vec<LineageRecord>, PipelineError> {
    let path = run_dir.stage_dir(StageId::Lineage).join("lineage.jsonl");
    let s = fs::read_to_string(&path).map_err(|e| PipelineError::io(&path, e))?;
    let mut out = Vec::new();
    for line in s.lines() {
        if line.trim().is_empty() {
            continue;
        }
        out.push(serde_json::from_str(line)?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    use crate::stages::{clustering, fingerprint};
    use crate::types::{PipelineConfig, RunId};

    fn fresh_run_dir(out: &Path) -> RunDirectory {
        let rid = RunId(String::from("test-lineage"));
        let d = RunDirectory::new(out, rid);
        d.ensure().unwrap();
        d
    }

    fn prep(project: &Path, out: &Path) -> (PipelineConfig, RunDirectory) {
        fs::write(project.join("lib.rs"), "fn a(){}\n").unwrap();
        fs::write(project.join("README.md"), "# x").unwrap();
        let cfg = PipelineConfig::new(project);
        let rd = fresh_run_dir(out);
        fingerprint::run(&cfg, &rd).unwrap();
        clustering::run(&cfg, &rd).unwrap();
        (cfg, rd)
    }

    #[test]
    fn degraded_when_no_git() {
        let project = tempdir().unwrap();
        let out = tempdir().unwrap();
        let (cfg, rd) = prep(project.path(), out.path());
        let rec = run(&cfg, &rd).unwrap();
        assert_eq!(rec.status, StageStatus::Degraded);
        assert_eq!(rec.degraded, Some(DegradedReason::NoGitHistory));
        let entries = load_lineage(&rd).unwrap();
        assert!(!entries.is_empty());
        for e in &entries {
            assert_eq!(e.source, "unknown");
            assert_eq!(e.churn, 0);
        }
    }
}
