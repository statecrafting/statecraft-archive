// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Core types for the checkpoint subsystem.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Represents a single file entry in a checkpoint manifest.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    /// Relative path from the repo root.
    pub path: PathBuf,
    /// SHA-256 hash of the raw file content.
    pub content_hash: String,
    /// File size in bytes.
    pub size: u64,
    /// Unix file permissions (e.g. 0o644).
    pub permissions: u32,
    /// Combined hash of content_hash and permissions — used in the Merkle tree.
    pub combined_hash: String,
}

/// Metadata row stored in the `checkpoints` table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointInfo {
    pub checkpoint_id: String,
    pub parent_id: Option<String>,
    pub label: Option<String>,
    pub repo_root: String,
    pub head_sha: Option<String>,
    pub fingerprint: String,
    pub state_hash: String,
    pub merkle_root: String,
    pub file_count: i64,
    pub total_bytes: i64,
    pub created_at: String,
    pub metadata: Option<String>,
    /// Project context for this checkpoint (spec 119).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// Git branch name at checkpoint creation time (spec 095 Slice 3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
    /// Orchestrator run ID for scoping (spec 095 Slice 3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
}

/// Path-level diff between two checkpoints (no line-level detail).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointDiff {
    pub from_id: String,
    pub to_id: String,
    pub added: Vec<String>,
    pub modified: Vec<String>,
    pub deleted: Vec<String>,
}

/// A contiguous block of line changes within a file diff.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffHunk {
    /// Starting line in the old file (1-based).
    pub from_line: usize,
    /// Starting line in the new file (1-based).
    pub to_line: usize,
    /// Lines prefixed with `+`, `-`, or ` ` (space for context).
    pub lines: Vec<String>,
}

/// Line-level diff for a single file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiff {
    pub path: String,
    pub hunks: Vec<DiffHunk>,
    pub lines_added: usize,
    pub lines_deleted: usize,
}

/// A node in the checkpoint timeline graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineNode {
    pub checkpoint_id: String,
    pub parent_id: Option<String>,
    pub label: Option<String>,
    pub created_at: String,
    /// IDs of direct child checkpoints.
    pub children: Vec<String>,
    /// Whether this is the most-recently-created checkpoint.
    pub is_current: bool,
    /// Git HEAD SHA at creation time (spec 095).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head_sha: Option<String>,
    /// Git branch name (spec 095 Slice 3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,
    /// Run ID (spec 095 Slice 3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
}

/// Result of a garbage-collection pass.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GcResult {
    pub objects_removed: usize,
    pub bytes_freed: u64,
}
