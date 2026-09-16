// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: PROMOTION_GRADE_MIRROR
// Spec: specs/097-promotion-grade-mirror/spec.md

use crate::state::{StepExecutionStatus, WorkflowState};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

/// Whether a completed run is eligible for platform promotion (097 Slice 1).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PromotionEligibility {
    Eligible,
    Ineligible { reasons: Vec<String> },
}

/// Status of platform event/artifact synchronization.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SyncStatus {
    /// Whether all workflow events have been acknowledged by the platform.
    pub events_synced: bool,
    /// Whether all step artifacts have been recorded to the platform.
    pub artifacts_recorded: bool,
    /// Last sync error, if any.
    pub last_sync_error: Option<String>,
}

/// Tracks acknowledgements from fire-and-forget Statecraft calls (099 Slice 1).
///
/// Created per pipeline run. Cloneable (inner state is `Arc<Mutex>`).
/// Spawned tasks capture a clone and record ack/nack after each HTTP call completes.
#[derive(Debug, Clone)]
pub struct SyncTracker {
    inner: Arc<Mutex<SyncTrackerInner>>,
}

#[derive(Debug, Default)]
struct SyncTrackerInner {
    events_acked: u32,
    events_failed: u32,
    artifacts_acked: u32,
    artifacts_failed: u32,
    last_error: Option<String>,
}

impl Default for SyncTracker {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(SyncTrackerInner::default())),
        }
    }
}

impl SyncTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record_events_ack(&self, count: u32) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.events_acked += count;
        }
    }

    pub fn record_events_fail(&self, err: String) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.events_failed += 1;
            inner.last_error = Some(err);
        }
    }

    pub fn record_artifacts_ack(&self, count: u32) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.artifacts_acked += count;
        }
    }

    pub fn record_artifacts_fail(&self, err: String) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.artifacts_failed += 1;
            inner.last_error = Some(err);
        }
    }

    /// Convert accumulated tracking data into a `SyncStatus` for promotion checks.
    pub fn to_sync_status(&self) -> SyncStatus {
        let inner = match self.inner.lock() {
            Ok(guard) => guard,
            Err(_) => {
                return SyncStatus {
                    events_synced: false,
                    artifacts_recorded: false,
                    last_sync_error: Some("sync tracker lock poisoned".into()),
                };
            }
        };
        SyncStatus {
            events_synced: inner.events_failed == 0 && inner.events_acked > 0,
            artifacts_recorded: inner.artifacts_failed == 0 && inner.artifacts_acked > 0,
            last_sync_error: inner.last_error.clone(),
        }
    }
}

/// Full promotion check result with all individual criteria (097 Slice 1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromotionCheck {
    pub workflow_id: String,
    pub project_id: Option<String>,
    pub governance_active: bool,
    pub events_synced: bool,
    pub artifacts_recorded: bool,
    pub all_steps_completed: bool,
    pub eligibility: PromotionEligibility,
}

