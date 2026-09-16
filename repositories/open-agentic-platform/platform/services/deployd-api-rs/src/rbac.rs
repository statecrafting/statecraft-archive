//! Self-provisioned per-namespace RBAC (additive, opt-in).
//!
//! Background: the deployd-api Helm chart splits its permissions into two
//! ClusterRoles: `deployd-controller-namespaces` (cluster-scoped, always
//! bound cluster-wide) and `deployd-controller-workloads` (namespaced,
//! bound either per-namespace via `rbac.namespaces` or, by default,
//! cluster-wide as a fallback). The cluster-wide workloads fallback exists
//! only because deployd creates tenant namespaces on demand and had no way
//! to grant itself workload rights in a namespace it just created.
//!
//! This module closes that gap: when `DEPLOYD_SELF_PROVISION_RBAC` is on,
//! deployd creates a RoleBinding in each target namespace granting its own
//! ServiceAccount the `deployd-controller-workloads` ClusterRole, right
//! before `helm upgrade --install` runs there. Once operators run in this
//! mode the chart can drop the cluster-wide workloads ClusterRoleBinding
//! entirely.
//!
//! This is ADDITIVE and opt-in: the default (`enabled = false`) is a no-op,
//! so the existing cluster-wide fallback keeps working untouched. FLIPPING
//! the chart default to scoped is intentionally NOT done here; it is gated
//! on real-cluster validation (see the chart's rbac.yaml header and the
//! spec 136 Phase 3 precedent).

use k8s_openapi::api::core::v1::Namespace;
use k8s_openapi::api::rbac::v1::{RoleBinding, RoleRef, Subject};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use kube::api::{Api, PostParams};
use kube::Client;
use std::collections::BTreeMap;

/// Configuration for self-provisioned per-namespace RBAC, read from the
/// process environment (mirrors `HelmRunner::from_env` / `BackupConfig`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SelfProvisionConfig {
    /// Master switch. Off by default so this whole path is inert unless an
    /// operator opts in.
    pub enabled: bool,
    /// deployd's own ServiceAccount name (the RoleBinding subject).
    pub service_account: String,
    /// The namespace deployd's ServiceAccount lives in.
    pub service_account_namespace: String,
    /// The ClusterRole the RoleBinding references (and its own name).
    pub cluster_role: String,
}

impl SelfProvisionConfig {
    pub fn from_env() -> Self {
        Self::from_var_lookup(|k| std::env::var(k).ok())
    }

    fn from_var_lookup<F>(get: F) -> Self
    where
        F: Fn(&str) -> Option<String>,
    {
        let v = |k: &str| get(k).filter(|s| !s.is_empty());
        let enabled = v("DEPLOYD_SELF_PROVISION_RBAC")
            .map(|s| s == "true" || s == "1")
            .unwrap_or(false);
        Self {
            enabled,
            service_account: v("DEPLOYD_SERVICE_ACCOUNT")
                .unwrap_or_else(|| "deployd-api".to_string()),
            service_account_namespace: v("DEPLOYD_POD_NAMESPACE")
                .unwrap_or_else(|| "deployd-system".to_string()),
            cluster_role: v("DEPLOYD_WORKLOADS_CLUSTER_ROLE")
                .unwrap_or_else(|| "deployd-controller-workloads".to_string()),
        }
    }
}

/// Pure constructor for the RoleBinding object. Kept separate from the I/O
/// so its shape (roleRef, subject, name, namespace) is unit-testable
/// without a cluster.
pub fn workload_rolebinding(namespace: &str, cfg: &SelfProvisionConfig) -> RoleBinding {
    let mut labels = BTreeMap::new();
    labels.insert(
        "app.kubernetes.io/managed-by".to_string(),
        "deployd-api".to_string(),
    );
    RoleBinding {
        metadata: ObjectMeta {
            name: Some(cfg.cluster_role.clone()),
            namespace: Some(namespace.to_string()),
            labels: Some(labels),
            ..Default::default()
        },
        role_ref: RoleRef {
            api_group: "rbac.authorization.k8s.io".to_string(),
            kind: "ClusterRole".to_string(),
            name: cfg.cluster_role.clone(),
        },
        subjects: Some(vec![Subject {
            kind: "ServiceAccount".to_string(),
            name: cfg.service_account.clone(),
            namespace: Some(cfg.service_account_namespace.clone()),
            ..Default::default()
        }]),
    }
}

