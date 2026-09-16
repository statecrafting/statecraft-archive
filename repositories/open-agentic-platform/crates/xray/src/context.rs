// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use crate::history;
use crate::schema::XrayIndex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Configuration for context budget optimization.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextBudget {
    /// Maximum approximate tokens (1 LOC ≈ 10 tokens).
    pub max_tokens: usize,
    /// Natural language task description for relevance ranking.
    pub task: String,
}

/// A recommended file to include in context.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextFile {
    pub path: String,
    pub loc: u64,
    pub estimated_tokens: usize,
    pub relevance: f64,
    pub reason: String,
}

/// The optimized context plan.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPlan {
    pub files: Vec<ContextFile>,
    pub total_loc: u64,
    pub estimated_tokens: usize,
    pub files_included: usize,
    pub files_total: usize,
}

const TOKENS_PER_LOC: usize = 10;

/// Build a context plan from an xray index, task description, and token budget.
/// Uses heuristic ranking (keyword matching, churn data, entry points, file size).
pub fn build_context_plan(
    index: &XrayIndex,
    budget: &ContextBudget,
    history_path: Option<&Path>,
) -> ContextPlan {
    let task_lower = budget.task.to_lowercase();
    let task_words: Vec<&str> = task_lower.split_whitespace().collect();

    // Load churn data if available
    let churn_counts = load_churn_map(history_path);

    // Load entry points if call graph summary available
    let entry_points: std::collections::HashSet<String> = index
        .call_graph_summary
        .as_ref()
        .map(|cg| cg.entry_points.iter().cloned().collect())
        .unwrap_or_default();

    // Score each file
    let mut scored: Vec<(f64, String, &crate::schema::FileNode)> = index
        .files
        .iter()
        .filter(|f| f.loc > 0) // skip binary/empty files
        .map(|f| {
            let mut relevance = 0.0;
            let mut reasons = Vec::new();
            let path_lower = f.path.to_lowercase();

            // 1. Keyword match in path (strongest signal)
            let keyword_hits: usize = task_words
                .iter()
                .filter(|w| w.len() >= 3 && path_lower.contains(**w))
                .count();
            if keyword_hits > 0 {
                relevance += 0.4 * (keyword_hits as f64).min(3.0);
                reasons.push(format!("{} keyword match(es) in path", keyword_hits));
            }

            // 2. Language match (if task mentions a language)
            let lang_lower = f.lang.to_lowercase();
            if task_words.iter().any(|w| lang_lower.contains(w)) {
                relevance += 0.2;
                reasons.push("language match".to_string());
            }

            // 3. Churn boost (high-churn files are likely important)
            if let Some(churn) = churn_counts.get(&f.path) {
                let churn_score = (*churn as f64).min(10.0) / 10.0 * 0.2;
                relevance += churn_score;
                reasons.push(format!("churn={}", churn));
            }

            // 4. Entry point boost
            if entry_points.iter().any(|ep| ep.contains(&f.path)) {
                relevance += 0.3;
                reasons.push("entry point".to_string());
            }

            // 5. Complexity boost (complex files contain more logic)
            if f.complexity > 0 {
                let complexity_score = (f.complexity as f64).min(50.0) / 50.0 * 0.15;
                relevance += complexity_score;
                if f.complexity > 10 {
                    reasons.push(format!("complexity={}", f.complexity));
                }
            }

            // 6. Config/module file boost
            if matches!(
                f.path.as_str(),
                "Cargo.toml" | "package.json" | "go.mod" | "Makefile" | "Dockerfile" | "README.md"
            ) {
                relevance += 0.1;
                reasons.push("config file".to_string());
            }

            // 7. Size penalty for very large files (>500 LOC costs more budget)
            if f.loc > 500 {
                relevance -= 0.05;
            }

            let reason = if reasons.is_empty() {
                "baseline".to_string()
            } else {
                reasons.join(", ")
            };

            (relevance, reason, f)
        })
        .collect();

    // Sort by relevance descending
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    // Greedily fill budget
    let mut plan_files = Vec::new();
    let mut total_tokens = 0usize;
    let mut total_loc = 0u64;

    for (relevance, reason, f) in &scored {
        let file_tokens = f.loc as usize * TOKENS_PER_LOC;
        if total_tokens + file_tokens > budget.max_tokens && !plan_files.is_empty() {
            break;
        }

        plan_files.push(ContextFile {
            path: f.path.clone(),
            loc: f.loc,
            estimated_tokens: file_tokens,
            relevance: *relevance,
            reason: reason.clone(),
        });
        total_tokens += file_tokens;
        total_loc += f.loc;
    }

    ContextPlan {
        files_included: plan_files.len(),
        files_total: index.files.len(),
        files: plan_files,
        total_loc,
        estimated_tokens: total_tokens,
    }
}

