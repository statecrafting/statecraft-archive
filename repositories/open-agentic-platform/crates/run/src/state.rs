// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: TASK_RUNNER
// Spec: spec/run/skills.md

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, PartialEq, Clone)]
#[serde(rename_all = "lowercase")] // "pass", "fail", "skip"
pub enum SkillStatus {
    Pass,
    Fail,
    Skip,
}

impl AsRef<str> for SkillStatus {
    fn as_ref(&self) -> &str {
        match self {
            SkillStatus::Pass => "pass",
            SkillStatus::Fail => "fail",
            SkillStatus::Skip => "skip",
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SkillResult {
    pub skill: String,
    pub status: SkillStatus,
    pub exit_code: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LastRun {
    pub status: String, // "pass" or "fail"
    pub skills: Vec<String>,
    pub failed: Vec<String>,
}

pub struct StateStore {
    base_dir: PathBuf,
}

impl StateStore {
    pub fn new<P: AsRef<Path>>(base_dir: P) -> Self {
        Self {
            base_dir: base_dir.as_ref().to_path_buf(),
        }
    }

    fn last_run_path(&self) -> PathBuf {
        self.base_dir.join("last-run.json")
    }

    fn skill_path(&self, skill_id: &str) -> PathBuf {
        self.base_dir
            .join("skills")
            .join(format!("{}.json", skill_id))
    }

    pub fn read_last_run(&self) -> Result<Option<LastRun>> {
        let path = self.last_run_path();
        if !path.exists() {
            return Ok(None);
        }
        let file = fs::File::open(&path).context("opening last run file")?;
        let last: LastRun = serde_json::from_reader(file).context("decoding last run")?;
        Ok(Some(last))
    }

    pub fn write_last_run(&self, last: &LastRun) -> Result<()> {
        let path = self.last_run_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).context("creating state dir")?;
        }
        let file = fs::File::create(&path).context("creating last run file")?;
        serde_json::to_writer_pretty(file, last).context("encoding last run")?;
        Ok(())
    }

    pub fn write_skill_result(&self, res: &SkillResult) -> Result<()> {
        let path = self.skill_path(&res.skill);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).context("creating skills dir")?;
        }
        let file = fs::File::create(&path).context("creating skill result file")?;
        serde_json::to_writer_pretty(file, res).context("encoding skill result")?;
        Ok(())
    }

    pub fn reset(&self) -> Result<()> {
        if self.base_dir.exists() {
            fs::remove_dir_all(&self.base_dir).context("clearing state dir")?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_state_store_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let store = StateStore::new(dir.path());

        let result = SkillResult {
            skill: "test-skill".into(),
            status: SkillStatus::Pass,
            exit_code: 0,
            note: None,
        };
        store.write_skill_result(&result).unwrap();

        let last = LastRun {
            status: "pass".into(),
            skills: vec!["test-skill".into()],
            failed: vec![],
        };
        store.write_last_run(&last).unwrap();

        let loaded = store.read_last_run().unwrap().unwrap();
        assert_eq!(loaded.status, "pass");
        assert!(loaded.failed.is_empty());
    }

    #[test]
    fn test_read_missing_last_run() {
        let dir = tempfile::tempdir().unwrap();
        let store = StateStore::new(dir.path());
        assert!(store.read_last_run().unwrap().is_none());
    }

    #[test]
    fn test_reset_clears_state() {
        let dir = tempfile::tempdir().unwrap();
        let store = StateStore::new(dir.path().join("state"));

        let last = LastRun {
            status: "pass".into(),
            skills: vec![],
            failed: vec![],
        };
        store.write_last_run(&last).unwrap();
        assert!(store.read_last_run().unwrap().is_some());

        store.reset().unwrap();
        assert!(store.read_last_run().unwrap().is_none());
    }
}
