// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Process and adapter agent prompt loading.
//!
//! Reads agent prompt files from any factory layout the caller passes in:
//!   - `<root>/process/agents/`   — process agents (Tier 1 read-only)
//!   - `<root>/adapters/{name}/agents/` — scaffold agents (Tier 2 read-write)
//!
//! Per spec 108, factory definitions are sourced from the platform's
//! `factory_adapters` / `factory_processes` tables; the `<root>` is whatever
//! directory the caller materialised those rows into. This loader is
//! deliberately path-agnostic and does not assume an in-tree `factory/`.
//!
//! Delegates YAML frontmatter parsing to `agent-frontmatter` (spec 054).

use agent_frontmatter::UnifiedFrontmatter;
use std::path::{Path, PathBuf};
use thiserror::Error;

/// A loaded agent prompt ready for dispatch.
#[derive(Debug, Clone)]
pub struct AgentPrompt {
    pub id: String,
    pub role: String,
    /// 1 = read-only (process agents), 2 = read-write (scaffold agents)
    pub tier: u8,
    pub prompt_text: String,
    /// "opus" for process agents, "sonnet" for scaffold agents
    pub model_hint: Option<String>,
    pub source_path: PathBuf,
    /// Optional standards category filter (spec 055). When set, only standards
    /// matching this category are injected into the agent's system prompt.
    pub standards_category: Option<String>,
    /// Optional standards tag filter (spec 055). When set, only standards
    /// matching at least one of these tags are injected.
    pub standards_tags: Vec<String>,
}

#[derive(Debug, Error)]
pub enum LoadError {
    #[error("Agents directory not found: {0}")]
    DirNotFound(PathBuf),

    #[error("IO error reading {path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },

    #[error("Missing frontmatter in agent file: {0}")]
    MissingFrontmatter(PathBuf),

    #[error("Invalid frontmatter in {path}: {source}")]
    InvalidFrontmatter {
        path: PathBuf,
        source: serde_yaml::Error,
    },
}

/// Load all process agents from `factory_root/process/agents/`.
///
/// Process agents handle stages 1-5 and are Tier 1 (read-only).
pub fn load_process_agents(factory_root: &Path) -> Result<Vec<AgentPrompt>, LoadError> {
    let agents_dir = factory_root.join("process").join("agents");
    load_agents_from_dir(&agents_dir, 1, Some("opus"))
}

/// Load all adapter-specific agents from an adapter's `agents/` directory.
///
/// Scaffold agents are Tier 2 (read-write).
pub fn load_adapter_agents(adapter_path: &Path) -> Result<Vec<AgentPrompt>, LoadError> {
    let agents_dir = adapter_path.join("agents");
    load_agents_from_dir(&agents_dir, 2, Some("sonnet"))
}

fn load_agents_from_dir(
    agents_dir: &Path,
    default_tier: u8,
    default_model_hint: Option<&str>,
) -> Result<Vec<AgentPrompt>, LoadError> {
    if !agents_dir.exists() {
        return Err(LoadError::DirNotFound(agents_dir.to_path_buf()));
    }

    let mut agents = Vec::new();

    let entries = std::fs::read_dir(agents_dir).map_err(|e| LoadError::Io {
        path: agents_dir.to_path_buf(),
        source: e,
    })?;

    for entry in entries {
        let entry = entry.map_err(|e| LoadError::Io {
            path: agents_dir.to_path_buf(),
            source: e,
        })?;

        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "md" && ext != "txt" && ext != "prompt" {
            continue;
        }

        let contents = std::fs::read_to_string(&path).map_err(|e| LoadError::Io {
            path: path.clone(),
            source: e,
        })?;

        // One bad agent file must not erase the whole bridge — log and skip.
        // Without this the `?` propagation lets a single InvalidFrontmatter
        // collapse the registry, which downstream surfaces as the misleading
        // `agent not found: <first-step-agent>` from the orchestrator's
        // dispatch loop.
        match parse_agent_file(&path, &contents, default_tier, default_model_hint) {
            Ok(agent) => agents.push(agent),
            Err(e) => {
                eprintln!(
                    "[factory-contracts] skipping agent file {}: {e}",
                    path.display()
                );
            }
        }
    }

    agents.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(agents)
}

