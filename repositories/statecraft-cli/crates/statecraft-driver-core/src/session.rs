//! `run_session` (spec 014 B-1, B-3, B-5, B-6 with the provider removed):
//! a fresh child per attempt, the prompt on stdin, the stdout stream
//! parsed line by line through the provider, a wall-clock deadline
//! enforced SIGTERM then SIGKILL, and a result the engine journals.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::classify::{classify, Classification, ClassifyInput};
use crate::{Capability, Profile, Provider, ProviderEvent, Requirements, ResultEvent, SpawnSpec};

pub const DEFAULT_TIMEOUT_MS: u64 = 30 * 60 * 1000;
pub const KILL_GRACE_MS: u64 = 5000;
pub const PIPE_DRAIN_GRACE_MS: u64 = 2000;
pub const STDERR_TAIL_BYTES: usize = 16 * 1024;
pub const OVERFLOW_LINE_CAP: usize = 256;
/// Spec 119 B-5: how many denial samples ride on the result, and how long
/// each may be. session.ts carries the same two numbers.
pub const DENIAL_SAMPLE_CAP: usize = 3;
pub const DENIAL_SAMPLE_BYTES: usize = 512;

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// What a caller asks for: 014's `RunSessionOptions` minus the callbacks.
#[derive(Clone, Debug)]
pub struct SessionOptions {
    pub repo: String,
    pub prompt: String,
    pub bin: Option<String>,
    pub model: Option<String>,
    pub max_turns: Option<u64>,
    pub timeout_ms: Option<u64>,
    pub mcp_config_path: Option<String>,
    pub profile: Profile,
    pub kill_grace_ms: Option<u64>,
    /// Spec 120 B-3; empty when the request carried none.
    pub requirements: Requirements,
}

/// Where the events go: one append (kind, payload) for the chain, every
/// parsed provider line for the sink.
pub trait Sink {
    fn journal(&mut self, kind: &str, payload: Value);
    fn stream(&mut self, event: &Value);
}

/// 014's `SessionResult`, as the contract crate carries it.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOutcome {
    pub classification: Classification,
    pub exit_code: Option<i64>,
    pub duration_ms: u64,
    pub num_turns: Option<u64>,
    pub cost_micro_usd: Option<i64>,
    pub usage: Option<BTreeMap<String, i64>>,
    pub session_id: Option<String>,
    pub transcript_path: Option<String>,
    pub overflow: Overflow,
    pub stderr_tail: String,
    /// Spec 119 B-5: refusals the harness reported, beside the classification.
    pub denials: u64,
    pub denial_samples: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overflow {
    pub lines: Vec<String>,
    pub truncated_count: u64,
}

/// The shutdown seam (021 B-6): set from a signal handler, read by the
/// running session, which severs its child through the grace path.
pub struct KillSwitch {
    requested: Arc<AtomicBool>,
    child_pid: Arc<AtomicI32>,
}

impl Default for KillSwitch {
    fn default() -> Self {
        Self::new()
    }
}

impl KillSwitch {
    pub fn new() -> KillSwitch {
        KillSwitch {
            requested: Arc::new(AtomicBool::new(false)),
            child_pid: Arc::new(AtomicI32::new(0)),
        }
    }

    pub fn handle(&self) -> KillHandle {
        KillHandle {
            requested: self.requested.clone(),
        }
    }
}

#[derive(Clone)]
pub struct KillHandle {
    requested: Arc<AtomicBool>,
}

impl KillHandle {
    pub fn fire(&self) {
        self.requested.store(true, Ordering::SeqCst);
    }
}

fn tail_bytes(text: &str, max: usize) -> String {
    let bytes = text.as_bytes();
    if bytes.len() <= max {
        return text.to_string();
    }
    String::from_utf8_lossy(&bytes[bytes.len() - max..]).into_owned()
}

fn to_cost_micro_usd(v: Option<f64>) -> Option<i64> {
    let v = v?;
    if !v.is_finite() {
        return None;
    }
    Some((v * 1e6).round() as i64)
}

