// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: VERIFICATION_SKILLS
// Spec: spec/verification.yaml

use anyhow::{Context, Result, bail};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationConfig {
    pub version: u32,
    #[serde(default)]
    pub toolchains: BTreeMap<String, ToolchainConfig>,
    #[serde(default)]
    pub defaults: Defaults,
    pub skills: BTreeMap<String, SkillConfig>,
    #[serde(default)]
    pub profiles: BTreeMap<String, ProfileConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolchainConfig {
    pub required: Vec<CommandCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandCheck {
    pub cmd: Cmd,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Defaults {
    #[serde(default = "default_workdir")]
    pub workdir: String,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub network: NetworkMode,
    #[serde(default)]
    pub read_only: ReadOnlyMode,
    #[serde(default)]
    pub env_allowlist: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

fn default_workdir() -> String {
    ".".to_string()
}
fn default_timeout_ms() -> u64 {
    600_000
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileConfig {
    pub include: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillConfig {
    #[serde(default)]
    pub description: Option<String>,
    pub determinism: DeterminismClass,
    pub tier: u8, // 1 or 2
    #[serde(default)]
    pub workdir: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub network: Option<NetworkMode>,
    #[serde(default)]
    pub read_only: Option<ReadOnlyMode>,
    #[serde(default)]
    pub env_allowlist: Option<Vec<String>>,
    #[serde(default)]
    pub env: Option<BTreeMap<String, String>>,
    pub steps: Vec<StepConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepConfig {
    pub name: String,
    pub cmd: Cmd,
    #[serde(default)]
    pub workdir: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub network: Option<NetworkMode>,
    #[serde(default)]
    pub read_only: Option<ReadOnlyMode>,
    #[serde(default)]
    pub env_allowlist: Option<Vec<String>>,
    #[serde(default)]
    pub env: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Cmd {
    String(String),
    Argv(Vec<String>),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum NetworkMode {
    #[default]
    Deny,
    Allow,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ReadOnlyMode {
    Off,
    #[default]
    Tracked,
    Strict,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum DeterminismClass {
    D0,
    D1,
    D2,
}

impl VerificationConfig {
    pub fn parse(yaml: &str) -> Result<Self> {
        let config: Self =
            serde_yaml::from_str(yaml).context("Failed to parse verification.yaml")?;
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<()> {
        // 1. Version check
        if self.version != 1 {
            bail!(
                "Unsupported version: {}. Only version 1 is supported.",
                self.version
            );
        }

        let env_regex = Regex::new(r"^[A-Z0-9_]+$").unwrap();

        // Validate Defaults
        for env_var in &self.defaults.env_allowlist {
            if !env_regex.is_match(env_var) {
                bail!(
                    "Invalid env_allowlist variable in defaults: '{}'. Must match ^[A-Z0-9_]+$",
                    env_var
                );
            }
        }

        // 2. Validate Skills
        for (skill_name, skill) in &self.skills {
            // Tier check
            if skill.tier != 1 && skill.tier != 2 {
                bail!(
                    "Skill '{}' has invalid tier {}. Must be 1 or 2.",
                    skill_name,
                    skill.tier
                );
            }

            // Env allowlist check
            if let Some(list) = &skill.env_allowlist {
                for env_var in list {
                    if !env_regex.is_match(env_var) {
                        bail!(
                            "Invalid env_allowlist variable in skill '{}': '{}'. Must match ^[A-Z0-9_]+$",
                            skill_name,
                            env_var
                        );
                    }
                }
            }

            // Unique step names per skill
            let mut step_names = HashSet::new();
            for step in &skill.steps {
                if !step_names.insert(&step.name) {
                    bail!(
                        "Skill '{}' has duplicate step name: '{}'",
                        skill_name,
                        step.name
                    );
                }

                // Cmd non-empty check
                match &step.cmd {
                    Cmd::String(s) => {
                        if s.is_empty() {
                            bail!(
                                "Skill '{}' step '{}' has empty command",
                                skill_name,
                                step.name
                            );
                        }
                    }
                    Cmd::Argv(v) => {
                        if v.is_empty() || v.iter().any(|arg| arg.is_empty()) {
                            bail!(
                                "Skill '{}' step '{}' has empty command args",
                                skill_name,
                                step.name
                            );
                        }
                    }
                }

                // Env allowlist check for steps
                if let Some(list) = &step.env_allowlist {
                    for env_var in list {
                        if !env_regex.is_match(env_var) {
                            bail!(
                                "Invalid env_allowlist variable in skill '{}' step '{}': '{}'. Must match ^[A-Z0-9_]+$",
                                skill_name,
                                step.name,
                                env_var
                            );
                        }
                    }
                }
            }
        }

        // 3. Validate Profiles
        for (profile_name, profile) in &self.profiles {
            for skill_ref in &profile.include {
                if !self.skills.contains_key(skill_ref) {
                    bail!(
                        "Profile '{}' references unknown skill '{}'",
                        profile_name,
                        skill_ref
                    );
                }
            }
        }

        Ok(())
    }
}
