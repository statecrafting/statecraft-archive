//! The sensor's verbs over a [`Universe`] and a [`Classifier`] (spec 112
//! B-4): byte for byte what the TypeScript sensor printed, over the same
//! store. Each returns the process exit code; usage errors are 1, as the
//! TypeScript dispatcher has always answered them (042's sensor taxonomy).

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc;

use crate::findings::{best_match, lead, load_sections};
use crate::format::{fmt_bytes, fmt_day, fmt_time, format_event, to_locale_string, use_color};
use crate::store::{glob_to_like, parse_since, EventRow, Store};
use crate::watcher::{now_ms, Watcher};
use crate::{daemon, redact, Classifier, Layout, Universe};

/// Everything a verb needs from the provider crate.
pub struct Sensor<'a> {
    pub universe: &'a Universe,
    pub classifier: &'a dyn Classifier,
    pub layout: &'a Layout,
    /// The FINDINGS document, when the provider ships one.
    pub findings: Option<PathBuf>,
    /// The usage text the provider's binary prints for an unknown verb.
    pub usage: &'a str,
    /// The provider's name for start lines and the plist label.
    pub display_name: &'a str,
    /// The launchd label `daemon plist` prints.
    pub plist_label: &'a str,
}

fn opt<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    let i = args.iter().position(|a| a == name)?;
    args.get(i + 1).map(String::as_str)
}

fn has(args: &[String], flag: &str) -> bool {
    args.iter().any(|a| a == flag)
}

fn out(line: &str) {
    let mut stdout = std::io::stdout().lock();
    let _ = writeln!(stdout, "{line}");
}

fn err(line: &str) {
    eprintln!("{line}");
}

/// The dispatcher over the eight verbs. Unknown or missing verbs print the
/// usage on stdout and exit 1 (or 0 when no verb was given), as `index.ts`
/// does.
pub fn dispatch(sensor: &Sensor<'_>, argv: &[String]) -> i32 {
    let Some(verb) = argv.first() else {
        out(sensor.usage);
        return 0;
    };
    let args = &argv[1..];
    let result = match verb.as_str() {
        "watch" => watch(sensor, args),
        "log" => log(sensor, args),
        "stats" => stats(sensor, args),
        "snapshot" => snapshot(sensor, args),
        "diff" => diff(sensor, args),
        "explain" => explain(sensor, args),
        "peek" => peek(sensor, args),
        "daemon" => daemon_verb(sensor, args),
        _ => {
            out(sensor.usage);
            return 1;
        }
    };
    match result {
        Ok(code) => code,
        Err(message) => {
            err(&message);
            1
        }
    }
}

type VerbResult = Result<i32, String>;

fn open(sensor: &Sensor<'_>) -> Result<Store, String> {
    Store::open(sensor.layout).map_err(|e| format!("cannot open the event store: {e}"))
}

// --- watch ------------------------------------------------------------------------

fn watch(sensor: &Sensor<'_>, args: &[String]) -> VerbResult {
    let raw = has(args, "--raw");
    let no_db = has(args, "--no-db");
    let quiet = has(args, "--quiet");
    let store = if no_db { None } else { Some(open(sensor)?) };
    let color = use_color();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    install_stop_handler(stop_tx);
    let watcher = Watcher::default();
    let store_ref = store.as_ref();
    watcher
        .run(
            sensor.universe,
            sensor.classifier,
            |ev| {
                if !quiet {
                    out(&format_event(&EventRow::from_event(ev), raw, color));
                }
                if let Some(store) = store_ref {
                    if let Err(e) = store.insert_event(ev) {
                        err(&format!("store: {e}"));
                    }
                }
            },
            |tracked| {
                out(&format!(
                    "{}: watching {} and {} ({tracked} entries tracked, db={}, raw={raw})",
                    sensor.display_name,
                    sensor.universe.watch_root.display(),
                    sensor.universe.state_file.display(),
                    if no_db { "off" } else { "on" }
                ));
            },
            stop_rx,
        )
        .map_err(|e| format!("watch: {e}"))?;
    out(&format!("{}: stopped", sensor.display_name));
    Ok(0)
}

