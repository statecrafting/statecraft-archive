//! HTTP client for Statecraft Platform API (Specs 077, 087).
//!
//! Provides dual-write capability: the local Factory engine executes pipelines
//! while this client mirrors lifecycle events to the Statecraft control plane
//! for centralized audit, token tracking, and governance.
//!
//! Spec 087 Phase 5: auth_token is a Rauthy JWT (stored in OS keychain).
//! All authenticated requests use `Authorization: Bearer <jwt>`.
//!
//! All methods are best-effort — callers log warnings on failure but never
//! block local pipeline execution.

use base64::Engine as _;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};
use std::time::Duration;

/// Tauri-managed wrapper for the optional Statecraft HTTP client.
///
/// Wrapped in a `RwLock` so the base URL can be swapped at runtime via the
/// settings UI (see `commands::settings::set_statecraft_base_url`). When the
/// URL is unset, the inner `Option` is `None` and factory commands run
/// local-only.
pub struct StatecraftState(pub RwLock<Option<Arc<StatecraftClient>>>);

impl StatecraftState {
    /// Return a shared handle to the current client, if any.
    ///
    /// The client is held in an `Arc` so every holder — the boot-gate status
    /// reader (spec 183 FR-T2), the duplex consumer's auth handle (spec 110),
    /// and each authenticated REST command — shares ONE interior-mutable
    /// instance. A `set_auth_token` / `set_org_id` / `adopt_token` write is
    /// therefore visible to all of them immediately. When this was a value
    /// type, `current()` returned a snapshot clone, so a sign-in's
    /// `set_org_id` mutated a throwaway copy and the boot gate's in-memory
    /// `org_id` read stayed empty — wedging the cockpit at "Waiting for
    /// statecraft duplex handshake" even after `sync.hello` arrived.
    pub fn current(&self) -> Option<Arc<StatecraftClient>> {
        match self.0.read() {
            Ok(g) => g.clone(),
            // A panic in some other holder poisons the lock, but the inner
            // `Option<Arc<…>>` is not corrupted by that. Recover and log rather
            // than `.ok()` → `None`, which would silently disable Statecraft
            // (boot gate stuck "not ready", REST dual-write skipped) with no
            // trace of why.
            Err(poisoned) => {
                // Recover, then clear the poison so this logs once per poison
                // event rather than on every subsequent op (the lock stays
                // poisoned after into_inner()). The inner Option<Arc<…>> is not
                // corrupted by an unrelated holder's panic.
                log::error!(
                    "StatecraftState RwLock poisoned (read) — recovering inner and clearing poison"
                );
                let value = poisoned.into_inner().clone();
                self.0.clear_poison();
                value
            }
        }
    }

