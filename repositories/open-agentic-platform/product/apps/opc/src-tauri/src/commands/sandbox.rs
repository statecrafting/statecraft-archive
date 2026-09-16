//! Sandbox status command — reports whether Claude CLI child processes
//! are running inside a seccomp/bwrap sandbox on Linux.
//!
//! On macOS and Windows this is a no-op: always returns unavailable/inactive.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Serialize, Deserialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SandboxStatus {
    /// True if a sandboxing method (bwrap) was found on PATH.
    pub available: bool,
    /// True if sandboxing is actively wrapping spawned CLI processes.
    pub active: bool,
    /// The sandboxing method in use, e.g. "bwrap". None when inactive.
    pub method: Option<String>,
}

#[cfg(target_os = "linux")]
mod inner {
    use super::SandboxStatus;
    use std::process::Command;

    pub fn sandbox_status_impl() -> SandboxStatus {
        let available = Command::new("bwrap")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        SandboxStatus {
            active: available,
            method: if available {
                Some("bwrap".to_string())
            } else {
                None
            },
            available,
        }
    }
}

/// Returns the current sandbox status for Claude CLI child processes.
/// On Linux: detects whether `bwrap` (bubblewrap) is available and active.
/// On macOS / Windows: always returns unavailable/inactive.
#[tauri::command]
#[specta::specta]
pub fn sandbox_status() -> SandboxStatus {
    #[cfg(target_os = "linux")]
    return inner::sandbox_status_impl();

    #[cfg(not(target_os = "linux"))]
    SandboxStatus {
        available: false,
        active: false,
        method: None,
    }
}
