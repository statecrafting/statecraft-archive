// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Quick hash-based verification helpers for checkpoint files.

use sha2::{Digest, Sha256};

use super::merkle::MerkleTree;
use super::types::FileEntry;

/// Return `true` if the SHA-256 of `content` matches `entry.content_hash`.
pub fn verify_file_hash(entry: &FileEntry, content: &[u8]) -> bool {
    let hash = hex::encode(Sha256::digest(content));
    hash == entry.content_hash
}

/// Return `true` if the Merkle root computed from `entries` equals
/// `expected_root`.
///
/// Returns `false` for an empty entry slice regardless of `expected_root`.
pub fn verify_merkle_root(entries: &[FileEntry], expected_root: &str) -> bool {
    let tree = MerkleTree::from_entries(entries);
    tree.root_hash()
        .map(|h| h == expected_root)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checkpoint::merkle::{combined_hash, hash_content};
    use std::path::PathBuf;

    fn make_entry(path: &str, content: &[u8]) -> (FileEntry, Vec<u8>) {
        let ch = hash_content(content);
        let comb = combined_hash(&ch, 0o644);
        let entry = FileEntry {
            path: PathBuf::from(path),
            content_hash: ch,
            size: content.len() as u64,
            permissions: 0o644,
            combined_hash: comb,
        };
        (entry, content.to_vec())
    }

    #[test]
    fn file_hash_correct() {
        let (entry, content) = make_entry("a.txt", b"hello world");
        assert!(verify_file_hash(&entry, &content));
    }

    #[test]
    fn file_hash_tampered() {
        let (entry, _) = make_entry("a.txt", b"hello world");
        assert!(!verify_file_hash(&entry, b"tampered"));
    }

    #[test]
    fn merkle_root_round_trip() {
        let (e1, _) = make_entry("a.txt", b"aaa");
        let (e2, _) = make_entry("b.txt", b"bbb");
        let entries = vec![e1, e2];
        let tree = MerkleTree::from_entries(&entries);
        let root = tree.root_hash().unwrap();
        assert!(verify_merkle_root(&entries, root));
        assert!(!verify_merkle_root(&entries, "bad_hash"));
    }
}
