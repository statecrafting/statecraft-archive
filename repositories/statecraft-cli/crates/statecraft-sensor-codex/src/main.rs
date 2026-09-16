//! `statecraft-sensor-codex` (spec 115): the Codex sensor member. A root
//! (`$CODEX_HOME`, else `~/.codex`, with the desktop's atom-state file inside
//! it), a classification table transcribed from `FINDINGS.md`, and a
//! manifest, over `statecraft-sensor-core`.

mod classify;

use std::path::PathBuf;

use statecraft_contract::{
    exit, CapabilityTier, Manifest, CONTRACT, MANIFEST_FLAG, MANIFEST_SCHEMA_VERSION,
};
use statecraft_sensor_core::verbs::{dispatch, Sensor};
use statecraft_sensor_core::{data_dir, Layout, Universe};

pub const NAME: &str = "statecraft-sensor-codex";
pub const VERBS: [&str; 8] = [
    "watch", "log", "stats", "snapshot", "diff", "explain", "peek", "daemon",
];

/// The state file inside the root (spec 115 B-2, doc 03 D32).
pub const STATE_FILE: &str = ".codex-global-state.json";

const USAGE: &str = "statecraft-sensor-codex: filesystem observability for ~/.codex

usage: statecraft sensor-codex <command> [options]

  watch [--raw] [--no-db] [--quiet]   live watch; semantic view, sqlite log
  log [--since 1h] [--path <glob>] [--kind <k>] [--action <a>] [--limit N] [--raw]
  stats [--since 1h]                  write frequency, hottest paths, churn
  snapshot [--label <s>] [--list]     record full tree state to the db
  diff <a> <b>                        compare two snapshots by id
  explain <path>                      FINDINGS.md entry plus observed history
  peek <path> [--bytes N] [--tail]    redacted content view (opt-in, read-only)
  daemon start|stop|status|plist      background watcher management
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

/// The observed root: `$CODEX_HOME` when set and non-empty, else `~/.codex`.
pub fn root_from(codex_home: Option<&str>, home: Option<&str>) -> PathBuf {
    if let Some(dir) = codex_home.filter(|d| !d.is_empty()) {
        return PathBuf::from(dir);
    }
    PathBuf::from(home.unwrap_or(".")).join(".codex")
}

/// The observed universe (B-2): the root, the state file inside it, 112's
/// ignore rule, and `auth.json` never read (B-4).
pub fn universe_at(root: PathBuf) -> Universe {
    Universe {
        state_file: root.join(STATE_FILE),
        watch_root: root,
        state_display: STATE_FILE.to_string(),
        ignored_basenames: vec![".DS_Store".to_string()],
        ignored_suffixes: vec![".swp".to_string(), ".swo".to_string(), "~".to_string()],
        never_peek: vec!["auth.json".to_string()],
    }
}

pub fn universe() -> Universe {
    let codex_home = std::env::var("CODEX_HOME").ok();
    let home = std::env::var("HOME").ok();
    universe_at(root_from(codex_home.as_deref(), home.as_deref()))
}

/// `STATECRAFT_SENSOR_FINDINGS` names the FINDINGS document; absent, the
/// crate's own when running from a checkout; else the one beside the data
/// directory; else none (B-7).
fn findings_path(layout: &Layout) -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("STATECRAFT_SENSOR_FINDINGS").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(p));
    }
    let in_crate = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("FINDINGS.md");
    if in_crate.exists() {
        return Some(in_crate);
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
    let layout = Layout::under(data_dir("sensor-codex"));
    let classifier = classify::table();
    let sensor = Sensor {
        universe: &universe,
        classifier: &classifier,
        layout: &layout,
        findings: findings_path(&layout),
        usage: USAGE,
        display_name: "sensor-codex",
        plist_label: "com.bartekus.statecraft-sensor-codex",
    };
    std::process::exit(dispatch(&sensor, &argv));
}

#[cfg(test)]
mod tests {
    use super::*;

    /// FR-002: the root and the state file.
    #[test]
    fn the_universe_is_codex_home_else_dot_codex() {
        assert_eq!(
            root_from(Some("/x/codex"), Some("/home/u")),
            PathBuf::from("/x/codex")
        );
        assert_eq!(
            root_from(Some(""), Some("/home/u")),
            PathBuf::from("/home/u/.codex")
        );
        assert_eq!(
            root_from(None, Some("/home/u")),
            PathBuf::from("/home/u/.codex")
        );
        let u = universe_at(PathBuf::from("/home/u/.codex"));
        assert!(u.state_inside_root());
        assert_eq!(u.rel(&u.state_file), ".codex-global-state.json");
        assert_eq!(
            u.rel_state_sibling(std::path::Path::new(
                "/home/u/.codex/.codex-global-state.json.bak"
            )),
            Some(".codex-global-state.json.bak".to_string())
        );
        assert!(u.is_never_peek("auth.json"));
        assert!(!u.is_never_peek("config.toml"));
    }

    /// FR-006: the manifest is a 042 manifest with this name and the verbs.
    #[test]
    fn the_manifest_parses_as_042() {
        let text = serde_json::to_string(&manifest()).unwrap();
        let parsed = Manifest::parse(text.as_bytes()).unwrap();
        assert_eq!(parsed.name, NAME);
        assert_eq!(
            parsed.verbs,
            VERBS.iter().map(|v| v.to_string()).collect::<Vec<_>>()
        );
        assert_eq!(parsed.contract, CONTRACT);
        assert_eq!(parsed.capability_tier, CapabilityTier::Basic);
    }
}
