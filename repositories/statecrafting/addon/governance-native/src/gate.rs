//! The action gate: a deterministic decision over an ordered check registry.
//!
//! `action-gate` ships the pure Gate machinery (ordered registry, first-match
//! evaluation, order-sensitive stable config hash) but deliberately no config
//! schema and no domain checks. This module supplies both for statecraft:
//! `GateConfigV1` (a committed JSON list of check ids, statecraft spec 008 §2) and the
//! four v1 checks. Checks read their inputs from `ActionContext.attributes`.

use std::collections::BTreeMap;

use action_gate_types::{ActionContext, Check, Decision, Outcome};
use action_gate_core::Gate;
use serde::Deserialize;
use serde_json::Value;

/// The committed gate configuration (statecraft spec 008 §2, gate config v1).
#[derive(Deserialize)]
pub struct GateConfigV1 {
    #[allow(dead_code)]
    pub version: u32,
    pub checks: Vec<CheckEntry>,
}

/// One ordered check registration. `params` is reserved for future per-check
/// tuning; the v1 checks are parameterless (their fingerprint is their id, so
/// the config hash is a stable function of the ordered id list).
#[derive(Deserialize)]
pub struct CheckEntry {
    pub id: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub params: BTreeMap<String, Value>,
}

fn attr_str<'a>(ctx: &'a ActionContext, key: &str) -> Option<&'a str> {
    ctx.attributes.get(key).and_then(Value::as_str)
}

fn attr_bool(ctx: &ActionContext, key: &str) -> Option<bool> {
    ctx.attributes.get(key).and_then(Value::as_bool)
}

/// Stamps must carry an explicit agentic posture.
struct PostureRequired;
impl Check for PostureRequired {
    fn id(&self) -> &str {
        "posture-required"
    }
    fn evaluate(&self, ctx: &ActionContext) -> Option<Decision> {
        if ctx.action != "stamp" {
            return None;
        }
        match attr_str(ctx, "posture") {
            Some(posture) if !posture.trim().is_empty() => None,
            _ => Some(
                Decision::deny(
                    "stamp requires an explicit agentic posture",
                    vec![self.id().to_string()],
                )
                .blocking(),
            ),
        }
    }
}

/// A fleet `remove` must echo the subject's name to confirm intent.
struct ConfirmNameRequired;
impl Check for ConfirmNameRequired {
    fn id(&self) -> &str {
        "confirm-name-required"
    }
    fn evaluate(&self, ctx: &ActionContext) -> Option<Decision> {
        if ctx.action != "remove" {
            return None;
        }
        match (attr_str(ctx, "subject_name"), attr_str(ctx, "confirm_name")) {
            (Some(expected), Some(confirm)) if !expected.is_empty() && expected == confirm => None,
            _ => Some(
                Decision::deny(
                    "fleet remove requires confirm_name to match subject_name",
                    vec![self.id().to_string()],
                )
                .blocking(),
            ),
        }
    }
}

/// A referenced tenant must be active. Absent tenant context is not this
/// check's concern; a present-but-inactive tenant is denied (fail-closed).
struct TenantActive;
impl Check for TenantActive {
    fn id(&self) -> &str {
        "tenant-active"
    }
    fn evaluate(&self, ctx: &ActionContext) -> Option<Decision> {
        let has_status = ctx.attributes.contains_key("tenant_status")
            || ctx.attributes.contains_key("tenant_active");
        if !has_status {
            return None;
        }
        let active = attr_str(ctx, "tenant_status") == Some("active")
            || attr_bool(ctx, "tenant_active") == Some(true);
        if active {
            None
        } else {
            Some(
                Decision::deny("tenant is not active", vec![self.id().to_string()]).blocking(),
            )
        }
    }
}

/// Every gated action needs an authenticated actor.
struct ActorAuthenticated;
impl Check for ActorAuthenticated {
    fn id(&self) -> &str {
        "actor-authenticated"
    }
    fn evaluate(&self, ctx: &ActionContext) -> Option<Decision> {
        let actor = attr_str(ctx, "actor").unwrap_or_default();
        let authenticated = attr_bool(ctx, "authenticated").unwrap_or(false);
        if !actor.is_empty() && authenticated {
            None
        } else {
            Some(
                Decision::deny("actor is not authenticated", vec![self.id().to_string()])
                    .blocking(),
            )
        }
    }
}

/// Assemble a [`Gate`] from config, preserving check order.
pub fn build_gate(config: &GateConfigV1) -> Result<Gate, String> {
    let mut builder = Gate::builder();
    for entry in &config.checks {
        let check: Box<dyn Check> = match entry.id.as_str() {
            "posture-required" => Box::new(PostureRequired),
            "confirm-name-required" => Box::new(ConfirmNameRequired),
            "tenant-active" => Box::new(TenantActive),
            "actor-authenticated" => Box::new(ActorAuthenticated),
            other => return Err(format!("unknown gate check: {other}")),
        };
        builder = builder.check_boxed(check);
    }
    Ok(builder.build())
}

