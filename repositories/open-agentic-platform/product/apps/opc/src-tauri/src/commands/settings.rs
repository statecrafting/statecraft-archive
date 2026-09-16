//! App-level user-configurable settings.
//!
//! Currently manages the Statecraft base URL so users can switch servers at
//! runtime without setting env vars. Persisted in the `app_settings` k/v table.

use log::info;
use rusqlite::params;
use tauri::{AppHandle, Manager, State};

use super::agents::AgentDb;
use super::statecraft_client::{StatecraftClient, StatecraftState};
use super::sync_client::{OpcInstanceId, SyncClientConfig, SyncClientState};

/// Production default when nothing is configured.
pub const DEFAULT_STATECRAFT_BASE_URL: &str = "https://statecraft.ing";

/// Resolve the effective Statecraft base URL on startup:
///   1. `app_settings.statecraft_base_url` (DB, set via UI)
///   2. `STATECRAFT_BASE_URL` env var (dev / CI override)
///   3. `DEFAULT_STATECRAFT_BASE_URL`
///
/// Returns an empty string only if the DB override is explicitly set to
/// empty — callers treat "" as "client disabled".
pub fn resolve_statecraft_base_url(app: &AppHandle) -> String {
    if let Some(url) = read_statecraft_url_from_db(app) {
        return url;
    }
    let env_url = std::env::var("STATECRAFT_BASE_URL").unwrap_or_default();
    if !env_url.is_empty() {
        return env_url;
    }
    DEFAULT_STATECRAFT_BASE_URL.to_string()
}

/// Read the user-set URL directly from the SQLite file. Used at startup
/// before `AgentDb` is installed as managed state.
fn read_statecraft_url_from_db(app: &AppHandle) -> Option<String> {
    let app_data_dir = app.path().app_data_dir().ok()?;
    let db_path = app_data_dir.join("agents.db");
    if !db_path.exists() {
        return None;
    }
    let conn = rusqlite::Connection::open(&db_path).ok()?;
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = 'statecraft_base_url'",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
}

/// Return the base URL currently in effect (reflects the live client).
#[tauri::command]
#[specta::specta]
pub async fn get_statecraft_base_url(statecraft: State<'_, StatecraftState>) -> Result<String, String> {
    Ok(statecraft
        .current()
        .map(|c| c.base_url().to_string())
        .unwrap_or_default())
}

