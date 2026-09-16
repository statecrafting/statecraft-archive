// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature 052 Phase 3: Checkpoint and approval gate execution (FR-004, FR-005).

use crate::manifest::{ApprovalEscalation, StepGateConfig};
use crate::state::WorkflowState;
use async_trait::async_trait;
use std::fmt;
use std::time::Duration;
use tokio::time::timeout;

/// Result of evaluating a gate for a single step.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GateOutcome {
    /// The operator confirmed — execution may proceed.
    Approved,
    /// The approval gate timed out and the escalation policy was applied.
    /// The caller should inspect `state` for the updated step/workflow status.
    TimedOut { escalation: ApprovalEscalation },
}

/// Errors that can occur during gate evaluation.
#[derive(Debug)]
pub enum GateError {
    /// The handler returned an error while waiting for confirmation.
    HandlerError(String),
}

impl fmt::Display for GateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GateError::HandlerError(msg) => write!(f, "gate handler error: {msg}"),
        }
    }
}

impl std::error::Error for GateError {}

/// Trait for obtaining operator confirmation at gates (FR-004, FR-005).
///
/// Implementors provide the actual confirmation mechanism — CLI prompt,
/// API call, UI dialog, or test stub. The handler is called once when
/// execution reaches a gate; it should block (asynchronously) until the
/// operator responds.
#[async_trait]
pub trait GateHandler: Send + Sync {
    /// Wait for operator confirmation for a checkpoint gate.
    ///
    /// The implementation should present the checkpoint label (if any) and
    /// block until the operator confirms. Returns `Ok(())` on confirmation
    /// or `Err(msg)` if the handler encounters an unrecoverable error.
    async fn await_checkpoint(&self, step_id: &str, label: Option<&str>) -> Result<(), String>;

    /// Wait for operator approval for an approval gate.
    ///
    /// Unlike checkpoints, approval gates have a timeout managed by the
    /// caller. This method should block until the operator approves.
    /// Returns `Ok(())` on approval or `Err(msg)` on handler error.
    ///
    /// Note: the caller wraps this call in a timeout — if the operator
    /// does not respond in time, the future is dropped and the escalation
    /// policy is applied.
    async fn await_approval(&self, step_id: &str, timeout_ms: u64) -> Result<(), String>;
}

/// Evaluates a gate for a workflow step, if one is configured (FR-004, FR-005).
///
/// This is the main entry point for gate evaluation during dispatch:
///
/// 1. If the step has no gate, returns `Ok(None)` immediately.
/// 2. **Checkpoint** (FR-004 / SC-002): sets workflow status to
///    `"awaiting_checkpoint"`, persists state, calls `handler.await_checkpoint`,
///    then clears the checkpoint status on confirmation.
/// 3. **Approval** (FR-005 / SC-003): sets workflow status to
///    `"awaiting_checkpoint"`, persists state, calls `handler.await_approval`
///    with a timeout. On timeout, applies the escalation policy (fail / skip /
///    notify) and transitions workflow status to `"timed_out"`.
///
/// The `persist` callback is invoked to atomically write state after each
/// transition, satisfying FR-008.
pub async fn evaluate_gate<P>(
    state: &mut WorkflowState,
    step_id: &str,
    gate: &StepGateConfig,
    handler: &dyn GateHandler,
    persist: P,
) -> Result<GateOutcome, GateError>
where
    P: Fn(&WorkflowState) -> Result<(), String>,
{
    match gate {
        StepGateConfig::Checkpoint { label } => {
            // FR-004 / SC-002: pause at checkpoint, persist awaiting status.
            state.mark_awaiting_checkpoint(step_id);
            persist(state).map_err(GateError::HandlerError)?;

            // Block until operator confirms.
            handler
                .await_checkpoint(step_id, label.as_deref())
                .await
                .map_err(GateError::HandlerError)?;

            // Resume: clear checkpoint status.
            state.mark_checkpoint_released();
            persist(state).map_err(GateError::HandlerError)?;

            Ok(GateOutcome::Approved)
        }

        StepGateConfig::Approval {
            timeout_ms: timeout_ms_val,
            escalation,
            checkpoint_id,
        } => {
            // FR-005 / SC-003: pause at approval gate, persist awaiting status.
            // Bind a checkpoint_id for the desktop handler to associate with this gate (095 Slice 5).
            let bound_checkpoint_id = checkpoint_id
                .clone()
                .unwrap_or_else(|| format!("gate-{}-{}", step_id, chrono_now_iso()));
            state.metadata.insert(
                "gate_checkpoint_id".to_string(),
                serde_json::Value::String(bound_checkpoint_id),
            );
            state.mark_awaiting_checkpoint(step_id);
            persist(state).map_err(GateError::HandlerError)?;

            let clamped_timeout_ms = std::cmp::min(*timeout_ms_val, 3_600_000);
            let duration = Duration::from_millis(clamped_timeout_ms);
            let approval_future = handler.await_approval(step_id, clamped_timeout_ms);

            match timeout(duration, approval_future).await {
                Ok(Ok(())) => {
                    // Operator approved within timeout.
                    state.mark_checkpoint_released();
                    persist(state).map_err(GateError::HandlerError)?;
                    Ok(GateOutcome::Approved)
                }
                Ok(Err(handler_err)) => {
                    // Handler returned an error (not a timeout).
                    Err(GateError::HandlerError(handler_err))
                }
                Err(_elapsed) => {
                    // Timeout elapsed — apply escalation policy (FR-005 / SC-003).
                    let esc = escalation.clone().unwrap_or(ApprovalEscalation::Fail);

                    let now = chrono_now_iso();
                    state.mark_approval_timed_out(
                        step_id,
                        esc.clone(),
                        now,
                        Some(clamped_timeout_ms),
                    );
                    persist(state).map_err(GateError::HandlerError)?;

                    Ok(GateOutcome::TimedOut { escalation: esc })
                }
            }
        }
    }
}

