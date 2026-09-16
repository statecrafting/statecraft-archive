//! Sidecar lifecycle and port discovery.
//!
//! **axiomregent** announces a local probe port on **stderr** as:
//!   `OPC_AXIOMREGENT_PORT=<port>`
//! (Stdout is reserved for MCP framing.)
//!
//! `SidecarState` is managed via Tauri and holds discovered ports where applicable.
//! The frontend queries them via `get_sidecar_ports`.
//!
//! Spec 183 FR-T1 (sidecar liveness gate) adds a TCP-connect-based liveness
//! check on top of the announcement parser: `check_axiomregent_alive` opens a
//! short-lived TCP connection to the announced probe port and reports whether
//! the diagnostic listener in `axiomregent::main` is still accepting. The
//! probe port is a pure liveness signal (no HTTP, no JSON-RPC payload), so
//! the binary "connect succeeded" outcome is the entire green-light contract.

use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::net::TcpStream;

// ============================================================================
// Managed state
// ============================================================================

/// Holds the dynamically-discovered port for axiomregent AND the live
/// `CommandChild` handle so spec 183 FR-T6 (Quit teardown) can signal the
/// process before exit. The handle MUST be retained past announcement
/// parse — Stage A/B had a debt here where `spawn_axiomregent`'s receiver
/// loop broke after the port line, dropping the Child and leaving no
/// surface to kill on Quit; Stage C closes that.
///
/// FR-T1's diagnostic-listener semantics mean we don't need the handle to
/// re-evaluate liveness (that's TCP-connect-driven, see
/// `probe_port_alive`). The handle is purely for teardown + termination
/// observation.
#[derive(Default)]
pub struct SidecarState {
    pub axiomregent_port: Arc<Mutex<Option<u16>>>,
    /// `None` before spawn, `Some(child)` once the sidecar is running.
    /// Reset to `None` only when teardown takes the handle (Quit path) or
    /// when the receiver loop observes `CommandEvent::Terminated`.
    pub axiomregent_child: Arc<Mutex<Option<CommandChild>>>,
}

/// Spec 183 FR-T5 — Tauri event emitted when any boot-gate precondition
/// is lost mid-session. The frontend's App.tsx listens for this and
/// flips `bootGateOpen` back to `false` so the cockpit unmounts and
/// `<BootGate>` re-mounts. Payload carries which precondition lapsed and
/// a short reason for diagnostic surface.
pub const EVENT_BOOT_GATE_PRECONDITION_LOST: &str = "boot-gate-precondition-lost";

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PreconditionLostEvent {
    /// One of `"sidecar"`, `"duplex"`, `"org-id"` — names the lapsed gate.
    pub precondition: String,
    /// Short diagnostic string; surfaced in the boot-state UI verbatim.
    pub reason: String,
}

#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct SidecarPorts {
    pub axiomregent: Option<u16>,
}

/// Returns the currently-known ports for sidecars that use port discovery.
/// A `None` entry means the sidecar hasn't announced its port yet.
#[tauri::command]
#[specta::specta]
pub fn get_sidecar_ports(state: State<'_, SidecarState>) -> SidecarPorts {
    SidecarPorts {
        axiomregent: *state.axiomregent_port.lock().unwrap(),
    }
}

/// Spec 183 FR-T1(b) — TCP-connect liveness probe against the announced
/// axiomregent port. Returns `true` when the diagnostic listener accepted
/// the connection within the configured timeout; `false` on connection
/// refused, timeout, or any other transport error. The probe port carries
/// no protocol — connection establishment is the entire green-light test.
///
/// FR-T1 explicitly excludes absolute latency budgets from the binding
/// surface; `LIVENESS_TIMEOUT` is an implementer choice that keeps the boot
/// UI responsive on a healthy local loopback while leaving room for slow
/// machines. Adjust freely — the contract is "bounded timeout," not "X ms."
const LIVENESS_TIMEOUT: Duration = Duration::from_millis(500);

#[tauri::command]
#[specta::specta]
pub async fn check_axiomregent_alive(state: State<'_, SidecarState>) -> Result<bool, String> {
    let port = match *state.axiomregent_port.lock().unwrap() {
        Some(p) => p,
        None => return Ok(false),
    };
    Ok(probe_port_alive(port).await)
}

