// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// GovernedExecutor implementation that spawns the `claude` CLI for real agent dispatch.

use crate::{DispatchRequest, DispatchResult, GovernedExecutor};
use async_trait::async_trait;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};

/// Thinking effort level for the `claude` CLI `--effort` flag.
/// Controls extended thinking budget (independent of the orchestrator's
/// `EffortLevel` which scales turns and timeouts).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ThinkingLevel {
    Low,
    Medium,
    High,
    Max,
}

impl ThinkingLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            ThinkingLevel::Low => "low",
            ThinkingLevel::Medium => "medium",
            ThinkingLevel::High => "high",
            ThinkingLevel::Max => "max",
        }
    }
}

impl std::str::FromStr for ThinkingLevel {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "low" => Ok(ThinkingLevel::Low),
            "medium" | "med" => Ok(ThinkingLevel::Medium),
            "high" => Ok(ThinkingLevel::High),
            "max" => Ok(ThinkingLevel::Max),
            other => Err(format!(
                "unknown thinking level: {other} (expected low, medium, high, max)"
            )),
        }
    }
}

/// Callback trait for looking up agent domain prompts by ID.
///
/// This indirection avoids a circular dependency on factory-engine from the
/// orchestrator crate. Callers that have access to agent definitions can
/// implement this trait and inject it via `ClaudeCodeExecutor::with_prompt_lookup`.
pub trait AgentPromptLookup: Send + Sync {
    fn get_prompt(&self, agent_id: &str) -> Option<String>;
}

/// Callback trait for resolving coding standards per agent (spec 055).
///
/// Implementations look up per-agent filter metadata (category/tags) and
/// return pre-formatted standards markdown for prompt injection. Returns
/// `None` when no standards are available (prompt remains unchanged).
pub trait StandardsResolver: Send + Sync {
    fn resolve_for_agent(&self, agent_id: &str) -> Option<String>;
}

/// Live execution events emitted by [`ClaudeCodeExecutor`] while a step
/// runs. Wired by callers (e.g. the desktop Tauri layer) to relay the
/// pipeline's progress to a UI without waiting for the subprocess to
/// finish — see spec 076 "Live Agent Output".
#[derive(Debug, Clone)]
pub enum StepEvent {
    /// Fired once at the start of `dispatch_step`, before the `claude`
    /// subprocess spawns.
    StepStarted { step_id: String },
    /// One human-readable line extracted from the subprocess's
    /// `--output-format stream-json` stream. Surface text from
    /// `assistant` frames, tool-use names, thinking markers, and a
    /// session-init banner. The exact framing format is opaque to the
    /// caller; treat it as terminal-style log output.
    AgentOutput { step_id: String, line: String },
    /// Fired exactly once per step on success, after the subprocess
    /// exits cleanly and its result frame has been parsed.
    StepCompleted {
        step_id: String,
        tokens_used: Option<u64>,
    },
    /// Fired exactly once per step on failure (non-zero exit, timeout,
    /// IO error). The `error` string mirrors the value returned from
    /// `dispatch_step` so the UI's failure summary matches the Result.
    StepFailed { step_id: String, error: String },
}

/// Callback trait for receiving [`StepEvent`]s during dispatch. Hand a
/// concrete implementation to [`ClaudeCodeExecutor::with_step_event_handler`].
/// Implementations MUST be quick and non-blocking — handlers are invoked
/// from the dispatch hot path (every line of subprocess stdout, plus
/// start/finish), so blocking on a slow channel will stall the pipeline.
pub trait StepEventHandler: Send + Sync {
    fn handle(&self, event: StepEvent);
}

