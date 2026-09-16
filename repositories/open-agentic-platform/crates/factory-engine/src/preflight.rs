// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/075-factory-workflow-engine/spec.md — FR-010

//! Pre-flight checker — validates inputs before a Factory pipeline starts.
//!
//! Checks that the Build Spec and adapter manifest are valid, that the adapter's
//! capabilities satisfy the Build Spec requirements, and that required files
//! (agents, patterns, scaffold) exist.

use crate::checks::CheckResult;
use factory_contracts::adapter_manifest::Severity;
use sha2::{Digest, Sha256};
use std::path::Path;

/// SHA-256 hash of a file, hex-encoded.
pub fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut hasher = Sha256::new();
    let mut file = std::fs::File::open(path)?;
    std::io::copy(&mut file, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// Run all pre-flight checks. Returns list of CheckResults.
///
/// Checks PF-001 through PF-007 matching the Python harness behavior.
pub fn run_preflight(
    build_spec_path: &Path,
    adapter_path: &Path,
    artifacts_path: Option<&Path>,
) -> Vec<CheckResult> {
    let mut results = Vec::new();

    // PF-001: Build Spec exists and is valid YAML
    if !build_spec_path.exists() {
        results.push(CheckResult::fail(
            "PF-001",
            format!("Build Spec not found: {}", build_spec_path.display()),
            Severity::Error,
        ));
        return results;
    }

    let build_spec: serde_yaml::Value = match std::fs::read_to_string(build_spec_path)
        .map_err(|e| e.to_string())
        .and_then(|s| serde_yaml::from_str(&s).map_err(|e| e.to_string()))
    {
        Ok(v) => {
            results.push(CheckResult::pass(
                "PF-001",
                "Build Spec is valid YAML",
                Severity::Error,
            ));
            v
        }
        Err(e) => {
            results.push(CheckResult::fail(
                "PF-001",
                format!("Build Spec invalid: {e}"),
                Severity::Error,
            ));
            return results;
        }
    };

    // PF-002: Adapter manifest exists and is valid YAML
    let manifest_path = adapter_path.join("manifest.yaml");
    if !manifest_path.exists() {
        results.push(CheckResult::fail(
            "PF-002",
            format!("Adapter manifest not found: {}", manifest_path.display()),
            Severity::Error,
        ));
        return results;
    }

    let manifest: serde_yaml::Value = match std::fs::read_to_string(&manifest_path)
        .map_err(|e| e.to_string())
        .and_then(|s| serde_yaml::from_str(&s).map_err(|e| e.to_string()))
    {
        Ok(v) => {
            results.push(CheckResult::pass(
                "PF-002",
                "Adapter manifest is valid YAML",
                Severity::Error,
            ));
            v
        }
        Err(e) => {
            results.push(CheckResult::fail(
                "PF-002",
                format!("Adapter manifest invalid: {e}"),
                Severity::Error,
            ));
            return results;
        }
    };

    // PF-003: Capability checks
    results.extend(check_capabilities(&build_spec, &manifest));

    // PF-004: Scaffold source.
    //
    // Two shapes per adapter_manifest::ScaffoldSource:
    //   • Local(path)      — vendored scaffold; verify the directory exists
    //                        under the adapter root.
    //   • Upstream {…}     — pointer-not-repo; statecraft fetches and seeds
    //                        the project at create/import time. OPC never
    //                        resolves the pointer, so PF-004 is N/A.
    let scaffold = manifest.get("scaffold").and_then(|s| s.get("source"));
    match scaffold {
        Some(serde_yaml::Value::String(path)) if !path.is_empty() => {
            let scaffold_path = adapter_path.join(path);
            if scaffold_path.exists() {
                results.push(CheckResult::pass(
                    "PF-004",
                    format!("Scaffold directory exists: {}", scaffold_path.display()),
                    Severity::Error,
                ));
            } else {
                results.push(CheckResult::fail(
                    "PF-004",
                    format!("Scaffold not found: {}", scaffold_path.display()),
                    Severity::Warning,
                ));
            }
        }
        Some(serde_yaml::Value::Mapping(_)) => {
            results.push(CheckResult::pass(
                "PF-004",
                "Scaffold source is an upstream pointer; provisioning is statecraft-owned"
                    .to_string(),
                Severity::Error,
            ));
        }
        _ => {
            // Treat missing/empty as the legacy default for back-compat.
            let scaffold_path = adapter_path.join("scaffold/");
            if scaffold_path.exists() {
                results.push(CheckResult::pass(
                    "PF-004",
                    format!("Scaffold directory exists: {}", scaffold_path.display()),
                    Severity::Error,
                ));
            } else {
                results.push(CheckResult::fail(
                    "PF-004",
                    format!("Scaffold not found: {}", scaffold_path.display()),
                    Severity::Warning,
                ));
            }
        }
    }

    // PF-005: Required agent prompts exist
    let agents = manifest.get("agents");
    let required_agents = [
        "api_scaffolder",
        "ui_scaffolder",
        "data_scaffolder",
        "configurer",
        "trimmer",
    ];
    for agent_key in &required_agents {
        let agent_file = agents
            .and_then(|a| a.get(*agent_key))
            .and_then(|v| v.as_str());
        match agent_file {
            Some(file) => {
                let agent_path = adapter_path.join(file);
                if agent_path.exists() {
                    results.push(CheckResult::pass(
                        "PF-005",
                        format!("Agent exists: {agent_key}"),
                        Severity::Error,
                    ));
                } else {
                    results.push(CheckResult::fail(
                        "PF-005",
                        format!("Agent not found: {}", agent_path.display()),
                        Severity::Error,
                    ));
                }
            }
            None => {
                results.push(CheckResult::fail(
                    "PF-005",
                    format!("Agent not declared: {agent_key}"),
                    Severity::Error,
                ));
            }
        }
    }

    // PF-006: Pattern files exist
    if let Some(patterns) = manifest.get("patterns")
        && let Some(map) = patterns.as_mapping()
    {
        for (category, entries) in map {
            if let Some(entry_map) = entries.as_mapping() {
                for (name, path_val) in entry_map {
                    if let Some(path_str) = path_val.as_str() {
                        let pattern_path = adapter_path.join(path_str);
                        if !pattern_path.exists() {
                            let cat = category.as_str().unwrap_or("?");
                            let n = name.as_str().unwrap_or("?");
                            results.push(CheckResult::fail(
                                "PF-006",
                                format!(
                                    "Pattern not found: {cat}.{n} → {}",
                                    pattern_path.display()
                                ),
                                Severity::Warning,
                            ));
                        }
                    }
                }
            }
        }
    }

    // PF-007: Business artifacts exist (if path provided)
    if let Some(ap) = artifacts_path {
        let has_files = ap.exists()
            && std::fs::read_dir(ap)
                .map(|mut d| d.next().is_some())
                .unwrap_or(false);
        if has_files {
            results.push(CheckResult::pass(
                "PF-007",
                format!("Business artifacts found in {}", ap.display()),
                Severity::Error,
            ));
        } else {
            results.push(CheckResult::fail(
                "PF-007",
                format!("No business artifacts in {}", ap.display()),
                Severity::Error,
            ));
        }
    }

    results
}

/// Check that the adapter's capabilities satisfy the Build Spec requirements.
fn check_capabilities(
    build_spec: &serde_yaml::Value,
    manifest: &serde_yaml::Value,
) -> Vec<CheckResult> {
    let mut results = Vec::new();
    let caps = manifest
        .get("capabilities")
        .cloned()
        .unwrap_or(serde_yaml::Value::Mapping(Default::default()));

    let project = build_spec.get("project");
    let auth = build_spec.get("auth");

    // Variant check
    let variant = project
        .and_then(|p| p.get("variant"))
        .and_then(|v| v.as_str())
        .unwrap_or("single-public");

    if variant == "dual" && !yaml_bool(&caps, "dual_stack") {
        results.push(CheckResult::fail(
            "PF-003",
            "Build Spec requires dual variant but adapter lacks dual_stack capability",
            Severity::Error,
        ));
    } else if variant.starts_with("single") && !yaml_bool(&caps, "single_stack") {
        results.push(CheckResult::fail(
            "PF-003",
            format!("Build Spec requires {variant} but adapter lacks single_stack capability"),
            Severity::Error,
        ));
    } else {
        results.push(CheckResult::pass(
            "PF-003",
            format!("Variant '{variant}' supported"),
            Severity::Error,
        ));
    }

    // Auth method checks
    let supported_methods: std::collections::HashSet<String> = manifest
        .get("supported_auth")
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|a| a.get("method").and_then(|m| m.as_str()))
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();

    if let Some(audiences) = auth
        .and_then(|a| a.get("audiences"))
        .and_then(|a| a.as_mapping())
    {
        for (audience_name, audience_cfg) in audiences {
            let method = audience_cfg
                .get("method")
                .and_then(|m| m.as_str())
                .unwrap_or("");
            let name = audience_name.as_str().unwrap_or("?");

            if !method.is_empty() && method != "mock" && !supported_methods.contains(method) {
                results.push(CheckResult::fail(
                    "PF-003",
                    format!(
                        "Auth method '{method}' (audience '{name}') not in adapter supported_auth"
                    ),
                    Severity::Error,
                ));
            } else if !method.is_empty() && method != "mock" {
                results.push(CheckResult::pass(
                    "PF-003",
                    format!("Auth method '{method}' (audience '{name}') supported"),
                    Severity::Error,
                ));
            }
        }
    }

    // Integration capability checks
    if let Some(integrations) = build_spec.get("integrations").and_then(|i| i.as_sequence()) {
        for integration in integrations {
            let int_type = integration
                .get("type")
                .and_then(|t| t.as_str())
                .unwrap_or("");
            let int_name = integration
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("?");

            if int_type == "file-storage" && !yaml_bool(&caps, "file_uploads") {
                results.push(CheckResult::fail(
                    "PF-003",
                    format!("Integration '{int_name}' requires file_uploads capability"),
                    Severity::Error,
                ));
            }
            if int_type == "email" && !yaml_bool(&caps, "email_notifications") {
                results.push(CheckResult::fail(
                    "PF-003",
                    format!("Integration '{int_name}' requires email_notifications capability"),
                    Severity::Error,
                ));
            }
        }
    }

    // Audit check
    let audit_enabled = build_spec
        .get("audit")
        .and_then(|a| a.get("enabled"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if audit_enabled && !yaml_bool(&caps, "audit_logging") {
        results.push(CheckResult::fail(
            "PF-003",
            "Build Spec requires audit logging but adapter lacks audit_logging capability",
            Severity::Error,
        ));
    }

    results
}

fn yaml_bool(val: &serde_yaml::Value, key: &str) -> bool {
    val.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn write_file(dir: &TempDir, name: &str, content: &str) -> std::path::PathBuf {
        let path = dir.path().join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        path
    }

    #[test]
    fn preflight_missing_build_spec() {
        let dir = TempDir::new().unwrap();
        let results = run_preflight(&dir.path().join("nope.yaml"), dir.path(), None);
        assert_eq!(results.len(), 1);
        assert!(!results[0].passed);
        assert!(results[0].message.contains("not found"));
    }

    #[test]
    fn preflight_missing_adapter() {
        let dir = TempDir::new().unwrap();
        write_file(&dir, "spec.yaml", "project:\n  name: test\n");
        let results = run_preflight(
            &dir.path().join("spec.yaml"),
            &dir.path().join("no-adapter"),
            None,
        );
        // PF-001 passes, PF-002 fails
        assert!(results.iter().any(|r| r.id == "PF-001" && r.passed));
        assert!(results.iter().any(|r| r.id == "PF-002" && !r.passed));
    }

    #[test]
    fn preflight_capability_mismatch() {
        let dir = TempDir::new().unwrap();
        write_file(&dir, "spec.yaml", "project:\n  variant: dual\n");
        let adapter_dir = dir.path().join("adapter");
        std::fs::create_dir_all(&adapter_dir).unwrap();
        write_file(
            &dir,
            "adapter/manifest.yaml",
            "schema_version: '1.0'\ncapabilities:\n  single_stack: true\n  dual_stack: false\n",
        );
        let results = run_preflight(&dir.path().join("spec.yaml"), &adapter_dir, None);
        let cap_fail = results.iter().find(|r| r.id == "PF-003" && !r.passed);
        assert!(
            cap_fail.is_some(),
            "Expected PF-003 failure for dual variant"
        );
        assert!(cap_fail.unwrap().message.contains("dual"));
    }

    #[test]
    fn preflight_real_examples() {
        // Probes a developer's local clone of the upstream factory; spec 108
        // §8 retired the in-tree mirror, so this test skips cleanly in CI and
        // on fresh clones. A future spec will materialise the fixture from
        // factory_adapters/factory_contracts rows.
        let spec_path = std::path::Path::new(
            "../factory/contract/examples/community-grant-portal.build-spec.yaml",
        );
        let adapter_path = std::path::Path::new("../factory/adapters/acme-vue-node");
        if !spec_path.exists() || !adapter_path.exists() {
            eprintln!(
                "skipping preflight_real_examples — in-tree factory fixtures \
                 retired by spec 108 §8; runs only when a developer keeps a \
                 local checkout"
            );
            return;
        }
        let results = run_preflight(spec_path, adapter_path, None);
        // PF-001 and PF-002 must pass
        assert!(results.iter().any(|r| r.id == "PF-001" && r.passed));
        assert!(results.iter().any(|r| r.id == "PF-002" && r.passed));
    }

    #[test]
    fn hash_file_produces_hex() {
        let dir = TempDir::new().unwrap();
        let path = write_file(&dir, "data.txt", "hello world\n");
        let hash = hash_file(&path).unwrap();
        assert_eq!(hash.len(), 64); // SHA-256 hex
    }
}