async fn probe_port_alive(port: u16) -> bool {
    let addr = format!("127.0.0.1:{port}");
    match tokio::time::timeout(LIVENESS_TIMEOUT, TcpStream::connect(&addr)).await {
        Ok(Ok(_stream)) => true,
        // Connection refused, timeout, or any other transport failure all
        // collapse to "not alive" — the boot gate's only question is
        // whether the listener is accepting.
        _ => false,
    }
}

/// Spec 183 — unified boot-gate status query. Combines FR-T1 (sidecar
/// liveness) and FR-T2 (org session materialised + sync.hello received)
/// into a single observable the boot-state UI subscribes to. Computed
/// fresh on every call; the frontend polls (not subscribes) during the
/// boot phase per FR-T4's explicit-retry posture.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
pub struct BootGateStatus {
    /// FR-T1: probe port announced AND TCP-connect succeeds.
    pub sidecar_alive: bool,
    /// FR-T2: StatecraftState has a non-empty org_id AND the duplex
    /// consumer has received `sync.hello` from statecraft.
    pub org_session_ready: bool,
    /// Convenience: announced probe port (None if unannounced).
    pub axiomregent_port: Option<u16>,
    /// Convenience: org_id when present, for surface display only.
    pub org_id: Option<String>,
}

/// Spec 183 FR-T4 — user-initiated retry of a failed sidecar
/// precondition. Takes the retained `CommandChild` handle (if any),
/// kills it, clears the port + child slots, then re-spawns axiomregent
/// fresh. This is the *act on failure* path the spec binds: distinct
/// from the BootGate's status poll (which is observation, not retry).
///
/// Calling this while a healthy sidecar is running will still tear it
/// down and start a new one — the contract is "respawn on demand,"
/// matching the user's mental model of clicking Retry to recover from
/// an apparently dead sidecar.
#[tauri::command]
#[specta::specta]
pub fn respawn_axiomregent(app: AppHandle) -> Result<(), String> {
    log::info!("respawn_axiomregent: tearing down current sidecar (spec 183 FR-T4)");
    let state = app.state::<SidecarState>();
    let child_opt = {
        let mut guard = state
            .axiomregent_child
            .lock()
            .map_err(|e| format!("lock child slot: {e}"))?;
        guard.take()
    };
    if let Some(child) = child_opt {
        let pid = child.pid();
        match child.kill() {
            Ok(()) => log::info!("respawn_axiomregent: killed pid {pid}"),
            Err(e) => log::warn!(
                "respawn_axiomregent: failed to kill pid {pid}: {e}"
            ),
        }
    }
    {
        let mut port_guard = state
            .axiomregent_port
            .lock()
            .map_err(|e| format!("lock port slot: {e}"))?;
        *port_guard = None;
    }
    spawn_axiomregent(&app);
    Ok(())
}

/// Spec 183 FR-T6 — boot-state Quit action with deterministic sidecar
/// teardown. Takes the retained `CommandChild` handle out of
/// `SidecarState`, signals kill (the shell plugin uses
/// `SharedChild::kill` which is SIGKILL-equivalent on Unix), then calls
/// `app.exit(0)`. This MUST happen in this order: orphaned axiomregent
/// processes collide with the next OPC launch on the probe-port bind
/// (the canonical "OPC won't start after I quit it" footgun the spec
/// forecloses).
///
/// Note on signal type: the binding shape of FR-T6 is "MUST NOT leave
/// process tree in a state where the next launch could collide" — not a
/// specific signal sequence. `kill()` here goes through
/// `tauri_plugin_shell::process::CommandChild::kill` → `SharedChild::kill`,
/// which on Unix sends SIGKILL (immediate) and on Windows uses
/// TerminateProcess. SIGKILL is harsher than the SIGTERM-with-timeout
/// the spec's rationale describes, but it satisfies the binding ("don't
/// leave a ghost process") and is honest: a graceful SIGTERM pathway
/// would require shelling out to `kill -TERM <pid>` + sleep + SIGKILL,
/// which adds complexity without changing the user-observable outcome
/// (sidecar gone, next launch clean).
/// Spec 183 FR-T3 — boot-state "Open logs" affordance. Resolves the
/// platform's app log dir (set up by `tauri_plugin_log` with
/// `TargetKind::LogDir { file_name: Some("opc") }`) and asks the OS to
/// open it in the native file browser. The dir is created on first
/// resolve so the open succeeds on a fresh install before any log line
/// has been written.
///
/// FR-T3 binds the *existence* of the affordance, not its target
/// representation; the implementation latitude here is intentional and
/// out of scope per spec §7.
#[tauri::command]
#[specta::specta]
pub fn open_logs_folder(app: AppHandle) -> Result<(), String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("resolve app_log_dir: {e}"))?;
    if !log_dir.exists()
        && let Err(e) = std::fs::create_dir_all(&log_dir)
    {
        return Err(format!(
            "create log dir {}: {e}",
            log_dir.display(),
        ));
    }
    let path_str = log_dir
        .to_str()
        .ok_or_else(|| format!("non-utf8 log path: {}", log_dir.display()))?;
    app.opener()
        .open_path(path_str, None::<&str>)
        .map_err(|e| format!("open log dir: {e}"))
}

