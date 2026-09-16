// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: MCP_ROUTER
// Spec: spec/core/router.md

use anyhow::{Result, anyhow};
use axiomregent::checkpoint::blobs::BlobStore as CheckpointBlobStore;
use axiomregent::checkpoint::provider::CheckpointProvider;
use axiomregent::checkpoint::store::CheckpointStore;
use axiomregent::github::provider::GitHubProvider;
use axiomregent::router::legacy_provider::LegacyToolProvider;
use axiomregent::router::provider::ToolProvider;
use axiomregent::router::{JsonRpcRequest, Router};
use axiomregent::search::provider::SearchProvider;
use axiomregent::search::store::SearchStore;
use axiomregent::skill_provider::SkillProvider;
use env_logger::Target;
use std::io::{self, BufRead, Read, Write};
use std::path::PathBuf;
use std::sync::Arc;

// POLICY: stdout is RESERVED for protocol messages.
// All logs, panics, and diagnostics MUST write to stderr.
#[tokio::main]
async fn main() -> Result<()> {
    // 0. Setup Logging & Panic Safety
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .target(Target::Stderr)
        .format_timestamp(None) // Stable tests
        .init();

    std::panic::set_hook(Box::new(|info| {
        log::error!("Panic: {}", info);
    }));

    log::info!("mcp starting (stdio - MCP framed JSON-RPC)");

    // 1. Discover workspace root for task runner
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let run_root = axiomregent::util::paths::discover_workspace_root(&cwd);

    // 2. Initialise hiqlite and legacy stores
    let storage_config = axiomregent::config::StorageConfig::default();
    let data_dir = storage_config.data_dir.clone();
    let db = axiomregent::db::init_hiqlite(&data_dir).await?;
    log::info!("hiqlite initialised at {:?}", data_dir);

    // Spawn cross-session event listener (FR-006)
    axiomregent::events::spawn_event_listener(db.clone());

    let default_grants = axiomregent::lease::PermissionGrants::from_env_or_default();
    let lease_store = Arc::new(axiomregent::lease::LeaseStore::with_default_grants(
        db.clone(),
        default_grants,
    ));

    let workspace_tools = Arc::new(axiomregent::workspace::WorkspaceTools::new(
        lease_store.clone(),
    ));
    let featuregraph_tools = Arc::new(axiomregent::featuregraph::tools::FeatureGraphTools::new());
    let feature_tools = Arc::new(axiomregent::feature_tools::FeatureTools::new());
    let xray_tools = Arc::new(axiomregent::xray::tools::XrayTools::new());
    let agent_tools = Arc::new(axiomregent::agent_tools::AgentTools::new(
        workspace_tools.clone(),
        feature_tools.clone(),
    ));
    let run_tools = Arc::new(axiomregent::run_tools::RunTools::new(db.clone(), &run_root));

    // 3. Setup Router
    let legacy = Arc::new(LegacyToolProvider {
        workspace_tools,
        featuregraph_tools,
        xray_tools,
        agent_tools,
        run_tools,
    });

    let checkpoint_blobs = CheckpointBlobStore::new(data_dir.join("blobs").join("checkpoints"))?;
    let checkpoint_store = Arc::new(CheckpointStore::new(db.clone(), checkpoint_blobs));
    let checkpoint_provider = Arc::new(CheckpointProvider::new(checkpoint_store));

    let search_store = Arc::new(SearchStore::new(db.clone()));
    let search_provider = Arc::new(SearchProvider::new(search_store));

    let github_provider = Arc::new(GitHubProvider::new().await?);

    // 3a. Load skill commands from .claude/commands/ (spec 071)
    let commands_dir = run_root.join(".claude").join("commands");
    let skill_provider = Arc::new(SkillProvider::load(&commands_dir));

    let providers: Vec<Arc<dyn ToolProvider>> = vec![
        legacy,
        checkpoint_provider,
        search_provider,
        github_provider,
        skill_provider,
    ];
    let mut router = Router::new(providers, lease_store.clone(), None).await;
    // Spec 207: attach the session-scoped audit chain under the agent data dir.
    // The OPC sidecar pins AXIOMREGENT_DATA_DIR under app_data_dir, so the
    // desktop can recompute `<data_dir>/audit` to read closed segment heads for
    // platform countersign (AC-4).
    router.set_audit_chain(data_dir.join("audit"));

    // 3b. OPC desktop sidecar discovery: announce a local probe port on **stderr** only.
    // Stdout is reserved for MCP framing; the desktop watches stderr for this line.
    let probe_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let probe_port = probe_listener.local_addr()?.port();
    let mut stderr = std::io::stderr();
    let _ = writeln!(stderr, "OPC_AXIOMREGENT_PORT={probe_port}");
    let _ = stderr.flush();
    tokio::spawn(async move {
        loop {
            match probe_listener.accept().await {
                Ok((_stream, _)) => {
                    // Hold the listener open; connections are ignored (diagnostics only).
                }
                Err(e) => {
                    log::debug!("axiomregent probe accept error: {e}");
                    break;
                }
            }
        }
    });

    // 4. Stdio Loop (MCP framing)

    let stdin = io::stdin();
    let mut input = stdin.lock();
    let stdout = io::stdout();
    let mut stdout = stdout.lock();

    loop {
        let maybe_payload = read_mcp_message(&mut input)?;
        let Some(payload) = maybe_payload else {
            break; // EOF
        };

        match serde_json::from_str::<JsonRpcRequest>(&payload) {
            Ok(req) => {
                let response = router.handle_request(&req).await;
                let resp_str = serde_json::to_string(&response)?;
                write_mcp_message(&mut stdout, resp_str.as_bytes())?;
            }
            Err(e) => {
                // IMPORTANT: Some clients will send other traffic; log but don't crash.
                log::error!("Failed to parse JSON-RPC payload: {}", e);
            }
        }
    }

    Ok(())
}

