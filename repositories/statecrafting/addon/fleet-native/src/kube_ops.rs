//! Live-cluster operations over kube-rs. Gated behind the `node` feature (needs
//! tokio + a reachable cluster). Reuses the deployd-api-rs `rbac.rs` patterns
//! (statecraft spec 006 §1): `Client::try_default` resolution and create-or-tolerate-409
//! idempotency. Rollout waiting and status reading are written fresh (deployd
//! delegated those to `helm --wait`).

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use k8s_openapi::api::apps::v1::Deployment;
use k8s_openapi::api::batch::v1::Job;
use k8s_openapi::api::core::v1::{Namespace, PersistentVolumeClaim, Service};
use k8s_openapi::api::networking::v1::{Ingress, NetworkPolicy};
use kube::api::{DeleteParams, Patch, PatchParams, PostParams};
use kube::config::{KubeConfigOptions, Kubeconfig};
use kube::{Api, Client, Config};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::json;

use crate::naming;
use crate::resources;
use crate::types::{AppStatus, BackupResult, BackupTarget, DeploySpec, RemoveResult};

const ROLLOUT_TIMEOUT: Duration = Duration::from_secs(180);
const BACKUP_TIMEOUT: Duration = Duration::from_secs(600);
const POLL_INTERVAL: Duration = Duration::from_secs(3);

type OpResult<T> = Result<T, String>;

/// Resolve a client from `FLEET_KUBECONFIG_PATH` when set, else kube-rs defaults
/// (in-cluster, then `KUBECONFIG` / `~/.kube/config`). Kubeconfig stays entirely
/// Rust-side (statecraft spec 006 §2); the TS layer never opens the file.
async fn make_client() -> OpResult<Client> {
    if let Some(path) = std::env::var_os("FLEET_KUBECONFIG_PATH") {
        let path = path.to_string_lossy().to_string();
        if !path.is_empty() {
            let kc = Kubeconfig::read_from(&path)
                .map_err(|e| format!("read kubeconfig {path}: {e}"))?;
            let config = Config::from_custom_kubeconfig(kc, &KubeConfigOptions::default())
                .await
                .map_err(|e| format!("load kubeconfig {path}: {e}"))?;
            return Client::try_from(config).map_err(|e| format!("kube client: {e}"));
        }
    }
    Client::try_default()
        .await
        .map_err(|e| format!("kube client: {e}"))
}

fn validate(spec: &DeploySpec) -> OpResult<()> {
    if !naming::is_valid_namespace(&spec.namespace) {
        return Err(format!(
            "refusing reserved or malformed namespace {}",
            spec.namespace
        ));
    }
    if !naming::is_valid_name(&spec.name) {
        return Err(format!("invalid app name {}", spec.name));
    }
    Ok(())
}

/// `create()` tolerating an already-present object (HTTP 409), mirroring
/// `rbac.rs::create_workload_rolebinding`.
async fn ensure<K>(api: &Api<K>, obj: &K, what: &str) -> OpResult<()>
where
    K: Clone + DeserializeOwned + std::fmt::Debug + Serialize,
{
    match api.create(&PostParams::default(), obj).await {
        Ok(_) => Ok(()),
        Err(kube::Error::Api(ae)) if ae.code == 409 => Ok(()),
        Err(e) => Err(format!("create {what}: {e}")),
    }
}

/// `delete()` tolerating an already-absent object (HTTP 404).
async fn delete_ignore_404<K>(
    api: &Api<K>,
    name: &str,
    what: &str,
) -> OpResult<()>
where
    K: Clone + DeserializeOwned + std::fmt::Debug,
{
    match api.delete(name, &DeleteParams::default()).await {
        Ok(_) => Ok(()),
        Err(kube::Error::Api(ae)) if ae.code == 404 => Ok(()),
        Err(e) => Err(format!("delete {what} {name}: {e}")),
    }
}

