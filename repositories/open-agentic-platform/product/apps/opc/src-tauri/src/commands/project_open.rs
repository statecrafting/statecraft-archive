// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Spec 112 §6.3 — `opc://project/open?...` deep-link parser.
//!
//! Statecraft's `buildProjectOpenDeepLink` emits:
//!
//!   opc://project/open?project_id=<uuid>&url=<clone_url>[&level=<level>]
//!
//! When that URL arrives via `tauri-plugin-deep-link`, the lib.rs
//! dispatcher routes it through `parse_project_open_url`, then emits the
//! parsed payload to the webview as a `project-open-request` event. The
//! frontend listener (out of scope here) calls `fetch_project_opc_bundle`
//! and routes to the cockpit.
//!
//! The parser is the single point that turns wire shape into a typed
//! struct — the rest of the desktop only sees `ProjectOpenRequest`.

use serde::Serialize;
use url::Url;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOpenRequest {
    pub project_id: String,
    /// Git clone URL (the `url` query param on the deep link).
    pub clone_url: String,
    /// Detection level if the link came from Import — one of
    /// `scaffold_only` / `legacy_produced` / `acp_produced`. Optional.
    pub level: Option<String>,
}

#[derive(Debug)]
pub enum DeepLinkError {
    InvalidUrl(String),
    WrongScheme(String),
    WrongPath(String),
    MissingParam(&'static str),
}

impl std::fmt::Display for DeepLinkError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidUrl(s) => write!(f, "invalid URL: {s}"),
            Self::WrongScheme(s) => write!(f, "expected scheme `opc`, got `{s}`"),
            Self::WrongPath(s) => write!(f, "expected path `project/open`, got `{s}`"),
            Self::MissingParam(p) => write!(f, "missing required query param `{p}`"),
        }
    }
}

impl std::error::Error for DeepLinkError {}

pub fn parse_project_open_url(raw: &str) -> Result<ProjectOpenRequest, DeepLinkError> {
    let url = Url::parse(raw).map_err(|e| DeepLinkError::InvalidUrl(e.to_string()))?;

    if url.scheme() != "opc" {
        return Err(DeepLinkError::WrongScheme(url.scheme().to_string()));
    }

    // For opc://project/open, host = "project", path = "/open".
    let host = url.host_str().unwrap_or("");
    let path = url.path().trim_start_matches('/');
    if !(host == "project" && path == "open") {
        return Err(DeepLinkError::WrongPath(format!(
            "{}/{path}",
            host
        )));
    }

    let mut project_id: Option<String> = None;
    let mut clone_url: Option<String> = None;
    let mut level: Option<String> = None;

    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "project_id" => project_id = Some(v.into_owned()),
            "url" => clone_url = Some(v.into_owned()),
            "level" => level = Some(v.into_owned()),
            _ => {} // ignore unknown params for forward-compat
        }
    }

    Ok(ProjectOpenRequest {
        project_id: project_id.ok_or(DeepLinkError::MissingParam("project_id"))?,
        clone_url: clone_url.ok_or(DeepLinkError::MissingParam("url"))?,
        level,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_url_with_level() {
        let raw = "opc://project/open?project_id=p1&url=https%3A%2F%2Fgithub.com%2Facme%2Ffoo.git&level=legacy_produced";
        let parsed = parse_project_open_url(raw).expect("parses");
        assert_eq!(parsed.project_id, "p1");
        assert_eq!(parsed.clone_url, "https://github.com/acme/foo.git");
        assert_eq!(parsed.level.as_deref(), Some("legacy_produced"));
    }

    #[test]
    fn parses_without_level_param() {
        let raw = "opc://project/open?project_id=p1&url=https%3A%2F%2Fgithub.com%2Facme%2Ffoo.git";
        let parsed = parse_project_open_url(raw).expect("parses");
        assert_eq!(parsed.project_id, "p1");
        assert!(parsed.level.is_none());
    }

    #[test]
    fn ignores_unknown_query_params() {
        let raw = "opc://project/open?project_id=p1&url=https%3A%2F%2Fexample.com%2Ffoo&extra=xyz";
        let parsed = parse_project_open_url(raw).expect("parses");
        assert_eq!(parsed.project_id, "p1");
    }

    #[test]
    fn rejects_wrong_scheme() {
        let raw = "https://example.com/project/open?project_id=p1&url=x";
        let err = parse_project_open_url(raw).expect_err("rejects");
        assert!(matches!(err, DeepLinkError::WrongScheme(_)));
    }

    #[test]
    fn rejects_wrong_path() {
        let raw = "opc://workspace/sync?project_id=p1&url=x";
        let err = parse_project_open_url(raw).expect_err("rejects");
        assert!(matches!(err, DeepLinkError::WrongPath(_)));
    }

    #[test]
    fn rejects_missing_project_id() {
        let raw = "opc://project/open?url=https%3A%2F%2Fexample.com";
        let err = parse_project_open_url(raw).expect_err("rejects");
        assert!(matches!(err, DeepLinkError::MissingParam("project_id")));
    }

    #[test]
    fn rejects_missing_clone_url() {
        let raw = "opc://project/open?project_id=p1";
        let err = parse_project_open_url(raw).expect_err("rejects");
        assert!(matches!(err, DeepLinkError::MissingParam("url")));
    }
}
