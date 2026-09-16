// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/185-sandbox-local-container-backend/spec.md — §3 FR-009

//! Output directory walking + SHA-256 hashing.
//!
//! After container exit the backend walks the per-execution writable
//! mount, computes SHA-256 over each file's bytes, and records
//! `<relative-path, sha256-hex>` pairs into
//! `SandboxExecution.output_artifact_hashes`. Directories are not
//! hashed; empty files are hashed (SHA-256 of zero bytes).

use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::Path;
use walkdir::WalkDir;

/// Walk `root` recursively and produce a sorted map of
/// `<relative-path, sha256-hex>` for every regular file encountered.
/// Returns an empty map if `root` does not exist or has no files.
///
/// Paths use forward slashes regardless of host OS so the certificate
/// JSON is portable.
pub(crate) async fn hash_output_dir(root: &Path) -> std::io::Result<BTreeMap<String, String>> {
    let root = root.to_path_buf();
    tokio::task::spawn_blocking(move || hash_output_dir_sync(&root))
        .await
        .map_err(std::io::Error::other)?
}

fn hash_output_dir_sync(root: &Path) -> std::io::Result<BTreeMap<String, String>> {
    let mut hashes = BTreeMap::new();
    if !root.exists() {
        return Ok(hashes);
    }
    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry.map_err(std::io::Error::other)?;
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(std::io::Error::other)?
            .to_path_buf();
        let rel_str = relative
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/");
        let bytes = std::fs::read(entry.path())?;
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let hex = hex_encode(hasher.finalize().as_slice());
        hashes.insert(rel_str, hex);
    }
    Ok(hashes)
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use tempfile::tempdir;

    #[tokio::test]
    async fn missing_root_yields_empty_map() {
        let path = std::path::PathBuf::from("/tmp/oap-test-nonexistent-output-dir");
        let hashes = hash_output_dir(&path).await.unwrap();
        assert!(hashes.is_empty());
    }

    #[tokio::test]
    async fn empty_dir_yields_empty_map() {
        let dir = tempdir().unwrap();
        let hashes = hash_output_dir(dir.path()).await.unwrap();
        assert!(hashes.is_empty());
    }

    #[tokio::test]
    async fn single_file_is_hashed() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("hello.txt");
        fs::write(&path, b"hello\n").unwrap();
        let hashes = hash_output_dir(dir.path()).await.unwrap();
        assert_eq!(hashes.len(), 1);
        // SHA-256("hello\n") = 5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03
        assert_eq!(
            hashes["hello.txt"],
            "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03"
        );
    }

    #[tokio::test]
    async fn nested_files_use_forward_slash_paths() {
        let dir = tempdir().unwrap();
        let nested = dir.path().join("a").join("b");
        fs::create_dir_all(&nested).unwrap();
        let mut f = fs::File::create(nested.join("c.txt")).unwrap();
        f.write_all(b"nested").unwrap();
        let hashes = hash_output_dir(dir.path()).await.unwrap();
        assert_eq!(hashes.len(), 1);
        assert!(hashes.contains_key("a/b/c.txt"), "got {:?}", hashes.keys().collect::<Vec<_>>());
    }

    #[tokio::test]
    async fn empty_file_is_hashed_with_known_digest() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("empty"), b"").unwrap();
        let hashes = hash_output_dir(dir.path()).await.unwrap();
        // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        assert_eq!(
            hashes["empty"],
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn hex_encode_known_value() {
        assert_eq!(hex_encode(&[0x00, 0xff, 0xab]), "00ffab");
    }
}