/// The gate decision plus the gate's stable config hash (statecraft spec 008 §2: the
/// caller must attach this hash to the attestation it records on allow).
pub struct GateOut {
    pub outcome: String,
    pub reason: String,
    pub check_ids: Vec<String>,
    pub blocking: bool,
    pub config_hash: String,
}

fn outcome_str(outcome: Outcome) -> &'static str {
    match outcome {
        Outcome::Allow => "allow",
        Outcome::Deny => "deny",
        Outcome::Degrade => "degrade",
    }
}

/// Evaluate `action_context_json` against `config_json`.
pub fn evaluate(config_json: &str, action_context_json: &str) -> Result<GateOut, String> {
    let config: GateConfigV1 =
        serde_json::from_str(config_json).map_err(|err| format!("gate config: {err}"))?;
    let gate = build_gate(&config)?;
    let ctx: ActionContext = serde_json::from_str(action_context_json)
        .map_err(|err| format!("action context: {err}"))?;
    let decision = gate.evaluate(&ctx);
    Ok(GateOut {
        outcome: outcome_str(decision.outcome).to_string(),
        reason: decision.reason,
        check_ids: decision.check_ids,
        blocking: decision.blocking,
        config_hash: gate.config_hash(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The committed gate config, the single source of truth for the service.
    const GATE_V1: &str = include_str!("../config/gate.v1.json");

    /// Golden hash of the committed config (order-sensitive over the four
    /// check ids). A change to gate.v1.json must update this line, making
    /// config drift visible in review (statecraft spec 008 §2).
    const GATE_V1_CONFIG_HASH: &str =
        "sha256:a0356df3a1d2ca95a030e1d9329a7ceb20a54fc1ed1834dd0b158047c306f107";

    fn ctx(json: &str) -> String {
        json.to_string()
    }

    #[test]
    fn committed_config_hash_is_pinned() {
        let out = evaluate(GATE_V1, &ctx(r#"{"action":"noop"}"#)).unwrap();
        assert_eq!(out.config_hash, GATE_V1_CONFIG_HASH);
    }

    #[test]
    fn decision_is_deterministic_across_runs() {
        let context = r#"{"action":"stamp","attributes":{"actor":"agent:x","authenticated":true}}"#;
        let a = evaluate(GATE_V1, context).unwrap();
        let b = evaluate(GATE_V1, context).unwrap();
        assert_eq!(a.outcome, b.outcome);
        assert_eq!(a.reason, b.reason);
        assert_eq!(a.config_hash, b.config_hash);
    }

    #[test]
    fn stamp_without_posture_is_denied() {
        let out = evaluate(
            GATE_V1,
            r#"{"action":"stamp","attributes":{"actor":"agent:x","authenticated":true}}"#,
        )
        .unwrap();
        assert_eq!(out.outcome, "deny");
        assert!(out.blocking);
        assert_eq!(out.check_ids, vec!["posture-required".to_string()]);
    }

    #[test]
    fn stamp_with_posture_and_auth_is_allowed() {
        let out = evaluate(
            GATE_V1,
            r#"{"action":"stamp","attributes":{"posture":"supervised","actor":"agent:x","authenticated":true}}"#,
        )
        .unwrap();
        assert_eq!(out.outcome, "allow");
    }

    #[test]
    fn unauthenticated_actor_is_denied() {
        let out = evaluate(GATE_V1, r#"{"action":"read","attributes":{}}"#).unwrap();
        assert_eq!(out.outcome, "deny");
        assert_eq!(out.check_ids, vec!["actor-authenticated".to_string()]);
    }

    #[test]
    fn inactive_tenant_is_denied() {
        let out = evaluate(
            GATE_V1,
            r#"{"action":"deploy","attributes":{"actor":"u","authenticated":true,"tenant_status":"suspended"}}"#,
        )
        .unwrap();
        assert_eq!(out.outcome, "deny");
        assert_eq!(out.check_ids, vec!["tenant-active".to_string()]);
    }

    #[test]
    fn fleet_remove_requires_matching_confirm_name() {
        let deny = evaluate(
            GATE_V1,
            r#"{"action":"remove","attributes":{"actor":"u","authenticated":true,"subject_name":"app-9","confirm_name":"wrong"}}"#,
        )
        .unwrap();
        assert_eq!(deny.outcome, "deny");
        assert_eq!(deny.check_ids, vec!["confirm-name-required".to_string()]);

        let allow = evaluate(
            GATE_V1,
            r#"{"action":"remove","attributes":{"actor":"u","authenticated":true,"subject_name":"app-9","confirm_name":"app-9"}}"#,
        )
        .unwrap();
        assert_eq!(allow.outcome, "allow");
    }

    #[test]
    fn unknown_check_is_rejected() {
        let bad = r#"{"version":1,"checks":[{"id":"does-not-exist"}]}"#;
        assert!(evaluate(bad, r#"{"action":"noop"}"#).is_err());
    }
}
