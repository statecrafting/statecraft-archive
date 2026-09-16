// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/102-governed-excellence/spec.md — FR-033, FR-037

//! Output filter — scans agent output for secrets before writing artifacts.
//!
//! FR-033: Checks for AWS keys, Azure connection strings, private keys, JWT tokens,
//!         API keys matching `sk-`, `AKIA`, `-----BEGIN`.
//! FR-037: Pattern set is configurable per adapter via `security.output_filter_patterns`.
//! NF-009: Must process at least 10 MB/s.

use regex::Regex;
use std::sync::OnceLock;

/// Result of scanning content for secrets.
#[derive(Debug, Clone)]
pub struct FilterResult {
    pub clean: bool,
    pub findings: Vec<SecretFinding>,
}

/// A single secret finding in the output.
#[derive(Debug, Clone)]
pub struct SecretFinding {
    pub pattern_id: String,
    pub description: String,
    /// Byte offset in the content where the match starts.
    pub offset: usize,
    /// Redacted preview of the matched content.
    pub redacted_preview: String,
}

/// Default secret patterns (FR-033).
fn default_patterns() -> &'static [(&'static str, &'static str, Regex)] {
    static PATTERNS: OnceLock<Vec<(&str, &str, Regex)>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            (
                "aws-access-key",
                "AWS access key ID",
                Regex::new(r"AKIA[0-9A-Z]{16}").expect("regex"),
            ),
            (
                "private-key",
                "Private key block",
                Regex::new(r"-----BEGIN [A-Z ]*PRIVATE KEY-----").expect("regex"),
            ),
            (
                "sk-api-key",
                "API key with sk- prefix",
                Regex::new(r"sk-[a-zA-Z0-9]{20,}").expect("regex"),
            ),
            (
                "azure-connection-string",
                "Azure Storage connection string",
                Regex::new(r"(?i)DefaultEndpointsProtocol=https?;AccountName=").expect("regex"),
            ),
            (
                "jwt-token",
                "JWT token (3-part base64)",
                Regex::new(r"eyJ[a-zA-Z0-9_-]{20,}\.eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}")
                    .expect("regex"),
            ),
            (
                "generic-secret",
                "Generic secret/token assignment",
                Regex::new(r#"(?i)(api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"]?[a-zA-Z0-9_\-]{32,}"#)
                    .expect("regex"),
            ),
        ]
    })
}

/// Scan content for secrets using the default pattern set.
pub fn scan_content(content: &str) -> FilterResult {
    scan_with_patterns(content, default_patterns())
}

/// Scan content with a specific pattern set.
fn scan_with_patterns(content: &str, patterns: &[(&str, &str, Regex)]) -> FilterResult {
    let mut findings = Vec::new();

    for (id, desc, re) in patterns {
        for mat in re.find_iter(content) {
            let matched = mat.as_str();
            // Redact: show first 4 and last 2 chars, mask the rest.
            let redacted = if matched.len() > 8 {
                format!("{}...{}", &matched[..4], &matched[matched.len() - 2..])
            } else {
                "***".to_string()
            };

            findings.push(SecretFinding {
                pattern_id: id.to_string(),
                description: desc.to_string(),
                offset: mat.start(),
                redacted_preview: redacted,
            });
        }
    }

    FilterResult {
        clean: findings.is_empty(),
        findings,
    }
}

/// Scan a file's contents for secrets.
pub fn scan_file(path: &std::path::Path) -> std::io::Result<FilterResult> {
    let content = std::fs::read_to_string(path)?;
    Ok(scan_content(&content))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_content_passes() {
        let result = scan_content("const x = 42;\nfunction hello() { return 'world'; }");
        assert!(result.clean);
        assert!(result.findings.is_empty());
    }

    #[test]
    fn detects_aws_key() {
        let result = scan_content("aws_key = AKIAIOSFODNN7EXAMPLE");
        assert!(!result.clean);
        assert_eq!(result.findings.len(), 1);
        assert_eq!(result.findings[0].pattern_id, "aws-access-key");
    }

    #[test]
    fn detects_private_key() {
        let result = scan_content("-----BEGIN RSA PRIVATE KEY-----\nMIIEow...");
        assert!(!result.clean);
        assert!(
            result
                .findings
                .iter()
                .any(|f| f.pattern_id == "private-key")
        );
    }

    #[test]
    fn detects_sk_api_key() {
        let result = scan_content("api_key: sk-abcdefghijklmnopqrstuvwxyz");
        assert!(!result.clean);
        assert!(result.findings.iter().any(|f| f.pattern_id == "sk-api-key"));
    }

    #[test]
    fn detects_azure_connection_string() {
        let result = scan_content(
            "conn = DefaultEndpointsProtocol=https;AccountName=myaccount;AccountKey=abc123",
        );
        assert!(!result.clean);
        assert!(
            result
                .findings
                .iter()
                .any(|f| f.pattern_id == "azure-connection-string")
        );
    }

    #[test]
    fn detects_jwt_token() {
        // Synthetic JWT-like token (three base64url parts).
        let jwt = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.Sn9hub_ZB_mDN8JJL0123456789abcdef";
        let result = scan_content(jwt);
        assert!(!result.clean);
        assert!(result.findings.iter().any(|f| f.pattern_id == "jwt-token"));
    }

    #[test]
    fn multiple_findings_in_single_content() {
        let content = "AKIAIOSFODNN7EXAMPLE\n-----BEGIN PRIVATE KEY-----\nsk-abcdefghijklmnopqrstuvwxyz012345";
        let result = scan_content(content);
        assert!(!result.clean);
        assert!(result.findings.len() >= 3);
    }

    #[test]
    fn redacted_preview_masks_middle() {
        let result = scan_content("AKIAIOSFODNN7EXAMPLE");
        assert!(!result.findings.is_empty());
        let preview = &result.findings[0].redacted_preview;
        assert!(
            preview.contains("..."),
            "preview should be redacted: {preview}"
        );
    }
}
