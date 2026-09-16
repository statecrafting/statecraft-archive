//! Shared types used across new command modules.
//! Types here derive `specta::Type` so tauri-specta can export them to TypeScript.

use regex::Regex;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::LazyLock;

/// Default global shortcut for the quick pane.
pub const DEFAULT_QUICK_PANE_SHORTCUT: &str = "CommandOrControl+Shift+.";

/// Maximum size for recovery data files (10 MB).
pub const MAX_RECOVERY_DATA_BYTES: u32 = 10_485_760;

/// Pre-compiled regex for filename validation.
/// Allows alphanumeric, dashes, underscores, and a single dot-extension.
pub static FILENAME_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9]+)?$")
        .expect("Failed to compile filename regex pattern")
});

// ============================================================================
// Recovery
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type")]
pub enum RecoveryError {
    FileNotFound,
    ValidationError { message: String },
    DataTooLarge { max_bytes: u32 },
    IoError { message: String },
    ParseError { message: String },
}

impl std::fmt::Display for RecoveryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RecoveryError::FileNotFound => write!(f, "File not found"),
            RecoveryError::ValidationError { message } => write!(f, "Validation error: {message}"),
            RecoveryError::DataTooLarge { max_bytes } => {
                write!(f, "Data too large (max {max_bytes} bytes)")
            }
            RecoveryError::IoError { message } => write!(f, "IO error: {message}"),
            RecoveryError::ParseError { message } => write!(f, "Parse error: {message}"),
        }
    }
}

// ============================================================================
// Updater
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UpdateInfo {
    /// Version string without leading "v" (e.g. "0.2.0").
    pub version: String,
    /// Release notes from the GitHub release body.
    pub notes: String,
    /// Direct download URL for the platform installer asset.
    pub url: String,
    /// Expected SHA-256 hex digest of the installer file.
    pub checksum: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type")]
pub enum UpdateError {
    NoUpdateAvailable,
    NetworkError { message: String },
    ChecksumMismatch,
    LaunchFailed { message: String },
}

impl std::fmt::Display for UpdateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UpdateError::NoUpdateAvailable => write!(f, "No update available"),
            UpdateError::NetworkError { message } => write!(f, "Network error: {message}"),
            UpdateError::ChecksumMismatch => {
                write!(f, "Checksum mismatch — download may be corrupt")
            }
            UpdateError::LaunchFailed { message } => {
                write!(f, "Failed to launch installer: {message}")
            }
        }
    }
}

// ============================================================================
// Git
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type")]
pub enum GitError {
    NotFound { message: String },
    RefNotFound { message: String },
    DetachedHead,
    Other { message: String },
}

impl std::fmt::Display for GitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GitError::NotFound { message } => write!(f, "Not found: {message}"),
            GitError::RefNotFound { message } => write!(f, "Ref not found: {message}"),
            GitError::DetachedHead => write!(f, "Repository is in detached HEAD state"),
            GitError::Other { message } => write!(f, "Git error: {message}"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct GitDiff {
    pub stat: String,
    pub diff: String,
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct GitStatusEntry {
    pub path: String,
    /// "added", "modified", "deleted", "renamed", "untracked", "conflicted"
    pub status: String,
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct GitAheadBehind {
    pub ahead: u32,
    pub behind: u32,
}

/// Latest commit on `HEAD` (`git log -1` — hash + first line of message).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct GitHeadCommit {
    pub hash: String,
    pub message: String,
}

// ============================================================================
// Window control
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

// ============================================================================
// Validation helpers
// ============================================================================

/// Validates a filename for safe file-system operations.
pub fn validate_filename(filename: &str) -> Result<(), String> {
    if filename.is_empty() {
        return Err("Filename cannot be empty".to_string());
    }
    if filename.chars().count() > 100 {
        return Err("Filename too long (max 100 characters)".to_string());
    }
    if !FILENAME_PATTERN.is_match(filename) {
        return Err(
            "Invalid filename: only alphanumeric characters, dashes, underscores, and dots allowed"
                .to_string(),
        );
    }
    Ok(())
}
