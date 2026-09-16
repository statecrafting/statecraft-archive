// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: VERIFY_PROTOCOL
// Spec: spec/verification.yaml

use crate::verification::config::{Cmd, NetworkMode, StepConfig};
use anyhow::{Context, Result, anyhow};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub struct ConstrainedRunner;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    pub exit_code: i32,
    pub duration_ms: u64,
    pub stdout_sha256: String,
    pub stderr_sha256: String,
    pub stdout_preview: String,
    pub stderr_preview: String,
}

impl ConstrainedRunner {
    pub fn run_step(step: &StepConfig, workdir: &Path) -> Result<StepResult> {
        let start_time = Instant::now();

        // 1. Prepare Command
        let (program, args) = match &step.cmd {
            Cmd::String(s) => {
                // Split string into program + args?
                // Or use shell? Spec says "cmd" is list of strings usually.
                // If it is string: "One of [string, array]".
                // A simple strategy for string is to split by whitespace or use sh -c?
                // "cargo fmt --check" -> program="cargo", args=["fmt", "--check"]
                // Let's assume standard split for now, but array is safer.
                let mut parts = s.split_whitespace();
                let prog = parts
                    .next()
                    .ok_or_else(|| anyhow!("Empty command string"))?;
                (prog, parts.collect::<Vec<&str>>())
            }
            Cmd::Argv(parts) => {
                let prog = parts
                    .first()
                    .ok_or_else(|| anyhow!("Empty command array"))?;
                let args: Vec<&str> = parts.iter().skip(1).map(|s| s.as_str()).collect();
                (prog.as_str(), args)
            }
        };

        let cmd_workdir = if let Some(wd) = &step.workdir {
            workdir.join(wd)
        } else {
            workdir.to_path_buf()
        };

        let mut cmd = Command::new(program);
        cmd.args(args);
        cmd.current_dir(cmd_workdir);
        cmd.stdin(Stdio::null()); // No stdin for automated steps
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // 2. Environment Scrubbing & Enforce Network Policy
        cmd.env_clear();

        // Always allow HOME, USER, PATH, TERM?
        // Spec defaults: "CI", "RUST_LOG".
        // Plus explicitly allowed vars.
        // We MUST verify PATH is present or command won't find executable unless absolute.
        // Usually we inherit PATH.
        // Let's inherit PATH by default for now, plus essential vars.
        if let Ok(path) = std::env::var("PATH") {
            cmd.env("PATH", path);
        }
        // Inherit HOME? Cargo needs it.
        if let Ok(home) = std::env::var("HOME") {
            cmd.env("HOME", home);
        }

        // Apply explicitly defined envs
        if let Some(env_map) = &step.env {
            for (k, v) in env_map {
                cmd.env(k, v);
            }
        }

        // Apply allowlist from parent process
        if let Some(allowlist) = &step.env_allowlist {
            for k in allowlist {
                if let Ok(v) = std::env::var(k) {
                    cmd.env(k, v);
                }
            }
        }

        // Network Policy "Best Effort" Enforcement
        // If Deny:
        // - clear HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, NO_PROXY
        // - Maybe set them to something broken?
        // Spec says "enforced at least as env-scrub policy".
        // Default is Deny.
        let network_mode = step.network.unwrap_or_default();
        if network_mode == NetworkMode::Deny {
            // Scrub proxy vars to prevents accidental access via proxy
            cmd.env_remove("HTTP_PROXY");
            cmd.env_remove("HTTPS_PROXY");
            cmd.env_remove("ALL_PROXY");
            cmd.env_remove("http_proxy"); // Lowercase too
            cmd.env_remove("https_proxy");
            cmd.env_remove("all_proxy");
        }

        // 3. Execution with Timeout
        // Rust's Command doesn't have native timeout.
        // We spawn and wait in thread/loop or use a crate.
        // We can't use wait_timeout crate easily without adding dep.
        // We can spawn, and check in loop?
        // Or simple: spawn, identify pid, park?
        // Given we don't have async here (ConstrainedRunner is sync),
        // we might be blocking.
        // Let's use `process_child_with_timeout` helper if possible.
        // Since we are writing std code:

        let child = cmd.spawn().context("Failed to spawn command")?;
        let timeout = Duration::from_millis(step.timeout_ms.unwrap_or(600_000));

        // Timeout strategy:
        // - Spawn a killer thread that waits on a cancel channel with the timeout deadline.
        // - Main thread calls wait_with_output() (which also drains stdout/stderr pipes).
        // - When process exits naturally, main thread sends cancel signal → killer does nothing.
        // - When timeout fires first, killer kills the process → wait_with_output() unblocks.
        // This avoids the inverted-channel race where the killer fires after natural exit.

        let pid = child.id();
        let (cancel_tx, cancel_rx) = std::sync::mpsc::channel::<()>();

        let _killer = thread::spawn(move || {
            match cancel_rx.recv_timeout(timeout) {
                Ok(_) => {} // Process completed normally; no kill needed.
                Err(_) => {
                    // Timeout expired — kill the process.
                    #[cfg(unix)]
                    let _ = Command::new("kill").arg("-9").arg(pid.to_string()).output();
                    #[cfg(windows)]
                    let _ = Command::new("taskkill")
                        .args(["/F", "/PID", &pid.to_string()])
                        .output();
                }
            }
        });

        let output_res = child.wait_with_output();

        // Cancel the killer (no-op if already fired).
        let _ = cancel_tx.send(());

        let output = output_res.context("Failed to wait on child process")?;
        let duration = start_time.elapsed();

        // Check if we timed out (exit code might be signal)
        // On unix, signal kill.

        // 4. Capture & Process Output
        let stdout_bytes = output.stdout;
        let stderr_bytes = output.stderr;

        let stdout_sha256 = hex::encode(Sha256::digest(&stdout_bytes));
        let stderr_sha256 = hex::encode(Sha256::digest(&stderr_bytes));

        let stdout_preview = make_preview(&stdout_bytes);
        let stderr_preview = make_preview(&stderr_bytes);

        // Exit Code
        let exit_code = output.status.code().unwrap_or(-1); // -1 if signal killed

        Ok(StepResult {
            exit_code,
            duration_ms: duration.as_millis() as u64,
            stdout_sha256,
            stderr_sha256,
            stdout_preview,
            stderr_preview,
        })
    }
}

fn make_preview(bytes: &[u8]) -> String {
    let limit = 4096;
    let len = std::cmp::min(bytes.len(), limit);
    let slice = &bytes[..len];
    String::from_utf8_lossy(slice).into_owned()
}
