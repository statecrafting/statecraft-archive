//! `statecraft-driver-claude` (spec 114 B-2): the Claude Code driver member.
//! The argv (014 B-1 with 032 B-3's derivation), the env scrub (014 B-2),
//! the stream-json parser, the transcript path, the model pair (040 B-3)
//! and the rule table (014 B-4), over `statecraft-driver-core`.

use std::collections::BTreeMap;
use std::path::Path;

use serde_json::{json, Value};
use statecraft_contract::CHILD_ENV_DENY;
use statecraft_driver_core::classify::{Rule, TerminationKind};
use statecraft_driver_core::{ProviderEvent, ResultEvent, SpawnSpec};

pub const NAME: &str = "statecraft-driver-claude";
pub const BIN_ENV: &str = "STATECRAFT_CLAUDE_BIN";

// 032 D-2's baseline for a guarded profile that names no list.
pub const GUARDED_BASELINE_ALLOWED_TOOLS: [&str; 9] = [
    "Bash(git:*)",
    "Bash(gh:*)",
    "Bash(bun:*)",
    "Bash(spec-spine:*)",
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
];

pub struct Claude {
    rules: Vec<Rule>,
}

impl Claude {
    pub fn new() -> Claude {
        Claude {
            // 014 B-4: order is priority. auth before quota so an expired
            // token whose message mentions rate limits still reads as auth.
            rules: vec![
                Rule::new(
                    TerminationKind::Auth,
                    r"(?i)authentication[_ ]error|permission[_ ]error|invalid[^a-z]*(x-)?api[^a-z]*key|unauthorized|forbidden|oauth.*(invalid|expired|revoked|missing)",
                ),
                Rule::new(
                    TerminationKind::Quota,
                    r"(?i)usage limit|rate.?limit|limit reached|quota|too many requests|429",
                ),
                Rule::new(
                    TerminationKind::HookBlocked,
                    r"(?i)hook.*(blocked|denied|exit code 2)|PreToolUse.*blocked|\[pr-gate\] BLOCKED",
                ),
                Rule::new(
                    TerminationKind::Transient,
                    r"(?i)overloaded|internal server error|5\d\d|network|ECONNRESET|ETIMEDOUT|timeout.*api",
                ),
            ],
        }
    }
}

impl Default for Claude {
    fn default() -> Self {
        Self::new()
    }
}

/// 032 B-3: one flag and its value as one argv element, so an operator's
/// list can only ever be read as a value.
fn flag_value(flag: &str, value: &str) -> String {
    format!("{flag}={value}")
}

