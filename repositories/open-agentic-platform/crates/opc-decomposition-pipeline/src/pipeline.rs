// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Pipeline orchestrator.
//!
//! Walks stages 1 -> 6 in fixed order. Each stage writes its outputs
//! into `<run>/<sN-stage>/` and returns a `StageRecord` summarising
//! status + content hash. The orchestrator collects records, persists
//! the assembled `PipelineRun` manifest, and returns it.

use std::collections::HashMap;
use std::path::PathBuf;

use chrono::Utc;

use crate::checkpoint::{CheckpointSink, FsCheckpointSink};
use crate::error::PipelineError;
use crate::persistence::{self, RunDirectory};
use crate::stages::synthesis::{DeterministicSynthesiser, Synthesiser};
use crate::stages::{callgraph, clustering, extraction, fingerprint, lineage, synthesis};
use crate::types::{
    PIPELINE_RUN_SCHEMA_VERSION, PipelineConfig, PipelineRun, RunId, StageId, StageRecord,
    StageStatus,
};

/// The deterministic, cacheable stages (1-5), in execution order. Stage 6
/// (synthesis) is excluded — it is the synthesis trajectory and always
/// re-runs.
const CACHEABLE_STAGES: [StageId; 5] = [
    StageId::Extraction,
    StageId::Fingerprint,
    StageId::Clustering,
    StageId::CallGraph,
    StageId::Lineage,
];

/// A prior run whose deterministic stages can be reused for the current
/// run (same project, same tree signature, same knowledge signature, same
/// embeddings flag). Carries the prior run's root and its stage records so
/// the reuse path preserves each stage's content hash and degraded reason.
struct ReusablePrior {
    root: PathBuf,
    stage_records: HashMap<StageId, StageRecord>,
}

pub struct PipelineRunner {
    config: PipelineConfig,
    synthesiser: Box<dyn Synthesiser>,
    checkpoint: Box<dyn CheckpointSink>,
}

impl PipelineRunner {
    /// Construct a runner with the default deterministic, CI-safe stage-6
    /// synthesiser and a filesystem branch-of-thought ledger. Use
    /// [`PipelineRunner::with_synthesiser`] / [`PipelineRunner::with_checkpoint`]
    /// to inject alternatives.
    pub fn new(config: PipelineConfig) -> Self {
        let checkpoint = Box::new(FsCheckpointSink::new(config.output_root.clone()));
        Self {
            config,
            synthesiser: Box::new(DeterministicSynthesiser),
            checkpoint,
        }
    }

    /// Construct a runner with an explicit stage-6 synthesiser backend.
    pub fn with_synthesiser(config: PipelineConfig, synthesiser: Box<dyn Synthesiser>) -> Self {
        let checkpoint = Box::new(FsCheckpointSink::new(config.output_root.clone()));
        Self {
            config,
            synthesiser,
            checkpoint,
        }
    }

    /// Inject a branch-of-thought sink (e.g. [`crate::NoopCheckpointSink`] to
    /// disable recording, or an axiomregent-backed sink).
    pub fn with_checkpoint(mut self, checkpoint: Box<dyn CheckpointSink>) -> Self {
        self.checkpoint = checkpoint;
        self
    }

    pub fn config(&self) -> &PipelineConfig {
        &self.config
    }

    /// Execute the full pipeline. Creates the run directory layout,
    /// runs each stage in order, persists the manifest, returns it.
    pub fn run(&self) -> Result<PipelineRun, PipelineError> {
        if !self.config.project_root.is_dir() {
            return Err(PipelineError::InvalidProjectRoot(
                self.config.project_root.clone(),
            ));
        }

        let started_at = Utc::now();
        let run_id = RunId::new(&self.config.project_root, started_at);
        let run_dir = RunDirectory::new(&self.config.output_root, run_id.clone());

        // Cache signatures are cheap (an IO-bound walk + hash); compute
        // them before creating this run's directory so the prior-run scan
        // is unaffected by our own output.
        let tree_signature = persistence::compute_tree_signature(&self.config.project_root)?;
        let knowledge_signature =
            persistence::compute_knowledge_signature(self.config.knowledge_bundle.as_deref())?;
        let reusable = self.find_reusable_prior(&tree_signature, &knowledge_signature)?;

        run_dir.ensure()?;

        let mut stages = Vec::with_capacity(6);
        match &reusable {
            // Unchanged inputs: reuse the deterministic stages from the
            // prior run (FR-007 / SC-004). Only synthesis re-runs.
            Some(prior) => {
                for stage in CACHEABLE_STAGES {
                    stages.push(reuse_cached_stage(prior, &run_dir, stage)?);
                }
            }
            None => {
                stages.push(extraction::run(&self.config, &run_dir)?);
                stages.push(fingerprint::run(&self.config, &run_dir)?);
                stages.push(clustering::run(&self.config, &run_dir)?);
                stages.push(callgraph::run(&self.config, &run_dir)?);
                stages.push(lineage::run(&self.config, &run_dir)?);
            }
        }

        // §2.2: anchor the evidence base (stages 1-5) so each synthesis is a
        // trajectory forked from it. The anchor is keyed by the evidence
        // signature, so re-runs over an unchanged tree fork from the same
        // anchor — the branch-of-thought DAG.
        let evidence_key = format!("{tree_signature}\0{knowledge_signature}");
        let checkpoint_anchor_id = self.checkpoint.anchor(&evidence_key, run_id.as_str())?;

        let synth = synthesis::run(&self.config, &run_dir, self.synthesiser.as_ref())?;
        stages.push(synth.record);
        let emitted_specs = synth.emitted;

        let fork_label = format!("{} @ {}", synth.synthesiser_identity, run_id);
        let checkpoint_trajectory_id =
            self.checkpoint
                .fork(&checkpoint_anchor_id, run_id.as_str(), &fork_label)?;

        let completed_at = Utc::now();
        let manifest = PipelineRun {
            run_id,
            project_root: self.config.project_root.clone(),
            schema_version: PIPELINE_RUN_SCHEMA_VERSION.to_string(),
            started_at,
            completed_at: Some(completed_at),
            stages,
            emitted_specs,
            embeddings_enabled: self.config.embeddings_enabled,
            tree_signature,
            knowledge_signature,
            synthesiser_identity: synth.synthesiser_identity,
            prompt_template_hash: synth.prompt_template_hash,
            checkpoint_anchor_id,
            checkpoint_trajectory_id,
        };
        run_dir.write_manifest(&manifest)?;

        // FR-009: emit a verifiable governance certificate per run, binding
        // the stage outputs, synthesiser identity, and staged spec hashes.
        crate::certificate::emit(&manifest, run_dir.root())?;

        Ok(manifest)
    }

