// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use crate::schema::XrayIndex;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Severity level for policy violations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Warning,
    Error,
}

/// A single policy violation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyViolation {
    pub rule: String,
    pub message: String,
    pub files: Vec<String>,
    pub severity: Severity,
}

/// Result of policy evaluation.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyReport {
    pub passed: Vec<String>,
    pub violations: Vec<PolicyViolation>,
    pub total_rules: usize,
    pub total_violations: usize,
}

/// Policy configuration loaded from `.xray-policy.toml`.
#[derive(Debug, Deserialize, Default)]
#[serde(default)]
pub struct PolicyConfig {
    /// Maximum file size in bytes (0 = disabled).
    pub max_file_size: u64,
    /// Maximum lines of code per file (0 = disabled).
    pub max_file_loc: u64,
    /// Maximum complexity score per file (0 = disabled).
    pub max_complexity: u64,
    /// Maximum ratio of "Unknown" language files (0.0–1.0, 0 = disabled).
    pub max_unknown_ratio: f64,
    /// Languages that must have at least one file present.
    #[serde(default)]
    pub require_languages: Vec<String>,
    /// Languages that must NOT be present.
    #[serde(default)]
    pub forbid_languages: Vec<String>,
    /// Dependency names that must NOT be present.
    #[serde(default)]
    pub dependency_deny_list: Vec<String>,
}

/// Load policy configuration from `.xray-policy.toml` at the target root.
pub fn load_policy(target: &Path) -> PolicyConfig {
    let policy_path = target.join(".xray-policy.toml");
    match std::fs::read_to_string(&policy_path) {
        Ok(content) => parse_policy_toml(&content),
        Err(_) => PolicyConfig::default(),
    }
}

