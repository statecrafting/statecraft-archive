//! The 043 protocol as a member verb (spec 114 B-1): `session run` reads
//! one request on stdin and writes `journal`, `stream` and `result` lines
//! on stdout; `models` prints the provider's pair; the manifest wins
//! wherever it appears on argv. Exit codes follow 023 D-4.

use std::io::{Read, Write};

use serde_json::{json, Value};
use statecraft_contract::{
    exit, Manifest, ModelTier, Requirements, CONTRACT, MANIFEST_FLAG, MANIFEST_SCHEMA_VERSION,
    SESSION_REQUEST_SCHEMA_VERSION,
};

use crate::session::{run_session, KillSwitch, SessionOptions, Sink};
use crate::{resolve_model, Profile, Provider};

pub const EXIT_OK: i32 = 0;
pub const EXIT_FAILURE: i32 = 1;
pub const EXIT_USAGE: i32 = 3;

/// 042 B-3's manifest for a driver member: the tier the provider declares
/// (spec 116 B-1), the D-4 taxonomy, the two verbs.
pub fn manifest(provider: &dyn Provider, version: &str) -> Manifest {
    Manifest {
        schema_version: MANIFEST_SCHEMA_VERSION.to_string(),
        name: provider.name().to_string(),
        version: version.to_string(),
        contract: CONTRACT.to_string(),
        verbs: vec!["models".to_string(), "session".to_string()],
        capability_tier: provider.capability_tier(),
        capabilities: Some(provider.capabilities().to_vec()),
        exit_codes: exit::d4_taxonomy(),
        envelope: "ok-data".to_string(),
    }
}

/// The stage-to-tier map (040 B-2), the engine's data, printed by `models`.
pub const STAGE_MODEL_TIERS: [(&str, &str); 4] = [
    ("build", "strong"),
    ("ship", "strong"),
    ("shepherd", "fast"),
    ("verify", "fast"),
];

fn models_verb(provider: &dyn Provider, args: &[String]) -> i32 {
    let json = args.iter().any(|a| a == "--json");
    if let Some(stray) = args.iter().find(|a| *a != "--json") {
        eprintln!(
            "usage: {} models [--json] (unexpected argument \"{stray}\")",
            provider.name()
        );
        return EXIT_USAGE;
    }
    let (strong, fast) = provider.default_models();
    if json {
        let stages: serde_json::Map<String, Value> = STAGE_MODEL_TIERS
            .iter()
            .map(|(s, t)| (s.to_string(), Value::String(t.to_string())))
            .collect();
        println!(
            "{}",
            json!({"ok": true, "data": {"strong": strong, "fast": fast, "stages": stages}})
        );
        return EXIT_OK;
    }
    println!("models:  {strong} / {fast} (default)");
    for (stage, tier) in STAGE_MODEL_TIERS {
        println!("  {stage:<9}{tier}");
    }
    EXIT_OK
}

struct StdoutSink;

impl Sink for StdoutSink {
    fn journal(&mut self, kind: &str, payload: Value) {
        let mut out = std::io::stdout().lock();
        let _ = writeln!(
            out,
            "{}",
            json!({"event": "journal", "kind": kind, "payload": payload})
        );
        let _ = out.flush();
    }
    fn stream(&mut self, event: &Value) {
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "{}", json!({"event": "stream", "raw": event}));
        let _ = out.flush();
    }
}

