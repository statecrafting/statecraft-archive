//! Factory adapter scanner (Layer 3).
//!
//! Cut D W-07a lift target: this file mirrors the pre-W-07c
//! `tools/codebase-indexer/src/factory.rs`. W-07c removes the
//! duplicate from the generic indexer.

use crate::types::{AdapterRecord, EnrichDiagnostic};
use std::fs;
use std::path::Path;

/// Scan factory adapters and global pipeline stages.
pub fn scan_adapters(repo_root: &Path) -> (Vec<AdapterRecord>, Vec<EnrichDiagnostic>) {
    let mut adapters = Vec::new();
    let mut diagnostics = Vec::new();

    let phase_coverage = scan_global_stages(repo_root);

    let adapters_dir = repo_root.join("factory/adapters");
    if !adapters_dir.is_dir() {
        return (adapters, diagnostics);
    }

    let mut dirs: Vec<_> = fs::read_dir(&adapters_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir())
        .collect();
    dirs.sort_by_key(|e| e.file_name());

    for ent in dirs {
        let dir = ent.path();
        let dir_name = dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let manifest_path = dir.join("manifest.yaml");
        if !manifest_path.is_file() {
            diagnostics.push(EnrichDiagnostic {
                code: "I-200".into(),
                message: format!("adapter directory {dir_name:?} has no manifest.yaml"),
                path: Some(normalize_path(repo_root, &dir)),
            });
            adapters.push(AdapterRecord {
                name: dir_name.clone(),
                path: normalize_path(repo_root, &dir),
                target_stack: Some(dir_name),
                phase_coverage: Some(phase_coverage.clone()),
                display_name: None,
                version: None,
                stack_language: None,
                stack_runtime: None,
            });
            continue;
        }

        match parse_adapter_manifest(&manifest_path, &dir_name, repo_root, &phase_coverage) {
            Ok(record) => adapters.push(record),
            Err(msg) => {
                diagnostics.push(EnrichDiagnostic {
                    code: "I-201".into(),
                    message: format!("failed to parse manifest for {dir_name:?}: {msg}"),
                    path: Some(normalize_path(repo_root, &manifest_path)),
                });
                adapters.push(AdapterRecord {
                    name: dir_name.clone(),
                    path: normalize_path(repo_root, &dir),
                    target_stack: Some(dir_name),
                    phase_coverage: Some(phase_coverage.clone()),
                    display_name: None,
                    version: None,
                    stack_language: None,
                    stack_runtime: None,
                });
            }
        }
    }

    (adapters, diagnostics)
}

fn parse_adapter_manifest(
    path: &Path,
    dir_name: &str,
    repo_root: &Path,
    phase_coverage: &[String],
) -> Result<AdapterRecord, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let doc: serde_yaml::Value = serde_yaml::from_str(&raw).map_err(|e| e.to_string())?;

    let adapter = doc.get("adapter");
    let stack = doc.get("stack");

    let name = adapter
        .and_then(|a| a.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or(dir_name)
        .to_string();
    let display_name = adapter
        .and_then(|a| a.get("display_name"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let version = adapter
        .and_then(|a| a.get("version"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let stack_language = stack
        .and_then(|s| s.get("language"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let stack_runtime = stack
        .and_then(|s| s.get("runtime"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let dir = path.parent().unwrap_or(Path::new("."));

    Ok(AdapterRecord {
        name,
        path: normalize_path(repo_root, dir),
        target_stack: Some(dir_name.to_string()),
        phase_coverage: Some(phase_coverage.to_vec()),
        display_name,
        version,
        stack_language,
        stack_runtime,
    })
}

fn scan_global_stages(repo_root: &Path) -> Vec<String> {
    let stages_dir = repo_root.join("factory/process/stages");
    if !stages_dir.is_dir() {
        return vec![];
    }
    let mut stages: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(&stages_dir) {
        for ent in entries.flatten() {
            let p = ent.path();
            if !p.is_file() {
                continue;
            }
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext != "md" {
                continue;
            }
            if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                stages.push(stem.to_string());
            }
        }
    }
    stages.sort();
    stages
}

fn normalize_path(repo_root: &Path, path: &Path) -> String {
    path.strip_prefix(repo_root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}
