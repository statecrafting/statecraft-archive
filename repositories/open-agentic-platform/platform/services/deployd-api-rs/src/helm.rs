//! Helm-driven deploy/destroy. Spec 136 Phase 2.b replaces the kube-rs
//! raw-object construction with `helm upgrade --install --wait` against
//! charts embedded into the binary at compile time, so the deployd-api
//! image ships the charts it deploys — no out-of-band chart registry,
//! no Docker build-context refactor.
//!
//! The runtime model is small:
//!   * `HelmRunner::from_env()` reads `DEPLOYD_HELM_BIN` and
//!     `DEPLOYD_HELM_TIMEOUT`. The chart bytes live in this module via
//!     `include_str!`.
//!   * `prepare_chart(name)` materialises the requested chart into a
//!     per-runner temp dir (cached after the first call) and returns
//!     the path that `helm` will be pointed at.
//!   * `install` / `uninstall` / `template` shell out to `helm` with a
//!     JSON values file (helm accepts JSON since JSON is valid YAML).
//!
//! `template` is the test seam: it executes `helm template` against the
//! embedded chart without touching a cluster, which is what the unit
//! tests assert against. Spec 136 Phase 3 (negative-path validation
//! against a live cluster) remains a follow-up.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

// ---------------------------------------------------------------------------
// Embedded chart bytes. New charts register here by mirroring the const
// block + the materialiser arm in `write_chart`.
// ---------------------------------------------------------------------------

// Spec 214: acme-vue-encore reference chart (the template scaffold
// shape) is the sole tenant shape. Spec 214 Stage 2 retired the synthetic
// reference that spec 136 shipped, leaving this as the only registered
// tenant chart. The eight consts mirror the chart directory; the materialiser
// arm lives in `write_chart`.
const ACME_VUE_ENCORE_CHART_YAML: &str =
    include_str!("../../../charts/acme-vue-encore/Chart.yaml");
const ACME_VUE_ENCORE_VALUES_YAML: &str =
    include_str!("../../../charts/acme-vue-encore/values.yaml");
const ACME_VUE_ENCORE_HELPERS_TPL: &str =
    include_str!("../../../charts/acme-vue-encore/templates/_helpers.tpl");
const ACME_VUE_ENCORE_DEPLOYMENT_YAML: &str =
    include_str!("../../../charts/acme-vue-encore/templates/deployment.yaml");
const ACME_VUE_ENCORE_SERVICE_YAML: &str =
    include_str!("../../../charts/acme-vue-encore/templates/service.yaml");
const ACME_VUE_ENCORE_INGRESS_YAML: &str =
    include_str!("../../../charts/acme-vue-encore/templates/ingress.yaml");
const ACME_VUE_ENCORE_SA_YAML: &str =
    include_str!("../../../charts/acme-vue-encore/templates/serviceaccount.yaml");
const ACME_VUE_ENCORE_POSTGRES_YAML: &str =
    include_str!("../../../charts/acme-vue-encore/templates/postgres.yaml");
// Spec 227 FR-005: opt-in preview-grade Redis (the previewDatabase mirror).
const ACME_VUE_ENCORE_REDIS_YAML: &str =
    include_str!("../../../charts/acme-vue-encore/templates/redis.yaml");

// region: gate-overlay
// Spec 137 — oauth2-proxy-gate chart (per-environment passwordless OIDC gate).
const OAUTH2_PROXY_GATE_CHART_YAML: &str =
    include_str!("../../../charts/oauth2-proxy-gate/Chart.yaml");
const OAUTH2_PROXY_GATE_VALUES_YAML: &str =
    include_str!("../../../charts/oauth2-proxy-gate/values.yaml");
const OAUTH2_PROXY_GATE_HELPERS_TPL: &str =
    include_str!("../../../charts/oauth2-proxy-gate/templates/_helpers.tpl");
const OAUTH2_PROXY_GATE_DEPLOYMENT_YAML: &str =
    include_str!("../../../charts/oauth2-proxy-gate/templates/deployment.yaml");
const OAUTH2_PROXY_GATE_SERVICE_YAML: &str =
    include_str!("../../../charts/oauth2-proxy-gate/templates/service.yaml");
const OAUTH2_PROXY_GATE_INGRESS_YAML: &str =
    include_str!("../../../charts/oauth2-proxy-gate/templates/ingress.yaml");
const OAUTH2_PROXY_GATE_SECRET_YAML: &str =
    include_str!("../../../charts/oauth2-proxy-gate/templates/secret.yaml");
const OAUTH2_PROXY_GATE_CONFIGMAP_YAML: &str =
    include_str!("../../../charts/oauth2-proxy-gate/templates/configmap.yaml");
const OAUTH2_PROXY_GATE_SA_YAML: &str =
    include_str!("../../../charts/oauth2-proxy-gate/templates/serviceaccount.yaml");
// endregion gate-overlay

#[derive(Debug)]
pub enum HelmError {
    /// Requested chart is not embedded in this binary.
    UnknownChart(String),
    /// Helm binary failed to spawn (not installed, not executable).
    BinarySpawn(String),
    /// Helm sub-command exited non-zero. `stderr` is the captured tail.
    Invocation {
        stage: &'static str,
        code: Option<i32>,
        stderr: String,
    },
    /// JSON / filesystem step around the helm call failed.
    Io(String),
}

impl std::fmt::Display for HelmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HelmError::UnknownChart(c) => write!(f, "unknown chart: {c}"),
            HelmError::BinarySpawn(m) => write!(f, "helm binary spawn failed: {m}"),
            HelmError::Invocation {
                stage,
                code,
                stderr,
            } => write!(f, "{stage} exited code={code:?}: {stderr}"),
            HelmError::Io(m) => write!(f, "helm io: {m}"),
        }
    }
}

impl std::error::Error for HelmError {}

/// Inputs to a Helm install. `values` is JSON; helm accepts JSON
/// values files because JSON is a strict subset of YAML.
pub struct InstallRequest {
    pub chart: String,
    pub namespace: String,
    pub release: String,
    pub values: Value,
}

#[derive(Debug, PartialEq, Eq)]
pub struct InstallResult {
    pub release: String,
    pub namespace: String,
    pub revision: u32,
    pub status: String,
}

pub struct HelmRunner {
    bin: OsString,
    timeout: String,
    chart_cache: OnceLock<PathBuf>,
}