#[derive(Debug)]
pub enum RbacError {
    Client(String),
    Namespace(String),
    RoleBinding(String),
}

impl std::fmt::Display for RbacError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RbacError::Client(m) => write!(f, "kube client: {m}"),
            RbacError::Namespace(m) => write!(f, "ensure namespace: {m}"),
            RbacError::RoleBinding(m) => write!(f, "ensure rolebinding: {m}"),
        }
    }
}

impl std::error::Error for RbacError {}

/// DNS-1123-label validation for a Kubernetes namespace name, plus a small
/// reserved-namespace blocklist. Used both by `create_deployment` (to reject a
/// caller-supplied request namespace up front) and, as defense-in-depth, by
/// the self-provision entry points here so a deployd RoleBinding is never
/// written into a reserved / platform namespace regardless of caller.
///
/// It validates DNS-1123 label shape and blocks the reserved / platform
/// namespaces listed below. It does NOT enforce per-tenant isolation: it
/// cannot distinguish "tenant A's namespace" from "tenant B's namespace" (both
/// are well-formed, non-reserved names). True per-tenant isolation is a
/// separate lever: the chart's `rbac.namespaces` allowlist scopes what the
/// deployd-api ServiceAccount is actually permitted to touch in the cluster's
/// RBAC.
pub(crate) fn is_valid_tenant_namespace(ns: &str) -> bool {
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
    if ns.is_empty() || ns.len() > 63 {
        return false;
    }
    if RESERVED.contains(&ns) {
        return false;
    }
    let bytes = ns.as_bytes();
    let edge_ok = |b: u8| b.is_ascii_lowercase() || b.is_ascii_digit();
    if !edge_ok(bytes[0]) || !edge_ok(bytes[bytes.len() - 1]) {
        return false;
    }
    bytes
        .iter()
        .all(|&b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Whether `namespace` currently exists in the cluster. Shared existence
/// probe for the deploy (create-if-absent) and teardown (skip-if-absent)
/// self-provision paths.
async fn namespace_exists(client: &Client, namespace: &str) -> Result<bool, RbacError> {
    let ns_api: Api<Namespace> = Api::all(client.clone());
    Ok(ns_api
        .get_opt(namespace)
        .await
        .map_err(|e| RbacError::Namespace(e.to_string()))?
        .is_some())
}

/// Create (or confirm) the workloads RoleBinding in `namespace`, binding
/// deployd's ServiceAccount to the `deployd-controller-workloads` ClusterRole.
/// Idempotent: an already-present RoleBinding (HTTP 409) is treated as
/// success. Shared by the deploy ([`ensure_workload_rbac`]) and teardown
/// ([`ensure_workload_rbac_for_teardown`]) self-provision paths.
///
/// Creating the RoleBinding requires deployd to hold the `bind` verb on the
/// referenced ClusterRole (Kubernetes privilege-escalation prevention) plus
/// `create` on rolebindings, both granted by the chart when self-provisioning
/// is enabled.
async fn create_workload_rolebinding(
    client: Client,
    namespace: &str,
    cfg: &SelfProvisionConfig,
) -> Result<(), RbacError> {
    let rb_api: Api<RoleBinding> = Api::namespaced(client, namespace);
    let rb = workload_rolebinding(namespace, cfg);
    match rb_api.create(&PostParams::default(), &rb).await {
        Ok(_) => Ok(()),
        // Already provisioned on a previous deploy/teardown of this namespace.
        Err(kube::Error::Api(ae)) if ae.code == 409 => Ok(()),
        Err(e) => Err(RbacError::RoleBinding(e.to_string())),
    }
}

/// Ensure the target namespace exists and carries a RoleBinding granting
/// deployd's ServiceAccount the workloads ClusterRole. Idempotent: an
/// already-existing namespace or RoleBinding (HTTP 409) is treated as
/// success. A no-op (returns `Ok(())`) when `cfg.enabled` is false.
///
/// Must run BEFORE `helm upgrade --install` for the namespace so helm's
/// workload objects land with deployd already holding rights there under
/// scoped RBAC. Under the default cluster-wide fallback this is unnecessary
/// (hence opt-in).
pub async fn ensure_workload_rbac(
    namespace: &str,
    cfg: &SelfProvisionConfig,
) -> Result<(), RbacError> {
    if !cfg.enabled {
        return Ok(());
    }

    // Defense-in-depth: refuse to provision RBAC into a reserved / platform
    // namespace even if a caller reached here without validating (the chart's
    // `bind` grant is cluster-wide, so this pub entry point is a standing
    // privilege-escalation surface without the guard). `create_deployment`
    // already validates the request namespace up front; this is the backstop.
    if !is_valid_tenant_namespace(namespace) {
        return Err(RbacError::Namespace(format!(
            "refusing to self-provision RBAC in reserved or malformed namespace {namespace}"
        )));
    }

    let client = Client::try_default()
        .await
        .map_err(|e| RbacError::Client(e.to_string()))?;

    // 1. Ensure the namespace exists. deployd holds cluster-wide namespace
    //    create via `deployd-controller-namespaces`, so this works before
    //    the RoleBinding (which is namespace-scoped) can be created.
    if !namespace_exists(&client, namespace).await? {
        let ns_api: Api<Namespace> = Api::all(client.clone());
        let ns = Namespace {
            metadata: ObjectMeta {
                name: Some(namespace.to_string()),
                ..Default::default()
            },
            ..Default::default()
        };
        match ns_api.create(&PostParams::default(), &ns).await {
            Ok(_) => {}
            // Lost a create race with a concurrent deploy, which is fine.
            Err(kube::Error::Api(ae)) if ae.code == 409 => {}
            Err(e) => return Err(RbacError::Namespace(e.to_string())),
        }
    }

    // 2. Ensure the RoleBinding.
    create_workload_rolebinding(client, namespace, cfg).await
}

/// Teardown counterpart of [`ensure_workload_rbac`] (spec 225 FR-007). Ensures
/// deployd holds the workloads RoleBinding in an **already-existing** target
/// namespace so `helm uninstall` can remove that namespace's objects under
/// scoped RBAC, WITHOUT creating the namespace when it is already gone.
///
/// Why a separate function rather than reusing [`ensure_workload_rbac`]: the
/// deploy path creates the namespace on demand because a deploy needs it to
/// exist. A teardown must not. Recreating a namespace that has already been
/// deleted (then adding a RoleBinding to it) would orphan an empty namespace
/// plus RoleBinding, the exact leak this requirement closes.
///
/// The gap it closes: once the cluster-wide workloads fallback is dropped
/// (`rbac.selfProvision: true`), a namespace created before the flip and never
/// redeployed has no RoleBinding, so its `helm uninstall` fails `Forbidden`
/// and the delete handler swallows it best-effort, silently orphaning the
/// namespace's resources. Provisioning the RoleBinding here lets that first
/// delete tear the namespace down cleanly.
///
/// Semantics:
/// - `cfg.enabled == false` -> no-op `Ok(())` (cluster-wide fallback still in
///   force; deployd already has rights everywhere, nothing to provision).
/// - reserved / malformed namespace -> `Err(RbacError::Namespace)` (the
///   caller records it best-effort; no RoleBinding is written there).
/// - namespace absent -> `Ok(())` (nothing to tear down; do NOT create it).
/// - namespace present -> create the workloads RoleBinding (idempotent,
///   409-tolerant), identical to the deploy path.
pub async fn ensure_workload_rbac_for_teardown(
    namespace: &str,
    cfg: &SelfProvisionConfig,
) -> Result<(), RbacError> {
    if !cfg.enabled {
        return Ok(());
    }

    // Defense-in-depth: same reserved-namespace guard as the deploy entry
    // point. The delete path derives the namespace from the recorded column or
    // the `app_id-env_id` fallback and does not otherwise revalidate it, so a
    // legacy row resolving to e.g. `kube-system` must not get a RoleBinding.
    if !is_valid_tenant_namespace(namespace) {
        return Err(RbacError::Namespace(format!(
            "refusing to self-provision RBAC in reserved or malformed namespace {namespace}"
        )));
    }

    let client = Client::try_default()
        .await
        .map_err(|e| RbacError::Client(e.to_string()))?;

    // Only provision into an EXISTING namespace; never resurrect a namespace
    // that has already been torn down (that would create the very orphan this
    // path exists to prevent).
    if !namespace_exists(&client, namespace).await? {
        return Ok(());
    }

    create_workload_rolebinding(client, namespace, cfg).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> SelfProvisionConfig {
        SelfProvisionConfig {
            enabled: true,
            service_account: "deployd-api".to_string(),
            service_account_namespace: "deployd-system".to_string(),
            cluster_role: "deployd-controller-workloads".to_string(),
        }
    }

    #[test]
    fn from_env_defaults_disabled_with_sane_names() {
        let c = SelfProvisionConfig::from_var_lookup(|_| None);
        assert!(!c.enabled);
        assert_eq!(c.service_account, "deployd-api");
        assert_eq!(c.service_account_namespace, "deployd-system");
        assert_eq!(c.cluster_role, "deployd-controller-workloads");
    }

    #[test]
    fn from_env_enabled_only_on_true_or_one() {
        let map = |val: &str| {
            let owned = val.to_string();
            SelfProvisionConfig::from_var_lookup(move |k| {
                if k == "DEPLOYD_SELF_PROVISION_RBAC" {
                    Some(owned.clone())
                } else {
                    None
                }
            })
        };
        assert!(map("true").enabled);
        assert!(map("1").enabled);
        assert!(!map("false").enabled);
        assert!(!map("0").enabled);
        assert!(!map("yes").enabled);
        assert!(!map("").enabled);
    }

    #[test]
    fn from_env_overrides_names() {
        let c = SelfProvisionConfig::from_var_lookup(|k| match k {
            "DEPLOYD_SELF_PROVISION_RBAC" => Some("true".to_string()),
            "DEPLOYD_SERVICE_ACCOUNT" => Some("custom-sa".to_string()),
            "DEPLOYD_POD_NAMESPACE" => Some("custom-ns".to_string()),
            "DEPLOYD_WORKLOADS_CLUSTER_ROLE" => Some("custom-role".to_string()),
            _ => None,
        });
        assert!(c.enabled);
        assert_eq!(c.service_account, "custom-sa");
        assert_eq!(c.service_account_namespace, "custom-ns");
        assert_eq!(c.cluster_role, "custom-role");
    }

    #[test]
    fn rolebinding_references_clusterrole_and_binds_the_sa() {
        let rb = workload_rolebinding("tenant-acme-prod", &cfg());

        // Named after the ClusterRole, in the target namespace.
        assert_eq!(
            rb.metadata.name.as_deref(),
            Some("deployd-controller-workloads")
        );
        assert_eq!(rb.metadata.namespace.as_deref(), Some("tenant-acme-prod"));

        // roleRef points at the workloads ClusterRole.
        assert_eq!(rb.role_ref.kind, "ClusterRole");
        assert_eq!(rb.role_ref.name, "deployd-controller-workloads");
        assert_eq!(rb.role_ref.api_group, "rbac.authorization.k8s.io");

        // Subject is deployd's own ServiceAccount in its own namespace.
        let subjects = rb.subjects.expect("subjects present");
        assert_eq!(subjects.len(), 1);
        assert_eq!(subjects[0].kind, "ServiceAccount");
        assert_eq!(subjects[0].name, "deployd-api");
        assert_eq!(subjects[0].namespace.as_deref(), Some("deployd-system"));
    }

    #[tokio::test]
    async fn ensure_is_a_noop_when_disabled() {
        let mut c = cfg();
        c.enabled = false;
        // No kube client is built when disabled, so this succeeds with no
        // cluster reachable (proves the opt-in guard short-circuits first).
        assert!(ensure_workload_rbac("tenant-acme-prod", &c).await.is_ok());
    }

    #[tokio::test]
    async fn teardown_ensure_is_a_noop_when_disabled() {
        let mut c = cfg();
        c.enabled = false;
        // Same opt-in guard as the deploy path: disabled short-circuits before
        // any kube client is built, so the teardown self-provision is inert
        // under the cluster-wide fallback (no cluster reachable, still Ok).
        assert!(ensure_workload_rbac_for_teardown("tenant-acme-prod", &c)
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn teardown_ensure_rejects_reserved_namespace_when_enabled() {
        // Defense-in-depth guard fires before any kube client is built, so a
        // reserved namespace is rejected without a cluster: enabled + reserved
        // -> Err, never a RoleBinding write into e.g. kube-system.
        let c = cfg(); // enabled = true
        let err = ensure_workload_rbac_for_teardown("kube-system", &c)
            .await
            .expect_err("reserved namespace must be rejected");
        assert!(matches!(err, RbacError::Namespace(_)));
    }

    #[test]
    fn is_valid_tenant_namespace_accepts_well_formed_names() {
        assert!(is_valid_tenant_namespace("acme-p-dev"));
        assert!(is_valid_tenant_namespace("app123-env1"));
        assert!(is_valid_tenant_namespace("a"));
        // Exactly 63 chars is the max DNS-1123 label length: accepted. Guards
        // the `> 63` boundary against an off-by-one drift to `>= 63`.
        assert!(is_valid_tenant_namespace(&"a".repeat(63)));
    }

    #[test]
    fn is_valid_tenant_namespace_rejects_reserved_names() {
        assert!(!is_valid_tenant_namespace("kube-system"));
        assert!(!is_valid_tenant_namespace("kube-public"));
        assert!(!is_valid_tenant_namespace("kube-node-lease"));
        assert!(!is_valid_tenant_namespace("default"));
        assert!(!is_valid_tenant_namespace("deployd-system"));
    }

    #[test]
    fn is_valid_tenant_namespace_rejects_platform_namespaces() {
        // A deploy-scope holder must not be able to target the platform's
        // own namespaces by setting `namespace` on the request body.
        assert!(!is_valid_tenant_namespace("rauthy-system"));
        assert!(!is_valid_tenant_namespace("statecraft-system"));
        assert!(!is_valid_tenant_namespace("monitoring"));
        assert!(!is_valid_tenant_namespace("ingress-nginx"));
        assert!(!is_valid_tenant_namespace("flux-system"));
        assert!(!is_valid_tenant_namespace("kube-flannel"));
        assert!(!is_valid_tenant_namespace("cert-manager"));
        assert!(!is_valid_tenant_namespace("external-secrets"));
    }

    #[test]
    fn is_valid_tenant_namespace_rejects_malformed_names() {
        assert!(!is_valid_tenant_namespace(""));
        assert!(!is_valid_tenant_namespace("-leading-dash"));
        assert!(!is_valid_tenant_namespace("trailing-dash-"));
        assert!(!is_valid_tenant_namespace("Has-Upper-Case"));
        assert!(!is_valid_tenant_namespace("has_underscore"));
        assert!(!is_valid_tenant_namespace("has.dot"));
        assert!(!is_valid_tenant_namespace("has/slash"));
        assert!(!is_valid_tenant_namespace(&"a".repeat(64)));
    }
}
