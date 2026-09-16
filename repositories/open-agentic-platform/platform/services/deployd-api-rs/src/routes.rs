use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;

use crate::auth;
use crate::helm::{self, AccessGateDescriptor, HelmRunner, InstallRequest};
use crate::k8s;
use crate::store::{self, AppState, Deployment};

pub async fn healthz() -> &'static str {
    "ok"
}

#[derive(Deserialize)]
pub struct DeploymentRequest {
    pub tenant_id: String,
    pub app_id: String,
    pub env_id: String,
    pub release_sha: String,
    pub artifact_ref: String,
    pub lane: String,
    pub app_slug: Option<String>,
    pub env_slug: Option<String>,
    pub desired_routes: Option<Vec<RouteSpec>>,
    /// Chart name resolved by statecraft's chartSelector (spec 136 Phase 2).
    /// Optional for backwards compatibility; defaults to "acme-vue-encore",
    /// the sole registered shape after the spec 214 retirement.
    pub chart: Option<String>,
    /// Chart version, mirrors the chartSelector output. Currently advisory:
    /// the chart bundled into deployd-api is pinned by the image build.
    pub chart_version: Option<String>,
    // region: gate-overlay
    /// Spec 137 — per-environment access-gate descriptor. When `Some` with
    /// `enabled: true`, the tenant chart renders auth-url annotations and
    /// the oauth2-proxy-gate chart is installed alongside via
    /// [`HelmRunner::install_with_gate`]. Absent or `enabled: false` flows
    /// through as a direct-exposure tenant deploy (existing behaviour).
    #[serde(default)]
    pub access_gate: Option<AccessGateDescriptor>,
    // endregion gate-overlay
    /// Spec 214 FR-004: opaque app config rendered as container env vars
    /// (chart `extraEnv`). The statecraft proxy rejects reserved
    /// `ENCORE_` / `KUBERNETES_` prefixes before they reach deployd.
    #[serde(default)]
    pub config_refs: Option<std::collections::BTreeMap<String, String>>,
    /// Spec 214 FR-005: dockerconfigjson pull secret reflected into the
    /// namespace (default `ghcr-pull`, applied by the proxy). Rendered into
    /// `imagePullSecrets` when present.
    #[serde(default)]
    pub image_pull_secret_name: Option<String>,
    /// Spec 214 FR-008: effective K8s namespace forwarded from
    /// `environments.k8sNamespace`. When present (and non-empty) it wins over
    /// the computed `{app_id}-{env_id}` and is persisted on the deployment
    /// row so DELETE and status operate on recorded truth.
    #[serde(default)]
    pub namespace: Option<String>,
    /// Spec 214 FR-006: when true, render the chart's opt-in preview-grade
    /// Postgres so an Encore tenant with a `SQLDatabase` boots against an
    /// in-namespace database. Statecraft sets this for development/preview
    /// environments; absent/false leaves the chart default (no preview DB).
    #[serde(default)]
    pub preview_database: Option<bool>,
    /// Spec 227 FR-005: when true, render the chart's opt-in preview-grade
    /// Redis (mirrors `preview_database`) so a tenant whose baked
    /// infra.config.json declares a `redis` block boots against an
    /// in-namespace cache. Statecraft sets this for development/preview
    /// environments that opted into the Redis infrastructure resource;
    /// absent/false leaves the chart default (no preview Redis).
    #[serde(default)]
    pub preview_redis: Option<bool>,
}

#[derive(Deserialize, Serialize)]
pub struct RouteSpec {
    pub host: Option<String>,
    pub path: Option<String>,
}

