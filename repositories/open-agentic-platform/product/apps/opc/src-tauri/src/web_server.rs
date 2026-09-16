// Feature: SCHEDULING
// Spec: specs/079-scheduling/spec.md
use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket};
use axum::http::{Method, StatusCode};
use axum::{
    Router,
    extract::{Path, State as AxumState, WebSocketUpgrade},
    response::{IntoResponse, Json, Response},
    routing::{delete, get, post, put},
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tower_http::services::ServeDir;

use crate::commands;

// ---------------------------------------------------------------------------
// Scheduling types (Feature 079)
// TODO: Wire to orchestrator::SqliteSchedulerStore once the isolated desktop
//       workspace resolves libsqlite3-sys linking with the root workspace.
// ---------------------------------------------------------------------------

/// Trigger type for a schedule: cron expression or lifecycle event.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ScheduleTrigger {
    Cron { expr: String },
    Event { event_type: String },
}

/// A schedule definition as stored and returned by the API.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Schedule {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub trigger: ScheduleTrigger,
    pub enabled: bool,
    /// Last execution time as Unix epoch seconds.
    pub last_run_at: Option<i64>,
    /// Creation time as Unix epoch seconds.
    pub created_at: i64,
}

/// Input for creating a new schedule.
#[derive(Clone, Debug, Deserialize)]
pub struct CreateScheduleRequest {
    pub name: String,
    pub prompt: String,
    pub trigger: ScheduleTrigger,
}

/// Shared in-memory store for schedules (keyed by ID).
type ScheduleStore = Arc<Mutex<std::collections::HashMap<String, Schedule>>>;

// ---------------------------------------------------------------------------
// Control API — authentication and lockfile management
// ---------------------------------------------------------------------------

/// Authentication state for the control API.
#[derive(Clone)]
struct ControlAuth {
    token: String,
}

/// Writes control lockfiles so external CLIs can discover the control server.
fn write_control_files(port: u16, token: &str) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME env var not set".to_string())?;
    let oap_dir = std::path::PathBuf::from(home).join(".oap");
    fs::create_dir_all(&oap_dir).map_err(|e| format!("create ~/.oap: {e}"))?;

    let port_path = oap_dir.join("control.port");
    let token_path = oap_dir.join("control.token");

    fs::write(&port_path, port.to_string()).map_err(|e| format!("write control.port: {e}"))?;
    fs::write(&token_path, token).map_err(|e| format!("write control.token: {e}"))?;

    // Restrict permissions to owner only (0600).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        let _ = fs::set_permissions(&port_path, perms.clone());
        let _ = fs::set_permissions(&token_path, perms);
    }

    Ok(())
}

/// Removes control lockfiles on shutdown.
fn cleanup_control_files() {
    if let Ok(home) = std::env::var("HOME") {
        let oap_dir = std::path::PathBuf::from(home).join(".oap");
        let _ = fs::remove_file(oap_dir.join("control.port"));
        let _ = fs::remove_file(oap_dir.join("control.token"));
    }
}

// ---------------------------------------------------------------------------
// Control API — route handlers
// ---------------------------------------------------------------------------

async fn control_status() -> impl IntoResponse {
    Json(ApiResponse::success(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
    })))
}

async fn control_list_projects() -> impl IntoResponse {
    match crate::commands::claude::list_projects().await {
        Ok(projects) => Json(ApiResponse::success(projects)).into_response(),
        Err(e) => Json(ApiResponse::<()>::error(e)).into_response(),
    }
}

async fn control_get_sessions(Path(project_id): Path<String>) -> impl IntoResponse {
    match crate::commands::claude::get_project_sessions(project_id).await {
        Ok(sessions) => Json(ApiResponse::success(sessions)).into_response(),
        Err(e) => Json(ApiResponse::<()>::error(e)).into_response(),
    }
}

async fn control_get_messages(
    Path((session_id, project_id)): Path<(String, String)>,
) -> impl IntoResponse {
    match crate::commands::claude::load_session_history(session_id, project_id).await {
        Ok(history) => Json(ApiResponse::success(history)).into_response(),
        Err(e) => Json(ApiResponse::<()>::error(e)).into_response(),
    }
}

// Feature: REMOTE_CONTROL_CLI
#[derive(Debug, Deserialize)]
struct ControlSendMessageRequest {
    prompt: String,
    project_id: String,
}

// Feature: REMOTE_CONTROL_CLI
async fn control_send_message(
    Path(session_id): Path<String>,
    Json(body): Json<ControlSendMessageRequest>,
) -> impl IntoResponse {
    let message_id = uuid::Uuid::new_v4().to_string();
    Json(ApiResponse::success(serde_json::json!({
        "message_id": message_id,
        "session_id": session_id,
        "project_id": body.project_id,
        "status": "queued",
        "note": "Execution dispatch pending WebSocket bridge integration",
    })))
}

// Feature: REMOTE_CONTROL_CLI
async fn control_cancel_session(Path(session_id): Path<String>) -> impl IntoResponse {
    Json(ApiResponse::success(serde_json::json!({
        "session_id": session_id,
        "status": "cancelled",
    })))
}

// ---------------------------------------------------------------------------
// Control API — auth middleware
// ---------------------------------------------------------------------------

/// Extracts the control token from either the `X-Control-Token` header
/// (used by `oap-ctl` and same-origin `fetch` calls once the token has been
/// embedded into the served page, see `inject_control_token`) or a
/// `?token=` query parameter (used by the browser `WebSocket` API, which
/// cannot set custom headers on the handshake request). The token is always
/// a UUID (see `create_web_server`), so no percent-decoding is needed here.
fn extract_control_token(headers: &axum::http::HeaderMap, uri: &axum::http::Uri) -> Option<String> {
    if let Some(v) = headers.get("X-Control-Token").and_then(|v| v.to_str().ok()) {
        return Some(v.to_string());
    }
    let query = uri.query()?;
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or("");
        let value = parts.next().unwrap_or("");
        if key == "token" {
            return Some(value.to_string());
        }
    }
    None
}

