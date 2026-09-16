// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use crate::schema::XrayIndex;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// A single entry in the scan history.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    /// Digest of this scan
    pub digest: String,
    /// ISO 8601 timestamp of when this entry was recorded
    pub timestamp: String,
    /// Total file count at time of scan
    pub file_count: usize,
    /// Number of files changed since previous scan (0 if first scan)
    pub changed_count: usize,
    /// Paths of files that changed (empty if first scan or no previous)
    pub changed_files: Vec<String>,
}

/// Churn report entry: file path and how many times it appeared in change lists.
#[derive(Debug, Serialize, Deserialize)]
pub struct ChurnEntry {
    pub path: String,
    pub changes: usize,
}

/// Growth statistics across history entries.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowthStats {
    pub entries: usize,
    pub first_file_count: usize,
    pub latest_file_count: usize,
    pub file_count_delta: i64,
}

/// Append a scan result to the history file (JSONL format, one entry per line).
pub fn append_history(history_path: &Path, index: &XrayIndex) -> Result<()> {
    let changed = index.changed_files.as_deref().unwrap_or(&[]);
    let entry = HistoryEntry {
        digest: index.digest.clone(),
        timestamp: now_iso8601(),
        file_count: index.stats.file_count,
        changed_count: changed.len(),
        changed_files: changed.to_vec(),
    };

    let line = serde_json::to_string(&entry).context("Failed to serialize history entry")?;

    // Ensure parent directory exists
    if let Some(parent) = history_path.parent() {
        std::fs::create_dir_all(parent).context("Failed to create history directory")?;
    }

    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(history_path)
        .context("Failed to open history file")?;
    writeln!(file, "{}", line).context("Failed to write history entry")?;

    Ok(())
}

/// Load all history entries from a JSONL file.
pub fn load_history(history_path: &Path) -> Result<Vec<HistoryEntry>> {
    let content = match std::fs::read_to_string(history_path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e).context("Failed to read history file"),
    };

    let mut entries = Vec::new();
    for (i, line) in content.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let entry: HistoryEntry = serde_json::from_str(line)
            .with_context(|| format!("Failed to parse history entry at line {}", i + 1))?;
        entries.push(entry);
    }

    Ok(entries)
}

/// Generate a churn report: which files changed most frequently across history.
pub fn churn_report(entries: &[HistoryEntry], top_n: usize) -> Vec<ChurnEntry> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for entry in entries {
        for path in &entry.changed_files {
            *counts.entry(path.clone()).or_insert(0) += 1;
        }
    }

    let mut sorted: Vec<ChurnEntry> = counts
        .into_iter()
        .map(|(path, changes)| ChurnEntry { path, changes })
        .collect();
    sorted.sort_by(|a, b| b.changes.cmp(&a.changes).then(a.path.cmp(&b.path)));
    sorted.truncate(top_n);
    sorted
}

/// Generate growth statistics from history.
pub fn growth_report(entries: &[HistoryEntry]) -> GrowthStats {
    if entries.is_empty() {
        return GrowthStats {
            entries: 0,
            first_file_count: 0,
            latest_file_count: 0,
            file_count_delta: 0,
        };
    }

    let first = entries.first().unwrap().file_count;
    let latest = entries.last().unwrap().file_count;

    GrowthStats {
        entries: entries.len(),
        first_file_count: first,
        latest_file_count: latest,
        file_count_delta: latest as i64 - first as i64,
    }
}

fn now_iso8601() -> String {
    // Simple UTC timestamp without external dependency
    use std::time::SystemTime;
    let duration = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();
    // Convert to rough ISO 8601 (good enough without chrono dependency)
    let days = secs / 86400;
    let time_secs = secs % 86400;
    let hours = time_secs / 3600;
    let minutes = (time_secs % 3600) / 60;
    let seconds = time_secs % 60;

    // Approximate date from epoch days (not accounting for leap seconds, but close enough)
    let (year, month, day) = epoch_days_to_date(days);

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, minutes, seconds
    )
}

fn epoch_days_to_date(days: u64) -> (u64, u64, u64) {
    // Civil date from epoch days (Algorithm from Howard Hinnant)
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_append_and_load_history() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("history.jsonl");

        let index = XrayIndex {
            digest: "abc123".to_string(),
            changed_files: Some(vec!["a.rs".to_string(), "b.rs".to_string()]),
            ..Default::default()
        };

        append_history(&path, &index).unwrap();
        append_history(&path, &index).unwrap();

        let entries = load_history(&path).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].digest, "abc123");
        assert_eq!(entries[0].changed_count, 2);
        assert_eq!(entries[0].changed_files, vec!["a.rs", "b.rs"]);
    }

    #[test]
    fn test_churn_report() {
        let entries = vec![
            HistoryEntry {
                digest: "d1".to_string(),
                timestamp: "2026-01-01T00:00:00Z".to_string(),
                file_count: 10,
                changed_count: 2,
                changed_files: vec!["hot.rs".to_string(), "cold.rs".to_string()],
            },
            HistoryEntry {
                digest: "d2".to_string(),
                timestamp: "2026-01-02T00:00:00Z".to_string(),
                file_count: 10,
                changed_count: 1,
                changed_files: vec!["hot.rs".to_string()],
            },
            HistoryEntry {
                digest: "d3".to_string(),
                timestamp: "2026-01-03T00:00:00Z".to_string(),
                file_count: 11,
                changed_count: 2,
                changed_files: vec!["hot.rs".to_string(), "new.rs".to_string()],
            },
        ];

        let report = churn_report(&entries, 10);
        assert_eq!(report[0].path, "hot.rs");
        assert_eq!(report[0].changes, 3);
        assert_eq!(report[1].path, "cold.rs");
        assert_eq!(report[1].changes, 1);
    }

    #[test]
    fn test_growth_report() {
        let entries = vec![
            HistoryEntry {
                digest: "d1".to_string(),
                timestamp: "2026-01-01T00:00:00Z".to_string(),
                file_count: 10,
                changed_count: 0,
                changed_files: vec![],
            },
            HistoryEntry {
                digest: "d2".to_string(),
                timestamp: "2026-01-02T00:00:00Z".to_string(),
                file_count: 15,
                changed_count: 5,
                changed_files: vec![],
            },
        ];

        let stats = growth_report(&entries);
        assert_eq!(stats.entries, 2);
        assert_eq!(stats.first_file_count, 10);
        assert_eq!(stats.latest_file_count, 15);
        assert_eq!(stats.file_count_delta, 5);
    }

    #[test]
    fn test_load_nonexistent_history() {
        let entries = load_history(Path::new("/nonexistent/path/history.jsonl")).unwrap();
        assert!(entries.is_empty());
    }
}
