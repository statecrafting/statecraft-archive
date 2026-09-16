// SPDX-License-Identifier: Apache-2.0

//! Compiling the verified model into the per-service enforcement tables.
//!
//! Compilation is a pure function of the model and fails closed: dangling
//! references and unknown capability kinds are boot refusals (spec 004
//! section 3.3, refusals 4 and 5). Unenforceable constraint keys never reach
//! this module; [`Constraints`](crate::model::Constraints) refuses them at
//! parse time.

use std::collections::{BTreeMap, BTreeSet};

use trust_window::Level;

use crate::kinds;
use crate::model::{AppModel, Constraints};

/// One resolved grant from the catalog.
#[derive(Debug, Clone)]
pub struct Grant {
    pub id: String,
    pub kind: String,
    pub resource: String,
    pub constraints: Constraints,
}

/// One agent's row: its home service, declared trust posture, and capability
/// subset.
#[derive(Debug, Clone)]
pub struct AgentRow {
    pub service: String,
    pub initial: Level,
    pub ceiling: Option<Level>,
    pub capabilities: BTreeSet<String>,
}

/// The compiled enforcement tables the booted kernel adjudicates against.
#[derive(Debug, Clone)]
pub struct EnforcementTables {
    /// The grant catalog, by capability id.
    pub grants: BTreeMap<String, Grant>,
    /// Service name to its capability ids, in model (sorted) order.
    pub services: BTreeMap<String, Vec<String>>,
    /// Agent name to its row.
    pub agents: BTreeMap<String, AgentRow>,
}

impl EnforcementTables {
    /// Compile the tables from a verified model.
    pub fn compile(model: &AppModel) -> Result<Self, String> {
        let mut grants = BTreeMap::new();
        for cap in &model.capabilities {
            if !kinds::is_known(&cap.kind) {
                return Err(format!(
                    "capability '{}' declares unknown kind '{}'",
                    cap.id, cap.kind
                ));
            }
            let grant = Grant {
                id: cap.id.clone(),
                kind: cap.kind.clone(),
                resource: cap.resource.clone(),
                constraints: cap.constraints.clone().unwrap_or_default(),
            };
            if grants.insert(cap.id.clone(), grant).is_some() {
                return Err(format!("duplicate capability id '{}'", cap.id));
            }
        }

        let mut services = BTreeMap::new();
        for svc in &model.services {
            for id in &svc.capabilities {
                if !grants.contains_key(id) {
                    return Err(format!(
                        "service '{}' references unknown capability '{id}'",
                        svc.name
                    ));
                }
            }
            if services
                .insert(svc.name.clone(), svc.capabilities.clone())
                .is_some()
            {
                return Err(format!("duplicate service name '{}'", svc.name));
            }
        }

        let mut agents = BTreeMap::new();
        for agent in &model.agents {
            if !services.contains_key(&agent.service) {
                return Err(format!(
                    "agent '{}' references unknown service '{}'",
                    agent.name, agent.service
                ));
            }
            for id in &agent.capabilities {
                if !grants.contains_key(id) {
                    return Err(format!(
                        "agent '{}' references unknown capability '{id}'",
                        agent.name
                    ));
                }
            }
            let row = AgentRow {
                service: agent.service.clone(),
                initial: agent.trust.initial,
                ceiling: agent.trust.ceiling,
                capabilities: agent.capabilities.iter().cloned().collect(),
            };
            if agents.insert(agent.name.clone(), row).is_some() {
                return Err(format!("duplicate agent name '{}'", agent.name));
            }
        }

        Ok(Self {
            grants,
            services,
            agents,
        })
    }
}
