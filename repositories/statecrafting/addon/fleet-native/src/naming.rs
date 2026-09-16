//! Pure naming + label helpers, and namespace/name validation. No I/O.
//!
//! `is_valid_namespace` reuses the pattern from deployd-api-rs `rbac.rs`
//! (statecraft spec 006 §1): DNS-1123 label shape plus a reserved / platform-namespace
//! blocklist, so a caller-supplied namespace can never target a platform
//! namespace.

use std::collections::BTreeMap;

/// Value of `app.kubernetes.io/managed-by` on every resource fleet places.
pub const MANAGED_BY: &str = "fleet-native";

/// Namespaces fleet must never place into.
const RESERVED: &[&str] = &[
    "kube-system",
    "kube-public",
    "kube-node-lease",
    "default",
    "deployd-system",
    "rauthy-system",
    "statecraft-system",
    "monitoring",
    "ingress-nginx",
    "flux-system",
    "kube-flannel",
    "cert-manager",
    "external-secrets",
];

fn is_dns1123_label(s: &str) -> bool {
    if s.is_empty() || s.len() > 63 {
        return false;
    }
    let bytes = s.as_bytes();
    let edge_ok = |b: u8| b.is_ascii_lowercase() || b.is_ascii_digit();
    if !edge_ok(bytes[0]) || !edge_ok(bytes[bytes.len() - 1]) {
        return false;
    }
    bytes
        .iter()
        .all(|&b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// A well-formed, non-reserved tenant namespace name.
pub fn is_valid_namespace(ns: &str) -> bool {
    if RESERVED.contains(&ns) {
        return false;
    }
    is_dns1123_label(ns)
}

/// A well-formed app / resource name (DNS-1123 label; no reserved list).
pub fn is_valid_name(name: &str) -> bool {
    is_dns1123_label(name)
}

/// The full label set applied to every resource fleet places for an app.
pub fn labels(app: &str) -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    m.insert("app.kubernetes.io/name".into(), app.to_string());
    m.insert("app.kubernetes.io/instance".into(), app.to_string());
    m.insert("app.kubernetes.io/managed-by".into(), MANAGED_BY.into());
    m.insert("fleet.statecraft.ing/app".into(), app.to_string());
    m
}

/// The stable selector subset (Deployment/Service selectors and pod labels).
pub fn selector_labels(app: &str) -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    m.insert("app.kubernetes.io/name".into(), app.to_string());
    m.insert("app.kubernetes.io/instance".into(), app.to_string());
    m
}

/// Namespace-scoped label (no per-app identity).
pub fn managed_labels() -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    m.insert("app.kubernetes.io/managed-by".into(), MANAGED_BY.into());
    m
}

pub fn pvc_name(app: &str) -> String {
    format!("{app}-data")
}

/// The per-app ingress-allow NetworkPolicy. Named per app because the policy
/// pins the app's port: one namespace-wide policy would freeze the first
/// app's port for every later app in the tenant namespace.
pub fn ingress_policy_name(app: &str) -> String {
    format!("fleet-allow-ingress-{app}")
}

pub fn tls_secret_name(app: &str) -> String {
    format!("{app}-tls")
}

pub fn backup_job_name(app: &str, stamp: &str) -> String {
    format!("{app}-backup-{stamp}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_namespace_accepts_tenant_shapes() {
        // `t-<uuid>` is how the fleet service names a tenant namespace.
        assert!(is_valid_namespace(
            "t-3f2504e0-4f89-41d3-9a0c-0305e82c3301"
        ));
        assert!(is_valid_namespace("t-acme"));
        assert!(is_valid_namespace(&format!("t-{}", "a".repeat(61)))); // 63 total
    }

    #[test]
    fn valid_namespace_rejects_reserved_and_malformed() {
        for ns in RESERVED {
            assert!(!is_valid_namespace(ns), "{ns} must be reserved");
        }
        assert!(!is_valid_namespace(""));
        assert!(!is_valid_namespace("-lead"));
        assert!(!is_valid_namespace("trail-"));
        assert!(!is_valid_namespace("Upper"));
        assert!(!is_valid_namespace("has_underscore"));
        assert!(!is_valid_namespace("has.dot"));
        assert!(!is_valid_namespace(&"a".repeat(64)));
    }

    #[test]
    fn derived_names_are_deterministic() {
        assert_eq!(pvc_name("acme"), "acme-data");
        assert_eq!(tls_secret_name("acme"), "acme-tls");
        assert_eq!(ingress_policy_name("acme"), "fleet-allow-ingress-acme");
        assert_eq!(backup_job_name("acme", "20260715t120000"), "acme-backup-20260715t120000");
    }
}
