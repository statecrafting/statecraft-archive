//! Window control commands: zoom, progress bar, bounds, and WSL detection.
//!
//! These commands give the frontend runtime control over window presentation
//! and let it query host environment details (WSL) without shelling out.
//!
//! ## Zoom state
//! Tauri 2 exposes `set_zoom` but no corresponding getter. `ZoomState` fills
//! that gap by tracking per-window zoom levels in managed memory so the
//! frontend can round-trip the value.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::{AppHandle, Manager, State};

use crate::types::WindowBounds;

// ============================================================================
// Managed zoom state
// ============================================================================

/// Tracks the last zoom factor set on each window by label.
/// Default zoom is 1.0 (returned when a window has never been explicitly zoomed).
#[derive(Default)]
pub struct ZoomState(pub Mutex<HashMap<String, f64>>);

// ============================================================================
// Zoom
// ============================================================================

/// Set the zoom factor for a webview window (default: `"main"`).
#[tauri::command]
#[specta::specta]
pub fn set_zoom(
    app: AppHandle,
    zoom_state: State<'_, ZoomState>,
    window_label: Option<String>,
    factor: f64,
) -> Result<(), String> {
    let label = window_label.as_deref().unwrap_or("main");
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("window '{label}' not found"))?;
    window.set_zoom(factor).map_err(|e| e.to_string())?;
    zoom_state
        .0
        .lock()
        .unwrap()
        .insert(label.to_string(), factor);
    Ok(())
}

/// Get the current zoom factor for a webview window (default: `"main"`).
/// Returns the last value set via `set_zoom`, or `1.0` if never zoomed.
#[tauri::command]
#[specta::specta]
pub fn get_zoom(zoom_state: State<'_, ZoomState>, window_label: Option<String>) -> f64 {
    let label = window_label.as_deref().unwrap_or("main");
    *zoom_state.0.lock().unwrap().get(label).unwrap_or(&1.0)
}

/// Set the same zoom factor on every open webview window.
#[tauri::command]
#[specta::specta]
pub fn broadcast_zoom(
    app: AppHandle,
    zoom_state: State<'_, ZoomState>,
    factor: f64,
) -> Result<(), String> {
    let mut errors: Vec<String> = Vec::new();
    let mut cache = zoom_state.0.lock().unwrap();
    for (label, window) in app.webview_windows() {
        match window.set_zoom(factor) {
            Ok(()) => {
                cache.insert(label, factor);
            }
            Err(e) => errors.push(format!("{label}: {e}")),
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

// ============================================================================
// Taskbar progress bar
// ============================================================================

/// Set the taskbar / dock progress bar on the main window.
///
/// `progress` — a value in `0..=100`; pass `None` to clear the indicator.
#[tauri::command]
#[specta::specta]
pub fn set_progress_bar(app: AppHandle, progress: Option<u32>) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    let state = match progress {
        Some(p) => ProgressBarState {
            status: Some(ProgressBarStatus::Normal),
            progress: Some(p.min(100) as u64),
        },
        None => ProgressBarState {
            status: Some(ProgressBarStatus::None),
            progress: None,
        },
    };
    window.set_progress_bar(state).map_err(|e| e.to_string())
}

// ============================================================================
// Window bounds
// ============================================================================

/// Get the outer position and size of a window (default: `"main"`).
#[tauri::command]
#[specta::specta]
pub fn get_window_bounds(
    app: AppHandle,
    window_label: Option<String>,
) -> Result<WindowBounds, String> {
    let label = window_label.as_deref().unwrap_or("main");
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("window '{label}' not found"))?;
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    Ok(WindowBounds {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    })
}

/// Set the outer position and size of a window (default: `"main"`).
#[tauri::command]
#[specta::specta]
pub fn set_window_bounds(
    app: AppHandle,
    window_label: Option<String>,
    bounds: WindowBounds,
) -> Result<(), String> {
    let label = window_label.as_deref().unwrap_or("main");
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("window '{label}' not found"))?;
    window
        .set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|e| e.to_string())?;
    window
        .set_size(tauri::PhysicalSize::new(bounds.width, bounds.height))
        .map_err(|e| e.to_string())
}

// ============================================================================
// WSL detection
// ============================================================================

/// Returns `true` when running inside Windows Subsystem for Linux.
///
/// Checks `WSL_DISTRO_NAME` env var first (reliable since WSL 2), then
/// falls back to reading `/proc/version` for WSL 1 hosts.
#[tauri::command]
#[specta::specta]
pub fn is_wsl() -> bool {
    if std::env::var("WSL_DISTRO_NAME").is_ok() {
        return true;
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(content) = std::fs::read_to_string("/proc/version") {
            let lower = content.to_lowercase();
            return lower.contains("microsoft") || lower.contains("wsl");
        }
    }
    false
}