fn parse_agent_file(
    path: &Path,
    contents: &str,
    default_tier: u8,
    default_model_hint: Option<&str>,
) -> Result<AgentPrompt, LoadError> {
    let (frontmatter_str, prompt_text) = split_frontmatter(contents, path)?;

    let file_stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown")
        .to_string();

    // Handle files without frontmatter (derive everything from defaults).
    if frontmatter_str.is_empty() {
        return Ok(AgentPrompt {
            id: file_stem.clone(),
            role: file_stem,
            tier: default_tier,
            prompt_text: prompt_text.trim().to_string(),
            model_hint: default_model_hint.map(String::from),
            source_path: path.to_path_buf(),
            standards_category: None,
            standards_tags: vec![],
        });
    }

    // Parse via UnifiedFrontmatter from agent-frontmatter (spec 054).
    // Field aliases (id→name, role→display_name, model_hint→model, tier→safety_tier)
    // are handled automatically by the shared crate.
    let fm: UnifiedFrontmatter =
        serde_yaml::from_str(&frontmatter_str).map_err(|e| LoadError::InvalidFrontmatter {
            path: path.to_path_buf(),
            source: e,
        })?;

    let tier = fm.safety_tier.map(|st| st.as_u8()).unwrap_or(default_tier);

    Ok(AgentPrompt {
        id: fm.name,
        role: fm.display_name.unwrap_or(file_stem),
        tier,
        prompt_text: prompt_text.trim().to_string(),
        model_hint: fm.model.or_else(|| default_model_hint.map(String::from)),
        source_path: path.to_path_buf(),
        standards_category: fm.standards_category,
        standards_tags: fm.standards_tags,
    })
}

fn split_frontmatter(contents: &str, path: &Path) -> Result<(String, String), LoadError> {
    let trimmed = contents.trim_start();

    if !trimmed.starts_with("---") {
        // No frontmatter — treat entire file as prompt text, derive ID from filename
        return Ok((String::new(), contents.to_string()));
    }

    let after_first = &trimmed[3..];
    if let Some(end_idx) = after_first.find("\n---") {
        let frontmatter = after_first[..end_idx].trim().to_string();
        let prompt = after_first[end_idx + 4..].to_string();
        Ok((frontmatter, prompt))
    } else {
        Err(LoadError::MissingFrontmatter(path.to_path_buf()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_load_process_agents() {
        let dir = TempDir::new().unwrap();
        let agents_dir = dir.path().join("process").join("agents");
        fs::create_dir_all(&agents_dir).unwrap();

        fs::write(
            agents_dir.join("01-requirements.md"),
            r#"---
id: requirements-agent
role: requirements-analyst
tier: 1
model_hint: opus
---

You are a requirements analyst. Analyze the business documents and produce
a structured requirements document.
"#,
        )
        .unwrap();

        let agents = load_process_agents(dir.path()).unwrap();
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].id, "requirements-agent");
        assert_eq!(agents[0].role, "requirements-analyst");
        assert_eq!(agents[0].tier, 1);
        assert_eq!(agents[0].model_hint.as_deref(), Some("opus"));
        assert!(agents[0].prompt_text.contains("requirements analyst"));
    }

    #[test]
    fn test_load_adapter_agents() {
        let dir = TempDir::new().unwrap();
        let agents_dir = dir.path().join("agents");
        fs::create_dir_all(&agents_dir).unwrap();

        fs::write(
            agents_dir.join("scaffold.md"),
            r#"---
id: scaffold-agent
role: scaffolder
---

Generate project scaffolding based on the adapter patterns.
"#,
        )
        .unwrap();

        let agents = load_adapter_agents(dir.path()).unwrap();
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].id, "scaffold-agent");
        assert_eq!(agents[0].tier, 2);
        assert_eq!(agents[0].model_hint.as_deref(), Some("sonnet"));
    }

    #[test]
    fn test_agents_dir_not_found() {
        let dir = TempDir::new().unwrap();
        let result = load_process_agents(dir.path());
        assert!(matches!(result, Err(LoadError::DirNotFound(_))));
    }
}
