// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use std::fmt;
use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Process-monotonic sequence appended to each `RunId` so two runs that
/// land in the same wall-clock millisecond still get distinct ids (e.g.
/// back-to-back runs in a test or a fast re-synthesis). Reset per process;
/// cross-run ordering is taken from `PipelineRun::started_at`, not the id.
static RUN_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Identifier for a single decomposition run. Format:
/// `YYYYMMDD-HHMMSS-<millis>-<seq>-<8-char hex hash of project_root>`.
/// The timestamp is wall-clock; the hash binds the run to the project so
/// two concurrent runs against different projects don't collide; the
/// millis + process-monotonic seq guarantee uniqueness for rapid re-runs.
/// All components are fixed-width so lexicographic order matches time order
/// within a process.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct RunId(pub String);

impl RunId {
    pub fn new(project_root: &std::path::Path, now: DateTime<Utc>) -> Self {
        use sha2::{Digest, Sha256};
        use std::sync::atomic::Ordering;
        let mut hasher = Sha256::new();
        hasher.update(project_root.to_string_lossy().as_bytes());
        let hash = hex::encode(&hasher.finalize()[..4]);
        let ts = now.format("%Y%m%d-%H%M%S");
        let millis = now.timestamp_subsec_millis();
        let seq = RUN_SEQ.fetch_add(1, Ordering::Relaxed);
        Self(format!("{ts}-{millis:03}-{seq:06}-{hash}"))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for RunId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Stages of the pipeline, in execution order. Variants serialize as
/// the directory name used under `<run>/`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum StageId {
    Extraction,
    Fingerprint,
    Clustering,
    CallGraph,
    Lineage,
    Synthesis,
}

impl StageId {
    /// Order index; lower runs first.
    pub fn index(self) -> u8 {
        match self {
            Self::Extraction => 1,
            Self::Fingerprint => 2,
            Self::Clustering => 3,
            Self::CallGraph => 4,
            Self::Lineage => 5,
            Self::Synthesis => 6,
        }
    }

    /// Directory name relative to the run root, e.g. `s2-fingerprint`.
    pub fn dir_name(self) -> String {
        let slug = match self {
            Self::Extraction => "extraction",
            Self::Fingerprint => "fingerprint",
            Self::Clustering => "clusters",
            Self::CallGraph => "callgraph",
            Self::Lineage => "lineage",
            Self::Synthesis => "synthesis",
        };
        format!("s{}-{}", self.index(), slug)
    }

