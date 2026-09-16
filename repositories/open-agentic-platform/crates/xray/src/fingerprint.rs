// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use crate::schema::XrayIndex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Structural fingerprint for a repository.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Fingerprint {
    /// Short hash (first 8 chars of SHA-256) of the structural signature.
    pub hash: String,
    /// Classification label (e.g., "rust-cli", "node-webapp", "monorepo").
    pub classification: String,
    /// Primary language by file count.
    pub primary_language: String,
    /// Size bucket: "tiny" (<50), "small" (<500), "medium" (<5000), "large" (5000+).
    pub size_bucket: String,
    /// Number of ecosystems detected (cargo, npm, go, etc.).
    pub ecosystem_count: usize,
}

/// Generate a structural fingerprint from an xray index.
pub fn generate_fingerprint(index: &XrayIndex) -> Fingerprint {
    let primary_language = index
        .languages
        .iter()
        .max_by_key(|(_, count)| *count)
        .map(|(lang, _)| lang.clone())
        .unwrap_or_else(|| "Unknown".to_string());

    let size_bucket = match index.stats.file_count {
        0..=49 => "tiny",
        50..=499 => "small",
        500..=4999 => "medium",
        _ => "large",
    }
    .to_string();

    let ecosystem_count = count_ecosystems(index);
    let is_monorepo = index.top_dirs.len() > 8 || index.module_files.len() > 3;

    let classification = classify(
        &primary_language,
        &size_bucket,
        ecosystem_count,
        is_monorepo,
        index,
    );

    // Build fingerprint input: sorted language ratios + structure signals
    let mut sig = String::new();
    let total = index.stats.file_count.max(1) as f64;
    for (lang, count) in &index.languages {
        let ratio = (*count as f64 / total * 100.0).round() as u32;
        sig.push_str(&format!("{}:{};", lang, ratio));
    }
    sig.push_str(&format!("dirs:{};", index.top_dirs.len()));
    sig.push_str(&format!("size:{};", size_bucket));
    sig.push_str(&format!("eco:{};", ecosystem_count));

    let hash = {
        let mut hasher = Sha256::new();
        hasher.update(sig.as_bytes());
        let result = hasher.finalize();
        hex::encode(&result[..4]) // First 8 hex chars (4 bytes)
    };

    Fingerprint {
        hash,
        classification,
        primary_language,
        size_bucket,
        ecosystem_count,
    }
}

fn count_ecosystems(index: &XrayIndex) -> usize {
    let mut count = 0;
    for mf in &index.module_files {
        match mf.as_str() {
            "Cargo.toml" => count += 1,
            "package.json" => count += 1,
            "go.mod" => count += 1,
            _ => {}
        }
    }
    // Also check language signals
    if index.languages.contains_key("Rust") && count == 0 {
        count += 1;
    }
    if (index.languages.contains_key("JavaScript") || index.languages.contains_key("TypeScript"))
        && !index.module_files.contains(&"package.json".to_string())
    {
        count += 1;
    }
    count
}

fn classify(
    primary_lang: &str,
    size_bucket: &str,
    ecosystem_count: usize,
    is_monorepo: bool,
    index: &XrayIndex,
) -> String {
    if is_monorepo {
        return "monorepo".to_string();
    }

    let has_terraform = index.languages.contains_key("Terraform");
    let has_docker = index
        .module_files
        .iter()
        .any(|f| f.eq_ignore_ascii_case("Dockerfile"));
    let has_html = index.languages.contains_key("HTML");

    if has_terraform {
        return "terraform-infra".to_string();
    }

    match primary_lang {
        "Rust" => {
            if index.languages.contains_key("TypeScript")
                || index.languages.contains_key("JavaScript")
            {
                "rust-fullstack".to_string()
            } else if size_bucket == "tiny" || size_bucket == "small" {
                "rust-cli".to_string()
            } else {
                "rust-lib".to_string()
            }
        }
        "Go" => {
            if has_docker {
                "go-microservice".to_string()
            } else {
                "go-project".to_string()
            }
        }
        "TypeScript" | "JavaScript" => {
            if has_html {
                "node-webapp".to_string()
            } else if ecosystem_count > 1 {
                "node-fullstack".to_string()
            } else {
                "node-project".to_string()
            }
        }
        "Python" => {
            if has_docker {
                "python-service".to_string()
            } else {
                "python-project".to_string()
            }
        }
        "Java" => "java-project".to_string(),
        "C" | "C++" => "native-project".to_string(),
        _ => {
            if ecosystem_count > 1 {
                "multi-ecosystem".to_string()
            } else {
                "project".to_string()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{FileNode, RepoStats};
    use std::collections::BTreeMap;

    #[test]
    fn test_fingerprint_rust_cli() {
        let index = XrayIndex {
            schema_version: "1.2.0".to_string(),
            root: "test".to_string(),
            target: ".".to_string(),
            files: vec![
                FileNode {
                    path: "src/main.rs".to_string(),
                    size: 500,
                    hash: "h".to_string(),
                    lang: "Rust".to_string(),
                    loc: 50,
                    complexity: 0,
                    functions: None,
                    max_depth: None,
                },
                FileNode {
                    path: "Cargo.toml".to_string(),
                    size: 200,
                    hash: "h".to_string(),
                    lang: "TOML".to_string(),
                    loc: 20,
                    complexity: 0,
                    functions: None,
                    max_depth: None,
                },
            ],
            languages: BTreeMap::from([("Rust".to_string(), 2), ("TOML".to_string(), 1)]),
            top_dirs: BTreeMap::from([("src".to_string(), 1), (".".to_string(), 1)]),
            module_files: vec!["Cargo.toml".to_string()],
            stats: RepoStats {
                file_count: 2,
                total_size: 700,
            },
            digest: "test".to_string(),
            prev_digest: None,
            changed_files: None,
            call_graph_summary: None,
            dependencies: None,
            fingerprint: None,
        };

        let fp = generate_fingerprint(&index);
        assert_eq!(fp.classification, "rust-cli");
        assert_eq!(fp.primary_language, "Rust");
        assert_eq!(fp.size_bucket, "tiny");
        assert_eq!(fp.hash.len(), 8);
    }

    #[test]
    fn test_fingerprint_determinism() {
        let index = XrayIndex {
            languages: BTreeMap::from([("Go".to_string(), 10)]),
            stats: RepoStats {
                file_count: 10,
                total_size: 5000,
            },
            module_files: vec!["Dockerfile".to_string()],
            ..Default::default()
        };

        let fp1 = generate_fingerprint(&index);
        let fp2 = generate_fingerprint(&index);
        assert_eq!(fp1.hash, fp2.hash);
        assert_eq!(fp1.classification, "go-microservice");
    }

    #[test]
    fn test_fingerprint_monorepo() {
        let mut top_dirs = BTreeMap::new();
        for i in 0..10 {
            top_dirs.insert(format!("pkg{}", i), 5);
        }

        let index = XrayIndex {
            languages: BTreeMap::from([("TypeScript".to_string(), 50)]),
            stats: RepoStats {
                file_count: 50,
                total_size: 100_000,
            },
            top_dirs,
            module_files: vec![
                "package.json".to_string(),
                "Cargo.toml".to_string(),
                "go.mod".to_string(),
                "Makefile".to_string(),
            ],
            ..Default::default()
        };

        let fp = generate_fingerprint(&index);
        assert_eq!(fp.classification, "monorepo");
    }
}