#[tauri::command]
#[specta::specta]
pub fn quit_opc(app: AppHandle) {
    log::info!("quit_opc: shutting down OPC (spec 183 FR-T6)");

    // Take the sidecar handle. If it's None — either the sidecar never
    // spawned, or the Terminated observer already cleared it — there's
    // nothing to kill, but we still exit cleanly.
    let state = app.state::<SidecarState>();
    let child_opt = {
        let mut guard = state.axiomregent_child.lock().unwrap();
        guard.take()
    };
    if let Some(child) = child_opt {
        let pid = child.pid();
        match child.kill() {
            Ok(()) => log::info!("quit_opc: killed axiomregent (pid {pid})"),
            Err(e) => log::warn!("quit_opc: failed to kill axiomregent (pid {pid}): {e}"),
        }
    } else {
        log::info!("quit_opc: no axiomregent handle retained — nothing to tear down");
    }

    app.exit(0);
}

#[tauri::command]
#[specta::specta]
pub async fn boot_gate_status(app: AppHandle) -> Result<BootGateStatus, String> {
    let port = *app
        .state::<SidecarState>()
        .axiomregent_port
        .lock()
        .unwrap();
    let sidecar_alive = match port {
        Some(p) => probe_port_alive(p).await,
        None => false,
    };

    // Org-session readiness combines org_id presence on StatecraftState
    // with sync.hello receipt on the duplex consumer. Either missing → not
    // ready. The duplex consumer is only spawned when both base URL and JWT
    // are loaded (see lib.rs); before that, sync_hello_received() is false
    // and the gate stays closed — which is exactly the expected pre-login
    // boot state.
    let (org_id, has_org) = {
        match app.try_state::<crate::commands::statecraft_client::StatecraftState>() {
            Some(sc_state) => match sc_state.current() {
                Some(client) => {
                    let id = client.org_id();
                    let has = !id.is_empty();
                    (Some(id).filter(|s| !s.is_empty()), has)
                }
                None => (None, false),
            },
            None => (None, false),
        }
    };
    let sync_hello = app
        .try_state::<crate::commands::sync_client::SyncClientState>()
        .map(|s| s.sync_hello_received())
        .unwrap_or(false);
    let org_session_ready = has_org && sync_hello;

    Ok(BootGateStatus {
        sidecar_alive,
        org_session_ready,
        axiomregent_port: port,
        org_id,
    })
}

// ============================================================================
// Spawn helpers
// ============================================================================

/// Parse a line for `OPC_AXIOMREGENT_PORT=<u16>` (first line win).
pub fn parse_axiomregent_port_line(line: &str) -> Option<u16> {
    line.trim()
        .strip_prefix("OPC_AXIOMREGENT_PORT=")
        .and_then(|s| s.parse::<u16>().ok())
}

