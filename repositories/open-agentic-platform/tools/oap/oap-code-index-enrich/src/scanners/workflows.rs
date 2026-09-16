//! Workflow-to-spec traceability scanner per spec 118.
//!
//! Cut D W-07a lift target: mirrors pre-W-07c
//! `tools/codebase-indexer/src/workflows.rs`. W-07c removes the
//! duplicate from the generic indexer.

use crate::types::{EnrichDiagnostic, WorkflowTrace, WorkflowTraceSource};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

const HEADER_SCAN_LINES: usize = 20;

#[derive(Deserialize, Default)]
struct AllowlistDoc {
    #[serde(default)]
    allowlist: Vec<AllowlistEntry>,
}

#[derive(Deserialize)]
struct AllowlistEntry {
    path: String,
    #[allow(dead_code)]
    reason: String,
    #[serde(default)]
    spec: Option<String>,
}

pub struct ScanResult {
    pub traces: Vec<WorkflowTrace>,
    pub diagnostics: Vec<EnrichDiagnostic>,
}

pub fn scan_workflows(repo_root: &Path) -> ScanResult {
    let workflows_dir = repo_root.join(".github/workflows");
    let mut traces: Vec<WorkflowTrace> = Vec::new();
    let mut diagnostics: Vec<EnrichDiagnostic> = Vec::new();

    let allowlist = load_allowlist(repo_root);

    if !workflows_dir.is_dir() {
        return ScanResult {
            traces,
            diagnostics,
        };
    }

    let mut workflow_paths: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(&workflows_dir) {
        for ent in entries.flatten() {
            let p = ent.path();
            if !p.is_file() {
                continue;
            }
            let ext = p.extension().and_then(|e| e.to_str());
            if ext != Some("yml") && ext != Some("yaml") {
                continue;
            }
            workflow_paths.push(p);
        }
    }
    workflow_paths.sort();

    for path in workflow_paths {
        let rel = relative_to_repo(&path, repo_root);
        let header_specs = parse_header_specs(&path);
        let allowlist_hit = allowlist.iter().find(|a| a.path == rel);

        let (specs, source) = if !header_specs.is_empty() {
            (header_specs, WorkflowTraceSource::Header)
        } else if let Some(entry) = allowlist_hit {
            let allow_specs: Vec<String> = entry.spec.iter().cloned().collect();
            (allow_specs, WorkflowTraceSource::Allowlist)
        } else {
            diagnostics.push(EnrichDiagnostic {
                code: "I-105".into(),
                message: format!(
                    "workflow {rel} declares no `# Spec: NNN-slug` header and is not listed in workflow-allowlist.toml"
                ),
                path: Some(rel.clone()),
            });
            (Vec::new(), WorkflowTraceSource::Unmapped)
        };

        traces.push(WorkflowTrace {
            path: rel,
            specs,
            source,
        });
    }

    ScanResult {
        traces,
        diagnostics,
    }
}

fn parse_header_specs(path: &Path) -> Vec<String> {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for (idx, line) in raw.lines().enumerate() {
        if idx >= HEADER_SCAN_LINES {
            break;
        }
        let trimmed = line.trim_start();
        if !trimmed.starts_with('#') {
            continue;
        }
        let after_hash = trimmed.trim_start_matches('#').trim_start();
        if let Some(rest) = after_hash.strip_prefix("Spec:") {
            let slug = rest.trim();
            if !slug.is_empty() {
                out.push(slug.to_string());
            }
        }
    }
    out
}

fn load_allowlist(repo_root: &Path) -> Vec<AllowlistEntry> {
    // The allowlist file ships under tools/codebase-indexer/ in main;
    // post-W-07c the enricher remains the consumer but the file's
    // physical location is not renamed (out of scope per autonomous brief).
    let path = repo_root.join("tools/codebase-indexer/workflow-allowlist.toml");
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let doc: AllowlistDoc = match toml::from_str(&raw) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    doc.allowlist
}

fn relative_to_repo(path: &Path, repo_root: &Path) -> String {
    path.strip_prefix(repo_root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}