/// Constant-time comparison of the control token against a caller-supplied
/// value. Ordinary `==` short-circuits at the first mismatched byte, which
/// leaks timing information an attacker could use to recover the token
/// byte-by-byte across many requests. Lengths are compared up front (the
/// token's length is not secret; it is always a UUID) and then every byte
/// is XOR-accumulated regardless of where a mismatch occurs, so the
/// comparison takes the same time whether the first byte or the last byte
/// differs.
fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Auth middleware shared by `/control/*`, `/api/*`, and `/ws/claude`
/// (findings CRITICAL #1, HIGH #3). Previously `/api/*` and `/ws/claude`
/// carried no auth at all; any browser/LAN client that could reach the
/// server could drive Claude execution with an attacker-controlled prompt
/// and project path.
async fn control_auth_middleware(
    axum::extract::State(auth): axum::extract::State<ControlAuth>,
    req: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> impl IntoResponse {
    let provided = extract_control_token(req.headers(), req.uri());

    match provided {
        Some(t) if constant_time_eq(&t, &auth.token) => next.run(req).await.into_response(),
        _ => (
            axum::http::StatusCode::UNAUTHORIZED,
            Json(ApiResponse::<()>::error("unauthorized".to_string())),
        )
            .into_response(),
    }
}

// Find Claude binary for web mode - use bundled binary first
fn find_claude_binary_web() -> Result<String, String> {
    // First try the bundled binary (same location as Tauri app uses)
    let bundled_binary = "src-tauri/binaries/claude-code-x86_64-unknown-linux-gnu";
    if std::path::Path::new(bundled_binary).exists() {
        println!(
            "[find_claude_binary_web] Using bundled binary: {}",
            bundled_binary
        );
        return Ok(bundled_binary.to_string());
    }

    // Fall back to system installation paths
    let home_path = format!(
        "{}/.local/bin/claude",
        std::env::var("HOME").unwrap_or_default()
    );
    let candidates = vec![
        "claude",
        "claude-code",
        "/usr/local/bin/claude",
        "/usr/bin/claude",
        "/opt/homebrew/bin/claude",
        &home_path,
    ];

    for candidate in candidates {
        if which::which(candidate).is_ok() {
            println!(
                "[find_claude_binary_web] Using system binary: {}",
                candidate
            );
            return Ok(candidate.to_string());
        }
    }

    Err("Claude binary not found in bundled location or system paths".to_string())
}

#[derive(Clone)]
pub struct AppState {
    // Track active WebSocket sessions for Claude execution
    pub active_sessions:
        Arc<Mutex<std::collections::HashMap<String, tokio::sync::mpsc::Sender<String>>>>,
    // In-memory schedule store (Feature 079)
    pub schedules: ScheduleStore,
    /// Shared axiomregent announce port (spec 090-2: replaces env var read to fix race).
    pub axiomregent_port: Arc<std::sync::Mutex<Option<u16>>>,
    /// Control token gating `/api/*` and `/ws/claude` (findings CRITICAL #1,
    /// HIGH #3). Embedded into `served_html` only on a loopback bind, see
    /// `inject_control_token` and `create_web_server`.
    pub control_token: String,
    /// Precomputed frontend HTML shell, built once in `create_web_server`
    /// (see `serve_frontend`). On a loopback bind this carries the control
    /// token (`inject_control_token`); on a non-loopback bind it is the
    /// plain, token-free shell, since `/` is an unauthenticated route and
    /// any LAN client could otherwise scrape the token from the page
    /// (finding HIGH: control-token leak via unauthenticated HTML). `Bytes`
    /// makes every request a cheap refcount clone instead of the prior
    /// per-request `find()` + string rebuild.
    pub served_html: Bytes,
}

#[derive(Debug, Deserialize)]
pub struct ClaudeExecutionRequest {
    pub project_path: String,
    pub prompt: String,
    pub model: Option<String>,
    pub session_id: Option<String>,
    pub command_type: String, // "execute", "continue", or "resume"
    pub org_id: Option<String>,
}

#[derive(Deserialize)]
pub struct QueryParams {
    #[serde(default)]
    pub project_path: Option<String>,
}

#[derive(Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn error(error: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(error),
        }
    }
}

/// Embeds the control token into the served HTML shell so same-origin
/// browser JS can authenticate its own `/api` and `/ws/claude` calls
/// (findings CRITICAL #1, HIGH #3). Called exactly once, from
/// `create_web_server`, and only on a loopback bind: the token is only as
/// secret as the page load itself, which matches the local machine's own
/// trust boundary on loopback. A non-loopback bind serves the plain,
/// token-free shell instead (see `served_html`) because any unauthenticated
/// LAN client could otherwise GET `/` and scrape the token (finding HIGH:
/// control-token leak via unauthenticated HTML).
fn inject_control_token(html: &str, token: &str) -> String {
    let token_json = serde_json::to_string(token).unwrap_or_else(|_| "\"\"".to_string());
    let script = format!("<script>window.__OPC_CONTROL_TOKEN__={token_json};</script>");
    match html.find("<head>") {
        Some(pos) => {
            let insert_at = pos + "<head>".len();
            let mut out = String::with_capacity(html.len() + script.len());
            out.push_str(&html[..insert_at]);
            out.push_str(&script);
            out.push_str(&html[insert_at..]);
            out
        }
        None => format!("{script}{html}"),
    }
}

