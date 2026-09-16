// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: XRAY_ANALYSIS
// Spec: spec/xray/analysis.md

use crate::loc;
use crate::schema::{FileNode, RepoStats};
use anyhow::{Context, Result};
use std::collections::BTreeMap;
use std::path::Path;
use walkdir::{DirEntry, WalkDir};

/// Directories to ignore strictly.
const IGNORED_DIRS: &[&str] = &[
    ".git",
    ".bin",
    "node_modules",
    "dist",
    "build",
    "out",
    "vendor",
    "target",
    ".cache",
    ".tmp",
    "coverage",
    ".axiomregent",
];

/// Loads additional ignore patterns from `.xrayignore` file at the target root.
/// Each non-empty, non-comment line is treated as a directory name to ignore.
fn load_xrayignore(target: &Path) -> Vec<String> {
    let ignore_path = target.join(".xrayignore");
    match std::fs::read_to_string(&ignore_path) {
        Ok(content) => content
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .map(|l| l.to_string())
            .collect(),
        Err(_) => Vec::new(),
    }
}

/// Known module files to detect at root.
const MODULE_FILES_LOOKUP: &[&str] = &[
    "go.mod",
    "Cargo.toml",
    "package.json",
    ".git",
    "Makefile",
    "Dockerfile",
];

pub struct ScanResult {
    pub files: Vec<FileNode>,
    pub stats: RepoStats,
    pub languages: BTreeMap<String, usize>,
    pub top_dirs: BTreeMap<String, usize>,
    pub module_files: Vec<String>,
}

/// Scans the target directory recursively and returns sorted file nodes and stats.
pub fn scan_target(target: &Path) -> Result<ScanResult> {
    let mut files = Vec::new();
    let mut total_size = 0;

    // Aggregates
    let mut languages: BTreeMap<String, usize> = BTreeMap::new();
    let mut top_dirs: BTreeMap<String, usize> = BTreeMap::new();
    let mut module_files: Vec<String> = Vec::new();

    // Load user-defined ignore patterns
    let extra_ignores = load_xrayignore(target);

    // Explicitly check for .git (which is ignored by walker)
    if target.join(".git").exists() {
        module_files.push(".git".to_string());
    }

    let walker = WalkDir::new(target).follow_links(false).into_iter();

    // Filter entry closure
    let is_ignored = |entry: &DirEntry| -> bool {
        entry
            .file_name()
            .to_str()
            .map(|s| IGNORED_DIRS.contains(&s) || extra_ignores.iter().any(|i| i == s))
            .unwrap_or(false)
    };

    for entry in walker.filter_entry(|e| !is_ignored(e)) {
        let entry = entry.context("Failed to read directory entry")?;
        let path = entry.path();

        if path.is_dir() {
            continue;
        }

        // Normalization: Relative path
        let relative_path = path.strip_prefix(target).unwrap_or(path);

        // Skip root itself if it was a file (unlikely given target is usually dir, but possible)
        if relative_path.as_os_str().is_empty() {
            continue;
        }

        // Normalize separators to '/'
        let path_str = relative_path.to_slash_lossy();

        // Skip leading "./" if present (though strip_prefix usually handles it clean)
        let clean_path = if let Some(stripped) = path_str.strip_prefix("./") {
            stripped.to_string()
        } else {
            path_str.to_string()
        };

        // Compute LOC
        let loc_stats = loc::compute_loc(path)?;

        // If skipped (e.g. invalid UTF8 or too big), we currently INCLUDE it in the index
        // with 0 LOC, or do we exclude it?
        // The spec implies index tracks all files.
        // Xray schema has "loc" field.
        // Contracts say: "If size > cap: loc = 0 and count as skipped"
        // So we include it.

        total_size += loc_stats.size;

        // Compute Hash (Phase B)
        // Failure to hash (read error) now fails the scan to ensure integrity.
        let hash = crate::hash::compute_file_hash(path)?;

        // Detect Language (Phase C1)
        let lang = crate::language::detect_language(path);

        // Aggregate Language
        if lang != "Unknown" {
            *languages.entry(lang.clone()).or_insert(0) += 1;
        }

        // Aggregate Top Dirs
        // clean_path is "cmd/foo/bar.go" -> "cmd"
        // "README.md" -> "." or ""? User said bucket under "" or "."
        // Let's use "." for root files.
        let top_dir = if let Some(idx) = clean_path.find('/') {
            clean_path[..idx].to_string()
        } else {
            ".".to_string()
        };
        *top_dirs.entry(top_dir).or_insert(0) += 1;

        // Detect Module Files (Root only)
        // clean_path is relative to target. If it contains '/', it's not root.
        // Assumes target IS repo root.
        if !clean_path.contains('/') && MODULE_FILES_LOOKUP.contains(&clean_path.as_str()) {
            module_files.push(clean_path.clone());
        }
        // Also check if .git directory exists?
        // No, module_files are "files". .git can be a file (submodule) or dir.
        // The list includes `.git`. If .git is a dir and I ignore it, I won't see it here.
        // But I see it in `module_files` list?
        // User requirements: "Only include if present at repo root".
        // Use manual check for specific missing ones later?
        // For now, only what is scanned is included.
        // If `.git` is ignored (it is in IGNORED_DIRS), scan won't yield it.
        // So `module_files` will miss `.git` unless I check specifically.
        // I will adhere to "scanned files" logic for now to ensure determinism involving ignoring.
        // If user wants .git in module_files, it must not be ignored? Or handled specially.
        // Logic: "Ignore any path... .git". So .git is ignored. So it won't be scanned.
        // So it won't be in module_files unless I add a special check outside the loop.
        // I'll stick to loop for now.

        // Compute structural analysis if feature enabled
        #[cfg(feature = "analysis-structure")]
        let (complexity, functions, max_depth) = {
            match crate::analysis::structure::analyze_file(path) {
                Some(m) => (m.complexity, Some(m.functions), Some(m.max_depth)),
                None => (0, None, None),
            }
        };
        #[cfg(not(feature = "analysis-structure"))]
        let (complexity, functions, max_depth): (u64, Option<u32>, Option<u32>) = (0, None, None);

        files.push(FileNode {
            path: clean_path,
            size: loc_stats.size,
            hash,
            lang,
            loc: loc_stats.loc,
            complexity,
            functions,
            max_depth,
        });
    }

    // DETERMINISM: Sort by path
    files.sort_by(|a, b| a.path.cmp(&b.path));
    module_files.sort(); // Lexicographical sort

    Ok(ScanResult {
        stats: RepoStats {
            file_count: files.len(),
            total_size,
        },
        files,
        languages,
        top_dirs,
        module_files,
    })
}

trait ToSlash {
    fn to_slash_lossy(&self) -> String;
}

impl ToSlash for Path {
    fn to_slash_lossy(&self) -> String {
        self.to_string_lossy().replace('\\', "/")
    }
}
