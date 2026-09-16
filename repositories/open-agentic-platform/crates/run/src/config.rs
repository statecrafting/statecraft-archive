// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: TASK_RUNNER
// Spec: spec/run/skills.md

use crate::runner::{RunConfig, Skill};
use crate::state::{SkillResult, SkillStatus};
use anyhow::{Result, anyhow};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

#[derive(Debug, Deserialize)]
pub struct TasksConfig {
    #[serde(default)]
    pub skills: HashMap<String, TaskDef>,
}

#[derive(Debug, Deserialize)]
pub struct TaskDef {
    pub command: Vec<String>,
    pub description: Option<String>,
    /// Timeout in milliseconds. Default: 300 000 ms (5 min).
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

fn default_timeout_ms() -> u64 {
    300_000
}

pub struct ConfiguredSkill {
    id: String,
    def: TaskDef,
    base_cwd: PathBuf,
}

impl Skill for ConfiguredSkill {
    fn id(&self) -> &str {
        &self.id
    }

    fn run(&self, config: &RunConfig) -> Result<SkillResult> {
        let (prog, args) = self
            .def
            .command
            .split_first()
            .ok_or_else(|| anyhow!("Command is empty for skill '{}'", self.id))?;

        let mut cmd = Command::new(prog);
        cmd.args(args);

        let cwd = self
            .def
            .cwd
            .as_ref()
            .map(|c| self.base_cwd.join(c))
            .unwrap_or_else(|| self.base_cwd.clone());
        cmd.current_dir(&cwd);

        for (k, v) in &config.env {
            cmd.env(k, v);
        }
        for (k, v) in &self.def.env {
            cmd.env(k, v);
        }

        let child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| anyhow!("Failed to spawn skill '{}': {}", self.id, e))?;

        let timeout = Duration::from_millis(self.def.timeout_ms);
        let child_id = child.id();
        let (cancel_tx, cancel_rx) = std::sync::mpsc::channel::<()>();

        let killer = std::thread::spawn(move || {
            if cancel_rx.recv_timeout(timeout).is_err() {
                // Timeout expired — kill the child process.
                #[cfg(unix)]
                let _ = Command::new("kill")
                    .arg("-9")
                    .arg(child_id.to_string())
                    .output();
                #[cfg(not(unix))]
                let _ = Command::new("taskkill")
                    .args(["/F", "/PID", &child_id.to_string()])
                    .output();
            }
        });

        let output = child
            .wait_with_output()
            .map_err(|e| anyhow!("Failed to wait on skill '{}': {}", self.id, e))?;

        let _ = cancel_tx.send(());
        let _ = killer.join();

        // Signal-killed process (e.g. by our timeout killer) has code() == None on Unix.
        if !output.status.success() && output.status.code().is_none() {
            return Ok(SkillResult {
                skill: self.id.clone(),
                status: SkillStatus::Fail,
                exit_code: -1,
                note: Some(format!("Timed out after {}ms", self.def.timeout_ms)),
            });
        }