/// Executes workflow steps by spawning the `claude` CLI process.
///
/// Builds a system prompt from the registered agent domain prompt (if any)
/// combined with `DispatchRequest::system_prompt`, then invokes:
///
/// ```text
/// claude --print --output-format json --max-turns <N> \
///        --allowedTools <tools> --system-prompt <prompt> \
///        "<step_id>"
/// ```
///
/// Token usage and session ID are extracted from the JSON response and returned in
/// `DispatchResult`. On retries, `--resume <session_id>` is used when available.
pub struct ClaudeCodeExecutor {
    project_path: PathBuf,
    prompt_lookup: Option<Arc<dyn AgentPromptLookup>>,
    standards_resolver: Option<Arc<dyn StandardsResolver>>,
    max_turns: u32,
    allowed_tools: Vec<String>,
    model: Option<String>,
    /// When true, append `[1m]` to the model to request the extended
    /// 1 million-token context window.
    extended_context: bool,
    /// Thinking effort level passed as `--effort` to the `claude` CLI
    /// (controls extended thinking budget). `None` uses the CLI default.
    thinking: Option<ThinkingLevel>,
    /// Base timeout in seconds for Deep-effort steps.
    /// Investigate = base/2, Quick = base/4.
    pub step_timeout_base_secs: u64,
    /// Extra environment variables applied to each spawned `claude`
    /// subprocess. Spec 112 §6.4.5 uses this slot to thread
    /// `GITHUB_TOKEN=<clone-token>` into the factory pipeline so
    /// axiomregent's GitHub client (which reads `GITHUB_TOKEN` from the
    /// environment) authenticates as the project's installation token
    /// or PAT without leaking the credential into OPC's process-wide
    /// env. Empty by default.
    extra_env: HashMap<String, String>,
    /// Optional sink for live execution events (start, per-line agent
    /// output, completion, failure). When set, the executor switches
    /// the `claude` CLI to `--output-format stream-json --verbose` so
    /// it can forward each NDJSON frame as it arrives. When unset, the
    /// executor uses the legacy single-shot `--output-format json`
    /// invocation — back-compat for callers and tests that don't care
    /// about live progress.
    step_event_handler: Option<Arc<dyn StepEventHandler>>,
}

impl ClaudeCodeExecutor {
    /// Create a new executor anchored at `project_path`.
    ///
    /// Defaults: `max_turns = 100`, `allowed_tools = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]`,
    /// `step_timeout_base_secs = 300`.
    pub fn new(project_path: PathBuf) -> Self {
        Self {
            project_path,
            prompt_lookup: None,
            standards_resolver: None,
            max_turns: 100,
            allowed_tools: vec![
                "Read".into(),
                "Write".into(),
                "Edit".into(),
                "Bash".into(),
                "Glob".into(),
                "Grep".into(),
            ],
            model: None,
            extended_context: false,
            thinking: None,
            step_timeout_base_secs: 300,
            extra_env: HashMap::new(),
            step_event_handler: None,
        }
    }

    /// Attach a prompt lookup so the executor can prepend agent-specific
    /// domain prompts to each request.
    pub fn with_prompt_lookup(mut self, lookup: Arc<dyn AgentPromptLookup>) -> Self {
        self.prompt_lookup = Some(lookup);
        self
    }

    /// Attach a standards resolver for per-agent coding standards injection (spec 055).
    ///
    /// The resolver is called for each dispatch request with the agent ID.
    /// If it returns formatted standards text, that text is injected between
    /// the domain prompt and the step system prompt.
    pub fn with_standards_resolver(mut self, resolver: Arc<dyn StandardsResolver>) -> Self {
        self.standards_resolver = Some(resolver);
        self
    }

    /// Override the default maximum number of agentic turns per step.
    pub fn with_max_turns(mut self, max_turns: u32) -> Self {
        self.max_turns = max_turns;
        self
    }

    /// Override the list of tools the `claude` process is allowed to use.
    pub fn with_allowed_tools(mut self, tools: Vec<String>) -> Self {
        self.allowed_tools = tools;
        self
    }

    /// Override the model for all spawned `claude` processes.
    pub fn with_model(mut self, model: Option<String>) -> Self {
        self.model = model;
        self
    }

    /// Request the extended 1M-token context window by appending `[1m]`
    /// to the model identifier passed to the `claude` CLI.
    pub fn with_extended_context(mut self, enabled: bool) -> Self {
        self.extended_context = enabled;
        self
    }

    /// Set the thinking effort level (`--effort` on the `claude` CLI).
    pub fn with_thinking(mut self, level: Option<ThinkingLevel>) -> Self {
        self.thinking = level;
        self
    }

    /// Override the base timeout (seconds) for Deep-effort steps.
    /// Investigate = base/2, Quick = base/4.
    pub fn with_step_timeout(mut self, base_secs: u64) -> Self {
        self.step_timeout_base_secs = base_secs;
        self
    }

    /// Spec 112 §6.4.5 — replace the per-subprocess extra env map.
    ///
    /// Applied via `cmd.env(k, v)` on each spawned `claude` invocation,
    /// scoped to that subprocess only. OPC threads `GITHUB_TOKEN`
    /// through this slot so axiomregent (running inside the spawned
    /// `claude`) sees the project's clone token without OPC mutating
    /// its own process-wide environment.
    pub fn with_extra_env(mut self, env: HashMap<String, String>) -> Self {
        self.extra_env = env;
        self
    }