impl statecraft_driver_core::Provider for Claude {
    fn name(&self) -> &'static str {
        NAME
    }

    fn default_bin(&self) -> &'static str {
        "claude"
    }

    fn bin_env_var(&self) -> &'static str {
        BIN_ENV
    }

    fn argv(&self, spec: &SpawnSpec<'_>) -> Vec<String> {
        let mut args: Vec<String> = vec![
            "-p".into(),
            "--output-format".into(),
            "stream-json".into(),
            "--verbose".into(),
        ];
        // The permission portion, 032 B-3's one derivation.
        if spec.profile.mode == "bypass" {
            args.push("--dangerously-skip-permissions".into());
        } else {
            args.push(flag_value("--permission-mode", "acceptEdits"));
            let allowed: Vec<String> = match &spec.profile.allowed_tools {
                Some(list) => list.clone(),
                None => GUARDED_BASELINE_ALLOWED_TOOLS
                    .iter()
                    .map(|s| s.to_string())
                    .collect(),
            };
            if !allowed.is_empty() {
                args.push(flag_value("--allowed-tools", &allowed.join(",")));
            }
            if let Some(disallowed) = &spec.profile.disallowed_tools {
                if !disallowed.is_empty() {
                    args.push(flag_value("--disallowed-tools", &disallowed.join(",")));
                }
            }
        }
        if let Some(model) = spec.model {
            args.push("--model".into());
            args.push(model.into());
        }
        if let Some(n) = spec.max_turns {
            args.push("--max-turns".into());
            args.push(n.to_string());
        }
        if let Some(path) = spec.mcp_config_path {
            args.push("--mcp-config".into());
            args.push(path.into());
            args.push("--strict-mcp-config".into());
        }
        args
    }

    fn child_env(&self, parent: &BTreeMap<String, String>) -> BTreeMap<String, String> {
        // 014 B-2: an empty or unset key must not shadow OAuth, and no color.
        // 121 B-3: the deny list is the contract's, the same on both sides.
        let mut env: BTreeMap<String, String> = parent
            .iter()
            .filter(|(k, _)| !CHILD_ENV_DENY.contains(&k.as_str()))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        env.insert("NO_COLOR".into(), "1".into());
        env
    }

    fn parse_event(&self, event: &Value) -> ProviderEvent {
        let Some(obj) = event.as_object() else {
            return ProviderEvent::Other;
        };
        let kind = obj.get("type").and_then(Value::as_str);
        let subtype = obj.get("subtype").and_then(Value::as_str);
        let session_id = obj
            .get("session_id")
            .and_then(Value::as_str)
            .map(String::from);
        match (kind, subtype) {
            (Some("system"), Some("init")) => ProviderEvent::Init { session_id },
            (Some("result"), _) => ProviderEvent::Result(ResultEvent {
                is_error: obj
                    .get("is_error")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                subtype: subtype.map(String::from),
                result_text: obj.get("result").and_then(Value::as_str).map(String::from),
                session_id,
                total_cost_usd: obj.get("total_cost_usd").and_then(Value::as_f64),
                usage: obj.get("usage").cloned(),
                num_turns: obj.get("num_turns").and_then(Value::as_u64),
            }),
            _ => ProviderEvent::Other,
        }
    }

    /// Spec 119 B-5: a `user` event whose tool_result is flagged is_error
    /// and reads as a hook refusal (the hook-blocked rule's own pattern).
    /// An ordinary failing tool is not a denial; the model's prose never is.
    fn denial_in_event(&self, event: &Value) -> Option<String> {
        let obj = event.as_object()?;
        if obj.get("type").and_then(Value::as_str) != Some("user") {
            return None;
        }
        let content = obj.get("message")?.get("content")?.as_array()?;
        let rule = self
            .rules
            .iter()
            .find(|r| r.kind == TerminationKind::HookBlocked)?;
        for item in content {
            let item = item.as_object()?;
            if item.get("type").and_then(Value::as_str) != Some("tool_result")
                || item.get("is_error").and_then(Value::as_bool) != Some(true)
            {
                continue;
            }
            let text = tool_result_text(item.get("content"));
            if rule.pattern.is_match(&text) {
                return Some(text);
            }
        }
        None
    }

    /// Claude Code writes transcripts under
    /// `~/.claude/projects/<cwd with "/" and "." replaced by "-">/<id>.jsonl`.
    /// Computed only; `~/.claude` is observed, never written.
    fn transcript_path(&self, repo: &str, session_id: &str) -> Option<String> {
        let home = std::env::var("HOME").ok()?;
        let slug: String = repo
            .chars()
            .map(|c| if c == '/' || c == '.' { '-' } else { c })
            .collect();
        Some(
            Path::new(&home)
                .join(".claude")
                .join("projects")
                .join(slug)
                .join(format!("{session_id}.jsonl"))
                .to_string_lossy()
                .into_owned(),
        )
    }

    fn default_models(&self) -> (&'static str, &'static str) {
        ("claude-opus-5", "claude-sonnet-5")
    }

    fn termination_rules(&self) -> &[Rule] {
        &self.rules
    }

    fn init_extras(&self, bin: &str) -> Value {
        json!({ "claudeBin": bin })
    }

    /// The stream-json subtype that means `--max-turns` was hit (014 B-4).
    fn max_turns_subtype(&self) -> Option<&'static str> {
        Some("error_max_turns")
    }
}

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let provider = Claude::new();
    std::process::exit(statecraft_driver_core::protocol::main_with(
        &provider,
        env!("CARGO_PKG_VERSION"),
        &argv,
    ));
}