/// Check whether a completed workflow run is eligible for platform promotion.
///
/// A run is eligible when all five criteria are met:
/// 1. `project_id` is present in workflow metadata
/// 2. Governance was active during the run (not bypassed)
/// 3. All events were acknowledged by platform
/// 4. All artifacts were recorded to platform
/// 5. All steps completed successfully (no Failed or Skipped)
pub fn check_promotion_eligibility(
    state: &WorkflowState,
    sync_status: &SyncStatus,
) -> PromotionCheck {
    let project_id = state
        .metadata
        .get("project_id")
        .and_then(|v| v.as_str())
        .map(String::from);

    let governance_mode = state
        .metadata
        .get("governance_mode")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    // Positive assertion (098 Slice 3): only explicitly governed runs qualify.
    // Previously `!= "bypass"` which let "unknown" (absent key) pass silently.
    let governance_active = governance_mode == "governed";

    let all_steps_completed = state
        .steps
        .iter()
        .all(|s| s.status == StepExecutionStatus::Completed);

    let mut reasons: Vec<String> = Vec::new();

    if project_id.is_none() {
        reasons.push("project_id not present in workflow metadata".into());
    }
    if !governance_active {
        reasons.push("governance was bypassed during this run".into());
    }
    if !sync_status.events_synced {
        reasons.push("not all events were acknowledged by platform".into());
    }
    if !sync_status.artifacts_recorded {
        reasons.push("not all artifacts were recorded to platform".into());
    }
    if !all_steps_completed {
        let failed: Vec<String> = state
            .steps
            .iter()
            .filter(|s| {
                s.status == StepExecutionStatus::Failed || s.status == StepExecutionStatus::Skipped
            })
            .map(|s| format!("{} ({})", s.id, format!("{:?}", s.status).to_lowercase()))
            .collect();
        reasons.push(format!(
            "not all steps completed successfully: {}",
            failed.join(", ")
        ));
    }

    let eligibility = if reasons.is_empty() {
        PromotionEligibility::Eligible
    } else {
        PromotionEligibility::Ineligible { reasons }
    };

    PromotionCheck {
        workflow_id: state.workflow_id.to_string(),
        project_id,
        governance_active,
        events_synced: sync_status.events_synced,
        artifacts_recorded: sync_status.artifacts_recorded,
        all_steps_completed,
        eligibility,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::WorkflowState;
    use serde_json::Value as JsonValue;
    use uuid::Uuid;

    fn make_completed_state(project_id: Option<&str>, governance_mode: &str) -> WorkflowState {
        let mut meta = serde_json::Map::new();
        if let Some(ws) = project_id {
            meta.insert("project_id".into(), JsonValue::String(ws.into()));
        }
        meta.insert(
            "governance_mode".into(),
            JsonValue::String(governance_mode.into()),
        );

        let mut state = WorkflowState::new(
            Uuid::new_v4(),
            "test-workflow",
            "2026-04-11T00:00:00Z".into(),
            vec![
                ("step-01".into(), "lint".into()),
                ("step-02".into(), "test".into()),
            ],
            meta,
        );
        // Mark all steps completed
        for step in &mut state.steps {
            step.status = crate::state::StepExecutionStatus::Completed;
            step.completed_at = Some("2026-04-11T00:01:00Z".into());
        }
        state
    }

    #[test]
    fn sc097_2_eligible_when_all_criteria_met() {
        let state = make_completed_state(Some("ws-001"), "governed");
        let sync = SyncStatus {
            events_synced: true,
            artifacts_recorded: true,
            last_sync_error: None,
        };

        let check = check_promotion_eligibility(&state, &sync);
        assert_eq!(check.eligibility, PromotionEligibility::Eligible);
        assert!(check.governance_active);
        assert!(check.all_steps_completed);
        assert_eq!(check.project_id, Some("ws-001".into()));
    }

    #[test]
    fn sc097_2_ineligible_without_workspace() {
        let state = make_completed_state(None, "governed");
        let sync = SyncStatus {
            events_synced: true,
            artifacts_recorded: true,
            last_sync_error: None,
        };

        let check = check_promotion_eligibility(&state, &sync);
        match &check.eligibility {
            PromotionEligibility::Ineligible { reasons } => {
                assert!(reasons.iter().any(|r| r.contains("project_id")));
            }
            PromotionEligibility::Eligible => panic!("expected ineligible"),
        }
    }

    #[test]
    fn sc097_2_ineligible_when_governance_bypassed() {
        let state = make_completed_state(Some("ws-001"), "bypass");
        let sync = SyncStatus {
            events_synced: true,
            artifacts_recorded: true,
            last_sync_error: None,
        };

        let check = check_promotion_eligibility(&state, &sync);
        assert!(!check.governance_active);
        match &check.eligibility {
            PromotionEligibility::Ineligible { reasons } => {
                assert!(reasons.iter().any(|r| r.contains("governance")));
            }
            PromotionEligibility::Eligible => panic!("expected ineligible"),
        }
    }

    #[test]
    fn sc097_2_ineligible_when_events_not_synced() {
        let state = make_completed_state(Some("ws-001"), "governed");
        let sync = SyncStatus {
            events_synced: false,
            artifacts_recorded: true,
            last_sync_error: Some("connection refused".into()),
        };

        let check = check_promotion_eligibility(&state, &sync);
        match &check.eligibility {
            PromotionEligibility::Ineligible { reasons } => {
                assert!(reasons.iter().any(|r| r.contains("events")));
            }
            PromotionEligibility::Eligible => panic!("expected ineligible"),
        }
    }

    #[test]
    fn sc097_2_ineligible_when_step_failed() {
        let mut state = make_completed_state(Some("ws-001"), "governed");
        state.steps[1].status = crate::state::StepExecutionStatus::Failed;

        let sync = SyncStatus {
            events_synced: true,
            artifacts_recorded: true,
            last_sync_error: None,
        };

        let check = check_promotion_eligibility(&state, &sync);
        assert!(!check.all_steps_completed);
        match &check.eligibility {
            PromotionEligibility::Ineligible { reasons } => {
                assert!(reasons.iter().any(|r| r.contains("step-02")));
            }
            PromotionEligibility::Eligible => panic!("expected ineligible"),
        }
    }

    #[test]
    fn sc097_2_multiple_ineligibility_reasons() {
        let state = make_completed_state(None, "bypass");
        let sync = SyncStatus {
            events_synced: false,
            artifacts_recorded: false,
            last_sync_error: None,
        };

        let check = check_promotion_eligibility(&state, &sync);
        match &check.eligibility {
            PromotionEligibility::Ineligible { reasons } => {
                assert!(
                    reasons.len() >= 4,
                    "expected at least 4 reasons, got: {reasons:?}"
                );
            }
            PromotionEligibility::Eligible => panic!("expected ineligible"),
        }
    }

    // --- 098 Slice 3: Positive-assertion governance gate ---

    #[test]
    fn sc098_3_ineligible_when_governance_mode_missing() {
        // Simulate a workflow where governance_mode was never written to metadata.
        let mut meta = serde_json::Map::new();
        meta.insert("project_id".into(), JsonValue::String("ws-001".into()));
        // Note: no "governance_mode" key — previously this would pass as "unknown" != "bypass"

        let mut state = WorkflowState::new(
            Uuid::new_v4(),
            "test-workflow",
            "2026-04-11T00:00:00Z".into(),
            vec![("step-01".into(), "lint".into())],
            meta,
        );
        for step in &mut state.steps {
            step.status = crate::state::StepExecutionStatus::Completed;
            step.completed_at = Some("2026-04-11T00:01:00Z".into());
        }

        let sync = SyncStatus {
            events_synced: true,
            artifacts_recorded: true,
            last_sync_error: None,
        };

        let check = check_promotion_eligibility(&state, &sync);
        assert!(
            !check.governance_active,
            "absent governance_mode must not pass"
        );
        match &check.eligibility {
            PromotionEligibility::Ineligible { reasons } => {
                assert!(reasons.iter().any(|r| r.contains("governance")));
            }
            PromotionEligibility::Eligible => panic!("expected ineligible"),
        }
    }

    // --- SyncTracker tests (099 Slice 1) ---

    #[test]
    fn sc099_1_sync_tracker_all_acked() {
        let tracker = SyncTracker::new();
        tracker.record_events_ack(3);
        tracker.record_artifacts_ack(5);

        let status = tracker.to_sync_status();
        assert!(status.events_synced);
        assert!(status.artifacts_recorded);
        assert!(status.last_sync_error.is_none());
    }

    #[test]
    fn sc099_1_sync_tracker_events_failed() {
        let tracker = SyncTracker::new();
        tracker.record_events_ack(2);
        tracker.record_events_fail("connection refused".into());
        tracker.record_artifacts_ack(1);

        let status = tracker.to_sync_status();
        assert!(!status.events_synced);
        assert!(status.artifacts_recorded);
        assert_eq!(status.last_sync_error, Some("connection refused".into()));
    }

    #[test]
    fn sc099_1_sync_tracker_no_activity() {
        let tracker = SyncTracker::new();
        let status = tracker.to_sync_status();
        // No acks at all means not synced
        assert!(!status.events_synced);
        assert!(!status.artifacts_recorded);
    }

    // --- SyncTracker edge cases (099 Slice 2) ---

    #[test]
    fn sc099_2_mixed_ack_and_fail() {
        let tracker = SyncTracker::new();
        tracker.record_events_ack(3);
        tracker.record_events_fail("timeout".into());
        tracker.record_artifacts_ack(2);
        tracker.record_artifacts_fail("disk full".into());

        let status = tracker.to_sync_status();
        assert!(!status.events_synced, "any failure → not synced");
        assert!(!status.artifacts_recorded, "any failure → not recorded");
        assert!(status.last_sync_error.is_some());
    }

    #[test]
    fn sc099_2_events_ok_artifacts_failed() {
        let tracker = SyncTracker::new();
        tracker.record_events_ack(5);
        tracker.record_artifacts_fail("upload error".into());

        let status = tracker.to_sync_status();
        assert!(status.events_synced, "events all acked");
        assert!(!status.artifacts_recorded, "artifacts had failure");
    }

    #[test]
    fn sc099_2_clone_shares_state() {
        let tracker = SyncTracker::new();
        let clone = tracker.clone();

        clone.record_events_ack(3);
        clone.record_artifacts_ack(2);

        // Read from original — should see the clone's writes
        let status = tracker.to_sync_status();
        assert!(status.events_synced);
        assert!(status.artifacts_recorded);
    }

    #[test]
    fn sc099_2_last_error_tracks_most_recent() {
        let tracker = SyncTracker::new();
        tracker.record_events_fail("first error".into());
        tracker.record_artifacts_fail("second error".into());

        let status = tracker.to_sync_status();
        assert_eq!(
            status.last_sync_error.as_deref(),
            Some("second error"),
            "last_error should be the most recent failure"
        );
    }

    // --- Promotion edge cases (097 Slice 3) ---

    #[test]
    fn sc097_3_ineligible_with_skipped_step() {
        let mut state = make_completed_state(Some("ws-001"), "governed");
        state.steps[1].status = crate::state::StepExecutionStatus::Skipped;

        let sync = SyncStatus {
            events_synced: true,
            artifacts_recorded: true,
            last_sync_error: None,
        };

        let check = check_promotion_eligibility(&state, &sync);
        assert!(!check.all_steps_completed);
        match &check.eligibility {
            PromotionEligibility::Ineligible { reasons } => {
                assert!(
                    reasons
                        .iter()
                        .any(|r| r.contains("step-02") && r.contains("skipped"))
                );
            }
            PromotionEligibility::Eligible => panic!("expected ineligible for skipped step"),
        }
    }

    #[test]
    fn sc097_3_empty_steps_vacuously_complete() {
        let mut meta = serde_json::Map::new();
        meta.insert("project_id".into(), JsonValue::String("ws-001".into()));
        meta.insert(
            "governance_mode".into(),
            JsonValue::String("governed".into()),
        );

        let state = WorkflowState::new(
            Uuid::new_v4(),
            "empty-workflow",
            "2026-04-12T00:00:00Z".into(),
            Vec::<(String, String)>::new(), // zero steps
            meta,
        );

        let sync = SyncStatus {
            events_synced: true,
            artifacts_recorded: true,
            last_sync_error: None,
        };

        let check = check_promotion_eligibility(&state, &sync);
        assert!(
            check.all_steps_completed,
            "empty steps should be vacuously complete"
        );
        assert_eq!(check.eligibility, PromotionEligibility::Eligible);
    }

    #[test]
    fn sc098_2_governed_mode_positive_assertion() {
        let state = make_completed_state(Some("ws-001"), "governed");
        let sync = SyncStatus {
            events_synced: true,
            artifacts_recorded: true,
            last_sync_error: None,
        };

        let check = check_promotion_eligibility(&state, &sync);
        assert!(check.governance_active, "governed mode should be active");
        assert_eq!(check.eligibility, PromotionEligibility::Eligible);
    }
}
