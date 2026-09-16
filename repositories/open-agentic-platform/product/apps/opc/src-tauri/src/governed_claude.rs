//! Feature 035 — governed Claude Code launch via bundled axiomregent MCP (`--mcp-config`) + `OPC_GOVERNANCE_GRANTS`.

use serde_json::json;
use std::path::PathBuf;

use crate::commands::agents::Agent;

#[derive(Debug, Clone)]
pub enum GovernedPlan {
    Governed { mcp_config_json: String },
    Bypass,
}

/// Resolve bundled `axiomregent-*` binary next to `src-tauri/binaries/` (dev) or sidecar name at runtime.
pub fn bundled_axiomregent_binary_path() -> Result<PathBuf, String> {
    let suffix = if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
        "aarch64-apple-darwin"
    } else if cfg!(target_os = "linux") && cfg!(target_arch = "x86_64") {
        "x86_64-unknown-linux-gnu"
    } else if cfg!(target_os = "linux") && cfg!(target_arch = "aarch64") {
        "aarch64-unknown-linux-gnu"
    } else if cfg!(target_os = "windows") && cfg!(target_arch = "x86_64") {
        "x86_64-pc-windows-msvc"
    } else {
        return Err("unsupported host triple for bundled axiomregent".to_string());
    };
    let mut filename = format!("axiomregent-{suffix}");
    if cfg!(target_os = "windows") {
        filename.push_str(".exe");
    }
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(filename);
    if path.exists() {
        Ok(path)
    } else {
        Err(format!(
            "bundled axiomregent not found at {}",
            path.display()
        ))
    }
}

pub fn grants_json_for_agent(agent: &Agent) -> String {
    json!({
        "enable_file_read": agent.enable_file_read,
        "enable_file_write": agent.enable_file_write,
        "enable_network": agent.enable_network,
        "max_tier": 3
    })
    .to_string()
}

pub fn grants_json_claude_default() -> String {
    json!({
        "enable_file_read": true,
        "enable_file_write": true,
        "enable_network": true,
        "max_tier": 2
    })
    .to_string()
}

/// Seam C: fetch permission grants from the platform, falling back to local defaults on failure.
/// Requires PLATFORM_API_URL, PLATFORM_M2M_TOKEN, OPC_USER_ID, and OPC_WORKSPACE_ID env vars.
pub async fn grants_json_platform_or_default() -> String {
    match fetch_platform_grants().await {
        Some(grants) => grants,
        None => grants_json_claude_default(),
    }
}

