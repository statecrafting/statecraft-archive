// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: TASK_RUNNER
// Spec: spec/run/skills.md

use crate::state::{LastRun, SkillResult, SkillStatus, StateStore};
use anyhow::Result;
use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};

pub trait Skill {
    fn id(&self) -> &str;
    fn run(&self, config: &RunConfig) -> Result<SkillResult>;
}

pub struct RunConfig {
    pub json: bool,
    pub state_dir: String,
    pub fail_on_warning: bool,
    pub files0: bool,
    pub bin_path: String,
    pub stdin_buffer: Option<Vec<u8>>,
    pub env: HashMap<String, String>,
}

pub struct Runner {
    registry: Vec<Box<dyn Skill>>,
    store: StateStore,
    config: RunConfig,
    writer: Option<Arc<Mutex<Box<dyn Write + Send>>>>,
}

impl Runner {
    pub fn new(
        registry: Vec<Box<dyn Skill>>,
        store: StateStore,
        config: RunConfig,
        writer: Option<Box<dyn Write + Send>>,
    ) -> Self {
        Self {
            registry,
            store,
            config,
            writer: writer.map(|w| Arc::new(Mutex::new(w))),
        }
    }

    fn writeln(&self, msg: &str) {
        if let Some(writer) = &self.writer {
            if let Ok(mut w) = writer.lock() {
                let _ = writeln!(w, "{}", msg);
            }
        } else {
            println!("{}", msg);
        }
    }

    pub fn list(&self) {
        if self.config.json {
            let ids: Vec<&str> = self.registry.iter().map(|s| s.id()).collect();
            let json = serde_json::json!({"skills": ids}).to_string();
            self.writeln(&json);
        } else {
            for skill in &self.registry {
                self.writeln(skill.id());
            }
        }
    }

    pub fn run_all(&self) -> Result<bool> {
        self.execute_sequence(self.registry.iter().map(|s| s.as_ref()).collect())
    }

    pub fn run_specific(&self, skill_ids: &[String]) -> Result<bool> {
        let mut to_run = Vec::new();
        for id in skill_ids {
            if let Some(s) = self.registry.iter().find(|s| s.id() == id) {
                to_run.push(s.as_ref());
            } else {
                self.writeln(&format!("ERROR: Skill not found: {}", id));
                return Ok(false);
            }
        }
        self.execute_sequence(to_run)
    }

    pub fn resume(&self) -> Result<bool> {
        let last_run = self.store.read_last_run()?;
        if let Some(last) = last_run {
            if last.failed.is_empty() {
                self.writeln("No failed skills to resume.");
                return Ok(true);
            }
            let mut to_run = Vec::new();
            for id in &last.failed {
                if let Some(s) = self.registry.iter().find(|s| s.id() == id) {
                    to_run.push(s.as_ref());
                }
            }
            self.execute_sequence(to_run)
        } else {
            self.writeln("No run state found.");
            Ok(true)
        }
    }

    fn execute_sequence(&self, skills: Vec<&dyn Skill>) -> Result<bool> {
        let mut failed = Vec::new();
        let mut skill_names = Vec::new();
        let mut overall_success = true;

        for skill in skills {
            let id = skill.id();
            skill_names.push(id.to_string());

            if !self.config.json {
                self.writeln("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                self.writeln(&format!("SKILL: {}", id));
                self.writeln("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
            }

            let res = skill.run(&self.config)?;

            // Persist
            self.store.write_skill_result(&res)?;

            if res.status == SkillStatus::Skip {
                if !self.config.json {
                    self.writeln(&format!("SKIP: {}", id));
                    if let Some(note) = &res.note {
                        self.writeln(note);
                    }
                }
                continue;
            }

            if res.status != SkillStatus::Pass {
                failed.push(id.to_string());
                overall_success = false;
                if !self.config.json {
                    self.writeln(&format!("FAIL: {} (exit {})", id, res.exit_code));
                    if let Some(note) = &res.note {
                        self.writeln(note);
                    }
                }
            } else if !self.config.json {
                self.writeln(&format!("PASS: {}", id));
                if let Some(note) = &res.note {
                    self.writeln(note);
                }
            }
        }

        let last_run = LastRun {
            status: if overall_success {
                "pass".to_string()
            } else {
                "fail".to_string()
            },
            skills: skill_names,
            failed: failed.clone(),
        };
        self.store.write_last_run(&last_run)?;

        if !overall_success {
            if let Some(writer) = &self.writer {
                if let Ok(mut w) = writer.lock() {
                    let _ = writeln!(w, "Run failed: {:?}", failed);
                }
            } else {
                eprintln!("Run failed: {:?}", failed);
            }
        }

        Ok(overall_success)
    }
}
