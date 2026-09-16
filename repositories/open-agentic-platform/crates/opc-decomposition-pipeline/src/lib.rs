// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/165-opc-decomposition-pipeline/spec.md

//! OPC decomposition pipeline.
//!
//! Six-stage producer that turns project evidence into draft specs:
//! 1. Extraction (artifact-extract) — typed knowledge from raw files.
//! 2. Structural fingerprint (xray) — content-addressed shape of the tree.
//! 3. Semantic clustering — conceptual grouping of source files.
//! 4. Call graph (xray) — what-calls-what.
//! 5. Temporal lineage (git) — when each unit appeared.
//! 6. Synthesis — deterministic baseline emitter that satisfies the
//!    spec 161 emission contract (`role: decomposition-origin`,
//!    `provenance:`, declared `kind:`, declared logical units).
//!
//! This is the deterministic backbone landing. The Synthesiser trait
//! permits a later LLM-backed swap without touching stages 1-5; the
//! promotion flow into `<project>/specs/` and the spec-102 governance
//! certificate are tracked as follow-up specs.

pub mod certificate;
pub mod checkpoint;
pub mod embedding_cache;
pub mod error;
pub mod persistence;
pub mod pipeline;
pub mod promotion;
pub mod stages;
pub mod types;

pub use checkpoint::{CheckpointSink, FsCheckpointSink, NoopCheckpointSink};
pub use error::PipelineError;
pub use persistence::{RunDirectory, list_runs, load_run};
pub use pipeline::PipelineRunner;
pub use promotion::{PromotionOutcome, PromotionRequest, promote_spec};
pub use stages::synthesis::{DeterministicSynthesiser, SynthesisInput, Synthesiser};
pub use types::{
    Cluster, DegradedReason, DraftSpecRef, LogicalUnit, PipelineConfig, PipelineRun, Provenance,
    ReferenceEdge, RunId, StageId, StageRecord, StageStatus,
};