        if output.status.success() {
            return Ok(SkillResult {
                skill: self.id.clone(),
                status: SkillStatus::Pass,
                exit_code: 0,
                note: None,
            });
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let combined = format!("{}\n{}", stdout, stderr);
        let lines: Vec<&str> = combined.lines().collect();
        let note = if lines.len() > 20 {
            format!(
                "...(truncated)...\n{}",
                lines[lines.len() - 20..].join("\n")
            )
        } else {
            combined.trim().to_string()
        };

        Ok(SkillResult {
            skill: self.id.clone(),
            status: SkillStatus::Fail,
            exit_code: output.status.code().unwrap_or(1),
            note: Some(note),
        })
    }
}

/// Visibility widened for tests.
#[cfg(test)]
impl ConfiguredSkill {
    pub(crate) fn new_for_test(id: &str, def: TaskDef, base_cwd: PathBuf) -> Self {
        Self {
            id: id.to_string(),
            def,
            base_cwd,
        }
    }
}

/// Load skills from `axiomregent.tasks.yaml` at `path`.
/// Returns a list of configured skills. On malformed YAML, returns an error.
/// Silently skips entries with empty command lists.
pub fn load_from_file(path: &Path, base_cwd: &Path) -> Result<Vec<Box<dyn Skill>>> {
    let contents = std::fs::read_to_string(path)
        .map_err(|e| anyhow!("Cannot read {}: {}", path.display(), e))?;
    let cfg: TasksConfig = serde_yaml::from_str(&contents)
        .map_err(|e| anyhow!("Cannot parse {}: {}", path.display(), e))?;

    let mut skills: Vec<Box<dyn Skill>> = Vec::new();
    for (id, def) in cfg.skills {
        if def.command.is_empty() {
            continue;
        }
        skills.push(Box::new(ConfiguredSkill {
            id,
            def,
            base_cwd: base_cwd.to_path_buf(),
        }));
    }
    skills.sort_by(|a, b| a.id().cmp(b.id()));
    Ok(skills)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runner::RunConfig;

    fn make_run_config() -> RunConfig {
        RunConfig {
            json: false,
            state_dir: "/tmp/run-test".into(),
            fail_on_warning: false,
            files0: false,
            bin_path: "".into(),
            stdin_buffer: None,
            env: HashMap::new(),
        }
    }

    #[test]
    fn test_load_valid_yaml() {
        let dir = tempfile::tempdir().unwrap();
        let yaml = "skills:\n  echo-test:\n    command: [\"echo\", \"hello\"]\n    description: \"Echo hello\"\n";
        std::fs::write(dir.path().join("axiomregent.tasks.yaml"), yaml).unwrap();
        let skills =
            load_from_file(&dir.path().join("axiomregent.tasks.yaml"), dir.path()).unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id(), "echo-test");
    }

    #[test]
    fn test_load_empty_command_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let yaml = "skills:\n  empty:\n    command: []\n";
        std::fs::write(dir.path().join("axiomregent.tasks.yaml"), yaml).unwrap();
        let skills =
            load_from_file(&dir.path().join("axiomregent.tasks.yaml"), dir.path()).unwrap();
        assert!(skills.is_empty());
    }

    #[test]
    fn test_run_success() {
        let skill = ConfiguredSkill::new_for_test(
            "echo-hi",
            TaskDef {
                command: vec!["echo".into(), "hi".into()],
                description: None,
                timeout_ms: 5000,
                cwd: None,
                env: HashMap::new(),
            },
            std::env::temp_dir(),
        );
        let config = make_run_config();
        let result = skill.run(&config).unwrap();
        assert_eq!(result.status, SkillStatus::Pass);
        assert_eq!(result.exit_code, 0);
    }

    #[test]
    fn test_run_failure() {
        let skill = ConfiguredSkill::new_for_test(
            "false-cmd",
            TaskDef {
                command: vec!["false".into()],
                description: None,
                timeout_ms: 5000,
                cwd: None,
                env: HashMap::new(),
            },
            std::env::temp_dir(),
        );
        let config = make_run_config();
        let result = skill.run(&config).unwrap();
        assert_eq!(result.status, SkillStatus::Fail);
    }

    #[test]
    fn test_timeout_kills_process() {
        let skill = ConfiguredSkill::new_for_test(
            "sleeper",
            TaskDef {
                command: vec!["sleep".into(), "60".into()],
                description: None,
                timeout_ms: 200,
                cwd: None,
                env: HashMap::new(),
            },
            std::env::temp_dir(),
        );
        let config = make_run_config();
        let start = std::time::Instant::now();
        let result = skill.run(&config).unwrap();
        let elapsed = start.elapsed();
        assert_eq!(result.status, SkillStatus::Fail);
        assert!(result.note.as_ref().unwrap().contains("Timed out"));
        assert!(
            elapsed.as_millis() < 5000,
            "Should have timed out quickly, took {}ms",
            elapsed.as_millis()
        );
    }

    #[test]
    fn test_default_timeout() {
        assert_eq!(default_timeout_ms(), 300_000);
    }
}
