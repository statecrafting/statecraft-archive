// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
//
// Stage 2 — structural fingerprint. Calls `xray::scan_target` over the
// project working tree, computes the `Fingerprint`, persists both
// the full index and the fingerprint summary.

use std::fs;

use chrono::Utc;
use xray::{XrayIndex, fingerprint::Fingerprint, scan_target};

use crate::error::PipelineError;
use crate::persistence::{RunDirectory, hash_stage_dir};
use crate::types::{DegradedReason, PipelineConfig, StageId, StageRecord, StageStatus};

pub fn run(config: &PipelineConfig, run_dir: &RunDirectory) -> Result<StageRecord, PipelineError> {
    let started_at = Utc::now();
    let stage_dir = run_dir.stage_dir(StageId::Fingerprint);

    let index: XrayIndex = scan_target(&config.project_root, None)
        .map_err(|e| PipelineError::XrayScan(e.to_string()))?;
    let fingerprint: Fingerprint = xray::fingerprint::generate_fingerprint(&index);

    // Persist the full index (canonical JSON for deterministic hashing)
    // and the fingerprint summary. The fingerprint hash is what spec 161
    // points at via `provenance.kind: code-fingerprint`.
    let index_path = stage_dir.join("index.json");
    let index_bytes = serde_json::to_vec_pretty(&index)?;
    fs::write(&index_path, index_bytes).map_err(|e| PipelineError::io(&index_path, e))?;

    let fp_path = stage_dir.join("fingerprint.json");
    let fp_bytes = serde_json::to_vec_pretty(&fingerprint)?;
    fs::write(&fp_path, fp_bytes).map_err(|e| PipelineError::io(&fp_path, e))?;

    let degraded = if index.stats.file_count == 0 {
        Some(DegradedReason::EmptyProjectTree)
    } else {
        None
    };
    let status = if degraded.is_some() {
        StageStatus::Degraded
    } else {
        StageStatus::Complete
    };

    let content_hash = hash_stage_dir(&stage_dir)?;
    Ok(StageRecord {
        id: StageId::Fingerprint,
        status,
        content_hash,
        output_relpath: StageId::Fingerprint.dir_name(),
        started_at,
        completed_at: Utc::now(),
        degraded,
    })
}

/// Convenience reader: rehydrate the persisted fingerprint for stage 6
/// to consume when constructing `provenance` blocks.
pub fn load_fingerprint(run_dir: &RunDirectory) -> Result<Fingerprint, PipelineError> {
    let path = run_dir.stage_dir(StageId::Fingerprint).join("fingerprint.json");
    let bytes = fs::read(&path).map_err(|e| PipelineError::io(&path, e))?;
    Ok(serde_json::from_slice(&bytes)?)
}

/// Convenience reader for stage 3 / stage 5 which need the file list.
pub fn load_index(run_dir: &RunDirectory) -> Result<XrayIndex, PipelineError> {
    let path = run_dir.stage_dir(StageId::Fingerprint).join("index.json");
    let bytes = fs::read(&path).map_err(|e| PipelineError::io(&path, e))?;
    Ok(serde_json::from_slice(&bytes)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    use crate::types::{PipelineConfig, RunId};

    fn fresh_run_dir(out: &std::path::Path) -> RunDirectory {
        let rid = RunId(String::from("test-fp"));
        let d = RunDirectory::new(out, rid);
        d.ensure().unwrap();
        d
    }

    #[test]
    fn fingerprint_completes_on_small_tree() {
        let project = tempdir().unwrap();
        fs::write(project.path().join("README.md"), "# fixture\n").unwrap();
        fs::write(project.path().join("main.rs"), "fn main(){}\n").unwrap();

        let out = tempdir().unwrap();
        let cfg = PipelineConfig::new(project.path());
        let rd = fresh_run_dir(out.path());
        let rec = run(&cfg, &rd).unwrap();
        assert_eq!(rec.status, StageStatus::Complete);
        let fp = load_fingerprint(&rd).unwrap();
        assert_eq!(fp.hash.len(), 8); // 4 bytes hex
        let idx = load_index(&rd).unwrap();
        assert!(idx.stats.file_count >= 2);
    }
}
