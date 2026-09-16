//! The Codex classification table (spec 115 B-6): first match wins, every
//! rule transcribed from an entry of `FINDINGS.md` and citing it by heading
//! (doc 03 D31). An unmatched path is a discovery, not an error, and the
//! core's fallback surfaces it loudly as UNCLASSIFIED.

use regex::{Captures, Regex};
use statecraft_sensor_core::{grew_or_shrank, ClassInput, Rule, RuleTable};

fn short(id: &str) -> &str {
    &id[..id.len().min(8)]
}

fn cap<'a>(m: &'a Captures<'_>, i: usize) -> &'a str {
    m.get(i).map(|g| g.as_str()).unwrap_or("")
}

/// One rule and the FINDINGS heading it transcribes.
pub struct Cited {
    pub rule: Rule,
    /// The FINDINGS heading (B-1); read by the citation test (FR-003), which
    /// is the point of carrying it, so the binary itself never reads it.
    #[cfg_attr(not(test), allow(dead_code))]
    pub findings: &'static str,
}

fn cited(
    kind: &'static str,
    findings: &'static str,
    re: &str,
    label: fn(&Captures<'_>, &ClassInput<'_>) -> String,
) -> Cited {
    Cited {
        rule: Rule {
            kind,
            re: Regex::new(re).expect("rule pattern compiles"),
            label,
        },
        findings,
    }
}

