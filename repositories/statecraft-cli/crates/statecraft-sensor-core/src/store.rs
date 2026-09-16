//! The event store: the sqlite schema the TypeScript sensor writes (spec
//! 112 B-3), so a database either implementation wrote is read by the other.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::walker::{walk_universe, Entry};
use crate::{Layout, Universe};

/// One kernel notification, kept beside the event it contributed to.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct RawNote {
    pub ts: i64,
    #[serde(rename = "type")]
    pub kind: String,
}

/// An observed event as the watcher emits it and the store records it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ObservedEvent {
    pub ts: i64,
    pub path: String,
    pub rel_path: String,
    pub action: &'static str,
    pub entry_kind: String,
    pub size_before: Option<i64>,
    pub size_after: Option<i64>,
    pub delta: Option<i64>,
    pub inode: Option<i64>,
    pub kind: String,
    pub label: String,
    pub raw: Vec<RawNote>,
}

/// One row of `events`, as the read verbs see it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EventRow {
    pub id: i64,
    pub ts: i64,
    pub path: String,
    pub action: String,
    pub entry_kind: Option<String>,
    pub kind: String,
    pub label: String,
    pub size_before: Option<i64>,
    pub size_after: Option<i64>,
    pub delta: Option<i64>,
    pub inode: Option<i64>,
    pub raw: Option<String>,
}

impl EventRow {
    pub fn raw_notes(&self) -> Option<Vec<RawNote>> {
        let raw = self.raw.as_deref()?;
        serde_json::from_str(raw).ok()
    }

    pub fn from_event(ev: &ObservedEvent) -> EventRow {
        EventRow {
            id: 0,
            ts: ev.ts,
            path: ev.rel_path.clone(),
            action: ev.action.to_string(),
            entry_kind: Some(ev.entry_kind.clone()),
            kind: ev.kind.clone(),
            label: ev.label.clone(),
            size_before: ev.size_before,
            size_after: ev.size_after,
            delta: ev.delta,
            inode: ev.inode,
            raw: if ev.raw.is_empty() {
                None
            } else {
                Some(serde_json::to_string(&ev.raw).expect("raw notes serialize"))
            },
        }
    }
}

