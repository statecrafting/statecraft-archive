// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/186-sandbox-k8s-backend/spec.md — §2.1, §3 FR-001, FR-005

//! Runtime state for the K8s sandbox backend.
//!
//! Two states:
//!
//! - `Unavailable` — no usable kube-rs client (`Client::try_default`
//!   failed, namespace absent, apiserver RuntimeClass.list returned
//!   non-200). The diagnostic is surfaced verbatim through
//!   [`SandboxError::Unavailable`](
//!   factory_engine::sandbox::SandboxError::Unavailable).
//! - `Connected` — kube-rs client built, namespace verified, installed
//!   `RuntimeClass` set probed and the [`Selection`] frozen for the
//!   life of this client. The apiserver kube-version is captured for
//!   the certificate descriptor.
//!
//! Construction is async because `Client::try_default` is async and
//! the namespace + RuntimeClass list calls are I/O.

use k8s_openapi::api::core::v1::Namespace;
use k8s_openapi::api::node::v1::RuntimeClass;
use kube::api::ListParams;
use kube::{Api, Client};

use crate::runtime_class::{self, Selection};

pub(crate) enum RuntimeState {
    Unavailable {
        diagnostic: String,
    },
    Connected {
        client: Client,
        namespace: String,
        kube_version: String,
        selection: Selection,
    },
}

impl RuntimeState {
    /// Probe the operator's cluster following spec 186 §2.1.
    ///
    /// 1. Build a `Client` via `Client::try_default` (in-cluster →
    ///    kubeconfig fallback).
    /// 2. Fetch the apiserver version (for the certificate
    ///    `runtime_descriptor`).
    /// 3. Verify the execution namespace exists.
    /// 4. List installed RuntimeClasses and freeze the
    ///    [`Selection`] (§2.4).
    ///
    /// Any failure transitions to [`RuntimeState::Unavailable`] with a
    /// diagnostic naming the failed step + the underlying error. No
    /// host fallback is attempted under any condition (spec 162 FR-009).
    pub(crate) async fn probe(namespace: &str) -> Self {
        let client = match Client::try_default().await {
            Ok(c) => c,
            Err(e) => {
                return Self::Unavailable {
                    diagnostic: format!(
                        "spec 186 §2.1: kube-rs Client::try_default failed (no kubeconfig \
                         and not running in-cluster, or kubeconfig invalid): {e}"
                    ),
                };
            }
        };

        let kube_version = match client.apiserver_version().await {
            Ok(info) => format!("v{}.{}", info.major, info.minor),
            Err(e) => {
                return Self::Unavailable {
                    diagnostic: format!(
                        "spec 186 §2.1: apiserver version probe failed (cluster \
                         unreachable or apiserver not ready): {e}"
                    ),
                };
            }
        };

        let nss: Api<Namespace> = Api::all(client.clone());
        if let Err(e) = nss.get(namespace).await {
            return Self::Unavailable {
                diagnostic: format!(
                    "spec 186 §2.1: execution namespace '{namespace}' is absent or \
                     unreadable (operator must pre-create it with PodSecurity \
                     restricted labels): {e}"
                ),
            };
        }

        let rcs: Api<RuntimeClass> = Api::all(client.clone());
        let installed = match rcs.list(&ListParams::default()).await {
            Ok(list) => list
                .items
                .into_iter()
                .filter_map(|rc| rc.metadata.name)
                .collect::<Vec<_>>(),
            Err(e) => {
                return Self::Unavailable {
                    diagnostic: format!(
                        "spec 186 §2.4: RuntimeClass list failed (insufficient RBAC \
                         or apiserver error): {e}"
                    ),
                };
            }
        };
        let selection = runtime_class::select(&installed);

        Self::Connected {
            client,
            namespace: namespace.to_string(),
            kube_version,
            selection,
        }
    }
}
