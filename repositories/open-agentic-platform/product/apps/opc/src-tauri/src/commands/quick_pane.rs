//! Quick pane window management.
//!
//! The quick pane is a small floating input panel (NSPanel on macOS, always-on-top
//! frameless window elsewhere) accessible via a configurable global shortcut.
//! It starts hidden and is summoned/dismissed by the shortcut or via commands.

use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl};

pub use crate::types::DEFAULT_QUICK_PANE_SHORTCUT;

const QUICK_PANE_LABEL: &str = "quick-pane";
const QUICK_PANE_WIDTH: f64 = 600.0;
const QUICK_PANE_HEIGHT: f64 = 80.0;

/// Tracks the currently registered shortcut string for selective unregistration.
static CURRENT_QUICK_PANE_SHORTCUT: Mutex<Option<String>> = Mutex::new(None);

// ============================================================================
// macOS NSPanel support
// ============================================================================

#[cfg(target_os = "macos")]
use tauri_nspanel::{
    CollectionBehavior, ManagerExt, PanelBuilder, PanelLevel, StyleMask, tauri_panel,
};

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(QuickPanePanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true
        }
    })
}

// ============================================================================
// Initialization
// ============================================================================

/// Creates the quick pane window at app startup (hidden).
/// Must be called from the main thread inside `setup()`.
pub fn init_quick_pane(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        init_quick_pane_macos(app)
    }
    #[cfg(not(target_os = "macos"))]
    {
        init_quick_pane_standard(app)
    }
}

#[cfg(target_os = "macos")]
fn init_quick_pane_macos(app: &AppHandle) -> Result<(), String> {
    use tauri::{LogicalSize, Size};

    let panel = PanelBuilder::<_, QuickPanePanel>::new(app, QUICK_PANE_LABEL)
        .url(WebviewUrl::App("quick-pane.html".into()))
        .title("Quick Entry")
        .size(Size::Logical(LogicalSize::new(
            QUICK_PANE_WIDTH,
            QUICK_PANE_HEIGHT,
        )))
        .level(PanelLevel::Status)
        .transparent(true)
        .has_shadow(true)
        .collection_behavior(
            CollectionBehavior::new()
                .full_screen_auxiliary()
                .can_join_all_spaces(),
        )
        .style_mask(StyleMask::empty().nonactivating_panel())
        .hides_on_deactivate(false)
        .works_when_modal(true)
        .with_window(|w| {
            w.decorations(false)
                .transparent(true)
                .skip_taskbar(true)
                .resizable(false)
                .center()
        })
        .build()
        .map_err(|e| format!("Failed to create quick pane NSPanel: {e}"))?;

    panel.hide();
    log::info!("Quick pane NSPanel created (hidden)");
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn init_quick_pane_standard(app: &AppHandle) -> Result<(), String> {
    use tauri::webview::WebviewWindowBuilder;

    WebviewWindowBuilder::new(
        app,
        QUICK_PANE_LABEL,
        WebviewUrl::App("quick-pane.html".into()),
    )
    .title("Quick Entry")
    .inner_size(QUICK_PANE_WIDTH, QUICK_PANE_HEIGHT)
    .always_on_top(true)
    .skip_taskbar(true)
    .decorations(false)
    .transparent(true)
    .visible(false)
    .resizable(false)
    .center()
    .build()
    .map_err(|e| format!("Failed to create quick pane window: {e}"))?;

    log::info!("Quick pane window created (hidden)");
    Ok(())
}

// ============================================================================
// Positioning — center on the monitor where the cursor currently is
// ============================================================================

fn get_centered_position_on_cursor_monitor(
    app: &AppHandle,
) -> Option<tauri::PhysicalPosition<i32>> {
    let cursor_pos = app.cursor_position().ok()?;

    let monitor = match app.monitor_from_point(cursor_pos.x, cursor_pos.y) {
        Ok(Some(m)) => m,
        _ => app.primary_monitor().ok().flatten()?,
    };

    let pos = monitor.position();
    let size = monitor.size();
    let scale = monitor.scale_factor();

    let scaled_w = (QUICK_PANE_WIDTH * scale) as i32;
    let scaled_h = (QUICK_PANE_HEIGHT * scale) as i32;

    Some(tauri::PhysicalPosition::new(
        pos.x + (size.width as i32 - scaled_w) / 2,
        pos.y + (size.height as i32 - scaled_h) / 2,
    ))
}

fn position_on_cursor_monitor(app: &AppHandle) {
    if let Some(position) = get_centered_position_on_cursor_monitor(app)
        && let Some(window) = app.get_webview_window(QUICK_PANE_LABEL)
    {
        let _ = window.set_position(position);
    }
}

// ============================================================================
// Visibility helpers
// ============================================================================

fn is_visible(app: &AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    {
        app.get_webview_panel(QUICK_PANE_LABEL)
            .map(|p| p.is_visible())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        app.get_webview_window(QUICK_PANE_LABEL)
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false)
    }
}