impl HelmRunner {
    pub fn from_env() -> Self {
        let bin = std::env::var_os("DEPLOYD_HELM_BIN").unwrap_or_else(|| OsString::from("helm"));
        // `create_deployment` shells helm synchronously and only responds to
        // statecraft once `helm upgrade --install --wait` returns. statecraft's
        // fetch inherits undici's 300s headers timeout, so a `--wait` that runs
        // to ~300s (the old "5m" default) races that timeout: when undici loses
        // the coin-flip, statecraft records an opaque REQUEST_FAILED "fetch
        // failed" instead of deployd's real FAILED + helm stderr (e.g. an
        // ImagePullBackOff that will never become Ready). Default the wait below
        // 300s so deployd always wins the race and the actionable helm error
        // surfaces. Operators can still override via DEPLOYD_HELM_TIMEOUT.
        let timeout = std::env::var("DEPLOYD_HELM_TIMEOUT").unwrap_or_else(|_| "3m".into());
        Self {
            bin,
            timeout,
            chart_cache: OnceLock::new(),
        }
    }

    /// Returns the materialised path of an embedded chart, writing it
    /// to a per-runner temp dir on first request. Subsequent calls reuse
    /// the same dir.
    pub fn prepare_chart(&self, name: &str) -> Result<PathBuf, HelmError> {
        let root = self
            .chart_cache
            .get_or_init(|| {
                let dir = std::env::temp_dir().join(format!(
                    "deployd-charts-{}",
                    std::process::id(),
                ));
                let _ = fs::create_dir_all(&dir);
                dir
            })
            .clone();
        let chart_dir = root.join(name);
        if chart_dir.join("Chart.yaml").exists() {
            return Ok(chart_dir);
        }
        write_chart(name, &chart_dir)?;
        Ok(chart_dir)
    }

    /// `helm upgrade --install --create-namespace --wait --output json`.
    pub fn install(&self, req: &InstallRequest) -> Result<InstallResult, HelmError> {
        let chart_dir = self.prepare_chart(&req.chart)?;
        let values_path = write_values_file(&req.values)?;

        let output = Command::new(&self.bin)
            .args([
                "upgrade",
                "--install",
                "--create-namespace",
                "-n",
                &req.namespace,
                &req.release,
                chart_dir.to_str().ok_or_else(|| {
                    HelmError::Io("chart dir path is not valid utf-8".into())
                })?,
                "-f",
                values_path.to_str().ok_or_else(|| {
                    HelmError::Io("values file path is not valid utf-8".into())
                })?,
                "--wait",
                "--timeout",
                &self.timeout,
                "--output",
                "json",
            ])
            .output()
            .map_err(|e| HelmError::BinarySpawn(e.to_string()))?;

        let _ = fs::remove_file(&values_path);

        if !output.status.success() {
            return Err(HelmError::Invocation {
                stage: "helm upgrade --install",
                code: output.status.code(),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            });
        }

        let release_info: Value = serde_json::from_slice(&output.stdout)
            .map_err(|e| HelmError::Io(format!("parse helm output JSON: {e}")))?;
        let status = release_info
            .pointer("/info/status")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let revision = release_info
            .get("version")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;

        Ok(InstallResult {
            release: req.release.clone(),
            namespace: req.namespace.clone(),
            revision,
            status,
        })
    }

    /// `helm uninstall --wait`. Treats "release not found" as success
    /// so deletes are idempotent against rolled-back deploys.
    pub fn uninstall(&self, namespace: &str, release: &str) -> Result<(), HelmError> {
        let output = Command::new(&self.bin)
            .args([
                "uninstall",
                "-n",
                namespace,
                release,
                "--wait",
                "--timeout",
                &self.timeout,
            ])
            .output()
            .map_err(|e| HelmError::BinarySpawn(e.to_string()))?;

        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("not found") {
            return Ok(());
        }
        Err(HelmError::Invocation {
            stage: "helm uninstall",
            code: output.status.code(),
            stderr: stderr.into_owned(),
        })
    }

    /// Spec 137 — atomic dual-release install: tenant chart + per-environment
    /// oauth2-proxy gate. Implements FR-003's "all three created atomically;
    /// partial-success states roll back" by installing the tenant first and
    /// then the gate. If the gate install fails, the tenant is rolled back so
    /// callers never observe a tenant exposed without its declared gate.
    ///
    /// `tenant_req.values` MUST already carry the gate-side annotations
    /// (`gate.enabled` / `gate.proxyServiceName`) — those come from
    /// [`build_values`] with a non-`None` descriptor.
    pub fn install_with_gate(
        &self,
        tenant_req: &InstallRequest,
        gate_chart: &str,
        gate_values: Value,
    ) -> Result<InstallResult, HelmError> {
        let tenant_result = self.install(tenant_req)?;
        let gate_req = InstallRequest {
            chart: gate_chart.to_string(),
            namespace: tenant_req.namespace.clone(),
            release: gate_release_name(&tenant_req.release),
            values: gate_values,
        };
        match self.install(&gate_req) {
            Ok(_) => Ok(tenant_result),
            Err(gate_err) => {
                // Roll back tenant on gate failure. Best-effort uninstall —
                // surface the original gate error regardless of uninstall
                // outcome since that's the load-bearing diagnostic for the
                // operator. The leak risk is bounded: a partial tenant
                // release without its gate is the exact state FR-003 forbids,
                // so we attempt cleanup before surfacing.
                let _ = self.uninstall(&tenant_req.namespace, &tenant_req.release);
                Err(gate_err)
            }
        }
    }

    /// Spec 137 — paired uninstall. Removes the gate release first so the
    /// tenant doesn't briefly remain exposed without its declared gate, then
    /// the tenant. Both halves are "release not found"-tolerant (per
    /// [`Self::uninstall`]) so retried deletes are idempotent.
    pub fn uninstall_with_gate(
        &self,
        namespace: &str,
        tenant_release: &str,
    ) -> Result<(), HelmError> {
        let gate = gate_release_name(tenant_release);
        self.uninstall(namespace, &gate)?;
        self.uninstall(namespace, tenant_release)
    }