pub async fn create_deployment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<DeploymentRequest>,
) -> impl IntoResponse {
    // Auth
    let claims = match auth::verify_jwt(
        &headers,
        &state.config.oidc_endpoint,
        &state.config.audience,
    )
    .await
    {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "unauthorized", "message": e.to_string()})),
            );
        }
    };
    if !auth::has_scope(&claims, &state.config.required_scope) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "forbidden",
                "message": format!("missing scope {}", state.config.required_scope)
            })),
        );
    }

    // Reject a token with no subject claim before any deployment row is
    // written. `is_owner_or_admin` (auth.rs) degrades a NULL `owner_sub` to
    // "any caller holding the required scope may act on this deployment",
    // which is meant only as a legacy fallback for rows written before
    // ownership tracking existed; a new NULL-owner row would be open to
    // every future caller with the required scope, not just this one.
    let Some(owner_sub) = claims.sub.clone() else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "error": "unauthorized",
                "message": "token missing subject claim"
            })),
        );
    };

    let deployment_key = format!("{}|{}|{}", body.app_id, body.env_id, body.release_sha);

    // Idempotent check
    if let Ok(Some(existing)) = store::get_by_key(&state.client, &deployment_key).await {
        return (
            StatusCode::OK,
            Json(json!({
                "release_id": existing.deployment_id,
                "status": existing.status,
                "endpoints": existing.endpoints,
                "idempotent_replay": true,
            })),
        );
    }

    let deployment_id = format!("rel_{}", uuid::Uuid::new_v4().simple());
    let now = chrono::Utc::now().to_rfc3339();

    let endpoints: Vec<String> = body
        .desired_routes
        .as_ref()
        .map(|routes| {
            routes
                .iter()
                .map(|r| {
                    let host = r.host.as_deref().unwrap_or("unknown-host");
                    let path = r.path.as_deref().unwrap_or("/");
                    format!("https://{host}{path}")
                })
                .collect()
        })
        .unwrap_or_default();

    let chart = body.chart.clone().unwrap_or_else(|| "acme-vue-encore".into());
    let chart_version = body
        .chart_version
        .clone()
        .unwrap_or_else(|| "0.1.0".into());

    // Spec 214 FR-008: the forwarded namespace (from environments.k8sNamespace)
    // wins over the computed default and is persisted on the row so DELETE and
    // status operate on recorded truth rather than recomputation.
    let namespace = body
        .namespace
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("{}-{}", body.app_id, body.env_id));

    // Reject a namespace that isn't a well-formed, non-reserved K8s
    // namespace name. Without this check a caller holding the required
    // scope (e.g. a compromised M2M credential) could point `helm install`
    // at any namespace in the cluster, including cluster-system or
    // platform-owned namespaces (rauthy-system, statecraft-system, etc.),
    // purely by setting `namespace` on the request body. This is a format
    // plus reserved-name check, not tenant-ownership enforcement; see
    // `is_valid_tenant_namespace`'s doc comment for the isolation lever
    // this does NOT provide.
    if !crate::rbac::is_valid_tenant_namespace(&namespace) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "invalid_namespace",
                "message": format!("namespace '{namespace}' is not a valid tenant namespace")
            })),
        );
    }

    let deployment = Deployment {
        deployment_id: deployment_id.clone(),
        deployment_key,
        tenant_id: body.tenant_id,
        app_id: body.app_id.clone(),
        env_id: body.env_id.clone(),
        release_sha: body.release_sha,
        artifact_ref: body.artifact_ref.clone(),
        lane: body.lane.clone(),
        status: "PENDING".to_string(),
        app_slug: body.app_slug.clone(),
        env_slug: body.env_slug.clone(),
        namespace: Some(namespace.clone()),
        desired_routes: body
            .desired_routes
            .as_ref()
            .map(|r| serde_json::to_string(r).unwrap_or_default()),
        endpoints: Some(serde_json::to_string(&endpoints).unwrap_or_default()),
        created_at: now.clone(),
        updated_at: now,
        owner_sub: Some(owner_sub),
    };

    if let Err(e) = store::insert_deployment(&state.client, &deployment).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "store_error", "message": e.to_string()})),
        );
    }
    let _ = store::add_event(&state.client, &deployment_id, "requested", None).await;

    // Parse routes into (host, path) pairs for the Helm values builder.
    let route_pairs: Vec<(String, String)> = body
        .desired_routes
        .as_ref()
        .map(|routes| {
            routes
                .iter()
                .map(|r| {
                    (
                        r.host.clone().unwrap_or_else(|| "unknown-host".into()),
                        r.path.clone().unwrap_or_else(|| "/".into()),
                    )
                })
                .collect()
        })
        .unwrap_or_default();

    let release_name = body
        .app_slug
        .clone()
        .unwrap_or_else(|| body.app_id.clone());

    // Probe the cluster first. When no cluster is reachable (local dev,
    // record-only deployments), short-circuit to ROLLED_OUT without
    // shelling helm. When the cluster IS reachable, drive helm against
    // the chart resolved upstream by statecraft's chartSelector.
    let (final_status, final_endpoints) = match k8s::probe_cluster().await {
        Ok(()) => {
            let _ = store::update_status(&state.client, &deployment_id, "DEPLOYING").await;
            let _ = store::add_event(
                &state.client,
                &deployment_id,
                "deploying",
                Some(&format!("applying chart {chart} ({chart_version})")),
            )
            .await;

            // Spec 137 — if the request carries an enabled access-gate
            // descriptor, drive the dual-release install. Otherwise the
            // single-release path (existing spec 136 behaviour).
            let gate_active = body
                .access_gate
                .as_ref()
                .map(|g| g.enabled)
                .unwrap_or(false);
            // Spec 214: thread config_refs (FR-004), the pull secret (FR-005),
            // and the reflected wildcard TLS secret (User Story 1) into the
            // chart values. The TLS secret name is deployd operational config
            // (the cluster-reflected `tenants-wildcard-tls`), overridable via
            // DEPLOYD_TENANT_TLS_SECRET.
            let tenant_tls_secret = std::env::var("DEPLOYD_TENANT_TLS_SECRET")
                .unwrap_or_else(|_| "tenants-wildcard-tls".to_string());
            let extras = helm::DeployExtras {
                config_refs: body.config_refs.as_ref(),
                image_pull_secret_name: body.image_pull_secret_name.as_deref(),
                tls_secret_name: Some(tenant_tls_secret.as_str()).filter(|s| !s.is_empty()),
                preview_database: body.preview_database.unwrap_or(false),
                preview_redis: body.preview_redis.unwrap_or(false),
            };
            let values = helm::build_values(
                &body.artifact_ref,
                &release_name,
                &route_pairs,
                body.access_gate.as_ref(),
                &extras,
            );
            let tenant_req = InstallRequest {
                chart: chart.clone(),
                namespace: namespace.clone(),
                release: release_name.clone(),
                values,
            };
            let runner = HelmRunner::from_env();

            // Self-provision per-namespace RBAC before helm runs its
            // workloads there. Opt-in (DEPLOYD_SELF_PROVISION_RBAC): a no-op
            // under the default cluster-wide fallback, so existing
            // deployments are unaffected. When enabled and it fails, fail the
            // deploy now with a clear cause rather than let helm fail
            // mid-install with an opaque "forbidden".
            let self_provision = crate::rbac::SelfProvisionConfig::from_env();
            if let Err(e) =
                crate::rbac::ensure_workload_rbac(&namespace, &self_provision).await
            {
                tracing::error!(
                    deployment_id = %deployment_id,
                    "self-provision RBAC failed: {e}"
                );
                let _ = store::update_status(&state.client, &deployment_id, "FAILED").await;
                let cause = sanitize_event_detail(&e.to_string());
                let _ = store::add_event(
                    &state.client,
                    &deployment_id,
                    "failed",
                    Some(&format!(
                        "self-provision RBAC failed for namespace {namespace}: {cause}"
                    )),
                )
                .await;
                return (
                    StatusCode::OK,
                    Json(json!({
                        "release_id": deployment_id,
                        "status": "FAILED",
                        "endpoints": endpoints,
                        "logs_pointer": format!("/v1/deployments/{}/logs", deployment_id),
                        "chart": chart,
                        "chart_version": chart_version,
                    })),
                );
            }

            let access_gate = body.access_gate.clone();
            let tenant_release_for_gate = release_name.clone();
            let first_host = route_pairs
                .first()
                .map(|(h, _)| h.clone())
                .unwrap_or_default();
            // Spec 137 T045 / FR-009: reconcile flows. When the descriptor
            // toggles enabled true → false (or remains false on a re-deploy
            // of a previously-gated tenant), we must also uninstall any
            // surviving gate release so the tenant Ingress doesn't keep
            // dangling auth-url annotations pointing at a torn-down Service.
            //
            // `helm uninstall` treats "release not found" as success, so the
            // !gate_active branch's gate-cleanup is a no-op when no prior
            // gate existed — safe to invoke unconditionally.
            let namespace_for_gate_cleanup = namespace.clone();
            let release_for_gate_cleanup = release_name.clone();
            let install_outcome = tokio::task::spawn_blocking(move || {
                if gate_active {
                    let descriptor = access_gate.expect("gate_active implies access_gate.is_some");
                    let gate_values = helm::build_gate_values(
                        &descriptor,
                        &tenant_release_for_gate,
                        &first_host,
                    );
                    runner.install_with_gate(&tenant_req, "oauth2-proxy-gate", gate_values)
                } else {
                    let tenant_result = runner.install(&tenant_req)?;
                    // Best-effort gate teardown for the off-transition. Log
                    // but don't fail the deploy: a stale gate is a leak but
                    // not a correctness break for the tenant traffic path
                    // (the tenant Ingress no longer references it).
                    let gate_release = helm::gate_release_name(&release_for_gate_cleanup);
                    if let Err(e) = runner.uninstall(&namespace_for_gate_cleanup, &gate_release) {
                        tracing::warn!(
                            "gate teardown on off-transition failed for {gate_release}: {e}"
                        );
                    }
                    Ok(tenant_result)
                }
            })
            .await;
            match install_outcome {
                Ok(Ok(result)) => {
                    let _ = store::update_status(&state.client, &deployment_id, "ROLLED_OUT").await;
                    let _ = store::add_event(
                        &state.client,
                        &deployment_id,
                        "rolled_out",
                        Some(&format!(
                            "helm release {}/{} revision {} status {}",
                            result.namespace, result.release, result.revision, result.status
                        )),
                    )
                    .await;
                    ("ROLLED_OUT".to_string(), endpoints.clone())
                }
                Ok(Err(e)) => {
                    // Log the full helm stderr at ERROR. Without this the only
                    // record of *why* a deploy failed lived in the hiqlite
                    // `deployment_events` row (session-gated GET), so the pod
                    // logs showed nothing and operators were told to "see
                    // deployd logs" that contained no clue. HelmError's Display
                    // carries the captured stderr tail.
                    tracing::error!(
                        deployment_id = %deployment_id,
                        "helm install failed: {e}"
                    );
                    let _ = store::update_status(&state.client, &deployment_id, "FAILED").await;
                    let _ = store::add_event(
                        &state.client,
                        &deployment_id,
                        "failed",
                        Some(&format!("helm install failed: {e}")),
                    )
                    .await;
                    ("FAILED".to_string(), endpoints.clone())
                }
                Err(join_err) => {
                    tracing::error!(
                        deployment_id = %deployment_id,
                        "helm task join error: {join_err}"
                    );
                    let _ = store::update_status(&state.client, &deployment_id, "FAILED").await;
                    let _ = store::add_event(
                        &state.client,
                        &deployment_id,
                        "failed",
                        Some(&format!("helm task join error: {join_err}")),
                    )
                    .await;
                    ("FAILED".to_string(), endpoints.clone())
                }
            }
        }
        Err(_) => {
            let _ = store::update_status(&state.client, &deployment_id, "ROLLED_OUT").await;
            let _ = store::add_event(
                &state.client,
                &deployment_id,
                "rolled_out",
                Some("deployment recorded (no K8s cluster)"),
            )
            .await;
            ("ROLLED_OUT".to_string(), endpoints.clone())
        }
    };

    (
        StatusCode::OK,
        Json(json!({
            "release_id": deployment_id,
            "status": final_status,
            "endpoints": final_endpoints,
            "logs_pointer": format!("/v1/deployments/{}/logs", deployment_id),
            "chart": chart,
            "chart_version": chart_version,
        })),
    )
}

