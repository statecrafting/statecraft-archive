// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/185-sandbox-local-container-backend/spec.md — §3 FR-010

//! Runtime descriptor: an opaque base64-encoded JSON byte string that
//! the governance-certificate verifier treats as a fingerprint. Spec
//! 162 §FR-008 binds it into the certificate's canonical-hash inputs;
//! spec 185 §FR-010 defines its content for the local-container
//! backend.
//!
//! The JSON shape is documented here for diagnostic introspection;
//! the verifier does not parse it.

use crate::runtime::DetectedRuntime;
use base64::Engine;
use bollard::system::Version;

/// Build the descriptor:
/// `base64(`<code>{"backend":"local-container","version":"<v>","runtime":"<r>","runtime_version":"<rv>"}</code>`)`
///
/// Key order is fixed (insertion order via manual string composition,
/// not serde_json) so the resulting base64 is deterministic for a
/// given (backend_version, runtime, runtime_version) triple.
pub(crate) fn build(
    backend_version: &str,
    runtime: DetectedRuntime,
    version: &Version,
) -> String {
    let runtime_version = version.version.as_deref().unwrap_or("unknown");
    let json = format!(
        r#"{{"backend":"local-container","version":"{}","runtime":"{}","runtime_version":"{}"}}"#,
        json_escape(backend_version),
        runtime.as_str(),
        json_escape(runtime_version),
    );
    base64::engine::general_purpose::STANDARD.encode(json.as_bytes())
}

/// Escape `"` and `\` for raw inclusion in a JSON string literal. Other
/// control characters do not appear in backend / runtime version
/// strings; if a future caller surfaces newlines, this helper will
/// need to grow.
fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn version_with(s: &str) -> Version {
        Version {
            version: Some(s.into()),
            ..Default::default()
        }
    }

    #[test]
    fn descriptor_is_deterministic_and_decodable() {
        let v = version_with("28.0.0");
        let a = build("0.1.0", DetectedRuntime::Docker, &v);
        let b = build("0.1.0", DetectedRuntime::Docker, &v);
        assert_eq!(a, b);

        let decoded = base64::engine::general_purpose::STANDARD
            .decode(a.as_bytes())
            .unwrap();
        let json = std::str::from_utf8(&decoded).unwrap();
        assert!(json.contains(r#""backend":"local-container""#));
        assert!(json.contains(r#""version":"0.1.0""#));
        assert!(json.contains(r#""runtime":"docker""#));
        assert!(json.contains(r#""runtime_version":"28.0.0""#));
    }

    #[test]
    fn descriptor_distinguishes_docker_vs_podman() {
        let v = version_with("28.0.0");
        let docker = build("0.1.0", DetectedRuntime::Docker, &v);
        let podman = build("0.1.0", DetectedRuntime::Podman, &v);
        assert_ne!(docker, podman);
    }

    #[test]
    fn descriptor_handles_missing_runtime_version() {
        let v = Version::default();
        let d = build("0.1.0", DetectedRuntime::Docker, &v);
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(d.as_bytes())
            .unwrap();
        let json = std::str::from_utf8(&decoded).unwrap();
        assert!(json.contains(r#""runtime_version":"unknown""#));
    }

    #[test]
    fn descriptor_escapes_quotes_in_inputs() {
        let v = version_with(r#"4.0"injected"#);
        let d = build("0.1.0", DetectedRuntime::Podman, &v);
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(d.as_bytes())
            .unwrap();
        let json = std::str::from_utf8(&decoded).unwrap();
        assert!(json.contains(r#""runtime_version":"4.0\"injected""#));
        // And the JSON parses cleanly.
        let _: serde_json::Value = serde_json::from_str(json).unwrap();
    }
}