    /// Run `helm template` against an embedded chart. Used by tests as a
    /// pure-render smoke that never touches a cluster.
    #[allow(dead_code)]
    pub fn template(&self, req: &InstallRequest) -> Result<String, HelmError> {
        let chart_dir = self.prepare_chart(&req.chart)?;
        let values_path = write_values_file(&req.values)?;

        let output = Command::new(&self.bin)
            .args([
                "template",
                &req.release,
                chart_dir.to_str().ok_or_else(|| {
                    HelmError::Io("chart dir path is not valid utf-8".into())
                })?,
                "-n",
                &req.namespace,
                "-f",
                values_path.to_str().ok_or_else(|| {
                    HelmError::Io("values file path is not valid utf-8".into())
                })?,
            ])
            .output()
            .map_err(|e| HelmError::BinarySpawn(e.to_string()))?;

        let _ = fs::remove_file(&values_path);

        if !output.status.success() {
            return Err(HelmError::Invocation {
                stage: "helm template",
                code: output.status.code(),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            });
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }
}

/// Optional dispatch-contract inputs (spec 214) threaded into chart values
/// beyond the core image/route/gate set. Every field defaults to "absent" so
/// the base deploy path and tests that pass `&DeployExtras::default()` are
/// unaffected.
#[derive(Default)]
pub struct DeployExtras<'a> {
    /// FR-004: `config_refs` entries rendered as plain container env vars via
    /// the chart's `extraEnv`. A `BTreeMap` so the rendered order is stable
    /// (key-sorted) across dispatches. Reserved-prefix rejection
    /// (`ENCORE_` / `KUBERNETES_`) happens at the statecraft proxy, not here.
    pub config_refs: Option<&'a std::collections::BTreeMap<String, String>>,
    /// FR-005: name of the dockerconfigjson pull secret reflected into the
    /// namespace (default `ghcr-pull`). Rendered as
    /// `imagePullSecrets: [{name}]` when set and non-empty.
    pub image_pull_secret_name: Option<&'a str>,
    /// User Story 1: the reflected wildcard TLS secret name
    /// (`tenants-wildcard-tls`). Enables `ingress.tls` when an ingress route
    /// is also present.
    pub tls_secret_name: Option<&'a str>,
    /// FR-006: when true, render the chart's opt-in preview-grade Postgres
    /// (`previewDatabase.enabled: true`) so an Encore tenant with a
    /// `SQLDatabase` boots against an in-namespace database instead of
    /// crashing on an unresolved connection. Statecraft sets this for
    /// development/preview environments; production tenants supply an
    /// external DSN instead (not auto-provisioned here).
    pub preview_database: bool,
    /// Spec 227 FR-005: when true, render the chart's opt-in preview-grade
    /// Redis (`previewRedis.enabled: true`), mirroring `preview_database`, so
    /// a tenant whose baked infra.config.json declares a `redis` block boots
    /// against an in-namespace cache. Development/preview only; non-dev
    /// environments supply an external Redis endpoint as runtime env instead.
    pub preview_redis: bool,
}

/// Translate a DeploymentRequest's fields into a values JSON the chart
/// understands. Pure function: no I/O, no helm dependency.
///
/// Mapping:
///   * `image.repository` / `image.tag` derive from `artifact_ref`
///     splitting on the rightmost `:`. An `artifact_ref` with no `:`
///     is treated as repository only with tag `latest`.
///   * `fullnameOverride` defaults to the release name so resources
///     get predictable, slug-driven names.
///   * `ingress` enables when at least one route is supplied, taking
///     the first route's host. The chart's path is hardcoded `/`.
///     When `extras.tls_secret_name` is set, `ingress.tls` terminates
///     with the reflected wildcard secret (spec 214 User Story 1).
///   * `gate.enabled` / `gate.proxyServiceName` are populated when a
///     non-`None` [`AccessGateDescriptor`] is supplied. The proxy
///     service name is derived deterministically from the tenant
///     release name (see [`gate_release_name`]) so the tenant Ingress
///     and the gate Service resolve to a matching pair at install
///     time. The tenant `Ingress` template renders the
///     `nginx.ingress.kubernetes.io/auth-url` annotation accordingly.
///   * `imagePullSecrets` / `extraEnv` come from [`DeployExtras`]
///     (spec 214 FR-005 / FR-004).
pub fn build_values(
    artifact_ref: &str,
    fullname_override: &str,
    routes: &[(String, String)],
    gate: Option<&AccessGateDescriptor>,
    extras: &DeployExtras<'_>,
) -> Value {
    let (repository, tag) = split_artifact_ref(artifact_ref);
    let mut values = serde_json::json!({
        "image": {
            "repository": repository,
            "tag": tag,
        },
        "fullnameOverride": fullname_override,
    });
    if let Some((host, _path)) = routes.first() {
        let mut ingress = serde_json::json!({
            "enabled": true,
            "host": host,
        });
        // Spec 214 User Story 1: terminate TLS with the reflected wildcard
        // secret when the cluster has one configured for tenant ingresses.
        if let Some(secret) = extras.tls_secret_name.filter(|s| !s.is_empty()) {
            ingress["tls"] = serde_json::json!({
                "enabled": true,
                "secretName": secret,
            });
        }
        values["ingress"] = ingress;
    }
    if let Some(g) = gate.filter(|g| g.enabled) {
        values["gate"] = serde_json::json!({
            "enabled": true,
            "proxyServiceName": gate_release_name(fullname_override),
            "proxyServicePort": g.proxy_service_port(),
        });
    }
    // Spec 214 FR-005: private-registry pull secret.
    if let Some(secret) = extras.image_pull_secret_name.filter(|s| !s.is_empty()) {
        values["imagePullSecrets"] = serde_json::json!([{ "name": secret }]);
    }
    // Spec 214 FR-004: config_refs become plain container env vars. BTreeMap
    // iteration is key-sorted, so the rendered extraEnv order is deterministic.
    if let Some(refs) = extras.config_refs.filter(|m| !m.is_empty()) {
        let extra_env: Vec<Value> = refs
            .iter()
            .map(|(name, value)| serde_json::json!({ "name": name, "value": value }))
            .collect();
        values["extraEnv"] = Value::Array(extra_env);
    }
    // Spec 214 FR-006: opt-in preview-grade Postgres. When enabled, the chart
    // renders a single-replica Postgres StatefulSet + credentials Secret and
    // injects the SQL_* connection env the Encore runtime resolves, so a
    // tenant with a SQLDatabase boots instead of crashing on an unresolved
    // password. Left unset (chart default `enabled: false`) otherwise.
    if extras.preview_database {
        values["previewDatabase"] = serde_json::json!({ "enabled": true });
    }
    // Spec 227 FR-005: opt-in preview-grade Redis, the previewDatabase mirror.
    // When enabled, the chart renders a single-replica Redis Deployment +
    // generated-password Secret and injects REDIS_HOST/REDIS_PASSWORD, so a
    // tenant whose baked infra.config.json declares a `redis` block boots
    // against an in-namespace cache. Left unset (chart default `enabled:
    // false`) otherwise.
    if extras.preview_redis {
        values["previewRedis"] = serde_json::json!({ "enabled": true });
    }
    values
}

// ---------------------------------------------------------------------------
// Spec 137 — access-gate descriptor + dual-release orchestration.
// ---------------------------------------------------------------------------