/// Spawn axiomregent and watch stderr for `OPC_AXIOMREGENT_PORT=<port>`.
///
/// Spec 183 stage C — the receiver loop is now lifetime-of-process: after
/// the port-announcement parse, the loop stays alive to observe
/// `CommandEvent::Terminated`, which fires FR-T5(a) (sidecar termination
/// → precondition-loss event → boot-state restore). The spawned
/// `CommandChild` handle is retained on `SidecarState.axiomregent_child`
/// so `quit_opc` can SIGTERM it during teardown (FR-T6).
pub fn spawn_axiomregent(app: &AppHandle) {
    let port_slot = Arc::clone(&app.state::<SidecarState>().axiomregent_port);
    let child_slot = Arc::clone(&app.state::<SidecarState>().axiomregent_child);
    let cmd = match app.shell().sidecar("axiomregent") {
        Ok(c) => c,
        Err(e) => {
            log::error!("Failed to create axiomregent sidecar command: {e}");
            return;
        }
    };
    // A Finder-launched macOS `.app` runs with cwd = `/`, so axiomregent's
    // default data dir (`<cwd>/.axiomregent/data`, see
    // `crates/axiomregent/src/config/mod.rs`) resolves under the read-only
    // root filesystem and `init_hiqlite` fails — the sidecar exits 1 before
    // it can bind its probe port, so FR-T1(b) can never go green and the boot
    // gate is stuck. Pin a writable data dir (and a writable cwd) on the child
    // so the bundled sidecar starts the same way a repo-root `cargo run` does.
    let cmd = match app.path().app_data_dir() {
        Ok(base) => {
            let data_dir = base.join("axiomregent").join("data");
            if let Err(e) = std::fs::create_dir_all(&data_dir) {
                log::warn!(
                    "axiomregent data dir create failed ({}): {e}",
                    data_dir.display()
                );
            }
            cmd.env("AXIOMREGENT_DATA_DIR", &data_dir).current_dir(&base)
        }
        Err(e) => {
            log::warn!(
                "app_data_dir unavailable; axiomregent falls back to its cwd-relative default: {e}"
            );
            cmd
        }
    };
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let (mut rx, child) = match cmd.spawn() {
            Ok(r) => r,
            Err(e) => {
                log::error!("Failed to spawn axiomregent: {e}");
                return;
            }
        };
        // Retain the Child handle for FR-T6 teardown. `quit_opc` takes
        // it out and calls kill(); if the receiver loop observes
        // Terminated first (sidecar crash), it clears the slot to None
        // before emitting the precondition-loss event.
        *child_slot.lock().unwrap() = Some(child);

        let mut port_announced = false;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    if !port_announced
                        && let Some(port) = parse_axiomregent_port_line(&line)
                    {
                        *port_slot.lock().unwrap() = Some(port);
                        port_announced = true;
                        log::info!("axiomregent probe port {port}");
                        // Do NOT break — keep the loop alive for FR-T5(a).
                    } else {
                        // Surface the sidecar's own stderr. Previously
                        // swallowed, which is why a startup failure (e.g. the
                        // data-dir error above) showed up only as an opaque
                        // "terminated code 1" with no cause. FR-T1
                        // diagnosability.
                        let trimmed = line.trim_end();
                        if !trimmed.is_empty() {
                            log::warn!("axiomregent[stderr]: {trimmed}");
                        }
                    }
                }
                // Stdout is reserved for MCP framing — do not log frames.
                // Tolerate (but don't require) a port line here for robustness
                // against older sidecar builds that announced on stdout. Once
                // the port is known this arm falls through to `_` below.
                CommandEvent::Stdout(bytes) if !port_announced => {
                    let line = String::from_utf8_lossy(&bytes);
                    if let Some(port) = parse_axiomregent_port_line(&line) {
                        *port_slot.lock().unwrap() = Some(port);
                        port_announced = true;
                        log::info!("axiomregent probe port {port}");
                    }
                }
                CommandEvent::Error(e) => {
                    log::error!("axiomregent error: {e}");
                    // Treat receiver-stream errors as a terminal precondition
                    // loss; the sidecar is unreachable through the shell IPC.
                    *child_slot.lock().unwrap() = None;
                    *port_slot.lock().unwrap() = None;
                    emit_precondition_lost(
                        &app_handle,
                        "sidecar",
                        &format!("receiver stream error: {e}"),
                    );
                    break;
                }
                CommandEvent::Terminated(status) => {
                    log::warn!("axiomregent terminated: {status:?}");
                    *child_slot.lock().unwrap() = None;
                    *port_slot.lock().unwrap() = None;
                    emit_precondition_lost(
                        &app_handle,
                        "sidecar",
                        &format!("axiomregent process terminated: {status:?}"),
                    );
                    break;
                }
                _ => {}
            }
        }
    });
}