fn sanitize_usage(usage: Option<&Value>) -> Option<BTreeMap<String, i64>> {
    let obj = usage?.as_object()?;
    let mut out = BTreeMap::new();
    for (k, v) in obj {
        if let Some(i) = v.as_i64() {
            out.insert(k.clone(), i);
        } else if let Some(u) = v.as_u64() {
            out.insert(k.clone(), u as i64);
        }
    }
    Some(out)
}

#[cfg(unix)]
fn signal(pid: u32, sig: i32) {
    // Spec 124 B-2 (`hang-killed`): the provider runs in its own process
    // group, so the signal reaches every descendant it spawned, not only
    // the child we recorded. A descendant that outlived the child would
    // otherwise hold the pipes open and, worse, keep working after the
    // deadline the engine enforced.
    // SAFETY: a signal to the process group of our own child, whose pid we
    // recorded at spawn and made the group's leader.
    unsafe {
        libc::kill(-(pid as i32), sig);
    }
}

#[cfg(not(unix))]
fn signal(_pid: u32, _sig: i32) {}

/// Run one session to completion. Every observable of 014 is reproduced:
/// the journal boundaries, the sink events, the classification, the
/// bounded tails.
pub fn run_session(
    provider: &dyn Provider,
    opts: &SessionOptions,
    sink: &mut dyn Sink,
    kill: &KillSwitch,
) -> Result<SessionOutcome, String> {
    let bin = opts
        .bin
        .clone()
        .or_else(|| {
            std::env::var(provider.bin_env_var())
                .ok()
                .filter(|v| !v.is_empty())
        })
        .unwrap_or_else(|| provider.default_bin().to_string());
    // `path.resolve`: absolute and normalized, symlinks left alone, so the
    // journaled repo and the transcript slug match the TypeScript driver's.
    let abs_repo = std::path::absolute(&opts.repo)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| opts.repo.clone());
    let timeout_ms = opts.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
    let kill_grace_ms = opts.kill_grace_ms.unwrap_or(KILL_GRACE_MS);
    let spec = SpawnSpec {
        profile: &opts.profile,
        model: opts.model.as_deref(),
        max_turns: opts.max_turns,
        mcp_config_path: opts.mcp_config_path.as_deref(),
        requirements: &opts.requirements,
    };
    let argv = provider.argv(&spec);
    // Spec 120 B-6 (116 B-1 before it): what the provider applied and what
    // the request made it give up, journaled in `session.init` so a
    // degraded session is never silent (01 D22). Degraded is what the
    // request used minus what was applied, in wire order.
    let applied = provider.applied(&spec);
    let requested = spec.requested();
    let degraded: Vec<Capability> = requested
        .iter()
        .copied()
        .filter(|c| !applied.contains(c))
        .collect();
    let spawn_extras = json!({
        "applied": applied.iter().map(|c| c.as_str()).collect::<Vec<_>>(),
        "degraded": degraded.iter().map(|c| c.as_str()).collect::<Vec<_>>(),
        // Spec 124 B-6: which binary version this run's evidence is about.
        "binaryVersion": provider.binary_version(&bin),
    });
    let parent: BTreeMap<String, String> = std::env::vars().collect();
    let env = provider.child_env(&parent);

    let mut command = Command::new(&bin);
    command
        .args(&argv)
        .current_dir(&abs_repo)
        .env_clear()
        .envs(&env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Spec 124 B-2: the provider leads its own process group (see `signal`).
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("cannot spawn {bin}: {e}"))?;
    let pid = child.id();
    kill.child_pid.store(pid as i32, Ordering::SeqCst);

    // B-1: the prompt reaches the child only via stdin, then stdin is
    // closed. A child that exits before reading closes the pipe first
    // (EPIPE), which the result path classifies.
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(opts.prompt.as_bytes());
        drop(stdin);
    }
    let started = Instant::now();
    let started_at_ms = now_ms();

    // stdout lines and stderr chunks arrive on channels from reader
    // threads; the main loop owns the state, the timers and the sink.
    let (line_tx, line_rx) = mpsc::channel::<String>();
    let stdout = child.stdout.take().expect("piped stdout");
    let stdout_thread = thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) => break,
                Ok(_) => {
                    let mut line = String::from_utf8_lossy(&buf).into_owned();
                    if line.ends_with('\n') {
                        line.pop();
                    }
                    if !line.is_empty() && line_tx.send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    let stderr_tail: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let stderr = child.stderr.take().expect("piped stderr");
    let stderr_acc = stderr_tail.clone();
    let stderr_thread = thread::spawn(move || {
        let mut reader = stderr;
        let mut chunk = [0u8; 4096];
        loop {
            match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&chunk[..n]).into_owned();
                    let mut acc = stderr_acc.lock().unwrap();
                    *acc = tail_bytes(&format!("{acc}{text}"), STDERR_TAIL_BYTES);
                }
            }
        }
    });

    let mut session_id: Option<String> = None;
    let mut result_event: Option<ResultEvent> = None;
    let mut init_journaled = false;
    let mut overflow_lines: Vec<String> = Vec::new();
    let mut overflow_truncated: u64 = 0;
    let mut denials: u64 = 0;
    let mut denial_samples: Vec<String> = Vec::new();
    let mut killed_for_timeout = false;
    let mut killed_for_shutdown = false;
    let mut term_sent_at: Option<Instant> = None;
    let exit_code: Option<i64>;
    let deadline = started + Duration::from_millis(timeout_ms);
    let mut deadline_armed = true;

    let mut handle_line = |line: &str,
                           session_id: &mut Option<String>,
                           result_event: &mut Option<ResultEvent>,
                           init_journaled: &mut bool,
                           overflow_lines: &mut Vec<String>,
                           overflow_truncated: &mut u64,
                           denials: &mut u64,
                           denial_samples: &mut Vec<String>,
                           deadline_armed: &mut bool| {
        let parsed: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => {
                if overflow_lines.len() < OVERFLOW_LINE_CAP {
                    overflow_lines.push(line.to_string());
                } else {
                    *overflow_truncated += 1;
                }
                return;
            }
        };
        sink.stream(&parsed);
        if let Some(text) = provider.denial_in_event(&parsed) {
            *denials += 1;
            if denial_samples.len() < DENIAL_SAMPLE_CAP {
                denial_samples.push(tail_bytes(&text, DENIAL_SAMPLE_BYTES));
            }
        }
        match provider.parse_event(&parsed) {
            ProviderEvent::Init { session_id: id } => {
                if id.is_some() {
                    *session_id = id;
                }
                if !*init_journaled {
                    *init_journaled = true;
                    let mut payload = json!({
                        "repo": abs_repo,
                        "model": opts.model,
                        "maxTurns": opts.max_turns,
                        "timeoutMs": timeout_ms,
                        "sessionId": session_id,
                        "profile": opts.profile.payload(),
                    });
                    for extras in [provider.init_extras(&bin), spawn_extras.clone()] {
                        if let (Some(target), Some(extras)) =
                            (payload.as_object_mut(), extras.as_object())
                        {
                            for (k, v) in extras {
                                target.insert(k.clone(), v.clone());
                            }
                        }
                    }
                    sink.journal("session.init", payload);
                }
            }
            ProviderEvent::Result(event) => {
                if event.session_id.is_some() {
                    *session_id = event.session_id.clone();
                }
                *result_event = Some(event);
                // A result arrived: the process is finishing on its own, so
                // the deadline should not fire a redundant kill underneath.
                *deadline_armed = false;
            }
            ProviderEvent::Other => {}
        }
    };

    loop {
        // Drain what the reader produced.
        while let Ok(line) = line_rx.try_recv() {
            handle_line(
                &line,
                &mut session_id,
                &mut result_event,
                &mut init_journaled,
                &mut overflow_lines,
                &mut overflow_truncated,
                &mut denials,
                &mut denial_samples,
                &mut deadline_armed,
            );
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut code = status.code().map(i64::from);
                #[cfg(unix)]
                if code.is_none() {
                    use std::os::unix::process::ExitStatusExt;
                    code = status.signal().map(|s| 128 + i64::from(s));
                }
                exit_code = code;
                break;
            }
            Ok(None) => {}
            Err(e) => return Err(format!("waiting for {bin}: {e}")),
        }
        let now = Instant::now();
        if kill.requested.load(Ordering::SeqCst) && !killed_for_shutdown {
            killed_for_shutdown = true;
            signal(pid, libc_sigterm());
            term_sent_at = Some(now);
        } else if deadline_armed && !killed_for_timeout && !killed_for_shutdown && now >= deadline {
            killed_for_timeout = true;
            signal(pid, libc_sigterm());
            term_sent_at = Some(now);
        }
        if let Some(sent) = term_sent_at {
            if now.duration_since(sent) >= Duration::from_millis(kill_grace_ms) {
                signal(pid, libc_sigkill());
            }
        }
        thread::sleep(Duration::from_millis(10));
    }
    kill.child_pid.store(0, Ordering::SeqCst);

    // Process exit is the boundary; pipe EOF is a bounded courtesy after.
    let drain_deadline = Instant::now() + Duration::from_millis(PIPE_DRAIN_GRACE_MS);
    while let Ok(line) =
        line_rx.recv_timeout(drain_deadline.saturating_duration_since(Instant::now()))
    {
        handle_line(
            &line,
            &mut session_id,
            &mut result_event,
            &mut init_journaled,
            &mut overflow_lines,
            &mut overflow_truncated,
            &mut denials,
            &mut denial_samples,
            &mut deadline_armed,
        );
    }
    let stderr_text = {
        let acc = stderr_tail.lock().unwrap();
        acc.clone()
    };
    // 119 D-6: refusals the harness logged on stderr instead of the stream.
    for text in provider.denials_in_stderr(&stderr_text) {
        denials += 1;
        if denial_samples.len() < DENIAL_SAMPLE_CAP {
            denial_samples.push(tail_bytes(&text, DENIAL_SAMPLE_BYTES));
        }
    }
    // The reader threads end when the pipes close; an orphaned grandchild
    // can hold them, so they are not joined past the drain grace.
    drop(stdout_thread);
    drop(stderr_thread);

    let duration_ms = started.elapsed().as_millis() as u64;
    let _ = started_at_ms;
    let classification = classify(
        &ClassifyInput {
            exit_code,
            result_event: result_event.as_ref(),
            stderr_tail: &stderr_text,
            timed_out: killed_for_timeout,
            shutdown_killed: killed_for_shutdown,
            max_turns_subtype: provider.max_turns_subtype(),
        },
        provider.termination_rules(),
        now_ms(),
    );
    let cost_micro_usd = to_cost_micro_usd(result_event.as_ref().and_then(|r| r.total_cost_usd));
    let usage = result_event
        .as_ref()
        .and_then(|r| sanitize_usage(r.usage.as_ref()));
    let num_turns = result_event.as_ref().and_then(|r| r.num_turns);
    let transcript_path = session_id
        .as_deref()
        .and_then(|id| provider.transcript_path(&abs_repo, id));
    let outcome = SessionOutcome {
        classification,
        exit_code,
        duration_ms,
        num_turns,
        cost_micro_usd,
        usage,
        session_id: session_id.clone(),
        transcript_path,
        overflow: Overflow {
            lines: overflow_lines,
            truncated_count: overflow_truncated,
        },
        stderr_tail: stderr_text.clone(),
        denials,
        denial_samples,
    };

    // B-6: session end journals the evidence bundle, with the result text
    // riding along bounded so an unclassified failure leaves its haystack.
    let text: Vec<&str> = result_event
        .as_ref()
        .map(|r| {
            [r.subtype.as_deref(), r.result_text.as_deref()]
                .into_iter()
                .flatten()
                .collect()
        })
        .unwrap_or_default();
    let result_text = text.join("\n");
    sink.journal(
        "session.result",
        json!({
            "classification": outcome.classification.kind.as_str(),
            "resetAtMs": outcome.classification.reset_at_ms,
            "detail": outcome.classification.detail,
            "exitCode": outcome.exit_code,
            "durationMs": outcome.duration_ms,
            "numTurns": outcome.num_turns,
            "costMicroUsd": outcome.cost_micro_usd,
            "usage": outcome.usage,
            "sessionId": outcome.session_id,
            "transcriptPath": outcome.transcript_path,
            "overflowLineCount": outcome.overflow.lines.len(),
            "overflowTruncatedCount": outcome.overflow.truncated_count,
            "stderrTail": outcome.stderr_tail,
            "resultTextTail": if result_text.is_empty() { Value::Null } else { Value::String(tail_bytes(&result_text, STDERR_TAIL_BYTES)) },
            "denials": outcome.denials,
            "denialSamples": outcome.denial_samples,
        }),
    );
    Ok(outcome)
}

