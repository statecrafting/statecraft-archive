use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WorktreeAgentHandle {
    pub agent_id: String,
    pub task: String,
    pub repo_root: String,
    pub parent_branch: String,
    pub agent_branch: String,
    pub worktree_path: String,
    pub status: String,
    pub started_at: String,
    pub last_event_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CommitSummaryEntry {
    pub sha: String,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AgentDiffResultDto {
    pub unified_diff: String,
    pub commits: Vec<CommitSummaryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MergeAgentResultDto {
    pub strategy: String,
    pub merged_commits: Vec<String>,
    pub created_commit_sha: Option<String>,
    pub discarded: bool,
}

#[derive(Default)]
pub struct WorktreeAgentsState(pub Mutex<HashMap<String, WorktreeAgentHandle>>);

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn slugify_task(task: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in task.chars().flat_map(|c| c.to_lowercase()) {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_dash = false;
        } else if (ch.is_ascii_whitespace() || ch == '-' || ch == '_') && !prev_dash {
            out.push('-');
            prev_dash = true;
        }
        if out.len() >= 48 {
            break;
        }
    }
    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        "task".to_string()
    } else {
        trimmed.to_string()
    }
}

fn run_git(repo_root: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_root)
        .output()
        .map_err(|e| format!("failed to run git {}: {}", args.join(" "), e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git {} failed: {}", args.join(" "), stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn branch_exists(repo_root: &str, branch: &str) -> bool {
    Command::new("git")
        .args(["rev-parse", "--verify", branch])
        .current_dir(repo_root)
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

fn remove_agent_worktree(repo_root: &str, worktree_path: &str, branch_name: &str) {
    let _ = run_git(repo_root, &["worktree", "remove", "--force", worktree_path]);
    let _ = std::fs::remove_dir_all(worktree_path);
    let _ = run_git(repo_root, &["worktree", "prune"]);
    let _ = run_git(repo_root, &["branch", "-D", branch_name]);
}

#[tauri::command]
pub async fn spawn_background_agent(
    state: State<'_, WorktreeAgentsState>,
    task: String,
    repo_root: String,
    parent_branch: Option<String>,
) -> Result<WorktreeAgentHandle, String> {
    if task.trim().is_empty() {
        return Err("task cannot be empty".to_string());
    }
    if repo_root.trim().is_empty() {
        return Err("repo_root cannot be empty".to_string());
    }

    let parent = match parent_branch {
        Some(p) if !p.trim().is_empty() => p,
        _ => run_git(&repo_root, &["rev-parse", "--abbrev-ref", "HEAD"])?
            .trim()
            .to_string(),
    };
    if !branch_exists(&repo_root, &parent) {
        return Err(format!("parent branch does not exist: {}", parent));
    }

    let short_id = Uuid::new_v4().simple().to_string()[..8].to_string();
    let slug = slugify_task(&task);
    let agent_id = short_id;
    let branch_name = format!("agent/{}-{}", agent_id, slug);
    let worktree_path = PathBuf::from(&repo_root)
        .join(".worktrees")
        .join(&agent_id)
        .to_string_lossy()
        .to_string();

    std::fs::create_dir_all(PathBuf::from(&repo_root).join(".worktrees"))
        .map_err(|e| format!("failed to create .worktrees directory: {}", e))?;

    let gitignore_path = PathBuf::from(&repo_root)
        .join(".worktrees")
        .join(".gitignore");
    if !gitignore_path.exists() {
        std::fs::write(&gitignore_path, "*\n")
            .map_err(|e| format!("failed to create .worktrees/.gitignore: {}", e))?;
    }

    run_git(
        &repo_root,
        &[
            "worktree",
            "add",
            &worktree_path,
            "-b",
            &branch_name,
            "HEAD",
        ],
    )?;

    let ts = now_iso();
    let handle = WorktreeAgentHandle {
        agent_id: agent_id.clone(),
        task,
        repo_root,
        parent_branch: parent,
        agent_branch: branch_name,
        worktree_path,
        status: "spawned".to_string(),
        started_at: ts.clone(),
        last_event_at: ts,
    };

    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    map.insert(agent_id, handle.clone());
    Ok(handle)
}

#[tauri::command]
pub async fn list_background_agents(
    state: State<'_, WorktreeAgentsState>,
) -> Result<Vec<WorktreeAgentHandle>, String> {
    let map = state.0.lock().map_err(|e| e.to_string())?;
    let mut items: Vec<WorktreeAgentHandle> = map.values().cloned().collect();
    items.sort_by(|a, b| b.last_event_at.cmp(&a.last_event_at));
    Ok(items)
}

#[tauri::command]
pub async fn get_agent_diff(
    state: State<'_, WorktreeAgentsState>,
    agent_id: String,
) -> Result<AgentDiffResultDto, String> {
    let map = state.0.lock().map_err(|e| e.to_string())?;
    let agent = map
        .get(&agent_id)
        .ok_or_else(|| format!("unknown agent_id: {}", agent_id))?;

    let diff = run_git(
        &agent.repo_root,
        &[
            "diff",
            "--no-color",
            &format!("{}...{}", agent.parent_branch, agent.agent_branch),
        ],
    )?;
    let log = run_git(
        &agent.repo_root,
        &[
            "log",
            "--no-color",
            "--pretty=format:%H%x09%s",
            &format!("{}..{}", agent.parent_branch, agent.agent_branch),
        ],
    )?;

    let commits = log
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let mut parts = line.splitn(2, '\t');
            CommitSummaryEntry {
                sha: parts.next().unwrap_or_default().trim().to_string(),
                subject: parts.next().unwrap_or_default().trim().to_string(),
            }
        })
        .collect();

    Ok(AgentDiffResultDto {
        unified_diff: diff,
        commits,
    })
}

#[tauri::command]
pub async fn merge_agent(
    state: State<'_, WorktreeAgentsState>,
    agent_id: String,
    strategy: String,
    cherry_pick_commits: Option<Vec<String>>,
    squash_commit_message: Option<String>,
) -> Result<MergeAgentResultDto, String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    let agent = map
        .get_mut(&agent_id)
        .ok_or_else(|| format!("unknown agent_id: {}", agent_id))?;

    let repo_root = agent.repo_root.clone();
    let parent_branch = agent.parent_branch.clone();
    let agent_branch = agent.agent_branch.clone();
    let worktree_path = agent.worktree_path.clone();

    if !run_git(&repo_root, &["status", "--porcelain"])?
        .trim()
        .is_empty()
    {
        return Err("refusing merge: repository has uncommitted changes".to_string());
    }
    if !branch_exists(&repo_root, &parent_branch) {
        return Err(format!("parent branch not found: {}", parent_branch));
    }
    if !branch_exists(&repo_root, &agent_branch) {
        return Err(format!("agent branch not found: {}", agent_branch));
    }

    let start_branch = run_git(&repo_root, &["rev-parse", "--abbrev-ref", "HEAD"])?
        .trim()
        .to_string();
    let merged_commits = run_git(
        &repo_root,
        &["rev-list", &format!("{}..{}", parent_branch, agent_branch)],
    )?
    .lines()
    .map(|line| line.trim().to_string())
    .filter(|line| !line.is_empty())
    .collect::<Vec<_>>();

    if start_branch != parent_branch {
        run_git(&repo_root, &["checkout", &parent_branch])?;
    }

    let mut created_commit_sha = None;
    let merge_res = (|| -> Result<(), String> {
        match strategy.as_str() {
            "fast-forward" => {
                run_git(&repo_root, &["merge", "--ff-only", &agent_branch])?;
            }
            "squash" => {
                run_git(
                    &repo_root,
                    &["merge", "--squash", "--no-commit", &agent_branch],
                )?;
                let message = squash_commit_message.unwrap_or_else(|| {
                    format!("Squash merge {} into {}", agent_branch, parent_branch)
                });
                run_git(&repo_root, &["commit", "-m", &message])?;
                created_commit_sha = Some(
                    run_git(&repo_root, &["rev-parse", "HEAD"])?
                        .trim()
                        .to_string(),
                );
            }
            "cherry-pick" => {
                let picks = cherry_pick_commits.unwrap_or_default();
                if picks.is_empty() {
                    return Err("cherry-pick strategy requires cherry_pick_commits".to_string());
                }
                for commit in picks {
                    if let Err(err) = run_git(&repo_root, &["cherry-pick", &commit]) {
                        let _ = run_git(&repo_root, &["cherry-pick", "--abort"]);
                        return Err(err);
                    }
                }
                created_commit_sha = Some(
                    run_git(&repo_root, &["rev-parse", "HEAD"])?
                        .trim()
                        .to_string(),
                );
            }
            _ => {
                return Err(
                    "strategy must be one of: fast-forward, squash, cherry-pick".to_string()
                );
            }
        }
        Ok(())
    })();

    if start_branch != parent_branch {
        let _ = run_git(&repo_root, &["checkout", &start_branch]);
    }
    merge_res?;

    remove_agent_worktree(&repo_root, &worktree_path, &agent_branch);
    agent.status = "discarded".to_string();
    agent.last_event_at = now_iso();

    Ok(MergeAgentResultDto {
        strategy,
        merged_commits,
        created_commit_sha,
        discarded: true,
    })
}

#[tauri::command]
pub async fn discard_agent(
    state: State<'_, WorktreeAgentsState>,
    agent_id: String,
) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    let agent = map
        .get_mut(&agent_id)
        .ok_or_else(|| format!("unknown agent_id: {}", agent_id))?;

    remove_agent_worktree(&agent.repo_root, &agent.worktree_path, &agent.agent_branch);
    agent.status = "discarded".to_string();
    agent.last_event_at = now_iso();
    Ok(())
}
