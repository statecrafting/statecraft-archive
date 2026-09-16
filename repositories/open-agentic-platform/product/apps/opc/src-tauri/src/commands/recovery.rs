//! Emergency data recovery commands.
//!
//! Provides a simple pattern for saving JSON data to disk for crash recovery
//! or session persistence. Uses atomic writes (write temp → rename) to prevent
//! file corruption on crash.

use serde_json::Value;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::types::{MAX_RECOVERY_DATA_BYTES, RecoveryError, validate_filename};

fn get_recovery_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;
    let recovery_dir = app_data_dir.join("recovery");
    std::fs::create_dir_all(&recovery_dir)
        .map_err(|e| format!("Failed to create recovery directory: {e}"))?;
    Ok(recovery_dir)
}

/// Saves emergency data to a JSON file for later recovery.
/// Uses an atomic write (temp file → rename) so a crash mid-write never corrupts existing data.
/// Enforces a 10 MB size limit.
#[tauri::command]
#[specta::specta]
pub async fn save_emergency_data(
    app: AppHandle,
    filename: String,
    data: Value,
) -> Result<(), RecoveryError> {
    validate_filename(&filename).map_err(|e| RecoveryError::ValidationError { message: e })?;

    let json_content =
        serde_json::to_string_pretty(&data).map_err(|e| RecoveryError::ParseError {
            message: e.to_string(),
        })?;

    if json_content.len() > MAX_RECOVERY_DATA_BYTES as usize {
        return Err(RecoveryError::DataTooLarge {
            max_bytes: MAX_RECOVERY_DATA_BYTES,
        });
    }

    let recovery_dir = get_recovery_dir(&app).map_err(|e| RecoveryError::IoError { message: e })?;
    let file_path = recovery_dir.join(format!("{filename}.json"));
    let temp_path = file_path.with_extension("tmp");

    std::fs::write(&temp_path, json_content).map_err(|e| RecoveryError::IoError {
        message: e.to_string(),
    })?;

    if let Err(rename_err) = std::fs::rename(&temp_path, &file_path) {
        // Clean up orphaned temp file
        let _ = std::fs::remove_file(&temp_path);
        return Err(RecoveryError::IoError {
            message: rename_err.to_string(),
        });
    }

    log::info!("Saved emergency data to {file_path:?}");
    Ok(())
}

/// Loads emergency data from a previously saved JSON file.
/// Returns `RecoveryError::FileNotFound` if the file does not exist.
#[tauri::command]
#[specta::specta]
pub async fn load_emergency_data(app: AppHandle, filename: String) -> Result<Value, RecoveryError> {
    validate_filename(&filename).map_err(|e| RecoveryError::ValidationError { message: e })?;

    let recovery_dir = get_recovery_dir(&app).map_err(|e| RecoveryError::IoError { message: e })?;
    let file_path = recovery_dir.join(format!("{filename}.json"));

    if !file_path.exists() {
        return Err(RecoveryError::FileNotFound);
    }

    let contents = std::fs::read_to_string(&file_path).map_err(|e| RecoveryError::IoError {
        message: e.to_string(),
    })?;

    serde_json::from_str(&contents).map_err(|e| RecoveryError::ParseError {
        message: e.to_string(),
    })
}

/// Removes recovery files older than 7 days. Returns the count of removed files.
#[tauri::command]
#[specta::specta]
pub async fn cleanup_old_recovery_files(app: AppHandle) -> Result<u32, RecoveryError> {
    let recovery_dir = get_recovery_dir(&app).map_err(|e| RecoveryError::IoError { message: e })?;
    let mut removed_count = 0u32;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| RecoveryError::IoError {
            message: e.to_string(),
        })?
        .as_secs();
    let seven_days_ago = now - (7 * 24 * 60 * 60);

    let entries = std::fs::read_dir(&recovery_dir).map_err(|e| RecoveryError::IoError {
        message: e.to_string(),
    })?;

    for entry in entries.flatten() {
        let path: std::path::PathBuf = entry.path();
        if path.extension().is_none_or(|ext| ext != "json") {
            continue;
        }
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        let Ok(modified_dur) = modified.duration_since(UNIX_EPOCH) else {
            continue;
        };
        if modified_dur.as_secs() < seven_days_ago && std::fs::remove_file(&path).is_ok() {
            removed_count += 1;
        }
    }

    log::info!("Recovery cleanup: removed {removed_count} old files");
    Ok(removed_count)
}
