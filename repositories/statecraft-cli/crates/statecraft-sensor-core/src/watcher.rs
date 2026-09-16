//! The watcher core (spec 112 B-5). The kernel reports coalesced
//! notifications with a path and little else, so the sensor keeps its own
//! state table (size, mtime, inode per path) and diffs against it on each
//! notification to produce created / modified / replaced / deleted with
//! size deltas. The diff is pure over the table; `Watcher` owns the table,
//! the debounce timers and the `notify` subscriptions.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use notify::{EventKind, RecursiveMode, Watcher as _};

use crate::store::{ObservedEvent, RawNote};
use crate::walker::{stat_entry, walk_tree, walk_universe, Entry};
use crate::{Action, ClassInput, Classifier, Universe};

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The state table and the diff over it, independent of any backend.
pub struct StateTable<'a> {
    universe: &'a Universe,
    classifier: &'a dyn Classifier,
    state: BTreeMap<PathBuf, Entry>,
}

impl<'a> StateTable<'a> {
    pub fn new(universe: &'a Universe, classifier: &'a dyn Classifier) -> StateTable<'a> {
        StateTable {
            universe,
            classifier,
            state: BTreeMap::new(),
        }
    }

    /// Seed the table from the universe as it is now.
    pub fn seed(&mut self) -> usize {
        for e in walk_universe(self.universe) {
            self.state.insert(e.path.clone(), e);
        }
        self.state.len()
    }

    pub fn len(&self) -> usize {
        self.state.len()
    }

    pub fn is_empty(&self) -> bool {
        self.state.is_empty()
    }

    pub fn contains(&self, path: &Path) -> bool {
        self.state.contains_key(path)
    }

    /// `flush`: stat the path now, diff against the table, and reconcile a
    /// directory's children. Events come out in the order emitted.
    pub fn observe(
        &mut self,
        path: &Path,
        raw: Vec<RawNote>,
        pending: &dyn Fn(&Path) -> bool,
    ) -> Vec<ObservedEvent> {
        let mut out = Vec::new();
        let prev = self.state.get(path).cloned();
        let cur = stat_entry(path);
        let cur_is_dir = cur.as_ref().is_some_and(|c| c.is_dir());
        self.emit_diff(path, prev, cur, raw, &mut out);
        if cur_is_dir {
            self.reconcile_dir(path, pending, &mut out);
        }
        out
    }

    /// `emitDiff` with an explicit current entry (used by reconciliation).
    fn emit_diff(
        &mut self,
        path: &Path,
        prev: Option<Entry>,
        cur: Option<Entry>,
        raw: Vec<RawNote>,
        out: &mut Vec<ObservedEvent>,
    ) {
        match (prev, cur) {
            (None, None) => {}
            (Some(prev), None) => {
                // Deleted. If it was a dir, everything below it went too.
                let sub = self.forget_subtree(path);
                for e in sub {
                    out.push(self.build(
                        &e.path.clone(),
                        Action::Deleted,
                        Some(&e),
                        None,
                        Vec::new(),
                    ));
                }
                out.push(self.build(path, Action::Deleted, Some(&prev), None, raw));
            }
            (None, Some(cur)) => {
                self.state.insert(path.to_path_buf(), cur.clone());
                out.push(self.build(path, Action::Created, None, Some(&cur), raw));
                if cur.is_dir() {
                    self.adopt_subtree(path, out);
                }
            }
            (Some(prev), Some(cur)) => {
                let inode_changed = prev.inode != cur.inode;
                let size_changed = prev.size != cur.size;
                let mtime_changed = prev.mtime_ms.round() != cur.mtime_ms.round();
                if !inode_changed && !size_changed && !mtime_changed {
                    return; // no visible change
                }
                self.state.insert(path.to_path_buf(), cur.clone());
                let action = if inode_changed {
                    Action::Replaced
                } else {
                    Action::Modified
                };
                out.push(self.build(path, action, Some(&prev), Some(&cur), raw));
            }
        }
    }

    fn adopt_subtree(&mut self, dir: &Path, out: &mut Vec<ObservedEvent>) {
        for e in walk_tree(self.universe, dir, false) {
            if e.path == dir || self.state.contains_key(&e.path) {
                continue;
            }
            self.state.insert(e.path.clone(), e.clone());
            out.push(self.build(&e.path.clone(), Action::Created, None, Some(&e), Vec::new()));
        }
    }

    fn forget_subtree(&mut self, dir: &Path) -> Vec<Entry> {
        let prefix = format!("{}/", dir.to_string_lossy());
        let keys: Vec<PathBuf> = self
            .state
            .keys()
            .filter(|k| k.to_string_lossy().starts_with(&prefix))
            .cloned()
            .collect();
        let mut removed = Vec::new();
        for key in keys {
            if let Some(e) = self.state.remove(&key) {
                removed.push(e);
            }
        }
        self.state.remove(dir);
        removed
    }

    /// Safety net for coalesced events: reconcile a directory's immediate
    /// children against the table, skipping paths with a pending timer.
    fn reconcile_dir(
        &mut self,
        dir: &Path,
        pending: &dyn Fn(&Path) -> bool,
        out: &mut Vec<ObservedEvent>,
    ) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let mut present: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| !self.universe.is_ignored(p))
            .collect();
        present.sort();
        // Known children that vanished.
        let known: Vec<PathBuf> = self
            .state
            .keys()
            .filter(|k| k.parent() == Some(dir))
            .cloned()
            .collect();
        for key in known {
            if !present.contains(&key) && !pending(&key) {
                let prev = self.state.get(&key).cloned();
                self.emit_diff(&key, prev, None, Vec::new(), out);
            }
        }
        // New children not yet seen.
        for p in present {
            if !self.state.contains_key(&p) && !pending(&p) {
                let cur = stat_entry(&p);
                self.emit_diff(&p, None, cur, Vec::new(), out);
            }
        }
    }

    fn build(
        &self,
        path: &Path,
        action: Action,
        prev: Option<&Entry>,
        cur: Option<&Entry>,
        raw: Vec<RawNote>,
    ) -> ObservedEvent {
        let rel_path = self
            .universe
            .rel_state_sibling(path)
            .unwrap_or_else(|| self.universe.rel(path));
        let size_of = |e: Option<&Entry>| -> Option<i64> {
            match e {
                Some(e) if e.kind == "file" => Some(e.size as i64),
                Some(_) => Some(0),
                None => None,
            }
        };
        let size_before = size_of(prev);
        let size_after = size_of(cur);
        let delta = match (size_before, size_after) {
            (Some(b), Some(a)) => Some(a - b),
            _ => match action {
                Action::Created => size_after,
                Action::Deleted => size_before.map(|b| -b),
                _ => None,
            },
        };
        let which = cur.or(prev);
        let entry_kind = which.map(|e| e.kind).unwrap_or("other");
        let class = self.classifier.classify(&ClassInput {
            rel_path: &rel_path,
            action,
            entry_kind,
            delta,
        });
        ObservedEvent {
            ts: now_ms(),
            path: path.to_string_lossy().into_owned(),
            rel_path,
            action: action.as_str(),
            entry_kind: entry_kind.to_string(),
            size_before,
            size_after,
            delta,
            inode: which.map(|e| e.inode as i64),
            kind: class.kind,
            label: class.label,
            raw,
        }
    }
}

