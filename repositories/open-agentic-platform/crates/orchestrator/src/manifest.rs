// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/044-multi-agent-orchestration/spec.md

use crate::OrchestratorError;
use crate::effort::EffortLevel;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// Declarative workflow (044 FR-007).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WorkflowManifest {
    pub steps: Vec<WorkflowStep>,
    /// Project context for this workflow (spec 119).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WorkflowStep {
    pub id: String,
    pub agent: String,
    pub effort: EffortLevel,
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
    pub instruction: String,
    /// Optional gate configuration for this step (052 FR-004, FR-005).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gate: Option<StepGateConfig>,
    /// Fast pre-verification commands (e.g., typecheck only).
    /// Run before `post_verify`. If any fails, skip `post_verify` and trigger retry immediately.
    /// This avoids running slow full-suite verification when a quick check catches the error.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pre_verify: Option<Vec<VerifyCommand>>,
    /// Post-step verification commands (075 FR-005).
    /// After the agent completes, each command runs in sequence.
    /// If any fails, the step is marked verification-failed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_verify: Option<Vec<VerifyCommand>>,
    /// Maximum retry count for verification failures (075 FR-006). Default: 3.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_retries: Option<u32>,
}

/// A verification command to run after agent completion (075 FR-005).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct VerifyCommand {
    pub command: String,
    pub working_dir: String,
    pub timeout_ms: u64,
}

/// Escalation behavior when an approval gate times out (052 FR-005 / SC-003).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ApprovalEscalation {
    Fail,
    Skip,
    Notify,
}

/// Gate configuration for a workflow step (052 FR-004, FR-005).
///
/// This is intentionally minimal and JSON/YAML-friendly – richer policies can
/// be layered in `config` fields or higher-level orchestrator commands.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum StepGateConfig {
    /// Checkpoint gate: execution pauses at this step until an operator
    /// explicitly confirms via CLI or API.
    Checkpoint {
        /// Optional human-readable label for the checkpoint.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    /// Approval gate: requires explicit approval and supports timeout-based
    /// escalation behavior.
    Approval {
        /// Timeout in milliseconds before escalation (required by FR-005).
        #[serde(rename = "timeoutMs")]
        timeout_ms: u64,
        /// Escalation policy applied when the timeout elapses.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        escalation: Option<ApprovalEscalation>,
        /// Checkpoint ID bound to this approval (spec 095 Slice 5).
        /// Auto-populated when the gate is reached if not set in the manifest.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        checkpoint_id: Option<String>,
    },
}

impl WorkflowManifest {
    pub fn load_from_file(path: &Path) -> Result<Self, OrchestratorError> {
        let raw =
            std::fs::read_to_string(path).map_err(|e| OrchestratorError::InvalidManifest {
                reason: format!("read {}: {e}", path.display()),
            })?;
        serde_yaml::from_str(&raw).map_err(|e| OrchestratorError::InvalidManifest {
            reason: format!("parse YAML: {e}"),
        })
    }

    /// Validates DAG, input references, duplicate outputs; returns dispatch order (indices).
    pub fn validate_and_order(&self) -> Result<Vec<usize>, OrchestratorError> {
        validate_steps(&self.steps)
    }
}

fn validate_steps(steps: &[WorkflowStep]) -> Result<Vec<usize>, OrchestratorError> {
    if steps.is_empty() {
        return Err(OrchestratorError::InvalidManifest {
            reason: "workflow must have at least one step".into(),
        });
    }

    let mut ids: HashSet<&str> = HashSet::new();
    for s in steps {
        if !ids.insert(s.id.as_str()) {
            return Err(OrchestratorError::InvalidManifest {
                reason: format!("duplicate step id: {}", s.id),
            });
        }
    }

    let id_to_index: HashMap<&str, usize> = steps
        .iter()
        .enumerate()
        .map(|(i, s)| (s.id.as_str(), i))
        .collect();

    let mut full_outputs: HashSet<String> = HashSet::new();
    for s in steps {
        for out in &s.outputs {
            let full = format!("{}/{}", s.id, out);
            if !full_outputs.insert(full) {
                return Err(OrchestratorError::InvalidManifest {
                    reason: format!("duplicate output path: {}/{}", s.id, out),
                });
            }
        }
    }

    let n = steps.len();
    let mut adj: Vec<Vec<usize>> = vec![vec![]; n];
    let mut indegree = vec![0u32; n];

    for (cons_idx, step) in steps.iter().enumerate() {
        for input in &step.inputs {
            let Some((producer_id, file)) = split_input_ref(input) else {
                // Pre-existing file — no graph edge (044).
                continue;
            };
            let Some(&prod_idx) = id_to_index.get(producer_id) else {
                return Err(OrchestratorError::InvalidManifest {
                    reason: format!(
                        "step `{}` input `{}`: unknown producer step `{producer_id}`",
                        step.id, input
                    ),
                });
            };
            let producer = &steps[prod_idx];
            if !producer.outputs.iter().any(|o| o == file) {
                return Err(OrchestratorError::InvalidManifest {
                    reason: format!(
                        "step `{}` input `{}`: producer `{}` does not list `{file}` in outputs",
                        step.id, input, producer_id
                    ),
                });
            }
            // producer must run before consumer
            adj[prod_idx].push(cons_idx);
            indegree[cons_idx] += 1;
        }
    }

    topological_sort(&adj, &indegree)
}