#[cfg(unix)]
fn install_stop_handler(tx: mpsc::Sender<()>) {
    use std::sync::Mutex;
    use std::sync::OnceLock;
    static STOP: OnceLock<Mutex<Option<mpsc::Sender<()>>>> = OnceLock::new();
    let _ = STOP.set(Mutex::new(Some(tx)));
    extern "C" fn on_signal(_: libc::c_int) {
        if let Some(lock) = STOP.get() {
            if let Ok(mut guard) = lock.try_lock() {
                if let Some(tx) = guard.take() {
                    let _ = tx.send(());
                }
            }
        }
    }
    // SAFETY: installing a handler that only sends on a channel.
    unsafe {
        libc::signal(libc::SIGINT, on_signal as *const () as libc::sighandler_t);
        libc::signal(libc::SIGTERM, on_signal as *const () as libc::sighandler_t);
    }
}

#[cfg(not(unix))]
fn install_stop_handler(_tx: mpsc::Sender<()>) {}

// --- log ---------------------------------------------------------------------------

fn fmt_row(r: &EventRow, show_raw: bool) -> String {
    let delta = if r.delta.is_some() && r.action != "created" && r.action != "deleted" {
        fmt_bytes(r.delta)
    } else {
        String::new()
    };
    let mut line = format!(
        "{} {}  {:>8}  {:<16}  {}  [{}]",
        fmt_day(r.ts),
        fmt_time(r.ts),
        delta,
        r.kind,
        r.label,
        r.path
    );
    if show_raw {
        if let Some(raw) = &r.raw {
            line.push_str(&format!("\n    raw: {raw}"));
        }
    }
    line
}

fn log(sensor: &Sensor<'_>, args: &[String]) -> VerbResult {
    let store = open(sensor)?;
    let mut conds: Vec<String> = Vec::new();
    let mut params: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(since) = opt(args, "--since") {
        conds.push("ts >= ?".to_string());
        params.push(rusqlite::types::Value::Integer(parse_since(
            since,
            now_ms(),
        )?));
    }
    if let Some(glob) = opt(args, "--path") {
        conds.push("path LIKE ? ESCAPE '\\'".to_string());
        params.push(rusqlite::types::Value::Text(glob_to_like(glob)));
    }
    if let Some(kind) = opt(args, "--kind") {
        conds.push("kind = ?".to_string());
        params.push(rusqlite::types::Value::Text(kind.to_string()));
    }
    if let Some(action) = opt(args, "--action") {
        conds.push("action = ?".to_string());
        params.push(rusqlite::types::Value::Text(action.to_string()));
    }
    let limit: i64 = opt(args, "--limit")
        .map(|l| l.parse().unwrap_or(0))
        .unwrap_or(200);
    let mut rows = store
        .query_events(&conds, &params, limit)
        .map_err(|e| e.to_string())?;
    rows.reverse();
    let show_raw = has(args, "--raw");
    for r in &rows {
        out(&fmt_row(r, show_raw));
    }
    out(&format!(
        "({} events{})",
        rows.len(),
        if rows.len() as i64 == limit {
            ", limit reached"
        } else {
            ""
        }
    ));
    Ok(0)
}

// --- stats --------------------------------------------------------------------------

