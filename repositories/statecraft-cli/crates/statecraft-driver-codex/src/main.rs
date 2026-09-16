//! `statecraft-driver-codex` (spec 116): the Codex driver member. One
//! `Provider` over `statecraft-driver-core`: `codex exec --json` with the
//! prompt on stdin, the posture mapped onto Codex's sandbox flags (doc 03
//! D35), the stream parsed into the core's init and result boundaries, the
//! transcript found by its thread id, the model pair, the termination table
//! transcribed from the binary's own vocabulary (D36), and the tier and the
//! degradations the driver declares rather than hides (D34).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Value};
use statecraft_contract::CHILD_ENV_DENY;
use statecraft_driver_core::{
    Capability, Provider, ProviderEvent, ResultEvent, Rule, SpawnSpec, TerminationKind,
};

pub const NAME: &str = "statecraft-driver-codex";
pub const BIN_ENV: &str = "STATECRAFT_CODEX_BIN";
pub const DEFAULT_BIN: &str = "codex";
/// The tool router's log line for a command a PreToolUse hook refused
/// (118 status note, observed live on 2026-09-09).
const CODEX_ROUTER_DENIAL: &str =
    "codex_core::tools::router: error=Command blocked by PreToolUse hook";
pub const MODELS: (&str, &str) = ("gpt-6-astra", "gpt-5.6-luna");

/// The parser's memory (D-2): Codex's final text and its error message
/// arrive on lines before the one that ends the turn.
#[derive(Default)]
struct Remembered {
    last_message: Option<String>,
    last_error: Option<String>,
}

pub struct Codex {
    rules: Vec<Rule>,
    remembered: Mutex<Remembered>,
}

impl Codex {
    pub fn new() -> Codex {
        Codex {
            // B-7, D36: order is priority, auth before quota as 014 B-4 has it.
            rules: vec![
                Rule::new(
                    TerminationKind::Auth,
                    r"(?i)not logged in|codex login|unauthorized|auth required|access token could not be refreshed|\b401\b",
                ),
                Rule::new(
                    TerminationKind::Quota,
                    r"(?i)hit your usage limit|usage_limit_exceeded|rate_limit_exceeded|rate.?limit|\b429\b|too many requests",
                ),
                Rule::new(
                    TerminationKind::HookBlocked,
                    r"(?i)blocked by PreToolUse hook|blocked by hook|blocked by policy",
                ),
                Rule::new(
                    TerminationKind::Transient,
                    r"(?i)stream disconnected|server_overloaded|http_connection_failed|response_stream_connection_failed|reconnecting|\b50[23]\b",
                ),
            ],
            remembered: Mutex::new(Remembered::default()),
        }
    }

    /// B-8: what the request made this driver give up, in a fixed order.
    /// Since spec 120 B-6 the core derives it as the tokens the request
    /// uses minus `applied`; this is the same list, kept for the test that
    /// pins 116's order.
    pub fn degradations(spec: &SpawnSpec<'_>) -> Vec<&'static str> {
        let applied = Codex::new().applied(spec);
        spec.requested()
            .into_iter()
            .filter(|c| !applied.contains(c))
            .map(Capability::as_str)
            .collect()
    }

    /// B-5: the rollout under `<home>/sessions/<yyyy>/<mm>/<dd>/` whose name
    /// ends in the thread id, without opening any database.
    pub fn find_rollout(codex_home: &Path, thread_id: &str) -> Option<PathBuf> {
        let suffix = format!("-{thread_id}.jsonl");
        let sessions = codex_home.join("sessions");
        let mut days = Vec::new();
        for year in read_dirs(&sessions) {
            for month in read_dirs(&year) {
                for day in read_dirs(&month) {
                    days.push(day);
                }
            }
        }
        days.sort();
        for day in days.into_iter().rev() {
            let Ok(entries) = std::fs::read_dir(&day) else {
                continue;
            };
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name.starts_with("rollout-") && name.ends_with(&suffix) {
                    return Some(entry.path());
                }
            }
        }
        None
    }
}

