// Feature: MCP_ROUTER
// Spec: spec/core/router.md

pub mod fs;

use anyhow::Result;
use std::path::{Path, PathBuf};

/// Abstract filesystem trait for deterministic testing
pub trait Fs: Send + Sync {
    fn read_to_string(&self, path: &Path) -> Result<String>;
    fn read_dir(&self, path: &Path) -> Result<Vec<PathBuf>>;
    fn exists(&self, path: &Path) -> bool;
    fn is_dir(&self, path: &Path) -> bool;
    fn canonicalize(&self, path: &Path) -> Result<PathBuf>;
}