pub async fn get_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(release_id): Path<String>,
) -> impl IntoResponse {
    let claims = match auth::verify_jwt(
        &headers,
        &state.config.oidc_endpoint,
        &state.config.audience,
    )
    .await
    {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "unauthorized", "message": e.to_string()})),
            );
        }
    };
    if !auth::has_scope(&claims, &state.config.required_scope) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "forbidden",
                "message": format!("missing scope {}", state.config.required_scope)
            })),
        );
    }

    match store::get_by_release_id(&state.client, &release_id).await {
        Ok(Some(d)) => {
            // Existence oracle (finding LOW): a non-owner caller who is
            // authenticated and scoped must not be able to distinguish "this
            // deployment exists but isn't mine" from "this deployment
            // doesn't exist". Both cases now return the exact same
            // NOT_FOUND response as the missing-release branch below.
            if !auth::is_owner_or_admin(
                &claims,
                d.owner_sub.as_deref(),
                state.config.admin_scope.as_deref(),
            ) {
                return (StatusCode::NOT_FOUND, Json(json!({"error": "not_found"})));
            }
            let events = store::get_events(&state.client, &release_id)
                .await
                .unwrap_or_default();
            (
                StatusCode::OK,
                Json(json!({
                    "release_id": d.deployment_id,
                    "status": d.status,
                    "events": events,
                })),
            )
        }
        _ => (StatusCode::NOT_FOUND, Json(json!({"error": "not_found"}))),
    }
}