/// Place the full EnRaHiTu shape for an app and wait for the Deployment to roll
/// out. Idempotent: re-placing an existing app reconciles its image.
pub async fn place_app(spec: &DeploySpec) -> OpResult<AppStatus> {
    validate(spec)?;
    let client = make_client().await?;
    let ns = &spec.namespace;

    let ns_api: Api<Namespace> = Api::all(client.clone());
    ensure(&ns_api, &resources::namespace(ns), "namespace").await?;

    let pvc_api: Api<PersistentVolumeClaim> = Api::namespaced(client.clone(), ns);
    ensure(&pvc_api, &resources::pvc(spec), "pvc").await?;

    let np_api: Api<NetworkPolicy> = Api::namespaced(client.clone(), ns);
    for np in resources::network_policies(spec) {
        ensure(&np_api, &np, "networkpolicy").await?;
    }

    let svc_api: Api<Service> = Api::namespaced(client.clone(), ns);
    ensure(&svc_api, &resources::service(spec), "service").await?;

    let ing_api: Api<Ingress> = Api::namespaced(client.clone(), ns);
    ensure(&ing_api, &resources::ingress(spec), "ingress").await?;

    let deploy_api: Api<Deployment> = Api::namespaced(client.clone(), ns);
    match deploy_api
        .create(&PostParams::default(), &resources::deployment(spec))
        .await
    {
        Ok(_) => {}
        // Already placed: reconcile the image (idempotent placement).
        Err(kube::Error::Api(ae)) if ae.code == 409 => {
            patch_image(&deploy_api, &spec.name, &spec.image).await?;
        }
        Err(e) => return Err(format!("create deployment: {e}")),
    }

    wait_rollout(&deploy_api, &spec.name).await?;
    let dep = deploy_api
        .get(&spec.name)
        .await
        .map_err(|e| format!("get deployment: {e}"))?;
    Ok(to_status(&dep, &spec.name, ns, spec.host.clone()))
}

/// Change an app's image (Recreate rollout), wait for ready or fail.
pub async fn update_app(spec: &DeploySpec) -> OpResult<AppStatus> {
    validate(spec)?;
    let client = make_client().await?;
    let ns = &spec.namespace;
    let deploy_api: Api<Deployment> = Api::namespaced(client.clone(), ns);

    if deploy_api
        .get_opt(&spec.name)
        .await
        .map_err(|e| format!("get deployment: {e}"))?
        .is_none()
    {
        return Err(format!("app {} not found in {}", spec.name, ns));
    }

    patch_image(&deploy_api, &spec.name, &spec.image).await?;
    wait_rollout(&deploy_api, &spec.name).await?;
    let dep = deploy_api
        .get(&spec.name)
        .await
        .map_err(|e| format!("get deployment: {e}"))?;
    Ok(to_status(&dep, &spec.name, ns, spec.host.clone()))
}

/// Read the live status of a placed app (Deployment + Ingress host).
pub async fn app_status(name: &str, namespace: &str) -> OpResult<AppStatus> {
    let client = make_client().await?;
    let deploy_api: Api<Deployment> = Api::namespaced(client.clone(), namespace);
    let dep = deploy_api
        .get(name)
        .await
        .map_err(|e| format!("get deployment: {e}"))?;
    let host = read_host(&client, namespace, name).await;
    Ok(to_status(&dep, name, namespace, host))
}