/// The live watcher: `notify` subscriptions, a per-path debounce, and the
/// state table. `run` blocks until `stop` fires.
pub struct Watcher {
    pub debounce: Duration,
}

impl Default for Watcher {
    fn default() -> Watcher {
        Watcher {
            debounce: Duration::from_millis(200),
        }
    }
}

fn kind_name(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(_) => "create",
        EventKind::Modify(_) => "modify",
        EventKind::Remove(_) => "remove",
        EventKind::Access(_) => "access",
        EventKind::Any => "any",
        EventKind::Other => "other",
    }
}

impl Watcher {
    /// Seed the table, subscribe, and run the debounce loop until `stop`
    /// receives anything (or the sender is dropped). Every observed event
    /// goes to `sink` in order.
    pub fn run(
        &self,
        universe: &Universe,
        classifier: &dyn Classifier,
        mut sink: impl FnMut(&ObservedEvent),
        started: impl FnOnce(usize),
        stop: mpsc::Receiver<()>,
    ) -> Result<(), notify::Error> {
        let mut table = StateTable::new(universe, classifier);
        let tracked = table.seed();

        let (tx, rx) = mpsc::channel::<(PathBuf, RawNote)>();
        let root = universe.watch_root.clone();
        let state_file = universe.state_file.clone();
        let state_dir = state_file
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("/"));
        let state_name = state_file
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let ignored = universe.clone();
        let state_dir_for_watch = state_dir.clone();
        // The backend may report resolved paths (`/private/var/...` for a
        // `/var/...` root on macOS); map them back onto the universe's own
        // spelling so the state table's keys and the display form agree.
        let canon_root = std::fs::canonicalize(&root).unwrap_or_else(|_| root.clone());
        let canon_state_dir =
            std::fs::canonicalize(&state_dir).unwrap_or_else(|_| state_dir.clone());
        let mut watcher =
            notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
                let Ok(event) = res else { return };
                let ts = now_ms();
                let kind = kind_name(&event.kind).to_string();
                for reported in event.paths {
                    let path = if let Ok(rest) = reported.strip_prefix(&canon_root) {
                        root.join(rest)
                    } else if let Ok(rest) = reported.strip_prefix(&canon_state_dir) {
                        state_dir.join(rest)
                    } else {
                        reported
                    };
                    if path.starts_with(&root) {
                        if ignored.is_ignored(&path) {
                            continue;
                        }
                        let _ = tx.send((
                            path,
                            RawNote {
                                ts,
                                kind: kind.clone(),
                            },
                        ));
                    } else if path.parent() == Some(state_dir.as_path()) {
                        // The state file lives in the home dir: watch it
                        // non-recursively and keep only the file and its temp
                        // siblings, so an atomic rename-replace is visible.
                        let name = path
                            .file_name()
                            .map(|n| n.to_string_lossy().into_owned())
                            .unwrap_or_default();
                        if name.starts_with(&state_name) {
                            let _ = tx.send((
                                path,
                                RawNote {
                                    ts,
                                    kind: kind.clone(),
                                },
                            ));
                        }
                    }
                }
            })?;
        watcher.watch(&universe.watch_root, RecursiveMode::Recursive)?;
        // Spec 115 B-3: a state file inside the root is already covered by
        // the recursive watch; a second watch would report every write twice.
        if !universe.state_inside_root() {
            watcher.watch(&state_dir_for_watch, RecursiveMode::NonRecursive)?;
        }
        started(tracked);

        let mut pending: HashMap<PathBuf, (Instant, Vec<RawNote>)> = HashMap::new();
        loop {
            if stop.try_recv().is_ok() {
                break;
            }
            let wait = pending
                .values()
                .map(|(due, _)| due.saturating_duration_since(Instant::now()))
                .min()
                .unwrap_or(Duration::from_millis(100))
                .min(Duration::from_millis(100));
            match rx.recv_timeout(wait) {
                Ok((path, note)) => {
                    let entry = pending
                        .entry(path)
                        .or_insert_with(|| (Instant::now(), Vec::new()));
                    entry.0 = Instant::now() + self.debounce;
                    entry.1.push(note);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
            let now = Instant::now();
            let due: Vec<PathBuf> = pending
                .iter()
                .filter(|(_, (t, _))| *t <= now)
                .map(|(p, _)| p.clone())
                .collect();
            for path in due {
                let (_, raw) = pending.remove(&path).unwrap_or((now, Vec::new()));
                let still_pending = |p: &Path| pending.contains_key(p);
                for ev in table.observe(&path, raw, &still_pending) {
                    sink(&ev);
                }
            }
            if let Ok(()) = stop.try_recv() {
                break;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Classification, RuleTable};

    fn universe(dir: &Path) -> Universe {
        Universe {
            watch_root: dir.join("root"),
            state_file: dir.join("state.json"),
            state_display: "~/state.json".into(),
            ignored_basenames: vec![".DS_Store".into()],
            ignored_suffixes: vec![],
            never_peek: vec![],
        }
    }

    #[test]
    fn the_table_produces_each_action_with_the_right_delta() {
        let dir = std::env::temp_dir().join(format!("sensor-table-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("root")).unwrap();
        std::fs::write(dir.join("root/a"), b"12345").unwrap();
        let u = universe(&dir);
        let table_rules = RuleTable { rules: vec![] };
        let mut t = StateTable::new(&u, &table_rules);
        assert_eq!(t.seed(), 2);
        let none = |_: &Path| false;

        // modified: same inode, bigger
        std::fs::write(dir.join("root/a"), b"1234567").unwrap();
        let evs = t.observe(&dir.join("root/a"), vec![], &none);
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].action, "modified");
        assert_eq!(evs[0].delta, Some(2));
        assert_eq!(evs[0].rel_path, "a");
        assert_eq!(evs[0].kind, "unclassified");
        assert_eq!(evs[0].label, "UNCLASSIFIED: a modified (file)");

        // created, inside a new directory adopted whole
        std::fs::create_dir_all(dir.join("root/d")).unwrap();
        std::fs::write(dir.join("root/d/b"), b"xyz").unwrap();
        let evs = t.observe(&dir.join("root/d"), vec![], &none);
        let actions: Vec<(&str, String)> =
            evs.iter().map(|e| (e.action, e.rel_path.clone())).collect();
        assert_eq!(
            actions,
            vec![("created", "d".to_string()), ("created", "d/b".to_string())]
        );
        assert_eq!(evs[1].delta, Some(3));

        // replaced: a new inode at the same path. Written beside and renamed
        // over, the way an atomic writer does it; a delete-and-recreate can
        // hand the same inode number back on some filesystems.
        std::fs::write(dir.join("root/a.new"), b"1234567").unwrap();
        std::fs::rename(dir.join("root/a.new"), dir.join("root/a")).unwrap();
        let evs = t.observe(&dir.join("root/a"), vec![], &none);
        assert_eq!(evs[0].action, "replaced");

        // deleted, subtree first
        std::fs::remove_dir_all(dir.join("root/d")).unwrap();
        let evs = t.observe(&dir.join("root/d"), vec![], &none);
        let actions: Vec<(&str, String, Option<i64>)> = evs
            .iter()
            .map(|e| (e.action, e.rel_path.clone(), e.delta))
            .collect();
        assert_eq!(
            actions,
            vec![
                ("deleted", "d/b".to_string(), Some(-3)),
                ("deleted", "d".to_string(), Some(0))
            ]
        );
        assert_eq!(t.len(), 2);

        // the state file's temp sibling keeps the display prefix
        std::fs::write(dir.join("state.json.tmp"), b"{}").unwrap();
        let evs = t.observe(&dir.join("state.json.tmp"), vec![], &none);
        assert_eq!(evs[0].rel_path, "~/state.json.tmp");
        let _ = Classification {
            kind: String::new(),
            label: String::new(),
        };
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Spec 115 B-3 / FR-004: a state file inside the root is watched once.
    #[test]
    fn a_state_file_inside_the_root_yields_one_event_per_write() {
        use std::sync::{Arc, Mutex};
        let dir = std::env::temp_dir().join(format!("sensor-inside-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("root")).unwrap();
        std::fs::write(dir.join("root/state.json"), b"{}").unwrap();
        let u = Universe {
            watch_root: dir.join("root"),
            state_file: dir.join("root/state.json"),
            state_display: "state.json".into(),
            ignored_basenames: vec![],
            ignored_suffixes: vec![],
            never_peek: vec![],
        };
        assert!(u.state_inside_root());
        assert_eq!(u.rel(&u.state_file), "state.json");
        let table = RuleTable { rules: vec![] };
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let (stop_tx, stop_rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let sink_seen = Arc::clone(&seen);
        let handle = std::thread::scope(|scope| {
            let u = &u;
            let table = &table;
            let worker = scope.spawn(move || {
                Watcher::default().run(
                    u,
                    table,
                    |e| sink_seen.lock().unwrap().push(e.rel_path.clone()),
                    |_| {
                        let _ = ready_tx.send(());
                    },
                    stop_rx,
                )
            });
            ready_rx.recv().unwrap();
            std::thread::sleep(Duration::from_millis(300));
            std::fs::write(dir.join("root/state.json"), b"{\"grew\":true}").unwrap();
            std::thread::sleep(Duration::from_millis(1500));
            let _ = stop_tx.send(());
            worker.join().unwrap()
        });
        handle.unwrap();
        let seen = seen.lock().unwrap();
        let state_events = seen.iter().filter(|p| p.as_str() == "state.json").count();
        assert_eq!(state_events, 1, "events: {seen:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
