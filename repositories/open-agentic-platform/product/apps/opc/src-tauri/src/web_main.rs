// The web binary shares command modules with the Tauri desktop app.
// Most code is invoked via Tauri's generate_handler![] in the main binary
// and appears dead here. Suppress these false positives.
#![allow(dead_code)]

use clap::Parser;

mod checkpoint;
mod claude_binary;
mod commands;
mod governed_claude;

/// `opc-web` binary has no Tauri sidecar lifecycle; [`SidecarState::axiomregent_port`] stays `None`.
pub mod sidecars {
    use std::sync::{Arc, Mutex};

    #[derive(Default)]
    pub struct SidecarState {
        pub axiomregent_port: Arc<Mutex<Option<u16>>>,
    }

    /// Spec 183 FR-T5 — boot-gate precondition-loss emitter. In the
    /// Tauri shell this dispatches a frontend event; the `opc-web`
    /// binary has no Tauri AppHandle, so the emit is a logging no-op.
    /// Signature kept identical to the Tauri-shell variant so
    /// `commands::sync_client::run_forever` compiles uniformly across
    /// both binaries (it calls `crate::sidecars::emit_precondition_lost`
    /// unconditionally).
    pub(crate) fn emit_precondition_lost(
        _app: &tauri::AppHandle,
        precondition: &str,
        reason: &str,
    ) {
        log::warn!(
            "(opc-web) boot-gate precondition lost (no-op): {precondition} — {reason}"
        );
    }

    /// Parse a line for `OPC_AXIOMREGENT_PORT=<u16>` (first line win).
    pub fn parse_axiomregent_port_line(line: &str) -> Option<u16> {
        line.trim()
            .strip_prefix("OPC_AXIOMREGENT_PORT=")
            .and_then(|s| s.parse::<u16>().ok())
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
}
mod process;
mod types;
mod utils;
mod web_server;

#[derive(Parser)]
#[command(name = "opc-web")]
#[command(about = "Opcode Web Server - Access Opcode from your phone")]
struct Args {
    /// Port to run the web server on
    #[arg(short, long, default_value = "8080")]
    port: u16,

    /// Host to bind to. Defaults to loopback-only (127.0.0.1); pass an
    /// explicit non-loopback address (e.g. 0.0.0.0 for all interfaces, or a
    /// LAN IP) to opt into network-reachable mode. /api and /ws/claude
    /// require the control token in that mode (see ~/.oap/control.token),
    /// and the server refuses to start without one (finding HIGH #2).
    #[arg(short = 'H', long, default_value = "127.0.0.1")]
    host: String,
}

#[tokio::main]
async fn main() {
    env_logger::init();

    let args = Args::parse();

    println!("🚀 Starting Opcode Web Server...");
    println!(
        "📱 Will be accessible from phones at: http://{}:{}",
        args.host, args.port
    );

    if let Err(e) = web_server::start_web_mode(Some(args.port), Some(args.host.clone())).await {
        eprintln!("❌ Failed to start web server: {}", e);
        std::process::exit(1);
    }
}
