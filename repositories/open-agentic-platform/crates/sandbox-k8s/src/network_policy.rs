// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/186-sandbox-k8s-backend/spec.md — §2.3, §3 FR-004

//! Per-execution NetworkPolicy builder.
//!
//! Pure function: given a per-execution uuid + namespace, produce a
//! NetworkPolicy that default-denies ingress AND egress for the Pod
//! carrying the matching `oap.io/sandbox` label. Phase 1 emits an
//! empty `egress` rule list (FU-001 wires the FQDN allowlist path).
//!
//! Default-deny semantics come from the policy declaring both
//! `Ingress` and `Egress` policy types while supplying no allow
//! rules — per the K8s NetworkPolicy spec, that is the deny-all
//! posture for the selected Pods.

use std::collections::BTreeMap;

use k8s_openapi::api::networking::v1::{NetworkPolicy, NetworkPolicySpec};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::{LabelSelector, ObjectMeta};

use crate::pod_spec::LABEL_SANDBOX_UUID;

/// Per-execution NetworkPolicy name. Mirrors the Pod name so operators
/// can correlate at a glance.
pub(crate) fn network_policy_name(uuid: &str) -> String {
    format!("oap-sbx-{uuid}")
}

/// Build the per-execution NetworkPolicy. Pure: same inputs yield the
/// same policy bytes.
pub(crate) fn build(uuid: &str, namespace: &str) -> NetworkPolicy {
    let mut match_labels = BTreeMap::new();
    match_labels.insert(LABEL_SANDBOX_UUID.to_string(), uuid.to_string());

    let pod_selector = LabelSelector {
        match_labels: Some(match_labels),
        match_expressions: None,
    };

    let spec = NetworkPolicySpec {
        pod_selector,
        policy_types: Some(vec!["Ingress".to_string(), "Egress".to_string()]),
        // Phase 1 default-deny: empty (or absent) rule lists ⇒ deny.
        // Spec 186 §2.3 + §2.5 / FU-001 wires explicit egress rules
        // when the CNI substrate supports FQDN policies.
        ingress: Some(vec![]),
        egress: Some(vec![]),
    };

    NetworkPolicy {
        metadata: ObjectMeta {
            name: Some(network_policy_name(uuid)),
            namespace: Some(namespace.to_string()),
            labels: Some({
                let mut l = BTreeMap::new();
                l.insert(LABEL_SANDBOX_UUID.to_string(), uuid.to_string());
                l
            }),
            ..ObjectMeta::default()
        },
        spec: Some(spec),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_is_stable_for_uuid() {
        assert_eq!(network_policy_name("abc"), "oap-sbx-abc");
    }

    #[test]
    fn metadata_carries_uuid_and_namespace() {
        let np = build("abc", "oap-sandbox");
        assert_eq!(np.metadata.name.as_deref(), Some("oap-sbx-abc"));
        assert_eq!(np.metadata.namespace.as_deref(), Some("oap-sandbox"));
        let labels = np.metadata.labels.unwrap();
        assert_eq!(labels.get(LABEL_SANDBOX_UUID), Some(&"abc".to_string()));
    }

    #[test]
    fn pod_selector_matches_sandbox_uuid_label() {
        let np = build("abc", "oap-sandbox");
        let s = np.spec.unwrap();
        let ml = s.pod_selector.match_labels.unwrap();
        assert_eq!(ml.get(LABEL_SANDBOX_UUID), Some(&"abc".to_string()));
        assert!(s.pod_selector.match_expressions.is_none());
    }

    #[test]
    fn policy_types_cover_ingress_and_egress() {
        let np = build("abc", "oap-sandbox");
        let s = np.spec.unwrap();
        let pt = s.policy_types.unwrap();
        assert!(pt.contains(&"Ingress".to_string()));
        assert!(pt.contains(&"Egress".to_string()));
        assert_eq!(pt.len(), 2);
    }

    #[test]
    fn ingress_and_egress_rule_lists_are_empty_for_default_deny() {
        let np = build("abc", "oap-sandbox");
        let s = np.spec.unwrap();
        assert_eq!(s.ingress.unwrap().len(), 0);
        assert_eq!(s.egress.unwrap().len(), 0);
    }

    #[test]
    fn build_is_deterministic_for_same_inputs() {
        let a = build("abc", "oap-sandbox");
        let b = build("abc", "oap-sandbox");
        // Round-trip through serde JSON for a content-level check.
        let aj = serde_json::to_string(&a).unwrap();
        let bj = serde_json::to_string(&b).unwrap();
        assert_eq!(aj, bj);
    }

    #[test]
    fn distinct_uuids_yield_distinct_selectors() {
        let a = build("aaa", "ns");
        let b = build("bbb", "ns");
        let a_ml = a.spec.unwrap().pod_selector.match_labels.unwrap();
        let b_ml = b.spec.unwrap().pod_selector.match_labels.unwrap();
        assert_eq!(a_ml.get(LABEL_SANDBOX_UUID), Some(&"aaa".to_string()));
        assert_eq!(b_ml.get(LABEL_SANDBOX_UUID), Some(&"bbb".to_string()));
    }
}
