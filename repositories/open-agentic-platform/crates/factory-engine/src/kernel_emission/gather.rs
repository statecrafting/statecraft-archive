// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/167-born-with-spec-spine-kernel/spec.md

//! Kernel-content gathering (spec 167 §2.1).
//!
//! Reads OAP's canonical kernel from the substrate's filesystem:
//!
//! - `specs/000-bootstrap-spec-system/spec.md`
//! - `standards/spec/` (entire tree)
//! - `.derived/spec-registry/registry.json` (pre-compiled)
//!
//! Hashing is deterministic over the gathered tree (sorted relative
//! paths, raw file bytes) using SHA-256. Hash equality across two
//! gathers on identical inputs is the verification surface for FR-009.

use std::path::PathBuf;

use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use super::KernelEmissionError;

/// A reference to OAP's kernel source on disk. The most common construction
/// is `KernelSource::from_repo_root(<path-to-oap>)`.
#[derive(Debug, Clone)]
pub struct KernelSource {
    pub repo_root: PathBuf,
}

impl KernelSource {
    pub fn from_repo_root(root: impl Into<PathBuf>) -> Self {
        Self { repo_root: root.into() }
    }

    fn spec_000_path(&self) -> PathBuf {
        self.repo_root
            .join("specs")
            .join("000-bootstrap-spec-system")
            .join("spec.md")
    }

    fn standards_dir(&self) -> PathBuf {
        self.repo_root.join("standards").join("spec")
    }

    fn registry_path(&self) -> PathBuf {
        self.repo_root
            .join(".derived")
            .join("spec-registry")
            .join("registry.json")
    }
}

/// Gathered kernel content, ready to write to a tenant project tree.
#[derive(Debug, Clone)]
pub struct KernelContent {
    /// File entries with relative path (relative to the tenant project
    /// root) and raw bytes. Sorted by path for deterministic emission.
    pub entries: Vec<KernelFileEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KernelFileEntry {
    pub relative_path: PathBuf,
    pub bytes: Vec<u8>,
}

/// Gather the kernel content from the OAP source tree.
///
/// FR-002: spec 000, standards/spec/, registry.json are mandatory; their
/// absence raises [`KernelEmissionError::SourceIncomplete`].
pub fn gather_kernel_content(source: &KernelSource) -> Result<KernelContent, KernelEmissionError> {
    if !source.repo_root.exists() {
        return Err(KernelEmissionError::SourceNotFound(
            source.repo_root.display().to_string(),
        ));
    }

    let mut entries: Vec<KernelFileEntry> = Vec::new();

    // 1. specs/000-bootstrap-spec-system/spec.md
    let spec_000 = source.spec_000_path();
    if !spec_000.is_file() {
        return Err(KernelEmissionError::SourceIncomplete(
            spec_000.display().to_string(),
        ));
    }
    entries.push(KernelFileEntry {
        relative_path: PathBuf::from("specs/000-bootstrap-spec-system/spec.md"),
        bytes: std::fs::read(&spec_000)?,
    });

    // 2. standards/spec/** (entire tree, files only)
    let standards_root = source.standards_dir();
    if !standards_root.is_dir() {
        return Err(KernelEmissionError::SourceIncomplete(
            standards_root.display().to_string(),
        ));
    }
    for entry in WalkDir::new(&standards_root)
        .follow_links(false)
        .sort_by_file_name()
    {
        let entry = entry.map_err(|e| KernelEmissionError::Io(e.into()))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let abs = entry.path();
        let rel = abs.strip_prefix(&source.repo_root).map_err(|_| {
            KernelEmissionError::SourceIncomplete(abs.display().to_string())
        })?;
        entries.push(KernelFileEntry {
            relative_path: rel.to_path_buf(),
            bytes: std::fs::read(abs)?,
        });
    }

    // 3. .derived/spec-registry/registry.json
    let registry = source.registry_path();
    if !registry.is_file() {
        return Err(KernelEmissionError::SourceIncomplete(
            registry.display().to_string(),
        ));
    }
    entries.push(KernelFileEntry {
        relative_path: PathBuf::from(".derived/spec-registry/registry.json"),
        bytes: std::fs::read(&registry)?,
    });

    // Sort entries deterministically by relative path.
    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    Ok(KernelContent { entries })
}

/// Deterministic SHA-256 over the kernel content.
///
/// Hash domain: for each entry (in sorted order) the hasher consumes
/// `<relative-path-as-utf8>\0<byte-len-le-u64><raw-bytes>`. The
/// null-byte and length frame prevent boundary ambiguities between
/// adjacent files. Output is a lowercase hex string.
pub fn compute_kernel_hash(content: &KernelContent) -> String {
    let mut hasher = Sha256::new();
    for entry in &content.entries {
        let path_str = entry.relative_path.to_string_lossy();
        hasher.update(path_str.as_bytes());
        hasher.update([0u8]);
        let len = entry.bytes.len() as u64;
        hasher.update(len.to_le_bytes());
        hasher.update(&entry.bytes);
    }
    let digest = hasher.finalize();
    hex_encode(&digest)
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(*b >> 4) as usize] as char);
        s.push(HEX[(*b & 0x0f) as usize] as char);
    }
    s
}

