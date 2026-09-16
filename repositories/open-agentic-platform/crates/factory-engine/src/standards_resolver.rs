// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: 055-yaml-standards-schema

//! Per-agent standards resolver for factory pipeline dispatch (spec 055).
//!
//! Implements `orchestrator::StandardsResolver` using pre-loaded tiered standards
//! and per-agent filter metadata from `FactoryAgentBridge`.

use crate::FactoryAgentBridge;
use orchestrator::StandardsResolver;
use standards_loader::{
    FormatOptions, FormattedStandards, TieredStandards, format_standards_for_prompt,
    resolve_standards,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Resolves coding standards for each agent in the factory pipeline.
///
/// Pre-loads all standards tiers once at startup. For each agent dispatch,
/// looks up the agent's `standards_category`/`standards_tags` from the bridge
/// and returns filtered, formatted standards text. Results are cached per
/// unique filter combination to avoid redundant work.
pub struct FactoryStandardsResolver {
    bridge: Arc<FactoryAgentBridge>,
    tiers: TieredStandards,
    format_options: FormatOptions,
    /// Cache: filter key → formatted standards text.
    /// Key is `"{category}::{tags_sorted_joined}"` or `"*"` for unfiltered.
    cache: Mutex<HashMap<String, String>>,
}

impl FactoryStandardsResolver {
    /// Create a new resolver with pre-loaded standards and an agent bridge.
    pub fn new(
        bridge: Arc<FactoryAgentBridge>,
        tiers: TieredStandards,
        format_options: FormatOptions,
    ) -> Self {
        Self {
            bridge,
            tiers,
            format_options,
            cache: Mutex::new(HashMap::new()),
        }
    }

    fn cache_key(filter: Option<&standards_loader::StandardsFilter>) -> String {
        match filter {
            None => "*".to_string(),
            Some(f) => {
                let cat = f.category.as_deref().unwrap_or("");
                let mut tags = f.tags.clone();
                tags.sort();
                format!("{cat}::{}", tags.join(","))
            }
        }
    }
}

impl StandardsResolver for FactoryStandardsResolver {
    fn resolve_for_agent(&self, agent_id: &str) -> Option<String> {
        let filter = self.bridge.get_standards_filter(agent_id);
        let key = Self::cache_key(filter.as_ref());

        // Check cache first
        {
            // Recover the guard on poison rather than panicking: this is a
            // best-effort formatting cache, not a correctness-critical
            // invariant, so a prior panicking holder shouldn't cascade into
            // every subsequent standards resolution.
            let cache = self
                .cache
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(cached) = cache.get(&key) {
                return if cached.is_empty() {
                    None
                } else {
                    Some(cached.clone())
                };
            }
        }

        // Resolve and format
        let resolved = resolve_standards(&self.tiers, filter.as_ref());
        let formatted: FormattedStandards =
            format_standards_for_prompt(&resolved, &self.format_options);

        let text = formatted.prompt_text;

        // Cache the result
        {
            let mut cache = self
                .cache
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            cache.insert(key, text.clone());
        }

        if text.is_empty() { None } else { Some(text) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use factory_contracts::AgentPrompt;
    use std::path::PathBuf;

    fn make_agent(id: &str, category: Option<&str>, tags: &[&str]) -> AgentPrompt {
        AgentPrompt {
            id: id.into(),
            role: "test".into(),
            tier: 1,
            prompt_text: String::new(),
            model_hint: None,
            source_path: PathBuf::from("test.md"),
            standards_category: category.map(String::from),
            standards_tags: tags.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn make_standard(id: &str, category: &str, tags: &[&str]) -> standards_loader::CodingStandard {
        standards_loader::CodingStandard {
            id: id.into(),
            category: category.into(),
            priority: standards_loader::StandardPriority::High,
            status: standards_loader::StandardStatus::Active,
            context: None,
            tags: tags.iter().map(|s| s.to_string()).collect(),
            rules: vec![standards_loader::StandardRule {
                verb: standards_loader::RuleVerb::ALWAYS,
                subject: format!("{id} rule"),
                rationale: "test".into(),
            }],
            anti_patterns: vec![],
            examples: vec![],
        }
    }

    fn test_tiers() -> TieredStandards {
        TieredStandards {
            official: vec![
                make_standard("security-001", "security", &["typescript", "owasp"]),
                make_standard("naming-001", "naming", &["typescript", "style"]),
                make_standard("testing-001", "testing", &["typescript", "jest"]),
            ],
            community: vec![],
            local: vec![],
        }
    }

    #[test]
    fn unfiltered_agent_gets_all_standards() {
        let bridge = Arc::new(FactoryAgentBridge::new(
            vec![make_agent("agent-a", None, &[])],
            vec![],
        ));
        let resolver =
            FactoryStandardsResolver::new(bridge, test_tiers(), FormatOptions::default());

        let text = resolver.resolve_for_agent("agent-a").unwrap();
        assert!(text.contains("security-001"));
        assert!(text.contains("naming-001"));
        assert!(text.contains("testing-001"));
    }

    #[test]
    fn agent_with_category_filter_gets_subset() {
        let bridge = Arc::new(FactoryAgentBridge::new(
            vec![make_agent("agent-b", Some("security"), &[])],
            vec![],
        ));
        let resolver =
            FactoryStandardsResolver::new(bridge, test_tiers(), FormatOptions::default());

        let text = resolver.resolve_for_agent("agent-b").unwrap();
        assert!(text.contains("security-001"));
        assert!(!text.contains("naming-001"));
        assert!(!text.contains("testing-001"));
    }

    #[test]
    fn agent_with_tag_filter_gets_matching() {
        let bridge = Arc::new(FactoryAgentBridge::new(
            vec![make_agent("agent-c", None, &["owasp"])],
            vec![],
        ));
        let resolver =
            FactoryStandardsResolver::new(bridge, test_tiers(), FormatOptions::default());

        let text = resolver.resolve_for_agent("agent-c").unwrap();
        assert!(text.contains("security-001")); // has owasp tag
        assert!(!text.contains("naming-001")); // no owasp tag
    }

    #[test]
    fn results_are_cached() {
        let bridge = Arc::new(FactoryAgentBridge::new(
            vec![make_agent("agent-a", None, &[])],
            vec![],
        ));
        let resolver =
            FactoryStandardsResolver::new(bridge, test_tiers(), FormatOptions::default());

        let text1 = resolver.resolve_for_agent("agent-a").unwrap();
        let text2 = resolver.resolve_for_agent("agent-a").unwrap();
        assert_eq!(text1, text2);

        // Verify cache was populated
        let cache = resolver.cache.lock().unwrap();
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn unknown_agent_resolves_without_filter() {
        let bridge = Arc::new(FactoryAgentBridge::new(vec![], vec![]));
        let resolver =
            FactoryStandardsResolver::new(bridge, test_tiers(), FormatOptions::default());

        // Unknown agent — bridge returns None for filter → all standards
        let text = resolver.resolve_for_agent("unknown-agent").unwrap();
        assert!(text.contains("3 coding standards apply"));
    }
}