fn load_churn_map(history_path: Option<&Path>) -> HashMap<String, usize> {
    let Some(path) = history_path else {
        return HashMap::new();
    };
    let Ok(entries) = history::load_history(path) else {
        return HashMap::new();
    };

    let mut counts = HashMap::new();
    for entry in &entries {
        for file in &entry.changed_files {
            *counts.entry(file.clone()).or_insert(0) += 1;
        }
    }
    counts
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{FileNode, RepoStats};
    use std::collections::BTreeMap;

    fn make_test_index() -> XrayIndex {
        XrayIndex {
            schema_version: "1.2.0".to_string(),
            root: "test".to_string(),
            target: ".".to_string(),
            files: vec![
                FileNode {
                    path: "src/auth.rs".to_string(),
                    size: 500,
                    hash: "h1".to_string(),
                    lang: "Rust".to_string(),
                    loc: 50,
                    complexity: 15,
                    functions: None,
                    max_depth: None,
                },
                FileNode {
                    path: "src/main.rs".to_string(),
                    size: 200,
                    hash: "h2".to_string(),
                    lang: "Rust".to_string(),
                    loc: 20,
                    complexity: 5,
                    functions: None,
                    max_depth: None,
                },
                FileNode {
                    path: "tests/test_auth.rs".to_string(),
                    size: 300,
                    hash: "h3".to_string(),
                    lang: "Rust".to_string(),
                    loc: 30,
                    complexity: 3,
                    functions: None,
                    max_depth: None,
                },
                FileNode {
                    path: "README.md".to_string(),
                    size: 100,
                    hash: "h4".to_string(),
                    lang: "Markdown".to_string(),
                    loc: 10,
                    complexity: 0,
                    functions: None,
                    max_depth: None,
                },
            ],
            languages: BTreeMap::from([("Rust".to_string(), 3), ("Markdown".to_string(), 1)]),
            top_dirs: BTreeMap::from([
                ("src".to_string(), 2),
                ("tests".to_string(), 1),
                (".".to_string(), 1),
            ]),
            module_files: vec![],
            stats: RepoStats {
                file_count: 4,
                total_size: 1100,
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
    fn test_context_plan_keyword_ranking() {
        let index = make_test_index();
        let budget = ContextBudget {
            max_tokens: 10000,
            task: "fix the auth login bug".to_string(),
        };

        let plan = build_context_plan(&index, &budget, None);
        // auth.rs should rank highest (keyword "auth" in path)
        assert_eq!(plan.files[0].path, "src/auth.rs");
        assert!(plan.files[0].relevance > plan.files.last().unwrap().relevance);
    }

    #[test]
    fn test_context_plan_budget_limit() {
        let index = make_test_index();
        let budget = ContextBudget {
            max_tokens: 300, // Only ~30 LOC budget
            task: "anything".to_string(),
        };

        let plan = build_context_plan(&index, &budget, None);
        assert!(plan.estimated_tokens <= 600); // Allows first file even if over budget
        assert!(plan.files_included < plan.files_total);
    }

    #[test]
    fn test_context_plan_includes_all_when_budget_large() {
        let index = make_test_index();
        let budget = ContextBudget {
            max_tokens: 100_000,
            task: "review everything".to_string(),
        };

        let plan = build_context_plan(&index, &budget, None);
        assert_eq!(plan.files_included, 4);
    }
}
