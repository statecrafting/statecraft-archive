// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use std::path::PathBuf;

use thiserror::Error;

use crate::types::StageId;

#[derive(Debug, Error)]
pub enum PipelineError {
    #[error("io error at {path:?}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("yaml serialization error: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("stage {stage:?} failed: {reason}")]
    StageFailed { stage: StageId, reason: String },

    #[error("project root {0:?} does not exist or is not a directory")]
    InvalidProjectRoot(PathBuf),

    #[error("xray scan failed: {0}")]
    XrayScan(String),

    #[error("extraction failed for {path:?}: {reason}")]
    Extraction { path: PathBuf, reason: String },

    #[error("git invocation failed: {0}")]
    Git(String),

    #[error("synthesis failed: {0}")]
    Synthesis(String),

    #[error("promotion failed: {0}")]
    Promotion(String),
}

impl PipelineError {
    pub fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Self::Io {
            path: path.into(),
            source,
        }
    }

    pub fn stage(stage: StageId, reason: impl Into<String>) -> Self {
        Self::StageFailed {
            stage,
            reason: reason.into(),
        }
    }
}
