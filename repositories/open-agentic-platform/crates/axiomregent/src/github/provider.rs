// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use async_trait::async_trait;
use serde_json::{Map, Value, json};
use std::sync::Arc;
use tokio::sync::RwLock;

use super::client::GitHubClient;
use crate::router::provider::{ToolPermissions, ToolProvider};

pub struct GitHubProvider {
    client: Arc<RwLock<GitHubClient>>,
}

impl GitHubProvider {
    pub async fn new() -> anyhow::Result<Self> {
        let client = GitHubClient::new().await?;
        Ok(Self {
            client: Arc::new(RwLock::new(client)),
        })
    }
}

#[async_trait]
impl ToolProvider for GitHubProvider {
    fn tool_schemas(&self) -> Vec<Value> {
        vec![
            json!({
                "name": "github.find_repo",
                "description": "Set the active GitHub repository for subsequent github.* tool calls. Validates the repo exists via API. Accepts owner/name format.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "repo": { "type": "string", "description": "Repository in owner/name format (e.g. octocat/Hello-World)" }
                    },
                    "required": ["repo"]
                }
            }),
            json!({
                "name": "github.list_dir",
                "description": "List the contents of a directory in the active GitHub repository.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Directory path (default: root)" },
                        "ref": { "type": "string", "description": "Git ref (branch, tag, or SHA). Defaults to the repo's default branch." }
                    }
                }
            }),
            json!({
                "name": "github.read_file",
                "description": "Read a file's content from the active GitHub repository.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "File path within the repository" },
                        "ref": { "type": "string", "description": "Git ref (branch, tag, or SHA). Defaults to the repo's default branch." }
                    },
                    "required": ["path"]
                }
            }),
            json!({
                "name": "github.search_issues",
                "description": "Search issues in the active GitHub repository.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "Search query string" },
                        "max_results": { "type": "integer", "description": "Maximum number of results to return (default 10)" }
                    },
                    "required": ["query"]
                }
            }),
            json!({
                "name": "github.get_issue",
                "description": "Get details of a specific issue by number from the active GitHub repository.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "number": { "type": "integer", "description": "Issue number" }
                    },
                    "required": ["number"]
                }
            }),
            json!({
                "name": "github.search_prs",
                "description": "Search pull requests in the active GitHub repository.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "Search query string" },
                        "state": { "type": "string", "description": "PR state filter: open, closed, or merged (default: open)" },
                        "max_results": { "type": "integer", "description": "Maximum number of results to return (default 10)" }
                    },
                    "required": ["query"]
                }
            }),
            json!({
                "name": "github.get_pr",
                "description": "Get details of a specific pull request by number from the active GitHub repository.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "number": { "type": "integer", "description": "Pull request number" }
                    },
                    "required": ["number"]
                }
            }),
            json!({
                "name": "github.list_commits",
                "description": "List commits in the active GitHub repository.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "sha": { "type": "string", "description": "SHA or branch to start listing from" },
                        "author": { "type": "string", "description": "Filter commits by author (login or email)" },
                        "max_results": { "type": "integer", "description": "Maximum number of results to return (default 20)" }
                    }
                }
            }),
            json!({
                "name": "github.get_commit",
                "description": "Get details of a specific commit by SHA from the active GitHub repository.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "sha": { "type": "string", "description": "Commit SHA" }
                    },
                    "required": ["sha"]
                }
            }),
            json!({
                "name": "github.compare_commits",
                "description": "Compare two refs (branches, tags, or SHAs) in the active GitHub repository.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "base": { "type": "string", "description": "Base ref (branch, tag, or SHA)" },
                        "head": { "type": "string", "description": "Head ref (branch, tag, or SHA)" }
                    },
                    "required": ["base", "head"]
                }
            }),
            json!({
                "name": "github.list_releases",
                "description": "List releases for the active GitHub repository.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "max_results": { "type": "integer", "description": "Maximum number of results to return (default 10)" }
                    }
                }
            }),
            json!({
                "name": "github.get_contributors",
                "description": "List contributors for the active GitHub repository, sorted by contribution count.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "max_results": { "type": "integer", "description": "Maximum number of results to return (default 30)" }
                    }
                }
            }),
        ]
    }

    async fn handle(&self, name: &str, args: &Map<String, Value>) -> Option<anyhow::Result<Value>> {
        match name {
            "github.find_repo" => {
                let repo = match args.get("repo").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("repo required (owner/name)"))),
                };
                let parts: Vec<&str> = repo.split('/').collect();
                if parts.len() != 2 {
                    return Some(Err(anyhow::anyhow!("repo must be owner/name format")));
                }
                let (owner, name_str) = (parts[0], parts[1]);
                let mut client = self.client.write().await;
                match client.get_repo_info(owner, name_str).await {
                    Ok(info) => {
                        client.set_repo(owner.to_string(), name_str.to_string());
                        Some(Ok(
                            json!({ "repo": repo, "info": info, "status": "selected" }),
                        ))
                    }
                    Err(e) => Some(Err(e)),
                }
            }

            "github.list_dir" => {
                let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                let git_ref = args.get("ref").and_then(|v| v.as_str());
                let client = self.client.read().await;
                Some(client.list_dir(path, git_ref).await)
            }

            "github.read_file" => {
                let path = match args.get("path").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("path required"))),
                };
                let git_ref = args.get("ref").and_then(|v| v.as_str());
                let client = self.client.read().await;
                Some(client.read_file(path, git_ref).await)
            }

            "github.search_issues" => {
                let query = match args.get("query").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("query required"))),
                };
                let max_results = args
                    .get("max_results")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(10) as usize;
                let client = self.client.read().await;
                Some(client.search_issues(query, max_results).await)
            }

            "github.get_issue" => {
                let number = match args.get("number").and_then(|v| v.as_u64()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("number required"))),
                };
                let client = self.client.read().await;
                Some(client.get_issue(number).await)
            }

            "github.search_prs" => {
                let query = match args.get("query").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("query required"))),
                };
                let state = args.get("state").and_then(|v| v.as_str());
                let max_results = args
                    .get("max_results")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(10) as usize;
                let client = self.client.read().await;
                Some(client.search_prs(query, state, max_results).await)
            }

            "github.get_pr" => {
                let number = match args.get("number").and_then(|v| v.as_u64()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("number required"))),
                };
                let client = self.client.read().await;
                Some(client.get_pr(number).await)
            }

            "github.list_commits" => {
                let sha = args.get("sha").and_then(|v| v.as_str());
                let author = args.get("author").and_then(|v| v.as_str());
                let max_results = args
                    .get("max_results")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(20) as usize;
                let client = self.client.read().await;
                Some(client.list_commits(sha, author, max_results).await)
            }

            "github.get_commit" => {
                let sha = match args.get("sha").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("sha required"))),
                };
                let client = self.client.read().await;
                Some(client.get_commit(sha).await)
            }

            "github.compare_commits" => {
                let base = match args.get("base").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("base required"))),
                };
                let head = match args.get("head").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("head required"))),
                };
                let client = self.client.read().await;
                Some(client.compare_commits(base, head).await)
            }

            "github.list_releases" => {
                let max_results = args
                    .get("max_results")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(10) as usize;
                let client = self.client.read().await;
                Some(client.list_releases(max_results).await)
            }

            "github.get_contributors" => {
                let max_results = args
                    .get("max_results")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(30) as usize;
                let client = self.client.read().await;
                Some(client.get_contributors(max_results).await)
            }

            _ => None,
        }
    }

    fn tier(&self, name: &str) -> Option<agent::safety::ToolTier> {
        match name {
            "github.find_repo"
            | "github.list_dir"
            | "github.read_file"
            | "github.search_issues"
            | "github.get_issue"
            | "github.search_prs"
            | "github.get_pr"
            | "github.list_commits"
            | "github.get_commit"
            | "github.compare_commits"
            | "github.list_releases"
            | "github.get_contributors" => Some(agent::safety::ToolTier::Tier1),
            _ => None,
        }
    }

    fn permissions(&self, name: &str) -> Option<ToolPermissions> {
        match name {
            "github.find_repo"
            | "github.list_dir"
            | "github.read_file"
            | "github.search_issues"
            | "github.get_issue"
            | "github.search_prs"
            | "github.get_pr"
            | "github.list_commits"
            | "github.get_commit"
            | "github.compare_commits"
            | "github.list_releases"
            | "github.get_contributors" => Some(ToolPermissions {
                requires_network: true,
                ..Default::default()
            }),
            _ => None,
        }
    }
}
