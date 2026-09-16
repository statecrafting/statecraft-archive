// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Content-addressable filesystem blob store using LZ4 compression.
//!
//! Each blob is stored under `<base_path>/<prefix2>/<sha256-hex>`.  The file
//! begins with a 4-byte magic number that indicates the compression codec:
//!
//! - `LZ4T` — LZ4 frame (written by this implementation)
//! - `\0\0\0\0` — uncompressed raw bytes (legacy read path)
//! - anything else — legacy zstd frame (read-only compatibility)

use anyhow::Result;
use lz4_flex::{compress_prepend_size, decompress_size_prepended};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

const LZ4_MAGIC: &[u8; 4] = b"LZ4T";
const RAW_MAGIC: &[u8; 4] = &[0, 0, 0, 0];

/// A filesystem-backed, content-addressable blob store.
pub struct BlobStore {
    base_path: PathBuf,
}

impl BlobStore {
    /// Create (or reopen) a blob store rooted at `base_path`.
    pub fn new(base_path: PathBuf) -> Result<Self> {
        fs::create_dir_all(&base_path)?;
        Ok(Self { base_path })
    }

    /// Write `data` to the store and return its SHA-256 hex hash.
    ///
    /// If a blob with the same hash already exists the write is skipped
    /// (content-addressed deduplication).
    pub fn put(&self, data: &[u8]) -> Result<String> {
        let hash = hex::encode(Sha256::digest(data));
        let path = self.blob_path(&hash);

        if path.exists() {
            return Ok(hash);
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let compressed = compress_prepend_size(data);
        let mut content: Vec<u8> = Vec::with_capacity(4 + compressed.len());
        content.extend_from_slice(LZ4_MAGIC);
        content.extend_from_slice(&compressed);

        // Atomic write via a temp file in the same directory.
        let tmp_path = path.with_extension("tmp");
        fs::write(&tmp_path, &content)?;
        fs::rename(&tmp_path, &path)?;

        Ok(hash)
    }

    /// Read and decompress a blob by its SHA-256 hex hash.
    ///
    /// Returns `Ok(None)` if the hash is not present in the store.
    pub fn get(&self, hash: &str) -> Result<Option<Vec<u8>>> {
        let path = self.blob_path(hash);
        if !path.exists() {
            return Ok(None);
        }

        let raw = fs::read(&path)?;
        if raw.len() < 4 {
            // Very short file — return as-is.
            return Ok(Some(raw));
        }

        let magic = &raw[..4];
        if magic == LZ4_MAGIC {
            let decompressed = decompress_size_prepended(&raw[4..])
                .map_err(|e| anyhow::anyhow!("LZ4 decompression failed for {}: {}", hash, e))?;
            Ok(Some(decompressed))
        } else if magic == RAW_MAGIC {
            Ok(Some(raw[4..].to_vec()))
        } else {
            // Legacy zstd frame — try to decode.
            let decoded = zstd::decode_all(&raw[..])
                .map_err(|e| anyhow::anyhow!("zstd decompression failed for {}: {}", hash, e))?;
            Ok(Some(decoded))
        }
    }

    /// Return `true` if a blob with `hash` exists in the store.
    pub fn has(&self, hash: &str) -> bool {
        self.blob_path(hash).exists()
    }

    /// Delete the blob file for `hash` from the filesystem.
    ///
    /// Silently succeeds if the file does not exist.
    pub fn delete(&self, hash: &str) -> Result<()> {
        let path = self.blob_path(hash);
        if path.exists() {
            fs::remove_file(&path)?;
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    fn blob_path(&self, hash: &str) -> PathBuf {
        let prefix = &hash[..hash.len().min(2)];
        self.base_path.join(prefix).join(hash)
    }
}

/// Return the filesystem path that would be used for `hash` under `base`.
/// Useful for tests.
pub fn blob_path_for(base: &Path, hash: &str) -> PathBuf {
    let prefix = &hash[..hash.len().min(2)];
    base.join(prefix).join(hash)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::new(dir.path().to_path_buf()).unwrap();

        let data = b"hello checkpoint blobs";
        let hash = store.put(data).unwrap();
        let back = store.get(&hash).unwrap().unwrap();
        assert_eq!(&back, data);
    }

    #[test]
    fn dedup_put() {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::new(dir.path().to_path_buf()).unwrap();

        let data = b"deduplicated";
        let h1 = store.put(data).unwrap();
        let h2 = store.put(data).unwrap();
        assert_eq!(h1, h2);
    }

    #[test]
    fn missing_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::new(dir.path().to_path_buf()).unwrap();
        assert!(store.get("deadbeef").unwrap().is_none());
    }

    #[test]
    fn has_after_put() {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::new(dir.path().to_path_buf()).unwrap();
        let hash = store.put(b"exists").unwrap();
        assert!(store.has(&hash));
        assert!(!store.has("nothere"));
    }

    #[test]
    fn delete_removes_blob() {
        let dir = tempfile::tempdir().unwrap();
        let store = BlobStore::new(dir.path().to_path_buf()).unwrap();
        let hash = store.put(b"to be deleted").unwrap();
        assert!(store.has(&hash));
        store.delete(&hash).unwrap();
        assert!(!store.has(&hash));
    }
}
