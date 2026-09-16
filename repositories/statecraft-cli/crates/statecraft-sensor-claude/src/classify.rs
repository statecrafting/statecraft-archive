//! The classification table (spec 003, ported by spec 112 B-2): every rule
//! of `classify.ts` in the same order, with the same kinds and label texts.
//! An unmatched path is a discovery, not an error, and the core's fallback
//! surfaces it loudly as UNCLASSIFIED.

use regex::{Captures, Regex};
use statecraft_sensor_core::{grew_or_shrank, ClassInput, Rule, RuleTable};

fn short(uuid: &str) -> &str {
    &uuid[..uuid.len().min(8)]
}

fn cap<'a>(m: &'a Captures<'_>, i: usize) -> &'a str {
    m.get(i).map(|g| g.as_str()).unwrap_or("")
}

fn opt<'a>(m: &'a Captures<'_>, i: usize) -> Option<&'a str> {
    m.get(i).map(|g| g.as_str())
}

fn rule(kind: &'static str, re: &str, label: fn(&Captures<'_>, &ClassInput<'_>) -> String) -> Rule {
    Rule {
        kind,
        re: Regex::new(re).expect("rule pattern compiles"),
        label,
    }
}

pub fn table() -> RuleTable {
    RuleTable {
        rules: vec![
            rule(
                "transcript",
                r"^projects/([^/]+)/([0-9a-f-]{36})\.jsonl$",
                |m, c| {
                    let (project, session) = (cap(m, 1), cap(m, 2));
                    match c.action.as_str() {
                        "created" => {
                            format!("new transcript for session {} in {project}", short(session))
                        }
                        "deleted" => format!(
                            "transcript deleted: session {} in {project}",
                            short(session)
                        ),
                        _ => format!(
                            "transcript {}: session {} ({project})",
                            grew_or_shrank(c),
                            short(session)
                        ),
                    }
                },
            ),
            rule("memory", r"^projects/([^/]+)/memory(/(.*))?$", |m, c| {
                format!(
                    "memory {} {} (project {})",
                    opt(m, 3).unwrap_or("dir"),
                    c.action.as_str(),
                    cap(m, 1)
                )
            }),
            rule(
                "subagent-transcript",
                r"^projects/([^/]+)/([0-9a-f-]{36})/subagents/agent-([0-9a-f]+)\.(jsonl|meta\.json)$",
                |m, c| {
                    let agent = cap(m, 3);
                    let agent_short = &agent[..agent.len().min(8)];
                    if cap(m, 4) == "jsonl" {
                        format!(
                            "subagent transcript {}: agent {agent_short} (session {})",
                            grew_or_shrank(c),
                            short(cap(m, 2))
                        )
                    } else {
                        format!(
                            "subagent metadata {}: agent {agent_short} (session {})",
                            c.action.as_str(),
                            short(cap(m, 2))
                        )
                    }
                },
            ),
            rule(
                "tool-result",
                r"^projects/([^/]+)/([0-9a-f-]{36})/tool-results/(.+)$",
                |m, c| {
                    format!(
                        "large tool result {}: {} (session {})",
                        c.action.as_str(),
                        cap(m, 3),
                        short(cap(m, 2))
                    )
                },
            ),
            rule(
                "session-extras",
                r"^projects/([^/]+)/([0-9a-f-]{36})(/(.*))?$",
                |m, c| {
                    format!(
                        "session dir {}: {} (session {})",
                        c.action.as_str(),
                        opt(m, 4).unwrap_or("(root)"),
                        short(cap(m, 2))
                    )
                },
            ),
            rule("project-dir", r"^projects/([^/]+)$", |m, c| {
                format!("project dir {}: {}", c.action.as_str(), cap(m, 1))
            }),
            rule(
                "file-history",
                r"^file-history/([0-9a-f-]{36})(/(.*))?$",
                |m, c| match opt(m, 3) {
                    Some(file) => format!(
                        "pre-edit file snapshot {}: {file} (session {})",
                        c.action.as_str(),
                        short(cap(m, 1))
                    ),
                    None => format!(
                        "file-history bucket {} for session {}",
                        c.action.as_str(),
                        short(cap(m, 1))
                    ),
                },
            ),
            rule(
                "session-env",
                r"^session-env/([0-9a-f-]{36})(/(.*))?$",
                |m, c| match opt(m, 3) {
                    Some(file) => format!(
                        "session-env file {}: {file} (session {})",
                        c.action.as_str(),
                        short(cap(m, 1))
                    ),
                    None => format!(
                        "session-env dir {} (session {})",
                        c.action.as_str(),
                        short(cap(m, 1))
                    ),
                },
            ),
            rule(
                "task",
                r"^tasks/([0-9a-f-]{36})(/(.*))?$",
                |m, c| match opt(m, 3) {
                    Some(file) => format!(
                        "task state {}: {file} (task {})",
                        c.action.as_str(),
                        short(cap(m, 1))
                    ),
                    None => format!("task dir {} (task {})", c.action.as_str(), short(cap(m, 1))),
                },
            ),
            rule("session-registry", r"^sessions/(\d+)\.json$", |m, c| {
                format!("session registry entry {} {}", cap(m, 1), c.action.as_str())
            }),
            rule("session-registry", r"^sessions(/(.*))?$", |m, c| {
                format!("sessions/{} {}", opt(m, 2).unwrap_or(""), c.action.as_str())
            }),
            rule("paste", r"^paste-cache/([0-9a-f]{8,32})\.txt$", |m, c| {
                if c.action.as_str() == "created" {
                    format!("pasted content stored ({})", cap(m, 1))
                } else {
                    format!("paste {} {}", cap(m, 1), c.action.as_str())
                }
            }),
            rule(
                "shell-snapshot",
                r"^shell-snapshots/snapshot-([a-z]+)-(\d+)-([a-z0-9]+)\.sh$",
                |m, c| format!("shell snapshot ({}) {}", cap(m, 1), c.action.as_str()),
            ),
            rule("prompt-history", r"^history\.jsonl$", |_m, c| {
                format!("global prompt history {}", grew_or_shrank(c))
            }),
            rule(
                "state-backup",
                r"^backups/\.claude\.json\.backup\.(\d+)$",
                |_m, c| {
                    if c.action.as_str() == "created" {
                        "state file backup rotated in".to_string()
                    } else {
                        format!("state backup {}", c.action.as_str())
                    }
                },
            ),
            rule("state-backup", r"^backups$", |_m, c| {
                format!("backups dir {}", c.action.as_str())
            }),
            rule(
                "state-file",
                r"^~/\.claude\.json(\..+)?$",
                |m, c| match opt(m, 1) {
                    Some(suffix) => format!(
                        "state file temp sibling {}: ~/.claude.json{suffix}",
                        c.action.as_str()
                    ),
                    None if c.action.as_str() == "replaced" => {
                        "state file rewritten (atomic replace)".to_string()
                    }
                    None => format!("state file {} in place", c.action.as_str()),
                },
            ),
            rule("jobs", r"^jobs/pins\.json$", |_m, c| {
                format!("jobs pins.json {}", c.action.as_str())
            }),
            rule("jobs", r"^jobs(/(.*))?$", |m, c| {
                format!("jobs/{} {}", opt(m, 2).unwrap_or(""), c.action.as_str())
            }),
            rule(
                "daemon",
                r"^(daemon(/.*)?|daemon-auth-status\.json|daemon-auth-cooldown)$",
                |m, c| format!("daemon state {}: {}", c.action.as_str(), cap(m, 1)),
            ),
            rule("plugin", r"^plugins/(.*)$", |m, c| {
                format!("plugin data {}: {}", c.action.as_str(), cap(m, 1))
            }),
            rule("plugin", r"^plugins$", |_m, c| {
                format!("plugins dir {}", c.action.as_str())
            }),
            rule("hook-file", r"^hooks(/(.*))?$", |m, c| {
                format!(
                    "hook file {}: {}",
                    c.action.as_str(),
                    opt(m, 2).unwrap_or("hooks/")
                )
            }),
            rule(
                "cache",
                r"^(cache(/.*)?|stats-cache\.json|gh-pr-status-cache\.json)$",
                |m, c| format!("cache {}: {}", c.action.as_str(), cap(m, 1)),
            ),
            rule(
                "config",
                r"^(settings\.json|settings\.local\.json|keybindings\.json|CLAUDE\.md)$",
                |m, c| format!("USER CONFIG {}: {}", c.action.as_str(), cap(m, 1)),
            ),
            rule(
                "housekeeping",
                r"^(\.last-cleanup|\.last-update-result\.json)$",
                |m, c| format!("housekeeping marker {}: {}", c.action.as_str(), cap(m, 1)),
            ),
            rule("todos", r"^todos(/(.*))?$", |m, c| {
                format!(
                    "todos {}: {}",
                    c.action.as_str(),
                    opt(m, 2).unwrap_or("todos/")
                )
            }),
            // Previously-empty dirs: activity here is a discovery target, shout it.
            rule(
                "first-fill",
                r"^(telemetry|downloads|agents|skills)(/(.*))?$",
                |m, c| match opt(m, 3) {
                    Some(file) => format!(
                        "ACTIVITY IN PREVIOUSLY-EMPTY DIR {}/: {file} {}",
                        cap(m, 1),
                        c.action.as_str()
                    ),
                    None => format!("{}/ dir {}", cap(m, 1), c.action.as_str()),
                },
            ),
            rule("chrome", r"^chrome(/(.*))?$", |m, c| {
                format!(
                    "chrome extension data {}: {}",
                    c.action.as_str(),
                    opt(m, 2).unwrap_or("chrome/")
                )
            }),
            rule("root", r"^\.$", |_m, c| {
                format!("~/.claude root dir {}", c.action.as_str())
            }),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use statecraft_sensor_core::{Action, Classifier};

    fn run(path: &str, action: Action, kind: &str, delta: Option<i64>) -> (String, String) {
        let c = table().classify(&ClassInput {
            rel_path: path,
            action,
            entry_kind: kind,
            delta,
        });
        (c.kind, c.label)
    }

    /// `(path, action, entry kind, delta, expected kind, expected label)`.
    type Case = (
        String,
        Action,
        &'static str,
        Option<i64>,
        &'static str,
        String,
    );

    /// FR-002: one example per rule, with the kind and label `classify.ts`
    /// produces for it.
    #[test]
    fn every_rule_classifies_its_example_as_the_typescript_table_does() {
        let s = "0123abcd-1111-2222-3333-444444444444";
        let cases: Vec<Case> = vec![
            (
                format!("projects/p/{s}.jsonl"),
                Action::Created,
                "file",
                Some(10),
                "transcript",
                "new transcript for session 0123abcd in p".into(),
            ),
            (
                format!("projects/p/{s}.jsonl"),
                Action::Modified,
                "file",
                Some(-4),
                "transcript",
                "transcript SHRANK: session 0123abcd (p)".into(),
            ),
            (
                format!("projects/p/{s}.jsonl"),
                Action::Deleted,
                "file",
                Some(-10),
                "transcript",
                "transcript deleted: session 0123abcd in p".into(),
            ),
            (
                "projects/p/memory/notes.md".to_string(),
                Action::Modified,
                "file",
                Some(0),
                "memory",
                "memory notes.md modified (project p)".into(),
            ),
            (
                "projects/p/memory".to_string(),
                Action::Created,
                "dir",
                Some(0),
                "memory",
                "memory dir created (project p)".into(),
            ),
            (
                format!("projects/p/{s}/subagents/agent-abcdef0123.jsonl"),
                Action::Modified,
                "file",
                Some(3),
                "subagent-transcript",
                "subagent transcript grew: agent abcdef01 (session 0123abcd)".into(),
            ),
            (
                format!("projects/p/{s}/subagents/agent-abcdef0123.meta.json"),
                Action::Created,
                "file",
                Some(3),
                "subagent-transcript",
                "subagent metadata created: agent abcdef01 (session 0123abcd)".into(),
            ),
            (
                format!("projects/p/{s}/tool-results/big.txt"),
                Action::Created,
                "file",
                Some(3),
                "tool-result",
                "large tool result created: big.txt (session 0123abcd)".into(),
            ),
            (
                format!("projects/p/{s}/x/y"),
                Action::Deleted,
                "file",
                None,
                "session-extras",
                "session dir deleted: x/y (session 0123abcd)".into(),
            ),
            (
                format!("projects/p/{s}"),
                Action::Created,
                "dir",
                Some(0),
                "session-extras",
                "session dir created: (root) (session 0123abcd)".into(),
            ),
            (
                "projects/p".to_string(),
                Action::Created,
                "dir",
                Some(0),
                "project-dir",
                "project dir created: p".into(),
            ),
            (
                format!("file-history/{s}/a.ts"),
                Action::Created,
                "file",
                Some(1),
                "file-history",
                "pre-edit file snapshot created: a.ts (session 0123abcd)".into(),
            ),
            (
                format!("file-history/{s}"),
                Action::Created,
                "dir",
                Some(0),
                "file-history",
                "file-history bucket created for session 0123abcd".into(),
            ),
            (
                format!("session-env/{s}/env"),
                Action::Modified,
                "file",
                Some(1),
                "session-env",
                "session-env file modified: env (session 0123abcd)".into(),
            ),
            (
                format!("session-env/{s}"),
                Action::Deleted,
                "dir",
                Some(0),
                "session-env",
                "session-env dir deleted (session 0123abcd)".into(),
            ),
            (
                format!("tasks/{s}/state.json"),
                Action::Modified,
                "file",
                Some(2),
                "task",
                "task state modified: state.json (task 0123abcd)".into(),
            ),
            (
                format!("tasks/{s}"),
                Action::Created,
                "dir",
                Some(0),
                "task",
                "task dir created (task 0123abcd)".into(),
            ),
            (
                "sessions/42.json".to_string(),
                Action::Replaced,
                "file",
                Some(0),
                "session-registry",
                "session registry entry 42 replaced".into(),
            ),
            (
                "sessions/other".to_string(),
                Action::Created,
                "file",
                Some(0),
                "session-registry",
                "sessions/other created".into(),
            ),
            (
                "sessions".to_string(),
                Action::Created,
                "dir",
                Some(0),
                "session-registry",
                "sessions/ created".into(),
            ),
            (
                "paste-cache/abcdef12.txt".to_string(),
                Action::Created,
                "file",
                Some(9),
                "paste",
                "pasted content stored (abcdef12)".into(),
            ),
            (
                "paste-cache/abcdef12.txt".to_string(),
                Action::Deleted,
                "file",
                Some(-9),
                "paste",
                "paste abcdef12 deleted".into(),
            ),
            (
                "shell-snapshots/snapshot-zsh-1700-abc123.sh".to_string(),
                Action::Created,
                "file",
                Some(1),
                "shell-snapshot",
                "shell snapshot (zsh) created".into(),
            ),
            (
                "history.jsonl".to_string(),
                Action::Modified,
                "file",
                Some(120),
                "prompt-history",
                "global prompt history grew".into(),
            ),
            (
                "backups/.claude.json.backup.17".to_string(),
                Action::Created,
                "file",
                Some(5),
                "state-backup",
                "state file backup rotated in".into(),
            ),
            (
                "backups".to_string(),
                Action::Created,
                "dir",
                Some(0),
                "state-backup",
                "backups dir created".into(),
            ),
            (
                "~/.claude.json".to_string(),
                Action::Replaced,
                "file",
                Some(0),
                "state-file",
                "state file rewritten (atomic replace)".into(),
            ),
            (
                "~/.claude.json".to_string(),
                Action::Modified,
                "file",
                Some(1),
                "state-file",
                "state file modified in place".into(),
            ),
            (
                "~/.claude.json.tmp".to_string(),
                Action::Created,
                "file",
                Some(1),
                "state-file",
                "state file temp sibling created: ~/.claude.json.tmp".into(),
            ),
            (
                "jobs/pins.json".to_string(),
                Action::Modified,
                "file",
                Some(0),
                "jobs",
                "jobs pins.json modified".into(),
            ),
            (
                "jobs/other".to_string(),
                Action::Created,
                "file",
                Some(0),
                "jobs",
                "jobs/other created".into(),
            ),
            (
                "daemon/lock".to_string(),
                Action::Created,
                "file",
                Some(0),
                "daemon",
                "daemon state created: daemon/lock".into(),
            ),
            (
                "daemon-auth-cooldown".to_string(),
                Action::Deleted,
                "file",
                Some(0),
                "daemon",
                "daemon state deleted: daemon-auth-cooldown".into(),
            ),
            (
                "plugins/x/y".to_string(),
                Action::Created,
                "file",
                Some(0),
                "plugin",
                "plugin data created: x/y".into(),
            ),
            (
                "plugins".to_string(),
                Action::Created,
                "dir",
                Some(0),
                "plugin",
                "plugins dir created".into(),
            ),
            (
                "hooks/pre.sh".to_string(),
                Action::Modified,
                "file",
                Some(0),
                "hook-file",
                "hook file modified: pre.sh".into(),
            ),
            (
                "hooks".to_string(),
                Action::Created,
                "dir",
                Some(0),
                "hook-file",
                "hook file created: hooks/".into(),
            ),
            (
                "stats-cache.json".to_string(),
                Action::Modified,
                "file",
                Some(0),
                "cache",
                "cache modified: stats-cache.json".into(),
            ),
            (
                "cache/a".to_string(),
                Action::Created,
                "file",
                Some(0),
                "cache",
                "cache created: cache/a".into(),
            ),
            (
                "settings.json".to_string(),
                Action::Modified,
                "file",
                Some(0),
                "config",
                "USER CONFIG modified: settings.json".into(),
            ),
            (
                ".last-cleanup".to_string(),
                Action::Replaced,
                "file",
                Some(0),
                "housekeeping",
                "housekeeping marker replaced: .last-cleanup".into(),
            ),
            (
                "todos/a.json".to_string(),
                Action::Created,
                "file",
                Some(0),
                "todos",
                "todos created: a.json".into(),
            ),
            (
                "todos".to_string(),
                Action::Created,
                "dir",
                Some(0),
                "todos",
                "todos created: todos/".into(),
            ),
            (
                "skills/new/SKILL.md".to_string(),
                Action::Created,
                "file",
                Some(0),
                "first-fill",
                "ACTIVITY IN PREVIOUSLY-EMPTY DIR skills/: new/SKILL.md created".into(),
            ),
            (
                "telemetry".to_string(),
                Action::Created,
                "dir",
                Some(0),
                "first-fill",
                "telemetry/ dir created".into(),
            ),
            (
                "chrome/x".to_string(),
                Action::Created,
                "file",
                Some(0),
                "chrome",
                "chrome extension data created: x".into(),
            ),
            (
                "chrome".to_string(),
                Action::Created,
                "dir",
                Some(0),
                "chrome",
                "chrome extension data created: chrome/".into(),
            ),
            (
                ".".to_string(),
                Action::Modified,
                "dir",
                Some(0),
                "root",
                "~/.claude root dir modified".into(),
            ),
            (
                "something/new".to_string(),
                Action::Created,
                "file",
                Some(1),
                "unclassified",
                "UNCLASSIFIED: something/new created (file)".into(),
            ),
        ];
        for (path, action, entry_kind, delta, kind, label) in cases {
            assert_eq!(
                run(&path, action, entry_kind, delta),
                (kind.to_string(), label),
                "{path}"
            );
        }
    }
}
