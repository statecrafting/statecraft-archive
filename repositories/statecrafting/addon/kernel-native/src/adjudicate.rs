// SPDX-License-Identifier: Apache-2.0

//! Adjudicating one proposed effect against the compiled tables.
//!
//! Deny-by-default, in short-circuit order (spec 004 section 3.4): unknown
//! principal, ceiling membership (service set, intersected with the agent's
//! rows when an agent acts), grant constraints, the trust ceiling, then the
//! model's roster gate. Ceiling violations are blocking denies; a `read-only`
//! trust deny is non-blocking, because a human grant can meaningfully override
//! a trust throttle where it must never override the declared ceiling.

use std::collections::BTreeMap;

use action_gate_core::{ActionContext, Decision, Gate};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use trust_window::Level;

use crate::kinds;
use crate::model::Constraints;
use crate::tables::{EnforcementTables, Grant};

/// The `{kind, resource}` pair an effect exercises.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityRef {
    pub kind: String,
    pub resource: String,
}

/// One proposed effect, as the consumer describes it. `attributes` is the
/// precomputation contract: the consumer resolves the facts constraints are
/// checked against (`domain`, `table`/`tables`, `key`, `topic`, `tool`) before
/// calling in, exactly as the donor's context-assembly step did.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectRequest {
    pub service: String,
    #[serde(default)]
    pub agent: Option<String>,
    pub capability: CapabilityRef,
    /// The agent's current ladder position from the consumer's persisted
    /// snapshot; the agent's declared `initial` applies when absent.
    #[serde(default)]
    pub trust: Option<Level>,
    #[serde(default)]
    pub payload_summary: Option<String>,
    #[serde(default)]
    pub payload_body: Option<String>,
    #[serde(default)]
    pub attributes: BTreeMap<String, Value>,
}

fn attr_str<'a>(attrs: &'a BTreeMap<String, Value>, key: &str) -> Option<&'a str> {
    attrs.get(key).and_then(|v| v.as_str())
}

/// Check one grant's constraints against the request attributes. `Err` names
/// the failed constraint key. A constrained grant whose attribute is absent
/// fails: unverifiable is denied, not excused.
fn constraints_satisfied(c: &Constraints, attrs: &BTreeMap<String, Value>) -> Result<(), String> {
    if let Some(domains) = &c.domains {
        match attr_str(attrs, "domain") {
            Some(d) if domains.iter().any(|x| x == d) => {}
            _ => return Err("domains".to_string()),
        }
    }
    if let Some(tables) = &c.tables {
        let named: Vec<String> = match (attrs.get("tables"), attr_str(attrs, "table")) {
            (Some(Value::Array(list)), _) => list
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect(),
            (_, Some(t)) => vec![t.to_string()],
            _ => vec![],
        };
        if named.is_empty() || !named.iter().all(|t| tables.contains(t)) {
            return Err("tables".to_string());
        }
    }
    if let Some(prefix) = &c.key_prefix {
        match attr_str(attrs, "key") {
            Some(k) if k.starts_with(prefix.as_str()) => {}
            _ => return Err("keyPrefix".to_string()),
        }
    }
    if let Some(topics) = &c.topics {
        match attr_str(attrs, "topic") {
            Some(t) if topics.iter().any(|x| x == t) => {}
            _ => return Err("topics".to_string()),
        }
    }
    if let Some(tools) = &c.tools {
        match attr_str(attrs, "tool") {
            Some(t) if tools.iter().any(|x| x == t) => {}
            _ => return Err("tools".to_string()),
        }
    }
    Ok(())
}

fn grant_matches(grant: &Grant, cap: &CapabilityRef) -> bool {
    grant.kind == cap.kind && (grant.resource == "*" || grant.resource == cap.resource)
}

fn deny_blocking(reason: String, check: &str) -> Decision {
    Decision::deny(reason, vec![check.to_string()]).blocking()
}

/// Adjudicate one effect. A pure, total function of (tables, roster, request).
pub fn adjudicate(tables: &EnforcementTables, roster: &Gate, req: &EffectRequest) -> Decision {
    // 1. The acting principals must exist and cohere.
    let Some(service_caps) = tables.services.get(&req.service) else {
        return deny_blocking(
            format!("kernel:deny:service:unknown_service:{}", req.service),
            "service",
        );
    };
    let agent = match &req.agent {
        None => None,
        Some(name) => match tables.agents.get(name) {
            None => {
                return deny_blocking(format!("kernel:deny:agent:unknown_agent:{name}"), "agent");
            }
            Some(row) if row.service != req.service => {
                return deny_blocking(
                    format!("kernel:deny:agent:service_mismatch:{name}"),
                    "agent",
                );
            }
            Some(row) => Some(row),
        },
    };

    // 2. Ceiling membership: the service's grants, intersected with the
    // agent's rows when an agent acts. Absence is never permission.
    let matching: Vec<&Grant> = service_caps
        .iter()
        .filter(|id| agent.is_none_or(|a| a.capabilities.contains(*id)))
        .filter_map(|id| tables.grants.get(id))
        .filter(|g| grant_matches(g, &req.capability))
        .collect();
    if matching.is_empty() {
        return deny_blocking(
            format!(
                "kernel:deny:capability:undeclared:{}:{}",
                req.capability.kind, req.capability.resource
            ),
            "capability",
        );
    }

    // 3. Constraints: satisfying any one matching grant suffices (a broad
    // grant may sit beside a narrow one).
    let mut first_failure: Option<String> = None;
    let satisfied =
        matching.iter().any(
            |g| match constraints_satisfied(&g.constraints, &req.attributes) {
                Ok(()) => true,
                Err(key) => {
                    first_failure.get_or_insert(key);
                    false
                }
            },
        );
    if !satisfied {
        let key = first_failure.unwrap_or_else(|| "unknown".to_string());
        return deny_blocking(format!("kernel:deny:constraint:{key}"), "constraint");
    }

    // 4. The trust ceiling, only when an agent acts.
    if let Some(row) = agent {
        let mut level = req.trust.unwrap_or(row.initial);
        if let Some(ceiling) = row.ceiling {
            level = Level::max_severity(level, ceiling);
        }
        match level {
            Level::Suspended => {
                return deny_blocking("kernel:deny:trust:suspended".to_string(), "trust");
            }
            Level::ReadOnly if !kinds::is_read(&req.capability.kind) => {
                // Non-blocking: a human grant may override a trust throttle.
                return Decision::deny("kernel:deny:trust:read_only", vec!["trust".to_string()]);
            }
            _ => {}
        }
    }

    // 5. The model's roster gate over the payload and attributes.
    let mut ctx = ActionContext::new(format!(
        "{}:{}",
        req.capability.kind, req.capability.resource
    ))
    .with_summary(req.payload_summary.clone().unwrap_or_default());
    if let Some(body) = &req.payload_body {
        ctx = ctx.with_body(body.clone());
    }
    for (key, value) in &req.attributes {
        ctx = ctx.with_attr(key.clone(), value.clone());
    }
    roster.evaluate(&ctx)
}
