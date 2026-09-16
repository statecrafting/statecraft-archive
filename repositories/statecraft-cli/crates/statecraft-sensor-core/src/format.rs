//! The formatter: byte sizes, clock times and event lines exactly as the
//! TypeScript sensor rendered them (spec 112 B-4), including the `en-US`
//! `toLocaleString` form (D-3).

use chrono::{DateTime, Datelike, Local, TimeZone, Timelike};

use crate::store::EventRow;

const RESET: &str = "\x1b[0m";
const DIM: &str = "\x1b[2m";
const RED: &str = "\x1b[31m";
const GREEN: &str = "\x1b[32m";
const YELLOW: &str = "\x1b[33m";
const BLUE: &str = "\x1b[34m";
const MAGENTA: &str = "\x1b[35m";
const CYAN: &str = "\x1b[36m";
const INV_RED: &str = "\x1b[41m\x1b[97m";

fn kind_color(kind: &str) -> &'static str {
    match kind {
        "transcript" => CYAN,
        "memory" => MAGENTA,
        "file-history" => BLUE,
        "session-env" => GREEN,
        "task" => GREEN,
        "session-registry" => YELLOW,
        "paste" => MAGENTA,
        "shell-snapshot" => BLUE,
        "prompt-history" => CYAN,
        "state-backup" => YELLOW,
        "state-file" => YELLOW,
        "config" => RED,
        "first-fill" => INV_RED,
        "unclassified" => INV_RED,
        _ => "",
    }
}

/// JavaScript's `Number.prototype.toFixed(1)`: the nearest tenth, ties
/// away from zero.
fn to_fixed_1(x: f64) -> String {
    let scaled = (x * 10.0).round() / 10.0;
    format!("{scaled:.1}")
}

/// `fmtBytes`: signed, `B`/`KB`/`MB`/`GB` with one decimal above a kilobyte.
pub fn fmt_bytes(n: Option<i64>) -> String {
    let Some(n) = n else {
        return String::new();
    };
    let sign = if n > 0 {
        "+"
    } else if n < 0 {
        "-"
    } else {
        ""
    };
    let abs = n.unsigned_abs() as f64;
    if abs >= 1e9 {
        format!("{sign}{}GB", to_fixed_1(abs / 1e9))
    } else if abs >= 1e6 {
        format!("{sign}{}MB", to_fixed_1(abs / 1e6))
    } else if abs >= 1e3 {
        format!("{sign}{}KB", to_fixed_1(abs / 1e3))
    } else {
        format!("{sign}{}B", n.unsigned_abs())
    }
}

fn local(ts_ms: i64) -> DateTime<Local> {
    Local
        .timestamp_millis_opt(ts_ms)
        .single()
        .unwrap_or_else(|| Local.timestamp_millis_opt(0).unwrap())
}

/// `fmtTime`: `HH:MM:SS.mmm` in local time.
pub fn fmt_time(ts_ms: i64) -> String {
    let d = local(ts_ms);
    format!(
        "{:02}:{:02}:{:02}.{:03}",
        d.hour(),
        d.minute(),
        d.second(),
        d.timestamp_subsec_millis()
    )
}

/// `YYYY-MM-DD` in local time, as `log` prefixes each row.
pub fn fmt_day(ts_ms: i64) -> String {
    let d = local(ts_ms);
    format!("{:04}-{:02}-{:02}", d.year(), d.month(), d.day())
}

/// `Date.prototype.toLocaleString()` under `en-US`: `9/9/2026, 2:05:44 PM`.
pub fn to_locale_string(ts_ms: i64) -> String {
    let d = local(ts_ms);
    let hour12 = match d.hour() % 12 {
        0 => 12,
        h => h,
    };
    let ampm = if d.hour() < 12 { "AM" } else { "PM" };
    format!(
        "{}/{}/{}, {}:{:02}:{:02} {}",
        d.month(),
        d.day(),
        d.year(),
        hour12,
        d.minute(),
        d.second(),
        ampm
    )
}

/// Whether to paint: a TTY and no `NO_COLOR`.
pub fn use_color() -> bool {
    use std::io::IsTerminal;
    std::io::stdout().is_terminal() && std::env::var_os("NO_COLOR").is_none()
}

/// One live event line (`formatEvent`).
pub fn format_event(ev: &EventRow, raw: bool, color: bool) -> String {
    let paint = |s: &str, code: &str| {
        if color && !code.is_empty() {
            format!("{code}{s}{RESET}")
        } else {
            s.to_string()
        }
    };
    let kind_col = kind_color(&ev.kind);
    let delta = if ev.action == "modified" || ev.action == "replaced" {
        fmt_bytes(ev.delta)
    } else {
        String::new()
    };
    let parts = [
        paint(&fmt_time(ev.ts), DIM),
        format!("{delta:>8}"),
        paint(
            &format!("{:<16}", ev.kind),
            if kind_col.is_empty() { DIM } else { kind_col },
        ),
        ev.label.clone(),
        paint(&ev.path, DIM),
    ];
    let mut line = parts.join("  ");
    if raw {
        if let Some(notes) = ev.raw_notes() {
            if !notes.is_empty() {
                let desc: Vec<String> = notes
                    .iter()
                    .map(|n| format!("{}@{}", n.kind, fmt_time(n.ts)))
                    .collect();
                line.push('\n');
                line.push_str(&paint(
                    &format!(
                        "    raw: [{}] action={} inode={}",
                        desc.join(", "),
                        ev.action,
                        ev.inode
                            .map(|i| i.to_string())
                            .unwrap_or_else(|| "?".to_string())
                    ),
                    DIM,
                ));
            }
        }
    }
    line
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_render_like_the_typescript_formatter() {
        assert_eq!(fmt_bytes(None), "");
        assert_eq!(fmt_bytes(Some(0)), "0B");
        assert_eq!(fmt_bytes(Some(512)), "+512B");
        assert_eq!(fmt_bytes(Some(-512)), "-512B");
        assert_eq!(fmt_bytes(Some(1536)), "+1.5KB");
        assert_eq!(fmt_bytes(Some(1250)), "+1.3KB");
        assert_eq!(fmt_bytes(Some(-2_500_000)), "-2.5MB");
        assert_eq!(fmt_bytes(Some(3_000_000_000)), "+3.0GB");
        assert_eq!(fmt_bytes(Some(999)), "+999B");
    }

    #[test]
    fn locale_string_is_en_us() {
        // 2026-09-09T14:05:44Z; the rendering is in local time, so only the
        // shape is fixed here and the parity test checks a real value under
        // TZ=UTC.
        let s = to_locale_string(1_788_962_744_000);
        assert!(s.contains(", "));
        assert!(s.ends_with(" AM") || s.ends_with(" PM"));
        let t = fmt_time(1_788_962_744_123);
        assert!(t.ends_with(".123"));
        assert_eq!(fmt_day(0).len(), 10);
    }
}
