// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: MCP_ROUTER
// Spec: spec/core/router.md

use std::path::{Component, Path, PathBuf};

pub fn normalize_path(path: &Path) -> String {
    let mut s = path.to_string_lossy().replace("\\", "/");
    if s.len() > 1 && s.ends_with('/') {
        s.pop();
    }
    s
}

pub fn path_depth(path: &Path) -> usize {
    path.components()
        .filter(|c| matches!(c, Component::Normal(_)))
        .count()
}

pub fn discover_workspace_root(start: &Path) -> PathBuf {
    let mut cur = Some(start);

    while let Some(p) = cur {
        if p.join(".axiomregent").is_dir() {
            return p.to_path_buf();
        }
        if p.join(".git").is_dir() {
            return p.to_path_buf();
        }
        cur = p.parent();
    }

    start.to_path_buf()
}
