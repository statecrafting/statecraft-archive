//! Cluster-connectivity probe. Spec 136 Phase 2.b moved the deploy /
//! destroy lifecycle to `helm.rs`; this module now only answers
//! "is a Kubernetes cluster reachable?" so routes.rs can fall back to
//! record-only mode for local dev when no kubeconfig / in-cluster
//! config is present.

use kube::Client;

#[derive(Debug)]
pub enum K8sError {
    NoCluster(String),
}

impl std::fmt::Display for K8sError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            K8sError::NoCluster(msg) => write!(f, "no K8s cluster: {msg}"),
        }
    }
}

/// Returns `Ok(())` when a default kubeconfig (or in-cluster config) is
/// reachable. The probe builds a Client but discards it — actual Helm
/// invocations resolve credentials from the active kubeconfig context
/// themselves.
pub async fn probe_cluster() -> Result<(), K8sError> {
    Client::try_default()
        .await
        .map(|_| ())
        .map_err(|e| K8sError::NoCluster(e.to_string()))
}
