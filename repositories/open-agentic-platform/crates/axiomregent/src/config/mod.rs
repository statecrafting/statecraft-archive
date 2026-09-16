// Feature: MCP_ROUTER
// Spec: spec/core/router.md

// Config helpers
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BlobBackend {
    Fs,
    Db,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Compression {
    None,
    Zstd,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    pub data_dir: PathBuf,
    pub blob_backend: BlobBackend,
    pub compression: Compression,
}

impl Default for StorageConfig {
    fn default() -> Self {
        // Prefer explicit override for tests/CI and power users.
        if let Ok(val) = std::env::var("AXIOMREGENT_DATA_DIR") {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                return Self {
                    data_dir: PathBuf::from(trimmed),
                    blob_backend: BlobBackend::Fs,
                    compression: Compression::None,
                };
            }
        }

        // Default to project-local storage: <cwd>/.axiomregent/data
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let data_dir = cwd.join(".axiomregent").join("data");

        Self {
            data_dir,
            blob_backend: BlobBackend::Fs,
            compression: Compression::None, // Default to None for simplicity initially
        }
    }
}
