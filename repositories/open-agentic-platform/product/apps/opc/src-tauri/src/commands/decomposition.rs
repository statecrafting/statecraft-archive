// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/165-opc-decomposition-pipeline/spec.md
//
// Tauri command surface for the OPC decomposition pipeline.
//
// FR-001: "OPC exposes a 'Decompose project' action at the project
// workspace level." This module exposes the three commands a front-end
// panel needs to wire that action:
//
//   - decomposition_run(project_path, knowledge_bundle, embeddings)
//       Executes the full six-stage pipeline. Synchronous from the
//       caller's perspective — the deterministic backbone runs in
//       seconds on small/medium trees. A future async/streaming
//       surface can wrap this without changing the inputs.
//   - decomposition_list_runs(project_path)
//       Browse prior runs under <project>/.opc/decomposition/.
//   - decomposition_get_run(project_path, run_id)
//       Fetch one run's manifest by id.

use std::path::PathBuf;

use opc_decomposition_pipeline::{
    PipelineConfig, PipelineRun, PipelineRunner, PromotionOutcome, PromotionRequest,
    list_runs as pl_list_runs, load_run as pl_load_run, promote_spec, types::RunId,
};
use tauri::command;

fn opc_decomp_root(project_path: &str) -> PathBuf {
    PathBuf::from(project_path)
        .join(".opc")
        .join("decomposition")
}

/// Execute the spec-165 six-stage pipeline against `project_path`.
///
/// `knowledge_bundle` is an optional absolute path; pass `None` (the
/// empty string from the frontend will resolve to `None`) for the
/// FR-010 degraded extraction path. `embeddings_enabled` requests
/// the fastembed-backed clustering; with the desktop build's default
/// crate features it falls back to the directory-grouping path with
/// `degraded: NoEmbeddingsBackend` on the stage record.
#[command]
pub async fn decomposition_run(
    project_path: String,
    knowledge_bundle: Option<String>,
    embeddings_enabled: Option<bool>,
) -> Result<PipelineRun, String> {
    let project_root = PathBuf::from(&project_path);
    let output_root = opc_decomp_root(&project_path);
    let kb = knowledge_bundle
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);

    let cfg = PipelineConfig {
        project_root,
        knowledge_bundle: kb,
        output_root,
        embeddings_enabled: embeddings_enabled.unwrap_or(false),
    };

    // The deterministic backbone is sync + CPU-bound. Push it to
    // tokio's blocking pool so the Tauri main thread isn't pinned
    // while xray walks the tree.
    tokio::task::spawn_blocking(move || PipelineRunner::new(cfg).run())
        .await
        .map_err(|e| format!("decomposition task panicked: {e}"))?
        .map_err(|e| e.to_string())
}

/// List every decomposition run under `<project>/.opc/decomposition/`.
/// Sort: newest first (the run-id's timestamp prefix is lexically
/// monotonic).
#[command]
pub async fn decomposition_list_runs(project_path: String) -> Result<Vec<PipelineRun>, String> {
    let root = opc_decomp_root(&project_path);
    tokio::task::spawn_blocking(move || pl_list_runs(&root))
        .await
        .map_err(|e| format!("decomposition_list_runs task panicked: {e}"))?
        .map_err(|e| e.to_string())
}

/// Fetch a single run by id. Returns `null` from the frontend's
/// perspective (Option::None) when the run does not exist, when the
/// manifest is missing, or when the manifest fails to parse.
#[command]
pub async fn decomposition_get_run(
    project_path: String,
    run_id: String,
) -> Result<Option<PipelineRun>, String> {
    let root = opc_decomp_root(&project_path);
    let rid = RunId(run_id);
    tokio::task::spawn_blocking(move || pl_load_run(&root, &rid))
        .await
        .map_err(|e| format!("decomposition_get_run task panicked: {e}"))?
        .map_err(|e| e.to_string())
}

/// Promote a staged draft spec into the project's own spec spine (FR-008).
///
/// Writes `<project>/specs/<target_slug>/spec.md` from the staged spec under
/// run `run_id`, recompiles the project's spec registry, and (when
/// `coupling_check_bin` is supplied) runs the coupling gate as a sanity
/// check. `coupling_check_bin` is the path to the project's
/// `spec-code-coupling-check` binary; pass `None`/empty to skip the gate
/// (the recompile remains the primary FR-008 check).
#[command]
pub async fn decomposition_promote(
    project_path: String,
    run_id: String,
    staged_slug: String,
    target_slug: String,
    coupling_check_bin: Option<String>,
) -> Result<PromotionOutcome, String> {
    let project_root = PathBuf::from(&project_path);
    let run_root = opc_decomp_root(&project_path).join(&run_id);
    let req = PromotionRequest {
        project_root,
        run_root,
        staged_slug,
        target_slug,
    };
    let bin = coupling_check_bin
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);

    tokio::task::spawn_blocking(move || promote_spec(&req, bin.as_deref()))
        .await
        .map_err(|e| format!("decomposition_promote task panicked: {e}"))?
        .map_err(|e| e.to_string())
}