fn read_dirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect()
}

/// `$CODEX_HOME`, else `~/.codex` (115 B-2).
pub fn codex_home(codex_home: Option<&str>, home: Option<&str>) -> PathBuf {
    if let Some(dir) = codex_home.filter(|d| !d.is_empty()) {
        return PathBuf::from(dir);
    }
    PathBuf::from(home.unwrap_or(".")).join(".codex")
}

impl Default for Codex {
    fn default() -> Self {
        Self::new()
    }
}

impl Provider for Codex {
    fn name(&self) -> &'static str {
        NAME
    }

    fn default_bin(&self) -> &'static str {
        DEFAULT_BIN
    }

    fn bin_env_var(&self) -> &'static str {
        BIN_ENV
    }

    /// B-2, D35: `exec --json --color never`, the posture, the model, `-`.
    fn argv(&self, spec: &SpawnSpec<'_>) -> Vec<String> {
        let mut argv: Vec<String> = ["exec", "--json", "--color", "never"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        if spec.profile.mode == "bypass" {
            argv.push("--dangerously-bypass-approvals-and-sandbox".to_string());
        } else {
            argv.push("--sandbox".to_string());
            argv.push("workspace-write".to_string());
        }
        // Spec 118 B-4: a project's hooks run only when trusted, else they
        // are skipped silently; a driven session over a governed checkout
        // needs its PR gate, so the hooks the checkout declares run.
        argv.push("--dangerously-bypass-hook-trust".to_string());
        if let Some(model) = spec.model {
            argv.push("-m".to_string());
            argv.push(model.to_string());
        }
        argv.push("-".to_string());
        argv
    }

    /// B-3: the OpenAI key leaves so `auth.json` decides; colors off.
    fn child_env(&self, parent: &BTreeMap<String, String>) -> BTreeMap<String, String> {
        // 121 B-3: the deny list is the contract's, the same on both sides.
        let mut env = parent.clone();
        for key in CHILD_ENV_DENY {
            env.remove(key);
        }
        env.insert("NO_COLOR".to_string(), "1".to_string());
        env
    }

    /// B-4: the four events that mark a boundary; the rest streams verbatim.
    fn parse_event(&self, event: &Value) -> ProviderEvent {
        let Some(obj) = event.as_object() else {
            return ProviderEvent::Other;
        };
        let kind = obj.get("type").and_then(Value::as_str);
        let mut mem = self.remembered.lock().unwrap_or_else(|e| e.into_inner());
        match kind {
            Some("thread.started") => ProviderEvent::Init {
                session_id: obj
                    .get("thread_id")
                    .and_then(Value::as_str)
                    .map(String::from),
            },
            Some("item.completed") => {
                if let Some(item) = obj.get("item").and_then(Value::as_object) {
                    match item.get("type").and_then(Value::as_str) {
                        Some("agent_message") => {
                            mem.last_message =
                                item.get("text").and_then(Value::as_str).map(String::from);
                        }
                        Some("error") => {
                            mem.last_error = item
                                .get("message")
                                .and_then(Value::as_str)
                                .map(String::from);
                        }
                        _ => {}
                    }
                }
                ProviderEvent::Other
            }
            Some("error") => {
                mem.last_error = obj.get("message").and_then(Value::as_str).map(String::from);
                ProviderEvent::Other
            }
            Some("turn.completed") => ProviderEvent::Result(ResultEvent {
                is_error: false,
                subtype: Some("completed".to_string()),
                result_text: mem.last_message.clone(),
                session_id: None,
                total_cost_usd: None,
                usage: obj.get("usage").cloned(),
                num_turns: None,
            }),
            Some("turn.failed") => {
                let own = obj
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(Value::as_str)
                    .map(String::from);
                ProviderEvent::Result(ResultEvent {
                    is_error: true,
                    subtype: Some("failed".to_string()),
                    result_text: own.or_else(|| mem.last_error.clone()),
                    session_id: None,
                    total_cost_usd: None,
                    usage: None,
                    num_turns: None,
                })
            }
            _ => ProviderEvent::Other,
        }
    }

    /// Spec 119 B-5: a completed `command_execution` item whose output reads
    /// as a hook refusal (the hook-blocked rule's own pattern). The agent's
    /// message quoting the refusal is prose and is never read here.
    fn denial_in_event(&self, event: &Value) -> Option<String> {
        let obj = event.as_object()?;
        if obj.get("type").and_then(Value::as_str) != Some("item.completed") {
            return None;
        }
        let item = obj.get("item")?.as_object()?;
        if item.get("type").and_then(Value::as_str) != Some("command_execution") {
            return None;
        }
        let output = item
            .get("aggregated_output")
            .or_else(|| item.get("output"))
            .and_then(Value::as_str)?;
        let rule = self
            .rules
            .iter()
            .find(|r| r.kind == TerminationKind::HookBlocked)?;
        rule.pattern.is_match(output).then(|| output.to_string())
    }

    /// Spec 119 D-6: what 118 observed on a live refusal is the tool
    /// router's log line on stderr, one per blocked command; the stream
    /// carried only the agent's own message. Read over the bounded tail.
    fn denials_in_stderr(&self, stderr_tail: &str) -> Vec<String> {
        stderr_tail
            .lines()
            .filter(|line| line.contains(CODEX_ROUTER_DENIAL))
            .map(|line| line.trim().to_string())
            .collect()
    }

    /// B-5: found, not computed; `~/.codex` is observed, never written.
    fn transcript_path(&self, _repo: &str, session_id: &str) -> Option<String> {
        let home = codex_home(
            std::env::var("CODEX_HOME").ok().as_deref(),
            std::env::var("HOME").ok().as_deref(),
        );
        Codex::find_rollout(&home, session_id).map(|p| p.to_string_lossy().into_owned())
    }

    fn default_models(&self) -> (&'static str, &'static str) {
        MODELS
    }

    fn termination_rules(&self) -> &[Rule] {
        &self.rules
    }

    fn init_extras(&self, bin: &str) -> Value {
        json!({ "codexBin": bin })
    }

    /// Spec 120 B-2 (116 B-8, D34 before it): no tool allowlist, no turn
    /// cap, no MCP file, no cost; the sandbox confines writes and the
    /// hooks run by 118 B-4's flag. The tier derives to `basic`.
    fn capabilities(&self) -> &'static [Capability] {
        &[Capability::WorkspaceWrite, Capability::HookEnforcement]
    }

    /// Spec 120 B-6: `workspace-write` under `guarded` (the sandbox flag),
    /// `hook-enforcement` always.
    fn applied(&self, spec: &SpawnSpec<'_>) -> Vec<Capability> {
        let mut applied = vec![Capability::HookEnforcement];
        if spec.profile.mode != "bypass" {
            applied.push(Capability::WorkspaceWrite);
        }
        Capability::ordered(&applied)
    }
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let provider = Codex::new();
    std::process::exit(statecraft_driver_core::protocol::main_with(
        &provider,
        env!("CARGO_PKG_VERSION"),
        &argv,
    ));
}