// ============================================================================
// Public commands
// ============================================================================

/// Shows the quick pane, positioning it on the monitor that contains the cursor.
#[tauri::command]
#[specta::specta]
pub fn show_quick_pane(app: AppHandle) -> Result<(), String> {
    position_on_cursor_monitor(&app);

    #[cfg(target_os = "macos")]
    {
        let panel = app
            .get_webview_panel(QUICK_PANE_LABEL)
            .map_err(|e| format!("Quick pane panel not found: {e:?}"))?;
        panel.show_and_make_key();
    }

    #[cfg(not(target_os = "macos"))]
    {
        let window = app.get_webview_window(QUICK_PANE_LABEL).ok_or_else(|| {
            "Quick pane window not found — was init_quick_pane called at startup?".to_string()
        })?;
        window
            .show()
            .map_err(|e| format!("Failed to show window: {e}"))?;
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus window: {e}"))?;
    }

    Ok(())
}

/// Dismisses the quick pane.
/// On macOS, resigns key window status before hiding to avoid activating the main window.
#[tauri::command]
#[specta::specta]
pub fn dismiss_quick_pane(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(panel) = app.get_webview_panel(QUICK_PANE_LABEL) {
            if !panel.is_visible() {
                return Ok(());
            }
            panel.resign_key_window();
            panel.hide();
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window(QUICK_PANE_LABEL) {
            if !window.is_visible().unwrap_or(false) {
                return Ok(());
            }
            window
                .hide()
                .map_err(|e| format!("Failed to hide window: {e}"))?;
        }
    }

    Ok(())
}

/// Toggles the quick pane visibility.
#[tauri::command]
#[specta::specta]
pub fn toggle_quick_pane(app: AppHandle) -> Result<(), String> {
    if is_visible(&app) {
        dismiss_quick_pane(app)
    } else {
        show_quick_pane(app)
    }
}

/// Returns the compiled-in default shortcut string.
#[tauri::command]
#[specta::specta]
pub fn get_default_quick_pane_shortcut() -> String {
    DEFAULT_QUICK_PANE_SHORTCUT.to_string()
}

/// Enables or disables the quick pane by registering/unregistering its global shortcut.
#[tauri::command]
#[specta::specta]
pub fn set_quick_pane_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(desktop)]
    {
        if enabled {
            register_quick_pane_shortcut(&app, DEFAULT_QUICK_PANE_SHORTCUT)?;
        } else {
            if is_visible(&app) {
                let _ = dismiss_quick_pane(app.clone());
            }
            #[allow(unused_imports)]
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            let mut current = CURRENT_QUICK_PANE_SHORTCUT
                .lock()
                .map_err(|e| format!("Failed to lock shortcut mutex: {e}"))?;
            if let Some(shortcut_str) = current.take() {
                use tauri_plugin_global_shortcut::Shortcut;
                if let Ok(shortcut) = shortcut_str.parse::<Shortcut>() {
                    let _ = app.global_shortcut().unregister(shortcut);
                }
            }
        }
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, enabled);
    }
    Ok(())
}

/// Updates the global shortcut used to summon the quick pane.
/// Pass `None` to reset to the default shortcut.
#[tauri::command]
#[specta::specta]
pub fn update_quick_pane_shortcut(app: AppHandle, shortcut: Option<String>) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let new_shortcut = shortcut.as_deref().unwrap_or(DEFAULT_QUICK_PANE_SHORTCUT);
        register_quick_pane_shortcut(&app, new_shortcut)?;
        log::info!("Quick pane shortcut updated to: {new_shortcut}");
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, shortcut);
    }
    Ok(())
}

// ============================================================================
// Shortcut registration (pub so lib.rs setup() can call it)
// ============================================================================

/// Registers the quick pane global shortcut, unregistering any previously registered one.
#[cfg(desktop)]
pub fn register_quick_pane_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    let global_shortcut = app.global_shortcut();

    let mut current = CURRENT_QUICK_PANE_SHORTCUT
        .lock()
        .map_err(|e| format!("Failed to lock shortcut mutex: {e}"))?;

    // Unregister the old shortcut first
    if let Some(old_str) = current.take()
        && let Ok(old) = old_str.parse::<Shortcut>()
    {
        let _ = global_shortcut.unregister(old);
    }

    let app_handle = app.clone();
    global_shortcut
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            use tauri_plugin_global_shortcut::ShortcutState;
            if event.state == ShortcutState::Pressed
                && let Err(e) = toggle_quick_pane(app_handle.clone())
            {
                log::error!("Failed to toggle quick pane: {e}");
            }
        })
        .map_err(|e| format!("Failed to register shortcut '{shortcut}': {e}"))?;

    *current = Some(shortcut.to_string());
    log::info!("Registered quick pane shortcut: {shortcut}");
    Ok(())
}