/// Serve the precomputed frontend HTML shell (see `served_html` /
/// `create_web_server`). `/` is an unauthenticated route, so the control
/// token is present in the served bytes only when `create_web_server`
/// determined the bind is loopback-only (see `inject_control_token`); a
/// non-loopback bind serves the plain shell with no token embedded.
async fn serve_frontend(AxumState(state): AxumState<AppState>) -> impl IntoResponse {
    (
        [(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8")],
        state.served_html.clone(),
    )
}

/// API endpoint to get projects (equivalent to Tauri command)
async fn get_projects() -> Json<ApiResponse<Vec<commands::claude::Project>>> {
    match commands::claude::list_projects().await {
        Ok(projects) => Json(ApiResponse::success(projects)),
        Err(e) => Json(ApiResponse::error(e.to_string())),
    }
}

/// API endpoint to get sessions for a project
async fn get_sessions(
    Path(project_id): Path<String>,
) -> Json<ApiResponse<Vec<commands::claude::Session>>> {
    match commands::claude::get_project_sessions(project_id).await {
        Ok(sessions) => Json(ApiResponse::success(sessions)),
        Err(e) => Json(ApiResponse::error(e.to_string())),
    }
}

/// Simple agents endpoint - return empty for now (needs DB state)
async fn get_agents() -> Json<ApiResponse<Vec<serde_json::Value>>> {
    Json(ApiResponse::success(vec![]))
}

/// Simple usage endpoint - return empty for now
async fn get_usage() -> Json<ApiResponse<Vec<serde_json::Value>>> {
    Json(ApiResponse::success(vec![]))
}

/// Get Claude settings - return basic defaults for web mode
async fn get_claude_settings() -> Json<ApiResponse<serde_json::Value>> {
    let default_settings = serde_json::json!({
        "data": {
            "model": "claude-3-5-sonnet-20241022",
            "max_tokens": 8192,
            "temperature": 0.0,
            "auto_save": true,
            "theme": "dark"
        }
    });
    Json(ApiResponse::success(default_settings))
}

/// Check Claude version - return mock status for web mode
async fn check_claude_version() -> Json<ApiResponse<serde_json::Value>> {
    let version_status = serde_json::json!({
        "status": "ok",
        "version": "web-mode",
        "message": "Running in web server mode"
    });
    Json(ApiResponse::success(version_status))
}

/// List all available Claude installations on the system
async fn list_claude_installations()
-> Json<ApiResponse<Vec<crate::claude_binary::ClaudeInstallation>>> {
    let installations = crate::claude_binary::discover_claude_installations();

    if installations.is_empty() {
        Json(ApiResponse::error(
            "No Claude Code installations found on the system".to_string(),
        ))
    } else {
        Json(ApiResponse::success(installations))
    }
}

/// Get system prompt - return default for web mode
async fn get_system_prompt() -> Json<ApiResponse<String>> {
    let default_prompt =
        "You are Claude, an AI assistant created by Anthropic. You are running in web server mode."
            .to_string();
    Json(ApiResponse::success(default_prompt))
}

/// Open new session - mock for web mode
async fn open_new_session() -> Json<ApiResponse<String>> {
    let session_id = format!("web-session-{}", chrono::Utc::now().timestamp());
    Json(ApiResponse::success(session_id))
}

/// List slash commands - return empty for web mode
async fn list_slash_commands() -> Json<ApiResponse<Vec<serde_json::Value>>> {
    Json(ApiResponse::success(vec![]))
}

/// MCP list servers - return empty for web mode
async fn mcp_list() -> Json<ApiResponse<Vec<serde_json::Value>>> {
    Json(ApiResponse::success(vec![]))
}

/// Load session history from JSONL file
async fn load_session_history(
    Path((session_id, project_id)): Path<(String, String)>,
) -> Json<ApiResponse<Vec<serde_json::Value>>> {
    match commands::claude::load_session_history(session_id, project_id).await {
        Ok(history) => Json(ApiResponse::success(history)),
        Err(e) => Json(ApiResponse::error(e.to_string())),
    }
}

/// List running Claude sessions
async fn list_running_claude_sessions() -> Json<ApiResponse<Vec<serde_json::Value>>> {
    // Return empty for web mode - no actual Claude processes in web mode
    Json(ApiResponse::success(vec![]))
}

/// Execute Claude code - mock for web mode
async fn execute_claude_code() -> Json<ApiResponse<serde_json::Value>> {
    Json(ApiResponse::error("Claude execution is not available in web mode. Please use the desktop app for running Claude commands.".to_string()))
}

/// Continue Claude code - mock for web mode
async fn continue_claude_code() -> Json<ApiResponse<serde_json::Value>> {
    Json(ApiResponse::error("Claude execution is not available in web mode. Please use the desktop app for running Claude commands.".to_string()))
}

/// Resume Claude code - mock for web mode  
async fn resume_claude_code() -> Json<ApiResponse<serde_json::Value>> {
    Json(ApiResponse::error("Claude execution is not available in web mode. Please use the desktop app for running Claude commands.".to_string()))
}

/// Cancel Claude execution
async fn cancel_claude_execution(Path(session_id): Path<String>) -> Json<ApiResponse<()>> {
    // In web mode, we don't have a way to cancel the subprocess cleanly
    // The WebSocket closing should handle cleanup
    log::trace!("Cancel request for session: {}", session_id);
    Json(ApiResponse::success(()))
}

/// Get Claude session output
async fn get_claude_session_output(Path(session_id): Path<String>) -> Json<ApiResponse<String>> {
    // In web mode, output is streamed via WebSocket, not stored
    log::trace!("Output request for session: {}", session_id);
    Json(ApiResponse::success(
        "Output available via WebSocket only".to_string(),
    ))
}

/// Returns true when a WebSocket handshake's `Origin` header is loopback or
/// same-origin with the request's own `Host`. Browsers always send `Origin`
/// on WebSocket handshakes; non-browser clients (curl, CLI tooling) typically
/// omit it and rely on the control-token gate applied to this route instead
/// (see `control_auth_middleware`). Defends against cross-site WebSocket
/// hijacking even if a valid token leaked into third-party JS (finding
/// CRITICAL #1).
fn is_allowed_ws_origin(origin: Option<&str>, host: Option<&str>) -> bool {
    let Some(origin) = origin else {
        return true;
    };
    let authority = origin
        .strip_prefix("https://")
        .or_else(|| origin.strip_prefix("http://"))
        .unwrap_or(origin);
    let origin_host = authority.split('/').next().unwrap_or("");
    let origin_hostname = origin_host.split(':').next().unwrap_or("");

    if matches!(origin_hostname, "localhost" | "127.0.0.1" | "::1" | "[::1]") {
        return true;
    }

    host.map(|h| origin_host.eq_ignore_ascii_case(h))
        .unwrap_or(false)
}

/// WebSocket handler for Claude execution with streaming output.
///
/// Gated by two layers: the control-token middleware wrapping this route
/// (see `protected_routes` in `create_web_server`) and the Origin allowlist
/// check below (finding CRITICAL #1).
async fn claude_websocket(
    headers: axum::http::HeaderMap,
    AxumState(state): AxumState<AppState>,
    ws: WebSocketUpgrade,
) -> Response {
    let origin = headers
        .get(axum::http::header::ORIGIN)
        .and_then(|v| v.to_str().ok());
    let host = headers
        .get(axum::http::header::HOST)
        .and_then(|v| v.to_str().ok());
    if !is_allowed_ws_origin(origin, host) {
        log::warn!(
            "[ws/claude] rejected upgrade from disallowed Origin: {:?}",
            origin
        );
        return (
            StatusCode::FORBIDDEN,
            "cross-origin WebSocket upgrade rejected",
        )
            .into_response();
    }
    ws.on_upgrade(move |socket| claude_websocket_handler(socket, state))
}

async fn claude_websocket_handler(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let session_id = uuid::Uuid::new_v4().to_string();

    println!(
        "[TRACE] WebSocket handler started - session_id: {}",
        session_id
    );

    // Channel for sending output to WebSocket
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(100);

    // Store session in state
    {
        let mut sessions = state.active_sessions.lock().await;
        sessions.insert(session_id.clone(), tx);
        println!(
            "[TRACE] Session stored in state - active sessions count: {}",
            sessions.len()
        );
    }

    // Task to forward channel messages to WebSocket
    let session_id_for_forward = session_id.clone();
    let forward_task = tokio::spawn(async move {
        println!(
            "[TRACE] Forward task started for session {}",
            session_id_for_forward
        );
        while let Some(message) = rx.recv().await {
            println!("[TRACE] Forwarding message to WebSocket: {}", message);
            if sender.send(Message::Text(message.into())).await.is_err() {
                println!("[TRACE] Failed to send message to WebSocket - connection closed");
                break;
            }
        }
        println!(
            "[TRACE] Forward task ended for session {}",
            session_id_for_forward
        );
    });

    // Handle incoming messages from WebSocket
    println!("[TRACE] Starting to listen for WebSocket messages");
    while let Some(msg) = receiver.next().await {
        println!("[TRACE] Received WebSocket message: {:?}", msg);
        if let Ok(msg) = msg {
            if let Message::Text(text) = msg {
                println!(
                    "[TRACE] WebSocket text message received - length: {} chars",
                    text.len()
                );
                println!("[TRACE] WebSocket message content: {}", text);
                match serde_json::from_str::<ClaudeExecutionRequest>(&text) {
                    Ok(request) => {
                        println!("[TRACE] Successfully parsed request: {:?}", request);
                        println!("[TRACE] Command type: {}", request.command_type);
                        println!("[TRACE] Project path: {}", request.project_path);
                        println!("[TRACE] Prompt length: {} chars", request.prompt.len());

                        // Execute Claude command based on request type
                        let session_id_clone = session_id.clone();
                        let state_clone = state.clone();

                        println!(
                            "[TRACE] Spawning task to execute command: {}",
                            request.command_type
                        );
                        tokio::spawn(async move {
                            println!("[TRACE] Task started for command execution");
                            let result = match request.command_type.as_str() {
                                "execute" => {
                                    println!("[TRACE] Calling execute_claude_command");
                                    execute_claude_command(
                                        request.project_path,
                                        request.prompt,
                                        request.model.unwrap_or_default(),
                                        session_id_clone.clone(),
                                        state_clone.clone(),
                                        request.org_id.clone(),
                                    )
                                    .await
                                }
                                "continue" => {
                                    println!("[TRACE] Calling continue_claude_command");
                                    continue_claude_command(
                                        request.project_path,
                                        request.prompt,
                                        request.model.unwrap_or_default(),
                                        session_id_clone.clone(),
                                        state_clone.clone(),
                                        request.org_id.clone(),
                                    )
                                    .await
                                }
                                "resume" => {
                                    println!("[TRACE] Calling resume_claude_command");
                                    resume_claude_command(
                                        request.project_path,
                                        request.session_id.unwrap_or_default(),
                                        request.prompt,
                                        request.model.unwrap_or_default(),
                                        session_id_clone.clone(),
                                        state_clone.clone(),
                                        request.org_id.clone(),
                                    )
                                    .await
                                }
                                _ => {
                                    println!(
                                        "[TRACE] Unknown command type: {}",
                                        request.command_type
                                    );
                                    Err("Unknown command type".to_string())
                                }
                            };

                            println!(
                                "[TRACE] Command execution finished with result: {:?}",
                                result
                            );

                            // Send completion message
                            if let Some(sender) = state_clone
                                .active_sessions
                                .lock()
                                .await
                                .get(&session_id_clone)
                            {
                                let completion_msg = match result {
                                    Ok(_) => json!({
                                        "type": "completion",
                                        "status": "success"
                                    }),
                                    Err(e) => json!({
                                        "type": "completion",
                                        "status": "error",
                                        "error": e
                                    }),
                                };
                                println!("[TRACE] Sending completion message: {}", completion_msg);
                                let _ = sender.send(completion_msg.to_string()).await;
                            } else {
                                println!(
                                    "[TRACE] Session not found in active sessions when sending completion"
                                );
                            }
                        });
                    }
                    Err(e) => {
                        println!("[TRACE] Failed to parse WebSocket request: {}", e);
                        println!("[TRACE] Raw message that failed to parse: {}", text);

                        // Send error back to client
                        let error_msg = json!({
                            "type": "error",
                            "message": format!("Failed to parse request: {}", e)
                        });
                        if let Some(sender_tx) = state.active_sessions.lock().await.get(&session_id)
                        {
                            let _ = sender_tx.send(error_msg.to_string()).await;
                        }
                    }
                }
            } else if let Message::Close(_) = msg {
                println!("[TRACE] WebSocket close message received");
                break;
            } else {
                println!("[TRACE] Non-text WebSocket message received: {:?}", msg);
            }
        } else {
            println!("[TRACE] Error receiving WebSocket message");
        }
    }

    println!("[TRACE] WebSocket message loop ended");

    // Clean up session
    {
        let mut sessions = state.active_sessions.lock().await;
        sessions.remove(&session_id);
        println!(
            "[TRACE] Session {} removed from state - remaining sessions: {}",
            session_id,
            sessions.len()
        );
    }

    forward_task.abort();
    println!("[TRACE] WebSocket handler ended for session {}", session_id);
}

/// Recovers the shared axiomregent port slot even if a prior panicking
/// holder poisoned the lock. The guarded value is a plain `Option<u16>`
/// copy, so a poisoned lock does not imply a corrupted invariant here
/// (finding LOW #8).
fn read_axiomregent_port(slot: &std::sync::Mutex<Option<u16>>) -> Option<u16> {
    match slot.lock() {
        Ok(guard) => *guard,
        Err(poisoned) => *poisoned.into_inner(),
    }
}

/// Refuses to run Claude with `--dangerously-skip-permissions` from a
/// network-facing handler. That bypass exists for the local Tauri IPC path
/// only (`commands/*.rs`); it must never reach `/ws/claude`, which any LAN
/// client can reach once the server is bound to a non-loopback address
/// (finding HIGH #4, compounding CRITICAL #1).
fn reject_bypass_over_network(
    plan: crate::governed_claude::GovernedPlan,
    bypass_reason: Option<String>,
) -> Result<crate::governed_claude::GovernedPlan, String> {
    if matches!(plan, crate::governed_claude::GovernedPlan::Bypass) {
        let reason = bypass_reason.unwrap_or_else(|| "governance unavailable".to_string());
        return Err(format!(
            "Refusing to run Claude ungoverned over the network-facing web server: {reason}. \
             --dangerously-skip-permissions is not permitted on /ws/claude execute paths."
        ));
    }
    Ok(plan)
}

// Claude command execution functions for WebSocket streaming
async fn execute_claude_command(
    project_path: String,
    prompt: String,
    model: String,
    session_id: String,
    state: AppState,
    org_id: Option<String>,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    println!("[TRACE] execute_claude_command called:");
    println!("[TRACE]   project_path: {}", project_path);
    println!("[TRACE]   prompt length: {} chars", prompt.len());
    println!("[TRACE]   model: {}", model);
    println!("[TRACE]   session_id: {}", session_id);

    // Send initial message
    println!("[TRACE] Sending initial start message");
    send_to_session(
        &state,
        &session_id,
        json!({
            "type": "start",
            "message": "Starting Claude execution..."
        })
        .to_string(),
    )
    .await;

    // Find Claude binary (simplified for web mode)
    println!("[TRACE] Finding Claude binary...");
    let claude_path = find_claude_binary_web().map_err(|e| {
        let error = format!("Claude binary not found: {}", e);
        println!("[TRACE] Error finding Claude binary: {}", error);
        error
    })?;
    println!("[TRACE] Found Claude binary: {}", claude_path);

    // Create Claude command
    println!("[TRACE] Creating Claude command...");
    let mut cmd = Command::new(&claude_path);
    let announce_port = read_axiomregent_port(&state.axiomregent_port);
    let (plan, bypass_reason) = crate::governed_claude::plan_governed(
        announce_port,
        crate::governed_claude::grants_json_claude_default(),
    )?;
    let plan = reject_bypass_over_network(plan, bypass_reason)?;
    let mut args: Vec<String> = vec![
        "-p".into(),
        prompt.clone(),
        "--model".into(),
        model.clone(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
    ];
    crate::governed_claude::append_claude_governance_args(&mut args, &plan);
    println!(
        "[TRACE] Command: {} {:?} (in dir: {})",
        claude_path, args, project_path
    );
    cmd.args(args);
    cmd.current_dir(&project_path);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    if let Some(ref oid) = org_id {
        cmd.env("OPC_WORKSPACE_ID", oid);
    }

    // Spawn Claude process
    println!("[TRACE] Spawning Claude process...");
    let mut child = cmd.spawn().map_err(|e| {
        let error = format!("Failed to spawn Claude: {}", e);
        println!("[TRACE] Spawn error: {}", error);
        error
    })?;
    println!("[TRACE] Claude process spawned successfully");

    // Get stdout for streaming
    let stdout = child.stdout.take().ok_or_else(|| {
        println!("[TRACE] Failed to get stdout from child process");
        "Failed to get stdout".to_string()
    })?;
    let stdout_reader = BufReader::new(stdout);

    println!("[TRACE] Starting to read Claude output...");
    // Stream output line by line
    let mut lines = stdout_reader.lines();
    let mut line_count = 0;
    while let Ok(Some(line)) = lines.next_line().await {
        line_count += 1;
        println!("[TRACE] Claude output line {}: {}", line_count, line);

        // Send each line to WebSocket
        let message = json!({
            "type": "output",
            "content": line
        })
        .to_string();
        println!("[TRACE] Sending output message to session: {}", message);
        send_to_session(&state, &session_id, message).await;
    }

    println!(
        "[TRACE] Finished reading Claude output ({} lines total)",
        line_count
    );

    // Wait for process to complete
    println!("[TRACE] Waiting for Claude process to complete...");
    let exit_status = child.wait().await.map_err(|e| {
        let error = format!("Failed to wait for Claude: {}", e);
        println!("[TRACE] Wait error: {}", error);
        error
    })?;

    println!(
        "[TRACE] Claude process completed with status: {:?}",
        exit_status
    );

    if !exit_status.success() {
        let error = format!(
            "Claude execution failed with exit code: {:?}",
            exit_status.code()
        );
        println!("[TRACE] Claude execution failed: {}", error);
        return Err(error);
    }

    println!("[TRACE] execute_claude_command completed successfully");
    Ok(())
}

async fn continue_claude_command(
    project_path: String,
    prompt: String,
    model: String,
    session_id: String,
    state: AppState,
    org_id: Option<String>,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    send_to_session(
        &state,
        &session_id,
        json!({
            "type": "start",
            "message": "Continuing Claude session..."
        })
        .to_string(),
    )
    .await;

    // Find Claude binary
    let claude_path =
        find_claude_binary_web().map_err(|e| format!("Claude binary not found: {}", e))?;

    // Create continue command
    let mut cmd = Command::new(&claude_path);
    let announce_port = read_axiomregent_port(&state.axiomregent_port);
    let (plan, bypass_reason) = crate::governed_claude::plan_governed(
        announce_port,
        crate::governed_claude::grants_json_claude_default(),
    )?;
    let plan = reject_bypass_over_network(plan, bypass_reason)?;
    let mut args: Vec<String> = vec![
        "-c".into(),
        "-p".into(),
        prompt.clone(),
        "--model".into(),
        model.clone(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
    ];
    crate::governed_claude::append_claude_governance_args(&mut args, &plan);
    cmd.args(args);
    cmd.current_dir(&project_path);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    if let Some(ref oid) = org_id {
        cmd.env("OPC_WORKSPACE_ID", oid);
    }

    // Spawn and stream output
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn Claude: {}", e))?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let stdout_reader = BufReader::new(stdout);

    let mut lines = stdout_reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        send_to_session(
            &state,
            &session_id,
            json!({
                "type": "output",
                "content": line
            })
            .to_string(),
        )
        .await;
    }

    let exit_status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for Claude: {}", e))?;
    if !exit_status.success() {
        return Err(format!(
            "Claude execution failed with exit code: {:?}",
            exit_status.code()
        ));
    }

    Ok(())
}

async fn resume_claude_command(
    project_path: String,
    claude_session_id: String,
    prompt: String,
    model: String,
    session_id: String,
    state: AppState,
    org_id: Option<String>,
) -> Result<(), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    println!(
        "[resume_claude_command] Starting with project_path: {}, claude_session_id: {}, prompt: {}, model: {}",
        project_path, claude_session_id, prompt, model
    );

    send_to_session(
        &state,
        &session_id,
        json!({
            "type": "start",
            "message": "Resuming Claude session..."
        })
        .to_string(),
    )
    .await;

    // Find Claude binary
    println!("[resume_claude_command] Finding Claude binary...");
    let claude_path =
        find_claude_binary_web().map_err(|e| format!("Claude binary not found: {}", e))?;
    println!(
        "[resume_claude_command] Found Claude binary: {}",
        claude_path
    );

    // Create resume command
    println!("[resume_claude_command] Creating command...");
    let mut cmd = Command::new(&claude_path);
    let announce_port = read_axiomregent_port(&state.axiomregent_port);
    let (plan, bypass_reason) = crate::governed_claude::plan_governed(
        announce_port,
        crate::governed_claude::grants_json_claude_default(),
    )?;
    let plan = reject_bypass_over_network(plan, bypass_reason)?;
    let mut args: Vec<String> = vec![
        "--resume".into(),
        claude_session_id.clone(),
        "-p".into(),
        prompt.clone(),
        "--model".into(),
        model.clone(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
    ];
    crate::governed_claude::append_claude_governance_args(&mut args, &plan);
    println!(
        "[resume_claude_command] Command: {} {:?} (in dir: {})",
        claude_path, args, project_path
    );
    cmd.args(args);
    cmd.current_dir(&project_path);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    if let Some(ref oid) = org_id {
        cmd.env("OPC_WORKSPACE_ID", oid);
    }

    // Spawn and stream output
    println!("[resume_claude_command] Spawning process...");
    let mut child = cmd.spawn().map_err(|e| {
        let error = format!("Failed to spawn Claude: {}", e);
        println!("[resume_claude_command] Spawn error: {}", error);
        error
    })?;
    println!("[resume_claude_command] Process spawned successfully");
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let stdout_reader = BufReader::new(stdout);

    let mut lines = stdout_reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        send_to_session(
            &state,
            &session_id,
            json!({
                "type": "output",
                "content": line
            })
            .to_string(),
        )
        .await;
    }

    let exit_status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for Claude: {}", e))?;
    if !exit_status.success() {
        return Err(format!(
            "Claude execution failed with exit code: {:?}",
            exit_status.code()
        ));
    }

    Ok(())
}

async fn send_to_session(state: &AppState, session_id: &str, message: String) {
    println!("[TRACE] send_to_session called for session: {}", session_id);
    println!("[TRACE] Message: {}", message);

    let sessions = state.active_sessions.lock().await;
    if let Some(sender) = sessions.get(session_id) {
        println!("[TRACE] Found session in active sessions, sending message...");
        match sender.send(message).await {
            Ok(_) => println!("[TRACE] Message sent successfully"),
            Err(e) => println!("[TRACE] Failed to send message: {}", e),
        }
    } else {
        println!(
            "[TRACE] Session {} not found in active sessions",
            session_id
        );
        println!(
            "[TRACE] Active sessions: {:?}",
            sessions.keys().collect::<Vec<_>>()
        );
    }
}

// ---------------------------------------------------------------------------
// Schedule route handlers (Feature 079)
// ---------------------------------------------------------------------------

/// GET /api/schedules — list all schedules
async fn list_schedules(AxumState(state): AxumState<AppState>) -> Json<ApiResponse<Vec<Schedule>>> {
    let store = state.schedules.lock().await;
    let mut schedules: Vec<Schedule> = store.values().cloned().collect();
    // Return most recently created first
    schedules.sort_by_key(|s| std::cmp::Reverse(s.created_at));
    Json(ApiResponse::success(schedules))
}

/// POST /api/schedules — create a schedule
async fn create_schedule(
    AxumState(state): AxumState<AppState>,
    Json(req): Json<CreateScheduleRequest>,
) -> impl IntoResponse {
    let id = uuid::Uuid::new_v4().to_string();
    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let schedule = Schedule {
        id: id.clone(),
        name: req.name,
        prompt: req.prompt,
        trigger: req.trigger,
        enabled: true,
        last_run_at: None,
        created_at,
    };
    let mut store = state.schedules.lock().await;
    store.insert(id, schedule.clone());
    (StatusCode::CREATED, Json(ApiResponse::success(schedule)))
}

/// GET /api/schedules/:id — get a single schedule
async fn get_schedule(
    Path(id): Path<String>,
    AxumState(state): AxumState<AppState>,
) -> impl IntoResponse {
    let store = state.schedules.lock().await;
    match store.get(&id) {
        Some(s) => (StatusCode::OK, Json(ApiResponse::success(s.clone()))).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::<Schedule>::error(format!(
                "schedule {id} not found"
            ))),
        )
            .into_response(),
    }
}