/// Per-environment access-gate descriptor. Spec 137 §"Access-gate contract".
/// Threaded through `DeploymentRequest.access_gate` from statecraft;
/// statecraft owns Rauthy client provisioning (Phase 3) and supplies the
/// `rauthy_*` material plus the cookie secret in the request body.
///
/// `enabled = false` flows through as if no descriptor was supplied — the
/// tenant Ingress renders without auth annotations and no gate release is
/// installed. The shape is kept stable across true/false so toggling is
/// a single-call reconcile rather than a schema change.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AccessGateDescriptor {
    pub enabled: bool,
    /// Issuer URL of the Rauthy instance. Required when `enabled`. Example:
    /// `https://auth.statecraft.ing`.
    #[serde(default)]
    pub rauthy_issuer_url: String,
    /// Rauthy client_id allocated by `provisionTenantGateClient` in statecraft.
    /// Required when `enabled`.
    #[serde(default)]
    pub rauthy_client_id: String,
    /// Plaintext Rauthy client secret. Required when `enabled`. Stored in the
    /// rendered K8s Secret (`templates/secret.yaml`) under `client-secret`.
    /// Never persisted by deployd-api outside the cluster Secret.
    #[serde(default)]
    pub rauthy_client_secret: String,
    /// Random cookie secret (32 bytes base64). Required when `enabled`.
    /// Generated and persisted by statecraft per spec 137 T043; deployd-api
    /// does NOT generate this.
    #[serde(default)]
    pub cookie_secret: String,
    /// Defense-in-depth allowlist. Empty lists yield a Rauthy-only gate.
    #[serde(default)]
    pub allowed_emails: Vec<String>,
    #[serde(default)]
    pub allowed_domains: Vec<String>,
    /// TLS secret name for the per-org wildcard cert (per spec 137
    /// Decision 4). Required when the deployment has an `ingress.tls`
    /// enabled tenant route.
    #[serde(default)]
    pub tls_secret_name: String,
    /// Optional. Defaults to 4180 (oauth2-proxy upstream default).
    #[serde(default)]
    pub proxy_service_port: Option<u16>,
}

impl AccessGateDescriptor {
    pub fn proxy_service_port(&self) -> u16 {
        self.proxy_service_port.unwrap_or(4180)
    }
}

/// Derive the gate release name from the tenant release name. Stable so
/// reconcile flows can address both releases without storing the gate name
/// out of band.
pub fn gate_release_name(tenant_release: &str) -> String {
    // Truncate to leave room for `-gate` suffix within Helm's 53-char limit.
    let max_base = 53usize.saturating_sub("-gate".len());
    let base: String = tenant_release.chars().take(max_base).collect();
    format!("{base}-gate")
}

/// Translate the descriptor + tenant routing context into the
/// `oauth2-proxy-gate` chart's values JSON.
///
/// `tenant_host` should match the first route's host (the same host the
/// tenant Ingress claims). `tenant_release` is the parent release name —
/// used as the gate's `fullnameOverride` base so resource names are
/// predictable.
pub fn build_gate_values(
    descriptor: &AccessGateDescriptor,
    tenant_release: &str,
    tenant_host: &str,
) -> Value {
    // The oauth2-proxy-gate chart's `templates/deployment.yaml` `fail`s at
    // render time when `allowlist.emails` and `allowlist.domains` are both
    // empty, unless `allowlist.trustRauthyOnly` is explicitly `true` (see
    // the chart's values.yaml). `AccessGateDescriptor`'s own doc comment
    // documents "empty lists yield a Rauthy-only gate" as the deployd
    // contract, so when both lists are empty here we must also set
    // `trustRauthyOnly: true` to keep that documented behaviour working
    // instead of hard-failing the helm install. When either list is
    // non-empty the chart's own default (`false`) is left alone.
    let trust_rauthy_only = descriptor.allowed_emails.is_empty() && descriptor.allowed_domains.is_empty();
    serde_json::json!({
        "fullnameOverride": gate_release_name(tenant_release),
        "tenant": {
            "host": tenant_host,
            "tlsSecretName": descriptor.tls_secret_name,
        },
        "rauthy": {
            "issuerUrl": descriptor.rauthy_issuer_url,
            "clientId": descriptor.rauthy_client_id,
            "clientSecret": descriptor.rauthy_client_secret,
            "cookieSecret": descriptor.cookie_secret,
            "scopes": "openid email profile",
        },
        "allowlist": {
            "emails": descriptor.allowed_emails,
            "domains": descriptor.allowed_domains,
            "trustRauthyOnly": trust_rauthy_only,
        },
        "service": {
            "type": "ClusterIP",
            "port": descriptor.proxy_service_port(),
        },
    })
}

fn split_artifact_ref(artifact_ref: &str) -> (String, String) {
    match artifact_ref.rsplit_once(':') {
        Some((repo, tag)) if !tag.contains('/') => (repo.to_string(), tag.to_string()),
        _ => (artifact_ref.to_string(), "latest".to_string()),
    }
}

fn write_values_file(values: &Value) -> Result<PathBuf, HelmError> {
    let json = serde_json::to_vec_pretty(values)
        .map_err(|e| HelmError::Io(format!("serialize values: {e}")))?;
    let path = std::env::temp_dir().join(format!(
        "deployd-values-{}-{}.json",
        std::process::id(),
        uuid::Uuid::new_v4().simple()
    ));
    let mut f = fs::File::create(&path).map_err(|e| HelmError::Io(e.to_string()))?;
    f.write_all(&json).map_err(|e| HelmError::Io(e.to_string()))?;
    Ok(path)
}