/// Convenience: evaluate a gate only if the step has one configured.
///
/// Returns `Ok(None)` for steps without gates, `Ok(Some(outcome))` for
/// steps with gates.
pub async fn evaluate_gate_if_present<P>(
    state: &mut WorkflowState,
    step_id: &str,
    gate: Option<&StepGateConfig>,
    handler: &dyn GateHandler,
    persist: P,
) -> Result<Option<GateOutcome>, GateError>
where
    P: Fn(&WorkflowState) -> Result<(), String>,
{
    match gate {
        Some(g) => evaluate_gate(state, step_id, g, handler, persist)
            .await
            .map(Some),
        None => Ok(None),
    }
}

/// Returns an ISO-8601 timestamp string for the current time.
fn chrono_now_iso() -> String {
    // Use a simple approach that doesn't require the chrono crate:
    // format as seconds since UNIX epoch. Callers needing real timestamps
    // in production will use a proper clock; for state persistence the
    // important thing is that *some* timestamp is recorded.
    use std::time::SystemTime;
    let duration = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    // ISO-ish: we record epoch millis as a string for human readability.
    // Production callers should inject a real clock; this is a reasonable default.
    let secs = duration.as_secs();
    let millis = duration.subsec_millis();
    format!("{secs}.{millis:03}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::ApprovalEscalation;
    use crate::state::{StepExecutionStatus, WorkflowState, WorkflowStatus};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU32, Ordering};
    use uuid::Uuid;

    /// Test handler that immediately confirms any gate.
    struct ImmediateApproveHandler;

    #[async_trait]
    impl GateHandler for ImmediateApproveHandler {
        async fn await_checkpoint(
            &self,
            _step_id: &str,
            _label: Option<&str>,
        ) -> Result<(), String> {
            Ok(())
        }
        async fn await_approval(&self, _step_id: &str, _timeout_ms: u64) -> Result<(), String> {
            Ok(())
        }
    }

    /// Test handler that never responds (blocks forever).
    struct NeverRespondHandler;

    #[async_trait]
    impl GateHandler for NeverRespondHandler {
        async fn await_checkpoint(
            &self,
            _step_id: &str,
            _label: Option<&str>,
        ) -> Result<(), String> {
            std::future::pending().await
        }
        async fn await_approval(&self, _step_id: &str, _timeout_ms: u64) -> Result<(), String> {
            std::future::pending().await
        }
    }

    /// Test handler that returns an error.
    struct ErrorHandler(String);

    #[async_trait]
    impl GateHandler for ErrorHandler {
        async fn await_checkpoint(
            &self,
            _step_id: &str,
            _label: Option<&str>,
        ) -> Result<(), String> {
            Err(self.0.clone())
        }
        async fn await_approval(&self, _step_id: &str, _timeout_ms: u64) -> Result<(), String> {
            Err(self.0.clone())
        }
    }

    fn make_state(step_id: &str) -> WorkflowState {
        WorkflowState::new(
            Uuid::new_v4(),
            "test-workflow",
            "2026-03-31T00:00:00Z".to_string(),
            vec![(step_id.to_string(), "test-step".to_string())],
            serde_json::Map::new(),
        )
    }

    fn counting_persist(counter: Arc<AtomicU32>) -> impl Fn(&WorkflowState) -> Result<(), String> {
        move |_state: &WorkflowState| {
            counter.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    // -- Checkpoint gate tests (FR-004 / SC-002) --

    #[tokio::test]
    async fn checkpoint_pauses_and_resumes_on_confirm() {
        let mut state = make_state("step_001");
        let persist_count = Arc::new(AtomicU32::new(0));
        let handler = ImmediateApproveHandler;
        let gate = StepGateConfig::Checkpoint {
            label: Some("Deploy checkpoint".into()),
        };

        let outcome = evaluate_gate(
            &mut state,
            "step_001",
            &gate,
            &handler,
            counting_persist(persist_count.clone()),
        )
        .await
        .unwrap();

        assert_eq!(outcome, GateOutcome::Approved);
        // After confirmation, workflow should be back to Running.
        assert_eq!(state.status, WorkflowStatus::Running);
        // Two persists: one for awaiting_checkpoint, one for released.
        assert_eq!(persist_count.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn checkpoint_without_label_works() {
        let mut state = make_state("step_001");
        let handler = ImmediateApproveHandler;
        let gate = StepGateConfig::Checkpoint { label: None };

        let outcome = evaluate_gate(&mut state, "step_001", &gate, &handler, |_| Ok(()))
            .await
            .unwrap();

        assert_eq!(outcome, GateOutcome::Approved);
        assert_eq!(state.status, WorkflowStatus::Running);
    }

    #[tokio::test]
    async fn checkpoint_handler_error_propagates() {
        let mut state = make_state("step_001");
        let handler = ErrorHandler("operator declined".into());
        let gate = StepGateConfig::Checkpoint { label: None };

        let result = evaluate_gate(&mut state, "step_001", &gate, &handler, |_| Ok(())).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            GateError::HandlerError(msg) => assert_eq!(msg, "operator declined"),
        }
    }

    // -- Approval gate tests (FR-005 / SC-003) --

    #[tokio::test]
    async fn approval_approved_within_timeout() {
        let mut state = make_state("step_001");
        let persist_count = Arc::new(AtomicU32::new(0));
        let handler = ImmediateApproveHandler;
        let gate = StepGateConfig::Approval {
            timeout_ms: 5_000,
            escalation: Some(ApprovalEscalation::Fail),
            checkpoint_id: None,
        };

        let outcome = evaluate_gate(
            &mut state,
            "step_001",
            &gate,
            &handler,
            counting_persist(persist_count.clone()),
        )
        .await
        .unwrap();

        assert_eq!(outcome, GateOutcome::Approved);
        assert_eq!(state.status, WorkflowStatus::Running);
        assert_eq!(persist_count.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn approval_timeout_escalation_fail() {
        let mut state = make_state("step_001");
        let handler = NeverRespondHandler;
        let gate = StepGateConfig::Approval {
            timeout_ms: 50, // 50ms — will time out quickly
            escalation: Some(ApprovalEscalation::Fail),
            checkpoint_id: None,
        };

        let outcome = evaluate_gate(&mut state, "step_001", &gate, &handler, |_| Ok(()))
            .await
            .unwrap();

        assert_eq!(
            outcome,
            GateOutcome::TimedOut {
                escalation: ApprovalEscalation::Fail
            }
        );
        assert_eq!(state.status, WorkflowStatus::TimedOut);
        assert_eq!(state.steps[0].status, StepExecutionStatus::Failed);
        assert!(state.steps[0].completed_at.is_some());
    }

    #[tokio::test]
    async fn approval_timeout_escalation_skip() {
        let mut state = make_state("step_001");
        let handler = NeverRespondHandler;
        let gate = StepGateConfig::Approval {
            timeout_ms: 50,
            escalation: Some(ApprovalEscalation::Skip),
            checkpoint_id: None,
        };

        let outcome = evaluate_gate(&mut state, "step_001", &gate, &handler, |_| Ok(()))
            .await
            .unwrap();

        assert_eq!(
            outcome,
            GateOutcome::TimedOut {
                escalation: ApprovalEscalation::Skip
            }
        );
        assert_eq!(state.status, WorkflowStatus::TimedOut);
        assert_eq!(state.steps[0].status, StepExecutionStatus::Skipped);
    }

    #[tokio::test]
    async fn approval_timeout_escalation_notify() {
        let mut state = make_state("step_001");
        let handler = NeverRespondHandler;
        let gate = StepGateConfig::Approval {
            timeout_ms: 50,
            escalation: Some(ApprovalEscalation::Notify),
            checkpoint_id: None,
        };

        let outcome = evaluate_gate(&mut state, "step_001", &gate, &handler, |_| Ok(()))
            .await
            .unwrap();

        assert_eq!(
            outcome,
            GateOutcome::TimedOut {
                escalation: ApprovalEscalation::Notify
            }
        );
        assert_eq!(state.status, WorkflowStatus::TimedOut);
        // Notify escalation keeps step as Failed to prevent pipeline stall.
        assert_eq!(state.steps[0].status, StepExecutionStatus::Failed);
    }

    #[tokio::test]
    async fn approval_timeout_defaults_to_fail_when_no_escalation() {
        let mut state = make_state("step_001");
        let handler = NeverRespondHandler;
        let gate = StepGateConfig::Approval {
            timeout_ms: 50,
            escalation: None, // No escalation configured — should default to Fail.
            checkpoint_id: None,
        };

        let outcome = evaluate_gate(&mut state, "step_001", &gate, &handler, |_| Ok(()))
            .await
            .unwrap();

        assert_eq!(
            outcome,
            GateOutcome::TimedOut {
                escalation: ApprovalEscalation::Fail
            }
        );
        assert_eq!(state.status, WorkflowStatus::TimedOut);
        assert_eq!(state.steps[0].status, StepExecutionStatus::Failed);
    }

    #[tokio::test]
    async fn approval_handler_error_propagates() {
        let mut state = make_state("step_001");
        let handler = ErrorHandler("connection lost".into());
        let gate = StepGateConfig::Approval {
            timeout_ms: 5_000,
            escalation: Some(ApprovalEscalation::Fail),
            checkpoint_id: None,
        };

        let result = evaluate_gate(&mut state, "step_001", &gate, &handler, |_| Ok(())).await;

        assert!(result.is_err());
        match result.unwrap_err() {
            GateError::HandlerError(msg) => assert_eq!(msg, "connection lost"),
        }
    }

    // -- evaluate_gate_if_present tests --

    #[tokio::test]
    async fn no_gate_returns_none() {
        let mut state = make_state("step_001");
        let handler = ImmediateApproveHandler;

        let outcome = evaluate_gate_if_present(&mut state, "step_001", None, &handler, |_| Ok(()))
            .await
            .unwrap();

        assert_eq!(outcome, None);
        // Status unchanged.
        assert_eq!(state.status, WorkflowStatus::Running);
    }

    #[tokio::test]
    async fn gate_present_delegates_to_evaluate_gate() {
        let mut state = make_state("step_001");
        let handler = ImmediateApproveHandler;
        let gate = StepGateConfig::Checkpoint { label: None };

        let outcome =
            evaluate_gate_if_present(&mut state, "step_001", Some(&gate), &handler, |_| Ok(()))
                .await
                .unwrap();

        assert_eq!(outcome, Some(GateOutcome::Approved));
    }

    // -- Persist callback error test --

    #[tokio::test]
    async fn persist_error_propagates_from_checkpoint() {
        let mut state = make_state("step_001");
        let handler = ImmediateApproveHandler;
        let gate = StepGateConfig::Checkpoint { label: None };

        let result = evaluate_gate(&mut state, "step_001", &gate, &handler, |_| {
            Err("disk full".to_string())
        })
        .await;

        assert!(result.is_err());
        match result.unwrap_err() {
            GateError::HandlerError(msg) => assert_eq!(msg, "disk full"),
        }
    }
}