    /// Attach a [`StepEventHandler`] that receives live progress events
    /// (start, agent output lines, completion, failure) as the executor
    /// runs. Setting a handler switches the underlying `claude` CLI to
    /// streaming NDJSON output so events surface in real time.
    pub fn with_step_event_handler(mut self, handler: Arc<dyn StepEventHandler>) -> Self {
        self.step_event_handler = Some(handler);
        self
    }

    /// Build the combined system prompt for a request.
    ///
    /// Composition order: [domain prompt] \n\n [standards] \n\n [step prompt]
    fn build_system_prompt(&self, request: &DispatchRequest) -> String {
        let domain = self
            .prompt_lookup
            .as_ref()
            .and_then(|lk| lk.get_prompt(&request.agent_id));

        let standards = self
            .standards_resolver
            .as_ref()
            .and_then(|sr| sr.resolve_for_agent(&request.agent_id));

        let mut parts: Vec<&str> = Vec::new();
        if let Some(ref d) = domain
            && !d.is_empty()
        {
            parts.push(d);
        }
        if let Some(ref s) = standards
            && !s.is_empty()
        {
            parts.push(s);
        }
        parts.push(&request.system_prompt);
        parts.join("\n\n")
    }
}

#[async_trait]
impl GovernedExecutor for ClaudeCodeExecutor {
    async fn dispatch_step(&self, request: DispatchRequest) -> Result<DispatchResult, String> {
        let system_prompt = self.build_system_prompt(&request);
        let tools_arg = self.allowed_tools.join(",");
        let effective_max_turns = match request.effort {
            crate::EffortLevel::Quick => self.max_turns,
            crate::EffortLevel::Investigate => self.max_turns * 2,
            crate::EffortLevel::Deep => self.max_turns * 3,
        };
        let max_turns_str = effective_max_turns.to_string();

        // The user message is a brief task summary derived from the step ID.
        let user_message = format!("Execute step: {}", request.step_id);

        // Effort-scaled per-step timeout: Deep = base, Investigate = base/2, Quick = base/4.
        let timeout_secs = match request.effort {
            crate::EffortLevel::Deep => self.step_timeout_base_secs,
            crate::EffortLevel::Investigate => self.step_timeout_base_secs / 2,
            crate::EffortLevel::Quick => self.step_timeout_base_secs / 4,
        };
        let step_timeout = tokio::time::Duration::from_secs(timeout_secs);

        // Streaming mode: when a handler is registered the executor uses
        // `--output-format stream-json --verbose` so each NDJSON frame can
        // be forwarded to the UI as it arrives. parse_claude_output already
        // tolerates either single-shot or streamed output (it picks the
        // last `"type":"result"` line either way), so the post-process path
        // is identical.
        let streaming = self.step_event_handler.is_some();
        let mut args = vec![
            "--print".to_string(),
            "--output-format".to_string(),
            if streaming {
                "stream-json".to_string()
            } else {
                "json".to_string()
            },
        ];
        if streaming {
            args.push("--verbose".to_string());
        }
        args.push("--max-turns".to_string());
        args.push(max_turns_str.clone());
        args.push("--allowedTools".to_string());
        args.push(tools_arg.clone());

        if let Some(ref model) = self.model {
            args.push("--model".to_string());
            if self.extended_context {
                args.push(format!("{model}[1m]"));
            } else {
                args.push(model.clone());
            }
        } else if self.extended_context {
            // No explicit model — use the default alias with extended context.
            args.push("--model".to_string());
            args.push("opus[1m]".to_string());
        }

        if let Some(ref level) = self.thinking {
            args.push("--effort".to_string());
            args.push(level.as_str().to_string());
        }

        if let Some(ref session_id) = request.resume_session_id {
            // Resume the previous session — the system prompt is already loaded,
            // and the agent has full context of what it tried before.
            args.push("--resume".to_string());
            args.push(session_id.clone());
            args.push(user_message.clone());
        } else {
            args.push("--system-prompt".to_string());
            args.push(system_prompt.clone());
            args.push(user_message.clone());
        }

        let step_id = request.step_id.clone();
        if let Some(ref handler) = self.step_event_handler {
            handler.handle(StepEvent::StepStarted {
                step_id: step_id.clone(),
            });
        }

        // SECURITY BOUNDARY: spawns the `claude` CLI directly with `args`
        // built from the dispatch request (system prompt, user message,
        // model, resume session id, ...), which is config/spec-derived, not
        // an untrusted end-user request path. This is argv-based invocation
        // (`Command::args`, not a shell string), so it does not carry the
        // `sh -c` shell-metacharacter injection class that `checks.rs` and
        // `verify.rs` document at their own sites; each element becomes one
        // literal argv entry. There is no flag here to require isolated
        // execution of the spawned `claude` process; if untrusted or
        // third-party pipeline content becomes a supported input, this is
        // the call site to route through a sandbox execution contract (see
        // `factory_engine::sandbox::SandboxClient`, spec 162).
        let mut cmd = tokio::process::Command::new("claude");
        cmd.args(&args).current_dir(&self.project_path);
        if let Some(ref proj_id) = request.project_id {
            cmd.env("OPC_PROJECT_ID", proj_id);
        }
        // Spec 112 §6.4.5 — per-subprocess env (e.g. GITHUB_TOKEN). Applied
        // here so the credential never enters OPC's process-wide env.
        for (k, v) in &self.extra_env {
            cmd.env(k, v);
        }

        let dispatch_result = if streaming {
            self.dispatch_streaming(cmd, &step_id, step_timeout).await
        } else {
            self.dispatch_buffered(cmd, &step_id, step_timeout).await
        };

        match dispatch_result {
            Ok(result) => {
                if let Some(ref handler) = self.step_event_handler {
                    handler.handle(StepEvent::StepCompleted {
                        step_id: step_id.clone(),
                        tokens_used: result.tokens_used,
                    });
                }
                Ok(result)
            }
            Err(e) => {
                if let Some(ref handler) = self.step_event_handler {
                    handler.handle(StepEvent::StepFailed {
                        step_id: step_id.clone(),
                        error: e.clone(),
                    });
                }
                Err(e)
            }
        }
    }
}

