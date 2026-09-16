//! WSL (Windows Subsystem for Linux) integration commands.
//!
//! Windows-only: lists distros and executes commands inside a chosen distro.
//! Compiles to no-op stubs on macOS and Linux so the binary stays cross-platform.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct WslDistro {
    pub name: String,
    pub is_default: bool,
    pub state: String,
}

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct WslOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

// ─── Windows implementations ──────────────────────────────────────────────────

#[cfg(target_os = "windows")]
mod inner {
    use super::*;
    use std::process::Command;

    pub fn wsl_is_available_impl() -> bool {
        Command::new("wsl.exe")
            .arg("--status")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    pub fn wsl_list_distros_impl() -> Result<Vec<WslDistro>, String> {
        let output = Command::new("wsl.exe")
            .args(["--list", "--verbose"])
            .output()
            .map_err(|e| format!("Failed to run wsl.exe: {e}"))?;

        // wsl.exe may output UTF-16 on some Windows versions; decode gracefully
        let raw = String::from_utf8_lossy(&output.stdout);
        let mut distros = Vec::new();

        for line in raw.lines().skip(1) {
            // Format: "* Ubuntu    Running    2" or "  Debian    Stopped    2"
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let is_default = trimmed.starts_with('*');
            let rest = trimmed.trim_start_matches('*').trim();
            let mut parts = rest.split_whitespace();
            let name = parts.next().unwrap_or("").to_string();
            let state = parts.next().unwrap_or("Unknown").to_string();
            if !name.is_empty() {
                distros.push(WslDistro {
                    name,
                    is_default,
                    state,
                });
            }
        }

        Ok(distros)
    }

    pub fn wsl_execute_impl(
        distro: &str,
        command: &str,
        cwd: Option<&str>,
    ) -> Result<WslOutput, String> {
        let mut cmd = Command::new("wsl.exe");
        cmd.args(["-d", distro, "--"]);

        if let Some(dir) = cwd {
            // Convert Windows path to WSL path if needed
            let wsl_cwd = if dir.contains(':') {
                let drive = dir.chars().next().unwrap_or('c').to_lowercase().to_string();
                let rest = dir[2..].replace('\\', "/");
                format!("/mnt/{drive}{rest}")
            } else {
                dir.to_string()
            };
            cmd.args(["bash", "-c", &format!("cd {wsl_cwd:?} && {command}")]);
        } else {
            cmd.args(["bash", "-c", command]);
        }

        let output = cmd
            .output()
            .map_err(|e| format!("Failed to spawn wsl.exe: {e}"))?;

        Ok(WslOutput {
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            exit_code: output.status.code().unwrap_or(-1),
        })
    }
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Returns true if WSL is available on this system (Windows only).
#[tauri::command]
#[specta::specta]
pub fn wsl_is_available() -> bool {
    #[cfg(target_os = "windows")]
    return inner::wsl_is_available_impl();
    #[cfg(not(target_os = "windows"))]
    false
}

/// Lists installed WSL distributions (Windows only; empty list on other platforms).
#[tauri::command]
#[specta::specta]
pub fn wsl_list_distros() -> Result<Vec<WslDistro>, String> {
    #[cfg(target_os = "windows")]
    return inner::wsl_list_distros_impl();
    #[cfg(not(target_os = "windows"))]
    Ok(vec![])
}

/// Executes a shell command inside a WSL distro (Windows only).
#[tauri::command]
#[specta::specta]
pub fn wsl_execute(
    distro: String,
    command: String,
    cwd: Option<String>,
) -> Result<WslOutput, String> {
    #[cfg(target_os = "windows")]
    return inner::wsl_execute_impl(&distro, &command, cwd.as_deref());
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, command, cwd);
        Err("WSL is only available on Windows".to_string())
    }
}