/// DELETE /api/schedules/:id — delete a schedule
async fn delete_schedule(
    Path(id): Path<String>,
    AxumState(state): AxumState<AppState>,
) -> impl IntoResponse {
    let mut store = state.schedules.lock().await;
    if store.remove(&id).is_some() {
        Json(ApiResponse::success(())).into_response()
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::<()>::error(format!("schedule {id} not found"))),
        )
            .into_response()
    }
}

/// PUT /api/schedules/:id/toggle — toggle enabled flag
async fn toggle_schedule(
    Path(id): Path<String>,
    AxumState(state): AxumState<AppState>,
) -> impl IntoResponse {
    let mut store = state.schedules.lock().await;
    match store.get_mut(&id) {
        Some(s) => {
            s.enabled = !s.enabled;
            let updated = s.clone();
            (StatusCode::OK, Json(ApiResponse::success(updated))).into_response()
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::<Schedule>::error(format!(
                "schedule {id} not found"
            ))),
        )
            .into_response(),
    }
}

/// Returns true when a browser `Origin` header names a loopback host.
/// Shared by the CORS layer (finding MEDIUM #6); the app is served
/// same-origin to its own browser clients, so CORS only needs to admit
/// genuinely cross-origin loopback callers (e.g. a local Vite dev server on
/// a different port).
fn is_localhost_origin(origin: &axum::http::HeaderValue, _parts: &axum::http::request::Parts) -> bool {
    origin
        .to_str()
        .map(|s| {
            let authority = s
                .strip_prefix("https://")
                .or_else(|| s.strip_prefix("http://"))
                .unwrap_or(s);
            let host = authority
                .split('/')
                .next()
                .unwrap_or("")
                .split(':')
                .next()
                .unwrap_or("");
            matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
        })
        .unwrap_or(false)
}

