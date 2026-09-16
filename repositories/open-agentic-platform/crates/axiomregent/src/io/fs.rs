use super::Fs;
use anyhow::Result;
use std::fs;
// Feature: MCP_ROUTER
// Spec: spec/core/router.md

use std::path::{Path, PathBuf};

pub struct RealFs;

impl Fs for RealFs {
    fn read_to_string(&self, path: &Path) -> Result<String> {
        Ok(fs::read_to_string(path)?)
    }

    fn read_dir(&self, path: &Path) -> Result<Vec<PathBuf>> {
        let mut entries = Vec::new();
        if path.exists() && path.is_dir() {
            for entry in fs::read_dir(path)? {
                let entry = entry?;
                entries.push(entry.path());
            }
        }
        // Ensure deterministic order from fs layer if possible, or leave to caller.
        // The trait contract says stable sorted output.
        entries.sort();
        Ok(entries)
    }

    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }

    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }

    fn canonicalize(&self, path: &Path) -> Result<PathBuf> {
        Ok(fs::canonicalize(path)?)
    }
}