/// One `explain` history row: `(ts, action, label, delta)`.
pub type RecentRow = (i64, String, String, Option<i64>);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnapshotRow {
    pub id: i64,
    pub label: Option<String>,
    pub taken_at: i64,
    pub entry_count: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnapshotEntry {
    pub path: String,
    pub kind: Option<String>,
    pub size: i64,
    pub mtime_ms: i64,
    pub mode: i64,
    pub inode: i64,
}

pub struct Store {
    conn: Connection,
}

const SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      path TEXT NOT NULL,
      action TEXT NOT NULL,
      entry_kind TEXT,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      size_before INTEGER,
      size_after INTEGER,
      delta INTEGER,
      inode INTEGER,
      raw TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
    CREATE INDEX IF NOT EXISTS idx_events_path ON events(path);
    CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT,
      taken_at INTEGER NOT NULL,
      entry_count INTEGER
    );
    CREATE TABLE IF NOT EXISTS snapshot_entries (
      snapshot_id INTEGER NOT NULL,
      path TEXT NOT NULL,
      kind TEXT,
      size INTEGER,
      mtime_ms INTEGER,
      mode INTEGER,
      inode INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_snap_entries ON snapshot_entries(snapshot_id, path);
";

impl Store {
    /// `openDb`: create the data directory, open (or create) the store in
    /// WAL mode, and apply the schema.
    pub fn open(layout: &Layout) -> Result<Store, rusqlite::Error> {
        std::fs::create_dir_all(&layout.data_dir)
            .map_err(|e| rusqlite::Error::InvalidPath(layout.data_dir.join(e.to_string())))?;
        Self::open_at(&layout.db_path)
    }

    pub fn open_at(path: &Path) -> Result<Store, rusqlite::Error> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Store { conn })
    }

    pub fn insert_event(&self, ev: &ObservedEvent) -> Result<(), rusqlite::Error> {
        let raw = if ev.raw.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&ev.raw).expect("raw notes serialize"))
        };
        self.conn.execute(
            "INSERT INTO events (ts, path, action, entry_kind, kind, label, size_before, size_after, delta, inode, raw)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                ev.ts,
                ev.rel_path,
                ev.action,
                ev.entry_kind,
                ev.kind,
                ev.label,
                ev.size_before,
                ev.size_after,
                ev.delta,
                ev.inode,
                raw
            ],
        )?;
        Ok(())
    }

    /// `takeSnapshot`: record the whole universe's metadata under a label.
    pub fn take_snapshot(
        &mut self,
        universe: &Universe,
        label: &str,
        taken_at: i64,
    ) -> Result<(i64, usize), rusqlite::Error> {
        let entries = walk_universe(universe);
        self.record_snapshot(universe, label, taken_at, &entries)
    }

    pub fn record_snapshot(
        &mut self,
        universe: &Universe,
        label: &str,
        taken_at: i64,
        entries: &[Entry],
    ) -> Result<(i64, usize), rusqlite::Error> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO snapshots (label, taken_at, entry_count) VALUES (?1, ?2, ?3)",
            params![label, taken_at, entries.len() as i64],
        )?;
        let id = tx.last_insert_rowid();
        {
            let mut ins = tx.prepare(
                "INSERT INTO snapshot_entries (snapshot_id, path, kind, size, mtime_ms, mode, inode)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )?;
            for e in entries {
                ins.execute(params![
                    id,
                    universe.rel(&e.path),
                    e.kind,
                    e.size as i64,
                    e.mtime_ms.round() as i64,
                    (e.mode & 0o7777) as i64,
                    e.inode as i64
                ])?;
            }
        }
        tx.commit()?;
        Ok((id, entries.len()))
    }

    fn row(r: &rusqlite::Row<'_>) -> Result<EventRow, rusqlite::Error> {
        Ok(EventRow {
            id: r.get("id")?,
            ts: r.get("ts")?,
            path: r.get("path")?,
            action: r.get("action")?,
            entry_kind: r.get("entry_kind")?,
            kind: r.get("kind")?,
            label: r.get("label")?,
            size_before: r.get("size_before")?,
            size_after: r.get("size_after")?,
            delta: r.get("delta")?,
            inode: r.get("inode")?,
            raw: r.get("raw")?,
        })
    }

    /// `log`'s query: newest first, then reversed by the caller.
    pub fn query_events(
        &self,
        conds: &[String],
        params: &[rusqlite::types::Value],
        limit: i64,
    ) -> Result<Vec<EventRow>, rusqlite::Error> {
        let where_ = if conds.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conds.join(" AND "))
        };
        let sql = format!("SELECT * FROM events {where_} ORDER BY ts DESC, id DESC LIMIT ?");
        let mut stmt = self.conn.prepare(&sql)?;
        let mut all: Vec<rusqlite::types::Value> = params.to_vec();
        all.push(rusqlite::types::Value::Integer(limit));
        let rows = stmt.query_map(rusqlite::params_from_iter(all.iter()), Self::row)?;
        rows.collect()
    }

    pub fn range(&self, cutoff: i64) -> Result<(i64, Option<i64>, Option<i64>), rusqlite::Error> {
        self.conn.query_row(
            "SELECT COUNT(*) n, MIN(ts) lo, MAX(ts) hi FROM events WHERE ts >= ?1",
            params![cutoff],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
    }

    /// `(key, count, churn)` groups for `stats`.
    pub fn grouped(
        &self,
        by: &str,
        cutoff: i64,
        order: &str,
        limit: Option<i64>,
    ) -> Result<Vec<(String, i64, i64)>, rusqlite::Error> {
        let limit_sql = limit.map(|l| format!(" LIMIT {l}")).unwrap_or_default();
        let sql = format!(
            "SELECT {by}, COUNT(*) n, SUM(COALESCE(ABS(delta),0)) churn FROM events WHERE ts >= ?1 GROUP BY {by} ORDER BY {order} DESC{limit_sql}"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params![cutoff], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        rows.collect()
    }

    pub fn snapshots(&self) -> Result<Vec<SnapshotRow>, rusqlite::Error> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, label, taken_at, entry_count FROM snapshots ORDER BY id")?;
        let rows = stmt.query_map([], |r| {
            Ok(SnapshotRow {
                id: r.get(0)?,
                label: r.get(1)?,
                taken_at: r.get(2)?,
                entry_count: r.get(3)?,
            })
        })?;
        rows.collect()
    }

    pub fn snapshot_entries(&self, id: i64) -> Result<Vec<SnapshotEntry>, rusqlite::Error> {
        let mut stmt = self.conn.prepare(
            "SELECT path, kind, size, mtime_ms, mode, inode FROM snapshot_entries WHERE snapshot_id = ?1",
        )?;
        let rows = stmt.query_map(params![id], |r| {
            Ok(SnapshotEntry {
                path: r.get(0)?,
                kind: r.get(1)?,
                size: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                mtime_ms: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                mode: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                inode: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
            })
        })?;
        rows.collect()
    }

    /// `explain`'s history over a path and everything beneath it.
    pub fn path_history(
        &self,
        rel_path: &str,
    ) -> Result<(i64, Option<i64>, Option<i64>, i64), rusqlite::Error> {
        let like = format!("{rel_path}/%");
        self.conn.query_row(
            "SELECT COUNT(*) n, MIN(ts) lo, MAX(ts) hi, SUM(COALESCE(ABS(delta),0)) churn
             FROM events WHERE path = ?1 OR path LIKE ?2",
            params![rel_path, like],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                ))
            },
        )
    }

    pub fn path_recent(
        &self,
        rel_path: &str,
        limit: i64,
    ) -> Result<Vec<RecentRow>, rusqlite::Error> {
        let like = format!("{rel_path}/%");
        let mut stmt = self.conn.prepare(
            "SELECT ts, action, label, delta FROM events WHERE path = ?1 OR path LIKE ?2 ORDER BY ts DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![rel_path, like, limit], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })?;
        rows.collect()
    }

    pub fn latest_event(&self) -> Result<Option<EventRow>, rusqlite::Error> {
        self.conn
            .query_row(
                "SELECT * FROM events ORDER BY id DESC LIMIT 1",
                [],
                Self::row,
            )
            .optional()
    }
}