/// Compute the SHA-256 of an adapter manifest payload (or any byte slice).
/// Surfaced as a helper so the caller building [`AdapterIdentity`] can fill
/// `manifest_hash` from the same hash domain.
pub fn hash_adapter_manifest(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex_encode(&hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    fn write_fixture(root: &Path, rel: &str, contents: &str) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, contents).unwrap();
    }

    fn minimal_kernel_source() -> TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_fixture(
            root,
            "specs/000-bootstrap-spec-system/spec.md",
            "# spec 000\n",
        );
        write_fixture(root, "standards/spec/constitution.md", "# constitution\n");
        write_fixture(root, "standards/spec/contract.md", "# contract\n");
        write_fixture(
            root,
            "standards/spec/templates/spec-template.md",
            "# template\n",
        );
        write_fixture(
            root,
            ".derived/spec-registry/registry.json",
            r#"{"specVersion":"0.1.0","specs":[]}"#,
        );
        dir
    }

    #[test]
    fn gather_collects_required_entries() {
        let dir = minimal_kernel_source();
        let source = KernelSource::from_repo_root(dir.path());
        let content = gather_kernel_content(&source).unwrap();
        let paths: Vec<String> = content
            .entries
            .iter()
            .map(|e| e.relative_path.to_string_lossy().into_owned())
            .collect();

        assert!(paths.contains(&".derived/spec-registry/registry.json".to_string()));
        assert!(paths.contains(&"specs/000-bootstrap-spec-system/spec.md".to_string()));
        assert!(paths.contains(&"standards/spec/constitution.md".to_string()));
        assert!(paths.contains(&"standards/spec/contract.md".to_string()));
        assert!(paths.contains(&"standards/spec/templates/spec-template.md".to_string()));
    }

    #[test]
    fn gather_entries_are_sorted() {
        let dir = minimal_kernel_source();
        let source = KernelSource::from_repo_root(dir.path());
        let content = gather_kernel_content(&source).unwrap();
        let paths: Vec<_> = content.entries.iter().map(|e| &e.relative_path).collect();
        let mut sorted = paths.clone();
        sorted.sort();
        assert_eq!(paths, sorted);
    }

    #[test]
    fn hash_is_stable_across_invocations() {
        let dir = minimal_kernel_source();
        let source = KernelSource::from_repo_root(dir.path());
        let a = compute_kernel_hash(&gather_kernel_content(&source).unwrap());
        let b = compute_kernel_hash(&gather_kernel_content(&source).unwrap());
        assert_eq!(a, b);
        // Lowercase hex, full SHA-256 width.
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn hash_changes_when_content_changes() {
        let dir = minimal_kernel_source();
        let source = KernelSource::from_repo_root(dir.path());
        let a = compute_kernel_hash(&gather_kernel_content(&source).unwrap());
        // Mutate one file.
        fs::write(
            dir.path().join("standards/spec/contract.md"),
            "# contract v2\n",
        )
        .unwrap();
        let b = compute_kernel_hash(&gather_kernel_content(&source).unwrap());
        assert_ne!(a, b);
    }

    #[test]
    fn missing_spec_000_is_source_incomplete() {
        let dir = tempfile::tempdir().unwrap();
        write_fixture(dir.path(), "standards/spec/contract.md", "x");
        write_fixture(dir.path(), ".derived/spec-registry/registry.json", "{}");
        let source = KernelSource::from_repo_root(dir.path());
        let err = gather_kernel_content(&source).unwrap_err();
        match err {
            KernelEmissionError::SourceIncomplete(p) => {
                assert!(p.contains("spec.md"));
            }
            other => panic!("expected SourceIncomplete, got {other:?}"),
        }
    }

    #[test]
    fn missing_root_is_source_not_found() {
        let source = KernelSource::from_repo_root("/nonexistent/oap/root");
        let err = gather_kernel_content(&source).unwrap_err();
        assert!(matches!(err, KernelEmissionError::SourceNotFound(_)));
    }

    #[test]
    fn hash_adapter_manifest_is_deterministic() {
        let h1 = hash_adapter_manifest(b"adapter-payload");
        let h2 = hash_adapter_manifest(b"adapter-payload");
        let h3 = hash_adapter_manifest(b"adapter-payload-2");
        assert_eq!(h1, h2);
        assert_ne!(h1, h3);
        assert_eq!(h1.len(), 64);
    }
}
