// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Merkle tree for integrity verification of checkpoint file sets.

use sha2::{Digest, Sha256};

use super::types::FileEntry;

/// A minimal Merkle tree built from a slice of [`FileEntry`] values.
///
/// The tree is built iteratively (not stored as a node graph) — only the root
/// hash is kept. Leaf hashes are the `combined_hash` fields of each entry,
/// sorted deterministically before pairing.
pub struct MerkleTree {
    root_hash: Option<String>,
}

impl MerkleTree {
    /// Build a Merkle tree from a slice of file entries.
    ///
    /// The root hash is `None` when `entries` is empty.
    pub fn from_entries(entries: &[FileEntry]) -> Self {
        if entries.is_empty() {
            return Self { root_hash: None };
        }

        let mut hashes: Vec<String> = entries.iter().map(|e| e.combined_hash.clone()).collect();

        // Sort for deterministic ordering regardless of entry order.
        hashes.sort();

        while hashes.len() > 1 {
            let mut next: Vec<String> = Vec::with_capacity(hashes.len().div_ceil(2));
            for chunk in hashes.chunks(2) {
                let mut hasher = Sha256::new();
                hasher.update(chunk[0].as_bytes());
                if chunk.len() > 1 {
                    hasher.update(chunk[1].as_bytes());
                } else {
                    // Odd leaf — hash with itself.
                    hasher.update(chunk[0].as_bytes());
                }
                next.push(hex::encode(hasher.finalize()));
            }
            hashes = next;
        }

        Self {
            root_hash: hashes.into_iter().next(),
        }
    }

    /// Return the root hash, or `None` if the tree is empty.
    pub fn root_hash(&self) -> Option<&str> {
        self.root_hash.as_deref()
    }
}

// ---------------------------------------------------------------------------
// Free helpers
// ---------------------------------------------------------------------------

/// Compute the SHA-256 hash of arbitrary bytes, returned as a hex string.
pub fn hash_content(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

/// Compute the combined hash of a content hash and permissions value.
///
/// This is the value stored in `FileEntry::combined_hash` and used as the
/// Merkle leaf hash.
pub fn combined_hash(content_hash: &str, permissions: u32) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content_hash.as_bytes());
    hasher.update(permissions.to_le_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checkpoint::types::FileEntry;
    use std::path::PathBuf;

    fn make_entry(path: &str, content: &str) -> FileEntry {
        let ch = hash_content(content.as_bytes());
        let comb = combined_hash(&ch, 0o644);
        FileEntry {
            path: PathBuf::from(path),
            content_hash: ch,
            size: content.len() as u64,
            permissions: 0o644,
            combined_hash: comb,
        }
    }

    #[test]
    fn empty_tree_has_no_root() {
        let tree = MerkleTree::from_entries(&[]);
        assert!(tree.root_hash().is_none());
    }

    #[test]
    fn single_entry_has_root() {
        let entry = make_entry("foo.txt", "hello");
        let tree = MerkleTree::from_entries(std::slice::from_ref(&entry));
        // A single-entry tree must have a root hash of the correct length.
        let root = tree.root_hash().expect("single entry must produce a root");
        assert_eq!(root.len(), 64, "root hash should be a 64-char SHA-256 hex");
        // Verify that the same entry always produces the same root (determinism).
        let tree2 = MerkleTree::from_entries(&[entry]);
        assert_eq!(tree.root_hash(), tree2.root_hash());
    }

    #[test]
    fn two_entries_deterministic() {
        let e1 = make_entry("a.txt", "aaa");
        let e2 = make_entry("b.txt", "bbb");

        let tree1 = MerkleTree::from_entries(&[e1.clone(), e2.clone()]);
        let tree2 = MerkleTree::from_entries(&[e2, e1]);

        assert_eq!(tree1.root_hash(), tree2.root_hash());
    }
}
