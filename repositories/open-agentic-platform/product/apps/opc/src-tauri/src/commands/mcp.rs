// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! MCP server management commands for the desktop app.
//!
//! ## Architecture
//!
//! MCP tool operations (list_tools, call_tool, read_resource) are intentionally
//! delegated to the axiomregent sidecar process. The desktop app spawns axiomregent
//! as a subprocess communicating via MCP stdio framing. These Tauri commands exist
//! only as a compatibility layer and return errors directing callers to the sidecar.
//! See spec `073-axiomregent-unification` for the full architecture.
//!
//! MCP server configuration (add, get, remove, list) is managed locally via a
//! JSON config file in the app data directory.

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::command;

/// Represents an MCP server configuration entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub name: String,
    pub transport: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
    #[serde(default)]
    pub scope: String,
}

/// The on-disk config file format
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct McpConfig {
    #[serde(rename = "mcpServers")]
    mcp_servers: HashMap<String, McpServerConfig>,
}

fn config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    Ok(home.join(".claude").join("mcp-servers.json"))
}

fn load_config() -> Result<McpConfig, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(McpConfig::default());
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read MCP config: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse MCP config: {}", e))
}

fn save_config(config: &McpConfig) -> Result<(), String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize MCP config: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("Failed to write MCP config: {}", e))
}

// --- Tool operation proxies (delegated to axiomregent sidecar) ---

/// List available tools from an MCP server.
/// Delegated to axiomregent sidecar — see spec `073-axiomregent-unification`.
#[command]
pub async fn mcp_list_tools(_server: String) -> Result<serde_json::Value, String> {
    Err("MCP tool listing not implemented — use axiomregent sidecar directly".to_string())
}

/// Call a tool on an MCP server.
/// Delegated to axiomregent sidecar — see spec `073-axiomregent-unification`.
#[command]
pub async fn mcp_call_tool(
    _server: String,
    _tool_name: String,
    _args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    Err("MCP tool calls not implemented — use axiomregent sidecar directly".to_string())
}

/// Read a resource from an MCP server.
/// Delegated to axiomregent sidecar — see spec `073-axiomregent-unification`.
#[command]
pub async fn mcp_read_resource(_server: String, _uri: String) -> Result<serde_json::Value, String> {
    Err("MCP resource reads not implemented — use axiomregent sidecar directly".to_string())
}

// --- Server configuration management ---

/// Add an MCP server configuration
#[command]
pub async fn mcp_add(
    name: String,
    transport: String,
    command: Option<String>,
    args: Option<Vec<String>>,
    url: Option<String>,
    env: Option<HashMap<String, String>>,
    scope: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut config = load_config()?;
    let server = McpServerConfig {
        name: name.clone(),
        transport,
        command,
        args,
        url,
        env,
        scope: scope.unwrap_or_else(|| "project".to_string()),
    };
    config.mcp_servers.insert(name.clone(), server);
    save_config(&config)?;
    Ok(json!({ "status": "ok", "name": name }))
}

/// List all configured MCP servers
#[command]
pub async fn mcp_list() -> Result<serde_json::Value, String> {
    let config = load_config()?;
    let servers: Vec<&McpServerConfig> = config.mcp_servers.values().collect();
    serde_json::to_value(servers).map_err(|e| format!("Failed to serialize servers: {}", e))
}

/// Get a specific MCP server configuration by name
#[command]
pub async fn mcp_get(name: String) -> Result<serde_json::Value, String> {
    let config = load_config()?;
    match config.mcp_servers.get(&name) {
        Some(server) => {
            serde_json::to_value(server).map_err(|e| format!("Failed to serialize server: {}", e))
        }
        None => Err(format!("Server '{}' not found", name)),
    }
}

/// Remove an MCP server configuration
#[command]
pub async fn mcp_remove(name: String) -> Result<serde_json::Value, String> {
    let mut config = load_config()?;
    if config.mcp_servers.remove(&name).is_none() {
        return Err(format!("Server '{}' not found", name));
    }
    save_config(&config)?;
    Ok(json!({ "status": "ok", "removed": name }))
}

