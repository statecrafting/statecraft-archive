//! Shared utility functions.

use std::path::Path;

/// Writes `content` to `path` atomically by writing to a `.tmp` file first,
/// then renaming it into place. This prevents file corruption if the process
/// crashes mid-write.
///
/// The temporary file is written in the same directory as `path` so that
/// the rename is a same-filesystem operation (guaranteed atomic on POSIX;
/// best-effort on Windows).
pub fn write_atomic(path: &Path, content: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, content)?;
    std::fs::rename(&tmp, path)
}

/// Async version of `write_atomic` for use in async command handlers.
pub async fn write_atomic_async(path: &Path, content: Vec<u8>) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    tokio::fs::write(&tmp, &content).await?;
    tokio::fs::rename(&tmp, path).await
}