    pub fn all() -> [StageId; 6] {
        [
            Self::Extraction,
            Self::Fingerprint,
            Self::Clustering,
            Self::CallGraph,
            Self::Lineage,
            Self::Synthesis,
        ]
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StageStatus {
    Pending,
    Complete,
    /// Stage skipped because cached output matched current inputs.
    Cached,
    /// Stage ran successfully but with degraded inputs (see
    /// `DegradedReason`).
    Degraded,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DegradedReason {
    NoKnowledgeBundle,
    NoGitHistory,
    NoEmbeddingsBackend,
    EmptyProjectTree,
    Other(String),
}

/// Per-stage execution record persisted in the run manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StageRecord {
    pub id: StageId,
    pub status: StageStatus,
    /// SHA-256 over the canonical stage output, lowercase hex. Stages
    /// 1-5 are deterministic; the hash is the cache key for re-runs.
    /// Stage 6 hashes the emitted spec files in lexicographic order.
    pub content_hash: String,
    /// Output directory relative to the run root.
    pub output_relpath: String,
    pub started_at: DateTime<Utc>,
    pub completed_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub degraded: Option<DegradedReason>,
}

/// Manifest persisted at `<run>/run.json`. Read by the orchestrator on
/// re-run to decide which stages can be cached (status: Cached).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRun {
    pub run_id: RunId,
    pub project_root: PathBuf,
    pub schema_version: String,
    pub started_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<DateTime<Utc>>,
    pub stages: Vec<StageRecord>,
    pub emitted_specs: Vec<DraftSpecRef>,
    /// Whether `embeddings` feature was enabled when the run executed.
    pub embeddings_enabled: bool,
    /// Content signature of the project working tree (source files only;
    /// `.opc`, `.git`, and build dirs excluded). The cache key for the
    /// tree-dependent stages (2, 4, 5). `#[serde(default)]` so manifests
    /// written before caching landed still deserialize (empty → no hit).
    #[serde(default)]
    pub tree_signature: String,
    /// Content signature of the knowledge bundle (empty when none). The
    /// cache key for stage 1 (extraction).
    #[serde(default)]
    pub knowledge_signature: String,
    /// Identity of the stage-6 synthesiser backend that produced the
    /// emitted specs, e.g. `"deterministic-baseline"`. Bound into the
    /// governance certificate (spec 165 §2.3).
    #[serde(default)]
    pub synthesiser_identity: String,
    /// SHA-256 hex of the synthesiser's prompt template (spec 165 §2.3).
    #[serde(default)]
    pub prompt_template_hash: String,
    /// Branch-of-thought anchor (the evidence base, stages 1-5) this run's
    /// synthesis forked from (spec 165 §2.2). Empty when checkpointing is
    /// disabled (`NoopCheckpointSink`).
    #[serde(default)]
    pub checkpoint_anchor_id: String,
    /// Branch-of-thought trajectory id for this run's synthesis (§2.2).
    #[serde(default)]
    pub checkpoint_trajectory_id: String,
}

pub const PIPELINE_RUN_SCHEMA_VERSION: &str = "0.1.0";

/// Reference to a draft spec emitted by stage 6, persisted in the
/// run manifest for downstream tooling (Tauri commands, promotion).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DraftSpecRef {
    /// e.g. `001-decomposed-from-cluster-3`.
    pub slug: String,
    /// Path to the staged spec.md, relative to the run root.
    pub relpath: String,
    pub content_hash: String,
}

/// Caller-facing configuration. The orchestrator consumes one of these
/// and produces a `PipelineRun`.
#[derive(Debug, Clone)]
pub struct PipelineConfig {
    /// Absolute path to the project working tree to decompose.
    pub project_root: PathBuf,
    /// Optional knowledge bundle directory (e.g. `<project>/.artifacts/raw/`).
    /// `None` triggers the degraded path on stage 1.
    pub knowledge_bundle: Option<PathBuf>,
    /// Where to write `<run_id>/` output directories. Conventionally
    /// `<project>/.opc/decomposition/`.
    pub output_root: PathBuf,
    /// When `true`, stage 3 uses fastembed-backed vector clustering
    /// (requires `embeddings` feature). When `false`, falls back to
    /// directory-based clustering (FR-010 degraded path).
    pub embeddings_enabled: bool,
}

impl PipelineConfig {
    pub fn new(project_root: impl Into<PathBuf>) -> Self {
        let project_root = project_root.into();
        let output_root = project_root.join(".opc").join("decomposition");
        Self {
            project_root,
            knowledge_bundle: None,
            output_root,
            embeddings_enabled: false,
        }
    }

    pub fn with_knowledge_bundle(mut self, path: impl Into<PathBuf>) -> Self {
        self.knowledge_bundle = Some(path.into());
        self
    }

    pub fn with_embeddings(mut self, enabled: bool) -> Self {
        self.embeddings_enabled = enabled;
        self
    }
}

/// Spec 154 logical-unit declaration. Mirrors the grammar accepted by
/// the spec compiler so emitted specs round-trip.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub struct LogicalUnit {
    /// `file`, `directory`, `function`, `region`, etc. Stage 6's
    /// baseline synthesiser emits `directory` or `file`.
    pub kind: String,
    pub path: String,
}

/// Spec 156 provenance grammar. The synthesiser populates this on every
/// `references:` edge it emits (FR-004).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    /// `code-fingerprint`, `knowledge-extraction`, `git-history`, etc.
    pub kind: String,
    /// Lowercase hex SHA-256 over the producing-stage artifact, or the
    /// xray content hash for code-fingerprint provenance.
    pub hash: String,
    /// Stage that produced the referenced artifact, as a kebab-case
    /// stage identifier (`s2-fingerprint`, `s3-clusters`, ...).
    pub produced_by_stage: String,
}

/// Spec 165 §2.1: each emitted spec carries `references:` with
/// `role: decomposition-origin` and a `provenance` block per spec 156.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceEdge {
    pub role: String,
    pub unit: LogicalUnit,
    pub provenance: Provenance,
}

/// One semantic cluster produced by stage 3, persisted as JSON and
/// consumed by stage 6 to seed one draft spec per cluster.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Cluster {
    pub id: String,
    /// Files included in this cluster, sorted.
    pub paths: Vec<String>,
    /// Top-level directory the cluster is rooted at (`crates/foo`,
    /// `tools/bar`, etc.). Used by stage 6 for the spec slug + category.
    pub root_dir: String,
    /// Free-text summary. For the deterministic baseline, this is a
    /// templated sentence (`"Cluster rooted at <dir>, 23 files, 4
    /// modules."`). A future LLM swap replaces this with a model
    /// summary without changing the field shape.
    pub summary: String,
}