/// Create the web server.
///
/// `axiomregent_port` is a shared slot that sidecars update when they discover
/// the live port (spec 090-2). Passing the same Arc that `SidecarState` holds
/// ensures the web server always sees the latest value.
///
/// `bind_addr` defaults to loopback-only (`127.0.0.1`) at the call sites in
/// `start_web_mode`; binding a non-loopback address is opt-in via `--host`
/// or `-H` (finding HIGH #2).
pub async fn create_web_server(
    port: u16,
    bind_addr: std::net::IpAddr,
    axiomregent_port: Arc<std::sync::Mutex<Option<u16>>>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Generate a fresh token for this session.
    let control_auth = ControlAuth {
        token: uuid::Uuid::new_v4().to_string(),
    };

    // The control token above is always a freshly generated UUID, so it is
    // never empty; a "token is present" check here would be permanently
    // dead code. The invariant a non-loopback bind actually has to uphold
    // is that the token is kept OUT of the unauthenticated `/` page
    // (finding HIGH: control-token leak via unauthenticated HTML), not
    // merely that a token exists. That is enforced by construction below:
    // `served_html` only calls `inject_control_token` on the loopback
    // branch, so a non-loopback bind can never serve a page carrying the
    // token.
    const FRONTEND_HTML: &str = include_str!("../../dist/index.html");
    let served_html: Bytes = if bind_addr.is_loopback() {
        Bytes::from(inject_control_token(FRONTEND_HTML, &control_auth.token))
    } else {
        Bytes::from_static(FRONTEND_HTML.as_bytes())
    };

    let state = AppState {
        active_sessions: Arc::new(Mutex::new(std::collections::HashMap::new())),
        schedules: Arc::new(Mutex::new(std::collections::HashMap::new())),
        axiomregent_port,
        control_token: control_auth.token.clone(),
        served_html,
    };

    // CORS layer, restricted to loopback origins (finding MEDIUM #6).
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(is_localhost_origin))
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers(Any);

    // Control API routes, protected by the token auth middleware.
    let control_routes = Router::new()
        .route("/status", get(control_status))
        .route("/projects", get(control_list_projects))
        .route("/projects/{project_id}/sessions", get(control_get_sessions))
        .route(
            "/sessions/{session_id}/messages/{project_id}",
            get(control_get_messages),
        )
        // Feature: REMOTE_CONTROL_CLI
        .route(
            "/sessions/{session_id}/messages",
            post(control_send_message),
        )
        // Feature: REMOTE_CONTROL_CLI
        .route("/sessions/{session_id}", delete(control_cancel_session))
        .layer(axum::middleware::from_fn_with_state(
            control_auth.clone(),
            control_auth_middleware,
        ));

    // Public (unauthenticated) routes: the app shell plus static assets. No
    // session data lives here. On a loopback bind the served HTML embeds
    // the control token (see `inject_control_token`) so same-origin
    // browser JS can authenticate its own /api and /ws/claude calls; on a
    // non-loopback bind it does not, since this route has no auth of its
    // own (see `served_html`).
    let public_routes: Router<AppState> = Router::new()
        .route("/", get(serve_frontend))
        .route("/index.html", get(serve_frontend))
        .nest_service("/assets", ServeDir::new("../dist/assets"))
        .nest_service("/vite.svg", ServeDir::new("../dist/vite.svg"));

    // Protected API + WebSocket routes, control-token gated the same way as
    // `/control` (findings CRITICAL #1, HIGH #3).
    let protected_routes: Router<AppState> = Router::new()
        // API routes (REST API equivalent of Tauri commands)
        .route("/api/projects", get(get_projects))
        .route("/api/projects/{project_id}/sessions", get(get_sessions))
        .route("/api/agents", get(get_agents))
        .route("/api/usage", get(get_usage))
        // Settings and configuration
        .route("/api/settings/claude", get(get_claude_settings))
        .route("/api/settings/claude/version", get(check_claude_version))
        .route(
            "/api/settings/claude/installations",
            get(list_claude_installations),
        )
        .route("/api/settings/system-prompt", get(get_system_prompt))
        // Session management
        .route("/api/sessions/new", get(open_new_session))
        // Slash commands
        .route("/api/slash-commands", get(list_slash_commands))
        // MCP
        .route("/api/mcp/servers", get(mcp_list))
        // Session history
        .route(
            "/api/sessions/{session_id}/history/{project_id}",
            get(load_session_history),
        )
        .route("/api/sessions/running", get(list_running_claude_sessions))
        // Claude execution endpoints (read-only in web mode)
        .route("/api/sessions/execute", get(execute_claude_code))
        .route("/api/sessions/continue", get(continue_claude_code))
        .route("/api/sessions/resume", get(resume_claude_code))
        .route(
            "/api/sessions/{sessionId}/cancel",
            get(cancel_claude_execution),
        )
        .route(
            "/api/sessions/{sessionId}/output",
            get(get_claude_session_output),
        )
        // WebSocket endpoint for real-time Claude execution
        .route("/ws/claude", get(claude_websocket))
        // Schedule CRUD routes (Feature 079)
        .route("/api/schedules", get(list_schedules).post(create_schedule))
        .route(
            "/api/schedules/{id}",
            get(get_schedule).delete(delete_schedule),
        )
        .route("/api/schedules/{id}/toggle", put(toggle_schedule))
        .layer(axum::middleware::from_fn_with_state(
            control_auth.clone(),
            control_auth_middleware,
        ));

    // Create router with API endpoints
    let app = Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        // Control API (token-authenticated, for oap-ctl)
        .nest("/control", control_routes)
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::new(bind_addr, port);
    println!("Web server running on http://{addr}");
    if bind_addr.is_loopback() {
        println!("Loopback-only bind; not reachable from the network. Pass --host to opt in.");
    } else {
        println!("Access from phone: http://YOUR_PC_IP:{}", port);
        log::warn!(
            "opc-web bound to non-loopback address {bind_addr}: reachable from the network. \
             /api and /ws/claude require the control token (see ~/.oap/control.token)."
        );
        // The served `/` page carries no control token on a non-loopback
        // bind (see `served_html`) so it cannot be scraped by an
        // unauthenticated GET. Print it once here so the operator can
        // supply it to clients out of band.
        eprintln!(
            "opc-web control token (not embedded in the served page on this non-loopback \
             bind; supply it to clients out of band): {}",
            control_auth.token
        );
    }

    let listener = TcpListener::bind(addr).await?;

    // Extract the actual bound port (may differ from requested if OS chose one).
    let bound_port = listener.local_addr()?.port();

    // Write lockfiles so oap-ctl can discover this server.
    if let Err(e) = write_control_files(bound_port, &control_auth.token) {
        log::warn!("Could not write control lockfiles: {}", e);
    } else {
        log::info!(
            "Control API listening on port {} (token written to ~/.oap/)",
            bound_port
        );
    }

    // Register cleanup on process exit via a simple Drop guard on the current task.
    // tokio::signal is not available in all build targets so we use a simpler approach:
    // spawn a background task that waits for Ctrl-C and cleans up.
    tokio::spawn(async {
        let _ = tokio::signal::ctrl_c().await;
        cleanup_control_files();
    });

    axum::serve(listener, app).await?;

    // Clean up on normal exit (e.g. programmatic shutdown).
    cleanup_control_files();

    Ok(())
}

