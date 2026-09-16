// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/075-factory-workflow-engine/spec.md

//! Post-step verification hook execution (075 FR-005, FR-006).

use crate::manifest::VerifyCommand;
use std::path::Path;
use std::process::Stdio;
use tokio::process::Command;

/// Result of running a verification command sequence.
#[derive(Clone, Debug)]
pub enum VerifyOutcome {
    /// All commands passed.
    Passed,
    /// A command failed. Includes the command index, command string, and combined output.
    Failed {
        command_index: usize,
        command: String,
        exit_code: Option<i32>,
        /// Combined stdout + stderr so tools that write errors to stdout (tsc, eslint) are captured.
        output: String,
    },
}

/// Run all verification commands in sequence (075 FR-005).
///
/// Commands run in the given `project_root` directory with `working_dir` resolved
/// relative to it. Returns on first failure.
///
/// SECURITY BOUNDARY: each `vc.command` is executed via `sh -c` on the host
/// running the pipeline. The command strings come from the step manifest
/// (config/spec-derived), not from an untrusted end-user request path; this
/// is by design, on par with every other command the manifest configures
/// the pipeline to run. There is no flag here to require isolated
/// execution; if untrusted or third-party manifests become a supported
/// input, this is the call site to route through a sandbox execution
/// contract (see `factory_engine::sandbox::SandboxClient`, spec 162)
/// instead of the host shell.
pub async fn run_verify_commands(commands: &[VerifyCommand], project_root: &Path) -> VerifyOutcome {
    for (i, vc) in commands.iter().enumerate() {
        let work_dir = project_root.join(&vc.working_dir);

        let result = tokio::time::timeout(
            std::time::Duration::from_millis(vc.timeout_ms),
            Command::new("sh")
                .arg("-c")
                .arg(&vc.command)
                .current_dir(&work_dir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output(),
        )
        .await;

        match result {
            Ok(Ok(output)) if output.status.success() => {
                // Command passed, continue to next.
            }
            Ok(Ok(cmd_output)) => {
                let stdout = String::from_utf8_lossy(&cmd_output.stdout);
                let stderr = String::from_utf8_lossy(&cmd_output.stderr);
                let combined = match (stdout.is_empty(), stderr.is_empty()) {
                    (true, true) => "(no output)".to_string(),
                    (false, true) => stdout.into_owned(),
                    (true, false) => stderr.into_owned(),
                    (false, false) => format!("{stdout}\n{stderr}"),
                };
                return VerifyOutcome::Failed {
                    command_index: i,
                    command: vc.command.clone(),
                    exit_code: cmd_output.status.code(),
                    output: combined,
                };
            }
            Ok(Err(io_err)) => {
                return VerifyOutcome::Failed {
                    command_index: i,
                    command: vc.command.clone(),
                    exit_code: None,
                    output: format!("failed to execute: {io_err}"),
                };
            }
            Err(_elapsed) => {
                return VerifyOutcome::Failed {
                    command_index: i,
                    command: vc.command.clone(),
                    exit_code: None,
                    output: format!("timed out after {}ms", vc.timeout_ms),
                };
            }
        }
    }
    VerifyOutcome::Passed
}

/// Build a retry instruction by appending verification failure context (075 FR-006).
///
/// Uses the *original* instruction (not a previously retried one) to avoid
/// nested "PREVIOUS ATTEMPT FAILED" wrappers that waste tokens.
pub fn build_retry_instruction(
    original_instruction: &str,
    verify_output: &str,
    attempt: u32,
    max_retries: u32,
) -> String {
    let truncated = truncate_verify_output(verify_output, 4000);
    format!(
        "{original_instruction}\n\n\
         --- RETRY {attempt}/{max_retries} ---\n\
         Your previous attempt failed verification. Fix the following errors, \
         then ensure the project builds and tests pass.\n\n\
         {truncated}\n\
         ---"
    )
}

/// Truncate verification output to roughly `max_chars`, keeping the head and
/// tail so both the first error and final summary are visible.
fn truncate_verify_output(output: &str, max_chars: usize) -> String {
    if output.len() <= max_chars {
        return output.to_string();
    }
    let half = max_chars / 2;
    let head = &output[..half];
    let tail = &output[output.len() - half..];
    format!(
        "{head}\n\n... ({} chars truncated) ...\n\n{tail}",
        output.len() - max_chars
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn passing_commands() {
        let cmds = vec![
            VerifyCommand {
                command: "true".into(),
                working_dir: ".".into(),
                timeout_ms: 5000,
            },
            VerifyCommand {
                command: "echo ok".into(),
                working_dir: ".".into(),
                timeout_ms: 5000,
            },
        ];
        let result = run_verify_commands(&cmds, Path::new("/tmp")).await;
        assert!(matches!(result, VerifyOutcome::Passed));
    }

    #[tokio::test]
    async fn failing_command_returns_stderr() {
        let cmds = vec![
            VerifyCommand {
                command: "true".into(),
                working_dir: ".".into(),
                timeout_ms: 5000,
            },
            VerifyCommand {
                command: "sh -c 'echo boom >&2; exit 1'".into(),
                working_dir: ".".into(),
                timeout_ms: 5000,
            },
        ];
        let result = run_verify_commands(&cmds, Path::new("/tmp")).await;
        match result {
            VerifyOutcome::Failed {
                command_index,
                output,
                ..
            } => {
                assert_eq!(command_index, 1);
                assert!(output.contains("boom"));
            }
            _ => panic!("expected failure"),
        }
    }

    #[test]
    fn retry_instruction_format() {
        let retry = build_retry_instruction("write the code", "type error on line 5", 1, 3);
        assert!(retry.contains("RETRY 1/3"));
        assert!(retry.contains("type error on line 5"));
        assert!(retry.contains("write the code"));
    }

    #[test]
    fn truncate_verify_output_truncates_long_output() {
        let long_output = "x".repeat(5000);
        let truncated = truncate_verify_output(&long_output, 4000);
        assert!(truncated.len() < 5000);
        assert!(truncated.contains("truncated"));
    }
}