    /// Replace the current client (used when the base URL changes).
    pub fn replace(&self, client: Option<Arc<StatecraftClient>>) {
        match self.0.write() {
            Ok(mut g) => *g = client,
            Err(poisoned) => {
                log::error!(
                    "StatecraftState RwLock poisoned (write) — recovering inner and clearing poison"
                );
                *poisoned.into_inner() = client;
                self.0.clear_poison();
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Stage ID mapping — local engine uses longer names than Statecraft
// ---------------------------------------------------------------------------

/// Map local pipeline stage IDs to Statecraft's canonical stage IDs.
pub fn to_statecraft_stage_id(local_id: &str) -> &str {
    match local_id {
        "s4-api-specification" => "s4-api-spec",
        "s5-ui-specification" => "s5-ui-spec",
        other => other,
    }
}

// ---------------------------------------------------------------------------
// JWT helper — single source of truth for Rauthy token claim extraction
// ---------------------------------------------------------------------------

/// Decode the payload of a Rauthy JWT into a JSON value. Returns `None` on
/// malformed tokens (wrong segment count, non-base64 payload, non-JSON body).
/// Signature is intentionally not verified here — desktop-side callers use
/// claims for read-back of fields the server already validated.
pub(super) fn decode_jwt_claims(token: &str) -> Option<serde_json::Value> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(parts[1])
        .ok()?;
    serde_json::from_slice(&payload).ok()
}

/// Read a string claim from a Rauthy-minted JWT payload.
///
/// Rauthy nests the OAP custom user attributes (`oap_org_id`, `oap_user_id`,
/// `oap_org_slug`, `github_login`, …) under a top-level `custom` object — see
/// statecraft `api/auth/sessionMint.ts` ("carries the attributes under
/// `custom.oap_*`") and the `oap` scope's `attr_include_access` mapping in
/// `scripts/seed-rauthy.mjs`. Standard OIDC claims (`email`, `sub`, …) stay at
/// the top level. This accessor checks `custom` first, then falls back to the
/// top level, so both placements resolve and a future Rauthy mapping change
/// cannot silently re-break org/identity derivation.
///
/// Without this, the keychain-restore / refresh / `adopt_token` paths (which
/// derive `org_id` from the JWT) read a top-level `oap_org_id` that never
/// exists, leaving `org_id` empty on every cold start — the boot gate's
/// `has_org` term stays false and the cockpit cannot open even though the
/// session is valid. Fresh sign-in masks this because it sets `org_id` from
/// the HTTP response body, not the JWT.
pub(super) fn claim_str<'a>(claims: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    // `.as_str()` is applied per-level so the fallback fires when `custom[key]`
    // is absent OR present-but-non-string. A `.or_else` after a single trailing
    // `.as_str()` would be skipped when `custom[key]` holds a non-string value
    // (e.g. a future numeric Rauthy attribute), silently returning None instead
    // of trying the top level.
    claims
        .get("custom")
        .and_then(|c| c.get(key))
        .and_then(|v| v.as_str())
        .or_else(|| claims.get(key).and_then(|v| v.as_str()))
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/// Thin HTTP wrapper around the Statecraft Platform API.
///
/// Held as Tauri managed state so all commands share one connection pool.
/// Org-aware: carries the active org ID and a Rauthy JWT for authenticated
/// platform endpoints (spec 087 Phase 5, renamed by spec 119). The JWT is stored in the OS
/// keychain via the `keychain` module.
pub struct StatecraftClient {
    client: Client,
    base_url: String,
    /// Default actor identity sent on mutating requests.
    actor_user_id: RwLock<String>,
    /// Active org ID (set at runtime after auth).
    org_id: RwLock<String>,
    /// Rauthy JWT for authenticated endpoints (loaded from OS keychain).
    auth_token: RwLock<Option<String>>,
}

impl Clone for StatecraftClient {
    fn clone(&self) -> Self {
        Self {
            client: self.client.clone(),
            base_url: self.base_url.clone(),
            actor_user_id: RwLock::new(self.actor_user_id.read().unwrap().clone()),
            org_id: RwLock::new(self.org_id.read().unwrap().clone()),
            auth_token: RwLock::new(self.auth_token.read().unwrap().clone()),
        }
    }
}

/// OS-keychain entry names this client persists under service
/// `dev.opc.statecraft`. Single source of truth so the logout path
/// (`clear_auth`) and the settings URL-change cleanup cannot drift — a new
/// credential added here is cleared by both at once.
const KEYCHAIN_ENTRIES: &[&str] = &["session", "refresh_token"];

impl StatecraftClient {
    /// Build a new client.  Returns `None` when `base_url` is empty (integration disabled).
    pub fn new(base_url: &str, actor_user_id: &str) -> Option<Self> {
        if base_url.is_empty() {
            return None;
        }
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .ok()?;
        Some(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            actor_user_id: RwLock::new(actor_user_id.to_string()),
            org_id: RwLock::new(String::new()),
            auth_token: RwLock::new(None),
        })
    }

    /// Set the active org ID (called after auth).
    pub fn set_org_id(&self, id: &str) {
        *self.org_id.write().unwrap() = id.to_string();
    }

    /// Get the active org ID.
    pub fn org_id(&self) -> String {
        self.org_id.read().unwrap().clone()
    }

    /// Set the auth token (Rauthy JWT) and persist to OS keychain.
    ///
    /// Also derives `org_id` from the token's `oap_org_id` claim so the two
    /// fields stay coupled — see `apply_token` for the invariant.
    pub fn set_auth_token(&self, token: &str) {
        self.apply_token(token);
        // Best-effort persist to keychain
        if let Ok(entry) = keyring::Entry::new("dev.opc.statecraft", "session") {
            let _ = entry.set_password(token);
        }
    }

    /// Type invariant: whenever `auth_token` is `Some`, `org_id` reflects the
    /// token's `oap_org_id` claim. Used by both fresh-auth (`set_auth_token`)
    /// and keychain-restore (`load_token_from_keychain`) so the field cannot
    /// drift between writers.
    fn apply_token(&self, token: &str) {
        *self.auth_token.write().unwrap() = Some(token.to_string());
        if let Some(claims) = decode_jwt_claims(token)
            && let Some(org) = claim_str(&claims, "oap_org_id")
        {
            *self.org_id.write().unwrap() = org.to_string();
        }
    }

    /// Set the in-memory token (and derive `org_id`) WITHOUT a keychain write.
    /// Used by the duplex consumer (spec 110 / 183) when the session value was
    /// already read off-thread via [`read_session_token_from_keychain`] under
    /// `tokio::task::spawn_blocking` — splitting the blocking keychain read
    /// from this cheap in-memory apply keeps OS keychain I/O off the tokio
    /// worker. Distinct from [`load_token_from_keychain`], which performs the
    /// (blocking) read itself.
    pub(crate) fn adopt_token(&self, token: &str) {
        self.apply_token(token);
    }

    /// Load the auth token from the OS keychain (called on startup).
    pub fn load_token_from_keychain(&self) -> bool {
        if let Ok(entry) = keyring::Entry::new("dev.opc.statecraft", "session")
            && let Ok(token) = entry.get_password()
        {
            self.apply_token(&token);
            return true;
        }
        false
    }

    /// Update the actor user identity at runtime (e.g. after desktop OAuth).
    pub fn set_actor_user_id(&self, id: &str) {
        *self.actor_user_id.write().unwrap() = id.to_string();
    }

    /// Return the base URL (without trailing slash).
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Return the current auth token, if one is loaded. Primarily used by
    /// the duplex sync consumer (spec 110 Phase 2) which needs to attach
    /// it as a `Authorization: Bearer …` header on the WebSocket handshake.
    pub fn auth_token(&self) -> Option<String> {
        self.auth_token.read().ok().and_then(|g| g.clone())
    }

    /// Clear all auth state (tokens, workspace, actor identity).
    pub fn clear_auth(&self) {
        *self.auth_token.write().unwrap() = None;
        *self.org_id.write().unwrap() = String::new();
        Self::clear_keychain_entries();
    }

    /// Delete every persisted OS-keychain entry for this client (the old
    /// server's session). Single source of truth for the entry list, so the
    /// `clear_auth` logout path and the settings URL-change cleanup
    /// (`set_statecraft_base_url`) cannot drift — a credential added to
    /// `KEYCHAIN_ENTRIES` is cleared by both at once.
    pub(crate) fn clear_keychain_entries() {
        for key in KEYCHAIN_ENTRIES {
            if let Ok(entry) = keyring::Entry::new("dev.opc.statecraft", key) {
                let _ = entry.delete_credential();
            }
        }
    }

    /// Build a request with Bearer auth header.
    fn authed_get(&self, url: &str) -> reqwest::RequestBuilder {
        let mut req = self.client.get(url);
        if let Some(token) = self.auth_token.read().unwrap().as_ref() {
            req = req.bearer_auth(token);
        }
        req
    }

    fn authed_post(&self, url: &str) -> reqwest::RequestBuilder {
        let mut req = self.client.post(url);
        if let Some(token) = self.auth_token.read().unwrap().as_ref() {
            req = req.bearer_auth(token);
        }
        req
    }

    /// Spec 112 §6.3 — silent JWT refresh.
    ///
    /// Reads the persisted Rauthy refresh token from the OS keychain, exchanges
    /// it at `/auth/desktop/refresh`, and rotates the in-memory + keychain
    /// access/refresh pair. Returns Ok only when the new bearer is live;
    /// callers retry the failing request once on success and surface the
    /// original 401 on failure.
    ///
    /// `pub(crate)` so the duplex sync consumer (spec 110 / 183) can drive the
    /// same silent refresh when its WebSocket upgrade is rejected 401, rather
    /// than retrying an expired bearer forever.
    pub(crate) async fn refresh_jwt(&self) -> Result<(), StatecraftError> {
        let refresh_token = keyring::Entry::new("dev.opc.statecraft", "refresh_token")
            .ok()
            .and_then(|e| e.get_password().ok())
            .ok_or_else(|| {
                StatecraftError::Api(401, "no refresh_token in keychain".into())
            })?;

        let url = format!("{}/auth/desktop/refresh", self.base_url);
        let body = serde_json::json!({ "refreshToken": refresh_token });
        let resp = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(StatecraftError::Network)?;
        if !resp.status().is_success() {
            return Err(StatecraftError::Api(
                resp.status().as_u16(),
                resp.text().await.unwrap_or_default(),
            ));
        }
        let data: RefreshTokenResponse =
            resp.json().await.map_err(StatecraftError::Decode)?;
        self.set_auth_token(&data.access_token);
        if let Ok(entry) = keyring::Entry::new("dev.opc.statecraft", "refresh_token") {
            let _ = entry.set_password(&data.refresh_token);
        }
        Ok(())
    }

    // -- FR-001: Init Pipeline ------------------------------------------------

    pub async fn init_pipeline(
        &self,
        project_id: &str,
        adapter: &str,
        business_docs: &[BusinessDocRef],
    ) -> Result<InitResponse, StatecraftError> {
        let url = format!("{}/api/projects/{}/factory/init", self.base_url, project_id);
        let body = InitRequest {
            adapter: adapter.into(),
            business_docs: if business_docs.is_empty() {
                None
            } else {
                Some(business_docs.to_vec())
            },
            policy_overrides: None,
            actor_user_id: self.actor_user_id.read().unwrap().clone(),
            org_id: self.org_id(),
            source: "opc-direct",
        };
        let resp = self
            .authed_post(&url)
            .json(&body)
            .send()
            .await
            .map_err(StatecraftError::Network)?;
        if !resp.status().is_success() {
            return Err(StatecraftError::Api(
                resp.status().as_u16(),
                resp.text().await.unwrap_or_default(),
            ));
        }
        resp.json().await.map_err(StatecraftError::Decode)
    }

    // -- FR-004: Confirm Stage ------------------------------------------------

    pub async fn confirm_stage(
        &self,
        project_id: &str,
        stage_id: &str,
        notes: Option<&str>,
    ) -> Result<ConfirmResponse, StatecraftError> {
        let sc_stage = to_statecraft_stage_id(stage_id);
        let url = format!(
            "{}/api/projects/{}/factory/stage/{}/confirm",
            self.base_url, project_id, sc_stage
        );
        let body = ConfirmRequest {
            notes: notes.map(String::from),
            actor_user_id: self.actor_user_id.read().unwrap().clone(),
            org_id: self.org_id(),
        };
        let resp = self
            .authed_post(&url)
            .json(&body)
            .send()
            .await
            .map_err(StatecraftError::Network)?;
        if !resp.status().is_success() {
            return Err(StatecraftError::Api(
                resp.status().as_u16(),
                resp.text().await.unwrap_or_default(),
            ));
        }
        resp.json().await.map_err(StatecraftError::Decode)
    }

    // -- FR-005: Reject Stage -------------------------------------------------

    pub async fn reject_stage(
        &self,
        project_id: &str,
        stage_id: &str,
        feedback: &str,
    ) -> Result<RejectResponse, StatecraftError> {
        let sc_stage = to_statecraft_stage_id(stage_id);
        let url = format!(
            "{}/api/projects/{}/factory/stage/{}/reject",
            self.base_url, project_id, sc_stage
        );
        let body = RejectRequest {
            feedback: feedback.into(),
            actor_user_id: self.actor_user_id.read().unwrap().clone(),
            org_id: self.org_id(),
        };
        let resp = self
            .authed_post(&url)
            .json(&body)
            .send()
            .await
            .map_err(StatecraftError::Network)?;
        if !resp.status().is_success() {
            return Err(StatecraftError::Api(
                resp.status().as_u16(),
                resp.text().await.unwrap_or_default(),
            ));
        }
        resp.json().await.map_err(StatecraftError::Decode)
    }

    // -- FR-009: Pipeline Status Update -----------------------------------------

    pub async fn update_pipeline_status(
        &self,
        project_id: &str,
        pipeline_id: &str,
        status: &str,
        current_stage: Option<&str>,
        error: Option<&str>,
        phase: Option<&str>,
    ) -> Result<StatusUpdateResponse, StatecraftError> {
        let url = format!(
            "{}/api/projects/{}/factory/status-update",
            self.base_url, project_id
        );
        let body = StatusUpdateRequest {
            pipeline_id: pipeline_id.into(),
            status: status.into(),
            current_stage: current_stage.map(String::from),
            error: error.map(String::from),
            phase: phase.map(String::from),
            actor_user_id: self.actor_user_id.read().unwrap().clone(),
            org_id: self.org_id(),
        };
        let resp = self
            .authed_post(&url)
            .json(&body)
            .send()
            .await
            .map_err(StatecraftError::Network)?;
        if !resp.status().is_success() {
            return Err(StatecraftError::Api(
                resp.status().as_u16(),
                resp.text().await.unwrap_or_default(),
            ));
        }
        resp.json().await.map_err(StatecraftError::Decode)
    }

    // -- FR-010: Scaffold Progress ---------------------------------------------

    pub async fn report_scaffold_progress(
        &self,
        project_id: &str,
        pipeline_id: &str,
        features: &[ScaffoldFeatureReport],
    ) -> Result<ScaffoldProgressResponse, StatecraftError> {
        let url = format!(
            "{}/api/projects/{}/factory/scaffold-progress",
            self.base_url, project_id
        );
        let body = ScaffoldProgressRequest {
            pipeline_id: pipeline_id.into(),
            features: features.to_vec(),
            actor_user_id: self.actor_user_id.read().unwrap().clone(),
            org_id: self.org_id(),
        };
        let resp = self
            .authed_post(&url)
            .json(&body)
            .send()
            .await
            .map_err(StatecraftError::Network)?;
        if !resp.status().is_success() {
            return Err(StatecraftError::Api(
                resp.status().as_u16(),
                resp.text().await.unwrap_or_default(),
            ));
        }
        resp.json().await.map_err(StatecraftError::Decode)
    }

    // -- FR-012: Cancel Pipeline -------------------------------------------------

    pub async fn cancel_pipeline(
        &self,
        project_id: &str,
        reason: &str,
    ) -> Result<CancelResponse, StatecraftError> {
        let url = format!(
            "{}/api/projects/{}/factory/cancel",
            self.base_url, project_id
        );
        let body = CancelRequest {
            reason: reason.into(),
            actor_user_id: self.actor_user_id.read().unwrap().clone(),
            org_id: self.org_id(),
        };
        let resp = self
            .authed_post(&url)
            .json(&body)
            .send()
            .await
            .map_err(StatecraftError::Network)?;
        if !resp.status().is_success() {
            return Err(StatecraftError::Api(
                resp.status().as_u16(),
                resp.text().await.unwrap_or_default(),
            ));
        }
        resp.json().await.map_err(StatecraftError::Decode)
    }

    // -- FR-011: Batch Event Ingestion ------------------------------------------

    pub async fn ingest_events(
        &self,
        project_id: &str,
        pipeline_id: &str,
        events: &[OrchestratorEventReport],
    ) -> Result<EventIngestionResponse, StatecraftError> {
        let url = format!(
            "{}/api/projects/{}/factory/events",
            self.base_url, project_id
        );
        let body = EventIngestionRequest {
            pipeline_id: pipeline_id.into(),
            events: events.to_vec(),
            org_id: self.org_id(),
        };
        let resp = self
            .authed_post(&url)
            .json(&body)
            .send()
            .await
            .map_err(StatecraftError::Network)?;
        if !resp.status().is_success() {
            return Err(StatecraftError::Api(
                resp.status().as_u16(),
                resp.text().await.unwrap_or_default(),
            ));
        }
        resp.json().await.map_err(StatecraftError::Decode)
    }

    // -- 082 FR-023: Record Artifacts ------------------------------------------

    pub async fn record_artifacts(
        &self,
        project_id: &str,
        pipeline_id: &str,
        stage_id: &str,
        artifacts: &[ArtifactRecord],
    ) -> Result<RecordArtifactsResponse, StatecraftError> {
        let url = format!(
            "{}/api/projects/{}/factory/artifacts",
            self.base_url, project_id
        );
        let body = RecordArtifactsRequest {
            pipeline_id: pipeline_id.into(),
            stage_id: stage_id.into(),
            artifacts: artifacts.to_vec(),
            org_id: self.org_id(),
        };
        let resp = self
            .authed_post(&url)
            .json(&body)
            .send()
            .await
            .map_err(StatecraftError::Network)?;
        if !resp.status().is_success() {
            return Err(StatecraftError::Api(
                resp.status().as_u16(),
                resp.text().await.unwrap_or_default(),
            ));
        }
        resp.json().await.map_err(StatecraftError::Decode)
    }

    // -- Spec 120 FR-021: Extraction-Output Endpoints ---------------------------

    /// Spec 120 FR-016 — POST a typed `ExtractionOutput` produced by OPC's
    /// `s-1-extract` stage. Returns `{ duplicate, extractionRunId }`.
    pub async fn post_extraction_output(
        &self,
        project_id: &str,
        object_id: &str,
        schema_version: &str,
        output: &serde_json::Value,
    ) -> Result<PostExtractionOutputResponse, StatecraftError> {
        let url = format!(
            "{}/api/projects/{}/knowledge/objects/{}/extraction-output",
            self.base_url, project_id, object_id
        );
        let body = serde_json::json!({
            "projectId": project_id,
            "objectId": object_id,
            "orgId": self.org_id(),
            "output": output,
        });
        let resp = self
            .authed_post(&url)
            .header("X-Knowledge-Schema-Version", schema_version)
            .json(&body)
            .send()
            .await
            .map_err(StatecraftError::Network)?;
        if !resp.status().is_success() {
            return Err(StatecraftError::Api(
                resp.status().as_u16(),
                resp.text().await.unwrap_or_default(),
            ));
        }
        resp.json().await.map_err(StatecraftError::Decode)
    }

    /// Spec 120 FR-018 — request a server-side agent extraction.
    pub async fn request_extraction_yield(
        &self,
        project_id: &str,
        object_id: &str,
        content_hash: &str,
        requested_kind: Option<&str>,
        reason: &str,
    ) -> Result<YieldExtractionResponse, StatecraftError> {
        let url = format!(
            "{}/api/projects/{}/knowledge/objects/{}/yield-extraction",
            self.base_url, project_id, object_id
        );
        let mut body = serde_json::json!({
            "projectId": project_id,
            "objectId": object_id,
            "orgId": self.org_id(),
            "contentHash": content_hash,
            "reason": reason,
        });
        if let Some(kind) = requested_kind {
            body["requestedExtractorKind"] = serde_json::Value::String(kind.into());
        }
        let resp = self
            .authed_post(&url)
            .json(&body)
            .send()
            .await
            .map_err(StatecraftError::Network)?;
        if !resp.status().is_success() {
            return Err(StatecraftError::Api(
                resp.status().as_u16(),
                resp.text().await.unwrap_or_default(),
            ));
        }
        resp.json().await.map_err(StatecraftError::Decode)
    }

    /// Spec 120 FR-019 — fetch the most-recent successful extraction record
    /// for a content hash. Returns `None` on 404.
    pub async fn fetch_extraction_output(
        &self,
        project_id: &str,
        object_id: &str,
        content_hash: &str,
    ) -> Result<Option<FetchExtractionOutputResponse>, StatecraftError> {
        let url = format!(
            "{}/api/projects/{}/knowledge/objects/{}/extraction-output?contentHash={}",
            self.base_url, project_id, object_id, content_hash,
        );
        let resp = self
            .authed_get(&url)
            .send()
            .await
            .map_err(StatecraftError::Network)?;
        if resp.status().as_u16() == 404 {
            return Ok(None);
        }
        if !resp.status().is_success() {
            return Err(StatecraftError::Api(
                resp.status().as_u16(),
                resp.text().await.unwrap_or_default(),
            ));
        }
        let parsed: FetchExtractionOutputResponse =
            resp.json().await.map_err(StatecraftError::Decode)?;
        Ok(Some(parsed))
    }

    // -- 082 FR-025: Lookup Artifacts ------------------------------------------

    pub async fn lookup_artifact(
        &self,
        project_id: &str,
        content_hash: &str,
        stage_id: &str,
    ) -> Result<LookupArtifactResponse, StatecraftError> {
        let url = format!(
            "{}/api/projects/{}/factory/artifacts/lookup?content_hash={}&stage_id={}",
            self.base_url,
            project_id,
            content_hash,
            stage_id,
        );
        let resp = self
            .authed_get(&url)
            .send()
            .await
            .map_err(StatecraftError::Network)?;
        if !resp.status().is_success() {
            return Err(StatecraftError::Api(
                resp.status().as_u16(),
                resp.text().await.unwrap_or_default(),
            ));
        }
        resp.json().await.map_err(StatecraftError::Decode)
    }

    // -- Spec 111 Phase 6: one-click local→remote agent publishing -----------

    /// Create a draft in the org's agent catalog.
    ///
    /// The server scopes the draft to the orgId embedded in the Rauthy
    /// JWT (see auth middleware in statecraft's catalog.ts), so the
    /// desktop only needs a valid Bearer token plus the payload. Returns the
    /// new catalog row identifiers so the caller can link the user to the
    /// web-UI publish page.
    pub async fn create_agent_draft(
        &self,
        name: &str,
        frontmatter: serde_json::Value,
        body_markdown: &str,
    ) -> Result<CreateAgentDraftResponse, StatecraftError> {
        let url = format!("{}/api/agents", self.base_url);
        let body = CreateAgentDraftRequest {
            name: name.to_string(),
            frontmatter,
            body_markdown: body_markdown.to_string(),
        };
        let resp = self
            .authed_post(&url)
            .json(&body)
            .send()
            .await
            .map_err(StatecraftError::Network)?;
        if !resp.status().is_success() {
            return Err(StatecraftError::Api(
                resp.status().as_u16(),
                resp.text().await.unwrap_or_default(),
            ));
        }
        resp.json().await.map_err(StatecraftError::Decode)
    }

    // -- FR-008: Token Spend --------------------------------------------------

    pub async fn report_token_spend(
        &self,
        project_id: &str,
        run_id: &str,
        stage_id: &str,
        prompt_tokens: u64,
        completion_tokens: u64,
        model: &str,
    ) -> Result<(), StatecraftError> {
        let sc_stage = to_statecraft_stage_id(stage_id);
        let url = format!(
            "{}/api/projects/{}/factory/token-spend",
            self.base_url, project_id
        );
        let body = TokenSpendRequest {
            run_id: run_id.into(),
            stage_id: sc_stage.into(),
            prompt_tokens,
            completion_tokens,
            model: model.into(),
            org_id: self.org_id(),
        };
        let resp = self
            .authed_post(&url)
            .json(&body)
            .send()
            .await
            .map_err(StatecraftError::Network)?;
        if !resp.status().is_success() {
            return Err(StatecraftError::Api(
                resp.status().as_u16(),
                resp.text().await.unwrap_or_default(),
            ));
        }
        Ok(())
    }

    /// Spec 112 §6.3 — fetch the Open-in-OPC bundle for a project.
    ///
    /// Mirrors `GET /api/projects/:projectId/opc-bundle`. The bundle carries
    /// everything OPC needs after activating an `opc://` deep link: the
    /// project, its repo, its adapter, the org's contracts and processes,
    /// and the workspace's published agent catalog. Workspace scoping is
    /// enforced server-side via the Bearer token.
    ///
    /// Auto-retries once on 401 by silently refreshing the Rauthy session
    /// (refresh-token in the OS keychain) so an expired access token does
    /// not surface to the user as a permanent inbox-banner failure.
    pub async fn get_project_opc_bundle(
        &self,
        project_id: &str,
    ) -> Result<OpcBundleResponse, StatecraftError> {
        let url = format!(
            "{}/api/projects/{}/opc-bundle",
            self.base_url, project_id
        );
        self.authed_json_get_with_refresh(&url).await
    }

    /// Spec 112 §6.4.2 — refresh just the clone token.
    ///
    /// Cheaper than re-fetching the full bundle when an installation
    /// token is within the 5-minute refresh window or when a 401
    /// surfaces from a GitHub call. The response shape is a
    /// `{ cloneToken: OpcBundleCloneToken | null }` envelope.
    ///
    /// Same 401 → silent-refresh-and-retry as `get_project_opc_bundle`.
    pub async fn refresh_project_clone_token(
        &self,
        project_id: &str,
    ) -> Result<CloneTokenResponse, StatecraftError> {
        let url = format!(
            "{}/api/projects/{}/clone-token",
            self.base_url, project_id
        );
        self.authed_json_get_with_refresh(&url).await
    }

    /// Internal: GET → JSON with one transparent retry on 401.
    ///
    /// On 401 the client attempts a Rauthy refresh-token exchange against
    /// `/auth/desktop/refresh`. If the refresh succeeds, the original
    /// request is replayed once with the new bearer; otherwise the original
    /// 401 surfaces to the caller. Both retries log just the status to
    /// avoid leaking response bodies to the structured logger.
    /// Spec 198 FR-005 / ASI04 m1 — fetch the platform JWKS for admission-seal
    /// verification. No auth header; the JWKS endpoint is public.
    ///
    /// Used by the desktop run path to verify `seal_jws` from the OPC bundle
    /// before accepting any factory run. Fail-closed: `Err` prevents the run.
    pub async fn fetch_factory_jwks(
        &self,
    ) -> Result<factory_engine::platform_jws::PlatformJwks, StatecraftError> {
        let url = format!("{}/api/factory/.well-known/jwks.json", self.base_url);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(StatecraftError::Network)?;
        if !resp.status().is_success() {
            return Err(StatecraftError::Api(
                resp.status().as_u16(),
                resp.text().await.unwrap_or_default(),
            ));
        }
        resp.json().await.map_err(StatecraftError::Decode)
    }

    async fn authed_json_get_with_refresh<T>(
        &self,
        url: &str,
    ) -> Result<T, StatecraftError>
    where
        T: for<'de> Deserialize<'de>,
    {
        let resp = self
            .authed_get(url)
            .send()
            .await
            .map_err(StatecraftError::Network)?;
        if resp.status().as_u16() != 401 {
            if !resp.status().is_success() {
                return Err(StatecraftError::Api(
                    resp.status().as_u16(),
                    resp.text().await.unwrap_or_default(),
                ));
            }
            return resp.json().await.map_err(StatecraftError::Decode);
        }

        // 401: try to refresh once, then retry. Carry forward the
        // original body so a refresh-failure still reports the meaningful
        // error to the inbox banner.
        let original_body = resp.text().await.unwrap_or_default();
        if let Err(refresh_err) = self.refresh_jwt().await {
            return Err(StatecraftError::Api(
                401,
                format!(
                    "{} (refresh failed: {})",
                    if original_body.is_empty() {
                        "unauthenticated".to_string()
                    } else {
                        original_body
                    },
                    refresh_err
                ),
            ));
        }
        let retry = self
            .authed_get(url)
            .send()
            .await
            .map_err(StatecraftError::Network)?;
        if !retry.status().is_success() {
            return Err(StatecraftError::Api(
                retry.status().as_u16(),
                retry.text().await.unwrap_or_default(),
            ));
        }
        retry.json().await.map_err(StatecraftError::Decode)
    }
}

/// Blocking keychain read of the persisted session token. Free function (no
/// `&self`) because the entry coordinates are constant, so it is safe to hand
/// to `tokio::task::spawn_blocking` without borrowing a client across the
/// thread boundary. Pair with [`StatecraftClient::adopt_token`] to apply the
/// result in-memory once it has been read off the async executor
/// (spec 110 / 183 duplex consumer).
pub(crate) fn read_session_token_from_keychain() -> Option<String> {
    keyring::Entry::new("dev.opc.statecraft", "session")
        .ok()
        .and_then(|e| e.get_password().ok())
}

// ---------------------------------------------------------------------------
// Request / Response types (mirror Statecraft's TypeScript shapes)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct InitRequest {
    adapter: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    business_docs: Option<Vec<BusinessDocRef>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    policy_overrides: Option<PolicyOverrides>,
    #[serde(rename = "actorUserId")]
    actor_user_id: String,
    #[serde(rename = "orgId")]
    org_id: String,
    // Spec 110 §8 Phase 6: server default is now "statecraft". The desktop's
    // dual-write path is already running the engine locally, so it must pin
    // `source` to "opc-direct" to prevent statecraft from dispatching a
    // `factory.run.request` envelope back to the same (or another) OPC.
    source: &'static str,
}

#[derive(Clone, Serialize)]
pub struct BusinessDocRef {
    pub name: String,
    pub storage_ref: String,
}

#[derive(Serialize)]
pub struct PolicyOverrides {
    pub max_retry_per_feature: Option<u32>,
    pub token_budget_total: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct InitResponse {
    pub pipeline_id: String,
    pub adapter: String,
    pub policy_bundle_id: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Serialize)]
struct ConfirmRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
    #[serde(rename = "actorUserId")]
    actor_user_id: String,
    #[serde(rename = "orgId")]
    org_id: String,
}

