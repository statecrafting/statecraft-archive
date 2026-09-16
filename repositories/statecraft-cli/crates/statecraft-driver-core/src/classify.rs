//! Termination classification (spec 014 B-4, FR-002) over a provider's rule
//! table: completed, then the driver's own flags, then the provider's
//! result subtype, then the table, then crashed. Never guessed from
//! exit codes alone.

use chrono::{Datelike, TimeZone, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::ResultEvent;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TerminationKind {
    Completed,
    Auth,
    Quota,
    HookBlocked,
    Transient,
    Timeout,
    Killed,
    MaxTurns,
    Crashed,
}

impl TerminationKind {
    pub fn as_str(self) -> &'static str {
        match self {
            TerminationKind::Completed => "completed",
            TerminationKind::Auth => "auth",
            TerminationKind::Quota => "quota",
            TerminationKind::HookBlocked => "hook-blocked",
            TerminationKind::Transient => "transient",
            TerminationKind::Timeout => "timeout",
            TerminationKind::Killed => "killed",
            TerminationKind::MaxTurns => "max-turns",
            TerminationKind::Crashed => "crashed",
        }
    }
}

/// One rule of a provider's table: the first match wins.
pub struct Rule {
    pub kind: TerminationKind,
    pub pattern: Regex,
}