async fn fetch_platform_grants() -> Option<String> {
    let api_url = std::env::var("PLATFORM_API_URL")
        .ok()
        .filter(|v| !v.is_empty())?;
    let token = std::env::var("PLATFORM_M2M_TOKEN")
        .ok()
        .filter(|v| !v.is_empty())?;
    let user_id = std::env::var("OPC_USER_ID")
        .ok()
        .filter(|v| !v.is_empty())?;
    let org_id = std::env::var("OPC_WORKSPACE_ID")
        .ok()
        .filter(|v| !v.is_empty())?;

    let url = format!(
        "{}/grants/{}/{}",
        api_url.trim_end_matches('/'),
        user_id,
        org_id
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;

    let resp = client.get(&url).bearer_auth(&token).send().await.ok()?;

    if !resp.status().is_success() {
        eprintln!("[platform] grants fetch returned {}: {url}", resp.status());
        return None;
    }

    resp.text().await.ok()
}

pub fn axiomregent_mcp_config_json(
    axiom_exe: &std::path::Path,
    grants_json: &str,
) -> Result<String, String> {
    let empty_args: Vec<String> = vec![];
    let cfg = json!({
        "mcpServers": {
            "opc-axiomregent": {
                "command": axiom_exe.to_string_lossy(),
                "args": empty_args,
                "env": {
                    "OPC_GOVERNANCE_GRANTS": grants_json
                }
            }
        }
    });
    serde_json::to_string(&cfg).map_err(|e| e.to_string())
}

/// Check whether ungoverned operation is explicitly allowed via `OPC_ALLOW_UNGOVERNED=1|true`.
fn ungoverned_explicitly_allowed() -> bool {
    std::env::var("OPC_ALLOW_UNGOVERNED")
        .ok()
        .filter(|v| v == "1" || v == "true")
        .is_some()
}

/// Attempt governance via bundled axiomregent binary + MCP config generation.
///
/// Returns `Ok((GovernedPlan, Option<bypass_reason>))` when governance is available or
/// bypass is explicitly permitted via `OPC_ALLOW_UNGOVERNED=1`.
/// Returns `Err` when governance infrastructure is absent and no explicit opt-out is set —
/// callers MUST surface this to the user rather than silently degrading (spec 090).
pub fn plan_governed_from_binary(
    grants_json: &str,
) -> Result<(GovernedPlan, Option<String>), String> {
    let binary = match bundled_axiomregent_binary_path() {
        Ok(p) => p,
        Err(msg) => {
            if ungoverned_explicitly_allowed() {
                eprintln!(
                    "[governance] WARN: {msg} — running ungoverned (OPC_ALLOW_UNGOVERNED=true)"
                );
                return Ok((
                    GovernedPlan::Bypass,
                    Some(format!("{msg} (ungoverned mode explicitly allowed)")),
                ));
            }
            return Err(format!(
                "Governance required but unavailable: {msg}. \
                 Set OPC_ALLOW_UNGOVERNED=1 to run without governance."
            ));
        }
    };
    match axiomregent_mcp_config_json(&binary, grants_json) {
        Ok(mcp_config_json) => Ok((GovernedPlan::Governed { mcp_config_json }, None)),
        Err(e) => {
            if ungoverned_explicitly_allowed() {
                eprintln!(
                    "[governance] WARN: MCP config generation failed: {e} — running ungoverned"
                );
                return Ok((
                    GovernedPlan::Bypass,
                    Some(format!(
                        "MCP config generation failed: {e} (ungoverned mode explicitly allowed)"
                    )),
                ));
            }
            Err(format!(
                "Governance required but MCP config generation failed: {e}. \
                 Set OPC_ALLOW_UNGOVERNED=1 to run without governance."
            ))
        }
    }
}

/// `announce_port`: `SidecarState` probe port when Some (axiomregent announced readiness).
///
/// Returns `Ok((plan, bypass_reason))` or `Err` when governance is required but unavailable.
/// Sidecar-not-running is also gated behind `OPC_ALLOW_UNGOVERNED` (spec 090).
pub fn plan_governed(
    announce_port: Option<u16>,
    grants_json: String,
) -> Result<(GovernedPlan, Option<String>), String> {
    if announce_port.is_none() {
        if ungoverned_explicitly_allowed() {
            eprintln!(
                "[governance] WARN: axiomregent sidecar not running — running ungoverned (OPC_ALLOW_UNGOVERNED=true)"
            );
            return Ok((
                GovernedPlan::Bypass,
                Some("axiomregent sidecar not running (ungoverned mode explicitly allowed)".into()),
            ));
        }
        return Err(
            "Governance required but axiomregent sidecar not running (no announce port). \
             Set OPC_ALLOW_UNGOVERNED=1 to run without governance."
                .into(),
        );
    }
    plan_governed_from_binary(&grants_json)
}

pub fn append_claude_governance_args(args: &mut Vec<String>, plan: &GovernedPlan) {
    match plan {
        GovernedPlan::Governed { mcp_config_json } => {
            args.push("--mcp-config".to_string());
            args.push(mcp_config_json.clone());
            args.push("--permission-mode".to_string());
            args.push("default".to_string());
        }
        GovernedPlan::Bypass => {
            args.push("--dangerously-skip-permissions".to_string());
        }
    }
}