fn stats(sensor: &Sensor<'_>, args: &[String]) -> VerbResult {
    let store = open(sensor)?;
    let since = opt(args, "--since");
    let cutoff = match since {
        Some(s) => parse_since(s, now_ms())?,
        None => 0,
    };
    let (n, lo, hi) = store.range(cutoff).map_err(|e| e.to_string())?;
    if n == 0 {
        out(&format!(
            "no events recorded{}",
            since
                .map(|s| format!(" in the last {s}"))
                .unwrap_or_default()
        ));
        return Ok(0);
    }
    out(&format!(
        "{n} events between {} and {}\n",
        to_locale_string(lo.unwrap_or(0)),
        to_locale_string(hi.unwrap_or(0))
    ));
    out("by kind:");
    for (kind, count, churn) in store
        .grouped("kind", cutoff, "n", None)
        .map_err(|e| e.to_string())?
    {
        out(&format!(
            "  {:<18} {:>6} events  {:>10} churn",
            kind,
            count,
            fmt_bytes(Some(churn))
        ));
    }
    out("\nhottest paths (by event count):");
    for (path, count, churn) in store
        .grouped("path", cutoff, "n", Some(15))
        .map_err(|e| e.to_string())?
    {
        out(&format!(
            "  {:>5}x  {:>10}  {}",
            count,
            fmt_bytes(Some(churn)),
            path
        ));
    }
    out("\nbiggest churn (by |bytes|):");
    for (path, count, churn) in store
        .grouped("path", cutoff, "churn", Some(10))
        .map_err(|e| e.to_string())?
    {
        out(&format!(
            "  {:>10}  {:>5}x  {}",
            fmt_bytes(Some(churn)),
            count,
            path
        ));
    }
    Ok(0)
}

// --- snapshot, diff ---------------------------------------------------------------------

fn snapshot(sensor: &Sensor<'_>, args: &[String]) -> VerbResult {
    let mut store = open(sensor)?;
    if has(args, "--list") {
        for r in store.snapshots().map_err(|e| e.to_string())? {
            out(&format!(
                "  #{}  {}  {} entries  {}",
                r.id,
                to_locale_string(r.taken_at),
                r.entry_count.unwrap_or(0),
                r.label.as_deref().unwrap_or("")
            ));
        }
        return Ok(0);
    }
    let label = opt(args, "--label").unwrap_or("manual");
    let (id, count) = store
        .take_snapshot(sensor.universe, label, now_ms())
        .map_err(|e| e.to_string())?;
    out(&format!(
        "snapshot #{id} taken ({count} entries, label: {label})"
    ));
    Ok(0)
}

fn diff(sensor: &Sensor<'_>, args: &[String]) -> VerbResult {
    let ids: Vec<i64> = args
        .iter()
        .filter(|a| !a.is_empty() && a.bytes().all(|b| b.is_ascii_digit()))
        .filter_map(|a| a.parse().ok())
        .collect();
    let (Some(&a), Some(&b)) = (ids.first(), ids.get(1)) else {
        err("usage: observatory diff <snapshotIdA> <snapshotIdB>  (see: snapshot --list)");
        return Ok(1);
    };
    if a == 0 || b == 0 {
        err("usage: observatory diff <snapshotIdA> <snapshotIdB>  (see: snapshot --list)");
        return Ok(1);
    }
    let store = open(sensor)?;
    let load = |id: i64| -> Result<
        std::collections::BTreeMap<String, crate::store::SnapshotEntry>,
        String,
    > {
        let rows = store.snapshot_entries(id).map_err(|e| e.to_string())?;
        if rows.is_empty() {
            return Err(format!("snapshot #{id} is empty or missing"));
        }
        Ok(rows.into_iter().map(|r| (r.path.clone(), r)).collect())
    };
    let map_a = load(a)?;
    let map_b = load(b)?;
    // The TypeScript maps iterate in insertion (row) order; the rows come
    // back in rowid order, which the BTreeMap here does not keep. Re-read the
    // ordered lists for the walk so the output order matches.
    let ordered_b = store.snapshot_entries(b).map_err(|e| e.to_string())?;
    let ordered_a = store.snapshot_entries(a).map_err(|e| e.to_string())?;
    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut changed = Vec::new();
    for eb in &ordered_b {
        match map_a.get(&eb.path) {
            None => added.push(format!("  + {} ({})", eb.path, fmt_bytes(Some(eb.size)))),
            Some(ea) => {
                if ea.size != eb.size || ea.inode != eb.inode || ea.mtime_ms != eb.mtime_ms {
                    let note = if ea.size != eb.size {
                        fmt_bytes(Some(eb.size - ea.size))
                    } else if ea.inode != eb.inode {
                        "replaced".to_string()
                    } else {
                        "touched".to_string()
                    };
                    changed.push(format!("  ~ {} ({note})", eb.path));
                }
            }
        }
    }
    for ea in &ordered_a {
        if !map_b.contains_key(&ea.path) {
            removed.push(format!("  - {}", ea.path));
        }
    }
    let cap = |list: &[String], title: &str| {
        out(&format!("{title}: {}", list.len()));
        for line in list.iter().take(200) {
            out(line);
        }
        if list.len() > 200 {
            out(&format!("  ... {} more", list.len() - 200));
        }
    };
    cap(&added, "added");
    cap(&removed, "removed");
    cap(&changed, "changed");
    Ok(0)
}