#[cfg(test)]
mod tests {
    use super::*;
    use statecraft_driver_core::classify::{classify, ClassifyInput};
    use statecraft_driver_core::Profile;
    use statecraft_driver_core::{CapabilityTier, Requirements};

    fn profile(mode: &str, allowed: Option<Vec<&str>>) -> Profile {
        Profile {
            mode: mode.to_string(),
            allowed_tools: allowed.map(|v| v.into_iter().map(String::from).collect()),
            disallowed_tools: None,
            models: None,
            driver: None,
            require: None,
        }
    }

    fn spec<'a>(
        profile: &'a Profile,
        model: Option<&'a str>,
        max_turns: Option<u64>,
        mcp: Option<&'a str>,
    ) -> SpawnSpec<'a> {
        SpawnSpec {
            profile,
            model,
            max_turns,
            mcp_config_path: mcp,
            requirements: &NO_REQUIREMENTS,
        }
    }
    static NO_REQUIREMENTS: Requirements = Requirements {
        required: Vec::new(),
        preferred: Vec::new(),
    };

    /// FR-001: argv for both postures, with and without a model.
    #[test]
    fn argv_maps_the_posture_onto_codex_flags() {
        let c = Codex::new();
        let bypass = profile("bypass", None);
        assert_eq!(
            c.argv(&spec(&bypass, None, None, None)),
            vec![
                "exec",
                "--json",
                "--color",
                "never",
                "--dangerously-bypass-approvals-and-sandbox",
                "--dangerously-bypass-hook-trust",
                "-"
            ]
        );
        let guarded = profile("guarded", Some(vec!["Read"]));
        assert_eq!(
            c.argv(&spec(&guarded, Some("gpt-5.6-luna"), Some(4), None)),
            vec![
                "exec",
                "--json",
                "--color",
                "never",
                "--sandbox",
                "workspace-write",
                "--dangerously-bypass-hook-trust",
                "-m",
                "gpt-5.6-luna",
                "-"
            ]
        );
    }

    /// FR-001: the env scrub.
    #[test]
    fn the_child_env_drops_the_key_and_sets_no_color() {
        let c = Codex::new();
        let mut parent = BTreeMap::new();
        parent.insert("OPENAI_API_KEY".to_string(), "sk-x".to_string());
        parent.insert("ANTHROPIC_API_KEY".to_string(), "sk-a".to_string());
        parent.insert("HOME".to_string(), "/h".to_string());
        let env = c.child_env(&parent);
        assert!(!env.contains_key("OPENAI_API_KEY"));
        // 121 B-3, 122 B-7: the deny list is the contract's, all four names.
        assert!(!env.contains_key("ANTHROPIC_API_KEY"));
        parent.insert("GH_TOKEN".to_string(), "gh".to_string());
        assert!(!c.child_env(&parent).contains_key("GH_TOKEN"));
        assert_eq!(env.get("NO_COLOR").map(String::as_str), Some("1"));
        assert_eq!(env.get("HOME").map(String::as_str), Some("/h"));
    }

    /// FR-001: the degradation list for each trigger (B-8).
    #[test]
    fn degradations_are_declared_in_order() {
        let plain = profile("bypass", None);
        assert_eq!(
            Codex::degradations(&spec(&plain, None, None, None)),
            vec!["cost"]
        );
        let listed = profile("guarded", Some(vec!["Read"]));
        assert_eq!(
            Codex::degradations(&spec(&listed, None, Some(3), Some("/m.json"))),
            vec!["tool-allowlist", "max-turns", "mcp-config", "cost"]
        );
        let c = Codex::new();
        assert_eq!(
            Codex::degradations(&spec(&plain, None, Some(1), None)),
            vec!["max-turns", "cost"]
        );
        // Spec 120 B-2, B-6: two tokens supported, applied by posture.
        assert_eq!(c.capability_tier(), CapabilityTier::Basic);
        assert_eq!(
            c.applied(&spec(&plain, None, None, None)),
            vec![Capability::HookEnforcement]
        );
        assert_eq!(
            c.applied(&spec(&listed, None, None, None)),
            vec![Capability::WorkspaceWrite, Capability::HookEnforcement]
        );
        assert_eq!(c.max_turns_subtype(), None);
    }

    fn feed(c: &Codex, lines: &[&str]) -> Vec<ProviderEvent> {
        lines
            .iter()
            .map(|l| c.parse_event(&serde_json::from_str::<Value>(l).unwrap()))
            .collect()
    }

    /// FR-001: the parser over doc 03's captured streams.
    #[test]
    fn the_parser_reads_the_captured_streams() {
        // Capture 1: a completed turn.
        let c = Codex::new();
        let events = feed(
            &c,
            &[
                r#"{"type":"thread.started","thread_id":"01a08750-bdaa-79f0-90b5-bc60371a2f53"}"#,
                r#"{"type":"turn.started"}"#,
                r#"{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}"#,
                r#"{"type":"turn.completed","usage":{"input_tokens":18242,"cached_input_tokens":12928,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}"#,
            ],
        );
        assert_eq!(
            events[0],
            ProviderEvent::Init {
                session_id: Some("01a08750-bdaa-79f0-90b5-bc60371a2f53".into())
            }
        );
        assert_eq!(events[1], ProviderEvent::Other);
        assert_eq!(events[2], ProviderEvent::Other);
        let ProviderEvent::Result(r) = &events[3] else {
            panic!("turn.completed is a result");
        };
        assert!(!r.is_error);
        assert_eq!(r.subtype.as_deref(), Some("completed"));
        assert_eq!(r.result_text.as_deref(), Some("pong"));
        assert_eq!(r.usage.as_ref().unwrap()["output_tokens"], json!(5));
        assert_eq!(r.total_cost_usd, None);
        assert_eq!(r.num_turns, None);

        // Capture 2: a command in the middle; the last message wins.
        let c = Codex::new();
        let events = feed(
            &c,
            &[
                r#"{"type":"thread.started","thread_id":"t2"}"#,
                r#"{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I will run it.\n"}}"#,
                r#"{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc 'echo hi > note.txt'","aggregated_output":"","exit_code":null,"status":"in_progress"}}"#,
                r#"{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc 'echo hi > note.txt'","aggregated_output":"","exit_code":0,"status":"completed"}}"#,
                r#"{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"done"}}"#,
                r#"{"type":"turn.completed","usage":{"input_tokens":37365,"cached_input_tokens":31360,"cache_write_input_tokens":0,"output_tokens":49,"reasoning_output_tokens":0}}"#,
            ],
        );
        let ProviderEvent::Result(r) = &events[5] else {
            panic!("turn.completed is a result");
        };
        assert_eq!(r.result_text.as_deref(), Some("done"));

        // Capture 3: an error item, then error, then turn.failed.
        let c = Codex::new();
        let events = feed(
            &c,
            &[
                r#"{"type":"thread.started","thread_id":"t3"}"#,
                r#"{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Model metadata for `no-such-model-xyz` not found."}}"#,
                r#"{"type":"turn.started"}"#,
                r#"{"type":"error","message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'no-such-model-xyz' model is not supported\"}}"}"#,
                r#"{"type":"turn.failed","error":{"message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'no-such-model-xyz' model is not supported\"}}"}}"#,
            ],
        );
        let ProviderEvent::Result(r) = &events[4] else {
            panic!("turn.failed is a result");
        };
        assert!(r.is_error);
        assert_eq!(r.subtype.as_deref(), Some("failed"));
        assert!(r.result_text.as_deref().unwrap().contains("not supported"));

        // A turn.failed with no message of its own falls back to the last error.
        let c = Codex::new();
        let events = feed(
            &c,
            &[
                r#"{"type":"error","message":"stream disconnected before completion"}"#,
                r#"{"type":"turn.failed","error":{}}"#,
            ],
        );
        let ProviderEvent::Result(r) = &events[1] else {
            panic!("turn.failed is a result");
        };
        assert_eq!(
            r.result_text.as_deref(),
            Some("stream disconnected before completion")
        );
    }

    /// FR-001: the transcript walk over a fixture sessions tree (B-5).
    #[test]
    fn the_transcript_is_found_by_thread_id() {
        let dir = std::env::temp_dir().join(format!("driver-codex-home-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let day = dir.join("sessions/2026/09/09");
        std::fs::create_dir_all(&day).unwrap();
        let want =
            day.join("rollout-2026-09-09T11-56-50-01a08750-bdaa-79f0-90b5-bc60371a2f53.jsonl");
        std::fs::write(&want, b"{}").unwrap();
        std::fs::write(day.join("rollout-2026-09-09T11-57-36-other.jsonl"), b"{}").unwrap();
        assert_eq!(
            Codex::find_rollout(&dir, "01a08750-bdaa-79f0-90b5-bc60371a2f53"),
            Some(want)
        );
        assert_eq!(Codex::find_rollout(&dir, "missing"), None);
        assert_eq!(codex_home(Some("/x"), Some("/h")), PathBuf::from("/x"));
        assert_eq!(codex_home(None, Some("/h")), PathBuf::from("/h/.codex"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn classify_text(c: &Codex, text: &str) -> statecraft_driver_core::classify::Classification {
        let event = ResultEvent {
            is_error: true,
            subtype: Some("failed".into()),
            result_text: Some(text.into()),
            ..ResultEvent::default()
        };
        classify(
            &ClassifyInput {
                exit_code: Some(1),
                result_event: Some(&event),
                stderr_tail: "",
                timed_out: false,
                shutdown_killed: false,
                max_turns_subtype: c.max_turns_subtype(),
            },
            c.termination_rules(),
            1_700_000_000_000,
        )
    }

    /// FR-001: every rule matches its example (D36) and the reset extracts.
    #[test]
    fn every_rule_matches_its_example() {
        let c = Codex::new();
        let cases = [
            ("Auth: Not logged in", TerminationKind::Auth),
            ("run codex login to use ChatGPT", TerminationKind::Auth),
            (
                "Your access token could not be refreshed",
                TerminationKind::Auth,
            ),
            ("HTTP 401 unauthorized", TerminationKind::Auth),
            (
                "You've hit your usage limit. Try again at 3:00 pm.",
                TerminationKind::Quota,
            ),
            ("usage_limit_exceeded", TerminationKind::Quota),
            ("rate limit exceeded: 429", TerminationKind::Quota),
            (
                "Command blocked by PreToolUse hook: no",
                TerminationKind::HookBlocked,
            ),
            (
                "\"git push\" was blocked by policy.",
                TerminationKind::HookBlocked,
            ),
            (
                "stream disconnected before completion",
                TerminationKind::Transient,
            ),
            ("server_overloaded", TerminationKind::Transient),
            ("HTTP 503 from upstream", TerminationKind::Transient),
            ("context_window_exceeded", TerminationKind::Crashed),
        ];
        for (text, kind) in cases {
            assert_eq!(classify_text(&c, text).kind, kind, "{text}");
        }
        let quota = classify_text(&c, "You've hit your usage limit. Try again at 3:00 pm.");
        assert_eq!(quota.reset_at_ms, Some(1_700_060_400_000));
    }
    #[test]
    fn a_denial_is_a_refused_command_item_or_the_routers_stderr_line_never_the_agents_message() {
        let c = Codex::new();
        let item = json!({"type": "item.completed", "item": {"id": "i1", "type": "command_execution",
            "command": "gh pr create", "aggregated_output": "Command blocked by PreToolUse hook: [pr-gate] BLOCKED",
            "exit_code": 2, "status": "failed"}});
        assert!(c
            .denial_in_event(&item)
            .unwrap()
            .contains("blocked by PreToolUse hook"));
        let plain_failure = json!({"type": "item.completed", "item": {"type": "command_execution",
            "aggregated_output": "cargo test: 1 failed", "exit_code": 101, "status": "failed"}});
        assert_eq!(c.denial_in_event(&plain_failure), None);
        // The agent quoting the refusal is prose (119 D-3); 118 saw exactly
        // this message on the stream and it is not what is counted.
        let message = json!({"type": "item.completed", "item": {"type": "agent_message",
            "text": "Command blocked by PreToolUse hook: [pr-gate] BLOCKED"}});
        assert_eq!(c.denial_in_event(&message), None);
        // What 118 observed the harness itself write: the router's log line.
        let stderr = format!(
            "2026-09-09T00:00:00Z  INFO codex_core: starting\n2026-09-09T00:00:01Z ERROR {CODEX_ROUTER_DENIAL}\nother noise\n"
        );
        let found = c.denials_in_stderr(&stderr);
        assert_eq!(found.len(), 1);
        assert!(found[0].contains("blocked by PreToolUse hook"));
        assert!(c.denials_in_stderr("no refusals here").is_empty());
    }
}
