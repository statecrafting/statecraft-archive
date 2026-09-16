// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/082-artifact-integrity-platform-hardening/spec.md — FR-020, FR-021

//! Content-addressable artifact store for cross-run persistence (082 Phase 3).
//!
//! Stores pipeline artifacts by their SHA-256 content hash, enabling
//! deduplication across runs. Layout:
//!
//! ```text
//! <base>/<hash[0..2]>/<hash>/<original_filename>
//! ```
//!
//! The 2-char prefix sharding follows the same pattern as `axiomregent::checkpoint::BlobStore`.

use crate::preflight::hash_file;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Default artifact store location when `OAP_ARTIFACT_STORE` is unset.
pub const DEFAULT_ARTIFACT_STORE: &str = ".oap/artifact-store";

/// Content-addressable artifact store backed by the local filesystem.
pub struct LocalArtifactStore {
    base_dir: PathBuf,
}

/// Metadata about a stored artifact, suitable for recording to the platform.
#[derive(Debug, Clone)]
pub struct StoredArtifact {
    pub content_hash: String,
    pub storage_path: String,
    pub size_bytes: u64,
}

impl LocalArtifactStore {
    /// Create a store rooted at `base_dir`, creating the directory if needed.
    pub fn new(base_dir: impl Into<PathBuf>) -> std::io::Result<Self> {
        let base_dir = base_dir.into();
        std::fs::create_dir_all(&base_dir)?;
        Ok(Self { base_dir })
    }

