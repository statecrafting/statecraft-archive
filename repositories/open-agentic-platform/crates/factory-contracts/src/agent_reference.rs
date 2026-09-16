// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/123-agent-catalog-org-rescope/spec.md — §8.2, T083

//! Typed `AgentReference` enum for Factory pipeline definitions.
//!
//! A Factory pipeline that needs an org catalog agent describes the
//! reference using this enum rather than a raw string. The `factory-engine`
//! `AgentResolver` accepts this type directly (the two enums are
//! isomorphic; keeping a copy here lets pipeline contracts describe agent
//! dependencies without taking a dependency on the engine crate).
//!
//! Serialisation uses a tagged format so pipeline YAML/JSON can express:
//!
//! ```yaml
//! comparator_agent:
//!   by_name_latest:
//!     name: stage-cd-comparator
//! ```
//!
//! or
//!
//! ```yaml
//! comparator_agent:
//!   by_id:
//!     org_agent_id: "01234567-89ab-cdef-0123-456789abcdef"
//!     version: 3
//! ```

use serde::{Deserialize, Serialize};

/// How a Factory pipeline refers to an org catalog agent.
///
/// Maps cleanly onto the `factory-engine::agent_resolver::AgentReference`
/// input enum. Pipelines that bind an org agent MUST use one of these
/// variants rather than a raw string in their contract definitions.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentReference {
    /// Resolve the exact row at `(org_agent_id, version)`. Most stable
    /// form — pinned by UUID and version, does not change unless the
    /// catalog row is deleted (prevented by `ON DELETE RESTRICT`).
    ById {
        org_agent_id: String,
        version: i64,
    },
    /// Resolve by `(name, version)`. Equivalent to `ById` after the
    /// first resolution; suitable when the UUID is not known at
    /// pipeline authoring time.
    ByName {
        name: String,
        version: i64,
    },
    /// Resolve by name, choosing the highest `status: published`
    /// version at run time. Use when the pipeline always wants the
    /// latest published definition.
    ByNameLatest {
        name: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_by_id() {
        let r = AgentReference::ById {
            org_agent_id: "abc-123".into(),
            version: 3,
        };
        let json = serde_json::to_string(&r).unwrap();
        let back: AgentReference = serde_json::from_str(&json).unwrap();
        assert_eq!(r, back);
    }

    #[test]
    fn round_trips_by_name() {
        let r = AgentReference::ByName {
            name: "stage-cd-comparator".into(),
            version: 2,
        };
        let json = serde_json::to_string(&r).unwrap();
        let back: AgentReference = serde_json::from_str(&json).unwrap();
        assert_eq!(r, back);
    }

    #[test]
    fn round_trips_by_name_latest() {
        let r = AgentReference::ByNameLatest {
            name: "stage-cd-comparator".into(),
        };
        let json = serde_json::to_string(&r).unwrap();
        let back: AgentReference = serde_json::from_str(&json).unwrap();
        assert_eq!(r, back);
    }
}