/// Start web server mode (alternative to Tauri GUI).
///
/// In standalone web mode there is no Tauri SidecarState. We seed from the
/// environment variable (if set) **and** attempt to spawn axiomregent as a
/// standalone process so the port slot is updated even when the sidecar starts
/// after the web server (spec 090 SC-090-3).
///
/// `host` defaults to `127.0.0.1` (loopback-only) when not given; passing an
/// explicit non-loopback value is the opt-in required by finding HIGH #2.
pub async fn start_web_mode(
    port: Option<u16>,
    host: Option<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    let port = port.unwrap_or(8080);
    let host_str = host.unwrap_or_else(|| "127.0.0.1".to_string());
    let bind_addr: std::net::IpAddr = host_str
        .parse()
        .map_err(|e| format!("invalid --host value {host_str:?}: {e}"))?;
    let initial_port: Option<u16> = std::env::var("OPC_AXIOMREGENT_PORT")
        .ok()
        .and_then(|s| s.parse().ok());
    let axiomregent_port = Arc::new(std::sync::Mutex::new(initial_port));

    // Spawn axiomregent in the background if no port was provided at startup.
    // This closes the race where the sidecar starts after the web server (SC-090-3).
    if initial_port.is_none() {
        crate::sidecars::spawn_axiomregent_standalone(axiomregent_port.clone());
    }

    println!("🚀 Starting Opcode in web server mode...");
    create_web_server(port, bind_addr, axiomregent_port).await
}
