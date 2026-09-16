//! The provider-neutral half of a Statecraft sensor (spec 112).
//!
//! A sensor watches an observed root and a sibling state file, turns the
//! kernel's coalesced notifications into created / modified / replaced /
//! deleted events with size deltas by diffing against a state table, gives
//! each event a semantic kind and label through a classification table, and
//! records the result in a sqlite store that six verbs read back. All of
//! that is the same for any provider. What differs is the root, the ignore
//! rule, the display form of paths, and the table, which is a [`Universe`]
//! and a [`Classifier`] supplied by a thin provider crate (spec 112 B-2,
//! doc 02 D26). Nothing in this crate names one.

pub mod daemon;
pub mod findings;
pub mod format;
pub mod redact;
pub mod store;
pub mod verbs;
pub mod walker;
pub mod watcher;

use std::path::{Path, PathBuf};

// --- the observed universe -------------------------------------------------------

/// What a sensor watches: a root tree and a sibling state file, with the
/// ignore rule and the display form the provider chose.
#[derive(Clone, Debug)]
pub struct Universe {
    /// The tree under observation. Read-only: nothing in a sensor writes here.
    pub watch_root: PathBuf,
    /// The primary runtime state file, a sibling of the watch root.
    pub state_file: PathBuf,
    /// The display form of the state file and its temp siblings, as it
    /// appears in event paths (a `~`-prefixed name for a home-directory file).
    pub state_display: String,
    /// Names never reported: the sensor's own noise and editor litter.
    pub ignored_basenames: Vec<String>,
    pub ignored_suffixes: Vec<String>,
    /// Root-relative paths `peek` refuses to open (spec 115 B-4): secrets a
    /// redactor must not be trusted to mask. Empty for a tree with none.
    pub never_peek: Vec<String>,
}

impl Universe {
    pub fn is_ignored(&self, path: &Path) -> bool {
        let base = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if self.ignored_basenames.iter().any(|b| b == base) {
            return true;
        }
        self.ignored_suffixes.iter().any(|s| base.ends_with(s))
    }

    /// Display helper: root-relative where possible, the state display form
    /// for the state file, `.` for the root, the absolute path otherwise.
    pub fn rel(&self, path: &Path) -> String {
        if path == self.state_file {
            return self.state_display.clone();
        }
        if let Ok(stripped) = path.strip_prefix(&self.watch_root) {
            if stripped.as_os_str().is_empty() {
                return ".".to_string();
            }
            return stripped.to_string_lossy().into_owned();
        }
        path.to_string_lossy().into_owned()
    }

    /// Whether the state file sits inside the watched root (spec 115 B-3),
    /// in which case the recursive watch already covers it.
    pub fn state_inside_root(&self) -> bool {
        self.state_file.starts_with(&self.watch_root)
    }

    /// Whether `peek` must refuse this path (spec 115 B-4).
    pub fn is_never_peek(&self, rel_path: &str) -> bool {
        self.never_peek.iter().any(|p| p == rel_path)
    }

    /// The state file's temp siblings share its display prefix.
    pub fn rel_state_sibling(&self, path: &Path) -> Option<String> {
        let parent = self.state_file.parent()?;
        let name = path.file_name()?.to_str()?;
        let state_name = self.state_file.file_name()?.to_str()?;
        if path.parent()? == parent && name.starts_with(state_name) {
            return Some(format!(
                "{}{}",
                self.state_display,
                &name[state_name.len()..]
            ));
        }
        None
    }
}

// --- classification -----------------------------------------------------------------

/// An observed change, as the classifier sees it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Created,
    Modified,
    Replaced,
    Deleted,
}

impl Action {
    pub fn as_str(self) -> &'static str {
        match self {
            Action::Created => "created",
            Action::Modified => "modified",
            Action::Replaced => "replaced",
            Action::Deleted => "deleted",
        }
    }
}

#[derive(Clone, Debug)]
pub struct ClassInput<'a> {
    /// Relative to the root, or the state file's display form.
    pub rel_path: &'a str,
    pub action: Action,
    /// `file` | `dir` | `symlink` | `other`.
    pub entry_kind: &'a str,
    /// Size change in bytes, when known.
    pub delta: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Classification {
    /// A stable category for querying.
    pub kind: String,
    /// A human-readable one-liner.
    pub label: String,
}