/// Persist a new base URL, rebuild the client, and clear any stale auth
/// (tokens from a different server must not leak across).
///
/// Pass an empty string to disable the integration entirely.
#[tauri::command]
#[specta::specta]
pub async fn set_statecraft_base_url(
    base_url: String,
    db: State<'_, AgentDb>,
    statecraft: State<'_, StatecraftState>,
    sync_state: State<'_, SyncClientState>,
    instance: State<'_, OpcInstanceId>,
    app: AppHandle,
) -> Result<(), String> {
    let trimmed = base_url.trim().trim_end_matches('/').to_string();

    // Reject malformed / non-http(s) URLs before any state is mutated.
    validate_statecraft_base_url(&trimmed)?;

    // Build the replacement client BEFORE touching the keychain or DB, so a
    // failure here never strands the user with their old session wiped and no
    // client installed. `new` returns `None` for an empty URL (intentional
    // disable) or — rarely — a reqwest builder failure on a non-empty URL; the
    // latter is a hard error that must not have already cleared credentials.
    let user_id = std::env::var("OPC_USER_ID").unwrap_or_else(|_| "opc-desktop".into());
    let new_client = StatecraftClient::new(&trimmed, &user_id).map(std::sync::Arc::new);
    if !trimmed.is_empty() && new_client.is_none() {
        return Err("failed to initialise Statecraft HTTP client".into());
    }

    // Decide whether this is a *genuine* server change, then persist — both
    // through the SAME managed connection. A same-server re-save must NOT
    // wipe the keychain session: doing so would force a needless re-sign-in
    // even though the saved token is still valid ("stay signed in unless the
    // credential is actually invalid").
    //
    // The previous value is read with `.optional()` so a real DB error is
    // distinct from "no row yet". A bare `Option` (the startup-only
    // `read_statecraft_url_from_db`) collapses both into `None`, which on a
    // transient read failure during a same-server re-save would read as
    // `server_changed = true` and silently clear a valid session. Here an
    // indeterminate read instead aborts the whole operation BEFORE any
    // mutation, so the destructive clear below fires only on a *confirmed*
    // change. Reading through the managed connection (rather than opening a
    // second one to the same file) also removes the lock contention that
    // makes such a transient failure possible in the first place.
    let server_changed = {
        use rusqlite::OptionalExtension;
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let previous_url: Option<String> = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'statecraft_base_url'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| format!("failed to read current statecraft_base_url: {e}"))?
            .map(|u| u.trim().trim_end_matches('/').to_string());
        let changed = previous_url.as_deref() != Some(trimmed.as_str());

        // Persist to DB — only now that the URL is known-good.
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('statecraft_base_url', ?1)",
            params![trimmed],
        )
        .map_err(|e| format!("failed to save statecraft_base_url: {e}"))?;
        changed
    };

    // Drop the old server's keychain session ONLY on a genuine server change
    // — the token belongs to the old server and must not leak to a new one.
    // On a same-server re-save we keep it so the user stays signed in. Routed
    // through the client's single-source-of-truth helper so the entry list
    // cannot drift from clear_auth. We do NOT call clear_auth() on the old
    // client: the duplex loop bound to it is aborted by the re-spawn below and
    // the old Arc is then dropped, so its in-memory state is moot.
    if server_changed {
        StatecraftClient::clear_keychain_entries();
        // The project catalog cache belongs to the old server's org; drop it
        // so a sign-in to the new server never momentarily surfaces the prior
        // org's projects before its handshake snapshot lands.
        if let Some(cache) =
            app.try_state::<super::project_catalog_sync::ProjectCatalogCache>()
        {
            cache.clear();
        }
    }

    if new_client.is_some() {
        info!("Statecraft base URL updated → {trimmed} (server_changed={server_changed})");
    } else {
        info!("Statecraft base URL cleared — integration disabled");
    }

    // Install the new client and drive the duplex loop off the SAME Arc we just
    // installed — not a second `statecraft.current()` read, which a concurrent
    // URL change could swap out from under us between the two calls.
    statecraft.replace(new_client.clone());

    // On a same-server re-save, restore the still-valid session onto the
    // freshly-built client. A new `StatecraftClient` starts with
    // `auth_token: None` and an empty `org_id`; without this restore the boot
    // gate (`org_session_ready = has_org && sync_hello`) would wedge a
    // signed-in user behind a re-sign-in prompt even though the keychain holds
    // a valid token. On a genuine server change we intentionally skip this —
    // the new server requires its own sign-in.
    if !server_changed
        && let Some(ref client) = new_client
        && client.load_token_from_keychain()
    {
        info!("Statecraft auth token restored from keychain onto new client (same server)");
    }

    // Follow the new URL on the duplex loop (spec 183 FR-T2(a)): re-spawn the
    // consumer against the new client — `spawn` aborts the prior task first, so
    // the old loop (old host, old credentials) is torn down rather than left
    // running against a server it can no longer authenticate to. When the URL
    // is cleared, stop the loop entirely. This is the authoritative resolution
    // of the spawn-time-binding caveat: the loop no longer keeps targeting the
    // old host after a URL change.
    match new_client {
        Some(client) => {
            let config = SyncClientConfig {
                base_url: trimmed.clone(),
                client_id: instance.0.clone(),
                client_version: Some(env!("CARGO_PKG_VERSION").to_string()),
            };
            sync_state.spawn(config, client, app).await;
            info!("Statecraft duplex sync loop re-spawned for {trimmed}");
        }
        None => {
            sync_state.shutdown().await;
            info!("Statecraft duplex sync loop stopped (integration disabled)");
        }
    }

    Ok(())
}