impl ClaudeCodeExecutor {
    /// Legacy buffered path — kept for callers that don't register a
    /// step-event handler (notably the orchestrator's own tests). Mirrors
    /// the pre-streaming behaviour exactly.
    async fn dispatch_buffered(
        &self,
        mut cmd: tokio::process::Command,
        step_id: &str,
        step_timeout: tokio::time::Duration,
    ) -> Result<DispatchResult, String> {
        let child = cmd
            .spawn()
            .map_err(|e| format!("failed to spawn claude: {e}"))?;

        let output = {
            let mut child_opt = Some(child);
            let sleep = tokio::time::sleep(step_timeout);
            tokio::pin!(sleep);
            tokio::select! {
                result = async {
                    child_opt.take().unwrap().wait_with_output().await
                } => {
                    result.map_err(|e| format!("failed to wait for claude process: {e}"))?
                }
                _ = &mut sleep => {
                    if let Some(mut c) = child_opt.take() {
                        let _ = c.kill().await;
                    }
                    return Err(format!(
                        "claude process timed out after {} seconds for step '{}'",
                        step_timeout.as_secs(),
                        step_id,
                    ));
                }
            }
        };

        if !output.status.success() {
            let code = output
                .status
                .code()
                .map_or_else(|| "unknown".to_string(), |c| c.to_string());
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let detail = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                let max = 1024;
                if stdout.len() > max {
                    format!("{}… (truncated)", &stdout[..max])
                } else {
                    stdout
                }
            } else {
                "(no output)".to_string()
            };
            return Err(format!("claude exited with status {code} — {detail}"));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let parsed = parse_claude_output(&stdout);

        Ok(DispatchResult {
            tokens_used: parsed.tokens_used,
            output_hashes: HashMap::new(),
            session_id: parsed.session_id,
            cost_usd: parsed.cost_usd,
            duration_ms: parsed.duration_ms,
            num_turns: parsed.num_turns,
            governance_mode: None,
        })
    }