#[derive(Debug, Deserialize)]
pub struct ConfirmResponse {
    pub stage: String,
    pub confirmed_by: String,
    pub confirmed_at: String,
    pub audit_entry_id: String,
}

#[derive(Serialize)]
struct RejectRequest {
    feedback: String,
    #[serde(rename = "actorUserId")]
    actor_user_id: String,
    #[serde(rename = "orgId")]
    org_id: String,
}

#[derive(Debug, Deserialize)]
pub struct RejectResponse {
    pub stage: String,
    pub rejected_by: String,
    pub rejected_at: String,
    pub feedback: String,
    pub audit_entry_id: String,
}

#[derive(Serialize)]
struct StatusUpdateRequest {
    pipeline_id: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    current_stage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    phase: Option<String>,
    #[serde(rename = "actorUserId")]
    actor_user_id: String,
    #[serde(rename = "orgId")]
    org_id: String,
}

#[derive(Debug, Deserialize)]
pub struct StatusUpdateResponse {
    pub pipeline_id: String,
    pub status: String,
    pub audit_entry_id: String,
}

#[derive(Clone, Serialize)]
pub struct ScaffoldFeatureReport {
    pub feature_id: String,
    pub category: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files_created: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_tokens: Option<u64>,
}

#[derive(Serialize)]
struct ScaffoldProgressRequest {
    pipeline_id: String,
    features: Vec<ScaffoldFeatureReport>,
    #[serde(rename = "actorUserId")]
    actor_user_id: String,
    #[serde(rename = "orgId")]
    org_id: String,
}

