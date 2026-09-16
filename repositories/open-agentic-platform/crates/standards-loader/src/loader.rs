// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: 055-yaml-standards-schema

//! Loads coding standards from the three-tier directory structure (FR-004, FR-005).

use crate::types::CodingStandard;
use std::collections::HashMap;
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum LoadError {
    #[error("IO error reading {path}: {source}")]
    Io {
        path: String,
        source: std::io::Error,
    },

    #[error("YAML parse error in {path}: {source}")]
    Yaml {
        path: String,
        source: serde_yaml::Error,
    },
}

/// Standards loaded from the three-tier directory structure.
#[derive(Debug, Default)]
pub struct TieredStandards {
    /// Official platform defaults (Tier 1).
    pub official: Vec<CodingStandard>,
    /// Community/team shared standards (Tier 2).
    pub community: Vec<CodingStandard>,
    /// Project-local standards (Tier 3).
    pub local: Vec<CodingStandard>,
}

/// Load all `.yaml`/`.yml` standard files from a directory.
///
/// Returns an empty vec if the directory doesn't exist or is unreadable
/// (graceful on missing dirs per FR-005).
pub fn load_standards_from_dir(dir: &Path) -> Result<Vec<CodingStandard>, LoadError> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(Vec::new()), // directory doesn't exist — return empty
    };

    let mut files: Vec<_> = entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            let p = e.path();
            p.is_file()
                && matches!(
                    p.extension().and_then(|ext| ext.to_str()),
                    Some("yaml" | "yml")
                )
        })
        .collect();

    // Sort by filename for deterministic ordering
    files.sort_by_key(|e| e.file_name());

    let mut standards = Vec::new();
    // Track IDs to handle duplicates (later file wins within a tier)
    let mut seen: HashMap<String, usize> = HashMap::new();

    for entry in files {
        let path = entry.path();
        let path_str = path.display().to_string();

        let content = std::fs::read_to_string(&path).map_err(|e| LoadError::Io {
            path: path_str.clone(),
            source: e,
        })?;

        let standard: CodingStandard =
            serde_yaml::from_str(&content).map_err(|e| LoadError::Yaml {
                path: path_str,
                source: e,
            })?;

        if let Some(idx) = seen.get(&standard.id) {
            // Duplicate within same tier — later file wins
            standards[*idx] = standard.clone();
        } else {
            seen.insert(standard.id.clone(), standards.len());
            standards.push(standard);
        }
    }

    Ok(standards)
}

/// Load standards from all three tiers (FR-004, FR-005).
///
/// Reads `standards/official/`, `standards/community/`, `standards/local/`
/// under the given project root. Missing directories are silently skipped.
pub fn load_all_tiers(project_root: &Path) -> Result<TieredStandards, LoadError> {
    Ok(TieredStandards {
        official: load_standards_from_dir(&project_root.join("standards").join("official"))?,
        community: load_standards_from_dir(&project_root.join("standards").join("community"))?,
        local: load_standards_from_dir(&project_root.join("standards").join("local"))?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixture_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf()
    }

    #[test]
    fn load_official_standards() {
        let root = fixture_dir();
        let standards = load_standards_from_dir(&root.join("standards").join("official")).unwrap();
        assert!(
            standards.len() >= 10,
            "Expected at least 10 official standards, got {}",
            standards.len()
        );
    }

    #[test]
    fn load_all_tiers_works() {
        let root = fixture_dir();
        let tiers = load_all_tiers(&root).unwrap();
        assert!(tiers.official.len() >= 10);
        // community and local are empty in the repo
        assert!(tiers.community.is_empty());
        assert!(tiers.local.is_empty());
    }

    #[test]
    fn load_missing_dir_returns_empty() {
        let standards = load_standards_from_dir(Path::new("/nonexistent/path")).unwrap();
        assert!(standards.is_empty());
    }

    #[test]
    fn load_standards_handles_duplicates() {
        let dir = tempfile::TempDir::new().unwrap();
        fs::write(
            dir.path().join("a-001.yaml"),
            "id: test-001\ncategory: test\npriority: low\nrules:\n  - verb: ALWAYS\n    subject: first\n    rationale: r",
        ).unwrap();
        fs::write(
            dir.path().join("b-001.yaml"),
            "id: test-001\ncategory: test\npriority: high\nrules:\n  - verb: NEVER\n    subject: second\n    rationale: r",
        ).unwrap();

        let standards = load_standards_from_dir(dir.path()).unwrap();
        // Same ID — later file (b-001) wins
        assert_eq!(standards.len(), 1);
        assert_eq!(standards[0].rules[0].subject, "second");
    }
}
