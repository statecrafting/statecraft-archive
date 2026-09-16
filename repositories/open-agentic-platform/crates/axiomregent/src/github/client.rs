// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use anyhow::{Result, anyhow};
use octocrab::Octocrab;
use serde_json::Value;

/// Resolve a GitHub token. Priority:
/// 1. PLATFORM_GITHUB_TOKEN_URL (platform-brokered installation token)
/// 2. GITHUB_TOKEN env var
/// 3. GH_TOKEN env var (gh CLI compatibility)
/// 4. None (unauthenticated, 60 req/hr)
pub async fn resolve_token() -> Option<String> {
    // Platform broker (future: call statecraft POST /api/github/token)
    if let Ok(url) = std::env::var("PLATFORM_GITHUB_TOKEN_URL")
        && let Ok(token) = fetch_platform_token(&url).await
    {
        return Some(token);
    }
    // Env var fallback
    std::env::var("GITHUB_TOKEN")
        .ok()
        .or_else(|| std::env::var("GH_TOKEN").ok())
}

async fn fetch_platform_token(url: &str) -> Result<String> {
    let m2m_token =
        std::env::var("PLATFORM_M2M_TOKEN").map_err(|_| anyhow!("PLATFORM_M2M_TOKEN not set"))?;
    let resp = reqwest::Client::new()
        .post(url)
        .bearer_auth(&m2m_token)
        .send()
        .await?;
    let body: Value = resp.json().await?;
    body.get("token")
        .and_then(|t| t.as_str())
        .map(String::from)
        .ok_or_else(|| anyhow!("No token in response"))
}

/// Create an octocrab client with the resolved token.
pub async fn create_client() -> Result<Octocrab> {
    let mut builder = Octocrab::builder();
    if let Some(token) = resolve_token().await {
        builder = builder.personal_token(token);
    }
    builder
        .build()
        .map_err(|e| anyhow!("Failed to create GitHub client: {}", e))
}

/// Shared GitHub client state.
pub struct GitHubClient {
    pub octocrab: Octocrab,
    pub owner: Option<String>,
    pub repo: Option<String>,
}

impl GitHubClient {
    pub async fn new() -> Result<Self> {
        let octocrab = create_client().await?;
        Ok(Self {
            octocrab,
            owner: None,
            repo: None,
        })
    }

    pub fn set_repo(&mut self, owner: String, repo: String) {
        self.owner = Some(owner);
        self.repo = Some(repo);
    }

    fn owner_repo(&self) -> Result<(&str, &str)> {
        match (&self.owner, &self.repo) {
            (Some(o), Some(r)) => Ok((o.as_str(), r.as_str())),
            _ => Err(anyhow!("No repo selected. Call github.find_repo first.")),
        }
    }

    // --- API Methods ---

    pub async fn get_repo_info(&self, owner: &str, repo: &str) -> Result<Value> {
        let r = self.octocrab.repos(owner, repo).get().await?;
        Ok(serde_json::to_value(r)?)
    }

    pub async fn list_dir(&self, path: &str, git_ref: Option<&str>) -> Result<Value> {
        let (owner, repo) = self.owner_repo()?;
        let mut route = format!("/repos/{owner}/{repo}/contents/{path}");
        if let Some(r) = git_ref {
            route.push_str(&format!("?ref={r}"));
        }
        let resp: Value = self.octocrab.get(&route, None::<&()>).await?;
        Ok(resp)
    }

    pub async fn read_file(&self, path: &str, git_ref: Option<&str>) -> Result<Value> {
        let (owner, repo) = self.owner_repo()?;
        let mut route = format!("/repos/{owner}/{repo}/contents/{path}");
        if let Some(r) = git_ref {
            route.push_str(&format!("?ref={r}"));
        }
        let resp: Value = self.octocrab.get(&route, None::<&()>).await?;
        Ok(resp)
    }

    pub async fn search_issues(&self, query: &str, max_results: usize) -> Result<Value> {
        let (owner, repo) = self.owner_repo()?;
        let q = format!("{query} repo:{owner}/{repo}");
        let route = format!(
            "/search/issues?q={}&per_page={max_results}",
            urlencoding::encode(&q)
        );
        let resp: Value = self.octocrab.get(&route, None::<&()>).await?;
        Ok(resp)
    }

    pub async fn get_issue(&self, number: u64) -> Result<Value> {
        let (owner, repo) = self.owner_repo()?;
        let route = format!("/repos/{owner}/{repo}/issues/{number}");
        let resp: Value = self.octocrab.get(&route, None::<&()>).await?;
        Ok(resp)
    }

    pub async fn search_prs(
        &self,
        query: &str,
        state: Option<&str>,
        max_results: usize,
    ) -> Result<Value> {
        let (owner, repo) = self.owner_repo()?;
        let state_filter = state.unwrap_or("open");
        let q = format!("{query} repo:{owner}/{repo} is:pr is:{state_filter}");
        let route = format!(
            "/search/issues?q={}&per_page={max_results}",
            urlencoding::encode(&q)
        );
        let resp: Value = self.octocrab.get(&route, None::<&()>).await?;
        Ok(resp)
    }

    pub async fn get_pr(&self, number: u64) -> Result<Value> {
        let (owner, repo) = self.owner_repo()?;
        let route = format!("/repos/{owner}/{repo}/pulls/{number}");
        let resp: Value = self.octocrab.get(&route, None::<&()>).await?;
        Ok(resp)
    }

    pub async fn list_commits(
        &self,
        sha: Option<&str>,
        author: Option<&str>,
        max_results: usize,
    ) -> Result<Value> {
        let (owner, repo) = self.owner_repo()?;
        let mut params = vec![format!("per_page={max_results}")];
        if let Some(s) = sha {
            params.push(format!("sha={s}"));
        }
        if let Some(a) = author {
            params.push(format!("author={a}"));
        }
        let route = format!("/repos/{owner}/{repo}/commits?{}", params.join("&"));
        let resp: Value = self.octocrab.get(&route, None::<&()>).await?;
        Ok(resp)
    }

    pub async fn get_commit(&self, sha: &str) -> Result<Value> {
        let (owner, repo) = self.owner_repo()?;
        let route = format!("/repos/{owner}/{repo}/commits/{sha}");
        let resp: Value = self.octocrab.get(&route, None::<&()>).await?;
        Ok(resp)
    }

    pub async fn compare_commits(&self, base: &str, head: &str) -> Result<Value> {
        let (owner, repo) = self.owner_repo()?;
        let route = format!("/repos/{owner}/{repo}/compare/{base}...{head}");
        let resp: Value = self.octocrab.get(&route, None::<&()>).await?;
        Ok(resp)
    }

    pub async fn list_releases(&self, max_results: usize) -> Result<Value> {
        let (owner, repo) = self.owner_repo()?;
        let route = format!("/repos/{owner}/{repo}/releases?per_page={max_results}");
        let resp: Value = self.octocrab.get(&route, None::<&()>).await?;
        Ok(resp)
    }

    pub async fn get_contributors(&self, max_results: usize) -> Result<Value> {
        let (owner, repo) = self.owner_repo()?;
        let route = format!("/repos/{owner}/{repo}/contributors?per_page={max_results}");
        let resp: Value = self.octocrab.get(&route, None::<&()>).await?;
        Ok(resp)
    }
}