impl Rule {
    pub fn new(kind: TerminationKind, pattern: &str) -> Rule {
        Rule {
            kind,
            pattern: Regex::new(pattern).expect("rule pattern compiles"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Classification {
    pub kind: TerminationKind,
    pub reset_at_ms: Option<i64>,
    pub detail: String,
}

pub struct ClassifyInput<'a> {
    pub exit_code: Option<i64>,
    pub result_event: Option<&'a ResultEvent>,
    pub stderr_tail: &'a str,
    pub timed_out: bool,
    pub shutdown_killed: bool,
    /// The provider's subtype that means "turn cap reached", when it has one.
    pub max_turns_subtype: Option<&'a str>,
}

fn result_text(event: Option<&ResultEvent>) -> String {
    let Some(e) = event else {
        return String::new();
    };
    [e.subtype.as_deref(), e.result_text.as_deref()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("\n")
}

// --- reset-time extraction (014 FR-002) ---------------------------------------

struct ResetPatterns {
    iso: Regex,
    relative: Regex,
    epoch: Regex,
    clock: Regex,
}

fn reset_patterns() -> &'static ResetPatterns {
    static P: std::sync::OnceLock<ResetPatterns> = std::sync::OnceLock::new();
    P.get_or_init(|| ResetPatterns {
        // "resets at", "reset in", and the "try again at" form some
        // providers print (spec 116 B-7): the same four shapes after either.
        iso: Regex::new(r"(?i)(?:resets?|try again)(?:\s+(?:at|on))?\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)").unwrap(),
        relative: Regex::new(r"(?i)(?:resets?|try again)\s+in\s+(\d+)\s*(hour|hr|minute|min)s?\b").unwrap(),
        epoch: Regex::new(r"(?i)(?:resets?|try again)(?:\s+at)?\s*[:=]?\s*(\d{10,13})\b").unwrap(),
        clock: Regex::new(r"(?i)(?:resets?|try again)\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)?").unwrap(),
    })
}

/// `Date.parse` over the ISO forms the pattern admits: with a zone as
/// given, without one as local time, seconds and fractions optional.
fn parse_iso(text: &str) -> Option<i64> {
    let has_zone = text.ends_with('Z') || Regex::new(r"[+-]\d{2}:?\d{2}$").unwrap().is_match(text);
    if has_zone {
        let normalized = text.to_string();
        for fmt in [
            "%Y-%m-%dT%H:%M:%S%.fZ",
            "%Y-%m-%dT%H:%M:%SZ",
            "%Y-%m-%dT%H:%MZ",
        ] {
            if let Ok(t) = chrono::NaiveDateTime::parse_from_str(&normalized, fmt) {
                return Some(t.and_utc().timestamp_millis());
            }
        }
        for fmt in [
            "%Y-%m-%dT%H:%M:%S%.f%:z",
            "%Y-%m-%dT%H:%M:%S%:z",
            "%Y-%m-%dT%H:%M%:z",
            "%Y-%m-%dT%H:%M:%S%.f%z",
            "%Y-%m-%dT%H:%M:%S%z",
            "%Y-%m-%dT%H:%M%z",
        ] {
            if let Ok(t) = chrono::DateTime::parse_from_str(&normalized, fmt) {
                return Some(t.timestamp_millis());
            }
        }
        return None;
    }
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
    ] {
        if let Ok(t) = chrono::NaiveDateTime::parse_from_str(text, fmt) {
            return chrono::Local
                .from_local_datetime(&t)
                .single()
                .map(|l| l.timestamp_millis());
        }
    }
    None
}

/// `extractResetAtMs`: ISO, then relative, then epoch, then a bare clock
/// time read as UTC today or tomorrow; null rather than a guess.
pub fn extract_reset_at_ms(text: &str, now_ms: i64) -> Option<i64> {
    let p = reset_patterns();
    if let Some(c) = p.iso.captures(text) {
        if let Some(ms) = parse_iso(&c[1]) {
            return Some(ms);
        }
    }
    if let Some(c) = p.relative.captures(text) {
        let amount: i64 = c[1].parse().ok()?;
        let unit_ms = if c[2].to_lowercase().starts_with('h') {
            3_600_000
        } else {
            60_000
        };
        return Some(now_ms + amount * unit_ms);
    }
    if let Some(c) = p.epoch.captures(text) {
        let digits = &c[1];
        let value: i64 = digits.parse().ok()?;
        return Some(if digits.len() <= 10 {
            value * 1000
        } else {
            value
        });
    }
    if let Some(c) = p.clock.captures(text) {
        let mut hour: u32 = c[1].parse().ok()?;
        let minute: u32 = c[2].parse().ok()?;
        let meridiem = c.get(3).map(|m| m.as_str().to_lowercase());
        if meridiem.as_deref() == Some("pm") && hour < 12 {
            hour += 12;
        }
        if meridiem.as_deref() == Some("am") && hour == 12 {
            hour = 0;
        }
        let reference = Utc.timestamp_millis_opt(now_ms).single()?;
        let candidate = Utc
            .with_ymd_and_hms(
                reference.year(),
                reference.month(),
                reference.day(),
                hour,
                minute,
                0,
            )
            .single()?
            .timestamp_millis();
        return Some(if candidate > now_ms {
            candidate
        } else {
            candidate + 86_400_000
        });
    }
    None
}

/// `classifyTermination` in 014 B-4's order.
pub fn classify(input: &ClassifyInput<'_>, rules: &[Rule], now_ms: i64) -> Classification {
    if let Some(event) = input.result_event {
        if !event.is_error {
            return Classification {
                kind: TerminationKind::Completed,
                reset_at_ms: None,
                detail: "result event reported is_error: false".to_string(),
            };
        }
    }
    if input.shutdown_killed {
        return Classification {
            kind: TerminationKind::Killed,
            reset_at_ms: None,
            detail: "the daemon's shutdown path severed the live session child (021 B-6)"
                .to_string(),
        };
    }
    if input.timed_out {
        return Classification {
            kind: TerminationKind::Timeout,
            reset_at_ms: None,
            detail: "driver killed the process after it exceeded its configured deadline"
                .to_string(),
        };
    }
    if let (Some(event), Some(subtype)) = (input.result_event, input.max_turns_subtype) {
        if event.subtype.as_deref() == Some(subtype) {
            return Classification {
                kind: TerminationKind::MaxTurns,
                reset_at_ms: None,
                detail: format!(
                    "result event reported subtype {subtype} (the session hit its turn cap)"
                ),
            };
        }
    }
    let text = result_text(input.result_event);
    let haystack: String = [text.as_str(), input.stderr_tail]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    for rule in rules {
        if let Some(m) = rule.pattern.find(&haystack) {
            let reset_at_ms = if rule.kind == TerminationKind::Quota {
                extract_reset_at_ms(&haystack, now_ms)
            } else {
                None
            };
            return Classification {
                kind: rule.kind,
                reset_at_ms,
                detail: format!("matched {} pattern: \"{}\"", rule.kind.as_str(), m.as_str()),
            };
        }
    }
    let exit_detail = match input.exit_code {
        None => "the process ended with no recorded exit code".to_string(),
        Some(code) => format!("the process exited with code {code}"),
    };
    Classification {
        kind: TerminationKind::Crashed,
        reset_at_ms: None,
        detail: format!("{exit_detail} and no result event or classifiable error text was seen"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules() -> Vec<Rule> {
        vec![
            Rule::new(TerminationKind::Auth, r"(?i)unauthorized"),
            Rule::new(TerminationKind::Quota, r"(?i)usage limit|rate.?limit"),
        ]
    }

    fn event(is_error: bool, subtype: &str, text: &str) -> ResultEvent {
        ResultEvent {
            is_error,
            subtype: Some(subtype.into()),
            result_text: Some(text.into()),
            ..Default::default()
        }
    }

    #[test]
    fn order_is_014s() {
        let ok = event(false, "success", "DONE");
        let killed = ClassifyInput {
            exit_code: Some(0),
            result_event: Some(&ok),
            stderr_tail: "",
            timed_out: true,
            shutdown_killed: true,
            max_turns_subtype: Some("error_max_turns"),
        };
        assert_eq!(
            classify(&killed, &rules(), 0).kind,
            TerminationKind::Completed
        );
        let none = ClassifyInput {
            exit_code: None,
            result_event: None,
            stderr_tail: "",
            timed_out: true,
            shutdown_killed: true,
            max_turns_subtype: None,
        };
        assert_eq!(classify(&none, &rules(), 0).kind, TerminationKind::Killed);
        let timed = ClassifyInput {
            timed_out: true,
            shutdown_killed: false,
            ..none
        };
        assert_eq!(classify(&timed, &rules(), 0).kind, TerminationKind::Timeout);
        let capped = event(true, "error_max_turns", "limit reached");
        let max = ClassifyInput {
            exit_code: Some(1),
            result_event: Some(&capped),
            stderr_tail: "",
            timed_out: false,
            shutdown_killed: false,
            max_turns_subtype: Some("error_max_turns"),
        };
        assert_eq!(classify(&max, &rules(), 0).kind, TerminationKind::MaxTurns);
        let both = event(true, "error", "Unauthorized: rate limit");
        let auth = ClassifyInput {
            result_event: Some(&both),
            max_turns_subtype: None,
            ..max
        };
        let c = classify(&auth, &rules(), 0);
        assert_eq!(c.kind, TerminationKind::Auth);
        assert_eq!(c.detail, "matched auth pattern: \"Unauthorized\"");
        let crashed = ClassifyInput {
            exit_code: Some(2),
            result_event: None,
            stderr_tail: "boom",
            timed_out: false,
            shutdown_killed: false,
            max_turns_subtype: None,
        };
        let c = classify(&crashed, &rules(), 0);
        assert_eq!(c.kind, TerminationKind::Crashed);
        assert_eq!(c.detail, "the process exited with code 2 and no result event or classifiable error text was seen");
    }

    #[test]
    fn reset_forms() {
        let now = 1_700_000_000_000;
        assert_eq!(
            extract_reset_at_ms("resets at 2026-09-09T15:00:00Z", now),
            Some(1_788_966_000_000)
        );
        assert_eq!(
            extract_reset_at_ms("Resets in 2 hours", now),
            Some(now + 7_200_000)
        );
        assert_eq!(
            extract_reset_at_ms("reset in 30 min", now),
            Some(now + 1_800_000)
        );
        assert_eq!(
            extract_reset_at_ms("resets at 1700000000", now),
            Some(1_700_000_000_000)
        );
        assert_eq!(
            extract_reset_at_ms("resets at 1700000000123", now),
            Some(1_700_000_000_123)
        );
        // 2023-11-14T22:13:20Z: 3pm has passed, so tomorrow's 15:00 UTC.
        assert_eq!(
            extract_reset_at_ms("resets at 3:00 pm", now),
            Some(1_700_060_400_000)
        );
        assert_eq!(
            extract_reset_at_ms("You've hit your usage limit. Try again at 3:00 pm.", now),
            Some(1_700_060_400_000)
        );
        assert_eq!(
            extract_reset_at_ms("try again in 45 minutes", now),
            Some(now + 2_700_000)
        );
        assert_eq!(extract_reset_at_ms("nothing here", now), None);
    }
}
