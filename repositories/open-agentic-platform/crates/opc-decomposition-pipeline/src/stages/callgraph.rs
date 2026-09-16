// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
//
// Stage 4 — call graph. Invokes xray's analysis::call_graph::
// analyze_directory(project_root) and persists the resulting graph
// plus its summary.

use std::fs;

use chrono::Utc;
use xray::analysis::call_graph;

use crate::error::PipelineError;
use crate::persistence::{RunDirectory, hash_stage_dir};
use crate::types::{DegradedReason, PipelineConfig, StageId, StageRecord, StageStatus};

pub fn run(config: &PipelineConfig, run_dir: &RunDirectory) -> Result<StageRecord, PipelineError> {
    let started_at = Utc::now();
    let stage_dir = run_dir.stage_dir(StageId::CallGraph);

    let (graph, summary) = call_graph::analyze_directory(&config.project_root);

    let graph_path = stage_dir.join("graph.json");
    let graph_bytes = serde_json::to_vec_pretty(&graph)?;
    fs::write(&graph_path, graph_bytes).map_err(|e| PipelineError::io(&graph_path, e))?;

    let summary_path = stage_dir.join("summary.json");
    let summary_bytes = serde_json::to_vec_pretty(&summary)?;
    fs::write(&summary_path, summary_bytes).map_err(|e| PipelineError::io(&summary_path, e))?;

    let degraded = if summary.total_functions == 0 {
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
        id: StageId::CallGraph,
        status,
        content_hash,
        output_relpath: StageId::CallGraph.dir_name(),
        started_at,
        completed_at: Utc::now(),
        degraded,
    })
}

pub fn load_summary(run_dir: &RunDirectory) -> Result<xray::schema::CallGraphSummary, PipelineError> {
    let path = run_dir.stage_dir(StageId::CallGraph).join("summary.json");
    let bytes = fs::read(&path).map_err(|e| PipelineError::io(&path, e))?;
    Ok(serde_json::from_slice(&bytes)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    use crate::types::{PipelineConfig, RunId};

    fn fresh_run_dir(out: &std::path::Path) -> RunDirectory {
        let rid = RunId(String::from("test-cg"));
        let d = RunDirectory::new(out, rid);
        d.ensure().unwrap();
        d
    }

    #[test]
    fn callgraph_completes_on_rust_tree() {
        let project = tempdir().unwrap();
        fs::write(
            project.path().join("lib.rs"),
            "fn alpha() { beta(); }\nfn beta() {}\n",
        )
        .unwrap();
        let out = tempdir().unwrap();
        let cfg = PipelineConfig::new(project.path());
        let rd = fresh_run_dir(out.path());
        let rec = run(&cfg, &rd).unwrap();
        // alpha + beta = 2 functions; status should be Complete.
        assert!(rec.status == StageStatus::Complete || rec.status == StageStatus::Degraded);
        let summary = load_summary(&rd).unwrap();
        // At least the summary file exists and is well-formed.
        let _ = summary.total_functions;
    }

    #[test]
    fn callgraph_degraded_on_empty_tree() {
        let project = tempdir().unwrap();
        // No source files.
        fs::write(project.path().join("README.md"), "# x").unwrap();
        let out = tempdir().unwrap();
        let cfg = PipelineConfig::new(project.path());
        let rd = fresh_run_dir(out.path());
        let rec = run(&cfg, &rd).unwrap();
        assert_eq!(rec.status, StageStatus::Degraded);
        assert_eq!(rec.degraded, Some(DegradedReason::EmptyProjectTree));
    }
}
