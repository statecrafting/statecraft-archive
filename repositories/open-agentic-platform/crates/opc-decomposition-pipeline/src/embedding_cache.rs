// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/192-decomposition-embedding-cache/spec.md

//! Content-addressed on-disk embedding cache for stage-3 clustering.
//!
//! Spec 192: embedding is the dominant cost of the `embeddings`-feature
//! clustering path. This cache stores each embedding under
//! `<output_root>/.embedding-cache/<sha256>.json`, keyed by the embedded
//! content's hash, so unchanged content is never re-embedded across runs.
//! The cache is an optimisation, not a source of truth: a corrupt or
//! unreadable entry is a miss, never a hard failure (FR-003).
//!
//! This type is independent of fastembed, so it is unit-tested without the
//! model; stage 3's `embeddings`-feature path reads through it.

use std::fs;
use std::path::PathBuf;

use sha2::{Digest, Sha256};

use crate::error::PipelineError;

/// On-disk, content-addressed embedding store.
pub struct EmbeddingCache {
    root: PathBuf,
}

impl EmbeddingCache {
    /// `output_root` is the decomposition output root
    /// (`<project>/.opc/decomposition/`); the cache lives in a sibling
    /// `.embedding-cache/` dir there.
    pub fn new(output_root: impl Into<PathBuf>) -> Self {
        Self {
            root: output_root.into().join(".embedding-cache"),
        }
    }

    /// SHA-256 hex of the embedded content — the cache key (FR-001).
    pub fn key(content: &[u8]) -> String {
        hex::encode(Sha256::digest(content))
    }

    fn entry_path(&self, content_hash: &str) -> PathBuf {
        self.root.join(format!("{content_hash}.json"))
    }

    /// Cached embedding for `content_hash`, or `None` on a miss or a
    /// corrupt/unreadable entry (FR-001, FR-003).
    pub fn get(&self, content_hash: &str) -> Option<Vec<f32>> {
        let bytes = fs::read(self.entry_path(content_hash)).ok()?;
        serde_json::from_slice::<Vec<f32>>(&bytes).ok()
    }

    /// Store `vector` under `content_hash` (idempotent; FR-001, FR-002).
    pub fn put(&self, content_hash: &str, vector: &[f32]) -> Result<(), PipelineError> {
        fs::create_dir_all(&self.root).map_err(|e| PipelineError::io(&self.root, e))?;
        let path = self.entry_path(content_hash);
        let bytes = serde_json::to_vec(vector)?;
        fs::write(&path, bytes).map_err(|e| PipelineError::io(&path, e))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn round_trips_a_vector() {
        // SC-001
        let dir = tempdir().unwrap();
        let cache = EmbeddingCache::new(dir.path());
        let key = EmbeddingCache::key(b"fn alpha() {}");
        assert!(cache.get(&key).is_none(), "unknown key is a miss");
        cache.put(&key, &[0.1, 0.2, 0.3]).unwrap();
        assert_eq!(cache.get(&key), Some(vec![0.1, 0.2, 0.3]));
    }

    #[test]
    fn persists_across_instances() {
        // SC-002 — cross-run reuse.
        let dir = tempdir().unwrap();
        let key = EmbeddingCache::key(b"content");
        EmbeddingCache::new(dir.path()).put(&key, &[1.0, 2.0]).unwrap();
        // Fresh instance over the same directory reads the prior entry.
        let reopened = EmbeddingCache::new(dir.path());
        assert_eq!(reopened.get(&key), Some(vec![1.0, 2.0]));
    }

    #[test]
    fn corrupt_entry_is_a_miss_not_an_error() {
        // SC-003
        let dir = tempdir().unwrap();
        let cache = EmbeddingCache::new(dir.path());
        let key = EmbeddingCache::key(b"x");
        cache.put(&key, &[1.0]).unwrap();
        // Corrupt the entry file.
        fs::write(dir.path().join(".embedding-cache").join(format!("{key}.json")), b"not json").unwrap();
        assert!(cache.get(&key).is_none(), "corrupt entry must read as a miss");
    }

    #[test]
    fn distinct_content_distinct_keys() {
        assert_ne!(EmbeddingCache::key(b"a"), EmbeddingCache::key(b"b"));
        assert_eq!(EmbeddingCache::key(b"a"), EmbeddingCache::key(b"a"));
    }
}
