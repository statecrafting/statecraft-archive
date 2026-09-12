//! governance-native: the control plane's governance spine as a napi-rs addon.
//!
//! Four primitives, extracted from OAP's policy-kernel and consumed here from
//! crates.io (statecraft spec 008 §1), exposed to the Encore.ts `governance/`
//! service as plain-JSON-in / plain-JSON-out functions:
//!
//! - [`canon`]  canonical JSON + content hash (canonical-keysort-json)
//! - [`ledger`] the tamper-evident record chain over a stateDir (attest-ledger)
//! - [`gate`]   the deterministic action gate (action-gate)
//! - [`trust`]  the rolling-window trust scorer (trust-window)
//!
//! The pure logic lives in the modules below and is unit-tested with
//! `cargo test --no-default-features` (no Node C API linkage). The `#[napi]`
//! bindings in [`napi_api`] are compiled only under the default `node`
//! feature, which is what `napi build` and a plain `cargo build` use.

// The pure modules are the crate's real surface, consumed by the napi layer
// (feature `node`) and exercised by `cargo test`. In the degenerate build with
// neither, they read as dead code; silence only that case.
#![cfg_attr(not(feature = "node"), allow(dead_code))]

mod canon;
mod gate;
mod ledger;
mod trust;

#[cfg(feature = "node")]
mod napi_api;

#[cfg(test)]
mod golden_tests;

#[cfg(test)]
mod flow_tests {
    // statecraft spec 008 §4: one integration test proving the statecraft
    // spec-005 pattern, a fake stamp flow that calls gate -> append -> verify
    // end to end.
    #[test]
    fn stamp_flow_gate_then_append_then_verify() {
        let config = include_str!("../config/gate.v1.json");

        // 1. gate: an authenticated, posture-carrying stamp for an active
        //    tenant is allowed, and the decision carries the config hash.
        let ctx = r#"{"action":"stamp","attributes":{"posture":"supervised","actor":"agent:factory","authenticated":true,"tenant_status":"active"}}"#;
        let decision = crate::gate::evaluate(config, ctx).unwrap();
        assert_eq!(decision.outcome, "allow");
        assert!(decision.config_hash.starts_with("sha256:"));

        // 2. append: record the attestation, carrying the gate's config hash.
        let dir = std::env::temp_dir().join("gov-native-flow");
        let _ = std::fs::remove_dir_all(&dir);
        let record = format!(
            r#"{{"id":"stamp-1","kind":"stamp","subject":"app-42","actor":"agent:factory","payloadHash":"abc123","configHash":"{}"}}"#,
            decision.config_hash
        );
        let appended = crate::ledger::append(&dir, &record).unwrap();
        assert_eq!(appended.seq, 0);

        // 3. verify: the chain is intact and independently checkable.
        let verified = crate::ledger::verify(&dir).unwrap();
        assert!(verified.ok, "{:?}", verified.error);
        assert_eq!(verified.seq, 1);
    }
}
