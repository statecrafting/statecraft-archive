// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// GateHandler implementations for terminal interaction and non-interactive automation.

use crate::GateHandler;
use async_trait::async_trait;
use std::io::BufRead as _;

// ---------------------------------------------------------------------------
// CliGateHandler — interactive terminal
// ---------------------------------------------------------------------------

/// Interactive terminal gate handler.
///
/// `await_checkpoint` prints a prompt to stderr and blocks until the operator
/// presses Enter (continue) or types "reject" (halt).
///
/// `await_approval` prints a prompt to stderr and blocks until the operator
/// types "yes" (approve) or any other input (reject).
pub struct CliGateHandler;

#[async_trait]
impl GateHandler for CliGateHandler {
    async fn await_checkpoint(&self, step_id: &str, label: Option<&str>) -> Result<(), String> {
        let display = label.unwrap_or(step_id);
        eprint!("\n[CHECKPOINT] {display}\nPress Enter to continue, or type 'reject' to halt: ");

        let line = read_stdin_line().await?;
        if line.trim().starts_with("reject") {
            return Err(format!("checkpoint rejected by operator: {display}"));
        }
        Ok(())
    }

    async fn await_approval(&self, step_id: &str, timeout_ms: u64) -> Result<(), String> {
        let timeout_secs = timeout_ms / 1000;
        eprint!(
            "\n[APPROVAL REQUIRED] Step {step_id}\nTimeout: {timeout_secs}s\nType 'yes' to approve or 'no' to reject: "
        );

        let line = read_stdin_line().await?;
        if line.trim().eq_ignore_ascii_case("yes") {
            Ok(())
        } else {
            Err(format!("approval denied for step: {step_id}"))
        }
    }
}

/// Read a single line from stdin, offloaded to a blocking thread so the
/// async runtime is not stalled.
async fn read_stdin_line() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let stdin = std::io::stdin();
        let mut line = String::new();
        stdin
            .lock()
            .read_line(&mut line)
            .map_err(|e| format!("stdin read error: {e}"))?;
        Ok(line)
    })
    .await
    .map_err(|e| format!("blocking task error: {e}"))?
}

// ---------------------------------------------------------------------------
// AutoApproveGateHandler — non-interactive
// ---------------------------------------------------------------------------

/// Non-interactive gate handler that auto-approves every gate.
///
/// Suitable for CI pipelines, test environments, or any context where no
/// human operator is available. Each call prints a message to stderr so the
/// auto-approval is visible in logs.
pub struct AutoApproveGateHandler;

#[async_trait]
impl GateHandler for AutoApproveGateHandler {
    async fn await_checkpoint(&self, step_id: &str, _label: Option<&str>) -> Result<(), String> {
        eprintln!("[AUTO-APPROVE] checkpoint: {step_id}");
        Ok(())
    }

    async fn await_approval(&self, step_id: &str, _timeout_ms: u64) -> Result<(), String> {
        eprintln!("[AUTO-APPROVE] approval: {step_id}");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn auto_approve_checkpoint_always_ok() {
        let handler = AutoApproveGateHandler;
        assert!(
            handler
                .await_checkpoint("step_001", Some("Deploy"))
                .await
                .is_ok()
        );
        assert!(handler.await_checkpoint("step_002", None).await.is_ok());
    }

    #[tokio::test]
    async fn auto_approve_approval_always_ok() {
        let handler = AutoApproveGateHandler;
        assert!(handler.await_approval("step_001", 5_000).await.is_ok());
    }
}