    /// Create a store from the `OAP_ARTIFACT_STORE` env var, falling back to
    /// `~/.oap/artifact-store`.
    pub fn from_env() -> std::io::Result<Self> {
        let base = std::env::var("OAP_ARTIFACT_STORE")
            .ok()
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(DEFAULT_ARTIFACT_STORE)
            });
        Self::new(base)
    }

    /// Store an artifact file by its content hash.
    ///
    /// If an artifact with the same hash already exists, the write is skipped
    /// (content-addressed deduplication). Returns metadata about the stored artifact.
    pub fn store(&self, source_path: &Path) -> std::io::Result<StoredArtifact> {
        let content_hash = hash_file(source_path)?;
        let size_bytes = std::fs::metadata(source_path)?.len();
        let filename = source_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "artifact".into());

        let target = self.artifact_path(&content_hash, &filename)?;

        if !target.exists() {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            // Atomic write: copy to .tmp, then rename.
            let tmp = target.with_extension("tmp");
            std::fs::copy(source_path, &tmp)?;
            std::fs::rename(&tmp, &target)?;
        }

        Ok(StoredArtifact {
            content_hash,
            storage_path: target.to_string_lossy().to_string(),
            size_bytes,
        })
    }

    /// Store an in-memory byte slice keyed by its SHA-256. Used by the
    /// `s-1-extract` stage (spec 120 FR-011) to write typed extraction-output
    /// JSON without a temp-file round-trip.
    pub fn store_bytes(&self, bytes: &[u8], filename: &str) -> std::io::Result<StoredArtifact> {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        let content_hash = format!("{:x}", hasher.finalize());
        let target = self.artifact_path(&content_hash, filename)?;
        if !target.exists() {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let tmp = target.with_extension("tmp");
            std::fs::write(&tmp, bytes)?;
            std::fs::rename(&tmp, &target)?;
        }
        Ok(StoredArtifact {
            content_hash,
            storage_path: target.to_string_lossy().to_string(),
            size_bytes: bytes.len() as u64,
        })
    }

    /// Record an extraction-output mapping `(object_id, source_content_hash)
    /// → artifact_content_hash` (spec 120 FR-010). The sidecar lives under
    /// `<base>/extract-index/<key[0..2]>/<key>.json` where `key = sha256
    /// (object_id ":" source_content_hash)`. Idempotent: re-recording the
    /// same triple is a no-op if the file already names the same artifact.
    pub fn index_extraction(
        &self,
        object_id: &str,
        source_content_hash: &str,
        artifact_content_hash: &str,
        filename: &str,
    ) -> std::io::Result<()> {
        let path = self.extract_index_path(object_id, source_content_hash);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let payload = serde_json::json!({
            "objectId": object_id,
            "sourceContentHash": source_content_hash,
            "artifactContentHash": artifact_content_hash,
            "filename": filename,
        });
        let bytes = serde_json::to_vec_pretty(&payload).expect("serde_json::to_vec_pretty");
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, &bytes)?;
        std::fs::rename(&tmp, &path)?;
        Ok(())
    }

    /// Look up an extraction-output mapping. Returns
    /// `(artifact_content_hash, filename)` if a record exists.
    pub fn lookup_extraction(
        &self,
        object_id: &str,
        source_content_hash: &str,
    ) -> std::io::Result<Option<(String, String)>> {
        let path = self.extract_index_path(object_id, source_content_hash);
        if !path.exists() {
            return Ok(None);
        }
        let raw = std::fs::read(&path)?;
        let v: serde_json::Value = serde_json::from_slice(&raw).map_err(|e| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, e)
        })?;
        let artifact = v
            .get("artifactContentHash")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let filename = v
            .get("filename")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        Ok(artifact.zip(filename))
    }

    fn extract_index_path(&self, object_id: &str, source_content_hash: &str) -> PathBuf {
        let mut h = Sha256::new();
        h.update(object_id.as_bytes());
        h.update(b":");
        h.update(source_content_hash.as_bytes());
        let key = format!("{:x}", h.finalize());
        let prefix = &key[..2];
        self.base_dir
            .join("extract-index")
            .join(prefix)
            .join(format!("{key}.json"))
    }

    /// Retrieve a stored artifact to the target path.
    ///
    /// Copies the stored file to `target_path`. Returns `false` if the
    /// artifact is not in the store.
    pub fn retrieve(
        &self,
        content_hash: &str,
        filename: &str,
        target_path: &Path,
    ) -> std::io::Result<bool> {
        let source = self.artifact_path(content_hash, filename)?;
        if !source.exists() {
            return Ok(false);
        }
        if let Some(parent) = target_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(&source, target_path)?;
        Ok(true)
    }

    /// Check whether an artifact with this hash exists in the store.
    pub fn exists(&self, content_hash: &str) -> bool {
        if !content_hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return false;
        }
        let prefix = &content_hash[..2.min(content_hash.len())];
        let dir = self.base_dir.join(prefix).join(content_hash);
        dir.exists()
    }

    /// Resolve the storage path for an artifact.
    fn artifact_path(&self, content_hash: &str, filename: &str) -> std::io::Result<PathBuf> {
        if !content_hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "content_hash must contain only hex characters",
            ));
        }
        if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "filename must not contain path separators or '..'",
            ));
        }
        let prefix = &content_hash[..2.min(content_hash.len())];
        Ok(self.base_dir.join(prefix).join(content_hash).join(filename))
    }

    /// Return the base directory for inspection/testing.
    pub fn base_dir(&self) -> &Path {
        &self.base_dir
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn store_and_retrieve() {
        let store_dir = TempDir::new().unwrap();
        let store = LocalArtifactStore::new(store_dir.path()).unwrap();

        // Create a source artifact
        let src_dir = TempDir::new().unwrap();
        let src_path = src_dir.path().join("output.md");
        std::fs::write(&src_path, "# Business Requirements\n\nTest content.").unwrap();

        // Store it
        let stored = store.store(&src_path).unwrap();
        assert_eq!(stored.content_hash.len(), 64);
        assert!(stored.size_bytes > 0);
        assert!(store.exists(&stored.content_hash));

        // Retrieve to a new location
        let dst_dir = TempDir::new().unwrap();
        let dst_path = dst_dir.path().join("retrieved.md");
        assert!(
            store
                .retrieve(&stored.content_hash, "output.md", &dst_path)
                .unwrap()
        );
        assert_eq!(
            std::fs::read_to_string(&dst_path).unwrap(),
            "# Business Requirements\n\nTest content."
        );
    }

    #[test]
    fn deduplication() {
        let store_dir = TempDir::new().unwrap();
        let store = LocalArtifactStore::new(store_dir.path()).unwrap();

        let src_dir = TempDir::new().unwrap();
        let path1 = src_dir.path().join("a.txt");
        let path2 = src_dir.path().join("b.txt");
        std::fs::write(&path1, "same content").unwrap();
        std::fs::write(&path2, "same content").unwrap();

        let stored1 = store.store(&path1).unwrap();
        let stored2 = store.store(&path2).unwrap();

        assert_eq!(stored1.content_hash, stored2.content_hash);
    }

    #[test]
    fn nonexistent_hash() {
        let store_dir = TempDir::new().unwrap();
        let store = LocalArtifactStore::new(store_dir.path()).unwrap();

        assert!(!store.exists("0000000000000000000000000000000000000000000000000000000000000000"));

        let dst = store_dir.path().join("nope.txt");
        assert!(
            !store
                .retrieve(
                    "0000000000000000000000000000000000000000000000000000000000000000",
                    "nope.txt",
                    &dst
                )
                .unwrap()
        );
    }

    #[test]
    fn rejects_path_traversal_in_filename() {
        let store_dir = TempDir::new().unwrap();
        let store = LocalArtifactStore::new(store_dir.path()).unwrap();
        let zero = "0000000000000000000000000000000000000000000000000000000000000000";
        let dst = store_dir.path().join("out.txt");
        let result = store.retrieve(zero, "../../etc/passwd", &dst);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("path separators"));
    }

    #[test]
    fn rejects_non_hex_content_hash() {
        let store_dir = TempDir::new().unwrap();
        let store = LocalArtifactStore::new(store_dir.path()).unwrap();
        let dst = store_dir.path().join("out.txt");
        let result = store.retrieve("../../../etc", "file.txt", &dst);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("hex"));
    }

    #[test]
    fn uses_two_char_prefix_sharding() {
        let store_dir = TempDir::new().unwrap();
        let store = LocalArtifactStore::new(store_dir.path()).unwrap();

        let src_dir = TempDir::new().unwrap();
        let src_path = src_dir.path().join("test.txt");
        std::fs::write(&src_path, "hello").unwrap();

        let stored = store.store(&src_path).unwrap();
        let prefix = &stored.content_hash[..2];

        // Verify the 2-char prefix directory exists
        assert!(store_dir.path().join(prefix).exists());
        assert!(
            store_dir
                .path()
                .join(prefix)
                .join(&stored.content_hash)
                .exists()
        );
    }
}
