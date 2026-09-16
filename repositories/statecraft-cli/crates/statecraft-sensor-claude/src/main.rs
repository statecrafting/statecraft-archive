//! `statecraft-sensor-claude` (spec 112 B-2): the Claude Code sensor member.
//! A root (`~/.claude` and `~/.claude.json`), a classification table, a
//! FINDINGS document and a manifest, over `statecraft-sensor-core`.

mod classify;

use std::path::PathBuf;

use statecraft_contract::{
    exit, CapabilityTier, Manifest, CONTRACT, MANIFEST_FLAG, MANIFEST_SCHEMA_VERSION,
};
use statecraft_sensor_core::verbs::{dispatch, Sensor};
use statecraft_sensor_core::{data_dir, Layout, Universe};

pub const NAME: &str = "statecraft-sensor-claude";
pub const VERBS: [&str; 8] = [
    "watch", "log", "stats", "snapshot", "diff", "explain", "peek", "daemon",
];

const USAGE: &str = "claude-observatory: filesystem observability for ~/.claude

usage: observatory <command> [options]

  watch [--raw] [--no-db] [--quiet]   live watch; semantic view, sqlite log
  log [--since 1h] [--path <glob>] [--kind <k>] [--action <a>] [--limit N] [--raw]
  stats [--since 1h]                  write frequency, hottest paths, churn
  snapshot [--label <s>] [--list]     record full tree state to the db
  diff <a> <b>                        compare two snapshots by id
  explain <path>                      FINDINGS.md entry plus observed history
  peek <path> [--bytes N] [--tail]    redacted content view (opt-in, read-only)
  daemon start|stop|status|plist      background watcher management
  orchestrator <command>              orchestrator control plane (status, dag, daemon, ...)
  models [--json]                     the session model each stage runs on (spec 040)
";

/// The 042 manifest: the sensor's declared taxonomy, `basic` tier.
pub fn manifest() -> Manifest {
    Manifest {
        schema_version: MANIFEST_SCHEMA_VERSION.to_string(),
        name: NAME.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        contract: CONTRACT.to_string(),
        verbs: VERBS.iter().map(|v| v.to_string()).collect(),
        capability_tier: CapabilityTier::Basic,
        // Spec 120 B-2: a sensor or journal member supports no session token.
        capabilities: Some(Vec::new()),
        exit_codes: exit::sensor_taxonomy(),
        envelope: "ok-data".to_string(),
    }
}

/// The observed universe: `~/.claude` and its sibling `~/.claude.json`.
pub fn universe() -> Universe {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    Universe {
        watch_root: home.join(".claude"),
        state_file: home.join(".claude.json"),
        state_display: "~/.claude.json".to_string(),
        ignored_basenames: vec![".DS_Store".to_string()],
        ignored_suffixes: vec![".swp".to_string(), ".swo".to_string(), "~".to_string()],
        never_peek: vec![],
    }
}

/// `STATECRAFT_SENSOR_FINDINGS` names the FINDINGS document; absent, the
/// one beside the data directory, else none.
fn findings_path(layout: &Layout) -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("STATECRAFT_SENSOR_FINDINGS").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(p));
    }
    let beside = layout.data_dir.join("FINDINGS.md");
    beside.exists().then_some(beside)
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    // 042 B-3: the manifest wins wherever it appears, before any other flag.
    if argv.iter().any(|a| a == MANIFEST_FLAG) {
        println!(
            "{}",
            serde_json::to_string(&manifest()).expect("manifest serializes")
        );
        std::process::exit(0);
    }
    let universe = universe();
    let layout = Layout::under(data_dir("sensor-claude"));
    let classifier = classify::table();
    let sensor = Sensor {
        universe: &universe,
        classifier: &classifier,
        layout: &layout,
        findings: findings_path(&layout),
        usage: USAGE,
        display_name: "observatory",
        plist_label: "com.bartekus.claude-observatory",
    };
    std::process::exit(dispatch(&sensor, &argv));
}
