//! Spec 198 FR-005 — the run's intent capsule, engine side.
//!
//! The capsule is the concrete instantiation of the admitted envelope's
//! intent-capsule template: the declared goal (with a stable goal id,
//! ASI01 m7), the constraint set, the admitted envelope hash, and the
//! run/project identity. Its canonical hash is presented at grant
//! issuance and re-presented verbatim at every stage-boundary renewal —
//! a capsule that changes mid-run is a goal shift and refuses renewal.
//!
//! Canonical form: JSON in the exact field order declared on
//! [`IntentCapsule`] (serde_json preserves declaration order), hashed
//! with SHA-256. The frozen Build-Spec hash is deliberately NOT part of
//! the capsule — it is presented separately from the freeze boundary
//! onward (the platform records it on the grant chain one-way), so the
//! capsule hash stays stable for the run's whole lifetime.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct IntentCapsule {
    /// Declared goal, plain language (recorded for audit + HITL surfaces).
    pub goal: String,
    /// Stable goal identifier — derived from the goal text, never from
    /// run-local randomness, so re-presentation is deterministic.
    pub goal_id: String,
    pub constraints: Vec<String>,
    /// The admitted envelope hash from the verified bundle admission block.
    pub envelope_hash: String,
    pub project_id: String,
    pub run_id: String,
}

impl IntentCapsule {
    pub fn new(
        goal: impl Into<String>,
        constraints: Vec<String>,
        envelope_hash: impl Into<String>,
        project_id: impl Into<String>,
        run_id: impl Into<String>,
    ) -> Self {
        let goal = goal.into();
        let goal_id = derive_goal_id(&goal);
        Self {
            goal,
            goal_id,
            constraints,
            envelope_hash: envelope_hash.into(),
            project_id: project_id.into(),
            run_id: run_id.into(),
        }
    }

    /// Canonical JSON — declaration field order, no pretty-printing.
    pub fn canonical_json(&self) -> String {
        serde_json::to_string(self).expect("intent capsule serialises to JSON")
    }

    /// SHA-256 hex over the canonical JSON. This is the `capsule_hash`
    /// presented on `factory.run.grant_request` / `.grant_renew`.
    pub fn capsule_hash(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.canonical_json().as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Persist the capsule alongside the run's other governance artifacts
    /// (`<run-dir>/intent-capsule.json`) for audit + certificate binding.
    pub fn persist(&self, run_dir: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(run_dir)?;
        let json = serde_json::to_string_pretty(self).map_err(std::io::Error::other)?;
        std::fs::write(run_dir.join("intent-capsule.json"), json)
    }
}

/// Stable goal id: `goal-` + first 16 hex chars of SHA-256(goal text).
pub fn derive_goal_id(goal: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(goal.as_bytes());
    let hex = format!("{:x}", hasher.finalize());
    format!("goal-{}", &hex[..16])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn capsule() -> IntentCapsule {
        IntentCapsule::new(
            "scaffold the community grant portal",
            vec!["no-deploy-without-gate".into()],
            "envhash-1",
            "project-1",
            "run-1",
        )
    }

    #[test]
    fn capsule_hash_is_deterministic_and_goal_sensitive() {
        let a = capsule();
        let b = capsule();
        assert_eq!(a.capsule_hash(), b.capsule_hash());
        assert_eq!(a.goal_id, b.goal_id);

        let mut shifted = capsule();
        shifted.goal = "exfiltrate the secrets".into();
        assert_ne!(a.capsule_hash(), shifted.capsule_hash());
    }

    #[test]
    fn goal_id_is_stable_and_prefixed() {
        let id = derive_goal_id("x");
        assert!(id.starts_with("goal-"));
        assert_eq!(id.len(), 5 + 16);
        assert_eq!(id, derive_goal_id("x"));
    }

    #[test]
    fn persists_next_to_run_artifacts() {
        let dir = tempfile::tempdir().unwrap();
        capsule().persist(dir.path()).unwrap();
        let raw = std::fs::read_to_string(dir.path().join("intent-capsule.json")).unwrap();
        let parsed: IntentCapsule = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed, capsule());
    }
}
