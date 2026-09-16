// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// A single dependency entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub dev_only: bool,
    pub source_file: String,
}

/// Inventory of dependencies grouped by ecosystem.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DependencyInventory {
    /// Ecosystem name → list of dependencies (e.g., "cargo", "npm", "go")
    pub ecosystems: BTreeMap<String, Vec<Dependency>>,
    pub total_direct: usize,
    pub total_dev: usize,
}

/// Analyze dependency files found at the given paths.
/// `module_files` should be the list from XrayIndex.module_files.
/// `root` is the scan target directory.
pub fn analyze_dependencies(root: &Path, module_files: &[String]) -> Result<DependencyInventory> {
    let mut ecosystems: BTreeMap<String, Vec<Dependency>> = BTreeMap::new();

    for mf in module_files {
        let path = root.join(mf);
        if !path.exists() {
            continue;
        }

        match mf.as_str() {
            "Cargo.toml" => {
                if let Ok(deps) = parse_cargo_toml(&path) {
                    ecosystems
                        .entry("cargo".to_string())
                        .or_default()
                        .extend(deps);
                }
            }
            "package.json" => {
                if let Ok(deps) = parse_package_json(&path) {
                    ecosystems
                        .entry("npm".to_string())
                        .or_default()
                        .extend(deps);
                }
            }
            "go.mod" => {
                if let Ok(deps) = parse_go_mod(&path) {
                    ecosystems.entry("go".to_string()).or_default().extend(deps);
                }
            }
            _ => {}
        }
    }

    let mut total_direct = 0;
    let mut total_dev = 0;
    for deps in ecosystems.values() {
        for d in deps {
            if d.dev_only {
                total_dev += 1;
            } else {
                total_direct += 1;
            }
        }
    }

    Ok(DependencyInventory {
        ecosystems,
        total_direct,
        total_dev,
    })
}

fn parse_cargo_toml(path: &Path) -> Result<Vec<Dependency>> {
    let content = std::fs::read_to_string(path).context("Failed to read Cargo.toml")?;
    let table: serde_json::Value = toml_to_json(&content)?;
    let source_file = "Cargo.toml".to_string();

    let mut deps = Vec::new();

    if let Some(dep_table) = table.get("dependencies").and_then(|v| v.as_object()) {
        for (name, value) in dep_table {
            let version = extract_cargo_version(value);
            deps.push(Dependency {
                name: name.clone(),
                version,
                dev_only: false,
                source_file: source_file.clone(),
            });
        }
    }

    if let Some(dep_table) = table.get("dev-dependencies").and_then(|v| v.as_object()) {
        for (name, value) in dep_table {
            let version = extract_cargo_version(value);
            deps.push(Dependency {
                name: name.clone(),
                version,
                dev_only: true,
                source_file: source_file.clone(),
            });
        }
    }

    deps.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(deps)
}

fn extract_cargo_version(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Object(obj) => obj
            .get("version")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        _ => None,
    }
}

fn toml_to_json(toml_str: &str) -> Result<serde_json::Value> {
    // Simple TOML parsing — extract [dependencies] and [dev-dependencies] sections
    // We parse line-by-line to avoid pulling in the full toml crate as non-optional
    let mut result = serde_json::Map::new();
    let mut current_section = String::new();
    let mut current_map = serde_json::Map::new();

    for line in toml_str.lines() {
        let trimmed = line.trim();

        // Skip comments and empty lines
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // Section header
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            // Save previous section
            if !current_section.is_empty() && !current_map.is_empty() {
                result.insert(
                    current_section.clone(),
                    serde_json::Value::Object(current_map.clone()),
                );
                current_map.clear();
            }
            current_section = trimmed[1..trimmed.len() - 1].trim().to_string();
            continue;
        }

        // Key-value pair in a relevant section
        if (current_section == "dependencies" || current_section == "dev-dependencies")
            && trimmed.contains('=')
            && let Some((key, value)) = trimmed.split_once('=')
        {
            let key = key.trim().to_string();
            let value = value.trim();

            if value.starts_with('"') && value.ends_with('"') {
                // Simple string version
                let v = value[1..value.len() - 1].to_string();
                current_map.insert(key, serde_json::Value::String(v));
            } else if value.starts_with('{') {
                // Inline table — extract version if present
                let mut obj = serde_json::Map::new();
                if let Some(ver_start) = value.find("version") {
                    let rest = &value[ver_start..];
                    if let Some(q1) = rest.find('"')
                        && let Some(q2) = rest[q1 + 1..].find('"')
                    {
                        let ver = rest[q1 + 1..q1 + 1 + q2].to_string();
                        obj.insert("version".to_string(), serde_json::Value::String(ver));
                    }
                }
                current_map.insert(key, serde_json::Value::Object(obj));
            }
        }
    }

    // Save last section
    if !current_section.is_empty() && !current_map.is_empty() {
        result.insert(current_section, serde_json::Value::Object(current_map));
    }

    Ok(serde_json::Value::Object(result))
}

