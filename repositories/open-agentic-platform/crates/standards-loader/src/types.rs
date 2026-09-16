// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: 055-yaml-standards-schema

//! Core types for machine-readable coding standards (FR-001, FR-002, FR-003).

use serde::{Deserialize, Serialize};

/// Rule verb classifying the directive type (FR-002).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RuleVerb {
    ALWAYS,
    NEVER,
    USE,
    PREFER,
    AVOID,
}

impl std::fmt::Display for RuleVerb {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RuleVerb::ALWAYS => write!(f, "ALWAYS"),
            RuleVerb::NEVER => write!(f, "NEVER"),
            RuleVerb::USE => write!(f, "USE"),
            RuleVerb::PREFER => write!(f, "PREFER"),
            RuleVerb::AVOID => write!(f, "AVOID"),
        }
    }
}

/// Priority level for a coding standard (FR-001).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StandardPriority {
    Critical,
    High,
    Medium,
    Low,
}

impl StandardPriority {
    /// Numeric rank for sorting (lower = higher priority).
    pub fn rank(self) -> u8 {
        match self {
            StandardPriority::Critical => 0,
            StandardPriority::High => 1,
            StandardPriority::Medium => 2,
            StandardPriority::Low => 3,
        }
    }
}

impl std::fmt::Display for StandardPriority {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StandardPriority::Critical => write!(f, "critical"),
            StandardPriority::High => write!(f, "high"),
            StandardPriority::Medium => write!(f, "medium"),
            StandardPriority::Low => write!(f, "low"),
        }
    }
}

/// Lifecycle status of a coding standard (FR-007).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum StandardStatus {
    #[default]
    Active,
    Candidate,
    Rejected,
}

/// A single rule within a coding standard (FR-002).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StandardRule {
    pub verb: RuleVerb,
    pub subject: String,
    pub rationale: String,
}

/// A code anti-pattern that violates the standard (FR-003).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AntiPattern {
    pub pattern: String,
    pub correction: String,
}

/// A good/bad code example illustrating the standard (FR-003).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StandardExample {
    pub good: String,
    pub bad: String,
    pub explanation: String,
}

/// A machine-readable coding standard (FR-001).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodingStandard {
    pub id: String,
    pub category: String,
    pub priority: StandardPriority,
    #[serde(default)]
    pub status: StandardStatus,
    #[serde(default)]
    pub context: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub rules: Vec<StandardRule>,
    #[serde(default)]
    pub anti_patterns: Vec<AntiPattern>,
    #[serde(default)]
    pub examples: Vec<StandardExample>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_minimal_standard() {
        let yaml = r#"
id: test-001
category: testing
priority: high
rules:
  - verb: ALWAYS
    subject: write tests
    rationale: tests prevent regressions
"#;
        let s: CodingStandard = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(s.id, "test-001");
        assert_eq!(s.priority, StandardPriority::High);
        assert_eq!(s.status, StandardStatus::Active); // default
        assert_eq!(s.rules.len(), 1);
        assert_eq!(s.rules[0].verb, RuleVerb::ALWAYS);
        assert!(s.tags.is_empty());
        assert!(s.anti_patterns.is_empty());
        assert!(s.examples.is_empty());
    }

    #[test]
    fn deserialize_full_standard() {
        let yaml = r#"
id: error-handling-001
category: error-handling
priority: critical
status: candidate
context: Applies to async TypeScript code
tags: [typescript, async]
rules:
  - verb: NEVER
    subject: use empty catch blocks
    rationale: swallows errors silently
anti_patterns:
  - pattern: "catch (e) {}"
    correction: "catch (e) { logger.error(e); }"
examples:
  - good: "try { ... } catch (e) { throw new AppError(e); }"
    bad: "try { ... } catch (e) {}"
    explanation: empty catches hide bugs
"#;
        let s: CodingStandard = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(s.status, StandardStatus::Candidate);
        assert_eq!(s.tags, vec!["typescript", "async"]);
        assert_eq!(s.anti_patterns.len(), 1);
        assert_eq!(s.examples.len(), 1);
    }

    #[test]
    fn priority_rank_ordering() {
        assert!(StandardPriority::Critical.rank() < StandardPriority::High.rank());
        assert!(StandardPriority::High.rank() < StandardPriority::Medium.rank());
        assert!(StandardPriority::Medium.rank() < StandardPriority::Low.rank());
    }

    #[test]
    fn priority_display() {
        assert_eq!(StandardPriority::Critical.to_string(), "critical");
        assert_eq!(StandardPriority::Low.to_string(), "low");
    }

    #[test]
    fn status_defaults_to_active() {
        assert_eq!(StandardStatus::default(), StandardStatus::Active);
    }
}