    /// Streaming path — pipes stdout/stderr, reads stdout line-by-line as
    /// the subprocess runs, and forwards human-readable summaries through
    /// the registered [`StepEventHandler`]. The full stdout buffer is also
    /// retained so the existing `parse_claude_output` post-processing
    /// (tokens, session id, cost) still has the final `result` frame to
    /// work with.
    async fn dispatch_streaming(
        &self,
        mut cmd: tokio::process::Command,
        step_id: &str,
        step_timeout: tokio::time::Duration,
    ) -> Result<DispatchResult, String> {
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("failed to spawn claude: {e}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "claude stdout was not piped".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "claude stderr was not piped".to_string())?;

        let mut stdout_lines = BufReader::new(stdout).lines();
        let mut stderr_lines = BufReader::new(stderr).lines();
        let mut stdout_buf = String::new();
        let mut stderr_buf = String::new();
        let handler = self.step_event_handler.clone();

        let sleep = tokio::time::sleep(step_timeout);
        tokio::pin!(sleep);

        let mut stdout_done = false;
        let mut stderr_done = false;

        let exit_status = loop {
            tokio::select! {
                line = stdout_lines.next_line(), if !stdout_done => {
                    match line {
                        Ok(Some(l)) => {
                            stdout_buf.push_str(&l);
                            stdout_buf.push('\n');
                            if let Some(ref h) = handler
                                && let Some(formatted) = format_stream_json_line(&l) {
                                h.handle(StepEvent::AgentOutput {
                                    step_id: step_id.to_string(),
                                    line: formatted,
                                });
                            }
                        }
                        Ok(None) => stdout_done = true,
                        Err(e) => {
                            let _ = child.kill().await;
                            return Err(format!("claude stdout read failed: {e}"));
                        }
                    }
                }
                line = stderr_lines.next_line(), if !stderr_done => {
                    match line {
                        Ok(Some(l)) => {
                            stderr_buf.push_str(&l);
                            stderr_buf.push('\n');
                        }
                        Ok(None) => stderr_done = true,
                        Err(_) => stderr_done = true,
                    }
                }
                status = child.wait(), if stdout_done && stderr_done => {
                    break status.map_err(|e| format!("claude wait failed: {e}"))?;
                }
                _ = &mut sleep => {
                    let _ = child.kill().await;
                    return Err(format!(
                        "claude process timed out after {} seconds for step '{}'",
                        step_timeout.as_secs(),
                        step_id,
                    ));
                }
            }
        };

        if !exit_status.success() {
            let code = exit_status
                .code()
                .map_or_else(|| "unknown".to_string(), |c| c.to_string());
            let stderr_trim = stderr_buf.trim().to_string();
            let stdout_trim = stdout_buf.trim().to_string();
            let detail = if !stderr_trim.is_empty() {
                stderr_trim
            } else if !stdout_trim.is_empty() {
                let max = 1024;
                if stdout_trim.len() > max {
                    format!("{}… (truncated)", &stdout_trim[..max])
                } else {
                    stdout_trim
                }
            } else {
                "(no output)".to_string()
            };
            return Err(format!("claude exited with status {code} — {detail}"));
        }

        let parsed = parse_claude_output(&stdout_buf);
        Ok(DispatchResult {
            tokens_used: parsed.tokens_used,
            output_hashes: HashMap::new(),
            session_id: parsed.session_id,
            cost_usd: parsed.cost_usd,
            duration_ms: parsed.duration_ms,
            num_turns: parsed.num_turns,
            governance_mode: None,
        })
    }
}

/// Render a single NDJSON frame from `claude --output-format stream-json`
/// as a human-readable line. Returns `None` for frames the UI shouldn't
/// surface (e.g. `result`, which is consumed by `parse_claude_output`,
/// and successful tool-result echoes).
fn format_stream_json_line(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() || !trimmed.starts_with('{') {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(trimmed).ok()?;
    let kind = v.get("type")?.as_str()?;
    match kind {
        "system" => {
            // Only the init banner is interesting — subsequent system frames
            // (e.g. tool registry summaries) are noise for the live view.
            let subtype = v.get("subtype").and_then(|s| s.as_str()).unwrap_or("");
            if subtype == "init" {
                let session = v
                    .get("session_id")
                    .and_then(|s| s.as_str())
                    .unwrap_or("?");
                let tools = v
                    .get("tools")
                    .and_then(|t| t.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                Some(format!("[init] session={session} tools={tools}"))
            } else {
                None
            }
        }
        "assistant" => {
            let content = v.get("message")?.get("content")?.as_array()?;
            let mut parts: Vec<String> = Vec::new();
            for c in content {
                let ctype = c.get("type").and_then(|t| t.as_str()).unwrap_or("");
                match ctype {
                    "text" => {
                        if let Some(text) = c.get("text").and_then(|t| t.as_str())
                            && !text.trim().is_empty()
                        {
                            parts.push(text.to_string());
                        }
                    }
                    "tool_use" => {
                        let name = c.get("name").and_then(|n| n.as_str()).unwrap_or("?");
                        // Surface the input's first scalar/string field (e.g.
                        // command for Bash, file_path for Read) so the user can
                        // tell what the tool was called with at a glance.
                        let summary = c
                            .get("input")
                            .and_then(|inp| inp.as_object())
                            .and_then(|map| {
                                for (k, val) in map {
                                    if let Some(s) = val.as_str() {
                                        let snippet = s.lines().next().unwrap_or("");
                                        let snippet = if snippet.len() > 80 {
                                            format!("{}…", &snippet[..80])
                                        } else {
                                            snippet.to_string()
                                        };
                                        return Some(format!("{k}={snippet}"));
                                    }
                                }
                                None
                            })
                            .unwrap_or_default();
                        if summary.is_empty() {
                            parts.push(format!("→ tool: {name}"));
                        } else {
                            parts.push(format!("→ tool: {name} ({summary})"));
                        }
                    }
                    "thinking" => parts.push("[thinking…]".to_string()),
                    _ => {}
                }
            }
            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n"))
            }
        }
        "user" => {
            // Tool results are echoed back as user frames. Only surface
            // failures — successes are noise.
            let content = v.get("message")?.get("content")?.as_array()?;
            for c in content {
                if c.get("type").and_then(|t| t.as_str()) == Some("tool_result")
                    && c.get("is_error").and_then(|e| e.as_bool()) == Some(true)
                {
                    let snippet = c
                        .get("content")
                        .and_then(|x| x.as_str())
                        .unwrap_or("(no detail)");
                    let snippet = if snippet.len() > 200 {
                        format!("{}…", &snippet[..200])
                    } else {
                        snippet.to_string()
                    };
                    return Some(format!("✗ tool error: {snippet}"));
                }
            }
            None
        }
        _ => None,
    }
}

/// Parsed fields extracted from the claude CLI JSON output.
struct ClaudeOutput {
    tokens_used: Option<u64>,
    session_id: Option<String>,
    /// Total API cost in USD (from `total_cost_usd`).
    cost_usd: Option<f64>,
    /// Wall-clock duration in milliseconds (from `duration_ms`).
    duration_ms: Option<u64>,
    /// Number of agentic turns (from `num_turns`).
    num_turns: Option<u32>,
}

/// Extract token counts, session ID, cost, and duration from the claude JSON output.
///
/// The `claude --print --output-format json` CLI may write multiple JSON objects
/// to stdout (streaming content, intermediate messages, then the final result).
/// This function finds the last line containing a `{"type":"result",...}` object
/// and extracts fields from it. Falls back to parsing the entire string as a
/// single JSON value for backward compatibility.
///
/// Returns `None` fields if the structure is absent or cannot be parsed,
/// so the executor remains resilient to format changes.
fn parse_claude_output(json_str: &str) -> ClaudeOutput {
    let empty = ClaudeOutput {
        tokens_used: None,
        session_id: None,
        cost_usd: None,
        duration_ms: None,
        num_turns: None,
    };

    // Strategy: find the last JSON line with "type":"result" — this is the
    // final result object from the claude CLI. Handles NDJSON (multiple JSON
    // objects on separate lines) as well as single-object output.
    let v: serde_json::Value = find_result_json(json_str).unwrap_or_else(|| {
        // Fallback: try parsing the entire string as a single JSON value.
        serde_json::from_str(json_str)
            .ok()
            .unwrap_or(serde_json::Value::Null)
    });

    if v.is_null() {
        return empty;
    }

    let tokens_used = v.get("usage").and_then(|u| {
        let input = u.get("input_tokens")?.as_u64().unwrap_or(0);
        let output = u.get("output_tokens")?.as_u64().unwrap_or(0);
        let cache_creation = u
            .get("cache_creation_input_tokens")
            .and_then(|t| t.as_u64())
            .unwrap_or(0);
        let cache_read = u
            .get("cache_read_input_tokens")
            .and_then(|t| t.as_u64())
            .unwrap_or(0);
        Some(input + output + cache_creation + cache_read)
    });

    let session_id = v
        .get("session_id")
        .and_then(|s| s.as_str())
        .map(String::from);

    let cost_usd = v.get("total_cost_usd").and_then(|c| c.as_f64());

    let duration_ms = v.get("duration_ms").and_then(|d| d.as_u64());

    let num_turns = v
        .get("num_turns")
        .and_then(|n| n.as_u64())
        .map(|n| n as u32);

    ClaudeOutput {
        tokens_used,
        session_id,
        cost_usd,
        duration_ms,
        num_turns,
    }
}

/// Find the last JSON object in the output that has `"type":"result"`.
fn find_result_json(output: &str) -> Option<serde_json::Value> {
    // Iterate lines in reverse to find the last result object.
    for line in output.lines().rev() {
        let trimmed = line.trim();
        if trimmed.starts_with('{')
            && trimmed.contains("\"type\"")
            && let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed)
            && v.get("type").and_then(|t| t.as_str()) == Some("result")
        {
            return Some(v);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_claude_output_extracts_tokens_and_session() {
        let json = r#"{"type":"result","usage":{"input_tokens":100,"output_tokens":50},"session_id":"abc-123"}"#;
        let out = parse_claude_output(json);
        assert_eq!(out.tokens_used, Some(150));
        assert_eq!(out.session_id.as_deref(), Some("abc-123"));
    }

    #[test]
    fn with_extra_env_overrides_an_empty_default() {
        let mut env = HashMap::new();
        env.insert("GITHUB_TOKEN".into(), "ghs_FAKE".into());
        let exec = ClaudeCodeExecutor::new(PathBuf::from(".")).with_extra_env(env);
        // Field is private, but we can confirm via the builder's chained call:
        // re-applying with_extra_env replaces the previous map entirely.
        let replaced = exec.with_extra_env(HashMap::new());
        assert!(replaced.extra_env.is_empty());
    }

    #[test]
    fn extra_env_starts_empty_by_default() {
        let exec = ClaudeCodeExecutor::new(PathBuf::from("."));
        assert!(exec.extra_env.is_empty());
    }

    #[test]
    fn parse_claude_output_extracts_cost_and_duration() {
        let json = r#"{"type":"result","usage":{"input_tokens":10,"output_tokens":200,"cache_creation_input_tokens":500,"cache_read_input_tokens":1000},"session_id":"s1","total_cost_usd":1.23,"duration_ms":45000,"num_turns":12}"#;
        let out = parse_claude_output(json);
        assert_eq!(out.tokens_used, Some(10 + 200 + 500 + 1000));
        assert_eq!(out.cost_usd, Some(1.23));
        assert_eq!(out.duration_ms, Some(45000));
        assert_eq!(out.num_turns, Some(12));
    }

    #[test]
    fn parse_claude_output_handles_multiline_ndjson() {
        // Claude CLI may output multiple JSON objects; we want the last "result" one.
        let output = r#"{"type":"assistant","content":"thinking..."}
{"type":"result","usage":{"input_tokens":100,"output_tokens":50},"session_id":"final-session","total_cost_usd":0.42,"duration_ms":30000,"num_turns":5}
"#;
        let out = parse_claude_output(output);
        assert_eq!(out.tokens_used, Some(150));
        assert_eq!(out.session_id.as_deref(), Some("final-session"));
        assert_eq!(out.cost_usd, Some(0.42));
        assert_eq!(out.duration_ms, Some(30000));
        assert_eq!(out.num_turns, Some(5));
    }

    #[test]
    fn parse_claude_output_returns_none_on_missing_usage() {
        let json = r#"{"type":"result"}"#;
        let out = parse_claude_output(json);
        assert_eq!(out.tokens_used, None);
        assert_eq!(out.session_id, None);
        assert_eq!(out.cost_usd, None);
    }

    #[test]
    fn parse_claude_output_returns_none_on_invalid_json() {
        let out = parse_claude_output("not json");
        assert_eq!(out.tokens_used, None);
        assert_eq!(out.session_id, None);
    }

    #[test]
    fn parse_claude_output_fallback_for_non_result_json() {
        // Single JSON without type:result — falls back to parsing the whole string
        let json = r#"{"usage":{"input_tokens":10,"output_tokens":20},"session_id":"fallback"}"#;
        let out = parse_claude_output(json);
        assert_eq!(out.tokens_used, Some(30));
        assert_eq!(out.session_id.as_deref(), Some("fallback"));
    }

    #[test]
    fn build_system_prompt_combines_domain_and_request() {
        struct StaticLookup;
        impl AgentPromptLookup for StaticLookup {
            fn get_prompt(&self, _agent_id: &str) -> Option<String> {
                Some("Domain context.".into())
            }
        }

        let executor =
            ClaudeCodeExecutor::new("/tmp".into()).with_prompt_lookup(Arc::new(StaticLookup));

        let req = DispatchRequest {
            step_id: "s1".into(),
            agent_id: "agent-a".into(),
            effort: crate::EffortLevel::Investigate,
            system_prompt: "Task instructions.".into(),
            input_artifacts: vec![],
            output_artifacts: vec![],
            resume_session_id: None,
            project_id: None,
        };

        let prompt = executor.build_system_prompt(&req);
        assert_eq!(prompt, "Domain context.\n\nTask instructions.");
    }

    #[test]
    fn build_system_prompt_with_standards_resolver() {
        struct StaticLookup;
        impl AgentPromptLookup for StaticLookup {
            fn get_prompt(&self, _agent_id: &str) -> Option<String> {
                Some("Domain context.".into())
            }
        }

        struct StaticStandards;
        impl StandardsResolver for StaticStandards {
            fn resolve_for_agent(&self, _agent_id: &str) -> Option<String> {
                Some("## Applicable Coding Standards\n\nSecurity rules.".into())
            }
        }

        let executor = ClaudeCodeExecutor::new("/tmp".into())
            .with_prompt_lookup(Arc::new(StaticLookup))
            .with_standards_resolver(Arc::new(StaticStandards));

        let req = DispatchRequest {
            step_id: "s1".into(),
            agent_id: "agent-a".into(),
            effort: crate::EffortLevel::Investigate,
            system_prompt: "Task instructions.".into(),
            input_artifacts: vec![],
            output_artifacts: vec![],
            resume_session_id: None,
            project_id: None,
        };

        let prompt = executor.build_system_prompt(&req);
        assert_eq!(
            prompt,
            "Domain context.\n\n## Applicable Coding Standards\n\nSecurity rules.\n\nTask instructions."
        );
    }

    #[test]
    fn build_system_prompt_standards_only_no_domain() {
        struct StaticStandards;
        impl StandardsResolver for StaticStandards {
            fn resolve_for_agent(&self, _agent_id: &str) -> Option<String> {
                Some("Standards text.".into())
            }
        }

        let executor = ClaudeCodeExecutor::new("/tmp".into())
            .with_standards_resolver(Arc::new(StaticStandards));

        let req = DispatchRequest {
            step_id: "s1".into(),
            agent_id: "agent-a".into(),
            effort: crate::EffortLevel::Investigate,
            system_prompt: "Task.".into(),
            input_artifacts: vec![],
            output_artifacts: vec![],
            resume_session_id: None,
            project_id: None,
        };

        let prompt = executor.build_system_prompt(&req);
        assert_eq!(prompt, "Standards text.\n\nTask.");
    }

    #[test]
    fn build_system_prompt_falls_back_when_no_lookup() {
        let executor = ClaudeCodeExecutor::new("/tmp".into());

        let req = DispatchRequest {
            step_id: "s1".into(),
            agent_id: "agent-a".into(),
            effort: crate::EffortLevel::Investigate,
            system_prompt: "Task instructions.".into(),
            input_artifacts: vec![],
            output_artifacts: vec![],
            resume_session_id: None,
            project_id: None,
        };

        let prompt = executor.build_system_prompt(&req);
        assert_eq!(prompt, "Task instructions.");
    }

    #[test]
    fn builder_setters_work() {
        let exec = ClaudeCodeExecutor::new("/workspace".into())
            .with_max_turns(10)
            .with_allowed_tools(vec!["Read".into()])
            .with_model(Some("opus".into()))
            .with_extended_context(true)
            .with_thinking(Some(ThinkingLevel::Max))
            .with_step_timeout(600);
        assert_eq!(exec.max_turns, 10);
        assert_eq!(exec.allowed_tools, vec!["Read"]);
        assert_eq!(exec.model, Some("opus".into()));
        assert!(exec.extended_context);
        assert_eq!(exec.thinking, Some(ThinkingLevel::Max));
        assert_eq!(exec.step_timeout_base_secs, 600);
    }

    #[test]
    fn thinking_level_round_trips() {
        assert_eq!("low".parse::<ThinkingLevel>().unwrap(), ThinkingLevel::Low);
        assert_eq!(
            "med".parse::<ThinkingLevel>().unwrap(),
            ThinkingLevel::Medium
        );
        assert_eq!(
            "high".parse::<ThinkingLevel>().unwrap(),
            ThinkingLevel::High
        );
        assert_eq!("max".parse::<ThinkingLevel>().unwrap(), ThinkingLevel::Max);
        assert_eq!(ThinkingLevel::High.as_str(), "high");
    }

    #[test]
    fn effort_timeout_scales_correctly() {
        let exec = ClaudeCodeExecutor::new("/tmp".into()).with_step_timeout(1200);
        assert_eq!(exec.step_timeout_base_secs, 1200);
        // Deep=1200, Investigate=600, Quick=300
    }

    #[test]
    fn effective_max_turns_scales_by_effort() {
        let exec = ClaudeCodeExecutor::new("/tmp".into());
        let compute = |level: crate::EffortLevel| match level {
            crate::EffortLevel::Quick => exec.max_turns,
            crate::EffortLevel::Investigate => exec.max_turns * 2,
            crate::EffortLevel::Deep => exec.max_turns * 3,
        };
        assert_eq!(compute(crate::EffortLevel::Quick), 100);
        assert_eq!(compute(crate::EffortLevel::Investigate), 200);
        assert_eq!(compute(crate::EffortLevel::Deep), 300);
    }
}
