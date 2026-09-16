//! One-click "publish local agent → workspace draft" flow (spec 111 Phase 6).
//!
//! Phases 1–5 landed the governed remote catalog end-to-end. Phase 6 closes
//! the migration path for pre-existing local agents: a user with agents
//! authored against the legacy desktop-only path can promote one into the
//! workspace catalog without retyping it into the web UI.
//!
//! The command *creates a draft*. Promoting the draft to `published` still
//! flows through statecraft's RBAC-gated publish endpoint (catalog.ts
//! `publishAgent`) so the governance boundary stays intact — a non-admin
//! desktop user can seed the content but cannot force publication.
//!
//! Authority invariant (spec 111 §2.2): the desktop never invents a
//! `remote_agent_id`. The server mints it on `POST /api/agents`; the desktop
//! only echoes what it receives so the UI can link to the detail page.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{Value as JsonValue, json};
use tauri::State;

use crate::commands::agents::{Agent, AgentDb};
use crate::commands::statecraft_client::StatecraftState;

/// Slug normalisation for local agent names.
///
/// Statecraft enforces `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` on `/api/agents`
/// (catalog.ts `KEBAB_CASE`). Local agents carry free-form display names, so
/// we slugify before hitting the wire. Rules:
///
/// - lowercase ASCII
/// - non-alphanumeric runs collapse to a single `-`
/// - leading/trailing `-` are stripped
/// - if the first surviving char is a digit, prefix with `a-` so the regex
///   anchor (`^[a-z]`) holds
///
/// Returns `Err` when the input has no alphanumerics at all (nothing to
/// slugify) — the caller surfaces that to the user as "rename the agent
/// first" instead of silently sending junk.
pub fn slugify_agent_name(raw: &str) -> Result<String, String> {
    let mut out = String::with_capacity(raw.len());
    let mut prev_dash = true;
    for ch in raw.chars() {
        let mapped = ch.to_ascii_lowercase();
        if mapped.is_ascii_alphanumeric() {
            out.push(mapped);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        return Err(format!(
            "agent name {raw:?} has no alphanumeric characters to slugify"
        ));
    }
    if out.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        out.insert_str(0, "a-");
    }
    Ok(out)
}

/// Payload derived from a local [`Agent`] row, ready for statecraft.
///
/// Keeping this as a plain struct (rather than inlining into the HTTP call)
/// lets the mapping be unit-tested without a network. The field order mirrors
/// the `CreateAgentRequest` shape in catalog.ts so a reader can pattern-match.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogDraftPayload {
    pub name: String,
    pub frontmatter: JsonValue,
    pub body_markdown: String,
}

/// Map a local [`Agent`] row to a draft payload for `POST /api/agents`.
///
/// Field translation:
///
/// | Local column         | Frontmatter key / body position              |
/// |----------------------|-----------------------------------------------|
/// | `name`               | `name` (slugified) + `display_name` (original)|
/// | `icon`               | `icon`                                        |
/// | `model`              | `model`                                       |
/// | `default_task`       | `default_task` (extra field, preserved JSONB) |
/// | `enable_file_read`   | \*                                            |
/// | `enable_file_write`  | → derived `mutation`                          |
/// | `enable_network`     | \*                                            |
/// | `hooks` (JSON blob)  | `hooks` when parseable; otherwise dropped     |
/// | `system_prompt`      | body_markdown                                 |
///
/// `safety_tier` is intentionally left unset on the draft — the user must
/// review it in the web UI before publishing (spec 111 §2.5). Unknown keys
/// round-trip via the JSONB/flatten contract (spec 054 FR-013, 111 §2.1).
pub fn map_local_agent_to_payload(agent: &Agent) -> Result<CatalogDraftPayload, String> {
    let slug = slugify_agent_name(&agent.name)?;
    let description = agent
        .system_prompt
        .lines()
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let mutation = match (agent.enable_file_write, agent.enable_network) {
        (true, true) => "full",
        (true, false) => "read-write",
        (false, _) => "read-only",
    };

    let mut fm = json!({
        "name": slug,
        "type": "prompt",
        "icon": agent.icon,
        "model": agent.model,
        "display_name": agent.name,
        "mutation": mutation,
    });

    if let Some(desc) = description {
        fm["description"] = JsonValue::String(desc);
    }
    if let Some(task) = agent.default_task.as_ref().filter(|s| !s.is_empty()) {
        // Extra field — flows through serde(flatten) on the Rust side and the
        // open index signature in CatalogFrontmatter on the TS side.
        fm["default_task"] = JsonValue::String(task.clone());
    }
    if let Some(hooks_blob) = agent.hooks.as_ref().filter(|s| !s.is_empty())
        && let Ok(parsed) = serde_json::from_str::<JsonValue>(hooks_blob)
        && parsed.is_object()
    {
        fm["hooks"] = parsed;
    }

    Ok(CatalogDraftPayload {
        name: slug,
        frontmatter: fm,
        body_markdown: agent.system_prompt.clone(),
    })
}