fn write_chart(name: &str, dir: &Path) -> Result<(), HelmError> {
    let files: &[(&str, &str)] = match name {
        "oauth2-proxy-gate" => &[
            ("Chart.yaml", OAUTH2_PROXY_GATE_CHART_YAML),
            ("values.yaml", OAUTH2_PROXY_GATE_VALUES_YAML),
            ("templates/_helpers.tpl", OAUTH2_PROXY_GATE_HELPERS_TPL),
            ("templates/deployment.yaml", OAUTH2_PROXY_GATE_DEPLOYMENT_YAML),
            ("templates/service.yaml", OAUTH2_PROXY_GATE_SERVICE_YAML),
            ("templates/ingress.yaml", OAUTH2_PROXY_GATE_INGRESS_YAML),
            ("templates/secret.yaml", OAUTH2_PROXY_GATE_SECRET_YAML),
            ("templates/configmap.yaml", OAUTH2_PROXY_GATE_CONFIGMAP_YAML),
            ("templates/serviceaccount.yaml", OAUTH2_PROXY_GATE_SA_YAML),
        ],
        "acme-vue-encore" => &[
            ("Chart.yaml", ACME_VUE_ENCORE_CHART_YAML),
            ("values.yaml", ACME_VUE_ENCORE_VALUES_YAML),
            ("templates/_helpers.tpl", ACME_VUE_ENCORE_HELPERS_TPL),
            ("templates/deployment.yaml", ACME_VUE_ENCORE_DEPLOYMENT_YAML),
            ("templates/service.yaml", ACME_VUE_ENCORE_SERVICE_YAML),
            ("templates/ingress.yaml", ACME_VUE_ENCORE_INGRESS_YAML),
            ("templates/serviceaccount.yaml", ACME_VUE_ENCORE_SA_YAML),
            ("templates/postgres.yaml", ACME_VUE_ENCORE_POSTGRES_YAML),
            ("templates/redis.yaml", ACME_VUE_ENCORE_REDIS_YAML),
        ],
        other => return Err(HelmError::UnknownChart(other.to_string())),
    };
    fs::create_dir_all(dir.join("templates")).map_err(|e| HelmError::Io(e.to_string()))?;
    for (rel, contents) in files {
        let path = dir.join(rel);
        fs::write(&path, contents).map_err(|e| HelmError::Io(e.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn helm_available() -> bool {
        Command::new("helm")
            .arg("version")
            .arg("--short")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[test]
    fn build_values_splits_image_ref_at_colon() {
        let v = build_values(
            "ghcr.io/org/acme-vue-encore:v1.2.3",
            "myapp-prod",
            &[],
            None,
            &DeployExtras::default(),
        );
        assert_eq!(v["image"]["repository"], "ghcr.io/org/acme-vue-encore");
        assert_eq!(v["image"]["tag"], "v1.2.3");
        assert_eq!(v["fullnameOverride"], "myapp-prod");
        assert!(v.get("ingress").is_none(), "no routes ⇒ no ingress block");
        assert!(v.get("gate").is_none(), "no descriptor ⇒ no gate block");
    }

    #[test]
    fn build_values_handles_tagless_image_ref() {
        let v = build_values(
            "ghcr.io/org/acme-vue-encore",
            "myapp-prod",
            &[],
            None,
            &DeployExtras::default(),
        );
        assert_eq!(v["image"]["repository"], "ghcr.io/org/acme-vue-encore");
        assert_eq!(v["image"]["tag"], "latest");
    }

    #[test]
    fn build_values_enables_ingress_when_route_present() {
        let v = build_values(
            "ghcr.io/org/acme-vue-encore:v1",
            "myapp-prod",
            &[("app.example.com".into(), "/".into())],
            None,
            &DeployExtras::default(),
        );
        assert_eq!(v["ingress"]["enabled"], true);
        assert_eq!(v["ingress"]["host"], "app.example.com");
    }

    // ---------------------------------------------------------------------
    // Spec 214: dispatch-contract extras (config_refs, image pull secret,
    // tenant TLS) flow through build_values into chart values.
    // ---------------------------------------------------------------------

    #[test]
    fn build_values_renders_extra_env_from_config_refs() {
        // FR-004: config_refs become container env vars, key-sorted.
        let mut refs = std::collections::BTreeMap::new();
        refs.insert("FEATURE_FLAG".to_string(), "on".to_string());
        refs.insert("API_BASE".to_string(), "https://api.example".to_string());
        let extras = DeployExtras {
            config_refs: Some(&refs),
            ..Default::default()
        };
        let v = build_values("ghcr.io/org/app:v1", "app-prod", &[], None, &extras);
        let env = v["extraEnv"].as_array().expect("extraEnv array present");
        assert_eq!(env.len(), 2);
        // BTreeMap iteration is key-sorted, so API_BASE precedes FEATURE_FLAG.
        assert_eq!(env[0]["name"], "API_BASE");
        assert_eq!(env[0]["value"], "https://api.example");
        assert_eq!(env[1]["name"], "FEATURE_FLAG");
        assert_eq!(env[1]["value"], "on");
    }

    #[test]
    fn build_values_omits_extra_env_when_no_config_refs() {
        let v = build_values(
            "ghcr.io/org/app:v1",
            "app-prod",
            &[],
            None,
            &DeployExtras::default(),
        );
        assert!(v.get("extraEnv").is_none());
    }

    #[test]
    fn build_values_renders_image_pull_secret() {
        // FR-005: imagePullSecrets carries the named dockerconfigjson secret.
        let extras = DeployExtras {
            image_pull_secret_name: Some("ghcr-pull"),
            ..Default::default()
        };
        let v = build_values("ghcr.io/org/app:v1", "app-prod", &[], None, &extras);
        assert_eq!(v["imagePullSecrets"][0]["name"], "ghcr-pull");
    }

    #[test]
    fn build_values_skips_image_pull_secret_when_empty() {
        let extras = DeployExtras {
            image_pull_secret_name: Some(""),
            ..Default::default()
        };
        let v = build_values("ghcr.io/org/app:v1", "app-prod", &[], None, &extras);
        assert!(v.get("imagePullSecrets").is_none());
    }

    #[test]
    fn build_values_enables_preview_database_when_requested() {
        // FR-006: preview_database renders the chart's opt-in Postgres so an
        // Encore tenant with a SQLDatabase boots against an in-namespace DB.
        let extras = DeployExtras {
            preview_database: true,
            ..Default::default()
        };
        let v = build_values("ghcr.io/org/app:v1", "app-prod", &[], None, &extras);
        assert_eq!(v["previewDatabase"]["enabled"], true);
    }

    #[test]
    fn build_values_omits_preview_database_by_default() {
        let v = build_values(
            "ghcr.io/org/app:v1",
            "app-prod",
            &[],
            None,
            &DeployExtras::default(),
        );
        assert!(
            v.get("previewDatabase").is_none(),
            "chart default (disabled) is left untouched when not requested"
        );
    }

    #[test]
    fn build_values_enables_preview_redis_when_requested() {
        // Spec 227 FR-005: preview_redis renders the chart's opt-in Redis so an
        // Encore tenant whose baked infra.config.json declares a redis block
        // boots against an in-namespace cache.
        let extras = DeployExtras {
            preview_redis: true,
            ..Default::default()
        };
        let v = build_values("ghcr.io/org/app:v1", "app-prod", &[], None, &extras);
        assert_eq!(v["previewRedis"]["enabled"], true);
    }

    #[test]
    fn build_values_omits_preview_redis_by_default() {
        let v = build_values(
            "ghcr.io/org/app:v1",
            "app-prod",
            &[],
            None,
            &DeployExtras::default(),
        );
        assert!(
            v.get("previewRedis").is_none(),
            "chart default (disabled) is left untouched when not requested"
        );
    }

    #[test]
    fn build_values_enables_tls_when_secret_and_route_present() {
        // User Story 1: tenant ingress terminates TLS with the reflected
        // wildcard secret.
        let extras = DeployExtras {
            tls_secret_name: Some("tenants-wildcard-tls"),
            ..Default::default()
        };
        let v = build_values(
            "ghcr.io/org/app:v1",
            "acme-p-dev",
            &[("acme--p--dev.tenants.test".into(), "/".into())],
            None,
            &extras,
        );
        assert_eq!(v["ingress"]["enabled"], true);
        assert_eq!(v["ingress"]["tls"]["enabled"], true);
        assert_eq!(v["ingress"]["tls"]["secretName"], "tenants-wildcard-tls");
    }

    #[test]
    fn build_values_omits_tls_without_route_even_with_secret() {
        let extras = DeployExtras {
            tls_secret_name: Some("tenants-wildcard-tls"),
            ..Default::default()
        };
        let v = build_values("ghcr.io/org/app:v1", "app-prod", &[], None, &extras);
        assert!(
            v.get("ingress").is_none(),
            "no route means no ingress and therefore no tls block"
        );
    }

    // ---------------------------------------------------------------------
    // Spec 137 — access-gate descriptor + dual-release orchestration tests.
    // ---------------------------------------------------------------------

    fn sample_descriptor(enabled: bool) -> AccessGateDescriptor {
        AccessGateDescriptor {
            enabled,
            rauthy_issuer_url: "https://auth.statecraft.ing".into(),
            rauthy_client_id: "tenant-gate-env-abc".into(),
            rauthy_client_secret: "rauthy-secret-xyz".into(),
            cookie_secret: "0123456789abcdef0123456789abcdef".into(),
            allowed_emails: vec!["alice@acme.com".into()],
            allowed_domains: vec!["acme.com".into()],
            tls_secret_name: "acme-wildcard-tls".into(),
            proxy_service_port: None,
        }
    }

    #[test]
    fn gate_release_name_appends_suffix_and_truncates() {
        assert_eq!(gate_release_name("myapp"), "myapp-gate");
        // Long base must stay within Helm's 53-char limit including the
        // `-gate` suffix.
        let long = "a".repeat(80);
        let name = gate_release_name(&long);
        assert!(name.ends_with("-gate"));
        assert!(name.len() <= 53);
    }

    #[test]
    fn build_values_skips_gate_block_when_descriptor_disabled() {
        let d = sample_descriptor(false);
        let v = build_values(
            "ghcr.io/org/acme-vue-encore:v1",
            "myapp-prod",
            &[("acme.tenants.test".into(), "/".into())],
            Some(&d),
            &DeployExtras::default(),
        );
        assert!(
            v.get("gate").is_none(),
            "disabled descriptor should not emit gate block"
        );
    }

    #[test]
    fn build_values_emits_gate_block_when_descriptor_enabled() {
        let d = sample_descriptor(true);
        let v = build_values(
            "ghcr.io/org/acme-vue-encore:v1",
            "myapp-prod",
            &[("acme.tenants.test".into(), "/".into())],
            Some(&d),
            &DeployExtras::default(),
        );
        assert_eq!(v["gate"]["enabled"], true);
        assert_eq!(v["gate"]["proxyServiceName"], "myapp-prod-gate");
        assert_eq!(v["gate"]["proxyServicePort"], 4180);
    }

    #[test]
    fn build_gate_values_maps_descriptor_to_chart_shape() {
        let d = sample_descriptor(true);
        let v = build_gate_values(&d, "myapp-prod", "acme.tenants.test");
        assert_eq!(v["fullnameOverride"], "myapp-prod-gate");
        assert_eq!(v["tenant"]["host"], "acme.tenants.test");
        assert_eq!(v["tenant"]["tlsSecretName"], "acme-wildcard-tls");
        assert_eq!(v["rauthy"]["issuerUrl"], "https://auth.statecraft.ing");
        assert_eq!(v["rauthy"]["clientId"], "tenant-gate-env-abc");
        assert_eq!(v["rauthy"]["clientSecret"], "rauthy-secret-xyz");
        assert_eq!(v["rauthy"]["cookieSecret"], "0123456789abcdef0123456789abcdef");
        assert_eq!(v["allowlist"]["emails"][0], "alice@acme.com");
        assert_eq!(v["allowlist"]["domains"][0], "acme.com");
        assert_eq!(v["service"]["port"], 4180);
        // Non-empty allowlist ⇒ trustRauthyOnly left at the chart's own
        // default (false); this build_values call must not force it true.
        assert_eq!(v["allowlist"]["trustRauthyOnly"], false);
    }

    #[test]
    fn build_gate_values_sets_trust_rauthy_only_when_allowlist_empty() {
        // FR-005 documents "empty lists yield a Rauthy-only gate"; the
        // oauth2-proxy-gate chart hard-fails at render time on an empty
        // allowlist unless trustRauthyOnly=true, so build_gate_values must
        // set it whenever both allowed_emails and allowed_domains are empty.
        let mut d = sample_descriptor(true);
        d.allowed_emails.clear();
        d.allowed_domains.clear();
        let v = build_gate_values(&d, "myapp-prod", "acme.tenants.test");
        assert_eq!(v["allowlist"]["trustRauthyOnly"], true);
    }

    #[test]
    fn build_gate_values_omits_trust_rauthy_only_when_only_domains_present() {
        let mut d = sample_descriptor(true);
        d.allowed_emails.clear();
        let v = build_gate_values(&d, "myapp-prod", "acme.tenants.test");
        assert_eq!(v["allowlist"]["trustRauthyOnly"], false);
    }

    #[test]
    fn descriptor_deserialises_from_statecraft_wire_shape() {
        let raw = r#"{
            "enabled": true,
            "rauthy_issuer_url": "https://auth.statecraft.ing",
            "rauthy_client_id": "tenant-gate-env-1",
            "rauthy_client_secret": "s",
            "cookie_secret": "c",
            "allowed_emails": ["a@b.com"],
            "allowed_domains": ["b.com"],
            "tls_secret_name": "tls",
            "proxy_service_port": 4180
        }"#;
        let d: AccessGateDescriptor = serde_json::from_str(raw).unwrap();
        assert!(d.enabled);
        assert_eq!(d.proxy_service_port(), 4180);
    }

    #[test]
    fn descriptor_proxy_port_defaults_to_4180_when_absent() {
        let raw = r#"{ "enabled": false }"#;
        let d: AccessGateDescriptor = serde_json::from_str(raw).unwrap();
        assert!(!d.enabled);
        assert_eq!(d.proxy_service_port(), 4180);
        // All other fields default to empty strings / empty vecs.
        assert!(d.allowed_emails.is_empty());
    }

    #[test]
    fn template_renders_oauth2_proxy_gate_with_required_values() {
        if !helm_available() {
            eprintln!("skipping: helm binary not in PATH");
            return;
        }
        let runner = HelmRunner::from_env();
        let descriptor = sample_descriptor(true);
        let req = InstallRequest {
            chart: "oauth2-proxy-gate".into(),
            namespace: "myapp-prod".into(),
            release: gate_release_name("myapp"),
            values: build_gate_values(&descriptor, "myapp", "acme.tenants.test"),
        };
        let rendered = runner.template(&req).expect("helm template should succeed");
        assert!(rendered.contains("kind: Deployment"));
        assert!(rendered.contains("kind: Service"));
        assert!(rendered.contains("kind: Secret"));
        assert!(rendered.contains("kind: ConfigMap"), "ConfigMap rendered because allowlist.emails present");
        assert!(rendered.contains("kind: Ingress"));
        assert!(
            rendered.contains("oap.spec: \"137-tenant-environment-access-gates\""),
            "spec 137 provenance label"
        );
        assert!(
            rendered.contains("--oidc-issuer-url=https://auth.statecraft.ing"),
            "Rauthy issuer URL flows into oauth2-proxy args"
        );
        assert!(
            rendered.contains("--client-id=tenant-gate-env-abc"),
            "client id flows into oauth2-proxy args"
        );
        assert!(
            rendered.contains("--client-secret-file=/secrets/client-secret"),
            "secret material read from file, not argv (no leak via `ps`)"
        );
        // The plaintext secret is correctly present in the rendered K8s
        // Secret (that's where it must go). It must NOT appear as part of a
        // command-line argument — `ps`-visible argv is the leak path we
        // defend against. The shape we forbid is `--<anything>=<secret>`.
        let secret_in_argv = "=rauthy-secret-xyz";
        assert!(
            !rendered.contains(secret_in_argv),
            "client secret value must not appear after `=` in any flag (it would leak via `ps`)"
        );
        // FR-004 invariant — `password` never appears in the Deployment
        // template (in argv, env, or volume mounts). Rauthy's flows_enabled
        // is the primary enforcement; this is the belt-and-suspenders check
        // against accidental future arg drift in this chart.
        let deployment_section = rendered
            .split("# Source:")
            .find(|s| s.contains("templates/deployment.yaml"))
            .expect("Deployment section present in rendered output");
        assert!(
            !deployment_section.to_lowercase().contains("password"),
            "no `password` token may appear in the gate Deployment manifest"
        );
    }

    #[test]
    fn template_oauth2_gate_skips_configmap_when_no_emails_allowlist() {
        if !helm_available() {
            eprintln!("skipping: helm binary not in PATH");
            return;
        }
        let runner = HelmRunner::from_env();
        let mut descriptor = sample_descriptor(true);
        descriptor.allowed_emails.clear();
        let req = InstallRequest {
            chart: "oauth2-proxy-gate".into(),
            namespace: "myapp-prod".into(),
            release: gate_release_name("myapp"),
            values: build_gate_values(&descriptor, "myapp", "acme.tenants.test"),
        };
        let rendered = runner.template(&req).expect("helm template should succeed");
        assert!(
            !rendered.contains("kind: ConfigMap"),
            "ConfigMap should be absent when allowlist.emails is empty"
        );
        // Domains-only allowlist surfaces via repeated `--email-domain=` args.
        assert!(
            rendered.contains("--email-domain=acme.com"),
            "domain allowlist flows into args"
        );
    }

    #[test]
    fn from_env_default_helm_timeout_is_under_undici_300s() {
        // Guard against regressing the deploy timeout race: statecraft's fetch
        // to deployd inherits undici's 300s headers timeout, so the default
        // `helm --wait` timeout must stay safely under 300s for deployd's
        // FAILED + helm stderr to win the race. Only assert the default when
        // the env override is absent (it governs the default path).
        if std::env::var("DEPLOYD_HELM_TIMEOUT").is_ok() {
            eprintln!("skipping: DEPLOYD_HELM_TIMEOUT overridden in this env");
            return;
        }
        let runner = HelmRunner::from_env();
        assert_eq!(runner.timeout, "3m");
        let secs = parse_helm_timeout_secs(&runner.timeout);
        assert!(
            secs < 300,
            "default helm timeout {secs}s must be < undici's 300s headers timeout"
        );
    }

    // Minimal parser for the `<n>{s,m,h}` helm duration subset this binary
    // emits, used only to assert the race-margin invariant above.
    fn parse_helm_timeout_secs(t: &str) -> u64 {
        let (num, mult) = match t.chars().last() {
            Some('s') => (&t[..t.len() - 1], 1),
            Some('m') => (&t[..t.len() - 1], 60),
            Some('h') => (&t[..t.len() - 1], 3600),
            _ => (t, 1),
        };
        num.parse::<u64>().unwrap_or(0) * mult
    }

    #[test]
    fn prepare_chart_rejects_unknown_chart() {
        let runner = HelmRunner::from_env();
        let err = runner.prepare_chart("not-a-chart").unwrap_err();
        match err {
            HelmError::UnknownChart(s) => assert_eq!(s, "not-a-chart"),
            other => panic!("expected UnknownChart, got {other:?}"),
        }
    }

    #[test]
    fn template_renders_acme_vue_encore_without_ingress() {
        if !helm_available() {
            eprintln!("skipping: helm binary not in PATH");
            return;
        }
        let runner = HelmRunner::from_env();
        let req = InstallRequest {
            chart: "acme-vue-encore".into(),
            namespace: "myapp-prod".into(),
            release: "myapp".into(),
            values: build_values(
                "ghcr.io/org/acme-vue-encore:v1.2.3",
                "myapp-prod",
                &[],
                None,
                &DeployExtras::default(),
            ),
        };
        let rendered = runner.template(&req).expect("helm template should succeed");
        // No route means the core workload objects render but no Ingress.
        assert!(rendered.contains("kind: Deployment"), "Deployment present");
        assert!(rendered.contains("kind: Service"), "Service present");
        assert!(rendered.contains("kind: ServiceAccount"), "SA present");
        assert!(
            !rendered.contains("kind: Ingress"),
            "Ingress should be absent when no route is supplied"
        );
        assert!(
            rendered.contains("ghcr.io/org/acme-vue-encore"),
            "image repo flowed through"
        );
        assert!(rendered.contains("v1.2.3"), "image tag flowed through");
        assert!(
            rendered.contains("containerPort: 4000"),
            "Encore gateway port (FR-001)"
        );
        assert!(
            rendered.contains("runAsNonRoot: true"),
            "non-root by policy (FR-001)"
        );
        assert!(
            rendered.contains("oap.spec: \"214-tenant-app-chart-supersession\""),
            "oap.spec label asserts spec provenance"
        );
    }

    #[test]
    fn template_reports_invocation_error_on_unknown_chart() {
        // No helm needed: prepare_chart fails before we shell out.
        let runner = HelmRunner::from_env();
        let req = InstallRequest {
            chart: "no-such-chart".into(),
            namespace: "any".into(),
            release: "x".into(),
            values: serde_json::json!({}),
        };
        let err = runner.template(&req).unwrap_err();
        assert!(matches!(err, HelmError::UnknownChart(_)));
    }

    // ---------------------------------------------------------------------
    // Spec 214: acme-vue-encore chart materialisation + render smokes.
    // ---------------------------------------------------------------------

    #[test]
    fn prepare_chart_materialises_acme_vue_encore_files() {
        let runner = HelmRunner::from_env();
        let dir = runner.prepare_chart("acme-vue-encore").expect("prepare");
        for rel in [
            "Chart.yaml",
            "values.yaml",
            "templates/_helpers.tpl",
            "templates/deployment.yaml",
            "templates/service.yaml",
            "templates/ingress.yaml",
            "templates/serviceaccount.yaml",
            "templates/postgres.yaml",
            "templates/redis.yaml",
        ] {
            let p = dir.join(rel);
            assert!(p.exists(), "missing materialised file: {rel}");
            let bytes = fs::read(&p).unwrap();
            assert!(!bytes.is_empty(), "empty materialised file: {rel}");
        }
    }

    #[test]
    fn template_renders_acme_vue_encore_with_tls_and_pull_secret() {
        if !helm_available() {
            eprintln!("skipping: helm binary not in PATH");
            return;
        }
        let runner = HelmRunner::from_env();
        let extras = DeployExtras {
            tls_secret_name: Some("tenants-wildcard-tls"),
            image_pull_secret_name: Some("ghcr-pull"),
            ..Default::default()
        };
        let req = InstallRequest {
            chart: "acme-vue-encore".into(),
            namespace: "acme-dev".into(),
            release: "acme-p-dev".into(),
            values: build_values(
                "ghcr.io/org/acme-vue-encore:sha-abc123",
                "acme-p-dev",
                &[("acme--p--dev.tenants.test".into(), "/".into())],
                None,
                &extras,
            ),
        };
        let rendered = runner.template(&req).expect("helm template should succeed");
        assert!(rendered.contains("kind: Deployment"), "Deployment present");
        assert!(rendered.contains("kind: Service"), "Service present");
        assert!(rendered.contains("kind: ServiceAccount"), "SA present");
        assert!(
            rendered.contains("kind: Ingress"),
            "Ingress present (route supplied)"
        );
        assert!(
            rendered.contains("containerPort: 4000"),
            "Encore gateway port (FR-001)"
        );
        assert!(
            rendered.contains("/health/liveness"),
            "liveness probe on the scaffold's health surface (Clarification 1)"
        );
        assert!(
            rendered.contains("/health/readiness"),
            "readiness probe path"
        );
        assert!(rendered.contains("runAsNonRoot: true"), "non-root by policy");
        assert!(
            rendered.contains("name: ghcr-pull"),
            "image pull secret wired (FR-005)"
        );
        assert!(
            rendered.contains("secretName: \"tenants-wildcard-tls\""),
            "tenant TLS terminates with the reflected wildcard secret (User Story 1)"
        );
        assert!(
            rendered.contains("oap.spec: \"214-tenant-app-chart-supersession\""),
            "spec 214 provenance label on rendered objects"
        );
    }

    #[test]
    fn template_renders_acme_vue_encore_preview_database_when_enabled() {
        if !helm_available() {
            eprintln!("skipping: helm binary not in PATH");
            return;
        }
        let runner = HelmRunner::from_env();
        let mut values = build_values(
            "ghcr.io/org/acme-vue-encore:sha-abc123",
            "acme-p-dev",
            &[],
            None,
            &DeployExtras::default(),
        );
        // FR-006: opt-in preview Postgres renders a StatefulSet + headless
        // Service + generated-credentials Secret in the same namespace and
        // injects the DB connection env into the app container. helm deep-
        // merges this onto the chart's previewDatabase defaults.
        values["previewDatabase"] = serde_json::json!({ "enabled": true });
        let req = InstallRequest {
            chart: "acme-vue-encore".into(),
            namespace: "acme-dev".into(),
            release: "acme-p-dev".into(),
            values,
        };
        let rendered = runner.template(&req).expect("helm template should succeed");
        assert!(
            rendered.contains("kind: StatefulSet"),
            "preview Postgres StatefulSet rendered"
        );
        // Spec 227: the app container must receive the SQL_* names its baked
        // infra.config.json resolves (${SQL_HOST} / ${SQL_USERNAME} /
        // $env:SQL_PASSWORD), not the POSTGRES_* names it never reads. The
        // POSTGRES_* keys still exist on the postgres pod's own Secret, so
        // asserting the SQL_* names specifically is what proves the fix.
        assert!(
            rendered.contains("SQL_HOST"),
            "app container gets SQL_HOST (the name Encore actually resolves)"
        );
        assert!(
            rendered.contains("SQL_PASSWORD"),
            "app container gets SQL_PASSWORD from the preview Postgres secret"
        );
    }

    #[test]
    fn template_renders_acme_vue_encore_preview_redis_when_enabled() {
        if !helm_available() {
            eprintln!("skipping: helm binary not in PATH");
            return;
        }
        let runner = HelmRunner::from_env();
        let extras = DeployExtras {
            preview_redis: true,
            ..Default::default()
        };
        let req = InstallRequest {
            chart: "acme-vue-encore".into(),
            namespace: "acme-dev".into(),
            release: "acme-p-dev".into(),
            values: build_values(
                "ghcr.io/org/acme-vue-encore:sha-abc123",
                "acme-p-dev",
                &[],
                None,
                &extras,
            ),
        };
        let rendered = runner.template(&req).expect("helm template should succeed");
        // FR-005: opt-in preview Redis renders a Deployment + Service +
        // generated-password Secret and injects REDIS_HOST/REDIS_PASSWORD into
        // the app container.
        assert!(
            rendered.contains("app.kubernetes.io/component: redis"),
            "preview Redis workload rendered"
        );
        assert!(
            rendered.contains("acme-p-dev-redis:6379"),
            "REDIS_HOST targets the in-namespace preview Redis Service"
        );
        assert!(
            rendered.contains("REDIS_PASSWORD"),
            "Redis credential wired into the app container env"
        );
    }

    #[test]
    fn template_omits_preview_redis_by_default() {
        if !helm_available() {
            eprintln!("skipping: helm binary not in PATH");
            return;
        }
        let runner = HelmRunner::from_env();
        let req = InstallRequest {
            chart: "acme-vue-encore".into(),
            namespace: "acme-dev".into(),
            release: "acme-p-dev".into(),
            values: build_values(
                "ghcr.io/org/acme-vue-encore:sha-abc123",
                "acme-p-dev",
                &[],
                None,
                &DeployExtras::default(),
            ),
        };
        let rendered = runner.template(&req).expect("helm template should succeed");
        assert!(
            !rendered.contains("app.kubernetes.io/component: redis"),
            "no preview Redis workload when previewRedis is disabled"
        );
    }
}