pub async fn get_logs(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(release_id): Path<String>,
) -> impl IntoResponse {
    let claims = match auth::verify_jwt(
        &headers,
        &state.config.oidc_endpoint,
        &state.config.audience,
    )
    .await
    {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "unauthorized", "message": e.to_string()})),
            );
        }
    };
    if !auth::has_scope(&claims, &state.config.required_scope) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "forbidden",
                "message": format!("missing scope {}", state.config.required_scope)
            })),
        );
    }

    match store::get_by_release_id(&state.client, &release_id).await {
        Ok(Some(d)) => {
            // Existence oracle (finding LOW): see get_status's identical
            // comment. A non-owner caller gets the same NOT_FOUND response
            // as a missing release, not a distinguishing FORBIDDEN.
            if !auth::is_owner_or_admin(
                &claims,
                d.owner_sub.as_deref(),
                state.config.admin_scope.as_deref(),
            ) {
                return (StatusCode::NOT_FOUND, Json(json!({"error": "not_found"})));
            }
            let events = store::get_events(&state.client, &release_id)
                .await
                .unwrap_or_default();
            (
                StatusCode::OK,
                Json(json!({
                    "release_id": release_id,
                    "logs": events,
                })),
            )
        }
        _ => (StatusCode::NOT_FOUND, Json(json!({"error": "not_found"}))),
    }
}

