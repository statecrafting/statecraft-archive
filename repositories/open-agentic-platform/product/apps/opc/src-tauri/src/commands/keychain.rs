//! OS keychain storage for Rauthy JWT session tokens (spec 087 Phase 5)
//! and project-scoped GitHub clone tokens (spec 112 §6.4.4).
//!
//! Uses the platform's native credential store:
//! - macOS: Keychain
//! - Windows: Credential Manager
//! - Linux: Secret Service (GNOME Keyring, KWallet)
//!
//! Slot conventions under service name "dev.opc.statecraft":
//! - "session"                      — Rauthy JWT
//! - "github-clone-token:<project>" — JSON-encoded `StoredCloneToken`
//!   (value, source, expires_at) for spec 112 §6.4.4 refresh.

use super::result::AppResult;
use serde::{Deserialize, Serialize};

const SERVICE_NAME: &str = "dev.opc.statecraft";
const DEFAULT_USER: &str = "session";
const CLONE_TOKEN_PREFIX: &str = "github-clone-token:";

/// Store a JWT in the OS keychain.
#[tauri::command]
#[specta::specta]
pub fn keychain_store(token: String, user: Option<String>) -> AppResult<()> {
    let username = user.as_deref().unwrap_or(DEFAULT_USER);
    let entry = keyring::Entry::new(SERVICE_NAME, username)
        .map_err(|e| format!("keychain entry error: {e}"))?;
    entry
        .set_password(&token)
        .map_err(|e| format!("keychain store error: {e}"))?;
    Ok(())
}

/// Retrieve a JWT from the OS keychain. Returns None if not found.
#[tauri::command]
#[specta::specta]
pub fn keychain_retrieve(user: Option<String>) -> AppResult<Option<String>> {
    let username = user.as_deref().unwrap_or(DEFAULT_USER);
    let entry = keyring::Entry::new(SERVICE_NAME, username)
        .map_err(|e| format!("keychain entry error: {e}"))?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keychain retrieve error: {e}")),
    }
}

/// Clear a JWT from the OS keychain.
#[tauri::command]
#[specta::specta]
pub fn keychain_clear(user: Option<String>) -> AppResult<()> {
    let username = user.as_deref().unwrap_or(DEFAULT_USER);
    let entry = keyring::Entry::new(SERVICE_NAME, username)
        .map_err(|e| format!("keychain entry error: {e}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // already cleared
        Err(e) => Err(format!("keychain clear error: {e}")),
    }
}

// ---------------------------------------------------------------------------
// Spec 112 §6.4.4 — project-scoped clone-token storage
// ---------------------------------------------------------------------------

/// Persisted shape of a clone token. Mirrors `OpcBundleCloneToken` on
/// the wire side; `expires_at` is a string so we don't drag a date type
/// into the keychain layer (the value is whatever Statecraft returned).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct StoredCloneToken {
    pub value: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

fn clone_token_slot(project_id: &str) -> String {
    format!("{CLONE_TOKEN_PREFIX}{project_id}")
}

/// Store a project's clone token in the OS keychain.
#[tauri::command]
#[specta::specta]
pub fn clone_token_store(
    project_id: String,
    value: String,
    source: String,
    expires_at: Option<String>,
) -> AppResult<()> {
    let entry = keyring::Entry::new(SERVICE_NAME, &clone_token_slot(&project_id))
        .map_err(|e| format!("keychain entry error: {e}"))?;
    let payload = StoredCloneToken {
        value,
        source,
        expires_at,
    };
    let encoded = serde_json::to_string(&payload)
        .map_err(|e| format!("clone token encode error: {e}"))?;
    entry
        .set_password(&encoded)
        .map_err(|e| format!("keychain store error: {e}"))?;
    Ok(())
}

/// Retrieve a project's clone token. Returns None if no token is
/// stored for this project. A stored payload that fails to decode is
/// treated as a hard error so the cockpit can re-fetch from the
/// bundle endpoint instead of silently re-using a corrupt slot.
#[tauri::command]
#[specta::specta]
pub fn clone_token_load(project_id: String) -> AppResult<Option<StoredCloneToken>> {
    let entry = keyring::Entry::new(SERVICE_NAME, &clone_token_slot(&project_id))
        .map_err(|e| format!("keychain entry error: {e}"))?;
    match entry.get_password() {
        Ok(raw) => {
            let payload: StoredCloneToken = serde_json::from_str(&raw)
                .map_err(|e| format!("clone token decode error: {e}"))?;
            Ok(Some(payload))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keychain retrieve error: {e}")),
    }
}

/// Clear a project's clone token (e.g. on workspace switch, project
/// deletion, or after a 401 + refresh cycle that invalidates the
/// previous credential).
#[tauri::command]
#[specta::specta]
pub fn clone_token_clear(project_id: String) -> AppResult<()> {
    let entry = keyring::Entry::new(SERVICE_NAME, &clone_token_slot(&project_id))
        .map_err(|e| format!("keychain entry error: {e}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain clear error: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clone_token_slot_uses_project_id_prefix() {
        assert_eq!(
            clone_token_slot("11111111-1111-1111-1111-111111111111"),
            "github-clone-token:11111111-1111-1111-1111-111111111111"
        );
    }

    #[test]
    fn stored_clone_token_round_trips_json() {
        let token = StoredCloneToken {
            value: "ghs_FAKE".into(),
            source: "github_installation".into(),
            expires_at: Some("2026-04-22T11:00:00.000Z".into()),
        };
        let encoded = serde_json::to_string(&token).unwrap();
        let decoded: StoredCloneToken = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded.value, "ghs_FAKE");
        assert_eq!(decoded.source, "github_installation");
        assert_eq!(decoded.expires_at.as_deref(), Some("2026-04-22T11:00:00.000Z"));
    }

    #[test]
    fn stored_clone_token_skips_null_expiry_on_serialize() {
        let token = StoredCloneToken {
            value: "ghp_PAT".into(),
            source: "project_github_pat".into(),
            expires_at: None,
        };
        let encoded = serde_json::to_string(&token).unwrap();
        assert!(!encoded.contains("expires_at"));
        let decoded: StoredCloneToken = serde_json::from_str(&encoded).unwrap();
        assert!(decoded.expires_at.is_none());
    }
}
