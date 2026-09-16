// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: 070-PROMPT_ASSEMBLY_CACHE

//! Section registry and prompt assembly pipeline.
//!
//! The assembler composes registered [`PromptSection`]s into an [`AssembledPrompt`]
//! with a static prefix (cacheable across turns) separated from a dynamic suffix
//! by [`CACHE_BOUNDARY_MARKER`].

use std::collections::HashMap;

/// Machine-readable separator between static and dynamic prompt content (FR-001).
/// The API client uses this to place the cache breakpoint.
pub const CACHE_BOUNDARY_MARKER: &str = "═══ CACHE BOUNDARY ═══";

/// Default total prompt budget in bytes (FR-005).
const DEFAULT_TOTAL_BUDGET: usize = 100 * 1024; // 100 KB

/// Default per-section budget when none is specified.
const DEFAULT_SECTION_BUDGET: usize = 32 * 1024; // 32 KB

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Cache lifetime for a prompt section (FR-002).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheLifetime {
    /// Assembled once, reused across turns.
    Static,
    /// Assembled once per session, cached within the session.
    PerSession,
    /// Rebuilt every turn.
    Dynamic,
}

/// Shared context threaded through content functions during assembly.
#[derive(Debug, Default)]
pub struct AssemblyContext {
    /// Key-value bag for arbitrary context (workflow state, session id, etc.).
    pub values: HashMap<String, String>,
}

/// A registered prompt section (FR-002).
pub struct PromptSection {
    /// Unique section name.
    pub name: String,
    /// Returns the section content for the current context.
    pub content_fn: Box<dyn Fn(&AssemblyContext) -> String + Send + Sync>,
    /// Determines caching behavior.
    pub cache_lifetime: CacheLifetime,
    /// Higher priority = earlier in the prompt.
    pub priority: u32,
    /// Per-section byte budget.
    pub max_bytes: usize,
}

/// Per-section metadata emitted after assembly (FR-008).
#[derive(Debug, Clone)]
pub struct SectionSummary {
    pub name: String,
    pub bytes: usize,
    pub cache_hit: bool,
    pub truncated: bool,
}

/// Metadata about the assembled prompt (FR-008).
#[derive(Debug, Clone)]
pub struct AssemblyMetadata {
    pub total_bytes: usize,
    pub section_count: usize,
    pub sections: Vec<SectionSummary>,
    pub truncated_sections: Vec<String>,
    pub budget_exceeded: bool,
}

/// The fully assembled prompt produced by [`PromptAssembler::assemble`] (FR-001).
#[derive(Debug, Clone)]
pub struct AssembledPrompt {
    /// Content that should be cached across turns.
    pub static_prefix: String,
    /// The cache boundary marker.
    pub cache_boundary: String,
    /// Content rebuilt each turn.
    pub dynamic_suffix: String,
    /// Assembly observability data.
    pub metadata: AssemblyMetadata,
}