pub async fn delete_deployment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(release_id): Path<String>,
) -> impl IntoResponse {
    // Auth
    let claims = match auth::verify_jwt(
        &headers,
        &state.config.oidc_endpoint,
        &state.config.audience,
    )
    .await
    {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "unauthorized", "message": e.to_string()})),
            );
        }
    };
    if !auth::has_scope(&claims, &state.config.required_scope) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "forbidden",
                "message": format!("missing scope {}", state.config.required_scope)
            })),
        );
    }

    let deployment = match store::get_by_release_id(&state.client, &release_id).await {
        Ok(Some(d)) => d,
        _ => return (StatusCode::NOT_FOUND, Json(json!({"error": "not_found"}))),
    };

    // Existence oracle (finding LOW): see get_status's identical comment.
    // A non-owner caller gets the same NOT_FOUND response as a missing
    // release, not a distinguishing FORBIDDEN.
    if !auth::is_owner_or_admin(
        &claims,
        deployment.owner_sub.as_deref(),
        state.config.admin_scope.as_deref(),
    ) {
        return (StatusCode::NOT_FOUND, Json(json!({"error": "not_found"})));
    }

    // Best-effort helm uninstall; ignore failure to keep delete idempotent.
    // Spec 137 — `uninstall_with_gate` is the universal teardown: it removes
    // the gate release first (no-op if no gate was installed for this
    // deployment) and then the tenant. Both halves treat "release not found"
    // as success, so the call is correct whether the deployment had a gate or
    // not — no per-deployment branch needed.
    if k8s::probe_cluster().await.is_ok() {
        // Spec 214 FR-008: tear down using the recorded namespace; fall back
        // to the computed form for legacy rows written before the column.
        let namespace = deployment
            .namespace
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("{}-{}", deployment.app_id, deployment.env_id));
        let release = deployment
            .app_slug
            .clone()
            .unwrap_or_else(|| deployment.app_id.clone());

        // Spec 225 FR-007: self-provision the workloads RoleBinding before
        // teardown. Once the cluster-wide workloads fallback is dropped
        // (`rbac.selfProvision: true`), a namespace created before the flip and
        // never redeployed has no RoleBinding, so `helm uninstall` would hit
        // Forbidden and the best-effort uninstall below would swallow it,
        // orphaning the namespace's k8s resources. `ensure_workload_rbac_for_teardown`
        // provisions it (into the existing namespace only; it will not
        // resurrect a namespace already gone, and its internal
        // `is_valid_tenant_namespace` guard refuses a reserved / untrusted
        // recorded-or-fallback namespace) so this delete tears the namespace
        // down cleanly. Best-effort: a failure (including the guard rejecting a
        // bad namespace) is logged and recorded as an event, and the delete
        // still proceeds so it stays idempotent, matching the uninstall it
        // precedes. A no-op under the default cluster-wide fallback (opt-in on
        // env).
        let self_provision = crate::rbac::SelfProvisionConfig::from_env();
        if let Err(e) =
            crate::rbac::ensure_workload_rbac_for_teardown(&namespace, &self_provision).await
        {
            tracing::warn!("self-provision RBAC before teardown failed for {release_id}: {e}");
            let cause = sanitize_event_detail(&e.to_string());
            let _ = store::add_event(
                &state.client,
                &release_id,
                "rbac_warning",
                Some(&format!(
                    "teardown self-provision RBAC failed for namespace {namespace}: {cause}; uninstall attempted best-effort"
                )),
            )
            .await;
        }

        let runner = HelmRunner::from_env();
        let result = tokio::task::spawn_blocking(move || {
            runner.uninstall_with_gate(&namespace, &release)
        })
        .await;
        match result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => tracing::warn!("helm uninstall failed for {release_id}: {e}"),
            Err(join_err) => tracing::warn!("helm task join error for {release_id}: {join_err}"),
        }
    }

    let _ = store::update_status(&state.client, &release_id, "DESTROYED").await;
    let _ = store::add_event(
        &state.client,
        &release_id,
        "destroyed",
        Some("deployment destroyed"),
    )
    .await;

    (
        StatusCode::OK,
        Json(json!({
            "release_id": release_id,
            "status": "DESTROYED",
        })),
    )
}

