//! Tool and infrastructure scanner (Layer 4).
//!
//! Cut D W-07a lift target: mirrors pre-W-07c
//! `tools/codebase-indexer/src/infra.rs`. W-07c removes the duplicate
//! from the generic indexer.

use crate::types::{Infrastructure, NamedEntry, ToolEntry};
use open_agentic_spec_types::split_frontmatter_optional;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub fn scan_infrastructure(repo_root: &Path) -> Infrastructure {
    Infrastructure {
        tools: scan_tools(repo_root),
        agents: scan_agents(repo_root),
        commands: scan_commands(repo_root),
        rules: scan_rules(repo_root),
        schemas: scan_schemas(repo_root),
    }
}

fn scan_tools(repo_root: &Path) -> Vec<ToolEntry> {
    let tools_dir = repo_root.join("tools");
    if !tools_dir.is_dir() {
        return vec![];
    }

    let mut entries = Vec::new();
    let mut dirs: Vec<_> = fs::read_dir(&tools_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir())
        .collect();
    dirs.sort_by_key(|e| e.file_name());

    for ent in dirs {
        let dir = ent.path();
        let name = dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if name == "shared" {
            continue;
        }
        let toml_path = dir.join("Cargo.toml");
        if !toml_path.is_file() {
            continue;
        }
        let binaries = extract_bin_targets(&toml_path);
        entries.push(ToolEntry {
            name,
            path: normalize_path(repo_root, &dir),
            binaries: if binaries.is_empty() {
                None
            } else {
                Some(binaries)
            },
        });
    }
    entries
}

fn extract_bin_targets(path: &Path) -> Vec<String> {
    let Ok(raw) = fs::read_to_string(path) else {
        return vec![];
    };
    let Ok(doc) = raw.parse::<toml::Value>() else {
        return vec![];
    };

    if let Some(bins) = doc.get("bin").and_then(|v| v.as_array()) {
        let mut names: Vec<String> = bins
            .iter()
            .filter_map(|b| {
                b.get("name")
                    .and_then(|n| n.as_str())
                    .map(|s| s.to_string())
            })
            .collect();
        names.sort();
        return names;
    }

    let dir = path.parent().unwrap_or(Path::new("."));
    if dir.join("src/main.rs").is_file() {
        if let Some(name) = doc
            .get("package")
            .and_then(|p| p.get("name"))
            .and_then(|n| n.as_str())
        {
            return vec![name.to_string()];
        }
    }
    vec![]
}

fn scan_agents(repo_root: &Path) -> Vec<NamedEntry> {
    scan_md_with_frontmatter(&repo_root.join(".claude/agents"), repo_root, false)
}

fn scan_commands(repo_root: &Path) -> Vec<NamedEntry> {
    scan_md_with_frontmatter(&repo_root.join(".claude/commands"), repo_root, true)
}

fn scan_rules(repo_root: &Path) -> Vec<NamedEntry> {
    let rules_dir = repo_root.join(".claude/rules");
    if !rules_dir.is_dir() {
        return vec![];
    }
    let mut entries = Vec::new();
    let mut files: Vec<_> = fs::read_dir(&rules_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| {
            e.path().is_file() && (e.path().extension().and_then(|ext| ext.to_str()) == Some("md"))
        })
        .collect();
    files.sort_by_key(|e| e.file_name());
    for ent in files {
        let p = ent.path();
        let name = p
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        entries.push(NamedEntry {
            name,
            path: normalize_path(repo_root, &p),
            description: None,
        });
    }
    entries
}

fn scan_schemas(repo_root: &Path) -> Vec<NamedEntry> {
    let schemas_dir = repo_root.join("standards/schemas");
    if !schemas_dir.is_dir() {
        return vec![];
    }
    let mut files: Vec<PathBuf> = Vec::new();
    collect_schema_files(&schemas_dir, &mut files);
    files.sort();
    let mut entries = Vec::new();
    for p in files {
        let name = p
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let description = fs::read_to_string(&p)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .and_then(|doc| {
                doc.get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            });
        entries.push(NamedEntry {
            name,
            path: normalize_path(repo_root, &p),
            description,
        });
    }
    entries
}

fn collect_schema_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(read) = fs::read_dir(dir) else {
        return;
    };
    for ent in read.flatten() {
        let p = ent.path();
        if p.is_dir() {
            collect_schema_files(&p, out);
        } else if p.extension().and_then(|ext| ext.to_str()) == Some("json") {
            out.push(p);
        }
    }
}

fn scan_md_with_frontmatter(dir: &Path, repo_root: &Path, recursive: bool) -> Vec<NamedEntry> {
    if !dir.is_dir() {
        return vec![];
    }
    let mut entries = Vec::new();

    let walker: Box<dyn Iterator<Item = walkdir::DirEntry>> = if recursive {
        Box::new(
            WalkDir::new(dir)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_file()),
        )
    } else {
        Box::new(
            WalkDir::new(dir)
                .max_depth(1)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_file()),
        )
    };

    let mut files: Vec<walkdir::DirEntry> = walker
        .filter(|e| e.path().extension().and_then(|ext| ext.to_str()) == Some("md"))
        .collect();
    files.sort_by_key(|e| e.path().to_path_buf());

    for ent in files {
        let p = ent.path().to_path_buf();
        let fallback_name = p
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();

        let (name, description) = if let Ok(raw) = fs::read_to_string(&p) {
            if let Some((yaml_val, _)) = split_frontmatter_optional(&raw) {
                let fm = yaml_val.as_mapping();
                let n = fm
                    .and_then(|m| m.get("name"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or(fallback_name);
                let d = fm
                    .and_then(|m| m.get("description"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                (n, d)
            } else {
                (fallback_name, None)
            }
        } else {
            (fallback_name, None)
        };

        entries.push(NamedEntry {
            name,
            path: normalize_path(repo_root, &p),
            description,
        });
    }
    entries
}

fn normalize_path(repo_root: &Path, path: &Path) -> String {
    path.strip_prefix(repo_root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}
