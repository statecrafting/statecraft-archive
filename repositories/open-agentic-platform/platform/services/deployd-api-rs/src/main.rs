use anyhow::{Context, Result};
use axum::{
    Router,
    routing::{delete, get, post},
};
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

mod auth;
mod config;
mod helm;
mod k8s;
mod metrics;
mod rbac;
mod routes;
mod store;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("deployd_api=info".parse()?))
        .init();

    metrics::mark_start();

    let cfg = config::Config::from_env();
    tracing::info!("deployd-api starting on :{}", cfg.port);

    let data_dir =
        std::env::var("DEPLOYD_DATA_DIR").unwrap_or_else(|_| "/var/lib/deployd/data".into());
    std::fs::create_dir_all(&data_dir)
        .with_context(|| format!("failed to create data dir: {data_dir}"))?;

    if let Ok(restore) = std::env::var("HQL_BACKUP_RESTORE") {
        tracing::warn!(
            source = %restore,
            "HQL_BACKUP_RESTORE is set — hiqlite will WIPE the data dir and restore from this snapshot. \
             Per the spec 145 runbook, UNSET this env var (kubectl set env deployment/deployd-api HQL_BACKUP_RESTORE-) \
             after the restore succeeds so subsequent pod restarts do not re-wipe."
        );
    }

    tracing::info!(data_dir = %data_dir, "initialising hiqlite store");
    let client = store::init_db(&data_dir).await?;
    tracing::info!("hiqlite store ready");

    let state = Arc::new(store::AppState {
        client,
        config: cfg.clone(),
    });

    let app = Router::new()
        .route("/healthz", get(routes::healthz))
        .route("/metrics", get(metrics::metrics))
        .route("/v1/deployments", post(routes::create_deployment))
        .route(
            "/v1/deployments/{releaseId}/status",
            get(routes::get_status),
        )
        .route("/v1/deployments/{releaseId}/logs", get(routes::get_logs))
        .route(
            "/v1/deployments/{releaseId}",
            delete(routes::delete_deployment),
        )
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", cfg.port)).await?;
    tracing::info!("listening on :{}", cfg.port);
    axum::serve(listener, app).await?;
    Ok(())
}