fn parse_request(provider: &dyn Provider, text: &str) -> Result<SessionOptions, String> {
    let value: Value =
        serde_json::from_str(text).map_err(|e| format!("request: stdin is not JSON: {e}"))?;
    let obj = value
        .as_object()
        .ok_or("request: expected one JSON object")?;
    if obj.get("schemaVersion").and_then(Value::as_str) != Some(SESSION_REQUEST_SCHEMA_VERSION) {
        return Err(format!(
            "request: unsupported schemaVersion {}",
            obj.get("schemaVersion")
                .map(|v| v.to_string())
                .unwrap_or_else(|| "undefined".into())
        ));
    }
    let repo = obj
        .get("repo")
        .and_then(Value::as_str)
        .filter(|r| !r.is_empty())
        .ok_or("request: \"repo\" is required")?
        .to_string();
    let prompt = obj
        .get("prompt")
        .and_then(Value::as_str)
        .ok_or("request: \"prompt\" is required")?
        .to_string();
    let tier = match obj.get("tier") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s == "strong" => Some(ModelTier::Strong),
        Some(Value::String(s)) if s == "fast" => Some(ModelTier::Fast),
        Some(_) => return Err("request: \"tier\" must be \"strong\" or \"fast\"".to_string()),
    };
    let number = |key: &str| -> Result<Option<u64>, String> {
        match obj.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(v) => v
                .as_u64()
                .map(Some)
                .ok_or_else(|| format!("request: \"{key}\" must be a number")),
        }
    };
    let string = |key: &str| -> Result<Option<String>, String> {
        match obj.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(s)) => Ok(Some(s.clone())),
            Some(_) => Err(format!("request: \"{key}\" must be a string")),
        }
    };
    let profile = match obj.get("profile") {
        None | Some(Value::Null) => Profile {
            mode: "bypass".to_string(),
            ..Default::default()
        },
        Some(p) => Profile::from_payload(p)?,
    };
    let explicit = string("model")?;
    let model = resolve_model(provider, tier, explicit.as_deref(), &profile);
    let requirements = match obj.get("requirements") {
        None | Some(Value::Null) => Requirements::default(),
        Some(v) => serde_json::from_value::<Requirements>(v.clone())
            .map_err(|e| format!("request: \"requirements\" must name capability tokens: {e}"))?,
    };
    Ok(SessionOptions {
        repo,
        prompt,
        bin: None,
        model,
        max_turns: number("maxTurns")?,
        timeout_ms: number("timeoutMs")?,
        mcp_config_path: string("mcpConfigPath")?,
        profile,
        kill_grace_ms: number("killGraceMs")?,
        requirements,
    })
}

#[cfg(unix)]
fn install_kill_handler(kill: &KillSwitch) {
    use std::sync::OnceLock;
    static HANDLE: OnceLock<crate::session::KillHandle> = OnceLock::new();
    let _ = HANDLE.set(kill.handle());
    extern "C" fn on_signal(_: libc::c_int) {
        if let Some(h) = HANDLE.get() {
            h.fire();
        }
    }
    // SAFETY: a handler that flips an atomic.
    unsafe {
        libc::signal(libc::SIGTERM, on_signal as *const () as libc::sighandler_t);
        libc::signal(libc::SIGINT, on_signal as *const () as libc::sighandler_t);
    }
}

#[cfg(not(unix))]
fn install_kill_handler(_kill: &KillSwitch) {}

fn session_verb(provider: &dyn Provider, args: &[String]) -> i32 {
    if args.first().map(String::as_str) != Some("run") || args.len() > 1 {
        eprintln!(
            "usage: {} session run  (reads one JSON request on stdin)",
            provider.name()
        );
        return EXIT_USAGE;
    }
    let mut text = String::new();
    if std::io::stdin().read_to_string(&mut text).is_err() {
        eprintln!("error: request: stdin is not readable");
        return EXIT_USAGE;
    }
    let opts = match parse_request(provider, &text) {
        Ok(o) => o,
        Err(message) => {
            eprintln!("error: {message}");
            return EXIT_USAGE;
        }
    };
    let kill = KillSwitch::new();
    install_kill_handler(&kill);
    let mut sink = StdoutSink;
    match run_session(provider, &opts, &mut sink, &kill) {
        Ok(outcome) => {
            let mut out = std::io::stdout().lock();
            let _ = writeln!(out, "{}", json!({"event": "result", "result": outcome}));
            let _ = out.flush();
            EXIT_OK
        }
        Err(message) => {
            eprintln!("error: {message}");
            EXIT_FAILURE
        }
    }
}

/// The member's `main`: manifest first, then `models` or `session`.
pub fn main_with(provider: &dyn Provider, version: &str, argv: &[String]) -> i32 {
    if argv.iter().any(|a| a == MANIFEST_FLAG) {
        println!(
            "{}",
            serde_json::to_string(&manifest(provider, version)).expect("manifest serializes")
        );
        return EXIT_OK;
    }
    match argv.first().map(String::as_str) {
        Some("models") => models_verb(provider, &argv[1..]),
        Some("session") => session_verb(provider, &argv[1..]),
        Some(other) => {
            eprintln!(
                "usage: {} models|session run (unknown verb \"{other}\")",
                provider.name()
            );
            EXIT_USAGE
        }
        None => {
            eprintln!("usage: {} models|session run", provider.name());
            EXIT_USAGE
        }
    }
}