/// Cap and single-line an untrusted error cause before it lands in the
/// append-only event store. `kube::Error::to_string()` can embed a Kubernetes
/// API response body, so without this an error could inject newlines (splitting
/// an audit-log line) or unbounded content into a deployment's event trail, or
/// embed Unicode bidi / zero-width formatting that visually spoofs a line in a
/// rich log viewer. Callers interpolate the already-validated `namespace`
/// (restricted to `[a-z0-9-]`) directly and pass only the untrusted cause here.
fn sanitize_event_detail(cause: &str) -> String {
    const MAX_CHARS: usize = 500;
    // Flatten anything that can break, spoof, or hide a log line, by category
    // rather than by enumerating codepoints:
    //   - C0/C1 control chars (newlines, etc.) via `is_control()`;
    //   - every other Unicode whitespace / line + paragraph separator (U+2028,
    //     U+2029, no-break and figure spaces, ...) except a plain space, via
    //     `is_whitespace()`, which is what `is_control()` alone misses;
    //   - the non-whitespace bidi / zero-width / format chars neither predicate
    //     covers: bidi overrides + isolates (U+202A-202E, U+2066-2069), the
    //     directional marks + zero-width joiners (U+200B-200F), and the BOM.
    let is_unsafe = |c: char| {
        c.is_control()
            || (c.is_whitespace() && c != ' ')
            || matches!(c,
                '\u{200B}'..='\u{200F}'
                | '\u{202A}'..='\u{202E}'
                | '\u{2066}'..='\u{2069}'
                | '\u{FEFF}')
    };
    // Single pass: drain MAX_CHARS sanitized chars, then peek one more to learn
    // whether truncation occurred without re-walking the input.
    let mut chars = cause.chars().map(|c| if is_unsafe(c) { ' ' } else { c });
    let mut out: String = chars.by_ref().take(MAX_CHARS).collect();
    if chars.next().is_some() {
        out.push_str("...(truncated)");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_event_detail_flattens_control_chars() {
        // Newlines/tabs/carriage returns become spaces so a kube error body
        // cannot split or inject audit-log lines.
        assert_eq!(sanitize_event_detail("a\nb\tc\rd"), "a b c d");
        assert_eq!(sanitize_event_detail("all good"), "all good");
    }

    #[test]
    fn sanitize_event_detail_truncates_unbounded_input() {
        let out = sanitize_event_detail(&"x".repeat(600));
        assert!(out.ends_with("...(truncated)"));
        // 500 kept chars + the marker, nothing more.
        assert_eq!(out.chars().count(), 500 + "...(truncated)".chars().count());
    }

    #[test]
    fn sanitize_event_detail_keeps_exactly_max_chars_untruncated() {
        // Exactly MAX_CHARS (500) is emitted unchanged: guards the truncation
        // bound against an off-by-one drift from `>` to `>=`.
        let input = "a".repeat(500);
        assert_eq!(sanitize_event_detail(&input), input);
    }

    #[test]
    fn sanitize_event_detail_flattens_separators_and_formatting() {
        // Visual log-spoofing / line-injection vectors that `is_control()`
        // alone does not catch, all flattened to spaces before the audit trail:
        // bidi override, zero-width space, BOM, isolate,
        assert_eq!(sanitize_event_detail("a\u{202E}b\u{200B}c"), "a b c");
        assert_eq!(sanitize_event_detail("x\u{FEFF}y"), "x y");
        assert_eq!(sanitize_event_detail("i\u{2066}j"), "i j");
        // and the Unicode LINE / PARAGRAPH separators (U+2028 / U+2029), which
        // act as line breaks in many log viewers but are not C0/C1 controls.
        assert_eq!(sanitize_event_detail("p\u{2028}q\u{2029}r"), "p q r");
    }
}