/// Scale the app to 0, restic `/data` to the target, scale back to 1. The
/// scale-down is what makes the snapshot clean-shutdown-consistent and frees the
/// RWO volume for the Job to mount (statecraft spec 006 §3).
pub async fn backup_app(
    name: &str,
    namespace: &str,
    target: &BackupTarget,
) -> OpResult<BackupResult> {
    if !naming::is_valid_namespace(namespace) {
        return Err(format!("refusing reserved or malformed namespace {namespace}"));
    }
    let client = make_client().await?;
    let deploy_api: Api<Deployment> = Api::namespaced(client.clone(), namespace);
    if deploy_api
        .get_opt(name)
        .await
        .map_err(|e| format!("get deployment: {e}"))?
        .is_none()
    {
        return Err(format!("app {name} not found in {namespace}"));
    }

    scale(&deploy_api, name, 0).await?;
    wait_scaled_down(&deploy_api, name).await?;

    let stamp = timestamp();
    let job_name = naming::backup_job_name(name, &stamp);
    let repository = resources::backup_repository(target, namespace, name);
    let tag = format!("{name}-{stamp}");
    let job = resources::backup_job(name, namespace, target, &repository, &tag, &job_name);
    let job_api: Api<Job> = Api::namespaced(client.clone(), namespace);
    let backup = run_backup_job(&job_api, &job, &job_name).await;

    // Always restore service, even if the backup failed.
    let _ = scale(&deploy_api, name, 1).await;
    let _ = wait_rollout(&deploy_api, name).await;

    backup?;
    Ok(BackupResult {
        repository,
        tag,
        job_name,
        snapshot_id: None,
    })
}

/// Delete an app's per-app resources, including its ingress-allow
/// NetworkPolicy. The tenant Namespace and the namespace-scoped baseline
/// policies (default-deny, egress) are shared across the tenant's apps, so
/// they are left in place (a last-app namespace GC is a follow-up).
pub async fn remove_app(name: &str, namespace: &str) -> OpResult<RemoveResult> {
    if !naming::is_valid_namespace(namespace) {
        return Err(format!("refusing reserved or malformed namespace {namespace}"));
    }
    let client = make_client().await?;

    let deploy_api: Api<Deployment> = Api::namespaced(client.clone(), namespace);
    delete_ignore_404(&deploy_api, name, "deployment").await?;

    let np_api: Api<NetworkPolicy> = Api::namespaced(client.clone(), namespace);
    delete_ignore_404(&np_api, &naming::ingress_policy_name(name), "networkpolicy").await?;

    let svc_api: Api<Service> = Api::namespaced(client.clone(), namespace);
    delete_ignore_404(&svc_api, name, "service").await?;

    let ing_api: Api<Ingress> = Api::namespaced(client.clone(), namespace);
    delete_ignore_404(&ing_api, name, "ingress").await?;

    let pvc_api: Api<PersistentVolumeClaim> = Api::namespaced(client.clone(), namespace);
    delete_ignore_404(&pvc_api, &naming::pvc_name(name), "pvc").await?;

    Ok(RemoveResult {
        name: name.to_string(),
        namespace: namespace.to_string(),
        removed: true,
    })
}

async fn patch_image(api: &Api<Deployment>, name: &str, image: &str) -> OpResult<()> {
    // Strategic merge keyed on the container name (== app name) so only the
    // image changes; the rest of the pod spec is preserved.
    let patch = json!({
        "spec": { "template": { "spec": { "containers": [ { "name": name, "image": image } ] } } }
    });
    api.patch(name, &PatchParams::default(), &Patch::Strategic(&patch))
        .await
        .map(|_| ())
        .map_err(|e| format!("patch deployment image: {e}"))
}

async fn scale(api: &Api<Deployment>, name: &str, replicas: i32) -> OpResult<()> {
    let patch = json!({ "spec": { "replicas": replicas } });
    api.patch(name, &PatchParams::default(), &Patch::Merge(&patch))
        .await
        .map(|_| ())
        .map_err(|e| format!("scale {name} to {replicas}: {e}"))
}

async fn read_host(client: &Client, namespace: &str, name: &str) -> String {
    let ing_api: Api<Ingress> = Api::namespaced(client.clone(), namespace);
    ing_api
        .get_opt(name)
        .await
        .ok()
        .flatten()
        .and_then(|i| i.spec)
        .and_then(|s| s.rules)
        .and_then(|rules| rules.into_iter().next())
        .and_then(|r| r.host)
        .unwrap_or_default()
}