// --- explain, peek ----------------------------------------------------------------------

fn normalize(sensor: &Sensor<'_>, input: &str) -> String {
    let u = sensor.universe;
    if input == u.state_display || input.starts_with(&format!("{}.", u.state_display)) {
        return input.to_string();
    }
    if let Some(rest) = input.strip_prefix("~/") {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_default();
        return u.rel(&home.join(rest));
    }
    if Path::new(input).is_absolute() {
        return u.rel(Path::new(input));
    }
    input.to_string()
}

fn explain(sensor: &Sensor<'_>, args: &[String]) -> VerbResult {
    let Some(target) = args.iter().find(|a| !a.starts_with("--")) else {
        err("usage: observatory explain <path>");
        return Ok(1);
    };
    let rel_path = normalize(sensor, target);
    out(&format!("path: {rel_path}\n"));

    let text = sensor
        .findings
        .as_ref()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_default();
    let sections = load_sections(&text);
    match best_match(&sections, &rel_path) {
        Some(best) => {
            out(&format!("FINDINGS.md: `{}`\n", best.pattern));
            out(lead(&best.body));
        }
        None => out("no FINDINGS.md entry matches this path yet: that makes it interesting."),
    }

    let store = open(sensor)?;
    let (n, lo, hi, churn) = store.path_history(&rel_path).map_err(|e| e.to_string())?;
    out(&format!("\nobserved history: {n} events"));
    if n > 0 {
        out(&format!(
            "  first {}, last {}, churn {}",
            to_locale_string(lo.unwrap_or(0)),
            to_locale_string(hi.unwrap_or(0)),
            fmt_bytes(Some(churn))
        ));
        let mut recent = store
            .path_recent(&rel_path, 10)
            .map_err(|e| e.to_string())?;
        recent.reverse();
        out("  recent:");
        for (ts, action, label, _delta) in recent {
            out(&format!(
                "    {}  {:<9} {}",
                to_locale_string(ts),
                action,
                label
            ));
        }
    }
    Ok(0)
}

fn peek(sensor: &Sensor<'_>, args: &[String]) -> VerbResult {
    let Some(target) = args.iter().find(|a| !a.starts_with("--")) else {
        err("usage: observatory peek <path> [--bytes N] [--tail]");
        return Ok(1);
    };
    let u = sensor.universe;
    let abs: PathBuf = if target == &u.state_display {
        u.state_file.clone()
    } else if Path::new(target).is_absolute() {
        PathBuf::from(target)
    } else {
        u.watch_root.join(target)
    };
    let inside = abs == u.state_file || abs == u.watch_root || abs.starts_with(&u.watch_root);
    if !inside {
        err(&format!(
            "refusing: {} is outside the observed universe",
            abs.display()
        ));
        return Ok(1);
    }
    // Spec 115 B-4: a secret is refused before it is opened, not masked.
    let rel = u.rel(&abs);
    if u.is_never_peek(&rel) {
        err(&format!("refused: {rel} is a secret and is never read"));
        return Ok(1);
    }
    let max_bytes: u64 = opt(args, "--bytes")
        .and_then(|b| b.parse().ok())
        .unwrap_or(8192)
        .min(65536);
    let meta = std::fs::metadata(&abs).map_err(|e| format!("{}: {e}", abs.display()))?;
    let size = meta.len();
    let start = if has(args, "--tail") {
        size.saturating_sub(max_bytes)
    } else {
        0
    };
    let len = max_bytes.min(size);
    let mut file = std::fs::File::open(&abs).map_err(|e| format!("{}: {e}", abs.display()))?;
    file.seek(SeekFrom::Start(start))
        .map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; len as usize];
    let mut read = 0usize;
    while read < buf.len() {
        let n = file.read(&mut buf[read..]).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        read += n;
    }
    buf.truncate(read);
    out(&format!(
        "# {} ({} total, showing {} bytes from offset {start}, redacted)",
        u.rel(&abs),
        fmt_bytes(Some(size as i64)),
        buf.len()
    ));
    out(&redact::redact(&String::from_utf8_lossy(&buf)));
    Ok(0)
}