/// The provider's table: a path in, a kind and a label out. An unmatched
/// path is a discovery, not an error, and the provider says so loudly.
pub trait Classifier: Send + Sync {
    fn classify(&self, input: &ClassInput<'_>) -> Classification;
}

/// One rule of a table: a pattern over the relative path and a label
/// builder over the captures and the input.
pub struct Rule {
    pub kind: &'static str,
    pub re: regex::Regex,
    pub label: fn(&regex::Captures<'_>, &ClassInput<'_>) -> String,
}

/// A classifier over an ordered rule table, first match wins; the fallback
/// is the `unclassified` discovery message every sensor shares.
pub struct RuleTable {
    pub rules: Vec<Rule>,
}

impl Classifier for RuleTable {
    fn classify(&self, input: &ClassInput<'_>) -> Classification {
        for rule in &self.rules {
            if let Some(caps) = rule.re.captures(input.rel_path) {
                return Classification {
                    kind: rule.kind.to_string(),
                    label: (rule.label)(&caps, input),
                };
            }
        }
        Classification {
            kind: "unclassified".to_string(),
            label: format!(
                "UNCLASSIFIED: {} {} ({})",
                input.rel_path,
                input.action.as_str(),
                input.entry_kind
            ),
        }
    }
}

/// `grewOrShrank`: the verb a size delta earns in a label.
pub fn grew_or_shrank(input: &ClassInput<'_>) -> &'static str {
    match input.delta {
        None | Some(0) => input.action.as_str(),
        Some(d) if d > 0 => "grew",
        Some(_) => "SHRANK",
    }
}

// --- the data directory (B-3, D-2) ------------------------------------------------

/// Where a sensor keeps its store, log and pid file.
pub const DATA_DIR_ENV: &str = "STATECRAFT_SENSOR_DATA_DIR";

/// `STATECRAFT_SENSOR_DATA_DIR`, else `$XDG_DATA_HOME/statecraft/<sensor>`,
/// else the platform data directory under `statecraft/<sensor>`.
pub fn data_dir(sensor: &str) -> PathBuf {
    if let Some(dir) = std::env::var_os(DATA_DIR_ENV).filter(|v| !v.is_empty()) {
        return PathBuf::from(dir);
    }
    if let Some(xdg) = std::env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty()) {
        return PathBuf::from(xdg).join("statecraft").join(sensor);
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    if cfg!(target_os = "macos") {
        home.join("Library")
            .join("Application Support")
            .join("statecraft")
            .join(sensor)
    } else {
        home.join(".local")
            .join("share")
            .join("statecraft")
            .join(sensor)
    }
}

/// The store, log and pid paths under a data directory.
#[derive(Clone, Debug)]
pub struct Layout {
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    pub daemon_log: PathBuf,
    pub daemon_pid: PathBuf,
}

impl Layout {
    pub fn under(data_dir: PathBuf) -> Layout {
        Layout {
            db_path: data_dir.join("observatory.db"),
            daemon_log: data_dir.join("daemon.log"),
            daemon_pid: data_dir.join("daemon.pid"),
            data_dir,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn universe() -> Universe {
        Universe {
            watch_root: PathBuf::from("/home/u/.root"),
            state_file: PathBuf::from("/home/u/.root.json"),
            state_display: "~/.root.json".to_string(),
            ignored_basenames: vec![".DS_Store".to_string()],
            ignored_suffixes: vec![".swp".to_string(), "~".to_string()],
            never_peek: vec![],
        }
    }

    #[test]
    fn rel_and_ignore() {
        let u = universe();
        assert_eq!(u.rel(Path::new("/home/u/.root/projects/x")), "projects/x");
        assert_eq!(u.rel(Path::new("/home/u/.root")), ".");
        assert_eq!(u.rel(Path::new("/home/u/.root.json")), "~/.root.json");
        assert_eq!(u.rel(Path::new("/elsewhere")), "/elsewhere");
        assert!(u.is_ignored(Path::new("/home/u/.root/.DS_Store")));
        assert!(u.is_ignored(Path::new("/home/u/.root/a.swp")));
        assert!(!u.is_ignored(Path::new("/home/u/.root/a.json")));
        assert_eq!(
            u.rel_state_sibling(Path::new("/home/u/.root.json.tmp"))
                .as_deref(),
            Some("~/.root.json.tmp")
        );
    }

    #[test]
    fn the_core_names_no_provider() {
        // FR-005: this crate is provider-neutral by construction. The check
        // reads its own sources, so a stray name fails here, not in review.
        // The word is assembled at runtime so this file does not contain it.
        let words = [["cl", "aude"].concat(), ["co", "dex"].concat()];
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        for entry in std::fs::read_dir(&src).unwrap() {
            let path = entry.unwrap().path();
            let text = std::fs::read_to_string(&path).unwrap().to_lowercase();
            for word in &words {
                assert_eq!(
                    text.matches(word.as_str()).count(),
                    0,
                    "{} names a provider",
                    path.display()
                );
            }
        }
    }
}
