// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/185-sandbox-local-container-backend/spec.md — §2.1, FR-001

//! Runtime detection: probe a Docker-compatible Unix socket and classify
//! the responding engine as Docker or Podman.

use bollard::Docker;
use bollard::system::Version;
use std::path::{Path, PathBuf};

/// Internal state describing the resolved runtime.
#[derive(Debug)]
pub(crate) enum RuntimeState {
    /// No reachable Docker-compatible socket. Every `execute()` call
    /// returns [`factory_engine::sandbox::SandboxError::Unavailable`]
    /// with the captured probe diagnostics.
    Unavailable { diagnostic: String },
    /// A socket probe succeeded and the Engine reports a version.
    Connected {
        docker: Docker,
        #[allow(dead_code)] // diagnostic field; surfaced through tracing.
        socket: PathBuf,
        runtime: DetectedRuntime,
        // Boxed to keep RuntimeState compact; Version carries ~360 bytes
        // of optional fields (Engine version string, components vec, etc.)
        // that the Unavailable variant does not need.
        version: Box<Version>,
    },
}

/// Runtime family detected at probe time.
///
/// Distinguished by inspecting `Version.components` (Podman publishes a
/// `"Podman Engine"` component) or `Version.platform.name`. Docker
/// publishes neither marker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DetectedRuntime {
    Docker,
    Podman,
}

impl DetectedRuntime {
    /// Lowercase identifier for diagnostics + `runtime_descriptor` JSON.
    pub fn as_str(self) -> &'static str {
        match self {
            DetectedRuntime::Docker => "docker",
            DetectedRuntime::Podman => "podman",
        }
    }
}

/// A single probe failure, kept for diagnostic compositing.
#[derive(Debug, Clone)]
pub(crate) struct ProbeFailure {
    pub socket: PathBuf,
    pub reason: String,
}

/// Default socket-probe sequence per spec 185 §2.1.
pub(crate) fn default_socket_candidates() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    // 1. DOCKER_HOST env override (only honour unix:// forms here; tcp://
    //    URIs are an FU-005 follow-up — see spec 185 §5).
    if let Ok(host) = std::env::var("DOCKER_HOST")
        && let Some(stripped) = host.strip_prefix("unix://")
    {
        candidates.push(PathBuf::from(stripped));
    }
    // 2. Rootless Podman socket under XDG_RUNTIME_DIR.
    if let Some(podman) = rootless_podman_socket() {
        candidates.push(podman);
    }
    // 3. Docker default.
    candidates.push(PathBuf::from("/var/run/docker.sock"));
    candidates
}

fn rootless_podman_socket() -> Option<PathBuf> {
    let runtime_dir: PathBuf = match std::env::var("XDG_RUNTIME_DIR").ok() {
        Some(dir) => PathBuf::from(dir),
        None => fallback_runtime_dir()?,
    };
    Some(runtime_dir.join("podman").join("podman.sock"))
}

#[cfg(target_os = "linux")]
fn fallback_runtime_dir() -> Option<PathBuf> {
    // `libc_getuid` is declared `safe fn` inside an `unsafe extern`
    // block (Rust 2024 syntax) — no `unsafe { ... }` wrapper needed.
    let uid = libc_getuid();
    Some(PathBuf::from(format!("/run/user/{uid}")))
}

#[cfg(not(target_os = "linux"))]
fn fallback_runtime_dir() -> Option<PathBuf> {
    None
}

#[cfg(target_os = "linux")]
unsafe extern "C" {
    #[link_name = "getuid"]
    safe fn libc_getuid() -> u32;
}

const DOCKER_API_TIMEOUT_SECS: u64 = 4;

/// Probe a single Unix socket: connect, call `version()`, capture the
/// response.
pub(crate) async fn probe_socket(socket: &Path) -> Result<(Docker, Version), String> {
    if !socket.exists() {
        return Err(format!("socket {} does not exist", socket.display()));
    }
    let socket_str = socket
        .to_str()
        .ok_or_else(|| format!("socket path {} is not valid UTF-8", socket.display()))?;
    let docker = Docker::connect_with_unix(
        socket_str,
        DOCKER_API_TIMEOUT_SECS,
        bollard::API_DEFAULT_VERSION,
    )
    .map_err(|e| format!("bollard connect: {e}"))?;
    match docker.version().await {
        Ok(version) => Ok((docker, version)),
        Err(e) => Err(format!("/version probe failed: {e}")),
    }
}

/// Distinguish Podman from Docker by inspecting `Version`.
pub(crate) fn classify_runtime(version: &Version) -> DetectedRuntime {
    if let Some(components) = version.components.as_ref()
        && components
            .iter()
            .any(|c| c.name.to_lowercase().contains("podman"))
    {
        return DetectedRuntime::Podman;
    }
    if let Some(platform) = version.platform.as_ref()
        && platform.name.to_lowercase().contains("podman")
    {
        return DetectedRuntime::Podman;
    }
    DetectedRuntime::Docker
}

pub(crate) fn format_probe_failures(failures: &[ProbeFailure]) -> String {
    if failures.is_empty() {
        return "local-container backend probe ran with no candidates".into();
    }
    let mut buf = String::from(
        "no reachable Docker-compatible socket (spec 185 §2.1 probe sequence); attempted: ",
    );
    for (i, f) in failures.iter().enumerate() {
        if i > 0 {
            buf.push_str(", ");
        }
        buf.push_str(&format!("{} ({})", f.socket.display(), f.reason));
    }
    buf
}

#[cfg(test)]
mod tests {
    use super::*;
    use bollard::system::VersionComponents;

    #[test]
    fn detected_runtime_as_str() {
        assert_eq!(DetectedRuntime::Docker.as_str(), "docker");
        assert_eq!(DetectedRuntime::Podman.as_str(), "podman");
    }

    #[test]
    fn classify_runtime_recognises_podman_component() {
        let version = Version {
            components: Some(vec![VersionComponents {
                name: "Podman Engine".into(),
                version: "4.9.0".into(),
                details: None,
            }]),
            ..Default::default()
        };
        assert_eq!(classify_runtime(&version), DetectedRuntime::Podman);
    }

    #[test]
    fn classify_runtime_defaults_to_docker() {
        let version = Version {
            components: Some(vec![VersionComponents {
                name: "Engine".into(),
                version: "28.0.0".into(),
                details: None,
            }]),
            ..Default::default()
        };
        assert_eq!(classify_runtime(&version), DetectedRuntime::Docker);
    }

    #[test]
    fn classify_runtime_recognises_podman_platform_name() {
        let version = Version {
            platform: Some(bollard::models::SystemVersionPlatform {
                name: "podman".into(),
            }),
            ..Default::default()
        };
        assert_eq!(classify_runtime(&version), DetectedRuntime::Podman);
    }

    #[test]
    fn format_probe_failures_lists_attempts() {
        let failures = vec![
            ProbeFailure {
                socket: PathBuf::from("/tmp/a"),
                reason: "boom".into(),
            },
            ProbeFailure {
                socket: PathBuf::from("/tmp/b"),
                reason: "nope".into(),
            },
        ];
        let s = format_probe_failures(&failures);
        assert!(s.contains("/tmp/a (boom)"));
        assert!(s.contains("/tmp/b (nope)"));
        assert!(s.contains("spec 185"));
    }
}
