// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/082-artifact-integrity-platform-hardening/spec.md — FR-030, FR-031

//! Namespaced contract ID convention (082 Phase 4).
//!
//! All new contract identifiers follow the pattern:
//! `dev.oap.{domain}.{type}.{name}`
//!
//! Existing identifiers are grandfathered — this convention applies only to
//! newly created contracts.

/// Well-known namespace prefix for tool contracts.
pub const NS_TOOL: &str = "dev.oap.tool";
/// Well-known namespace prefix for factory contracts.
pub const NS_FACTORY: &str = "dev.oap.factory";
/// Well-known namespace prefix for policy contracts.
pub const NS_POLICY: &str = "dev.oap.policy";
/// Well-known namespace prefix for event contracts.
pub const NS_EVENT: &str = "dev.oap.event";
/// Well-known namespace prefix for adapter contracts.
pub const NS_ADAPTER: &str = "dev.oap.adapter";

/// Parsed components of a namespaced contract ID.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NamespaceParts {
    /// Organisation prefix, e.g. `"dev.oap"`.
    pub org: String,
    /// Domain, e.g. `"tool"`, `"factory"`.
    pub domain: String,
    /// Type within the domain, e.g. `"core"`, `"stage"`.
    pub type_name: String,
    /// Specific identifier, e.g. `"file_read"`.
    pub name: String,
}

/// Check whether a string conforms to the OAP namespace convention.
///
/// Valid format: `{org1}.{org2}.{domain}.{type}.{name}[.{extra}]*`
/// where each segment starts with a lowercase letter and contains only
/// `[a-z0-9_-]`.
pub fn is_valid_namespace(id: &str) -> bool {
    let segments: Vec<&str> = id.split('.').collect();
    if segments.len() < 4 {
        return false;
    }
    segments.iter().all(|s| is_valid_segment(s))
}

/// Parse a namespaced ID into its components.
///
/// Returns `None` if the ID doesn't conform to the convention.
pub fn parse_namespace(id: &str) -> Option<NamespaceParts> {
    let segments: Vec<&str> = id.split('.').collect();
    if segments.len() < 4 || !segments.iter().all(|s| is_valid_segment(s)) {
        return None;
    }

    // First two segments form the org prefix (e.g., "dev.oap")
    let org = format!("{}.{}", segments[0], segments[1]);
    let domain = segments[2].to_string();
    let type_name = segments[3].to_string();
    // Remaining segments (if any) form the name
    let name = if segments.len() > 4 {
        segments[4..].join(".")
    } else {
        // Exactly 4 segments: type_name doubles as the name
        type_name.clone()
    };

    Some(NamespaceParts {
        org,
        domain,
        type_name,
        name,
    })
}

fn is_valid_segment(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let first = s.as_bytes()[0];
    if !first.is_ascii_lowercase() {
        return false;
    }
    s.bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_namespaces() {
        assert!(is_valid_namespace("dev.oap.tool.core.file_read"));
        assert!(is_valid_namespace(
            "dev.oap.factory.stage.s1-business-requirements"
        ));
        assert!(is_valid_namespace("dev.oap.policy.gate.secrets_scanner"));
        assert!(is_valid_namespace("dev.oap.event.workflow.step_completed"));
        assert!(is_valid_namespace("com.example.adapter.stack.custom-stack"));
    }

    #[test]
    fn invalid_namespaces() {
        assert!(!is_valid_namespace("file_read")); // too few segments
        assert!(!is_valid_namespace("dev.oap.tool")); // only 3 segments
        assert!(!is_valid_namespace("")); // empty
        assert!(!is_valid_namespace("Dev.Oap.tool.core")); // uppercase
        assert!(!is_valid_namespace("dev.oap.tool.")); // trailing dot (empty segment)
        assert!(!is_valid_namespace("dev.oap.123.core")); // starts with digit
    }

    #[test]
    fn parse_five_segments() {
        let parts = parse_namespace("dev.oap.tool.core.file_read").unwrap();
        assert_eq!(parts.org, "dev.oap");
        assert_eq!(parts.domain, "tool");
        assert_eq!(parts.type_name, "core");
        assert_eq!(parts.name, "file_read");
    }

    #[test]
    fn parse_four_segments() {
        let parts = parse_namespace("dev.oap.tool.core").unwrap();
        assert_eq!(parts.org, "dev.oap");
        assert_eq!(parts.domain, "tool");
        assert_eq!(parts.type_name, "core");
        assert_eq!(parts.name, "core");
    }

    #[test]
    fn parse_extra_segments_join_into_name() {
        let parts = parse_namespace("dev.oap.factory.stage.s6b.data.user").unwrap();
        assert_eq!(parts.org, "dev.oap");
        assert_eq!(parts.domain, "factory");
        assert_eq!(parts.type_name, "stage");
        assert_eq!(parts.name, "s6b.data.user");
    }

    #[test]
    fn parse_invalid_returns_none() {
        assert!(parse_namespace("file_read").is_none());
        assert!(parse_namespace("").is_none());
    }

    #[test]
    fn constants_are_valid_prefixes() {
        // The constants themselves are 3-segment prefixes, not full namespace IDs.
        // Appending a type+name should produce a valid namespace.
        let full = format!("{}.core.file_read", NS_TOOL);
        assert!(is_valid_namespace(&full));

        let full = format!("{}.stage.s1", NS_FACTORY);
        assert!(is_valid_namespace(&full));
    }
}
