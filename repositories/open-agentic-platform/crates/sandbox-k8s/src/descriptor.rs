// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/186-sandbox-k8s-backend/spec.md — §2.7, §3 FR-002

//! Opaque `runtime_descriptor` encoder for the K8s sandbox backend.
//!
//! Per spec 162 §FR-008 the certificate's `runtime_descriptor` is an
//! opaque byte string: the verifier treats it as a binary fingerprint
//! and does not parse it. Backends are free to format the pre-encoded
//! bytes deterministically. Spec 186 §2.7 pins the K8s backend's shape
//! as a canonical-JSON object with five fields, base64 (standard,
//! no-pad) encoded.
//!
//! Canonical JSON here means sorted-key serialisation via
//! `serde_json::to_vec` against a struct whose fields are serialised
//! in declaration order — `serde_json` already preserves struct field
//! order, and the type is private so the order is locked at the
//! shape's source.

use base64::Engine;
use serde::Serialize;

/// Inputs to the descriptor encoder. Owned strings so callers can
/// freely move data through the lifecycle without lifetime gymnastics.
pub(crate) struct Descriptor {
    pub backend: &'static str,
    pub backend_version: String,
    pub kube_version: String,
    pub runtime_class: String,
    pub isolation_tier: u8,
}

#[derive(Serialize)]
struct DescriptorPayload<'a> {
    backend: &'a str,
    #[serde(rename = "backendVersion")]
    backend_version: &'a str,
    #[serde(rename = "kubeVersion")]
    kube_version: &'a str,
    #[serde(rename = "runtimeClass")]
    runtime_class: &'a str,
    #[serde(rename = "isolationTier")]
    isolation_tier: u8,
}

/// Encode a [`Descriptor`] to base64(canonical-JSON). The output is
/// stable for fixed inputs (same backend version, kube version,
/// runtime class, tier) — that determinism is what spec 162
/// §FR-008 binds against in the certificate hash chain.
pub(crate) fn encode(d: &Descriptor) -> String {
    let payload = DescriptorPayload {
        backend: d.backend,
        backend_version: &d.backend_version,
        kube_version: &d.kube_version,
        runtime_class: &d.runtime_class,
        isolation_tier: d.isolation_tier,
    };
    let bytes = serde_json::to_vec(&payload).expect("DescriptorPayload serialises infallibly");
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d() -> Descriptor {
        Descriptor {
            backend: "k8s",
            backend_version: "0.1.0".into(),
            kube_version: "v1.31.2".into(),
            runtime_class: "gvisor".into(),
            isolation_tier: 1,
        }
    }

    #[test]
    fn encode_is_deterministic() {
        let a = encode(&d());
        let b = encode(&d());
        assert_eq!(a, b);
    }

    #[test]
    fn encode_round_trips_via_base64_to_json() {
        let s = encode(&d());
        let bytes = base64::engine::general_purpose::STANDARD.decode(&s).unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["backend"], "k8s");
        assert_eq!(json["backendVersion"], "0.1.0");
        assert_eq!(json["kubeVersion"], "v1.31.2");
        assert_eq!(json["runtimeClass"], "gvisor");
        assert_eq!(json["isolationTier"], 1);
    }

    #[test]
    fn encode_uses_camel_case_keys() {
        // The encoded bytes contain the wire-format keys verbatim,
        // not the Rust field names. Spec 186 §2.7 pins camelCase.
        let s = encode(&d());
        let bytes = base64::engine::general_purpose::STANDARD.decode(&s).unwrap();
        let body = String::from_utf8(bytes).unwrap();
        assert!(body.contains("\"backendVersion\""));
        assert!(body.contains("\"kubeVersion\""));
        assert!(body.contains("\"runtimeClass\""));
        assert!(body.contains("\"isolationTier\""));
    }

    #[test]
    fn tier_2_default_runc_descriptor() {
        let d = Descriptor {
            backend: "k8s",
            backend_version: "0.1.0".into(),
            kube_version: "v1.30.5".into(),
            runtime_class: "default-runc".into(),
            isolation_tier: 2,
        };
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encode(&d))
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["isolationTier"], 2);
        assert_eq!(json["runtimeClass"], "default-runc");
    }
}