fn is_ready(dep: &Deployment) -> bool {
    let want = dep.spec.as_ref().and_then(|s| s.replicas).unwrap_or(1);
    if want < 1 {
        return false;
    }
    let st = match dep.status.as_ref() {
        Some(s) => s,
        None => return false,
    };
    let generation = dep.metadata.generation.unwrap_or(0);
    st.observed_generation.unwrap_or(0) >= generation
        && st.available_replicas.unwrap_or(0) >= want
        && st.updated_replicas.unwrap_or(0) >= want
}

fn failure_message(dep: &Deployment) -> Option<String> {
    let conds = dep.status.as_ref()?.conditions.as_ref()?;
    conds
        .iter()
        .find(|c| c.type_ == "Progressing" && c.status == "False")
        .map(|c| {
            c.message
                .clone()
                .or_else(|| c.reason.clone())
                .unwrap_or_else(|| "progress deadline exceeded".to_string())
        })
}

fn to_status(dep: &Deployment, name: &str, ns: &str, host: String) -> AppStatus {
    let available = dep
        .status
        .as_ref()
        .and_then(|s| s.available_replicas)
        .unwrap_or(0);
    let image = dep
        .spec
        .as_ref()
        .and_then(|s| s.template.spec.as_ref())
        .and_then(|p| p.containers.first())
        .and_then(|c| c.image.clone())
        .unwrap_or_default();
    let (status, message) = if is_ready(dep) {
        ("running".to_string(), None)
    } else if let Some(msg) = failure_message(dep) {
        ("failed".to_string(), Some(msg))
    } else {
        ("updating".to_string(), None)
    };
    AppStatus {
        name: name.to_string(),
        namespace: ns.to_string(),
        status,
        host,
        image,
        available_replicas: available,
        message,
    }
}

async fn wait_rollout(api: &Api<Deployment>, name: &str) -> OpResult<()> {
    let start = Instant::now();
    loop {
        let dep = api
            .get(name)
            .await
            .map_err(|e| format!("get deployment: {e}"))?;
        if is_ready(&dep) {
            return Ok(());
        }
        if let Some(msg) = failure_message(&dep) {
            return Err(format!("rollout of {name} failed: {msg}"));
        }
        if start.elapsed() > ROLLOUT_TIMEOUT {
            return Err(format!(
                "rollout of {name} did not become ready within {}s",
                ROLLOUT_TIMEOUT.as_secs()
            ));
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

async fn wait_scaled_down(api: &Api<Deployment>, name: &str) -> OpResult<()> {
    let start = Instant::now();
    loop {
        let dep = api
            .get(name)
            .await
            .map_err(|e| format!("get deployment: {e}"))?;
        let replicas = dep.status.as_ref().and_then(|s| s.replicas).unwrap_or(0);
        let available = dep
            .status
            .as_ref()
            .and_then(|s| s.available_replicas)
            .unwrap_or(0);
        if replicas == 0 && available == 0 {
            return Ok(());
        }
        if start.elapsed() > ROLLOUT_TIMEOUT {
            return Err(format!("scale-down of {name} timed out"));
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

async fn run_backup_job(api: &Api<Job>, job: &Job, job_name: &str) -> OpResult<()> {
    match api.create(&PostParams::default(), job).await {
        Ok(_) => {}
        Err(kube::Error::Api(ae)) if ae.code == 409 => {}
        Err(e) => return Err(format!("create backup job: {e}")),
    }
    let start = Instant::now();
    loop {
        let j = api
            .get(job_name)
            .await
            .map_err(|e| format!("get backup job: {e}"))?;
        if let Some(st) = j.status.as_ref() {
            if st.succeeded.unwrap_or(0) >= 1 {
                return Ok(());
            }
            if st.failed.unwrap_or(0) >= 1 {
                return Err(format!("backup job {job_name} failed"));
            }
        }
        if start.elapsed() > BACKUP_TIMEOUT {
            return Err(format!("backup job {job_name} timed out"));
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

fn timestamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}
