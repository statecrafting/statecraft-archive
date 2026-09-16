// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Factory project detection (spec 112).
//!
//! Determines whether a filesystem directory is a factory-produced project
//! and, if so, at what contract level. Three positive levels are recognised:
//!
//! - **L0 `ScaffoldOnly`** — template scaffolded (`template.json` present),
//!   no pipeline run yet.
//! - **L1 `LegacyProduced`** — `legacy-factory` 5-stage manifest at
//!   `requirements/audit/factory-manifest.json`, pre-ACP shape; needs
//!   translation before ACP consumers can advance it.
//! - **L2 `AcpProduced`** — ACP-conformant
//!   `.factory/pipeline-state.json` is present and parseable.
//!
//! Detection is intentionally conservative: L2 wins over L1, L1 wins over
//! L0, and the crate reports truthfully rather than gating policy. Policy
//! (e.g. Import requiring `legacy_complete == true`) is a caller concern.

use factory_contracts::PipelineState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;

pub mod legacy;

pub use legacy::{LegacyManifest, LegacyStageStatus};

// ── Public types ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DetectionLevel {
    NotFactory,
    ScaffoldOnly,
    LegacyProduced,
    AcpProduced,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdapterRef {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FactoryProject {
    pub level: DetectionLevel,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pipeline_state: Option<PipelineState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adapter_ref: Option<AdapterRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legacy_manifest: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legacy_complete: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legacy_incomplete_stages: Option<Vec<String>>,
}

impl FactoryProject {
    pub fn not_factory() -> Self {
        Self {
            level: DetectionLevel::NotFactory,
            pipeline_state: None,
            adapter_ref: None,
            legacy_manifest: None,
            legacy_complete: None,
            legacy_incomplete_stages: None,
        }
    }
}

// ── Errors ────────────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum DetectError {
    #[error("path does not exist: {0}")]
    PathMissing(PathBuf),
    #[error("path is not a directory: {0}")]
    NotDirectory(PathBuf),
    #[error("io error reading {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("malformed ACP pipeline-state.json at {path}: {source}")]
    MalformedPipelineState {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },
}

// ── Public entry point ────────────────────────────────────────────────

/// Detect the factory level for `repo_root`.
///
/// Returns `DetectionLevel::NotFactory` for any directory that does not
/// look like a factory project. Does **not** return an error for a
/// malformed legacy manifest or a missing adapter reference — detection is
/// best-effort and surfaces partial data via the returned struct's
/// optional fields so callers can branch on what they find.
///
/// A malformed ACP `pipeline-state.json` does return an error: once a
/// project is declaring itself ACP-native via the canonical file location,
/// silently demoting to legacy or scaffold-only would hide corruption.
pub fn detect(repo_root: &Path) -> Result<FactoryProject, DetectError> {
    if !repo_root.exists() {
        return Err(DetectError::PathMissing(repo_root.to_path_buf()));
    }
    if !repo_root.is_dir() {
        return Err(DetectError::NotDirectory(repo_root.to_path_buf()));
    }

    // L2: ACP pipeline-state.json.
    let pipeline_state_path = repo_root.join(".factory").join("pipeline-state.json");
    if pipeline_state_path.is_file() {
        let raw = std::fs::read(&pipeline_state_path).map_err(|e| DetectError::Io {
            path: pipeline_state_path.clone(),
            source: e,
        })?;
        let state: PipelineState = serde_json::from_slice(&raw).map_err(|e| {
            DetectError::MalformedPipelineState {
                path: pipeline_state_path.clone(),
                source: e,
            }
        })?;
        let adapter_ref = Some(AdapterRef {
            name: state.pipeline.adapter.name.clone(),
            version: state.pipeline.adapter.version.clone(),
        });
        return Ok(FactoryProject {
            level: DetectionLevel::AcpProduced,
            pipeline_state: Some(state),
            adapter_ref,
            legacy_manifest: None,
            legacy_complete: None,
            legacy_incomplete_stages: None,
        });
    }

    // L1: legacy legacy-factory manifest.
    let legacy_manifest_path = repo_root
        .join("requirements")
        .join("audit")
        .join("factory-manifest.json");
    let legacy_working_state_path = repo_root
        .join("requirements")
        .join("audit")
        .join("working-state.json");
    if legacy_manifest_path.is_file() && legacy_working_state_path.is_file() {
        let raw = std::fs::read(&legacy_manifest_path).map_err(|e| DetectError::Io {
            path: legacy_manifest_path.clone(),
            source: e,
        })?;
        let legacy_value: serde_json::Value = match serde_json::from_slice(&raw) {
            Ok(v) => v,
            Err(_) => {
                // Malformed legacy manifest: report the level but leave
                // downstream translation to surface the detail.
                return Ok(FactoryProject {
                    level: DetectionLevel::LegacyProduced,
                    pipeline_state: None,
                    adapter_ref: None,
                    legacy_manifest: None,
                    legacy_complete: Some(false),
                    legacy_incomplete_stages: Some(vec!["<malformed-manifest>".to_string()]),
                });
            }
        };
        let (complete, incomplete) = legacy::assess_completion(&legacy_value);
        let adapter_ref = detect_scaffold_adapter(repo_root);
        return Ok(FactoryProject {
            level: DetectionLevel::LegacyProduced,
            pipeline_state: None,
            adapter_ref,
            legacy_manifest: Some(legacy_value),
            legacy_complete: Some(complete),
            legacy_incomplete_stages: if complete { None } else { Some(incomplete) },
        });
    }

    // L0: scaffold-only — template.json with templateName, no pipeline-state, no legacy manifest.
    if let Some(adapter) = detect_scaffold_adapter(repo_root) {
        return Ok(FactoryProject {
            level: DetectionLevel::ScaffoldOnly,
            pipeline_state: None,
            adapter_ref: Some(adapter),
            legacy_manifest: None,
            legacy_complete: None,
            legacy_incomplete_stages: None,
        });
    }

    Ok(FactoryProject::not_factory())
}

