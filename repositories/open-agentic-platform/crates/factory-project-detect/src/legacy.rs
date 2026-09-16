// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Legacy `legacy-factory` manifest completion assessment.
//!
//! The legacy shape has five numbered stage keys:
//!
//! - `stage1_businessRequirements`
//! - `stage2_serviceRequirements`
//! - `stage3_databaseDesign`
//! - `stage4_apiControllers`
//! - `stage5_clientInterface`
//!
//! A stage counts as terminal-complete iff `status` is a recognised
//! completion token (`PASSED`, `PASS`, `COMPLETE`, `COMPLETED`). The
//! `legacy-factory` writer records the per-stage completion
//! timestamp in `requirements/audit/working-state.json` under
//! `stageHistory[]`, not on the manifest stage object — so requiring
//! `completedAt` here would reject every real factory output. The
//! manifest-level `pipelineStatus`/`completedAt` plus the per-stage
//! terminal status are the contract that gates completion. Non-stage
//! sibling keys (e.g. `audit`, `clientDocumentation`) are ignored for
//! completeness; they are supplementary artefacts, not gates.

use serde::{Deserialize, Serialize};

pub const REQUIRED_STAGES: [&str; 5] = [
    "stage1_businessRequirements",
    "stage2_serviceRequirements",
    "stage3_databaseDesign",
    "stage4_apiControllers",
    "stage5_clientInterface",
];

const TERMINAL_STATUS_TOKENS: [&str; 4] = ["PASSED", "PASS", "COMPLETE", "COMPLETED"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum LegacyStageStatus {
    Passed,
    Other(String),
    Missing,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacyManifest {
    #[serde(default)]
    pub stages: serde_json::Map<String, serde_json::Value>,
}

/// Returns `(complete, incomplete_stage_names)`. `complete` is true only
/// when all five required stages are terminally complete with a
/// `completedAt` timestamp.
pub fn assess_completion(manifest: &serde_json::Value) -> (bool, Vec<String>) {
    let stages = match manifest.get("stages").and_then(|v| v.as_object()) {
        Some(o) => o,
        None => return (false, REQUIRED_STAGES.iter().map(|s| s.to_string()).collect()),
    };

    let mut incomplete = Vec::new();
    for required in REQUIRED_STAGES {
        let stage = stages.get(required);
        if !is_stage_complete(stage) {
            incomplete.push(required.to_string());
        }
    }
    (incomplete.is_empty(), incomplete)
}

fn is_stage_complete(stage: Option<&serde_json::Value>) -> bool {
    let Some(stage) = stage else { return false };
    let status = stage
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_ascii_uppercase();
    TERMINAL_STATUS_TOKENS.contains(&status.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn complete_when_all_five_stages_pass() {
        let manifest = serde_json::json!({
            "stages": {
                "stage1_businessRequirements": { "status": "PASSED" },
                "stage2_serviceRequirements": { "status": "PASSED" },
                "stage3_databaseDesign":      { "status": "passed" },
                "stage4_apiControllers":      { "status": "COMPLETED" },
                "stage5_clientInterface":     { "status": "PASS" }
            }
        });
        let (complete, incomplete) = assess_completion(&manifest);
        assert!(complete);
        assert!(incomplete.is_empty());
    }

    #[test]
    fn missing_stage_is_incomplete() {
        let manifest = serde_json::json!({
            "stages": {
                "stage1_businessRequirements": { "status": "PASSED" }
            }
        });
        let (complete, incomplete) = assess_completion(&manifest);
        assert!(!complete);
        assert_eq!(incomplete.len(), 4);
    }

    #[test]
    fn completed_at_is_not_required_per_stage() {
        // Real `legacy-factory` output: only top-level
        // `completedAt`; per-stage objects carry status + artifacts only.
        let manifest = serde_json::json!({
            "completedAt": "2026-04-25T13:55:00Z",
            "pipelineStatus": "COMPLETE",
            "stages": {
                "stage1_businessRequirements": { "status": "PASSED" },
                "stage2_serviceRequirements": { "status": "PASSED" },
                "stage3_databaseDesign":      { "status": "PASSED" },
                "stage4_apiControllers":      { "status": "PASSED" },
                "stage5_clientInterface":     { "status": "PASSED" }
            }
        });
        let (complete, incomplete) = assess_completion(&manifest);
        assert!(complete);
        assert!(incomplete.is_empty());
    }

    #[test]
    fn non_terminal_status_is_incomplete() {
        let manifest = serde_json::json!({
            "stages": {
                "stage1_businessRequirements": { "status": "IN_PROGRESS" },
                "stage2_serviceRequirements": { "status": "PASSED" },
                "stage3_databaseDesign":      { "status": "PASSED" },
                "stage4_apiControllers":      { "status": "PASSED" },
                "stage5_clientInterface":     { "status": "PASSED" }
            }
        });
        let (complete, incomplete) = assess_completion(&manifest);
        assert!(!complete);
        assert_eq!(incomplete, vec!["stage1_businessRequirements"]);
    }
}
