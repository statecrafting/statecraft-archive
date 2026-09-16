// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/165-opc-decomposition-pipeline/spec.md — §2.2 (checkpoint-backed
// branch-of-thought, per spec 095)

//! Branch-of-thought checkpointing for decomposition runs.
//!
//! Spec 165 §2.2: "The pipeline runs as a checkpoint-backed branch-of-thought
//! (per spec 095) so the developer can explore alternative decompositions of
//! the same evidence without committing to one trajectory." Stages 1-5 are the
//! shared evidence base (an *anchor*); each stage-6 synthesis is a *trajectory*
//! forked from that anchor. Re-running over an unchanged tree (the FR-007 cache
//! path) forks a new trajectory from the *same* anchor — that is the DAG.
//!
//! The integration is a trait so the heavy spec-095 [`CheckpointStore`] (async,
//! hiqlite-backed, resident in the axiomregent sidecar process) stays out of
//! this crate's dependency set. The default backend is a self-contained
//! filesystem ledger; an axiomregent-`CheckpointStore`-backed sink is a drop-in
//! behind the same trait.

use std::fs;
use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::PipelineError;

/// Records the branch-of-thought DAG for decomposition runs. `anchor` is
/// idempotent per evidence base; `fork` appends one synthesis trajectory.
pub trait CheckpointSink: Send + Sync {
    /// Anchor the evidence base (stages 1-5 complete) identified by
    /// `evidence_key`. Idempotent: repeated calls for the same evidence
    /// return the same anchor id. Returns the anchor id.
    fn anchor(&self, evidence_key: &str, run_id: &str) -> Result<String, PipelineError>;

    /// Fork a synthesis trajectory from `anchor_id`. Returns the trajectory id.
    fn fork(&self, anchor_id: &str, run_id: &str, label: &str) -> Result<String, PipelineError>;
}

/// No-op sink for callers (and tests) that opt out of branch-of-thought
/// recording. Returns empty ids and touches no filesystem.
#[derive(Debug, Default, Clone, Copy)]
pub struct NoopCheckpointSink;

impl CheckpointSink for NoopCheckpointSink {
    fn anchor(&self, _evidence_key: &str, _run_id: &str) -> Result<String, PipelineError> {
        Ok(String::new())
    }
    fn fork(&self, _anchor_id: &str, _run_id: &str, _label: &str) -> Result<String, PipelineError> {
        Ok(String::new())
    }
}

/// An evidence-base node: stages 1-5 for one content signature.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnchorNode {
    pub id: String,
    pub evidence_key: String,
    pub first_run_id: String,
    pub created_at: DateTime<Utc>,
}

/// One synthesis trajectory forked from an anchor.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrajectoryNode {
    pub id: String,
    pub anchor_id: String,
    pub run_id: String,
    pub label: String,
    pub created_at: DateTime<Utc>,
}

/// The branch-of-thought DAG, persisted as one JSON document.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchOfThought {
    pub anchors: Vec<AnchorNode>,
    pub trajectories: Vec<TrajectoryNode>,
}

/// Filesystem-backed branch-of-thought ledger. Writes a single
/// `branch-of-thought.json` under the decomposition output root, shared
/// across runs of a project so trajectories accumulate into a DAG.
///
/// Concurrency: read-modify-write with last-writer-wins. Concurrent runs of
/// the *same* project could lose a racing trajectory entry; they cannot
/// corrupt the ledger. The OPC desktop drives one decomposition at a time.
pub struct FsCheckpointSink {
    ledger_path: PathBuf,
}

impl FsCheckpointSink {
    /// `output_root` is the decomposition output root
    /// (`<project>/.opc/decomposition/`).
    pub fn new(output_root: impl Into<PathBuf>) -> Self {
        Self {
            ledger_path: output_root.into().join("branch-of-thought.json"),
        }
    }