fn parse_package_json(path: &Path) -> Result<Vec<Dependency>> {
    let content = std::fs::read_to_string(path).context("Failed to read package.json")?;
    let json: serde_json::Value =
        serde_json::from_str(&content).context("Failed to parse package.json")?;
    let source_file = "package.json".to_string();

    let mut deps = Vec::new();

    if let Some(dep_obj) = json.get("dependencies").and_then(|v| v.as_object()) {
        for (name, value) in dep_obj {
            deps.push(Dependency {
                name: name.clone(),
                version: value.as_str().map(|s| s.to_string()),
                dev_only: false,
                source_file: source_file.clone(),
            });
        }
    }

    if let Some(dep_obj) = json.get("devDependencies").and_then(|v| v.as_object()) {
        for (name, value) in dep_obj {
            deps.push(Dependency {
                name: name.clone(),
                version: value.as_str().map(|s| s.to_string()),
                dev_only: true,
                source_file: source_file.clone(),
            });
        }
    }

    deps.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(deps)
}

fn parse_go_mod(path: &Path) -> Result<Vec<Dependency>> {
    let content = std::fs::read_to_string(path).context("Failed to read go.mod")?;
    let source_file = "go.mod".to_string();

    let mut deps = Vec::new();
    let mut in_require = false;

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed == "require (" {
            in_require = true;
            continue;
        }
        if trimmed == ")" {
            in_require = false;
            continue;
        }

        if in_require && !trimmed.is_empty() && !trimmed.starts_with("//") {
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() >= 2 {
                deps.push(Dependency {
                    name: parts[0].to_string(),
                    version: Some(parts[1].to_string()),
                    dev_only: false,
                    source_file: source_file.clone(),
                });
            }
        }

        // Single-line require
        if trimmed.starts_with("require ") && !trimmed.contains('(') {
            let rest = trimmed.trim_start_matches("require ");
            let parts: Vec<&str> = rest.split_whitespace().collect();
            if parts.len() >= 2 {
                deps.push(Dependency {
                    name: parts[0].to_string(),
                    version: Some(parts[1].to_string()),
                    dev_only: false,
                    source_file: source_file.clone(),
                });
            }
        }
    }

    deps.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(deps)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_parse_cargo_toml() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("Cargo.toml");
        std::fs::write(
            &path,
            r#"[package]
name = "test"
version = "0.1.0"

[dependencies]
serde = "1.0"
anyhow = { version = "1.0", features = ["std"] }

[dev-dependencies]
tempfile = "3.8"
"#,
        )
        .unwrap();

        let deps = parse_cargo_toml(&path).unwrap();
        assert_eq!(deps.len(), 3);
        assert_eq!(deps[0].name, "anyhow");
        assert_eq!(deps[0].version, Some("1.0".to_string()));
        assert!(!deps[0].dev_only);
        assert_eq!(deps[1].name, "serde");
        assert_eq!(deps[2].name, "tempfile");
        assert!(deps[2].dev_only);
    }

    #[test]
    fn test_parse_package_json() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("package.json");
        std::fs::write(
            &path,
            r#"{
  "name": "test",
  "dependencies": {
    "react": "^18.0.0",
    "express": "^4.18.0"
  },
  "devDependencies": {
    "jest": "^29.0.0"
  }
}"#,
        )
        .unwrap();

        let deps = parse_package_json(&path).unwrap();
        assert_eq!(deps.len(), 3);
        assert_eq!(deps[0].name, "express");
        assert!(!deps[0].dev_only);
        assert_eq!(deps[2].name, "react");
        assert!(!deps[2].dev_only);
        assert_eq!(deps[1].name, "jest");
        assert!(deps[1].dev_only);
    }

    #[test]
    fn test_parse_go_mod() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("go.mod");
        std::fs::write(
            &path,
            r#"module example.com/myapp

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
	golang.org/x/text v0.14.0
)
"#,
        )
        .unwrap();

        let deps = parse_go_mod(&path).unwrap();
        assert_eq!(deps.len(), 2);
        assert_eq!(deps[0].name, "github.com/gin-gonic/gin");
        assert_eq!(deps[0].version, Some("v1.9.1".to_string()));
        assert_eq!(deps[1].name, "golang.org/x/text");
    }

    #[test]
    fn test_analyze_dependencies() {
        let dir = TempDir::new().unwrap();
        std::fs::write(
            dir.path().join("package.json"),
            r#"{"dependencies":{"react":"^18"},"devDependencies":{"jest":"^29"}}"#,
        )
        .unwrap();

        let inv = analyze_dependencies(dir.path(), &["package.json".to_string()]).unwrap();
        assert_eq!(inv.ecosystems.len(), 1);
        assert!(inv.ecosystems.contains_key("npm"));
        assert_eq!(inv.total_direct, 1);
        assert_eq!(inv.total_dev, 1);
    }
}