#[cfg(unix)]
fn libc_sigterm() -> i32 {
    libc::SIGTERM
}
#[cfg(unix)]
fn libc_sigkill() -> i32 {
    libc::SIGKILL
}
#[cfg(not(unix))]
fn libc_sigterm() -> i32 {
    15
}
#[cfg(not(unix))]
fn libc_sigkill() -> i32 {
    9
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        Capability, CapabilityTier, ProviderEvent, Requirements, ResultEvent, SpawnSpec,
        TerminationKind,
    };

    /// A provider that names nothing (spec 116 FR-002): the three defaults
    /// hold, and its `spawn_extras` reach `session.init`.
    struct Plain;

    impl Provider for Plain {
        fn name(&self) -> &'static str {
            "statecraft-driver-plain"
        }
        fn default_bin(&self) -> &'static str {
            "plain"
        }
        fn bin_env_var(&self) -> &'static str {
            "STATECRAFT_PLAIN_BIN"
        }
        fn argv(&self, _spec: &SpawnSpec<'_>) -> Vec<String> {
            vec![]
        }
        fn child_env(&self, parent: &BTreeMap<String, String>) -> BTreeMap<String, String> {
            parent.clone()
        }
        fn parse_event(&self, event: &Value) -> ProviderEvent {
            match event.get("type").and_then(Value::as_str) {
                Some("init") => ProviderEvent::Init {
                    session_id: Some("plain-1".into()),
                },
                Some("result") => ProviderEvent::Result(ResultEvent {
                    is_error: true,
                    subtype: Some("error_max_turns".into()),
                    result_text: Some("limit reached".into()),
                    ..ResultEvent::default()
                }),
                _ => ProviderEvent::Other,
            }
        }
        fn transcript_path(&self, _repo: &str, _id: &str) -> Option<String> {
            None
        }
        fn default_models(&self) -> (&'static str, &'static str) {
            ("s", "f")
        }
        fn termination_rules(&self) -> &[crate::Rule] {
            &[]
        }
        fn init_extras(&self, bin: &str) -> Value {
            json!({ "plainBin": bin })
        }
        // Spec 120: Plain supports cost only, so a turn cap degrades.
        fn capabilities(&self) -> &'static [Capability] {
            &[Capability::Cost]
        }
        // 119 B-5: a `deny` event is a refusal; the text is its payload.
        fn denial_in_event(&self, event: &Value) -> Option<String> {
            (event.get("type").and_then(Value::as_str) == Some("deny")).then(|| {
                event
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or("denied")
                    .to_string()
            })
        }
        // 119 D-6: a stderr line naming the router is a refusal too.
        fn denials_in_stderr(&self, stderr_tail: &str) -> Vec<String> {
            stderr_tail
                .lines()
                .filter(|l| l.contains("router: blocked"))
                .map(str::to_string)
                .collect()
        }
    }

    struct Capture(Vec<(String, Value)>);
    impl Sink for Capture {
        fn journal(&mut self, kind: &str, payload: Value) {
            self.0.push((kind.to_string(), payload));
        }
        fn stream(&mut self, _event: &Value) {}
    }

    #[test]
    fn the_defaults_hold_for_a_provider_that_names_none() {
        let p = Plain;
        assert_eq!(p.max_turns_subtype(), None);
        // Spec 120 B-7: the tier derives from the tokens; Plain's one token
        // is not the four, so basic.
        assert_eq!(p.capability_tier(), CapabilityTier::Basic);
        let profile = Profile::default();
        let none = Requirements::default();
        let spec = SpawnSpec {
            profile: &profile,
            model: None,
            max_turns: None,
            mcp_config_path: None,
            requirements: &none,
        };
        assert_eq!(spec.requested(), vec![Capability::Cost]);
        assert_eq!(p.applied(&spec), vec![Capability::Cost]);
        // A request that names tokens uses them, in wire order, deduplicated.
        let named = Requirements {
            required: vec![Capability::HookEnforcement],
            preferred: vec![Capability::Cost, Capability::ToolAllowlist],
        };
        let spec = SpawnSpec {
            requirements: &named,
            max_turns: Some(2),
            ..spec
        };
        assert_eq!(
            spec.requested(),
            vec![
                Capability::ToolAllowlist,
                Capability::MaxTurns,
                Capability::Cost,
                Capability::HookEnforcement
            ]
        );
    }

    #[test]
    fn spawn_extras_reach_init_and_no_subtype_never_classifies_max_turns() {
        let dir = std::env::temp_dir().join(format!("driver-core-plain-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("plain.sh");
        std::fs::write(
            &script,
            "#!/bin/sh\ncat >/dev/null\necho '{\"type\":\"init\"}'\necho '{\"type\":\"result\"}'\nexit 0\n",
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let opts = SessionOptions {
            repo: dir.to_string_lossy().into_owned(),
            prompt: "hi".into(),
            bin: Some(script.to_string_lossy().into_owned()),
            model: None,
            max_turns: Some(3),
            timeout_ms: Some(10_000),
            mcp_config_path: None,
            profile: Profile {
                mode: "bypass".into(),
                ..Profile::default()
            },
            kill_grace_ms: None,
            requirements: Requirements::default(),
        };
        let mut sink = Capture(vec![]);
        let outcome = run_session(&Plain, &opts, &mut sink, &KillSwitch::new()).unwrap();
        let (kind, init) = &sink.0[0];
        assert_eq!(kind, "session.init");
        // Spec 120 B-6: applied and degraded are disjoint and cover the
        // request's tokens.
        assert_eq!(init["degraded"], json!(["max-turns"]));
        assert_eq!(init["applied"], json!(["cost"]));
        assert_eq!(init["plainBin"], json!(script.to_string_lossy()));
        // The subtype the Plain provider emits would be max-turns for a
        // provider that names it; Plain names none, so the table (empty)
        // and the fallback decide: crashed.
        assert_eq!(outcome.classification.kind, TerminationKind::Crashed);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn denials_are_counted_and_sampled_beside_a_completed_classification() {
        let dir = std::env::temp_dir().join(format!("driver-core-deny-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("deny.sh");
        let long = "x".repeat(DENIAL_SAMPLE_BYTES * 2);
        std::fs::write(
            &script,
            format!(
                "#!/bin/sh\ncat >/dev/null\necho '{{\"type\":\"init\"}}'\n\
                 echo '{{\"type\":\"deny\",\"text\":\"one\"}}'\n\
                 echo '{{\"type\":\"deny\",\"text\":\"two\"}}'\n\
                 echo '{{\"type\":\"deny\",\"text\":\"{long}\"}}'\n\
                 echo 'router: blocked four' 1>&2\n\
                 echo '{{\"type\":\"ok\"}}'\n\
                 exit 0\n"
            ),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let opts = SessionOptions {
            repo: dir.to_string_lossy().into_owned(),
            prompt: "hi".into(),
            bin: Some(script.to_string_lossy().into_owned()),
            model: None,
            max_turns: None,
            timeout_ms: Some(10_000),
            mcp_config_path: None,
            profile: Profile {
                mode: "bypass".into(),
                ..Profile::default()
            },
            kill_grace_ms: None,
            requirements: Requirements::default(),
        };
        let mut sink = Capture(vec![]);
        let outcome = run_session(&Plain, &opts, &mut sink, &KillSwitch::new()).unwrap();
        // Three on the stream, one on stderr; the cap keeps three samples,
        // each bounded.
        assert_eq!(outcome.denials, 4);
        assert_eq!(outcome.denial_samples.len(), DENIAL_SAMPLE_CAP);
        assert_eq!(outcome.denial_samples[0], "one");
        assert!(outcome.denial_samples[2].len() <= DENIAL_SAMPLE_BYTES);
        let (kind, result) = sink.0.last().unwrap();
        assert_eq!(kind, "session.result");
        assert_eq!(result["denials"], json!(4));
        assert_eq!(
            result["denialSamples"].as_array().unwrap().len(),
            DENIAL_SAMPLE_CAP
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
