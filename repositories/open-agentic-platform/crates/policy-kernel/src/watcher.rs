// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Settings file watcher (spec 068, FR-006).
//!
//! Watches all file-based settings tiers for changes and triggers a re-merge
//! within 2 seconds. Uses the `notify` crate for cross-platform fs events.

use std::sync::{Arc, RwLock};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

use crate::merge::{SettingsPaths, merge_settings};
use crate::settings::MergedSettings;

/// Watches settings files and hot-reloads merged settings (FR-006).
pub struct SettingsWatcher {
    paths: SettingsPaths,
    settings: Arc<RwLock<MergedSettings>>,
}

impl SettingsWatcher {
    /// Create a watcher that will update the given settings handle on changes.
    pub fn new(paths: SettingsPaths, settings: Arc<RwLock<MergedSettings>>) -> Self {
        Self { paths, settings }
    }

    /// Start the filesystem watcher in a background thread.
    ///
    /// Returns the join handle. The watcher runs until the thread is dropped
    /// or the process exits.
    pub fn start(self) -> JoinHandle<()> {
        thread::spawn(move || {
            self.watch_loop();
        })
    }

    fn watch_loop(&self) {
        let settings = Arc::clone(&self.settings);
        let paths_for_merge = self.paths.clone();

        let (tx, rx) = std::sync::mpsc::channel();

        let mut watcher: RecommendedWatcher =
            match notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
                if let Ok(event) = res {
                    if event.kind.is_modify() || event.kind.is_create() {
                        let _ = tx.send(());
                    }
                }
            }) {
                Ok(w) => w,
                Err(e) => {
                    eprintln!("[permission-runtime] failed to create watcher: {e}");
                    return;
                }
            };

        // Watch each settings file's parent directory.
        for path in self.paths.watch_paths() {
            if let Some(parent) = path.parent() {
                if parent.exists() {
                    let _ = watcher.watch(parent, RecursiveMode::NonRecursive);
                }
            }
        }

        // Debounce: wait up to 500ms after last event before re-merging.
        while let Ok(()) = rx.recv() {
            // Drain any queued events within the debounce window.
            while rx.recv_timeout(Duration::from_millis(500)).is_ok() {}

            let new_settings = merge_settings(&paths_for_merge);
            if let Ok(mut guard) = settings.write() {
                *guard = new_settings;
            }
        }

        // Keep watcher alive for the duration of the loop.
        drop(watcher);
    }
}