/// `parseSince`: `30s`, `15m`, `2h`, `1d`, `1w` relative to `now_ms`.
pub fn parse_since(s: &str, now_ms: i64) -> Result<i64, String> {
    let (num, unit) = s.split_at(s.len().saturating_sub(1));
    let n: i64 = num
        .parse()
        .map_err(|_| format!("bad --since value: {s} (use e.g. 30s, 15m, 2h, 1d)"))?;
    if num.is_empty() || !num.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!(
            "bad --since value: {s} (use e.g. 30s, 15m, 2h, 1d)"
        ));
    }
    let mult: i64 = match unit {
        "s" => 1_000,
        "m" => 60_000,
        "h" => 3_600_000,
        "d" => 86_400_000,
        "w" => 604_800_000,
        _ => {
            return Err(format!(
                "bad --since value: {s} (use e.g. 30s, 15m, 2h, 1d)"
            ))
        }
    };
    Ok(now_ms - n * mult)
}

/// `globToLike`: `*` to `%`, `?` to `_`, with sqlite's own wildcards escaped.
pub fn glob_to_like(glob: &str) -> String {
    let mut out = String::new();
    let mut chars = glob.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '%' => out.push_str("\\%"),
            '_' => out.push_str("\\_"),
            '*' => {
                while chars.peek() == Some(&'*') {
                    chars.next();
                }
                out.push('%');
            }
            '?' => out.push('_'),
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn since_and_glob_match_the_typescript_helpers() {
        assert_eq!(parse_since("30s", 100_000).unwrap(), 70_000);
        assert_eq!(
            parse_since("2h", 10_000_000).unwrap(),
            10_000_000 - 7_200_000
        );
        assert!(parse_since("2x", 0).is_err());
        assert!(parse_since("h", 0).is_err());
        assert_eq!(glob_to_like("projects/*/**.jsonl"), "projects/%/%.jsonl");
        assert_eq!(glob_to_like("a_b%c?"), "a\\_b\\%c_");
    }

    #[test]
    fn store_round_trips_an_event_and_a_snapshot() {
        let dir = std::env::temp_dir().join(format!("sensor-store-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let layout = Layout::under(dir.clone());
        let mut store = Store::open(&layout).unwrap();
        let ev = ObservedEvent {
            ts: 1_700_000_000_000,
            path: "/r/a".into(),
            rel_path: "a".into(),
            action: "created",
            entry_kind: "file".into(),
            size_before: None,
            size_after: Some(5),
            delta: Some(5),
            inode: Some(7),
            kind: "k".into(),
            label: "l".into(),
            raw: vec![RawNote {
                ts: 1,
                kind: "create".into(),
            }],
        };
        store.insert_event(&ev).unwrap();
        let rows = store.query_events(&[], &[], 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].path, "a");
        assert_eq!(
            rows[0].raw.as_deref(),
            Some(r#"[{"ts":1,"type":"create"}]"#)
        );
        assert_eq!(rows[0].raw_notes().unwrap()[0].kind, "create");
        let universe = Universe {
            watch_root: dir.join("root"),
            state_file: dir.join("state"),
            state_display: "~/state".into(),
            ignored_basenames: vec![],
            ignored_suffixes: vec![],
            never_peek: vec![],
        };
        std::fs::create_dir_all(dir.join("root")).unwrap();
        std::fs::write(dir.join("root/f"), b"12345").unwrap();
        let (id, count) = store.take_snapshot(&universe, "t", 5).unwrap();
        assert_eq!((id, count), (1, 2));
        let entries = store.snapshot_entries(1).unwrap();
        assert_eq!(entries[1].path, "f");
        assert_eq!(entries[1].size, 5);
        assert_eq!(store.snapshots().unwrap()[0].label.as_deref(), Some("t"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
