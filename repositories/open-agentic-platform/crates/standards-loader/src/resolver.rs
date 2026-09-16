// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: 055-yaml-standards-schema

//! Three-tier standards resolution with category/tag filtering (FR-004, FR-008, SC-003).

use crate::loader::TieredStandards;
use crate::types::{CodingStandard, StandardStatus};
use std::collections::HashMap;

/// Filter criteria for resolved standards (FR-008).
#[derive(Debug, Clone, Default)]
pub struct StandardsFilter {
    /// Only include standards matching this category.
    pub category: Option<String>,
    /// Only include standards that have at least one of these tags.
    pub tags: Vec<String>,
}

impl StandardsFilter {
    /// Returns true if this filter would match all standards (no constraints).
    pub fn is_empty(&self) -> bool {
        self.category.is_none() && self.tags.is_empty()
    }
}

/// Merge standards across tiers with later-wins precedence for the same `id` (FR-004).
/// Excludes `status: candidate` and `status: rejected` from the resolved set (SC-003).
/// Applies category and tag filtering (FR-008).
/// Returns standards sorted by priority (critical first) then by id for determinism.
pub fn resolve_standards(
    tiers: &TieredStandards,
    filter: Option<&StandardsFilter>,
) -> Vec<CodingStandard> {
    let mut merged: HashMap<String, CodingStandard> = HashMap::new();

    // Apply tiers in order: official → community → local (later wins for same id)
    for tier in [&tiers.official, &tiers.community, &tiers.local] {
        for standard in tier {
            // Exclude non-active standards (SC-003)
            if standard.status != StandardStatus::Active {
                continue;
            }
            merged.insert(standard.id.clone(), standard.clone());
        }
    }

    // Apply filters if provided (FR-008)
    let mut result: Vec<CodingStandard> = merged.into_values().collect();

    if let Some(f) = filter {
        if let Some(ref category) = f.category {
            result.retain(|s| s.category == *category);
        }
        if !f.tags.is_empty() {
            result.retain(|s| f.tags.iter().any(|t| s.tags.contains(t)));
        }
    }

    // Sort by priority rank (critical first) then by id for determinism
    result.sort_by(|a, b| {
        a.priority
            .rank()
            .cmp(&b.priority.rank())
            .then_with(|| a.id.cmp(&b.id))
    });

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::*;

    fn make_standard(
        id: &str,
        category: &str,
        priority: StandardPriority,
        tags: &[&str],
    ) -> CodingStandard {
        CodingStandard {
            id: id.into(),
            category: category.into(),
            priority,
            status: StandardStatus::Active,
            context: None,
            tags: tags.iter().map(|s| s.to_string()).collect(),
            rules: vec![StandardRule {
                verb: RuleVerb::ALWAYS,
                subject: "test".into(),
                rationale: "test".into(),
            }],
            anti_patterns: vec![],
            examples: vec![],
        }
    }

    fn make_candidate(id: &str) -> CodingStandard {
        let mut s = make_standard(id, "test", StandardPriority::Low, &[]);
        s.status = StandardStatus::Candidate;
        s
    }

    #[test]
    fn resolve_merges_tiers_with_later_wins() {
        let tiers = TieredStandards {
            official: vec![make_standard("a", "cat", StandardPriority::Low, &[])],
            community: vec![],
            local: vec![make_standard("a", "cat", StandardPriority::Critical, &[])],
        };
        let result = resolve_standards(&tiers, None);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].priority, StandardPriority::Critical); // local wins
    }

    #[test]
    fn resolve_excludes_candidates() {
        let tiers = TieredStandards {
            official: vec![
                make_standard("active-1", "cat", StandardPriority::High, &[]),
                make_candidate("candidate-1"),
            ],
            community: vec![],
            local: vec![],
        };
        let result = resolve_standards(&tiers, None);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "active-1");
    }

    #[test]
    fn resolve_filters_by_category() {
        let tiers = TieredStandards {
            official: vec![
                make_standard("sec-1", "security", StandardPriority::High, &[]),
                make_standard("name-1", "naming", StandardPriority::Medium, &[]),
            ],
            community: vec![],
            local: vec![],
        };
        let filter = StandardsFilter {
            category: Some("security".into()),
            tags: vec![],
        };
        let result = resolve_standards(&tiers, Some(&filter));
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "sec-1");
    }

    #[test]
    fn resolve_filters_by_tags() {
        let tiers = TieredStandards {
            official: vec![
                make_standard("a", "cat", StandardPriority::High, &["typescript", "async"]),
                make_standard("b", "cat", StandardPriority::Low, &["rust"]),
                make_standard("c", "cat", StandardPriority::Medium, &["typescript"]),
            ],
            community: vec![],
            local: vec![],
        };
        let filter = StandardsFilter {
            category: None,
            tags: vec!["typescript".into()],
        };
        let result = resolve_standards(&tiers, Some(&filter));
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].id, "a"); // high priority first
        assert_eq!(result[1].id, "c");
    }

    #[test]
    fn resolve_sorts_by_priority_then_id() {
        let tiers = TieredStandards {
            official: vec![
                make_standard("z", "cat", StandardPriority::High, &[]),
                make_standard("a", "cat", StandardPriority::High, &[]),
                make_standard("m", "cat", StandardPriority::Critical, &[]),
            ],
            community: vec![],
            local: vec![],
        };
        let result = resolve_standards(&tiers, None);
        assert_eq!(result[0].id, "m"); // critical first
        assert_eq!(result[1].id, "a"); // then alphabetical within high
        assert_eq!(result[2].id, "z");
    }

    #[test]
    fn empty_filter_matches_all() {
        let tiers = TieredStandards {
            official: vec![
                make_standard("a", "cat", StandardPriority::High, &[]),
                make_standard("b", "cat", StandardPriority::Low, &[]),
            ],
            community: vec![],
            local: vec![],
        };
        let filter = StandardsFilter::default();
        assert!(filter.is_empty());
        let result = resolve_standards(&tiers, Some(&filter));
        assert_eq!(result.len(), 2);
    }
}