    pub fn ledger_path(&self) -> &std::path::Path {
        &self.ledger_path
    }

    fn load(&self) -> Result<BranchOfThought, PipelineError> {
        match fs::read(&self.ledger_path) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes).unwrap_or_default()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BranchOfThought::default()),
            Err(e) => Err(PipelineError::io(&self.ledger_path, e)),
        }
    }

    fn store(&self, dag: &BranchOfThought) -> Result<(), PipelineError> {
        if let Some(parent) = self.ledger_path.parent() {
            fs::create_dir_all(parent).map_err(|e| PipelineError::io(parent, e))?;
        }
        let bytes = serde_json::to_vec_pretty(dag)?;
        fs::write(&self.ledger_path, bytes).map_err(|e| PipelineError::io(&self.ledger_path, e))?;
        Ok(())
    }
}

fn short_hash(s: &str) -> String {
    hex::encode(&Sha256::digest(s.as_bytes())[..6])
}

impl CheckpointSink for FsCheckpointSink {
    fn anchor(&self, evidence_key: &str, run_id: &str) -> Result<String, PipelineError> {
        let id = format!("anchor-{}", short_hash(evidence_key));
        let mut dag = self.load()?;
        if !dag.anchors.iter().any(|a| a.id == id) {
            dag.anchors.push(AnchorNode {
                id: id.clone(),
                evidence_key: evidence_key.to_string(),
                first_run_id: run_id.to_string(),
                created_at: Utc::now(),
            });
            self.store(&dag)?;
        }
        Ok(id)
    }

    fn fork(&self, anchor_id: &str, run_id: &str, label: &str) -> Result<String, PipelineError> {
        let id = format!("traj-{}", short_hash(&format!("{anchor_id}:{run_id}")));
        let mut dag = self.load()?;
        if !dag.trajectories.iter().any(|t| t.id == id) {
            dag.trajectories.push(TrajectoryNode {
                id: id.clone(),
                anchor_id: anchor_id.to_string(),
                run_id: run_id.to_string(),
                label: label.to_string(),
                created_at: Utc::now(),
            });
            self.store(&dag)?;
        }
        Ok(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn anchor_is_idempotent_per_evidence() {
        let dir = tempdir().unwrap();
        let sink = FsCheckpointSink::new(dir.path());
        let a1 = sink.anchor("evidence-X", "run-1").unwrap();
        let a2 = sink.anchor("evidence-X", "run-2").unwrap();
        assert_eq!(a1, a2, "same evidence must reuse the anchor");

        let dag: BranchOfThought =
            serde_json::from_slice(&fs::read(sink.ledger_path()).unwrap()).unwrap();
        assert_eq!(dag.anchors.len(), 1);
        assert_eq!(dag.anchors[0].first_run_id, "run-1");
    }

    #[test]
    fn forks_accumulate_into_a_dag() {
        let dir = tempdir().unwrap();
        let sink = FsCheckpointSink::new(dir.path());
        let anchor = sink.anchor("evidence-Y", "run-1").unwrap();
        let t1 = sink.fork(&anchor, "run-1", "deterministic @ run-1").unwrap();
        let t2 = sink.fork(&anchor, "run-2", "deterministic @ run-2").unwrap();
        assert_ne!(t1, t2, "distinct runs are distinct trajectories");

        let dag: BranchOfThought =
            serde_json::from_slice(&fs::read(sink.ledger_path()).unwrap()).unwrap();
        assert_eq!(dag.anchors.len(), 1);
        assert_eq!(dag.trajectories.len(), 2);
        assert!(dag.trajectories.iter().all(|t| t.anchor_id == anchor));
    }

    #[test]
    fn noop_sink_returns_empty_and_writes_nothing() {
        let sink = NoopCheckpointSink;
        assert_eq!(sink.anchor("e", "r").unwrap(), "");
        assert_eq!(sink.fork("a", "r", "l").unwrap(), "");
    }
}
