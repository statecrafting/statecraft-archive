// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// Tauri's `generate_handler![]` macro invokes functions opaquely — the compiler
// cannot see through it, so most exported commands and their supporting types
// appear "dead" to `cargo check`. This is standard for Tauri apps.
#![allow(dead_code)]

pub mod bindings;
pub mod checkpoint;
pub mod claude_binary;
pub mod commands;
pub mod governed_claude;
pub mod process;
pub mod sidecars;
pub mod types;
pub mod utils;
pub mod web_server;

use checkpoint::state::CheckpointState;
use commands::agents::{
    AgentDb, cleanup_finished_processes, create_agent, delete_agent, execute_agent, export_agent,
    export_agent_to_file, fetch_github_agent_content, fetch_github_agents, get_agent,
    get_agent_run, get_agent_run_with_real_time_metrics, get_claude_binary_path,
    get_live_session_output, get_session_output, get_session_status, import_agent,
    import_agent_from_file, import_agent_from_github, init_database, kill_agent_session,
    list_active_agents, list_agent_runs, list_agent_runs_with_metrics, list_agents,
    list_claude_installations, list_org_agents, list_running_sessions,
    load_agent_session_history, plan_request, set_claude_binary_path,
    stream_session_output, update_agent,
};
use commands::claude::{
    ClaudeBridgeIpcState, ClaudeProcessState, cancel_claude_execution, check_auto_checkpoint,
    check_claude_version, cleanup_old_checkpoints, clear_checkpoint_manager, continue_claude_code,
    create_checkpoint, create_project, delete_checkpoint, delete_session, execute_claude_bridge,
    execute_claude_code, find_claude_md_files, fork_from_checkpoint, get_checkpoint_diff,
    get_checkpoint_settings, get_checkpoint_state_stats, get_claude_session_output,
    get_claude_settings, get_cpu_usage, get_home_directory, get_hooks_config, get_project_sessions,
    get_recently_modified_files, get_scoped_settings, get_session_timeline, get_system_prompt,
    list_checkpoints, list_directory_contents, list_projects, list_running_claude_sessions,
    load_session_history, open_new_session, read_claude_md_file, respond_to_bridge_permission,
    restore_checkpoint, resume_claude_code, save_claude_md_file, save_claude_settings,
    save_scoped_settings, save_system_prompt, search_files, track_checkpoint_message,
    track_session_messages, update_checkpoint_settings, update_hooks_config, validate_hook_command,
};
use commands::factory::{
    cancel_factory_pipeline, confirm_factory_stage, get_factory_artifacts,
    get_factory_pipeline_status, list_factory_runs, reject_factory_stage, resume_factory_pipeline,
    skip_factory_step, start_factory_pipeline,
};
use commands::factory_project::{
    clone_project_from_bundle, detect_factory_project, fetch_project_opc_bundle,
    refresh_clone_token,
};
use commands::keychain::{
    clone_token_clear, clone_token_load, clone_token_store, keychain_clear, keychain_retrieve,
    keychain_store,
};
use commands::live_sessions::{
    force_disconnect_session, get_live_session_thresholds, list_live_sessions,
};
use commands::mcp::{
    mcp_add, mcp_add_from_claude_desktop, mcp_add_json, mcp_get, mcp_get_server_status, mcp_list,
    mcp_read_project_config, mcp_remove, mcp_reset_project_choices, mcp_save_project_config,
    mcp_serve, mcp_test_connection,
};
use commands::orchestrator::{
    cancel_run, cleanup_artifacts, get_run_status, list_workspace_workflows, orchestrate_manifest,
};
use commands::proxy::{apply_proxy_settings, get_proxy_settings, save_proxy_settings};
use commands::statecraft_client::StatecraftState;
use commands::sync_client::{
    OpcInstanceId, SyncClientConfig, SyncClientState, audit_unanchored_window,
};
use commands::storage::{
    storage_delete_row, storage_execute_sql, storage_insert_row, storage_list_tables,
    storage_read_table, storage_reset_database, storage_update_row,
};
use commands::usage::{
    get_session_stats, get_usage_by_date_range, get_usage_details, get_usage_stats,
};
use commands::worktree_agents::{
    WorktreeAgentsState, discard_agent, get_agent_diff, list_background_agents, merge_agent,
    spawn_background_agent,
};
use process::ProcessRegistryState;
use sidecars::SidecarState;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
use window_vibrancy::{NSVisualEffectMaterial, apply_vibrancy};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Export TypeScript bindings on every debug start so the frontend stays in sync.
    #[cfg(debug_assertions)]
    bindings::export_ts_bindings();

    // Build the plugin chain. The MCP bridge is conditionally added when the
    // `mcp-dev` feature is enabled — it exposes the running app to AI assistants
    // (Claude Code, Cursor, etc.) via a WebSocket on port 9223.
    // Linux is excluded due to an upstream glib version conflict in the plugin.
    let builder = tauri::Builder::default()
        // Single-instance must be first to gate startup before any state is set up
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("opc".into()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .build(),
        )
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init());

    // NSPanel must be registered before setup() so WebviewPanelManager state is available
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    #[cfg(all(feature = "mcp-dev", any(target_os = "macos", target_os = "windows")))]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

    builder
        .setup(|app| {
            // Initialize agents database
            let conn = init_database(app.handle()).expect("Failed to initialize agents database");

            // Load and apply proxy settings from the database at startup
            {
                let db = AgentDb(Mutex::new(conn));
                let proxy_settings = match db.0.lock() {
                    Ok(conn) => {
                        let mut settings = commands::proxy::ProxySettings::default();
                        let keys = vec![
                            ("proxy_enabled", "enabled"),
                            ("proxy_http", "http_proxy"),
                            ("proxy_https", "https_proxy"),
                            ("proxy_no", "no_proxy"),
                            ("proxy_all", "all_proxy"),
                        ];
                        for (db_key, field) in keys {
                            if let Ok(value) = conn.query_row(
                                "SELECT value FROM app_settings WHERE key = ?1",
                                rusqlite::params![db_key],
                                |row| row.get::<_, String>(0),
                            ) {
                                match field {
                                    "enabled" => settings.enabled = value == "true",
                                    "http_proxy" => {
                                        settings.http_proxy = Some(value).filter(|s| !s.is_empty())
                                    }
                                    "https_proxy" => {
                                        settings.https_proxy = Some(value).filter(|s| !s.is_empty())
                                    }
                                    "no_proxy" => {
                                        settings.no_proxy = Some(value).filter(|s| !s.is_empty())
                                    }
                                    "all_proxy" => {
                                        settings.all_proxy = Some(value).filter(|s| !s.is_empty())
                                    }
                                    _ => {}
                                }
                            }
                        }
                        log::info!("Loaded proxy settings: enabled={}", settings.enabled);
                        settings
                    }
                    Err(e) => {
                        log::warn!("Failed to lock database for proxy settings: {}", e);
                        commands::proxy::ProxySettings::default()
                    }
                };
                apply_proxy_settings(&proxy_settings);
            }

            // Re-open the connection for managed state
            let conn = init_database(app.handle()).expect("Failed to initialize agents database");
            app.manage(AgentDb(Mutex::new(conn)));

            // Initialize checkpoint state
            let checkpoint_state = CheckpointState::new();
            if let Ok(claude_dir) = dirs::home_dir()
                .ok_or("Could not find home directory")
                .and_then(|home| {
                    let claude_path = home.join(".claude");
                    claude_path
                        .canonicalize()
                        .map_err(|_| "Could not find ~/.claude directory")
                })
            {
                let state_clone = checkpoint_state.clone();
                tauri::async_runtime::spawn(async move {
                    state_clone.set_claude_dir(claude_dir).await;
                });
            }
            app.manage(checkpoint_state);

            // Initialize process registry and Claude process state
            app.manage(ProcessRegistryState::default());
            app.manage(ClaudeProcessState::default());
            app.manage(ClaudeBridgeIpcState::default());

            // Initialize sidecar state (ports populated when sidecars announce them)
            app.manage(SidecarState::default());
            sidecars::spawn_axiomregent(app.handle());

            // Pull-side project catalog cache (spec 112 §7) — lets the
            // Projects panel recover the handshake snapshot it may have
            // missed by subscribing after the duplex delivered it. Managed
            // unconditionally so `get_project_catalog` always has state.
            app.manage(commands::project_catalog_sync::ProjectCatalogCache::default());

            // Initialize Statecraft Factory API client (dual-write governance).
            // URL resolution order: app_settings.statecraft_base_url (DB) →
            // STATECRAFT_BASE_URL env var → default "https://statecraft.ing".
            {
                let user_id = std::env::var("OPC_USER_ID").unwrap_or_else(|_| "opc-desktop".into());
                let base_url = commands::settings::resolve_statecraft_base_url(app.handle());
                let sc = commands::statecraft_client::StatecraftClient::new(&base_url, &user_id)
                    .map(std::sync::Arc::new);
                if sc.is_some() {
                    log::info!("Statecraft client enabled → {base_url}");
                } else {
                    log::info!("Statecraft client disabled (no base URL configured)");
                }
                // Load auth token from OS keychain (spec 087 Phase 5)
                if let Some(ref client) = sc
                    && client.load_token_from_keychain()
                {
                    log::info!("Restored Statecraft auth token from OS keychain");
                }

                // Spec 110 Phase 2: duplex sync consumer. Spawn whenever a base
                // URL is configured — the JWT is resolved (and refreshed) at
                // connect time from the shared keychain, not snapshotted here,
                // so a consumer started before sign-in or with an expired token
                // recovers on its own instead of wedging the boot gate (spec
                // 183). Reconnects and token refresh are handled internally.
                let sync_state = SyncClientState::new();
                // Spec 183 (post-approval hardening, 2026-06-05): manage
                // SyncClientState BEFORE spawning the duplex consumer below.
                // The consumer task resolves it from managed state; if the
                // manage ran *after* the spawn (as it originally did), a
                // runtime worker could poll the task first and the panicking
                // `.state()` accessor would silently kill the consumer before
                // `run_forever` logged a single connect attempt — observed as
                // "duplex consumer starting" with no "connecting"/"idle" line,
                // recoverable only by relaunch. See spec 183 §"Post-approval
                // hardening: consumer-spawn ordering".
                app.manage(sync_state);
                // Stable OPC instance identity used in factory.run.ack frames
                // (spec 110 §2.2): reuse the sync client id so logs in the
                // desktop and envelopes statecraft receives are correlatable.
                let opc_instance_id = std::env::var("OPC_SYNC_CLIENT_ID")
                    .unwrap_or_else(|_| uuid::Uuid::new_v4().to_string());
                if let Some(ref client) = sc
                    && !base_url.is_empty()
                {
                    let config = SyncClientConfig {
                        base_url: client.base_url().to_string(),
                        client_id: opc_instance_id.clone(),
                        client_version: Some(env!("CARGO_PKG_VERSION").to_string()),
                    };
                    // Auth handle for the reconnect loop, captured here at
                    // spawn time. `StatecraftState` holds an
                    // `Arc<StatecraftClient>` (spec 183), so for the lifetime of
                    // *this* client it is a shared handle to the SAME instance
                    // the boot gate and REST commands read — a token/org write
                    // on any handle is visible to all, and the loop's keychain
                    // reload/refresh (spec 110 / 183) is visible to them in
                    // turn. A base-URL change (`set_statecraft_base_url` →
                    // `StatecraftState::replace`) installs a NEW client and
                    // re-spawns this consumer against it (spec 183 FR-T2(a)),
                    // so the loop follows the switch — see `SyncClientState::spawn`.
                    let auth = client.clone();
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        // Spec 183: resolve SyncClientState defensively. It is
                        // managed before this spawn (above), so the first
                        // attempt succeeds; the bounded retry + error log is a
                        // guard so a future reordering can never again silently
                        // kill the consumer via a panicking `.state()`.
                        let mut resolved = None;
                        for _ in 0..40 {
                            if let Some(found) = handle.try_state::<SyncClientState>() {
                                resolved = Some(found);
                                break;
                            }
                            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
                        }
                        let Some(state) = resolved else {
                            log::error!(
                                "sync_client: SyncClientState unavailable after retry — duplex consumer NOT started; boot gate will hang on sync.hello"
                            );
                            return;
                        };
                        // Spec 183 FR-T5(b) — AppHandle threaded into the
                        // reconnect loop so it can emit the precondition-
                        // loss event when the give-up threshold is crossed.
                        state.spawn(config, auth, handle.clone()).await;
                    });
                    log::info!("sync_client: duplex consumer starting");
                } else {
                    log::info!(
                        "sync_client: duplex consumer disabled (no Statecraft base URL configured)"
                    );
                }
                app.manage(StatecraftState(std::sync::RwLock::new(sc)));

                // Spec 110 Phase 4: register the desktop handler for
                // `factory.run.request`. Dead code until statecraft flips the
                // default `source` to `statecraft` (Rollout Phase 6), but safe
                // to register unconditionally — the dispatch table is empty
                // for this kind otherwise.
                // Expose the stable instance id as managed state so a
                // settings-driven duplex re-spawn (spec 183 FR-T2(a)) reuses
                // the same `client_id` instead of minting a new one.
                app.manage(OpcInstanceId(opc_instance_id.clone()));
                commands::factory::register_factory_run_handler(
                    app.handle().clone(),
                    opc_instance_id,
                );

                // Spec 110: register the desktop handler for `factory.event`.
                // A gate confirmed/rejected on the statecraft web surface
                // publishes `stage_confirmed`/`stage_rejected` back over the
                // duplex; without this handler every such frame was dropped
                // ("no handler registered"), so a web-side sign-off never
                // resolved the local run's pending gate. This is the reverse
                // of the OPC-side dual-write in `confirm_factory_stage`.
                commands::factory::register_factory_event_handler(app.handle().clone());

                // Spec 111 Phase 5: register the desktop catalog sync
                // handlers only when the OPC_REMOTE_AGENT_CATALOG feature
                // flag is set. The Phase 3 decode path stays live either
                // way, so drifting a frame past an off flag just drops with
                // a log — never a crash.
                commands::agent_catalog_sync::register_agent_catalog_handlers(
                    app.handle().clone(),
                );

                // Spec 112 Phase 8: register the project catalog handler
                // unconditionally — the panel's value is "the OPC project
                // list updates without a restart", so there is no feature
                // flag here. Same defensive posture as the agent handler:
                // missing dependencies log and skip rather than crash.
                commands::project_catalog_sync::register_project_catalog_handlers(
                    app.handle().clone(),
                );

                // Spec 208 FR-001/FR-003: register the org-halt dispatch
                // handler unconditionally (a kill switch is not feature-gated).
                // Same defensive posture: a missing SyncClientState logs and
                // skips rather than crashing.
                commands::live_sessions::register_org_halt_handlers(
                    app.handle().clone(),
                );
            }

            // Register AuthFlowState for desktop OAuth PKCE (spec 080 Phase 1)
            app.manage(commands::auth::AuthFlowState(std::sync::Mutex::new(None)));
            // Buffer for deep-link auth callbacks that arrive before the webview
            // has registered its 'auth-callback' listener (cold launch case).
            app.manage(commands::auth::PendingAuthCallback::default());

            // Listen for deep-link callbacks. The `opc://` scheme carries
            // two paths:
            //
            //   opc://auth/callback        — OPC desktop OAuth (spec 080)
            //   opc://project/open?...     — statecraft Open-in-OPC handoff (spec 112 §6.3)
            //
            // Use the plugin's canonical on_open_url API. For each known
            // path we emit a webview event AND (where the auth flow needs
            // it) cache the URL in managed state so the frontend can drain
            // any URL that arrived before its listener was registered.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle_clone = app.handle().clone();
                let dispatch = move |urls: Vec<String>| {
                    for s in urls {
                        log::info!("deep-link received: {s}");
                        if s.starts_with("opc://auth/callback") {
                            if let Some(state) = handle_clone.try_state::<commands::auth::PendingAuthCallback>() {
                                state.set(s.clone());
                            }
                            if let Err(e) = handle_clone.emit("auth-callback", &s) {
                                log::error!("failed to emit auth-callback: {e}");
                            }
                        } else if s.starts_with("opc://project/open") {
                            match commands::project_open::parse_project_open_url(&s) {
                                Ok(payload) => {
                                    if let Err(e) =
                                        handle_clone.emit("project-open-request", &payload)
                                    {
                                        log::error!(
                                            "failed to emit project-open-request: {e}"
                                        );
                                    }
                                }
                                Err(e) => {
                                    log::warn!(
                                        "ignoring malformed opc://project/open URL: {e}"
                                    );
                                }
                            }
                        }
                    }
                };
                let dispatch_live = dispatch.clone();
                app.deep_link().on_open_url(move |event| {
                    let urls = event.urls().into_iter().map(|u| u.to_string()).collect();
                    dispatch_live(urls);
                });
                // Cold-launch: replay any URL captured before this listener was set.
                if let Ok(Some(initial)) = app.deep_link().get_current() {
                    log::info!("deep-link cold-start urls: {}", initial.len());
                    dispatch(initial.into_iter().map(|u| u.to_string()).collect());
                }
            }

            // Initialize zoom state (Tauri 2 has no zoom getter; we track it here)
            app.manage(commands::window_ctrl::ZoomState::default());
            app.manage(WorktreeAgentsState::default());

            // Spec 180 FR-T7 — process-lifetime cache for the filesystem-scanning
            // usage handlers, registered so they retrieve it via State<'_, _>
            // rather than constructing per call.
            app.manage(commands::usage::UsageCache::default());

            // Initialize quick pane (hidden, shown via global shortcut)
            if let Err(e) = commands::quick_pane::init_quick_pane(app.handle()) {
                log::error!("Failed to create quick pane: {e}");
                // Non-fatal: app can still run without quick pane
            }

            // Register global shortcut for quick pane
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::Builder as ShortcutBuilder;
                if let Err(e) = app.handle().plugin(ShortcutBuilder::new().build()) {
                    log::error!("Failed to initialize global shortcut plugin: {e}");
                }
                if let Err(e) = commands::quick_pane::register_quick_pane_shortcut(
                    app.handle(),
                    commands::quick_pane::DEFAULT_QUICK_PANE_SHORTCUT,
                ) {
                    log::warn!("Failed to register quick pane shortcut: {e}");
                }
            }

            // Apply window vibrancy with rounded corners on macOS
            #[cfg(target_os = "macos")]
            {
                let window = app.get_webview_window("main").unwrap();
                let materials = [
                    NSVisualEffectMaterial::UnderWindowBackground,
                    NSVisualEffectMaterial::WindowBackground,
                    NSVisualEffectMaterial::Popover,
                    NSVisualEffectMaterial::Menu,
                    NSVisualEffectMaterial::Sidebar,
                ];
                let mut applied = false;
                for material in materials.iter() {
                    if apply_vibrancy(&window, *material, None, Some(12.0)).is_ok() {
                        applied = true;
                        break;
                    }
                }
                if !applied {
                    apply_vibrancy(
                        &window,
                        NSVisualEffectMaterial::WindowBackground,
                        None,
                        None,
                    )
                    .expect("Failed to apply any window vibrancy");
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Claude & Project Management
            list_projects,
            create_project,
            get_project_sessions,
            get_home_directory,
            get_claude_settings,
            open_new_session,
            get_system_prompt,
            check_claude_version,
            save_system_prompt,
            save_claude_settings,
            find_claude_md_files,
            read_claude_md_file,
            save_claude_md_file,
            load_session_history,
            execute_claude_code,
            execute_claude_bridge,
            continue_claude_code,
            resume_claude_code,
            respond_to_bridge_permission,
            cancel_claude_execution,
            list_running_claude_sessions,
            get_claude_session_output,
            list_directory_contents,
            search_files,
            get_recently_modified_files,
            get_hooks_config,
            update_hooks_config,
            validate_hook_command,
            get_scoped_settings,
            save_scoped_settings,
            // Checkpoint Management
            create_checkpoint,
            restore_checkpoint,
            list_checkpoints,
            fork_from_checkpoint,
            get_session_timeline,
            update_checkpoint_settings,
            get_checkpoint_diff,
            track_checkpoint_message,
            track_session_messages,
            check_auto_checkpoint,
            cleanup_old_checkpoints,
            get_checkpoint_settings,
            clear_checkpoint_manager,
            get_checkpoint_state_stats,
            delete_checkpoint,
            delete_session,
            get_cpu_usage,
            // Agent Management
            list_agents,
            // spec 123 §6.3 — binding-aware agent listing
            list_active_agents,
            list_org_agents,
            create_agent,
            update_agent,
            delete_agent,
            get_agent,
            execute_agent,
            list_agent_runs,
            get_agent_run,
            list_agent_runs_with_metrics,
            get_agent_run_with_real_time_metrics,
            list_running_sessions,
            kill_agent_session,
            get_session_status,
            cleanup_finished_processes,
            get_session_output,
            get_live_session_output,
            stream_session_output,
            load_agent_session_history,
            plan_request,
            get_claude_binary_path,
            set_claude_binary_path,
            list_claude_installations,
            export_agent,
            export_agent_to_file,
            import_agent,
            import_agent_from_file,
            fetch_github_agents,
            fetch_github_agent_content,
            import_agent_from_github,
            // Workspace agent catalog (spec 111 Phase 6)
            commands::agent_catalog_publish::publish_local_agent_to_workspace,
            // Statecraft extraction-output endpoints (spec 120 FR-021)
            commands::statecraft_client::post_extraction_output,
            commands::statecraft_client::request_extraction_yield,
            commands::statecraft_client::fetch_extraction_output,
            // Orchestrator (044)
            orchestrate_manifest,
            get_run_status,
            cancel_run,
            cleanup_artifacts,
            list_workspace_workflows,
            // Live agent-session introspection (spec 172)
            list_live_sessions,
            get_live_session_thresholds,
            force_disconnect_session,
            // Factory Pipeline (076)
            commands::factory::list_factory_adapters,
            start_factory_pipeline,
            get_factory_pipeline_status,
            confirm_factory_stage,
            reject_factory_stage,
            list_factory_runs,
            get_factory_artifacts,
            skip_factory_step,
            resume_factory_pipeline,
            cancel_factory_pipeline,
            detect_factory_project,
            fetch_project_opc_bundle,
            commands::project_catalog_sync::get_project_catalog,
            clone_project_from_bundle,
            refresh_clone_token,
            // Provenance review (spec 121 FR-041)
            commands::provenance::provenance_get_report,
            commands::provenance::provenance_supply_citation,
            commands::provenance::provenance_downgrade_to_assumption,
            commands::provenance::provenance_promote_assumption,
            // Stage CD review (spec 122 FR-024..FR-026)
            commands::stage_cd::stage_cd_get_diff,
            commands::stage_cd::stage_cd_evaluate_gate,
            commands::stage_cd::stage_cd_reject_candidate,
            commands::stage_cd::stage_cd_accept_candidate,
            commands::stage_cd::stage_cd_force_approve,
            // Worktree agents (051)
            spawn_background_agent,
            list_background_agents,
            get_agent_diff,
            merge_agent,
            discard_agent,
            // Usage & Analytics
            get_usage_stats,
            get_usage_by_date_range,
            get_usage_details,
            get_session_stats,
            // MCP (Model Context Protocol)
            mcp_add,
            mcp_list,
            mcp_get,
            mcp_remove,
            mcp_add_json,
            mcp_add_from_claude_desktop,
            mcp_serve,
            mcp_test_connection,
            mcp_reset_project_choices,
            mcp_get_server_status,
            mcp_read_project_config,
            mcp_save_project_config,
            // Storage Management
            storage_list_tables,
            storage_read_table,
            storage_update_row,
            storage_delete_row,
            storage_insert_row,
            storage_execute_sql,
            storage_reset_database,
            // Slash Commands
            commands::slash_commands::slash_commands_list,
            commands::slash_commands::slash_command_get,
            commands::slash_commands::slash_command_save,
            commands::slash_commands::slash_command_delete,
            // Proxy Settings
            get_proxy_settings,
            save_proxy_settings,
            // Xray & Featuregraph Analysis
            commands::analysis::xray_scan_project,
            commands::analysis::featuregraph_overview,
            commands::analysis::featuregraph_impact,
            commands::analysis::governance_preflight,
            commands::analysis::governance_drift,
            commands::analysis::portfolio_overview,
            commands::analysis::get_preflight_safety_tier_reference,
            commands::analysis::get_tool_tier_assignments,
            // MCP proxy commands
            commands::mcp::mcp_list_tools,
            commands::mcp::mcp_call_tool,
            commands::mcp::mcp_read_resource,
            // Recovery system
            commands::recovery::save_emergency_data,
            commands::recovery::load_emergency_data,
            commands::recovery::cleanup_old_recovery_files,
            // Updater with SHA-256 verification
            commands::updater::check_for_update,
            commands::updater::download_and_install_update,
            // Native git operations
            commands::git::git_diff,
            commands::git::git_status,
            commands::git::git_ahead_behind,
            commands::git::git_current_branch,
            commands::git::git_last_commit,
            // Quick pane window management
            commands::quick_pane::show_quick_pane,
            commands::quick_pane::dismiss_quick_pane,
            commands::quick_pane::toggle_quick_pane,
            commands::quick_pane::get_default_quick_pane_shortcut,
            commands::quick_pane::update_quick_pane_shortcut,
            commands::quick_pane::set_quick_pane_enabled,
            // Window control (zoom, progress bar, bounds, WSL)
            commands::window_ctrl::set_zoom,
            commands::window_ctrl::get_zoom,
            commands::window_ctrl::broadcast_zoom,
            commands::window_ctrl::set_progress_bar,
            commands::window_ctrl::get_window_bounds,
            commands::window_ctrl::set_window_bounds,
            commands::window_ctrl::is_wsl,
            // WSL distro listing and execution
            commands::wsl::wsl_is_available,
            commands::wsl::wsl_list_distros,
            commands::wsl::wsl_execute,
            // Sandbox status
            commands::sandbox::sandbox_status,
            // Sidecar port discovery
            sidecars::get_sidecar_ports,
            sidecars::check_axiomregent_alive,
            sidecars::boot_gate_status,
            sidecars::open_logs_folder,
            sidecars::respawn_axiomregent,
            sidecars::quit_opc,
            // OS keychain (spec 087 Phase 5)
            keychain_store,
            keychain_retrieve,
            keychain_clear,
            // Project clone tokens (spec 112 §6.4.4)
            clone_token_store,
            clone_token_load,
            clone_token_clear,
            // Desktop OAuth (spec 080 Phase 1)
            commands::auth::auth_start_login,
            commands::auth::auth_handle_callback,
            commands::auth::auth_select_org,
            commands::auth::auth_switch_org,
            commands::auth::auth_refresh_token,
            commands::auth::auth_get_status,
            commands::auth::auth_logout,
            commands::auth::auth_take_pending_callback,
            // App settings
            commands::settings::get_statecraft_base_url,
            commands::settings::set_statecraft_base_url,
            commands::settings::reconnect_statecraft_duplex,
            // Tamper-evident audit chain (spec 207 AC-4 / FR-004)
            audit_unanchored_window,
            // OPC decomposition pipeline (spec 165)
            commands::decomposition::decomposition_run,
            commands::decomposition::decomposition_list_runs,
            commands::decomposition::decomposition_get_run,
            commands::decomposition::decomposition_promote,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