/// A tool_result's content is a string or a list of text parts.
fn tool_result_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use statecraft_driver_core::{Capability, CapabilityTier, Requirements};
    use statecraft_driver_core::{Profile, Provider};

    static NONE: Requirements = Requirements {
        required: Vec::new(),
        preferred: Vec::new(),
    };

    #[test]
    fn argv_is_032s_derivation_byte_for_byte() {
        let c = Claude::new();
        let bypass = Profile {
            mode: "bypass".into(),
            ..Default::default()
        };
        let spec = SpawnSpec {
            profile: &bypass,
            model: Some("m"),
            max_turns: Some(3),
            mcp_config_path: Some("/x/mcp.json"),
            requirements: &NONE,
        };
        // Spec 120 B-2, B-6: every request token this request uses is
        // applied, and hook enforcement rides along; the tier is reference.
        assert_eq!(
            c.applied(&spec),
            vec![
                Capability::MaxTurns,
                Capability::McpConfig,
                Capability::Cost,
                Capability::HookEnforcement
            ]
        );
        assert_eq!(c.capability_tier(), CapabilityTier::Reference);
        assert!(!c.capabilities().contains(&Capability::WorkspaceWrite));
        assert_eq!(
            c.argv(&spec),
            vec![
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--dangerously-skip-permissions",
                "--model",
                "m",
                "--max-turns",
                "3",
                "--mcp-config",
                "/x/mcp.json",
                "--strict-mcp-config"
            ]
        );
        let guarded = Profile {
            mode: "guarded".into(),
            allowed_tools: Some(vec!["Read".into(), "Bash(git:*)".into()]),
            disallowed_tools: Some(vec!["WebFetch".into()]),
            models: None,
            driver: None,
            require: None,
        };
        let spec = SpawnSpec {
            profile: &guarded,
            model: None,
            max_turns: None,
            mcp_config_path: None,
            requirements: &NONE,
        };
        assert_eq!(
            c.argv(&spec),
            vec![
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--permission-mode=acceptEdits",
                "--allowed-tools=Read,Bash(git:*)",
                "--disallowed-tools=WebFetch"
            ]
        );
        let baseline = Profile {
            mode: "guarded".into(),
            ..Default::default()
        };
        let spec = SpawnSpec {
            profile: &baseline,
            model: None,
            max_turns: None,
            mcp_config_path: None,
            requirements: &NONE,
        };
        assert!(c.argv(&spec).contains(&"--allowed-tools=Bash(git:*),Bash(gh:*),Bash(bun:*),Bash(spec-spine:*),Read,Write,Edit,Glob,Grep".to_string()));
    }

    #[test]
    fn env_scrub_and_transcript_slug() {
        let c = Claude::new();
        let parent: BTreeMap<String, String> = [
            ("ANTHROPIC_API_KEY", "x"),
            ("OPENAI_API_KEY", "y"),
            ("PATH", "/bin"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        let env = c.child_env(&parent);
        assert!(!env.contains_key("ANTHROPIC_API_KEY"));
        // 121 B-3, 122 B-7: the deny list is the contract's, all four names.
        assert!(!env.contains_key("OPENAI_API_KEY"));
        assert_eq!(CHILD_ENV_DENY.len(), 6);
        assert!(CHILD_ENV_DENY.contains(&"GH_TOKEN") && CHILD_ENV_DENY.contains(&"GITHUB_TOKEN"));
        // 125 B-4: the ssh agent is the reach a token name cannot close.
        assert!(
            CHILD_ENV_DENY.contains(&"SSH_AUTH_SOCK") && CHILD_ENV_DENY.contains(&"SSH_AGENT_PID")
        );
        assert_eq!(env.get("NO_COLOR").map(String::as_str), Some("1"));
        assert_eq!(env.get("PATH").map(String::as_str), Some("/bin"));
        std::env::set_var("HOME", "/home/u");
        assert_eq!(
            c.transcript_path("/work/a.b", "sess").as_deref(),
            Some("/home/u/.claude/projects/-work-a-b/sess.jsonl")
        );
    }

    #[test]
    fn the_stream_json_parser_and_the_rule_table() {
        let c = Claude::new();
        assert_eq!(
            c.parse_event(&json!({"type": "system", "subtype": "init", "session_id": "s"})),
            ProviderEvent::Init {
                session_id: Some("s".into())
            }
        );
        assert!(matches!(
            c.parse_event(&json!({"type": "assistant"})),
            ProviderEvent::Other
        ));
        let r = c.parse_event(&json!({"type": "result", "subtype": "success", "is_error": false, "result": "DONE", "total_cost_usd": 0.5, "num_turns": 2}));
        let ProviderEvent::Result(r) = r else {
            panic!("result")
        };
        assert_eq!(r.total_cost_usd, Some(0.5));
        assert_eq!(r.num_turns, Some(2));
        let cases = [
            ("authentication_error", TerminationKind::Auth),
            ("OAuth token expired", TerminationKind::Auth),
            ("You have hit your usage limit", TerminationKind::Quota),
            ("HTTP 429 too many requests", TerminationKind::Quota),
            (
                "PreToolUse hook blocked the call",
                TerminationKind::HookBlocked,
            ),
            ("[pr-gate] BLOCKED: stale", TerminationKind::HookBlocked),
            ("API overloaded, retry", TerminationKind::Transient),
            ("ECONNRESET", TerminationKind::Transient),
        ];
        for (text, kind) in cases {
            let hit = c
                .termination_rules()
                .iter()
                .find(|r| r.pattern.is_match(text))
                .map(|r| r.kind);
            assert_eq!(hit, Some(kind), "{text}");
        }
    }
    #[test]
    fn a_denial_is_a_flagged_tool_result_that_reads_as_a_hook_refusal_and_nothing_else() {
        let c = Claude::new();
        let denied = json!({"type": "user", "message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "t1", "is_error": true,
             "content": "Bash operation blocked by hook:\n- [pr-gate] BLOCKED: stale"}]}});
        assert!(c
            .denial_in_event(&denied)
            .unwrap()
            .contains("[pr-gate] BLOCKED"));
        let parts = json!({"type": "user", "message": {"content": [
            {"type": "tool_result", "is_error": true, "content": [{"type": "text", "text": "hook denied"}]}]}});
        assert_eq!(c.denial_in_event(&parts), Some("hook denied".to_string()));
        // An ordinary failing tool, a passing tool that quotes the word, and
        // the model's prose are not denials (119 D-3).
        let failing = json!({"type": "user", "message": {"content": [
            {"type": "tool_result", "is_error": true, "content": "cargo test: 1 failed"}]}});
        assert_eq!(c.denial_in_event(&failing), None);
        let quoted = json!({"type": "user", "message": {"content": [
            {"type": "tool_result", "is_error": false, "content": "PreToolUse hook blocked nothing"}]}});
        assert_eq!(c.denial_in_event(&quoted), None);
        let prose = json!({"type": "assistant", "message": {"content": [
            {"type": "text", "text": "the hook blocked me: [pr-gate] BLOCKED"}]}});
        assert_eq!(c.denial_in_event(&prose), None);
        assert!(c.denials_in_stderr("anything").is_empty());
    }
}
