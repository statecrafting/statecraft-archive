//! Auto-updater with SHA-256 verification.
//!
//! Checks GitHub releases for a newer version, downloads the platform-appropriate
//! installer to a temp file, verifies its SHA-256 checksum, then launches it and exits.

use std::io::Write;

use reqwest::Client;
use sha2::{Digest, Sha256};

use crate::types::{UpdateError, UpdateInfo};

/// GitHub owner/repo used for the user-agent and release lookup.
const GITHUB_REPO: &str = "statecrafting/open-agentic-platform";

/// GitHub REST API endpoint for the latest release.
const GITHUB_API_URL: &str =
    "https://api.github.com/repos/statecrafting/open-agentic-platform/releases/latest";

#[derive(serde::Deserialize)]
struct GithubRelease {
    tag_name: String,
    body: Option<String>,
    assets: Vec<GithubAsset>,
}

#[derive(serde::Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

fn platform_asset_suffix() -> &'static str {
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "x64-setup.exe"
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64.dmg"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "amd64.AppImage"
    } else {
        ""
    }
}

fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let v = v.trim_start_matches('v');
    let mut parts = v.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    Some((major, minor, patch))
}

fn launch_installer_and_quit(path: &std::path::Path) -> Result<(), UpdateError> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(path)
            .spawn()
            .map_err(|e| UpdateError::LaunchFailed {
                message: format!("{e}"),
            })?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| UpdateError::LaunchFailed {
                message: format!("{e}"),
            })?;
    }

    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(path)
            .map_err(|e| UpdateError::LaunchFailed {
                message: format!("chmod: {e}"),
            })?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms).map_err(|e| UpdateError::LaunchFailed {
            message: format!("chmod: {e}"),
        })?;
        std::process::Command::new(path)
            .spawn()
            .map_err(|e| UpdateError::LaunchFailed {
                message: format!("{e}"),
            })?;
    }

    std::process::exit(0);
}

fn build_client(version: &str) -> Result<Client, UpdateError> {
    Client::builder()
        .user_agent(format!("{GITHUB_REPO}/{version}"))
        .build()
        .map_err(|e| UpdateError::NetworkError {
            message: format!("{e}"),
        })
}

/// Checks GitHub releases for a version newer than the running app.
///
/// Returns `UpdateError::NoUpdateAvailable` when already up to date.
#[tauri::command]
#[specta::specta]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<UpdateInfo, UpdateError> {
    let current_version = app.package_info().version.to_string();
    let client = build_client(&current_version)?;

    let release: GithubRelease = client
        .get(GITHUB_API_URL)
        .send()
        .await
        .map_err(|e| UpdateError::NetworkError {
            message: format!("{e}"),
        })?
        .json::<GithubRelease>()
        .await
        .map_err(|e| UpdateError::NetworkError {
            message: format!("Failed to parse release JSON: {e}"),
        })?;

    let current_ver = parse_version(&current_version).ok_or(UpdateError::NetworkError {
        message: format!("Cannot parse current version: {current_version}"),
    })?;
    let remote_ver = parse_version(&release.tag_name).ok_or(UpdateError::NetworkError {
        message: format!("Cannot parse remote tag: {}", release.tag_name),
    })?;

    if remote_ver <= current_ver {
        return Err(UpdateError::NoUpdateAvailable);
    }

    let suffix = platform_asset_suffix();
    let asset = release
        .assets
        .iter()
        .find(|a| a.name.ends_with(suffix))
        .ok_or(UpdateError::NetworkError {
            message: format!("No installer found for this platform (suffix: {suffix})"),
        })?;

    // Fetch SHA-256 sidecar file
    let sha_name = format!("{}.sha256", asset.name);
    let sha_asset =
        release
            .assets
            .iter()
            .find(|a| a.name == sha_name)
            .ok_or(UpdateError::NetworkError {
                message: format!("No checksum file found: {sha_name}"),
            })?;

    let checksum_raw = client
        .get(&sha_asset.browser_download_url)
        .send()
        .await
        .map_err(|e| UpdateError::NetworkError {
            message: format!("{e}"),
        })?
        .text()
        .await
        .map_err(|e| UpdateError::NetworkError {
            message: format!("{e}"),
        })?;

    // sha256sum format: "<hash>  <filename>" — take first token
    let checksum = checksum_raw
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_string();

    Ok(UpdateInfo {
        version: release.tag_name.trim_start_matches('v').to_string(),
        notes: release.body.unwrap_or_default(),
        url: asset.browser_download_url.clone(),
        checksum,
    })
}

/// Downloads the installer from `url`, verifies its SHA-256 against `expected_checksum`,
/// then launches it and exits the app.
///
/// This command never returns `Ok(())` — it calls `std::process::exit(0)` on success.
#[tauri::command]
#[specta::specta]
pub async fn download_and_install_update(
    url: String,
    expected_checksum: String,
) -> Result<(), UpdateError> {
    let client = build_client("updater")?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| UpdateError::NetworkError {
            message: format!("{e}"),
        })?;

    let filename = url.split('/').next_back().unwrap_or("opc_update");
    let temp_path = std::env::temp_dir().join(filename);

    let bytes = response
        .bytes()
        .await
        .map_err(|e| UpdateError::NetworkError {
            message: format!("Download failed: {e}"),
        })?;

    // Verify checksum before writing to disk
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let computed = hex::encode(hasher.finalize());

    if computed != expected_checksum.to_lowercase() {
        return Err(UpdateError::ChecksumMismatch);
    }

    let mut file = std::fs::File::create(&temp_path).map_err(|e| UpdateError::LaunchFailed {
        message: format!("Cannot create temp file: {e}"),
    })?;
    file.write_all(&bytes)
        .map_err(|e| UpdateError::LaunchFailed {
            message: format!("Cannot write temp file: {e}"),
        })?;
    drop(file); // Flush + close before launching

    log::info!("Update downloaded to {temp_path:?}, launching installer");
    launch_installer_and_quit(&temp_path)
}