/// Evaluate a policy against an xray index.
pub fn evaluate(index: &XrayIndex, config: &PolicyConfig) -> PolicyReport {
    let mut passed = Vec::new();
    let mut violations = Vec::new();

    // Rule: max_file_size
    if config.max_file_size > 0 {
        let offenders: Vec<String> = index
            .files
            .iter()
            .filter(|f| f.size > config.max_file_size)
            .map(|f| f.path.clone())
            .collect();
        if offenders.is_empty() {
            passed.push(format!(
                "max_file_size: all files under {} bytes",
                config.max_file_size
            ));
        } else {
            violations.push(PolicyViolation {
                rule: "max_file_size".to_string(),
                message: format!(
                    "{} file(s) exceed {} bytes",
                    offenders.len(),
                    config.max_file_size
                ),
                files: offenders,
                severity: Severity::Warning,
            });
        }
    }

    // Rule: max_file_loc
    if config.max_file_loc > 0 {
        let offenders: Vec<String> = index
            .files
            .iter()
            .filter(|f| f.loc > config.max_file_loc)
            .map(|f| f.path.clone())
            .collect();
        if offenders.is_empty() {
            passed.push(format!(
                "max_file_loc: all files under {} LOC",
                config.max_file_loc
            ));
        } else {
            violations.push(PolicyViolation {
                rule: "max_file_loc".to_string(),
                message: format!(
                    "{} file(s) exceed {} LOC",
                    offenders.len(),
                    config.max_file_loc
                ),
                files: offenders,
                severity: Severity::Warning,
            });
        }
    }

    // Rule: max_complexity
    if config.max_complexity > 0 {
        let offenders: Vec<String> = index
            .files
            .iter()
            .filter(|f| f.complexity > config.max_complexity)
            .map(|f| f.path.clone())
            .collect();
        if offenders.is_empty() {
            passed.push(format!(
                "max_complexity: all files under complexity {}",
                config.max_complexity
            ));
        } else {
            violations.push(PolicyViolation {
                rule: "max_complexity".to_string(),
                message: format!(
                    "{} file(s) exceed complexity {}",
                    offenders.len(),
                    config.max_complexity
                ),
                files: offenders,
                severity: Severity::Warning,
            });
        }
    }

    // Rule: max_unknown_ratio
    if config.max_unknown_ratio > 0.0 && !index.files.is_empty() {
        let unknown_count = index.files.iter().filter(|f| f.lang == "Unknown").count();
        let ratio = unknown_count as f64 / index.files.len() as f64;
        if ratio <= config.max_unknown_ratio {
            passed.push(format!(
                "max_unknown_ratio: {:.1}% unknown (limit {:.1}%)",
                ratio * 100.0,
                config.max_unknown_ratio * 100.0
            ));
        } else {
            violations.push(PolicyViolation {
                rule: "max_unknown_ratio".to_string(),
                message: format!(
                    "{:.1}% files have unknown language (limit {:.1}%)",
                    ratio * 100.0,
                    config.max_unknown_ratio * 100.0
                ),
                files: index
                    .files
                    .iter()
                    .filter(|f| f.lang == "Unknown")
                    .map(|f| f.path.clone())
                    .collect(),
                severity: Severity::Warning,
            });
        }
    }

    // Rule: require_languages
    for lang in &config.require_languages {
        if index.languages.contains_key(lang) {
            passed.push(format!("require_language: {} present", lang));
        } else {
            violations.push(PolicyViolation {
                rule: "require_language".to_string(),
                message: format!("Required language '{}' not found in any file", lang),
                files: vec![],
                severity: Severity::Error,
            });
        }
    }

    // Rule: forbid_languages
    for lang in &config.forbid_languages {
        if !index.languages.contains_key(lang) {
            passed.push(format!("forbid_language: {} not present", lang));
        } else {
            let offenders: Vec<String> = index
                .files
                .iter()
                .filter(|f| f.lang == *lang)
                .map(|f| f.path.clone())
                .collect();
            violations.push(PolicyViolation {
                rule: "forbid_language".to_string(),
                message: format!(
                    "Forbidden language '{}' found in {} file(s)",
                    lang,
                    offenders.len()
                ),
                files: offenders,
                severity: Severity::Error,
            });
        }
    }

    // Rule: dependency_deny_list
    if !config.dependency_deny_list.is_empty()
        && let Some(ref deps) = index.dependencies
    {
        for denied in &config.dependency_deny_list {
            let mut found_in = Vec::new();
            for dep_list in deps.ecosystems.values() {
                for dep in dep_list {
                    if dep.name == *denied {
                        found_in.push(dep.source_file.clone());
                    }
                }
            }
            if found_in.is_empty() {
                passed.push(format!("dependency_deny: {} not present", denied));
            } else {
                violations.push(PolicyViolation {
                    rule: "dependency_deny_list".to_string(),
                    message: format!("Denied dependency '{}' found", denied),
                    files: found_in,
                    severity: Severity::Error,
                });
            }
        }
    }

    let total_rules = passed.len() + violations.len();
    let total_violations = violations.len();

    PolicyReport {
        passed,
        violations,
        total_rules,
        total_violations,
    }
}

/// Simple TOML parser for policy config (avoids requiring toml crate as non-optional).
fn parse_policy_toml(content: &str) -> PolicyConfig {
    let mut config = PolicyConfig::default();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('[') {
            continue;
        }

        if let Some((key, value)) = trimmed.split_once('=') {
            let key = key.trim();
            let value = value.trim();

            match key {
                "max_file_size" => {
                    config.max_file_size = value.parse().unwrap_or(0);
                }
                "max_file_loc" => {
                    config.max_file_loc = value.parse().unwrap_or(0);
                }
                "max_complexity" => {
                    config.max_complexity = value.parse().unwrap_or(0);
                }
                "max_unknown_ratio" => {
                    config.max_unknown_ratio = value.parse().unwrap_or(0.0);
                }
                "require_languages" => {
                    config.require_languages = parse_toml_string_array(value);
                }
                "forbid_languages" => {
                    config.forbid_languages = parse_toml_string_array(value);
                }
                "dependency_deny_list" => {
                    config.dependency_deny_list = parse_toml_string_array(value);
                }
                _ => {}
            }
        }
    }

    config
}