/// `step_id/filename` → (step_id, filename). `None` if not a step-relative ref.
pub fn split_input_ref(input: &str) -> Option<(&str, &str)> {
    let input = input.trim();
    if input.is_empty() {
        return None;
    }
    // Absolute or UNC paths: treat as external.
    if input.starts_with('/') || input.contains(":\\") {
        return None;
    }
    input.split_once('/')
}

fn topological_sort(adj: &[Vec<usize>], indegree: &[u32]) -> Result<Vec<usize>, OrchestratorError> {
    let n = indegree.len();
    let mut indegree = indegree.to_vec();
    let mut queue: Vec<usize> = (0..n).filter(|&i| indegree[i] == 0).collect();
    let mut order = Vec::with_capacity(n);

    let mut qi = 0;
    while qi < queue.len() {
        let u = queue[qi];
        qi += 1;
        order.push(u);
        for &v in &adj[u] {
            indegree[v] -= 1;
            if indegree[v] == 0 {
                queue.push(v);
            }
        }
    }

    if order.len() != n {
        return Err(OrchestratorError::CycleDetected {
            message: "workflow graph contains a cycle".into(),
        });
    }

    Ok(order)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::effort::EffortLevel;

    fn sample_step(id: &str, agent: &str, inputs: Vec<&str>, outputs: Vec<&str>) -> WorkflowStep {
        WorkflowStep {
            id: id.into(),
            agent: agent.into(),
            effort: EffortLevel::Investigate,
            inputs: inputs.into_iter().map(String::from).collect(),
            outputs: outputs.into_iter().map(String::from).collect(),
            instruction: "test".into(),
            gate: None,
            pre_verify: None,
            post_verify: None,
            max_retries: None,
        }
    }

    #[test]
    fn three_step_linear_order() {
        let m = WorkflowManifest {
            steps: vec![
                sample_step("step-01-research", "a", vec![], vec!["research_output.md"]),
                sample_step(
                    "step-02-draft",
                    "b",
                    vec!["step-01-research/research_output.md"],
                    vec!["draft_output.md"],
                ),
                sample_step(
                    "step-03-review",
                    "c",
                    vec!["step-02-draft/draft_output.md"],
                    vec!["review_output.md"],
                ),
            ],
            project_id: None,
        };
        let order = m.validate_and_order().unwrap();
        assert_eq!(order, vec![0, 1, 2]);
    }

    #[test]
    fn cycle_rejected() {
        let m = WorkflowManifest {
            steps: vec![
                sample_step("a", "x", vec!["b/out.md"], vec!["out.md"]),
                sample_step("b", "y", vec!["a/out.md"], vec!["out.md"]),
            ],
            project_id: None,
        };
        assert!(matches!(
            m.validate_and_order(),
            Err(OrchestratorError::CycleDetected { .. })
        ));
    }

    #[test]
    fn duplicate_output_rejected() {
        let m = WorkflowManifest {
            steps: vec![
                sample_step("s1", "a", vec![], vec!["x.md"]),
                sample_step("s2", "b", vec![], vec!["x.md"]),
            ],
            project_id: None,
        };
        // same filename different step dirs — allowed
        assert!(m.validate_and_order().is_ok());

        let m2 = WorkflowManifest {
            steps: vec![
                sample_step("s1", "a", vec![], vec!["dup.md", "dup.md"]),
                sample_step("s2", "b", vec![], vec!["out.md"]),
            ],
            project_id: None,
        };
        assert!(m2.validate_and_order().is_err());
    }
}