/// Response surface for the Tauri frontend.
///
/// `web_path` is the deep link the UI should open in the statecraft web app
/// to finish the publish flow. Constructed from the returned `agent_id` so
/// the desktop doesn't hardcode the route outside one place.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishLocalAgentResult {
    pub local_agent_id: i64,
    pub remote_agent_id: String,
    pub org_id: String,
    pub name: String,
    pub version: u32,
    pub status: String,
    pub content_hash: String,
    pub web_path: String,
}

/// Publish a local SQLite agent into the workspace catalog as a draft.
///
/// Preconditions:
/// - Statecraft client configured + a JWT loaded (spec 087 Phase 5).
/// - Local agent row exists and carries `source = 'local'`.
///
/// The command does **not** touch the local row's `source` column — the local
/// copy remains authoritative for this desktop until the user actually
/// publishes the draft from the web UI and the published row fans back in
/// via the Phase 3 duplex channel, at which point spec 111 §2.4 merge
/// semantics take over.
#[tauri::command]
pub async fn publish_local_agent_to_workspace(
    db: State<'_, AgentDb>,
    statecraft: State<'_, StatecraftState>,
    agent_id: i64,
) -> Result<PublishLocalAgentResult, String> {
    let agent = load_local_agent(&db, agent_id)?;
    let payload = map_local_agent_to_payload(&agent)?;

    let client = statecraft
        .current()
        .ok_or_else(|| "statecraft client not configured; set a base URL first".to_string())?;
    if client.auth_token().is_none() {
        return Err("not signed in to statecraft; sign in before publishing".into());
    }

    let created = client
        .create_agent_draft(&payload.name, payload.frontmatter, &payload.body_markdown)
        .await
        .map_err(|e| format!("statecraft create_agent_draft failed: {e}"))?;

    let a = created.agent;
    Ok(PublishLocalAgentResult {
        local_agent_id: agent_id,
        web_path: format!("/app/workspace/agents/{}", a.id),
        remote_agent_id: a.id,
        org_id: a.org_id,
        name: a.name,
        version: a.version,
        status: a.status,
        content_hash: a.content_hash,
    })
}