// ── Scaffold-only probe ───────────────────────────────────────────────

fn detect_scaffold_adapter(repo_root: &Path) -> Option<AdapterRef> {
    let template_path = repo_root.join("template.json");
    if !template_path.is_file() {
        return None;
    }
    let raw = std::fs::read(&template_path).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&raw).ok()?;
    let name = value.get("templateName")?.as_str()?.to_string();
    let version = value
        .get("baseVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("0.0.0")
        .to_string();
    Some(AdapterRef { name, version })
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write(dir: &Path, rel: &str, contents: &str) {
        let full = dir.join(rel);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(full, contents).unwrap();
    }

    #[test]
    fn detects_not_factory_on_empty_dir() {
        let tmp = tempdir().unwrap();
        let result = detect(tmp.path()).unwrap();
        assert_eq!(result.level, DetectionLevel::NotFactory);
    }

    #[test]
    fn detects_scaffold_only_on_template_json() {
        let tmp = tempdir().unwrap();
        write(
            tmp.path(),
            "template.json",
            r#"{ "templateName": "template", "baseVersion": "3.0.0" }"#,
        );
        let result = detect(tmp.path()).unwrap();
        assert_eq!(result.level, DetectionLevel::ScaffoldOnly);
        let adapter = result.adapter_ref.unwrap();
        assert_eq!(adapter.name, "template");
        assert_eq!(adapter.version, "3.0.0");
    }

    #[test]
    fn scaffold_without_template_name_is_not_factory() {
        let tmp = tempdir().unwrap();
        write(tmp.path(), "template.json", r#"{ "unrelated": true }"#);
        let result = detect(tmp.path()).unwrap();
        assert_eq!(result.level, DetectionLevel::NotFactory);
    }

    #[test]
    fn detects_legacy_produced_with_completion() {
        let tmp = tempdir().unwrap();
        let manifest = serde_json::json!({
            "pipelineStatus": "COMPLETE",
            "completedAt": "2026-04-22T01:00:00Z",
            "stages": {
                "stage1_businessRequirements": { "status": "PASSED" },
                "stage2_serviceRequirements": { "status": "PASSED" },
                "stage3_databaseDesign":      { "status": "PASSED" },
                "stage4_apiControllers":      { "status": "PASSED" },
                "stage5_clientInterface":     { "status": "PASSED" }
            }
        });
        write(
            tmp.path(),
            "requirements/audit/factory-manifest.json",
            &serde_json::to_string(&manifest).unwrap(),
        );
        write(
            tmp.path(),
            "requirements/audit/working-state.json",
            r#"{ "schemaVersion": "1.2" }"#,
        );
        write(
            tmp.path(),
            "template.json",
            r#"{ "templateName": "acme-vue-node", "baseVersion": "3.0.0" }"#,
        );
        let result = detect(tmp.path()).unwrap();
        assert_eq!(result.level, DetectionLevel::LegacyProduced);
        assert_eq!(result.legacy_complete, Some(true));
        assert!(result.legacy_incomplete_stages.is_none());
        assert!(result.legacy_manifest.is_some());
        assert_eq!(result.adapter_ref.as_ref().unwrap().name, "acme-vue-node");
    }

    #[test]
    fn detects_legacy_incomplete_stages() {
        let tmp = tempdir().unwrap();
        let manifest = serde_json::json!({
            "stages": {
                "stage1_businessRequirements": { "status": "PASSED" },
                "stage2_serviceRequirements": { "status": "IN_PROGRESS" },
                "stage3_databaseDesign":      { "status": "PENDING" },
                "stage4_apiControllers":      { "status": "PENDING" },
                "stage5_clientInterface":     { "status": "PENDING" }
            }
        });
        write(
            tmp.path(),
            "requirements/audit/factory-manifest.json",
            &serde_json::to_string(&manifest).unwrap(),
        );
        write(
            tmp.path(),
            "requirements/audit/working-state.json",
            r#"{ "schemaVersion": "1.2" }"#,
        );
        let result = detect(tmp.path()).unwrap();
        assert_eq!(result.level, DetectionLevel::LegacyProduced);
        assert_eq!(result.legacy_complete, Some(false));
        let incomplete = result.legacy_incomplete_stages.unwrap();
        assert_eq!(incomplete.len(), 4);
        assert!(incomplete.iter().any(|s| s == "stage2_serviceRequirements"));
    }

    #[test]
    fn acp_beats_legacy_and_scaffold() {
        let tmp = tempdir().unwrap();
        let state = serde_json::json!({
            "schema_version": "1.0.0",
            "pipeline": {
                "id": "11111111-2222-3333-4444-555555555555",
                "factory_version": "0.1.0",
                "started_at": "2026-04-22T00:00:00Z",
                "updated_at": "2026-04-22T00:00:00Z",
                "status": "running",
                "adapter": { "name": "acme-vue-encore", "version": "3.0.0" },
                "build_spec": { "path": "build-spec.yaml", "hash": "abc" }
            },
            "stages": {}
        });
        write(
            tmp.path(),
            ".factory/pipeline-state.json",
            &serde_json::to_string(&state).unwrap(),
        );
        // Also drop legacy and scaffold markers — L2 must still win. The
        // decoy template.json keeps the legacy-era name on purpose: the
        // adapter_ref assertion below proves provenance (ACP state, not
        // the stale scaffold marker) precisely because the names differ.
        write(
            tmp.path(),
            "requirements/audit/factory-manifest.json",
            r#"{ "stages": {} }"#,
        );
        write(
            tmp.path(),
            "requirements/audit/working-state.json",
            r#"{}"#,
        );
        write(
            tmp.path(),
            "template.json",
            r#"{ "templateName": "acme-vue-node" }"#,
        );
        let result = detect(tmp.path()).unwrap();
        assert_eq!(result.level, DetectionLevel::AcpProduced);
        assert!(result.pipeline_state.is_some());
        assert_eq!(result.adapter_ref.as_ref().unwrap().name, "acme-vue-encore");
    }

    #[test]
    fn malformed_acp_pipeline_state_surfaces_error() {
        let tmp = tempdir().unwrap();
        write(tmp.path(), ".factory/pipeline-state.json", "{ not json");
        let err = detect(tmp.path()).unwrap_err();
        assert!(matches!(err, DetectError::MalformedPipelineState { .. }));
    }
}