// --- daemon ---------------------------------------------------------------------------------

fn daemon_verb(sensor: &Sensor<'_>, args: &[String]) -> VerbResult {
    let layout = sensor.layout;
    let sub = args.first().map(String::as_str);
    let pid = daemon::read_pid(layout);
    match sub {
        Some("status") => {
            match pid {
                Some(pid) if daemon::alive(pid) => out(&format!(
                    "daemon running (pid {pid}), log: {}",
                    layout.daemon_log.display()
                )),
                Some(_) => out("daemon not running (stale pidfile)"),
                None => out("daemon not running"),
            }
            Ok(0)
        }
        Some("start") => {
            if let Some(pid) = pid {
                if daemon::alive(pid) {
                    out(&format!("daemon already running (pid {pid})"));
                    return Ok(0);
                }
            }
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let pid = daemon::start(layout, &exe).map_err(|e| e.to_string())?;
            out(&format!(
                "daemon started (pid {pid}), events to sqlite, log: {}",
                layout.daemon_log.display()
            ));
            Ok(0)
        }
        Some("stop") => {
            match pid {
                Some(pid) if daemon::alive(pid) => {
                    daemon::stop(layout, pid).map_err(|e| e.to_string())?;
                    out(&format!("daemon stopped (pid {pid})"));
                }
                _ => {
                    out("daemon not running");
                    daemon::remove_pidfile(layout);
                }
            }
            Ok(0)
        }
        Some("plist") => {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            out(&format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
  <key>Label</key><string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{exe}</string>
    <string>watch</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>{log}</string>
  <key>StandardErrorPath</key><string>{log}</string>
</dict>
</plist>
(save to ~/Library/LaunchAgents/{label}.plist and run: launchctl load <path>)",
                label = sensor.plist_label,
                exe = exe.display(),
                log = layout.daemon_log.display()
            ));
            Ok(0)
        }
        _ => {
            err("usage: observatory daemon start|stop|status|plist");
            Ok(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RuleTable;

    /// Spec 115 B-4 / FR-004: a denied path is refused before it is opened.
    /// The file does not exist, so an open would have failed differently.
    #[test]
    fn peek_refuses_a_denied_path_without_opening_it() {
        let dir = std::env::temp_dir().join(format!("sensor-peek-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("root")).unwrap();
        std::fs::write(dir.join("root/open.txt"), b"hello").unwrap();
        let universe = Universe {
            watch_root: dir.join("root"),
            state_file: dir.join("root/state.json"),
            state_display: "state.json".into(),
            ignored_basenames: vec![],
            ignored_suffixes: vec![],
            never_peek: vec!["secret.json".into()],
        };
        let table = RuleTable { rules: vec![] };
        let layout = Layout::under(dir.join("data"));
        let sensor = Sensor {
            universe: &universe,
            classifier: &table,
            layout: &layout,
            findings: None,
            usage: "usage",
            display_name: "test",
            plist_label: "test",
        };
        let denied = peek(&sensor, &["secret.json".to_string()]);
        assert_eq!(denied, Ok(1));
        let missing = peek(&sensor, &["missing.json".to_string()]);
        assert!(
            missing.is_err(),
            "an undenied missing file is an open error, not a refusal"
        );
        let open = peek(&sensor, &["open.txt".to_string()]);
        assert_eq!(open, Ok(0));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