fn load_local_agent(db: &State<'_, AgentDb>, agent_id: i64) -> Result<Agent, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (agent, source): (Agent, String) = conn
        .query_row(
            "SELECT id, name, icon, system_prompt, default_task, model,
                    enable_file_read, enable_file_write, enable_network, hooks,
                    created_at, updated_at, source
             FROM agents WHERE id = ?1",
            params![agent_id],
            |row| {
                let agent = Agent {
                    id: Some(row.get(0)?),
                    name: row.get(1)?,
                    icon: row.get(2)?,
                    system_prompt: row.get(3)?,
                    default_task: row.get(4)?,
                    model: row
                        .get::<_, String>(5)
                        .unwrap_or_else(|_| "sonnet".to_string()),
                    enable_file_read: row.get::<_, bool>(6).unwrap_or(true),
                    enable_file_write: row.get::<_, bool>(7).unwrap_or(true),
                    enable_network: row.get::<_, bool>(8).unwrap_or(false),
                    hooks: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                };
                let source: String = row.get(12)?;
                Ok((agent, source))
            },
        )
        .map_err(|e| format!("failed to load agent {agent_id}: {e}"))?;
    if source != "local" {
        return Err(format!(
            "agent {agent_id} has source={source:?}; only local agents can be published from the desktop"
        ));
    }
    Ok(agent)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_agent() -> Agent {
        Agent {
            id: Some(1),
            name: "Triage Assistant".into(),
            icon: "\u{1f50d}".into(),
            system_prompt: "Sort incoming bugs by severity.\n\nMore detail here.".into(),
            default_task: Some("Classify the open issues".into()),
            model: "opus".into(),
            enable_file_read: true,
            enable_file_write: false,
            enable_network: false,
            hooks: Some(r#"{"PreToolUse":[{"name":"log","type":"bash","run":"echo"}]}"#.into()),
            created_at: "2026-04-22".into(),
            updated_at: "2026-04-22".into(),
        }
    }

    #[test]
    fn slugify_handles_spaces_and_case() {
        assert_eq!(slugify_agent_name("Triage Assistant").unwrap(), "triage-assistant");
        assert_eq!(slugify_agent_name("BugBot v2").unwrap(), "bugbot-v2");
    }

    #[test]
    fn slugify_collapses_runs_of_non_alnum() {
        assert_eq!(
            slugify_agent_name("code  _review / bot!!").unwrap(),
            "code-review-bot"
        );
    }

    #[test]
    fn slugify_strips_leading_trailing_separators() {
        assert_eq!(slugify_agent_name("---foo---").unwrap(), "foo");
        assert_eq!(slugify_agent_name(" my agent ").unwrap(), "my-agent");
    }

    #[test]
    fn slugify_prefixes_leading_digit() {
        // Statecraft's KEBAB_CASE demands a leading letter; a digit-first
        // slug would be rejected with invalidArgument at the API edge.
        assert_eq!(slugify_agent_name("42 things").unwrap(), "a-42-things");
    }

    #[test]
    fn slugify_rejects_alnum_free_input() {
        assert!(slugify_agent_name("!!!").is_err());
        assert!(slugify_agent_name("").is_err());
    }

    #[test]
    fn mapping_populates_tier_1_fields() {
        let agent = sample_agent();
        let payload = map_local_agent_to_payload(&agent).unwrap();
        assert_eq!(payload.name, "triage-assistant");
        assert_eq!(payload.body_markdown, agent.system_prompt);

        let fm = &payload.frontmatter;
        assert_eq!(fm["name"], "triage-assistant");
        assert_eq!(fm["type"], "prompt");
        assert_eq!(fm["icon"], "\u{1f50d}");
        assert_eq!(fm["model"], "opus");
        assert_eq!(fm["display_name"], "Triage Assistant");
        assert_eq!(fm["description"], "Sort incoming bugs by severity.");
    }

    #[test]
    fn mapping_derives_mutation_from_enable_flags() {
        let mut agent = sample_agent();

        agent.enable_file_write = false;
        agent.enable_network = false;
        let fm = map_local_agent_to_payload(&agent).unwrap().frontmatter;
        assert_eq!(fm["mutation"], "read-only");

        agent.enable_file_write = true;
        agent.enable_network = false;
        let fm = map_local_agent_to_payload(&agent).unwrap().frontmatter;
        assert_eq!(fm["mutation"], "read-write");

        agent.enable_file_write = true;
        agent.enable_network = true;
        let fm = map_local_agent_to_payload(&agent).unwrap().frontmatter;
        assert_eq!(fm["mutation"], "full");

        // Network-only (no write) still clamps to read-only — network alone
        // doesn't imply mutation of the filesystem, and the wire contract
        // MutationCapability is about filesystem mutation specifically.
        agent.enable_file_write = false;
        agent.enable_network = true;
        let fm = map_local_agent_to_payload(&agent).unwrap().frontmatter;
        assert_eq!(fm["mutation"], "read-only");
    }

    #[test]
    fn mapping_preserves_default_task_as_extra_field() {
        let agent = sample_agent();
        let fm = map_local_agent_to_payload(&agent).unwrap().frontmatter;
        assert_eq!(fm["default_task"], "Classify the open issues");
    }

    #[test]
    fn mapping_omits_default_task_when_empty() {
        let mut agent = sample_agent();
        agent.default_task = None;
        let fm = map_local_agent_to_payload(&agent).unwrap().frontmatter;
        assert!(fm.get("default_task").is_none());

        agent.default_task = Some(String::new());
        let fm = map_local_agent_to_payload(&agent).unwrap().frontmatter;
        assert!(fm.get("default_task").is_none());
    }

    #[test]
    fn mapping_parses_hooks_when_valid_json() {
        let agent = sample_agent();
        let fm = map_local_agent_to_payload(&agent).unwrap().frontmatter;
        let hooks = &fm["hooks"];
        assert!(hooks.is_object());
        assert!(hooks["PreToolUse"].is_array());
    }

    #[test]
    fn mapping_drops_hooks_when_not_json() {
        let mut agent = sample_agent();
        agent.hooks = Some("not json".into());
        let fm = map_local_agent_to_payload(&agent).unwrap().frontmatter;
        assert!(fm.get("hooks").is_none());
    }

    #[test]
    fn mapping_omits_description_when_prompt_is_empty() {
        let mut agent = sample_agent();
        agent.system_prompt = String::new();
        let fm = map_local_agent_to_payload(&agent).unwrap().frontmatter;
        assert!(fm.get("description").is_none());
    }

    #[test]
    fn mapping_fails_when_name_has_no_alphanumeric() {
        let mut agent = sample_agent();
        agent.name = "!!!".into();
        assert!(map_local_agent_to_payload(&agent).is_err());
    }
}