impl AssembledPrompt {
    /// Render the full prompt as a single string.
    pub fn render(&self) -> String {
        if self.dynamic_suffix.is_empty() {
            self.static_prefix.clone()
        } else {
            format!(
                "{}\n{}\n{}",
                self.static_prefix, self.cache_boundary, self.dynamic_suffix
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Assembler
// ---------------------------------------------------------------------------

/// Prompt assembler with section registry, caching, and budget enforcement (FR-001 – FR-008).
pub struct PromptAssembler {
    sections: Vec<PromptSection>,
    total_budget: usize,
    cache: HashMap<String, String>,
}

impl PromptAssembler {
    /// Create an assembler with the default 100 KB budget.
    pub fn new() -> Self {
        Self {
            sections: Vec::new(),
            total_budget: DEFAULT_TOTAL_BUDGET,
            cache: HashMap::new(),
        }
    }

    /// Create an assembler with a custom total budget.
    pub fn with_budget(total_budget: usize) -> Self {
        Self {
            sections: Vec::new(),
            total_budget,
            cache: HashMap::new(),
        }
    }

    /// Register a new prompt section at runtime (FR-007).
    pub fn register_section(&mut self, section: PromptSection) {
        self.sections.push(section);
        // Re-sort so highest priority comes first.
        self.sections
            .sort_by_key(|s| std::cmp::Reverse(s.priority));
    }

    /// Invalidate the cache entry for a named section (R-001 mitigation).
    pub fn invalidate(&mut self, name: &str) {
        self.cache.remove(name);
    }

    /// Clear all cached content.
    pub fn invalidate_all(&mut self) {
        self.cache.clear();
    }

    /// Number of registered sections.
    pub fn section_count(&self) -> usize {
        self.sections.len()
    }

    /// Assemble the full prompt from registered sections (FR-001, FR-005, FR-008).
    pub fn assemble(&mut self, ctx: &AssemblyContext) -> AssembledPrompt {
        let mut static_parts: Vec<String> = Vec::new();
        let mut dynamic_parts: Vec<String> = Vec::new();
        let mut total_size: usize = 0;
        let mut section_summaries: Vec<SectionSummary> = Vec::new();
        let mut truncated_sections: Vec<String> = Vec::new();
        let mut budget_exceeded = false;

        for section in &self.sections {
            // Resolve content — use cache for static/per-session (FR-002).
            let cache_hit;
            let content = match section.cache_lifetime {
                CacheLifetime::Static | CacheLifetime::PerSession => {
                    if let Some(cached) = self.cache.get(&section.name) {
                        cache_hit = true;
                        cached.clone()
                    } else {
                        cache_hit = false;
                        let generated = (section.content_fn)(ctx);
                        self.cache.insert(section.name.clone(), generated.clone());
                        generated
                    }
                }
                CacheLifetime::Dynamic => {
                    cache_hit = false;
                    (section.content_fn)(ctx)
                }
            };

            // Per-section truncation (FR-005).
            let budget = if section.max_bytes > 0 {
                section.max_bytes
            } else {
                DEFAULT_SECTION_BUDGET
            };
            let was_truncated = content.len() > budget;
            let truncated = if was_truncated {
                truncate_to_budget(&content, budget)
            } else {
                content
            };

            // Total budget check (FR-005).
            if total_size + truncated.len() > self.total_budget {
                truncated_sections.push(section.name.clone());
                budget_exceeded = true;
                // Continue checking remaining sections — they're all dropped.
                for remaining in self.sections.iter().skip(section_summaries.len() + 1) {
                    truncated_sections.push(remaining.name.clone());
                }
                break;
            }

            total_size += truncated.len();

            section_summaries.push(SectionSummary {
                name: section.name.clone(),
                bytes: truncated.len(),
                cache_hit,
                truncated: was_truncated,
            });

            match section.cache_lifetime {
                CacheLifetime::Static | CacheLifetime::PerSession => {
                    static_parts.push(truncated);
                }
                CacheLifetime::Dynamic => {
                    dynamic_parts.push(truncated);
                }
            }
        }

        let section_count = section_summaries.len();

        AssembledPrompt {
            static_prefix: static_parts.join("\n"),
            cache_boundary: CACHE_BOUNDARY_MARKER.to_string(),
            dynamic_suffix: dynamic_parts.join("\n"),
            metadata: AssemblyMetadata {
                total_bytes: total_size,
                section_count,
                sections: section_summaries,
                truncated_sections,
                budget_exceeded,
            },
        }
    }
}

impl Default for PromptAssembler {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Truncate content to `max_bytes`, breaking at a UTF-8 char boundary,
/// and appending a truncation notice.
fn truncate_to_budget(content: &str, max_bytes: usize) -> String {
    const NOTICE: &str = "\n[... truncated]";
    if content.len() <= max_bytes {
        return content.to_string();
    }
    let usable = max_bytes.saturating_sub(NOTICE.len());
    // Walk back to a char boundary.
    let mut end = usable;
    while end > 0 && !content.is_char_boundary(end) {
        end -= 1;
    }
    let mut out = content[..end].to_string();
    out.push_str(NOTICE);
    out
}
