// Spec 180 §3.2 — filesystem-scanning IPC handler discipline.
//
// `usage.rs` is the canonical instance of a Tauri command handler that
// scans the user's filesystem (`~/.claude/projects/**/*.jsonl`). The Tier 1
// invariants bound here:
//
//   FR-T4  Handlers that read the user filesystem are `pub async fn` and do
//          the blocking work via `tokio::task::spawn_blocking`, so a scan
//          never starves the Tauri runtime that drives window/IPC events.
//   FR-T5  A process-lifetime cache keyed by file path with mtime as the
//          freshness marker — a cache hit (mtime unchanged) does not re-read
//          the file body.
//   FR-T6  A single read per file per invocation: one forward pass yields
//          both the per-line records and the earliest timestamp (the former
//          `get_earliest_timestamp` + `parse_jsonl_file` two-pass read is
//          gone).
//   FR-T7  The cache is registered as Tauri managed state in lib.rs and
//          retrieved via `State<'_, UsageCache>` rather than constructed
//          per-call.
use chrono::{DateTime, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use tauri::{State, command};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UsageEntry {
    timestamp: String,
    model: String,
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_tokens: u64,
    cache_read_tokens: u64,
    cost: f64,
    session_id: String,
    project_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UsageStats {
    total_cost: f64,
    total_tokens: u64,
    total_input_tokens: u64,
    total_output_tokens: u64,
    total_cache_creation_tokens: u64,
    total_cache_read_tokens: u64,
    total_sessions: u64,
    by_model: Vec<ModelUsage>,
    by_date: Vec<DailyUsage>,
    by_project: Vec<ProjectUsage>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelUsage {
    model: String,
    total_cost: f64,
    total_tokens: u64,
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_tokens: u64,
    cache_read_tokens: u64,
    session_count: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DailyUsage {
    date: String,
    total_cost: f64,
    total_tokens: u64,
    models_used: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectUsage {
    project_path: String,
    project_name: String,
    total_cost: f64,
    total_tokens: u64,
    session_count: u64,
    last_used: String,
}

// Claude 4 pricing constants (per million tokens)
const OPUS_4_INPUT_PRICE: f64 = 15.0;
const OPUS_4_OUTPUT_PRICE: f64 = 75.0;
const OPUS_4_CACHE_WRITE_PRICE: f64 = 18.75;
const OPUS_4_CACHE_READ_PRICE: f64 = 1.50;

const SONNET_4_INPUT_PRICE: f64 = 3.0;
const SONNET_4_OUTPUT_PRICE: f64 = 15.0;
const SONNET_4_CACHE_WRITE_PRICE: f64 = 3.75;
const SONNET_4_CACHE_READ_PRICE: f64 = 0.30;

#[derive(Debug, Deserialize)]
struct JsonlEntry {
    timestamp: String,
    message: Option<MessageData>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    #[serde(rename = "requestId")]
    request_id: Option<String>,
    #[serde(rename = "costUSD")]
    cost_usd: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct MessageData {
    id: Option<String>,
    model: Option<String>,
    usage: Option<UsageData>,
}

#[derive(Debug, Deserialize)]
struct UsageData {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
}

fn calculate_cost(model: &str, usage: &UsageData) -> f64 {
    let input_tokens = usage.input_tokens.unwrap_or(0) as f64;
    let output_tokens = usage.output_tokens.unwrap_or(0) as f64;
    let cache_creation_tokens = usage.cache_creation_input_tokens.unwrap_or(0) as f64;
    let cache_read_tokens = usage.cache_read_input_tokens.unwrap_or(0) as f64;

    // Calculate cost based on model
    let (input_price, output_price, cache_write_price, cache_read_price) =
        if model.contains("opus-4") || model.contains("claude-opus-4") {
            (
                OPUS_4_INPUT_PRICE,
                OPUS_4_OUTPUT_PRICE,
                OPUS_4_CACHE_WRITE_PRICE,
                OPUS_4_CACHE_READ_PRICE,
            )
        } else if model.contains("sonnet-4") || model.contains("claude-sonnet-4") {
            (
                SONNET_4_INPUT_PRICE,
                SONNET_4_OUTPUT_PRICE,
                SONNET_4_CACHE_WRITE_PRICE,
                SONNET_4_CACHE_READ_PRICE,
            )
        } else {
            // Return 0 for unknown models to avoid incorrect cost estimations.
            (0.0, 0.0, 0.0, 0.0)
        };

    // Calculate cost (prices are per million tokens)

    (input_tokens * input_price / 1_000_000.0)
        + (output_tokens * output_price / 1_000_000.0)
        + (cache_creation_tokens * cache_write_price / 1_000_000.0)
        + (cache_read_tokens * cache_read_price / 1_000_000.0)
}

/// One parsed line of a usage JSONL file. A record is retained when it
/// affects either cross-file dedup (`dedup_hash`) or output (`entry`).
struct FileRecord {
    /// `message.id:requestId` when both are present — the cross-file dedup
    /// key. A keyed record consumes its key during the cross-file pass even
    /// if it produced no usage entry, preserving the original dedup order.
    dedup_hash: Option<String>,
    /// The usage entry this line produced, if any.
    entry: Option<UsageEntry>,
}

/// The result of a single read of one usage JSONL file (FR-T6).
struct ParsedFile {
    records: Vec<FileRecord>,
    earliest_timestamp: Option<String>,
}

/// Read a usage JSONL file exactly once (FR-T6) and produce both its records
/// (in line order, before cross-file dedup) and its earliest timestamp. This
/// merges the two former read passes (`get_earliest_timestamp` and
/// `parse_jsonl_file`) into a single forward scan of the file body.
fn parse_file_full(path: &Path, encoded_project_name: &str) -> ParsedFile {
    let mut records = Vec::new();
    let mut earliest_timestamp: Option<String> = None;
    let mut actual_project_path: Option<String> = None;

    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => {
            return ParsedFile {
                records,
                earliest_timestamp,
            };
        }
    };

    // Extract session ID from the file path
    let session_id = path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    for line in content.lines() {
        if line.trim().is_empty() {
            continue;
        }

        let Ok(json_value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };

        // Earliest-timestamp tracking (formerly get_earliest_timestamp's own
        // read pass). Track the minimum timestamp string seen.
        if let Some(ts) = json_value.get("timestamp").and_then(|v| v.as_str()) {
            match &earliest_timestamp {
                Some(cur) if ts >= cur.as_str() => {}
                _ => earliest_timestamp = Some(ts.to_string()),
            }
        }

        // Extract the actual project path from cwd if we haven't already.
        if actual_project_path.is_none()
            && let Some(cwd) = json_value.get("cwd").and_then(|v| v.as_str())
        {
            actual_project_path = Some(cwd.to_string());
        }

        // Try to parse as JsonlEntry for usage data.
        let Ok(entry) = serde_json::from_value::<JsonlEntry>(json_value) else {
            continue;
        };
        let Some(message) = &entry.message else {
            continue;
        };

        // Dedup key — recorded whenever both ids are present, regardless of
        // whether the line carries usage (matches the original semantics
        // where the hash was inserted before the usage check).
        let dedup_hash = match (&message.id, &entry.request_id) {
            (Some(msg_id), Some(req_id)) => Some(format!("{}:{}", msg_id, req_id)),
            _ => None,
        };

        let mut usage_entry = None;
        if let Some(usage) = &message.usage {
            // Skip entries without meaningful token usage.
            let has_tokens = usage.input_tokens.unwrap_or(0) != 0
                || usage.output_tokens.unwrap_or(0) != 0
                || usage.cache_creation_input_tokens.unwrap_or(0) != 0
                || usage.cache_read_input_tokens.unwrap_or(0) != 0;
            if has_tokens {
                let cost = entry.cost_usd.unwrap_or_else(|| {
                    if let Some(model_str) = &message.model {
                        calculate_cost(model_str, usage)
                    } else {
                        0.0
                    }
                });

                // Use actual project path if found, otherwise the encoded name.
                let project_path = actual_project_path
                    .clone()
                    .unwrap_or_else(|| encoded_project_name.to_string());

                usage_entry = Some(UsageEntry {
                    timestamp: entry.timestamp.clone(),
                    model: message
                        .model
                        .clone()
                        .unwrap_or_else(|| "unknown".to_string()),
                    input_tokens: usage.input_tokens.unwrap_or(0),
                    output_tokens: usage.output_tokens.unwrap_or(0),
                    cache_creation_tokens: usage.cache_creation_input_tokens.unwrap_or(0),
                    cache_read_tokens: usage.cache_read_input_tokens.unwrap_or(0),
                    cost,
                    session_id: entry
                        .session_id
                        .clone()
                        .unwrap_or_else(|| session_id.clone()),
                    project_path,
                });
            }
        }

        if dedup_hash.is_some() || usage_entry.is_some() {
            records.push(FileRecord {
                dedup_hash,
                entry: usage_entry,
            });
        }
    }

    ParsedFile {
        records,
        earliest_timestamp,
    }
}

/// A cached parse plus the file mtime it was read at (the freshness marker).
type CachedFile = (SystemTime, Arc<ParsedFile>);
/// Path-keyed store of cached parses.
type UsageCacheMap = HashMap<PathBuf, CachedFile>;

/// FR-T5 / FR-T7 — process-lifetime, path-keyed, mtime-fresh cache for parsed
/// usage files. Registered once as Tauri managed state (`State<'_,
/// UsageCache>`); cheap to clone (an `Arc` handle) so a command can hand it
/// to `spawn_blocking`.
#[derive(Default, Clone)]
pub struct UsageCache {
    inner: Arc<Mutex<UsageCacheMap>>,
}

impl UsageCache {
    /// Return the parsed file, served from cache when the on-disk mtime is
    /// unchanged (FR-T5: a hit does not re-read the body). A miss (unseen
    /// path or changed mtime) re-reads exactly once (FR-T6) and refreshes
    /// the cache. Files without a readable mtime are parsed best-effort and
    /// not cached.
    fn get_or_parse(&self, path: &Path, encoded_project_name: &str) -> Arc<ParsedFile> {
        let Some(mtime) = fs::metadata(path).and_then(|m| m.modified()).ok() else {
            return Arc::new(parse_file_full(path, encoded_project_name));
        };

        {
            let map = self.inner.lock().unwrap();
            if let Some((cached_mtime, parsed)) = map.get(path)
                && *cached_mtime == mtime
            {
                return Arc::clone(parsed);
            }
        }

        // Parse outside the lock — I/O must not hold the cache mutex.
        let parsed = Arc::new(parse_file_full(path, encoded_project_name));
        self.inner
            .lock()
            .unwrap()
            .insert(path.to_path_buf(), (mtime, Arc::clone(&parsed)));
        parsed
    }
}

/// Gather every usage entry under `~/.claude/projects`, reading each file at
/// most once via the cache (FR-T5/T6) and applying deterministic cross-file
/// dedup in earliest-timestamp order.
///
/// Public so the Tier 2 criterion bench (FR-T8) can exercise this exact scan
/// path — the peer-public function the filesystem-scanning handlers delegate
/// to — over a synthetic corpus rooted at an arbitrary `claude_path`.
pub fn get_all_usage_entries(claude_path: &Path, cache: &UsageCache) -> Vec<UsageEntry> {
    let projects_dir = claude_path.join("projects");

    let mut files_to_process: Vec<(PathBuf, String)> = Vec::new();
    if let Ok(projects) = fs::read_dir(&projects_dir) {
        for project in projects.flatten() {
            if project.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let project_name = project.file_name().to_string_lossy().to_string();
                let project_path = project.path();

                walkdir::WalkDir::new(&project_path)
                    .into_iter()
                    .filter_map(Result::ok)
                    .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("jsonl"))
                    .for_each(|entry| {
                        files_to_process.push((entry.path().to_path_buf(), project_name.clone()));
                    });
            }
        }
    }

    // Read (or reuse the cached read of) each file once.
    let mut parsed_files: Vec<Arc<ParsedFile>> = files_to_process
        .iter()
        .map(|(path, project_name)| cache.get_or_parse(path, project_name))
        .collect();

    // Sort by earliest timestamp to ensure chronological processing and
    // deterministic deduplication (mirrors the former sort by
    // get_earliest_timestamp; Option ordering: None sorts first).
    parsed_files.sort_by(|a, b| a.earliest_timestamp.cmp(&b.earliest_timestamp));

    // Cross-file deduplication: the first occurrence of a (msg_id, req_id)
    // key wins, in sorted file order then line order.
    let mut processed_hashes: HashSet<String> = HashSet::new();
    let mut all_entries: Vec<UsageEntry> = Vec::new();
    for parsed in &parsed_files {
        for record in &parsed.records {
            if let Some(hash) = &record.dedup_hash {
                if processed_hashes.contains(hash) {
                    continue; // Skip duplicate entry
                }
                processed_hashes.insert(hash.clone());
            }
            if let Some(entry) = &record.entry {
                all_entries.push(entry.clone());
            }
        }
    }

    // Sort by timestamp
    all_entries.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

    all_entries
}

#[command]
pub async fn get_usage_stats(
    days: Option<u32>,
    cache: State<'_, UsageCache>,
) -> Result<UsageStats, String> {
    // FR-T4 — the blocking filesystem scan runs off the Tauri runtime.
    let cache = cache.inner().clone();
    tokio::task::spawn_blocking(move || compute_usage_stats(days, &cache))
        .await
        .map_err(|e| format!("get_usage_stats task panicked: {e}"))?
}

fn compute_usage_stats(days: Option<u32>, cache: &UsageCache) -> Result<UsageStats, String> {
    let claude_path = dirs::home_dir()
        .ok_or("Failed to get home directory")?
        .join(".claude");

    let all_entries = get_all_usage_entries(&claude_path, cache);

    if all_entries.is_empty() {
        return Ok(UsageStats {
            total_cost: 0.0,
            total_tokens: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_cache_creation_tokens: 0,
            total_cache_read_tokens: 0,
            total_sessions: 0,
            by_model: vec![],
            by_date: vec![],
            by_project: vec![],
        });
    }

    // Filter by days if specified
    let filtered_entries = if let Some(days) = days {
        let cutoff = Local::now().naive_local().date() - chrono::Duration::days(days as i64);
        all_entries
            .into_iter()
            .filter(|e| {
                if let Ok(dt) = DateTime::parse_from_rfc3339(&e.timestamp) {
                    dt.naive_local().date() >= cutoff
                } else {
                    false
                }
            })
            .collect()
    } else {
        all_entries
    };

    Ok(aggregate_stats(&filtered_entries))
}

#[command]
pub async fn get_usage_by_date_range(
    start_date: String,
    end_date: String,
    cache: State<'_, UsageCache>,
) -> Result<UsageStats, String> {
    let cache = cache.inner().clone();
    tokio::task::spawn_blocking(move || compute_usage_by_date_range(start_date, end_date, &cache))
        .await
        .map_err(|e| format!("get_usage_by_date_range task panicked: {e}"))?
}

fn compute_usage_by_date_range(
    start_date: String,
    end_date: String,
    cache: &UsageCache,
) -> Result<UsageStats, String> {
    let claude_path = dirs::home_dir()
        .ok_or("Failed to get home directory")?
        .join(".claude");

    let all_entries = get_all_usage_entries(&claude_path, cache);

    // Parse dates
    let start = NaiveDate::parse_from_str(&start_date, "%Y-%m-%d").or_else(|_| {
        // Try parsing ISO datetime format
        DateTime::parse_from_rfc3339(&start_date)
            .map(|dt| dt.naive_local().date())
            .map_err(|e| format!("Invalid start date: {}", e))
    })?;
    let end = NaiveDate::parse_from_str(&end_date, "%Y-%m-%d").or_else(|_| {
        // Try parsing ISO datetime format
        DateTime::parse_from_rfc3339(&end_date)
            .map(|dt| dt.naive_local().date())
            .map_err(|e| format!("Invalid end date: {}", e))
    })?;

    // Filter entries by date range
    let filtered_entries: Vec<_> = all_entries
        .into_iter()
        .filter(|e| {
            if let Ok(dt) = DateTime::parse_from_rfc3339(&e.timestamp) {
                let date = dt.naive_local().date();
                date >= start && date <= end
            } else {
                false
            }
        })
        .collect();

    if filtered_entries.is_empty() {
        return Ok(UsageStats {
            total_cost: 0.0,
            total_tokens: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_cache_creation_tokens: 0,
            total_cache_read_tokens: 0,
            total_sessions: 0,
            by_model: vec![],
            by_date: vec![],
            by_project: vec![],
        });
    }

    Ok(aggregate_stats(&filtered_entries))
}

/// Shared aggregation over a filtered entry set — the body formerly inlined
/// (verbatim) in both get_usage_stats and get_usage_by_date_range.
fn aggregate_stats(filtered_entries: &[UsageEntry]) -> UsageStats {
    let mut total_cost = 0.0;
    let mut total_input_tokens = 0u64;
    let mut total_output_tokens = 0u64;
    let mut total_cache_creation_tokens = 0u64;
    let mut total_cache_read_tokens = 0u64;

    let mut model_stats: HashMap<String, ModelUsage> = HashMap::new();
    let mut daily_stats: HashMap<String, DailyUsage> = HashMap::new();
    let mut project_stats: HashMap<String, ProjectUsage> = HashMap::new();

    for entry in filtered_entries {
        // Update totals
        total_cost += entry.cost;
        total_input_tokens += entry.input_tokens;
        total_output_tokens += entry.output_tokens;
        total_cache_creation_tokens += entry.cache_creation_tokens;
        total_cache_read_tokens += entry.cache_read_tokens;

        // Update model stats
        let model_stat = model_stats
            .entry(entry.model.clone())
            .or_insert(ModelUsage {
                model: entry.model.clone(),
                total_cost: 0.0,
                total_tokens: 0,
                input_tokens: 0,
                output_tokens: 0,
                cache_creation_tokens: 0,
                cache_read_tokens: 0,
                session_count: 0,
            });
        model_stat.total_cost += entry.cost;
        model_stat.input_tokens += entry.input_tokens;
        model_stat.output_tokens += entry.output_tokens;
        model_stat.cache_creation_tokens += entry.cache_creation_tokens;
        model_stat.cache_read_tokens += entry.cache_read_tokens;
        model_stat.total_tokens = model_stat.input_tokens + model_stat.output_tokens;
        model_stat.session_count += 1;

        // Update daily stats
        let date = entry
            .timestamp
            .split('T')
            .next()
            .unwrap_or(&entry.timestamp)
            .to_string();
        let daily_stat = daily_stats.entry(date.clone()).or_insert(DailyUsage {
            date,
            total_cost: 0.0,
            total_tokens: 0,
            models_used: vec![],
        });
        daily_stat.total_cost += entry.cost;
        daily_stat.total_tokens += entry.input_tokens
            + entry.output_tokens
            + entry.cache_creation_tokens
            + entry.cache_read_tokens;
        if !daily_stat.models_used.contains(&entry.model) {
            daily_stat.models_used.push(entry.model.clone());
        }

        // Update project stats
        let project_stat =
            project_stats
                .entry(entry.project_path.clone())
                .or_insert(ProjectUsage {
                    project_path: entry.project_path.clone(),
                    project_name: entry
                        .project_path
                        .split('/')
                        .next_back()
                        .unwrap_or(&entry.project_path)
                        .to_string(),
                    total_cost: 0.0,
                    total_tokens: 0,
                    session_count: 0,
                    last_used: entry.timestamp.clone(),
                });
        project_stat.total_cost += entry.cost;
        project_stat.total_tokens += entry.input_tokens
            + entry.output_tokens
            + entry.cache_creation_tokens
            + entry.cache_read_tokens;
        project_stat.session_count += 1;
        if entry.timestamp > project_stat.last_used {
            project_stat.last_used = entry.timestamp.clone();
        }
    }

    let total_tokens = total_input_tokens
        + total_output_tokens
        + total_cache_creation_tokens
        + total_cache_read_tokens;
    let total_sessions = filtered_entries.len() as u64;

    // Convert hashmaps to sorted vectors
    let mut by_model: Vec<ModelUsage> = model_stats.into_values().collect();
    by_model.sort_by(|a, b| b.total_cost.partial_cmp(&a.total_cost).unwrap());

    let mut by_date: Vec<DailyUsage> = daily_stats.into_values().collect();
    by_date.sort_by(|a, b| b.date.cmp(&a.date));

    let mut by_project: Vec<ProjectUsage> = project_stats.into_values().collect();
    by_project.sort_by(|a, b| b.total_cost.partial_cmp(&a.total_cost).unwrap());

    UsageStats {
        total_cost,
        total_tokens,
        total_input_tokens,
        total_output_tokens,
        total_cache_creation_tokens,
        total_cache_read_tokens,
        total_sessions,
        by_model,
        by_date,
        by_project,
    }
}

#[command]
pub async fn get_usage_details(
    project_path: Option<String>,
    date: Option<String>,
    cache: State<'_, UsageCache>,
) -> Result<Vec<UsageEntry>, String> {
    let cache = cache.inner().clone();
    tokio::task::spawn_blocking(move || compute_usage_details(project_path, date, &cache))
        .await
        .map_err(|e| format!("get_usage_details task panicked: {e}"))?
}

fn compute_usage_details(
    project_path: Option<String>,
    date: Option<String>,
    cache: &UsageCache,
) -> Result<Vec<UsageEntry>, String> {
    let claude_path = dirs::home_dir()
        .ok_or("Failed to get home directory")?
        .join(".claude");

    let mut all_entries = get_all_usage_entries(&claude_path, cache);

    // Filter by project if specified
    if let Some(project) = project_path {
        all_entries.retain(|e| e.project_path == project);
    }

    // Filter by date if specified
    if let Some(date) = date {
        all_entries.retain(|e| e.timestamp.starts_with(&date));
    }

    Ok(all_entries)
}

#[command]
pub async fn get_session_stats(
    since: Option<String>,
    until: Option<String>,
    order: Option<String>,
    cache: State<'_, UsageCache>,
) -> Result<Vec<ProjectUsage>, String> {
    let cache = cache.inner().clone();
    tokio::task::spawn_blocking(move || compute_session_stats(since, until, order, &cache))
        .await
        .map_err(|e| format!("get_session_stats task panicked: {e}"))?
}

fn compute_session_stats(
    since: Option<String>,
    until: Option<String>,
    order: Option<String>,
    cache: &UsageCache,
) -> Result<Vec<ProjectUsage>, String> {
    let claude_path = dirs::home_dir()
        .ok_or("Failed to get home directory")?
        .join(".claude");

    let all_entries = get_all_usage_entries(&claude_path, cache);

    let since_date = since.and_then(|s| NaiveDate::parse_from_str(&s, "%Y%m%d").ok());
    let until_date = until.and_then(|s| NaiveDate::parse_from_str(&s, "%Y%m%d").ok());

    let filtered_entries: Vec<_> = all_entries
        .into_iter()
        .filter(|e| {
            if let Ok(dt) = DateTime::parse_from_rfc3339(&e.timestamp) {
                let date = dt.date_naive();
                let is_after_since = since_date.is_none_or(|s| date >= s);
                let is_before_until = until_date.is_none_or(|u| date <= u);
                is_after_since && is_before_until
            } else {
                false
            }
        })
        .collect();

    let mut session_stats: HashMap<String, ProjectUsage> = HashMap::new();
    for entry in &filtered_entries {
        let session_key = format!("{}/{}", entry.project_path, entry.session_id);
        let project_stat = session_stats
            .entry(session_key)
            .or_insert_with(|| ProjectUsage {
                project_path: entry.project_path.clone(),
                project_name: entry.session_id.clone(), // Using session_id as project_name for session view
                total_cost: 0.0,
                total_tokens: 0,
                session_count: 0, // In this context, this will count entries per session
                last_used: " ".to_string(),
            });

        project_stat.total_cost += entry.cost;
        project_stat.total_tokens += entry.input_tokens
            + entry.output_tokens
            + entry.cache_creation_tokens
            + entry.cache_read_tokens;
        project_stat.session_count += 1;
        if entry.timestamp > project_stat.last_used {
            project_stat.last_used = entry.timestamp.clone();
        }
    }

    let mut by_session: Vec<ProjectUsage> = session_stats.into_values().collect();

    // Sort by last_used date
    if let Some(order_str) = order {
        if order_str == "asc" {
            by_session.sort_by(|a, b| a.last_used.cmp(&b.last_used));
        } else {
            by_session.sort_by(|a, b| b.last_used.cmp(&a.last_used));
        }
    } else {
        // Default to descending
        by_session.sort_by(|a, b| b.last_used.cmp(&a.last_used));
    }

    Ok(by_session)
}

#[cfg(test)]
mod tests {
    use super::*;
    use filetime::{FileTime, set_file_mtime};
    use std::io::Write;
    use tempfile::TempDir;

    fn write_jsonl(path: &Path, lines: &[String]) {
        let mut f = fs::File::create(path).unwrap();
        for l in lines {
            writeln!(f, "{}", l).unwrap();
        }
    }

    fn usage_line(ts: &str, msg_id: &str, req_id: &str, input: u64) -> String {
        format!(
            r#"{{"timestamp":"{ts}","requestId":"{req_id}","message":{{"id":"{msg_id}","model":"claude-opus-4","usage":{{"input_tokens":{input},"output_tokens":1}}}}}}"#
        )
    }

    fn entry_count(parsed: &ParsedFile) -> usize {
        parsed.records.iter().filter(|r| r.entry.is_some()).count()
    }

    #[test]
    fn parse_file_full_single_read_yields_entries_and_earliest() {
        // FR-T6: one read produces both the entries and the earliest timestamp,
        // replacing the former separate get_earliest_timestamp read pass.
        let dir = TempDir::new().unwrap();
        let session = dir.path().join("sess-1");
        fs::create_dir_all(&session).unwrap();
        let file = session.join("a.jsonl");
        write_jsonl(
            &file,
            &[
                usage_line("2026-05-20T10:00:00Z", "m1", "r1", 10),
                usage_line("2026-05-19T09:00:00Z", "m2", "r2", 20), // earliest
                usage_line("2026-05-21T11:00:00Z", "m3", "r3", 30),
            ],
        );

        let parsed = parse_file_full(&file, "proj");
        assert_eq!(entry_count(&parsed), 3);
        assert_eq!(
            parsed.earliest_timestamp.as_deref(),
            Some("2026-05-19T09:00:00Z"),
        );
    }

    #[test]
    fn cache_hit_on_unchanged_mtime_does_not_reread() {
        // FR-T5: a cache hit (mtime unchanged) must not re-read the file body.
        let dir = TempDir::new().unwrap();
        let session = dir.path().join("sess-1");
        fs::create_dir_all(&session).unwrap();
        let file = session.join("a.jsonl");
        write_jsonl(
            &file,
            &[
                usage_line("2026-05-20T10:00:00Z", "m1", "r1", 10),
                usage_line("2026-05-20T10:01:00Z", "m2", "r2", 20),
            ],
        );
        // Pin a deterministic mtime so set/compare round-trips exactly.
        let t0 = FileTime::from_unix_time(1_700_000_000, 0);
        set_file_mtime(&file, t0).unwrap();

        let cache = UsageCache::default();
        let first = cache.get_or_parse(&file, "proj");
        assert_eq!(entry_count(&first), 2);

        // Replace the body with nothing but restore the same mtime: the cache
        // must regard the file as unchanged and NOT re-read the empty body.
        write_jsonl(&file, &[]);
        set_file_mtime(&file, t0).unwrap();
        let cached = cache.get_or_parse(&file, "proj");
        assert_eq!(
            entry_count(&cached),
            2,
            "unchanged mtime => served from cache; the now-empty body is not re-read",
        );

        // Bump the mtime: now the file must be re-read and seen as empty.
        let t1 = FileTime::from_unix_time(1_700_000_010, 0);
        set_file_mtime(&file, t1).unwrap();
        let refreshed = cache.get_or_parse(&file, "proj");
        assert_eq!(
            entry_count(&refreshed),
            0,
            "changed mtime => re-read; empty body yields no entries",
        );
    }

    #[test]
    fn cross_file_dedup_keeps_first_occurrence() {
        // A (msg_id, req_id) shared across two files dedups to the first
        // occurrence in earliest-timestamp order.
        let dir = TempDir::new().unwrap();
        let proj = dir.path().join("projects").join("proj-a");
        let early = proj.join("sess-early");
        let late = proj.join("sess-late");
        fs::create_dir_all(&early).unwrap();
        fs::create_dir_all(&late).unwrap();
        write_jsonl(
            &early.join("e.jsonl"),
            &[usage_line("2026-05-01T00:00:00Z", "m9", "r9", 100)],
        );
        write_jsonl(
            &late.join("l.jsonl"),
            &[usage_line("2026-06-01T00:00:00Z", "m9", "r9", 999)],
        );

        let cache = UsageCache::default();
        let entries = get_all_usage_entries(dir.path(), &cache);
        assert_eq!(entries.len(), 1, "duplicate (msg_id, req_id) collapses to one");
        assert_eq!(
            entries[0].input_tokens, 100,
            "the earlier-timestamped file's occurrence wins",
        );
    }

    #[test]
    fn get_all_usage_entries_handles_missing_projects_dir() {
        let dir = TempDir::new().unwrap();
        let cache = UsageCache::default();
        assert!(get_all_usage_entries(dir.path(), &cache).is_empty());
    }
}