/// Reads a single MCP stdio framed message.
///
/// MCP clients typically speak:
///   Content-Length: <n>\r\n
///   \r\n
///   <n bytes of JSON>
///
/// For local diagnostics, we also accept a single-line JSON payload (line-delimited)
/// **IF AND ONLY IF** `MCP_ALLOW_LINE_JSON` is set.
fn read_mcp_message<R: BufRead + Read>(r: &mut R) -> Result<Option<String>> {
    let mut first_line = String::new();

    // Read until we find a non-empty line or EOF.
    loop {
        first_line.clear();
        let n = r.read_line(&mut first_line)?;
        if n == 0 {
            return Ok(None);
        }
        if !first_line.trim().is_empty() {
            break;
        }
    }

    let trimmed = first_line.trim_end_matches(['\r', '\n']);

    // Line-delimited JSON fallback for dev/testing.
    if trimmed.starts_with('{') && std::env::var("MCP_ALLOW_LINE_JSON").is_ok() {
        return Ok(Some(trimmed.to_string()));
    }

    // Otherwise, treat it as the start of headers.
    let mut content_length: Option<usize> = None;
    parse_header_line(trimmed, &mut content_length)?;

    // Read remaining headers until blank line.
    loop {
        let mut line = String::new();
        let n = r.read_line(&mut line)?;
        if n == 0 {
            return Err(anyhow!("EOF while reading MCP headers"));
        }

        let l = line.trim_end_matches(['\r', '\n']);
        if l.is_empty() {
            break;
        }

        parse_header_line(l, &mut content_length)?;
    }

    let len = content_length.ok_or_else(|| anyhow!("Missing Content-Length header"))?;

    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf)?;

    let s = String::from_utf8(buf)?;
    Ok(Some(s))
}

fn parse_header_line(line: &str, content_length: &mut Option<usize>) -> Result<()> {
    // Keep this deterministic and strict.
    // We accept both `Content-Length:` and `content-length:`.
    let lower = line.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("content-length:") {
        let v = rest.trim();
        if let Ok(n) = v.parse::<usize>() {
            *content_length = Some(n);
        } else {
            return Err(anyhow!("Invalid Content-Length value: {}", v));
        }
    }
    Ok(())
}

fn write_mcp_message<W: Write>(w: &mut W, payload: &[u8]) -> Result<()> {
    // MCP stdio framing
    write!(w, "Content-Length: {}\r\n\r\n", payload.len())?;
    w.write_all(payload)?;
    w.flush()?;
    Ok(())
}
