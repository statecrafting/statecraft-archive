//! Prometheus text exposition for deployd-api (spec 196 FR-003).
//!
//! Hand-rolled format-0.0.4 output — no metrics crate: the contract is
//! a stable, known series (`deployd_api_build_info`) the platform
//! metrics stack can assert on (spec 196 SC-002), not an
//! instrumentation framework.
//!
//! The route is deliberately unauthenticated at the router layer (like
//! `/healthz`): Prometheus cannot perform the OIDC client_credentials
//! dance on a scrape. Inbound containment is the
//! ingress←monitoring-only NetworkPolicy on this namespace (spec 196
//! FR-006 (b)); nothing exposed here is sensitive — build identity and
//! uptime only.

use axum::http::{StatusCode, header};
use axum::response::IntoResponse;
use std::sync::OnceLock;
use std::time::Instant;

static PROCESS_START: OnceLock<Instant> = OnceLock::new();

/// Record process start time. Called once from `main` before serving;
/// idempotent.
pub fn mark_start() {
    let _ = PROCESS_START.set(Instant::now());
}

fn render(uptime_seconds: f64) -> String {
    format!(
        "# HELP deployd_api_build_info Build identity of the running deployd-api.\n\
         # TYPE deployd_api_build_info gauge\n\
         deployd_api_build_info{{version=\"{}\"}} 1\n\
         # HELP deployd_api_uptime_seconds Seconds since process start.\n\
         # TYPE deployd_api_uptime_seconds gauge\n\
         deployd_api_uptime_seconds {}\n",
        env!("CARGO_PKG_VERSION"),
        uptime_seconds
    )
}

/// GET /metrics — Prometheus text exposition (format 0.0.4).
pub async fn metrics() -> impl IntoResponse {
    let uptime = PROCESS_START
        .get()
        .map(|s| s.elapsed().as_secs_f64())
        .unwrap_or(0.0);
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/plain; version=0.0.4")],
        render(uptime),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposition_carries_the_sc002_anchor_series() {
        let body = render(12.5);
        assert!(body.contains("deployd_api_build_info{version=\""));
        assert!(body.contains("} 1\n"));
        assert!(body.contains("deployd_api_uptime_seconds 12.5\n"));
    }
}