fn parse_toml_string_array(value: &str) -> Vec<String> {
    let trimmed = value.trim();
    if !trimmed.starts_with('[') || !trimmed.ends_with(']') {
        return vec![];
    }
    trimmed[1..trimmed.len() - 1]
        .split(',')
        .map(|s| s.trim().trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{FileNode, RepoStats};
    use std::collections::BTreeMap;

    fn make_index() -> XrayIndex {
        XrayIndex {
            schema_version: "1.2.0".to_string(),
            root: "test".to_string(),
            target: ".".to_string(),
            files: vec![
                FileNode {
                    path: "big.rs".to_string(),
                    size: 200_000,
                    hash: "h1".to_string(),
                    lang: "Rust".to_string(),
                    loc: 5000,
                    complexity: 100,
                    functions: None,
                    max_depth: None,
                },
                FileNode {
                    path: "small.py".to_string(),
                    size: 100,
                    hash: "h2".to_string(),
                    lang: "Python".to_string(),
                    loc: 10,
                    complexity: 2,
                    functions: None,
                    max_depth: None,
                },
            ],
            languages: BTreeMap::from([("Rust".to_string(), 1), ("Python".to_string(), 1)]),
            top_dirs: BTreeMap::from([(".".to_string(), 2)]),
            module_files: vec![],
            stats: RepoStats {
                file_count: 2,
                total_size: 200_100,
            },
            digest: "test".to_string(),
            prev_digest: None,
            changed_files: None,
            call_graph_summary: None,
            dependencies: None,
            fingerprint: None,
        }
    }

    #[test]
    fn test_max_file_size_violation() {
        let index = make_index();
        let config = PolicyConfig {
            max_file_size: 100_000,
            ..Default::default()
        };
        let report = evaluate(&index, &config);
        assert_eq!(report.total_violations, 1);
        assert_eq!(report.violations[0].rule, "max_file_size");
        assert_eq!(report.violations[0].files, vec!["big.rs"]);
    }

    #[test]
    fn test_require_language_pass_and_fail() {
        let index = make_index();
        let config = PolicyConfig {
            require_languages: vec!["Rust".to_string(), "Go".to_string()],
            ..Default::default()
        };
        let report = evaluate(&index, &config);
        // Rust should pass, Go should fail
        assert!(report.passed.iter().any(|p| p.contains("Rust")));
        assert_eq!(report.violations.len(), 1);
        assert!(report.violations[0].message.contains("Go"));
    }

    #[test]
    fn test_forbid_language() {
        let index = make_index();
        let config = PolicyConfig {
            forbid_languages: vec!["Python".to_string()],
            ..Default::default()
        };
        let report = evaluate(&index, &config);
        assert_eq!(report.violations.len(), 1);
        assert_eq!(report.violations[0].files, vec!["small.py"]);
    }

    #[test]
    fn test_parse_policy_toml() {
        let toml = r#"
# Policy config
max_file_size = 100000
max_file_loc = 500
require_languages = ["Rust", "Go"]
forbid_languages = ["Python"]
dependency_deny_list = ["leftpad"]
"#;
        let config = parse_policy_toml(toml);
        assert_eq!(config.max_file_size, 100_000);
        assert_eq!(config.max_file_loc, 500);
        assert_eq!(config.require_languages, vec!["Rust", "Go"]);
        assert_eq!(config.forbid_languages, vec!["Python"]);
        assert_eq!(config.dependency_deny_list, vec!["leftpad"]);
    }

    #[test]
    fn test_all_rules_pass() {
        let index = make_index();
        let config = PolicyConfig {
            max_file_size: 1_000_000,
            max_file_loc: 10_000,
            max_complexity: 200,
            require_languages: vec!["Rust".to_string()],
            ..Default::default()
        };
        let report = evaluate(&index, &config);
        assert_eq!(report.total_violations, 0);
        assert!(report.passed.len() >= 4);
    }
}
