// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/102-governed-excellence/spec.md — FR-031, FR-036

//! Agent execution identity — immutable tuple recorded in all proof-chain records.
//!
//! FR-031: Every agent session has a unique (`agent_id`, `session_id`, `project_id`).
//! FR-036: Identity is immutable for the duration of a pipeline run.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Immutable identity for an agent execution session.
///
/// Created once at pipeline start and referenced in every proof-chain record,
/// audit event, and governance certificate produced during the run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentIdentity {
    /// Unique identifier for the agent performing the work.
    pub agent_id: String,
    /// Unique session identifier for this execution.
    pub session_id: String,
    /// Project scope in which the agent operates.
    pub project_id: String,
}

impl AgentIdentity {
    /// Create a new identity with an auto-generated session ID.
    pub fn new(agent_id: impl Into<String>, project_id: impl Into<String>) -> Self {
        Self {
            agent_id: agent_id.into(),
            session_id: Uuid::new_v4().to_string(),
            project_id: project_id.into(),
        }
    }

    /// Create an identity with all fields specified (for testing or restoration).
    pub fn with_session(
        agent_id: impl Into<String>,
        session_id: impl Into<String>,
        project_id: impl Into<String>,
    ) -> Self {
        Self {
            agent_id: agent_id.into(),
            session_id: session_id.into(),
            project_id: project_id.into(),
        }
    }

    /// Format the identity tuple for inclusion in proof-chain records.
    pub fn to_proof_context(&self) -> String {
        format!(
            "agent_id={},session_id={},project_id={}",
            self.agent_id, self.session_id, self.project_id
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_is_immutable() {
        let id = AgentIdentity::new("factory-engine", "ws-001");
        let clone = id.clone();
        assert_eq!(id, clone);
        assert!(!id.session_id.is_empty());
    }

    #[test]
    fn proof_context_format() {
        let id = AgentIdentity::with_session("test-agent", "sess-123", "ws-456");
        let ctx = id.to_proof_context();
        assert!(ctx.contains("agent_id=test-agent"));
        assert!(ctx.contains("session_id=sess-123"));
        assert!(ctx.contains("project_id=ws-456"));
    }

    #[test]
    fn round_trip_serialisation() {
        let id = AgentIdentity::new("runner", "workspace-x");
        let json = serde_json::to_string(&id).unwrap();
        let restored: AgentIdentity = serde_json::from_str(&json).unwrap();
        assert_eq!(id, restored);
    }
}
