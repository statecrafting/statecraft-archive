// SPDX-License-Identifier: Apache-2.0

//! Assembling the roster gate named by the model's `gate.checks`.
//!
//! The roster is the model-configurable part of adjudication; the structural
//! checks (service, ceiling membership, constraints, trust) are not
//! roster-configurable, because a model must not be able to opt out of its own
//! ceiling. The v0.1 vocabulary is exactly `secrets`; an unknown check id is a
//! boot refusal (running without a mandated check would weaken enforcement),
//! and the assembled roster's `config_hash()` must equal the model's pinned
//! `gate.configHash` so adjudication config stays part of the anchored
//! surface.

use action_gate_core::{Gate, checks::SecretsCheck};

/// Assemble the roster gate from the model's check ids, in declared order.
pub fn assemble_roster(checks: &[String]) -> Result<Gate, String> {
    let mut builder = Gate::builder();
    for id in checks {
        builder = match id.as_str() {
            "secrets" => builder.check(SecretsCheck::default()),
            other => {
                return Err(format!(
                    "gate.checks names '{other}', which this kernel does not implement"
                ));
            }
        };
    }
    Ok(builder.build())
}

/// The `config_hash()` of the roster `checks` would assemble to. Producers use
/// this to pin `gate.configHash` at extraction time; boot uses it to verify.
pub fn roster_config_hash(checks: &[String]) -> Result<String, String> {
    Ok(assemble_roster(checks)?.config_hash())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_roster_assembles_and_hashes_stably() {
        let checks = vec!["secrets".to_string()];
        let h1 = roster_config_hash(&checks).unwrap();
        let h2 = roster_config_hash(&checks).unwrap();
        assert_eq!(h1, h2);
        assert!(h1.starts_with("sha256:"));
    }

    #[test]
    fn unknown_check_refuses() {
        assert!(assemble_roster(&["allowlist".to_string()]).is_err());
    }

    #[test]
    fn empty_roster_is_legal() {
        // A model may pin an empty roster; the structural checks still run.
        assert!(assemble_roster(&[]).is_ok());
    }
}