/// Spec 183 FR-T5 — emit a boot-gate precondition-loss event. Visible
/// across the crate so the duplex consumer (FR-T5(b)) and the auth
/// logout path (FR-T5(c)) can drive the same Tauri event the sidecar
/// observer (FR-T5(a)) uses.
pub(crate) fn emit_precondition_lost(app: &AppHandle, precondition: &str, reason: &str) {
    let payload = PreconditionLostEvent {
        precondition: precondition.to_string(),
        reason: reason.to_string(),
    };
    if let Err(e) = app.emit(EVENT_BOOT_GATE_PRECONDITION_LOST, &payload) {
        log::warn!("failed to emit boot-gate-precondition-lost ({precondition}): {e}");
    }
}

/// Spawn axiomregent as a standalone OS process (no Tauri shell).
///
/// Used by `start_web_mode` where there is no Tauri `AppHandle`. Watches stderr
/// for the `OPC_AXIOMREGENT_PORT=<port>` announcement and writes it into
/// `port_slot`, fixing the race described in spec 090 SC-090-3.
pub fn spawn_axiomregent_standalone(port_slot: Arc<Mutex<Option<u16>>>) {
    let binary = match crate::governed_claude::bundled_axiomregent_binary_path() {
        Ok(p) => p,
        Err(e) => {
            log::warn!("axiomregent binary not available for standalone spawn: {e}");
            return;
        }
    };
    tokio::spawn(async move {
        let mut child = match tokio::process::Command::new(&binary)
            .stderr(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                log::error!("Failed to spawn axiomregent standalone: {e}");
                return;
            }
        };
        if let Some(stderr) = child.stderr.take() {
            let reader = tokio::io::BufReader::new(stderr);
            let mut lines = tokio::io::AsyncBufReadExt::lines(reader);
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(port) = parse_axiomregent_port_line(&line) {
                    *port_slot.lock().unwrap() = Some(port);
                    log::info!("axiomregent standalone probe port {port}");
                    break;
                }
            }
        }
        // Keep the child alive — it runs for the lifetime of the web server.
        let _ = child.wait().await;
    });
}

#[cfg(test)]
mod tests {
    use super::{parse_axiomregent_port_line, probe_port_alive};
    use tokio::net::TcpListener;

    #[test]
    fn parse_port_line_accepts_stderr_style() {
        assert_eq!(
            parse_axiomregent_port_line("OPC_AXIOMREGENT_PORT=9123\n"),
            Some(9123)
        );
        assert_eq!(
            parse_axiomregent_port_line("  OPC_AXIOMREGENT_PORT=1  "),
            Some(1)
        );
        assert_eq!(parse_axiomregent_port_line("noise"), None);
    }

    /// Spec 183 AC-5 — the load-bearing assertion that distinguishes "port
    /// parsed" from "port parsed AND listener still accepting." A listener
    /// bound to a loopback port satisfies the FR-T1(b) liveness probe; the
    /// same port after the listener is dropped MUST NOT satisfy it. This
    /// closes the gap between the announcement parser (FR-T1(a)) and a
    /// sidecar that announced and then crashed before completing port-bind.
    #[tokio::test]
    async fn probe_port_alive_accepts_when_listener_is_serving() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("local_addr").port();
        // Drive the listener in the background so the probe's connect
        // completes the TCP handshake rather than hanging.
        tokio::spawn(async move {
            // Accept-and-drop is sufficient — FR-T1's binary signal is
            // connection establishment, not a payload exchange.
            let _ = listener.accept().await;
        });
        assert!(
            probe_port_alive(port).await,
            "open listener must satisfy FR-T1(b) liveness probe"
        );
    }

    #[tokio::test]
    async fn probe_port_alive_rejects_when_listener_is_closed() {
        // Bind, capture the port, drop the listener — the OS will reject
        // subsequent connects with `ConnectionRefused`. Binding+dropping
        // (rather than picking a random unbound port) avoids the race
        // where the OS hands the same port to another process between
        // probe calls in the test environment.
        let port = {
            let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
            listener.local_addr().expect("local_addr").port()
            // listener drops here, releasing the port
        };
        assert!(
            !probe_port_alive(port).await,
            "closed listener MUST NOT satisfy FR-T1(b); ConnectionRefused does not pass the gate"
        );
    }
}