#[derive(Debug, Deserialize)]
pub struct ScaffoldProgressResponse {
    pub upserted: u32,
    pub audit_entry_id: String,
}

#[derive(Serialize)]
struct CancelRequest {
    reason: String,
    #[serde(rename = "actorUserId")]
    actor_user_id: String,
    #[serde(rename = "orgId")]
    org_id: String,
}

#[derive(Debug, Deserialize)]
pub struct CancelResponse {
    pub pipeline_id: String,
    pub cancelled_at: String,
    pub audit_entry_id: String,
}

#[derive(Clone, Serialize)]
pub struct OrchestratorEventReport {
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct EventIngestionRequest {
    pipeline_id: String,
    events: Vec<OrchestratorEventReport>,
    #[serde(rename = "orgId")]
    org_id: String,
}

#[derive(Debug, Deserialize)]
pub struct EventIngestionResponse {
    pub ingested: u32,
}

#[derive(Serialize)]
struct TokenSpendRequest {
    run_id: String,
    stage_id: String,
    prompt_tokens: u64,
    completion_tokens: u64,
    model: String,
    #[serde(rename = "orgId")]
    org_id: String,
}

// ---------------------------------------------------------------------------
// Artifact types (082 Phase 3)
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
pub struct ArtifactRecord {
    pub artifact_type: String,
    pub content_hash: String,
    pub storage_path: String,
    pub size_bytes: u64,
}

#[derive(Serialize)]
struct RecordArtifactsRequest {
    pipeline_id: String,
    stage_id: String,
    artifacts: Vec<ArtifactRecord>,
    #[serde(rename = "orgId")]
    org_id: String,
}

#[derive(Debug, Deserialize)]
pub struct RecordArtifactsResponse {
    pub recorded: u32,
}

#[derive(Debug, Deserialize)]
pub struct LookupArtifactResponse {
    pub found: bool,
    pub artifact: Option<ArtifactInfo>,
}

// ---------------------------------------------------------------------------
// Spec 120 — extraction-output endpoint responses
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostExtractionOutputResponse {
    pub duplicate: bool,
    pub extraction_run_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YieldExtractionResponse {
    pub run_id: String,
    pub outcome: String,
    pub duplex_event_type: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchExtractionOutputResponse {
    pub extraction_run_id: String,
    pub output: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Spec 120 FR-021 — Tauri command surface
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn post_extraction_output(
    state: tauri::State<'_, StatecraftState>,
    project_id: String,
    object_id: String,
    schema_version: String,
    output: serde_json::Value,
) -> Result<PostExtractionOutputResponse, String> {
    let client = state
        .0
        .read()
        .unwrap()
        .as_ref()
        .ok_or_else(|| "statecraft client not configured".to_string())?
        .clone();
    client
        .post_extraction_output(&project_id, &object_id, &schema_version, &output)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn request_extraction_yield(
    state: tauri::State<'_, StatecraftState>,
    project_id: String,
    object_id: String,
    content_hash: String,
    requested_kind: Option<String>,
    reason: String,
) -> Result<YieldExtractionResponse, String> {
    let client = state
        .0
        .read()
        .unwrap()
        .as_ref()
        .ok_or_else(|| "statecraft client not configured".to_string())?
        .clone();
    client
        .request_extraction_yield(
            &project_id,
            &object_id,
            &content_hash,
            requested_kind.as_deref(),
            &reason,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_extraction_output(
    state: tauri::State<'_, StatecraftState>,
    project_id: String,
    object_id: String,
    content_hash: String,
) -> Result<Option<FetchExtractionOutputResponse>, String> {
    let client = state
        .0
        .read()
        .unwrap()
        .as_ref()
        .ok_or_else(|| "statecraft client not configured".to_string())?
        .clone();
    client
        .fetch_extraction_output(&project_id, &object_id, &content_hash)
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Agent catalog draft (spec 111 Phase 6)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct CreateAgentDraftRequest {
    name: String,
    frontmatter: serde_json::Value,
    body_markdown: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateAgentDraftResponse {
    pub agent: CatalogAgentWire,
}

/// Subset of statecraft's `CatalogAgent` that the desktop cares about after a
/// draft create. Fields mirror the snake_cased wire shape defined in
/// `catalog.ts`.
#[derive(Debug, Deserialize)]
pub struct CatalogAgentWire {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub version: u32,
    pub status: String,
    pub content_hash: String,
}

#[derive(Debug, Deserialize)]
pub struct ArtifactInfo {
    pub pipeline_id: String,
    pub stage_id: String,
    pub artifact_type: String,
    pub content_hash: String,
    pub storage_path: String,
    pub size_bytes: u64,
    pub created_at: String,
}

// ---------------------------------------------------------------------------
// Spec 112 §6.3 — OPC bundle types (mirrors statecraft's OpcBundleResponse)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpcBundleProject {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub org_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpcBundleRepo {
    pub clone_url: String,
    pub github_org: String,
    pub repo_name: String,
    pub default_branch: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpcBundleAdapter {
    pub id: String,
    pub name: String,
    pub version: String,
    pub source_sha: String,
    pub synced_at: String,
    pub manifest: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpcBundleContract {
    pub name: String,
    pub version: String,
    pub source_sha: String,
    pub synced_at: String,
    pub schema: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpcBundleProcess {
    pub name: String,
    pub version: String,
    pub source_sha: String,
    pub synced_at: String,
    pub definition: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpcBundleAgent {
    pub id: String,
    pub name: String,
    pub version: i64,
    pub status: String,
    pub content_hash: String,
    pub frontmatter: serde_json::Value,
    pub body_markdown: String,
}

/// Spec 112 §6.4 — short-lived clone token derived from spec 109 state.
/// `expires_at` is set for `github_installation` (~1h TTL) and null for
/// `project_github_pat`. The bundle returns `clone_token: None` for
/// public repos (anonymous clone path); a hard-resolution failure on
/// the statecraft side surfaces as a 503 instead.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpcBundleCloneToken {
    pub value: String,
    pub source: String,
    pub expires_at: Option<String>,
}

/// Spec 198 FR-005 / ASI04 m1 — admission block embedded in the OPC bundle.
/// The `sealJws` is a compact JWS signed by the platform over the
/// `(origin, envelopeHash)` pair; the desktop verifies this before executing
/// any factory run (fail-closed: no seal = no run).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpcBundleAdmission {
    /// Factory origin identifier (e.g. `"factory"`).
    pub origin: String,
    /// Content hash of the admitted factory envelope.
    #[serde(default)]
    pub envelope_hash: Option<String>,
    /// Compact JWS sealing the admission (EdDSA, verified against the
    /// platform JWKS at `GET /api/factory/.well-known/jwks.json`).
    #[serde(default)]
    pub seal_jws: Option<String>,
    /// Spec 198 FR-013(c) — overrides active on the admitted factory's
    /// content at bundle assembly, already predicate-checked platform-side
    /// (`overrides.require_verified`). The engine binds these into the
    /// run's governance certificate at emission.
    #[serde(default)]
    pub consumed_overrides: Vec<OpcBundleConsumedOverride>,
}

/// Spec 198 FR-013(c) — one override the run will consume. Mirrors
/// statecraft `opcBundleHelpers.ts::OpcBundleConsumedOverride`.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpcBundleConsumedOverride {
    pub artifact_id: String,
    pub path: String,
    pub content_hash: String,
    /// Rauthy subject that authored the revision (FR-013 b).
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub modified_at: Option<String>,
    pub verified: bool,
    #[serde(default)]
    pub verified_by: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpcBundleResponse {
    pub project: OpcBundleProject,
    pub repo: Option<OpcBundleRepo>,
    pub deep_link: Option<String>,
    pub adapter: Option<OpcBundleAdapter>,
    pub contracts: Vec<OpcBundleContract>,
    pub processes: Vec<OpcBundleProcess>,
    pub agents: Vec<OpcBundleAgent>,
    pub clone_token: Option<OpcBundleCloneToken>,
    /// Spec 198 FR-005 / ASI04 m1 — admission seal block. Absent on bundles
    /// from pre-198 statecraft builds; desktop treats absence as unverified
    /// and fails closed before any factory run.
    #[serde(default)]
    pub admission: Option<OpcBundleAdmission>,
}

/// Spec 112 §6.4.2 — refresh-endpoint response shape.
/// Lightweight sibling of the bundle: just the token field.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CloneTokenResponse {
    pub clone_token: Option<OpcBundleCloneToken>,
}

/// Internal-only: shape of `POST /auth/desktop/refresh`. Mirrors the
/// `RefreshResponse` in `commands/auth.rs` but lives here so the client
/// can drive a silent refresh on 401 without re-entering the auth
/// command surface.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefreshTokenResponse {
    access_token: String,
    refresh_token: String,
    #[serde(default)]
    #[allow(dead_code)]
    expires_in: i64,
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum StatecraftError {
    /// Transport-level failure (DNS, timeout, connection refused).
    Network(reqwest::Error),
    /// Statecraft returned a non-2xx status.
    Api(u16, String),
    /// Response body could not be decoded.
    Decode(reqwest::Error),
}

impl std::fmt::Display for StatecraftError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Network(e) => write!(f, "statecraft network error: {e}"),
            Self::Api(status, body) => {
                write!(f, "statecraft API error {status}: {body}")
            }
            Self::Decode(e) => write!(f, "statecraft decode error: {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Spec 112 §6.3 — pin the wire format. The statecraft endpoint
    /// returns camelCase fields; the desktop's serde rename_all must
    /// keep up. If this test starts failing, the TS side likely renamed
    /// a field on `OpcBundleResponse` and the desktop is decoding the
    /// wrong shape.
    #[test]
    fn oap_bundle_response_decodes_camelcase_payload() {
        let payload = r##"{
            "project": {
                "id": "p-1",
                "name": "FV Portal",
                "slug": "fv-portal",
                "orgId": "org-1"
            },
            "repo": {
                "cloneUrl": "https://github.com/acme/fv.git",
                "githubOrg": "acme",
                "repoName": "fv",
                "defaultBranch": "main"
            },
            "deepLink": "opc://project/open?project_id=p-1&url=https%3A%2F%2Fgithub.com%2Facme%2Ffv.git",
            "adapter": {
                "id": "a-1",
                "name": "acme-vue-node",
                "version": "3.0.0",
                "sourceSha": "abc",
                "syncedAt": "2026-04-22T10:00:00.000Z",
                "manifest": {"k":"v"}
            },
            "contracts": [{
                "name": "build-spec",
                "version": "1.0.0",
                "sourceSha": "c1",
                "syncedAt": "2026-04-22T10:00:00.000Z",
                "schema": {}
            }],
            "processes": [],
            "agents": [{
                "id": "ag-1",
                "name": "explorer",
                "version": 2,
                "status": "published",
                "contentHash": "h1",
                "frontmatter": {},
                "bodyMarkdown": "# explorer"
            }],
            "cloneToken": {
                "value": "ghs_FAKE_INSTALL_TOKEN",
                "source": "github_installation",
                "expiresAt": "2026-04-22T11:00:00.000Z"
            }
        }"##;

        let bundle: OpcBundleResponse =
            serde_json::from_str(payload).expect("valid bundle decodes");

        assert_eq!(bundle.project.id, "p-1");
        assert_eq!(bundle.project.org_id, "org-1");
        assert_eq!(bundle.repo.as_ref().unwrap().clone_url, "https://github.com/acme/fv.git");
        assert!(bundle.deep_link.is_some());
        assert_eq!(bundle.adapter.as_ref().unwrap().name, "acme-vue-node");
        assert_eq!(bundle.contracts.len(), 1);
        assert_eq!(bundle.processes.len(), 0);
        assert_eq!(bundle.agents.len(), 1);
        assert_eq!(bundle.agents[0].status, "published");
        let token = bundle.clone_token.as_ref().expect("clone token present");
        assert_eq!(token.source, "github_installation");
        assert_eq!(token.value, "ghs_FAKE_INSTALL_TOKEN");
        assert_eq!(token.expires_at.as_deref(), Some("2026-04-22T11:00:00.000Z"));
    }

    #[test]
    fn oap_bundle_response_handles_null_repo_and_adapter() {
        let payload = r##"{
            "project": {
                "id": "p-1",
                "name": "Legacy",
                "slug": "legacy",
                "orgId": "org-1"
            },
            "repo": null,
            "deepLink": null,
            "adapter": null,
            "contracts": [],
            "processes": [],
            "agents": [],
            "cloneToken": null
        }"##;

        let bundle: OpcBundleResponse =
            serde_json::from_str(payload).expect("nulls decode");
        assert!(bundle.repo.is_none());
        assert!(bundle.deep_link.is_none());
        assert!(bundle.adapter.is_none());
        assert!(bundle.clone_token.is_none());
    }

    #[test]
    fn oap_bundle_response_decodes_pat_clone_token_with_null_expiry() {
        let payload = r##"{
            "project": {
                "id": "p-1",
                "name": "External",
                "slug": "external",
                "orgId": "org-1"
            },
            "repo": {
                "cloneUrl": "https://github.com/external-org/foo.git",
                "githubOrg": "external-org",
                "repoName": "foo",
                "defaultBranch": "main"
            },
            "deepLink": "opc://project/open?project_id=p-1&url=https%3A%2F%2Fgithub.com%2Fexternal-org%2Ffoo.git",
            "adapter": null,
            "contracts": [],
            "processes": [],
            "agents": [],
            "cloneToken": {
                "value": "ghp_FAKE_PAT",
                "source": "project_github_pat",
                "expiresAt": null
            }
        }"##;

        let bundle: OpcBundleResponse =
            serde_json::from_str(payload).expect("PAT bundle decodes");
        let token = bundle.clone_token.as_ref().expect("clone token present");
        assert_eq!(token.source, "project_github_pat");
        assert!(token.expires_at.is_none());
    }

    #[test]
    fn _phase_5_extraction_response_shapes_round_trip() {
        let post_payload = r#"{ "duplicate": false, "extractionRunId": "r-1" }"#;
        let post: PostExtractionOutputResponse =
            serde_json::from_str(post_payload).expect("post response decodes");
        assert_eq!(post.extraction_run_id, "r-1");

        let yield_payload = r#"{ "runId": "r-2", "outcome": "enqueued", "duplexEventType": "knowledge.object.updated" }"#;
        let yld: YieldExtractionResponse =
            serde_json::from_str(yield_payload).expect("yield response decodes");
        assert_eq!(yld.outcome, "enqueued");

        let fetch_payload = r#"{ "extractionRunId": "r-3", "output": { "text": "hi", "metadata": {}, "extractor": { "kind": "deterministic-text", "version": "1" } } }"#;
        let fetch: FetchExtractionOutputResponse =
            serde_json::from_str(fetch_payload).expect("fetch response decodes");
        assert_eq!(fetch.extraction_run_id, "r-3");
    }

    #[test]
    fn clone_token_refresh_envelope_decodes() {
        let payload = r##"{
            "cloneToken": {
                "value": "ghs_REFRESHED_TOKEN",
                "source": "github_installation",
                "expiresAt": "2026-04-22T12:00:00.000Z"
            }
        }"##;

        let resp: CloneTokenResponse =
            serde_json::from_str(payload).expect("refresh envelope decodes");
        let token = resp.clone_token.expect("token present");
        assert_eq!(token.value, "ghs_REFRESHED_TOKEN");
    }

    /// Build a minimally-shaped Rauthy JWT for tests. The signature segment
    /// is unverified by `decode_jwt_claims` (claims-only read), so any
    /// non-empty placeholder is fine.
    fn fake_jwt(claims: &serde_json::Value) -> String {
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(br#"{"alg":"none","typ":"JWT"}"#);
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(claims).unwrap());
        format!("{header}.{payload}.sig")
    }

    /// Pin the type invariant from the spec/code coupling fix:
    /// `set_auth_token` MUST derive `org_id` from the JWT's `oap_org_id`
    /// claim. Regression here recreates the "no active organization
    /// (sign-in incomplete)" bug where restore/refresh paths would set the
    /// token but leave `org_id` empty.
    ///
    /// NOTE: this fixture is FLAT (no `custom` wrapper), so post the
    /// custom-claim fix it pins `claim_str`'s **top-level fallback** branch,
    /// not the production Rauthy wire shape. The real nested shape
    /// (`custom.oap_org_id`) is pinned by
    /// `apply_token_derives_org_id_from_nested_custom_claim` — do not "fix"
    /// this test to nest its claims, or the fallback path loses coverage.
    #[test]
    fn set_auth_token_populates_org_id_from_jwt_claim() {
        let client = StatecraftClient::new("http://example.test", "actor-1")
            .expect("client builds");
        assert_eq!(client.org_id(), "");

        let token = fake_jwt(&serde_json::json!({
            "oap_org_id": "org-abc-123",
            "oap_user_id": "user-1",
            "exp": 9_999_999_999i64,
        }));
        client.apply_token(&token);

        assert_eq!(client.org_id(), "org-abc-123");
    }

    /// Regression for the cold-start "Sign out, then sign in again" bug:
    /// Rauthy emits the OAP attributes nested under a top-level `custom`
    /// object (`custom.oap_org_id`), NOT as flat top-level claims. The
    /// keychain-restore path derives `org_id` from the JWT, so reading the
    /// wrong level left `org_id` empty on every restart — the boot gate's
    /// `has_org` term never flipped and the cockpit never opened. The flat
    /// fixture in `set_auth_token_populates_org_id_from_jwt_claim` masked
    /// this; this test pins the REAL Rauthy wire shape.
    #[test]
    fn apply_token_derives_org_id_from_nested_custom_claim() {
        let client = StatecraftClient::new("http://example.test", "actor-1")
            .expect("client builds");

        let token = fake_jwt(&serde_json::json!({
            "email": "user@example.test",
            "exp": 9_999_999_999i64,
            "custom": {
                "oap_org_id": "org-nested-123",
                "oap_user_id": "user-1",
                "oap_org_slug": "acme",
            },
        }));
        client.apply_token(&token);

        assert_eq!(
            client.org_id(),
            "org-nested-123",
            "org_id must be derived from custom.oap_org_id, not top-level"
        );
    }

    /// `claim_str` reads `custom` first, then falls back to the top level —
    /// so both the real Rauthy shape and a (hypothetical) flattened mapping
    /// resolve, and standard top-level OIDC claims like `email` still work.
    #[test]
    fn claim_str_prefers_custom_then_falls_back_to_top_level() {
        let nested = serde_json::json!({
            "email": "top@example.test",
            "custom": { "oap_org_id": "from-custom" },
        });
        assert_eq!(claim_str(&nested, "oap_org_id"), Some("from-custom"));
        assert_eq!(claim_str(&nested, "email"), Some("top@example.test"));
        assert_eq!(claim_str(&nested, "missing"), None);

        // Forward-compat: a flat token (no `custom`) still resolves top-level.
        let flat = serde_json::json!({ "oap_org_id": "from-top" });
        assert_eq!(claim_str(&flat, "oap_org_id"), Some("from-top"));

        // A present-but-non-string `custom` value must NOT swallow the
        // fallback: per-level `.as_str()` lets the top-level claim win.
        let mixed = serde_json::json!({
            "oap_org_id": "from-top",
            "custom": { "oap_org_id": 12345 },
        });
        assert_eq!(claim_str(&mixed, "oap_org_id"), Some("from-top"));

        // Non-string at both levels → None (no panic, no coercion).
        let both_numeric = serde_json::json!({
            "oap_org_id": 1,
            "custom": { "oap_org_id": 2 },
        });
        assert_eq!(claim_str(&both_numeric, "oap_org_id"), None);
    }

    /// A malformed token must not panic and must leave `org_id` untouched.
    /// The previous value (e.g. from a successful prior auth) wins over a
    /// silent overwrite to empty, which would itself trigger the bug.
    #[test]
    fn apply_token_leaves_org_id_when_claim_missing() {
        let client = StatecraftClient::new("http://example.test", "actor-1")
            .expect("client builds");
        client.set_org_id("org-prior");

        // Token with no oap_org_id claim.
        let token = fake_jwt(&serde_json::json!({"sub": "anon"}));
        client.apply_token(&token);
        assert_eq!(client.org_id(), "org-prior");

        // Garbage token (wrong segment count).
        client.apply_token("not.a.jwt.at.all");
        assert_eq!(client.org_id(), "org-prior");
    }

    /// Pin the spec 183 boot-gate fix: `StatecraftState` holds ONE shared
    /// `Arc<StatecraftClient>`, so a write through any `current()` handle is
    /// visible through every other handle and through a fresh read. Before
    /// this was an `Arc`, `current()` returned a value-snapshot clone — a
    /// sign-in's `set_org_id` mutated a throwaway copy while the boot gate's
    /// in-memory `org_id` read stayed empty, wedging the cockpit at "Waiting
    /// for statecraft duplex handshake (sync.hello)…" even after `sync.hello`
    /// had been received.
    #[test]
    fn statecraft_state_shares_one_client_across_current_handles() {
        let client = StatecraftClient::new("http://example.test", "actor-1")
            .expect("client builds");
        let state = StatecraftState(std::sync::RwLock::new(Some(std::sync::Arc::new(client))));

        let handle_a = state.current().expect("client present");
        let handle_b = state.current().expect("client present");

        // A write through one handle is visible through the other and through
        // a fresh current() read — exactly what boot_gate_status relies on.
        handle_a.set_org_id("org-xyz");
        assert_eq!(handle_b.org_id(), "org-xyz");
        assert_eq!(state.current().unwrap().org_id(), "org-xyz");

        // Token path is equally shared: adopt_token (the in-memory half of
        // set_auth_token, minus the keychain write) through one handle is
        // visible — the token AND the org_id it derives — through the others.
        // Covers the set_auth_token / adopt_token surface named in spec 183
        // FR-T2(a), not just set_org_id.
        let token = fake_jwt(&serde_json::json!({ "oap_org_id": "org-from-token" }));
        handle_b.adopt_token(&token);
        assert_eq!(handle_a.auth_token().as_deref(), Some(token.as_str()));
        assert_eq!(state.current().unwrap().org_id(), "org-from-token");
    }

    /// A poisoned `StatecraftState` lock must NOT silently disable Statecraft.
    /// `current()`/`replace()` recover the inner value AND clear the poison, so
    /// a panicked holder logs once per poison event (not on every op) and never
    /// wedges the boot gate ("not ready") or silently skips REST dual-write —
    /// a broader blast radius now that all callers share one Arc.
    #[test]
    fn statecraft_state_recovers_from_poisoned_lock() {
        fn poison(st: &std::sync::Arc<StatecraftState>) {
            let p = st.clone();
            let _ = std::thread::spawn(move || {
                let _g = p.0.write().unwrap();
                panic!("intentional panic to poison the lock");
            })
            .join();
            assert!(st.0.is_poisoned(), "lock should be poisoned");
        }

        let state = std::sync::Arc::new(StatecraftState(std::sync::RwLock::new(Some(
            std::sync::Arc::new(
                StatecraftClient::new("http://example.test", "actor-1").expect("client builds"),
            ),
        ))));

        // current() recovers AND clears the poison (no permanent error spam).
        poison(&state);
        assert!(state.current().is_some(), "current() must recover from poison");
        assert!(!state.0.is_poisoned(), "current() must clear the poison");

        // replace() likewise recovers and clears.
        poison(&state);
        state.replace(None);
        assert!(!state.0.is_poisoned(), "replace() must clear the poison");
        assert!(state.current().is_none(), "replace() must write through poison");
    }
}
