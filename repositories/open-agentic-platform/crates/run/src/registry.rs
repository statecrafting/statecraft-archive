// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: TASK_RUNNER
// Spec: spec/run/skills.md

use crate::config;
use crate::runner::Skill;
use std::path::Path;

/// Returns the skill registry loaded from `axiomregent.tasks.yaml` at `run_root`.
/// Returns an empty registry if the file is absent or fails to parse.
pub fn get_registry(run_root: Option<&Path>) -> Vec<Box<dyn Skill>> {
    let mut skills: Vec<Box<dyn Skill>> = Vec::new();

    if let Some(root) = run_root {
        let yaml_path = root.join("axiomregent.tasks.yaml");
        if yaml_path.exists() {
            match config::load_from_file(&yaml_path, root) {
                Ok(configured) => {
                    skills.extend(configured);
                }
                Err(e) => {
                    eprintln!("Warning: failed to load axiomregent.tasks.yaml: {}", e);
                }
            }
        }
    }

    skills
}