/// Force an immediate duplex reconnect by re-spawning the sync consumer
/// against the live client.
///
/// Spec 183 — explicit recovery affordance. Re-spawning `run_forever` resets
/// its per-outage refresh budget (`MAX_REFRESHES_PER_OUTAGE`) and the
/// consecutive-failure counter to zero — they are loop-locals, so a fresh
/// spawn always starts clean — and triggers an immediate connect attempt with
/// the freshly-resolved bearer instead of waiting out the current backoff.
/// This is the manual counterpart to the FR-T2(a) settings URL-change
/// re-spawn, and the load-bearing recovery for:
///   * a burned refresh budget after a session-expiry + re-login (the new
///     valid bearer would otherwise march toward the give-up threshold
///     without a refresh, because the budget only resets on a clean connect),
///   * a duplex stuck in a long backoff after a transient outage, and
///   * a wedged consumer (belt-and-braces over the FR-T2(a) spawn-ordering
///     fix — `spawn` aborts any prior task first, so the result is always a
///     single live loop).
///
/// Errors (rather than silently no-ops) when the integration is disabled — no
/// base URL means there is no client to reconnect, and the caller should know.
#[tauri::command]
#[specta::specta]
pub async fn reconnect_statecraft_duplex(
    statecraft: State<'_, StatecraftState>,
    sync_state: State<'_, SyncClientState>,
    instance: State<'_, OpcInstanceId>,
    app: AppHandle,
) -> Result<(), String> {
    let client = statecraft
        .current()
        .ok_or("Statecraft integration is disabled (no base URL configured)")?;
    let config = SyncClientConfig {
        base_url: client.base_url().to_string(),
        client_id: instance.0.clone(),
        client_version: Some(env!("CARGO_PKG_VERSION").to_string()),
    };
    sync_state.spawn(config, client, app).await;
    info!("Statecraft duplex sync loop re-spawned (manual reconnect)");
    Ok(())
}

/// Validate a trimmed Statecraft base URL. Empty is allowed — it means
/// "disable the integration". Non-empty must parse as a well-formed `http` or
/// `https` URL. A prefix check (`starts_with("http://")`) would wave through
/// malformed authorities like `http://bad::url`, which then fail every request
/// while sitting persisted in the DB with no signal to the user; a real parse
/// rejects them up front. `http` is intentionally permitted so self-hosted and
/// localhost-dev servers work — this runs in a desktop app where the user owns
/// the endpoint, so host-level egress filtering is out of scope here.
fn validate_statecraft_base_url(trimmed: &str) -> Result<(), String> {
    if trimmed.is_empty() {
        return Ok(());
    }
    match url::Url::parse(trimmed) {
        Ok(u) if matches!(u.scheme(), "http" | "https") => Ok(()),
        Ok(u) => Err(format!("URL scheme must be http or https, got {:?}", u.scheme())),
        Err(e) => Err(format!("invalid Statecraft base URL: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::validate_statecraft_base_url as validate;

    #[test]
    fn empty_url_is_allowed_meaning_disable() {
        assert!(validate("").is_ok());
    }

    #[test]
    fn well_formed_http_and_https_are_accepted() {
        assert!(validate("https://statecraft.ing").is_ok());
        assert!(validate("http://localhost:4000").is_ok());
        assert!(validate("http://127.0.0.1:8080").is_ok());
    }

    #[test]
    fn malformed_authority_is_rejected_before_persist() {
        // The retired prefix check accepted this; a real parse rejects it so it
        // never reaches the DB or wipes the keychain.
        assert!(validate("http://bad::url").is_err());
    }

    #[test]
    fn non_http_scheme_is_rejected() {
        assert!(validate("file:///etc/passwd").is_err());
        assert!(validate("ftp://example.com").is_err());
    }

    #[test]
    fn garbage_without_scheme_is_rejected() {
        assert!(validate("not a url").is_err());
    }
}