    /// Scan prior runs under the output root for one that can be reused:
    /// same project, matching tree + knowledge signatures, matching
    /// embeddings flag, all deterministic stages present and not failed,
    /// and the stage output directories still on disk. Picks the most
    /// recent such run by `started_at`.
    fn find_reusable_prior(
        &self,
        tree_signature: &str,
        knowledge_signature: &str,
    ) -> Result<Option<ReusablePrior>, PipelineError> {
        let mut candidates: Vec<PipelineRun> = persistence::list_runs(&self.config.output_root)?
            .into_iter()
            .filter(|r| {
                r.project_root == self.config.project_root
                    && !r.tree_signature.is_empty()
                    && r.tree_signature == tree_signature
                    && r.knowledge_signature == knowledge_signature
                    && r.embeddings_enabled == self.config.embeddings_enabled
            })
            .collect();
        // Most recent first.
        candidates.sort_by_key(|r| std::cmp::Reverse(r.started_at));

        for run in candidates {
            let root = self.config.output_root.join(run.run_id.as_str());
            let mut stage_records: HashMap<StageId, StageRecord> = HashMap::new();
            let mut usable = true;
            for stage in CACHEABLE_STAGES {
                let rec = run.stages.iter().find(|s| s.id == stage);
                match rec {
                    Some(r)
                        if r.status != StageStatus::Failed
                            && root.join(stage.dir_name()).is_dir() =>
                    {
                        stage_records.insert(stage, r.clone());
                    }
                    _ => {
                        usable = false;
                        break;
                    }
                }
            }
            if usable {
                return Ok(Some(ReusablePrior {
                    root,
                    stage_records,
                }));
            }
        }
        Ok(None)
    }
}

/// Materialise a cached stage: copy the prior run's stage output into the
/// current run directory and return a `StageRecord` marked `Cached` that
/// preserves the prior content hash and degraded reason (so a cached stage
/// that was originally degraded is still reported as degraded).
fn reuse_cached_stage(
    prior: &ReusablePrior,
    run_dir: &RunDirectory,
    stage: StageId,
) -> Result<StageRecord, PipelineError> {
    let now = Utc::now();
    let src = prior.root.join(stage.dir_name());
    let dst = run_dir.stage_dir(stage);
    persistence::copy_dir_contents(&src, &dst)?;

    let prior_rec = prior
        .stage_records
        .get(&stage)
        .expect("find_reusable_prior guarantees a record for every cacheable stage");
    Ok(StageRecord {
        id: stage,
        status: StageStatus::Cached,
        content_hash: prior_rec.content_hash.clone(),
        output_relpath: stage.dir_name(),
        started_at: now,
        completed_at: now,
        degraded: prior_rec.degraded.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn pipeline_creates_run_layout() {
        let project = tempdir().unwrap();
        let output_root = project.path().join(".opc").join("decomposition");

        // Drop a file so the working tree isn't empty.
        std::fs::write(project.path().join("README.md"), "# fixture").unwrap();

        let cfg = PipelineConfig {
            project_root: project.path().to_path_buf(),
            knowledge_bundle: None,
            output_root: output_root.clone(),
            embeddings_enabled: false,
        };
        let manifest = PipelineRunner::new(cfg).run().expect("pipeline run");
        assert_eq!(manifest.stages.len(), 6);
        assert!(!manifest.run_id.as_str().is_empty());
        assert!(output_root.join(manifest.run_id.as_str()).is_dir());
        assert!(
            output_root
                .join(manifest.run_id.as_str())
                .join("run.json")
                .is_file()
        );
    }
}