/// The verb a size delta earns for a file whose shrink is routine: a WAL or
/// a database truncated at checkpoint never shouts.
fn grew_or_checkpointed(c: &ClassInput<'_>) -> &'static str {
    match c.delta {
        Some(d) if d < 0 => "checkpointed",
        _ => grew_or_shrank(c),
    }
}

/// Every rule with its citation, in evaluation order.
pub fn rules() -> Vec<Cited> {
    vec![
        cited(
            "transcript",
            "sessions/<yyyy>/<mm>/<dd>/rollout-<ts>-<id>.jsonl",
            r"^sessions/\d{4}/\d{2}/\d{2}/rollout-([0-9T-]+)-([0-9a-f-]{36})\.jsonl$",
            |m, c| {
                let id = short(cap(m, 2));
                match c.action.as_str() {
                    "created" => format!("new rollout for thread {id}"),
                    "deleted" => format!("rollout deleted: thread {id}"),
                    _ => format!("rollout {}: thread {id}", grew_or_shrank(c)),
                }
            },
        ),
        cited(
            "transcript-dir",
            "sessions/",
            r"^sessions(/.*)?$",
            |_, c| format!("sessions container {} ({})", c.action.as_str(), c.rel_path),
        ),
        cited(
            "sqlite-wal",
            "<name>_<n>.sqlite-wal",
            r"^(sqlite/)?([A-Za-z_-]+?)(?:_(\d+))?\.(sqlite|db)-wal$",
            |m, c| format!("wal {}: {}", grew_or_checkpointed(c), cap(m, 2)),
        ),
        cited(
            "sqlite-shm",
            "<name>_<n>.sqlite-shm",
            r"^(sqlite/)?([A-Za-z_-]+?)(?:_(\d+))?\.(sqlite|db)-shm$",
            |m, c| format!("wal index {}: {}", c.action.as_str(), cap(m, 2)),
        ),
        cited(
            "sqlite",
            "<name>_<n>.sqlite",
            r"^(sqlite/)?([A-Za-z_-]+?)(?:_(\d+))?\.(sqlite|db)$",
            |m, c| {
                let generation = m.get(3).map(|g| g.as_str());
                let name = match generation {
                    Some(n) => format!("{} (generation {n})", cap(m, 2)),
                    None => cap(m, 2).to_string(),
                };
                match c.action.as_str() {
                    "created" => format!("new database: {name}"),
                    "deleted" => format!("database deleted: {name}"),
                    _ => format!("database {}: {name}", grew_or_checkpointed(c)),
                }
            },
        ),
        cited("sqlite-dir", "sqlite/codex-dev.db", r"^sqlite$", |_, c| {
            format!("desktop database directory {}", c.action.as_str())
        }),
        cited(
            "state-backup",
            ".codex-global-state.json.bak",
            r"^\.codex-global-state\.json\.bak$",
            |_, c| format!("state backup {}", c.action.as_str()),
        ),
        cited(
            "state-file",
            ".codex-global-state.json",
            r"^\.codex-global-state\.json(\..+)?$",
            |m, c| {
                if !cap(m, 1).is_empty() {
                    return format!(
                        "state file temp sibling {} ({})",
                        c.action.as_str(),
                        c.rel_path
                    );
                }
                match c.action.as_str() {
                    "replaced" => "state file rewritten (atomic replace)".to_string(),
                    other => format!("state file {other}"),
                }
            },
        ),
        cited("config", "config.toml", r"^config\.toml$", |_, c| {
            match (c.action.as_str(), c.delta) {
                ("modified", Some(d)) if d > 0 => {
                    "config appended by the tool (project trust or hook trust)".to_string()
                }
                ("replaced", _) => "config rewritten (editor or settings flow)".to_string(),
                (other, _) => format!("config {other}"),
            }
        }),
        cited("hook-file", "hooks.json", r"^hooks\.json$", |_, c| {
            format!("hook table {}", c.action.as_str())
        }),
        cited("hook-file", "hooks/", r"^hooks(/(.*))?$", |m, c| {
            format!(
                "hook script {} ({})",
                c.action.as_str(),
                if cap(m, 2).is_empty() {
                    "dir"
                } else {
                    cap(m, 2)
                }
            )
        }),
        cited("instructions", "AGENTS.md", r"^AGENTS\.md$", |_, c| {
            format!("global instructions {}", c.action.as_str())
        }),
        cited("skill", "skills/", r"^skills(/(.*))?$", |m, c| {
            format!(
                "skill {} ({})",
                c.action.as_str(),
                if cap(m, 2).is_empty() {
                    "dir"
                } else {
                    cap(m, 2)
                }
            )
        }),
        cited("plugin", "plugins/", r"^plugins(/(.*))?$", |m, c| {
            format!(
                "plugin cache {} ({})",
                c.action.as_str(),
                if cap(m, 2).is_empty() {
                    "dir"
                } else {
                    cap(m, 2)
                }
            )
        }),
        cited("marketplace", ".tmp/", r"^\.tmp(/(.*))?$", |m, c| {
            format!(
                "app scratch {} ({})",
                c.action.as_str(),
                if cap(m, 2).is_empty() {
                    "dir"
                } else {
                    cap(m, 2)
                }
            )
        }),
        cited("cache", "cache/", r"^cache(/(.*))?$", |m, c| {
            format!(
                "cache {} ({})",
                c.action.as_str(),
                if cap(m, 2).is_empty() {
                    "dir"
                } else {
                    cap(m, 2)
                }
            )
        }),
        cited("secret", "auth.json", r"^auth\.json$", |_, c| {
            format!("credentials {} (never read)", c.action.as_str())
        }),
        cited(
            "identity",
            "installation_id",
            r"^installation_id$",
            |_, c| format!("installation id {}", c.action.as_str()),
        ),
        cited(
            "catalog",
            "models_cache.json",
            r"^models_cache\.json$",
            |_, c| format!("model catalogue {}", c.action.as_str()),
        ),
        cited(
            "import",
            "external_agent_session_imports.json",
            r"^external_agent_session_imports\.json$",
            |_, c| format!("external session import record {}", c.action.as_str()),
        ),
        cited(
            "import",
            "vendor_imports/",
            r"^vendor_imports(/(.*))?$",
            |_, c| format!("vendor import {} ({})", c.action.as_str(), c.rel_path),
        ),
        cited(
            "bundle",
            "computer-use/",
            r"^computer-use(/(.*))?$",
            |_, c| format!("app bundle {} ({})", c.action.as_str(), c.rel_path),
        ),
        cited("shim", "tmp/arg0/", r"^tmp/arg0(/(.*))?$", |_, c| {
            format!("sandbox shim {} ({})", c.action.as_str(), c.rel_path)
        }),
        cited("shim", "tmp/path/", r"^tmp(/path(/.*)?)?$", |_, c| {
            format!("sandbox path shim {} ({})", c.action.as_str(), c.rel_path)
        }),
        cited(
            "shell-snapshot",
            "shell_snapshots/",
            r"^shell_snapshots(/(.*))?$",
            |_, c| format!("shell snapshot {} ({})", c.action.as_str(), c.rel_path),
        ),
        cited("daemon", "ipc/", r"^ipc(/(.*))?$", |_, c| {
            format!("ipc {} ({})", c.action.as_str(), c.rel_path)
        }),
        cited(
            "daemon",
            "thread-writer-locks/",
            r"^thread-writer-locks(/(.*))?$",
            |_, c| format!("writer lock {} ({})", c.action.as_str(), c.rel_path),
        ),
        cited(
            "suggestion",
            "ambient-suggestions/",
            r"^ambient-suggestions(/(.*))?$",
            |_, c| format!("ambient suggestion {} ({})", c.action.as_str(), c.rel_path),
        ),
        cited("memory", "memories/", r"^memories(/(.*))?$", |_, c| {
            format!("memory {} ({})", c.action.as_str(), c.rel_path)
        }),
        cited(
            "housekeeping",
            ".personality_migration",
            r"^\.personality_migration$",
            |_, c| format!("migration marker {} ({})", c.action.as_str(), c.rel_path),
        ),
        cited(
            "housekeeping",
            ".sandbox_migration",
            r"^\.sandbox_migration$",
            |_, c| format!("migration marker {} ({})", c.action.as_str(), c.rel_path),
        ),
        cited("root", ".", r"^\.$", |_, c| {
            format!(
                "root directory {} (a top-level entry appeared or vanished)",
                c.action.as_str()
            )
        }),
    ]
}

pub fn table() -> RuleTable {
    RuleTable {
        rules: rules().into_iter().map(|c| c.rule).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use statecraft_sensor_core::{Action, Classifier};

    fn input<'a>(path: &'a str, action: Action, delta: Option<i64>) -> ClassInput<'a> {
        ClassInput {
            rel_path: path,
            action,
            entry_kind: "file",
            delta,
        }
    }

    /// FR-001: one example per rule, from FINDINGS, to the promised kind and label.
    #[test]
    fn every_rule_classifies_its_own_example() {
        let t = table();
        let cases: Vec<(&str, Action, Option<i64>, &str, &str)> = vec![
            ("sessions/2026/09/09/rollout-2026-09-09T11-56-50-01a08750-bdaa-79f0-90b5-bc60371a2f53.jsonl", Action::Created, Some(30000), "transcript", "new rollout for thread 01a08750"),
            ("sessions/2026/09/09/rollout-2026-09-09T11-56-50-01a08750-bdaa-79f0-90b5-bc60371a2f53.jsonl", Action::Modified, Some(512), "transcript", "rollout grew: thread 01a08750"),
            ("sessions/2026/09/09", Action::Modified, None, "transcript-dir", "sessions container modified (sessions/2026/09/09)"),
            ("goals_1.sqlite-wal", Action::Modified, Some(8240), "sqlite-wal", "wal grew: goals"),
            ("logs_2.sqlite-wal", Action::Modified, Some(-200000), "sqlite-wal", "wal checkpointed: logs"),
            ("state_5.sqlite-shm", Action::Created, Some(32768), "sqlite-shm", "wal index created: state"),
            ("thread_history_1.sqlite", Action::Created, Some(40960), "sqlite", "new database: thread_history (generation 1)"),
            ("logs_2.sqlite", Action::Modified, Some(0), "sqlite", "database modified: logs (generation 2)"),
            ("logs_2.sqlite", Action::Modified, Some(-4096), "sqlite", "database checkpointed: logs (generation 2)"),
            ("sqlite/codex-dev.db-wal", Action::Modified, Some(100), "sqlite-wal", "wal grew: codex-dev"),
            ("sqlite/codex-dev.db", Action::Modified, Some(4096), "sqlite", "database grew: codex-dev"),
            ("sqlite", Action::Modified, None, "sqlite-dir", "desktop database directory modified"),
            (".codex-global-state.json.bak", Action::Replaced, Some(0), "state-backup", "state backup replaced"),
            (".codex-global-state.json", Action::Replaced, Some(12), "state-file", "state file rewritten (atomic replace)"),
            (".codex-global-state.json.tmp", Action::Created, Some(12), "state-file", "state file temp sibling created (.codex-global-state.json.tmp)"),
            ("config.toml", Action::Modified, Some(150), "config", "config appended by the tool (project trust or hook trust)"),
            ("config.toml", Action::Replaced, Some(-3), "config", "config rewritten (editor or settings flow)"),
            ("hooks.json", Action::Modified, Some(0), "hook-file", "hook table modified"),
            ("hooks/no-em-dash.py", Action::Modified, Some(10), "hook-file", "hook script modified (no-em-dash.py)"),
            ("AGENTS.md", Action::Modified, Some(5), "instructions", "global instructions modified"),
            ("skills/.system/x/SKILL.md", Action::Created, Some(5), "skill", "skill created (.system/x/SKILL.md)"),
            ("plugins/cache/openai-bundled/browser/1/README.md", Action::Replaced, Some(0), "plugin", "plugin cache replaced (cache/openai-bundled/browser/1/README.md)"),
            (".tmp/marketplaces/claude-plugins-official/.git/HEAD", Action::Modified, Some(0), "marketplace", "app scratch modified (marketplaces/claude-plugins-official/.git/HEAD)"),
            ("cache/codex_apps_tools/ef60.json", Action::Replaced, Some(0), "cache", "cache replaced (codex_apps_tools/ef60.json)"),
            ("auth.json", Action::Replaced, Some(0), "secret", "credentials replaced (never read)"),
            ("installation_id", Action::Modified, Some(0), "identity", "installation id modified"),
            ("models_cache.json", Action::Modified, Some(0), "catalog", "model catalogue modified"),
            ("external_agent_session_imports.json", Action::Modified, Some(400), "import", "external session import record modified"),
            ("vendor_imports/skills-curated-cache.json", Action::Modified, Some(1), "import", "vendor import modified (vendor_imports/skills-curated-cache.json)"),
            ("computer-use/Codex Computer Use.app/Contents/Info.plist", Action::Modified, Some(1), "bundle", "app bundle modified (computer-use/Codex Computer Use.app/Contents/Info.plist)"),
            ("tmp/arg0/codex-arg0NF13r8/path", Action::Created, None, "shim", "sandbox shim created (tmp/arg0/codex-arg0NF13r8/path)"),
            ("tmp/path", Action::Modified, None, "shim", "sandbox path shim modified (tmp/path)"),
            ("shell_snapshots/abc.123.sh", Action::Created, Some(9), "shell-snapshot", "shell snapshot created (shell_snapshots/abc.123.sh)"),
            ("ipc/ipc.sock", Action::Created, Some(0), "daemon", "ipc created (ipc/ipc.sock)"),
            ("thread-writer-locks/.coordination.lock", Action::Modified, Some(0), "daemon", "writer lock modified (thread-writer-locks/.coordination.lock)"),
            ("ambient-suggestions/f7953fbd", Action::Created, Some(3), "suggestion", "ambient suggestion created (ambient-suggestions/f7953fbd)"),
            ("memories/x.md", Action::Created, Some(3), "memory", "memory created (memories/x.md)"),
            (".personality_migration", Action::Modified, Some(0), "housekeeping", "migration marker modified (.personality_migration)"),
            (".sandbox_migration", Action::Modified, Some(0), "housekeeping", "migration marker modified (.sandbox_migration)"),
            (".", Action::Modified, None, "root", "root directory modified (a top-level entry appeared or vanished)"),
        ];
        for (path, action, delta, kind, label) in cases {
            let c = t.classify(&input(path, action, delta));
            assert_eq!(
                (c.kind.as_str(), c.label.as_str()),
                (kind, label),
                "path {path}"
            );
        }
        let unknown = t.classify(&input("brand-new-thing.json", Action::Created, Some(1)));
        assert_eq!(unknown.kind, "unclassified");
        assert_eq!(
            unknown.label,
            "UNCLASSIFIED: brand-new-thing.json created (file)"
        );
    }

    /// FR-003: every rule's citation is a FINDINGS heading.
    #[test]
    fn every_rule_cites_a_findings_entry() {
        let findings = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("FINDINGS.md"),
        )
        .unwrap();
        for c in rules() {
            let heading = format!("## `{}`", c.findings);
            assert!(
                findings.contains(&heading),
                "rule {} cites {:?}, which is not a FINDINGS heading",
                c.rule.kind,
                c.findings
            );
        }
    }
}