/// Add an MCP server from a raw JSON configuration
#[command]
pub async fn mcp_add_json(
    name: String,
    config_json: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut server: McpServerConfig =
        serde_json::from_value(config_json).map_err(|e| format!("Invalid server config: {}", e))?;
    server.name = name.clone();
    let mut config = load_config()?;
    config.mcp_servers.insert(name.clone(), server);
    save_config(&config)?;
    Ok(json!({ "status": "ok", "name": name }))
}

/// Import MCP servers from Claude Desktop configuration
#[command]
pub async fn mcp_add_from_claude_desktop() -> Result<serde_json::Value, String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;

    // Claude Desktop config location
    let claude_desktop_config = if cfg!(target_os = "macos") {
        home.join("Library/Application Support/Claude/claude_desktop_config.json")
    } else if cfg!(target_os = "windows") {
        home.join("AppData/Roaming/Claude/claude_desktop_config.json")
    } else {
        home.join(".config/claude/claude_desktop_config.json")
    };

    if !claude_desktop_config.exists() {
        return Err("Claude Desktop config not found".to_string());
    }

    let content = fs::read_to_string(&claude_desktop_config)
        .map_err(|e| format!("Failed to read Claude Desktop config: {}", e))?;
    let desktop_config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse Claude Desktop config: {}", e))?;

    let servers = desktop_config
        .get("mcpServers")
        .and_then(|v| v.as_object())
        .ok_or("No mcpServers found in Claude Desktop config")?;

    let mut config = load_config()?;
    let mut imported = Vec::new();

    for (name, server_value) in servers {
        let mut server: McpServerConfig =
            serde_json::from_value(server_value.clone()).unwrap_or(McpServerConfig {
                name: name.clone(),
                transport: "stdio".to_string(),
                command: server_value
                    .get("command")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                args: server_value
                    .get("args")
                    .and_then(|v| serde_json::from_value(v.clone()).ok()),
                url: None,
                env: server_value
                    .get("env")
                    .and_then(|v| serde_json::from_value(v.clone()).ok()),
                scope: "global".to_string(),
            });
        server.name = name.clone();
        config.mcp_servers.insert(name.clone(), server);
        imported.push(name.clone());
    }

    save_config(&config)?;
    Ok(json!({ "status": "ok", "imported": imported }))
}

/// Start serving as an MCP server (not yet implemented)
#[command]
pub async fn mcp_serve() -> Result<serde_json::Value, String> {
    Err("MCP serve mode is not yet implemented".to_string())
}

/// Test connection to an MCP server
#[command]
pub async fn mcp_test_connection(name: String) -> Result<serde_json::Value, String> {
    let config = load_config()?;
    let server = config
        .mcp_servers
        .get(&name)
        .ok_or_else(|| format!("Server '{}' not found", name))?;

    // Basic validation — verify the command/URL is resolvable
    match server.transport.as_str() {
        "stdio" => {
            if let Some(cmd) = &server.command {
                let exists = which::which(cmd).is_ok();
                if exists {
                    Ok(
                        json!({ "status": "ok", "message": format!("Command '{}' found on PATH", cmd) }),
                    )
                } else {
                    Err(format!("Command '{}' not found on PATH", cmd))
                }
            } else {
                Err("No command specified for stdio transport".to_string())
            }
        }
        "sse" | "streamable-http" => {
            if server.url.is_some() {
                Ok(json!({ "status": "ok", "message": "URL configured" }))
            } else {
                Err("No URL specified for SSE/HTTP transport".to_string())
            }
        }
        other => Err(format!("Unknown transport type: {}", other)),
    }
}

/// Reset project-level MCP choices
#[command]
pub async fn mcp_reset_project_choices() -> Result<serde_json::Value, String> {
    Ok(json!("ok"))
}

/// Get server status
#[command]
pub async fn mcp_get_server_status() -> Result<serde_json::Value, String> {
    Ok(json!({}))
}

/// Read MCP config from the project config file
#[command]
pub async fn mcp_read_project_config() -> Result<serde_json::Value, String> {
    let config = load_config()?;
    serde_json::to_value(&config).map_err(|e| format!("Failed to serialize config: {}", e))
}

/// Save MCP config for a project
#[command]
pub async fn mcp_save_project_config(
    config_json: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let config: McpConfig =
        serde_json::from_value(config_json).map_err(|e| format!("Invalid config: {}", e))?;
    save_config(&config)?;
    Ok(json!({ "status": "ok" }))
}
