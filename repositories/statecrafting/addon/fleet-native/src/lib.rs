//! fleet-native: the control plane's fleet placement core as a napi-rs addon.
//!
//! Native `kube-rs` construction of the EnRaHiTu placement shape (statecraft spec 006 §3):
//! one Namespace per tenant with namespace-scoped deny-all + egress
//! NetworkPolicies, and per app one PVC, Deployment (single replica,
//! Recreate), ClusterIP Service, nginx Ingress (cert-manager DNS-01 TLS), and
//! a port-pinned ingress-allow NetworkPolicy. The Encore.ts `fleet/` service
//! drives it as
//! plain-JSON-in / plain-JSON-out async functions: `placeApp`, `appStatus`,
//! `updateApp`, `backupApp`, `removeApp`.
//!
//! Not a port of deployd-api-rs (which shells out to `helm`; statecraft spec
//! 006 §1): the
//! resource *shapes* come from its `acme-vue-encore` chart and the kube-rs
//! *patterns* (client resolution, create-or-tolerate-409, DNS-1123 namespace
//! validation) from its `rbac.rs`, reimplemented here.
//!
//! The pure builders in [`resources`] are unit-tested with
//! `cargo test --no-default-features` (no cluster, no Node C API). The live
//! cluster I/O ([`kube_ops`]) and the `#[napi]` bindings ([`napi_api`]) are
//! compiled only under the default `node` feature.

// Under `--no-default-features` the kube I/O and napi layers are cfg'd out, so
// some builder outputs read as unused. Silence only that degenerate case.
#![cfg_attr(not(feature = "node"), allow(dead_code))]

mod naming;
mod resources;
mod types;

#[cfg(feature = "node")]
mod kube_ops;
#[cfg(feature = "node")]
mod napi_api;
