// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: AGENT_AUTOMATION
// Spec: spec/agent/automation.md

use anyhow::{Context, Result};
use regex::Regex;
use url::Url;

pub fn normalize_repo_key(remote_url: &str) -> Result<String> {
    let url_str = if remote_url.starts_with("git@") {
        let rest = remote_url.trim_start_matches("git@");
        if let Some((host, path)) = rest.split_once(':') {
            format!("ssh://git@{}/{}", host, path)
        } else {
            remote_url.to_string()
        }
    } else {
        remote_url.to_string()
    };

    // If it fails to parse (e.g. just "github.com/foo/bar"), try adding https://
    let url = Url::parse(&url_str).or_else(|_| Url::parse(&format!("https://{}", url_str)))?;

    let host = url.host_str().context("No host in URL")?;
    let path = url.path().trim_end_matches(".git").trim_start_matches('/');

    Ok(format!("{}/{}", host, path))
}

pub fn derive_changeset_id(subject: &str, existing_ids: &[String]) -> String {
    let slug = slugify(subject);
    let mut max_seq = 0;

    let re = Regex::new(r"^(\d{3})-").unwrap();

    for id in existing_ids {
        if let Some(caps) = re.captures(id)
            && let Ok(seq) = caps[1].parse::<u32>()
            && seq > max_seq
        {
            max_seq = seq;
        }
    }

    format!("{:03}-{}", max_seq + 1, slug)
}

fn slugify(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<&str>>()
        .join("-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_repo_key() {
        assert_eq!(
            normalize_repo_key("https://github.com/owner/repo.git").unwrap(),
            "github.com/owner/repo"
        );
        assert_eq!(
            normalize_repo_key("git@github.com:owner/repo.git").unwrap(),
            "github.com/owner/repo"
        );
        assert_eq!(
            normalize_repo_key("https://github.com/owner/repo").unwrap(),
            "github.com/owner/repo"
        );
    }

    #[test]
    fn test_derive_id() {
        let existing = vec!["001-foo".to_string(), "002-bar".to_string()];
        assert_eq!(
            derive_changeset_id("Baz feature!", &existing),
            "003-baz-feature"
        );

        let empty: Vec<String> = vec![];
        assert_eq!(derive_changeset_id("First One", &empty), "001-first-one");
    }
}
