//! The walker: every entry of the observed universe, metadata only, never
//! content. `lstat`, so a symlink is reported as itself.

use std::fs;
use std::path::{Path, PathBuf};

use crate::Universe;

#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub path: PathBuf,
    /// `file` | `dir` | `symlink` | `other`.
    pub kind: &'static str,
    /// Zero for a directory, as the TypeScript walker reports it.
    pub size: u64,
    pub mtime_ms: f64,
    pub mode: u32,
    pub inode: u64,
}

impl Entry {
    pub fn is_dir(&self) -> bool {
        self.kind == "dir"
    }
}

/// Stat one path; `None` when it vanished between the event and the stat,
/// or is unreadable.
pub fn stat_entry(path: &Path) -> Option<Entry> {
    let st = fs::symlink_metadata(path).ok()?;
    let ft = st.file_type();
    let kind = if ft.is_dir() {
        "dir"
    } else if ft.is_file() {
        "file"
    } else if ft.is_symlink() {
        "symlink"
    } else {
        "other"
    };
    #[cfg(unix)]
    let (mode, inode, mtime_ms) = {
        use std::os::unix::fs::MetadataExt;
        (
            st.mode(),
            st.ino(),
            st.mtime() as f64 * 1000.0 + st.mtime_nsec() as f64 / 1_000_000.0,
        )
    };
    #[cfg(not(unix))]
    let (mode, inode, mtime_ms) = (
        0u32,
        0u64,
        st.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0),
    );
    Some(Entry {
        path: path.to_path_buf(),
        kind,
        size: if ft.is_dir() { 0 } else { st.len() },
        mtime_ms,
        mode,
        inode,
    })
}

/// The tree under `root`, root first, depth first in directory order, with
/// the universe's ignore rule applied unless `include_ignored`.
pub fn walk_tree(universe: &Universe, root: &Path, include_ignored: bool) -> Vec<Entry> {
    let mut out = Vec::new();
    fn walk(universe: &Universe, dir: &Path, include_ignored: bool, out: &mut Vec<Entry>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return; // unreadable dir: record nothing below it
        };
        let mut names: Vec<PathBuf> = entries.filter_map(Result::ok).map(|e| e.path()).collect();
        names.sort();
        for p in names {
            if !include_ignored && universe.is_ignored(&p) {
                continue;
            }
            let Some(e) = stat_entry(&p) else { continue };
            let is_dir = e.is_dir();
            out.push(e);
            if is_dir {
                walk(universe, &p, include_ignored, out);
            }
        }
    }
    if let Some(root_entry) = stat_entry(root) {
        let is_dir = root_entry.is_dir();
        out.push(root_entry);
        if is_dir {
            walk(universe, root, include_ignored, &mut out);
        }
    }
    out
}

/// The full observed universe: the tree plus the sibling state file.
pub fn walk_universe(universe: &Universe) -> Vec<Entry> {
    let mut entries = walk_tree(universe, &universe.watch_root, false);
    if let Some(state) = stat_entry(&universe.state_file) {
        entries.push(state);
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn walks_a_fixture_tree_root_first_and_skips_ignored() {
        let dir = std::env::temp_dir().join(format!("sensor-walk-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("root/a")).unwrap();
        fs::write(dir.join("root/a/f.txt"), b"hello").unwrap();
        fs::write(dir.join("root/.DS_Store"), b"x").unwrap();
        fs::write(dir.join("root/b.swp"), b"x").unwrap();
        fs::write(dir.join("state.json"), b"{}").unwrap();
        let u = Universe {
            watch_root: dir.join("root"),
            state_file: dir.join("state.json"),
            state_display: "~/state.json".into(),
            ignored_basenames: vec![".DS_Store".into()],
            ignored_suffixes: vec![".swp".into()],
            never_peek: vec![],
        };
        let entries = walk_universe(&u);
        let rels: Vec<String> = entries.iter().map(|e| u.rel(&e.path)).collect();
        assert_eq!(rels, vec![".", "a", "a/f.txt", "~/state.json"]);
        assert_eq!(entries[2].size, 5);
        assert_eq!(entries[1].size, 0);
        assert!(entries[2].inode > 0);
        let _ = fs::remove_dir_all(&dir);
    }
}
