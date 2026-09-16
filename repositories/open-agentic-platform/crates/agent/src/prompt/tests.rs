// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: 070-PROMPT_ASSEMBLY_CACHE

use super::*;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn static_section(name: &str, priority: u32, content: &str) -> PromptSection {
    let c = content.to_string();
    PromptSection {
        name: name.to_string(),
        content_fn: Box::new(move |_ctx| c.clone()),
        cache_lifetime: CacheLifetime::Static,
        priority,
        max_bytes: 32 * 1024,
    }
}

fn dynamic_section(name: &str, priority: u32, content: &str) -> PromptSection {
    let c = content.to_string();
    PromptSection {
        name: name.to_string(),
        content_fn: Box::new(move |_ctx| c.clone()),
        cache_lifetime: CacheLifetime::Dynamic,
        priority,
        max_bytes: 32 * 1024,
    }
}

fn ctx() -> AssemblyContext {
    AssemblyContext::default()
}

// ---------------------------------------------------------------------------
// SC-001: Static sections produce byte-identical content across turns
// ---------------------------------------------------------------------------

#[test]
fn static_sections_are_deterministic_across_turns() {
    let mut asm = PromptAssembler::new();
    asm.register_section(static_section("identity", 1000, "You are OAP."));
    asm.register_section(static_section("rules", 900, "Rule 1. Rule 2."));

    let ctx = ctx();
    let first = asm.assemble(&ctx);
    let second = asm.assemble(&ctx);

    assert_eq!(
        first.static_prefix, second.static_prefix,
        "static prefix must be byte-identical across turns"
    );
}

#[test]
fn static_sections_serve_from_cache_on_second_call() {
    let mut asm = PromptAssembler::new();
    asm.register_section(static_section("identity", 1000, "You are OAP."));

    let ctx = ctx();
    let first = asm.assemble(&ctx);
    let second = asm.assemble(&ctx);

    // First call: cache miss. Second call: cache hit.
    assert!(!first.metadata.sections[0].cache_hit);
    assert!(second.metadata.sections[0].cache_hit);
}

// ---------------------------------------------------------------------------
// SC-002: Adding a new section requires one register_section() call
// ---------------------------------------------------------------------------

#[test]
fn runtime_section_registration() {
    let mut asm = PromptAssembler::new();
    assert_eq!(asm.section_count(), 0);

    asm.register_section(dynamic_section("env", 100, "date: 2026-04-04"));
    assert_eq!(asm.section_count(), 1);

    let result = asm.assemble(&ctx());
    assert!(result.dynamic_suffix.contains("2026-04-04"));
}

// ---------------------------------------------------------------------------
// Section ordering (priority descending)
// ---------------------------------------------------------------------------

#[test]
fn sections_ordered_by_priority_descending() {
    let mut asm = PromptAssembler::new();
    asm.register_section(static_section("low", 100, "LOW"));
    asm.register_section(static_section("high", 900, "HIGH"));
    asm.register_section(static_section("mid", 500, "MID"));

    let result = asm.assemble(&ctx());
    let rendered = result.static_prefix;

    let pos_high = rendered.find("HIGH").expect("HIGH present");
    let pos_mid = rendered.find("MID").expect("MID present");
    let pos_low = rendered.find("LOW").expect("LOW present");

    assert!(pos_high < pos_mid, "HIGH before MID");
    assert!(pos_mid < pos_low, "MID before LOW");
}

// ---------------------------------------------------------------------------
// SC-003: Budget enforcement — lowest-priority sections truncated
// ---------------------------------------------------------------------------

#[test]
fn total_budget_drops_lowest_priority_sections() {
    // Budget of 50 bytes. Two sections, each ~30 bytes.
    let mut asm = PromptAssembler::with_budget(50);
    asm.register_section(static_section("important", 900, "A".repeat(30).as_str()));
    asm.register_section(dynamic_section("optional", 100, "B".repeat(30).as_str()));

    let result = asm.assemble(&ctx());

    // "important" fits (30 bytes < 50), "optional" would push to 60 → dropped.
    assert!(result.static_prefix.contains(&"A".repeat(30)));
    assert!(!result.dynamic_suffix.contains("B"));
    assert!(result.metadata.budget_exceeded);
    assert!(
        result
            .metadata
            .truncated_sections
            .contains(&"optional".to_string())
    );
}

#[test]
fn per_section_truncation() {
    let mut asm = PromptAssembler::new();
    let big = "X".repeat(1000);
    let big_clone = big.clone();
    asm.register_section(PromptSection {
        name: "small_budget".to_string(),
        content_fn: Box::new(move |_| big_clone.clone()),
        cache_lifetime: CacheLifetime::Static,
        priority: 500,
        max_bytes: 100, // only 100 bytes allowed
    });

    let result = asm.assemble(&ctx());
    let section = &result.metadata.sections[0];

    assert!(section.truncated);
    assert!(section.bytes <= 100);
    assert!(result.static_prefix.contains("[... truncated]"));
}

// ---------------------------------------------------------------------------
// Cache boundary marker present in rendered output (FR-001)
// ---------------------------------------------------------------------------

#[test]
fn cache_boundary_in_rendered_output() {
    let mut asm = PromptAssembler::new();
    asm.register_section(static_section("identity", 1000, "Static part."));
    asm.register_section(dynamic_section("env", 100, "Dynamic part."));

    let result = asm.assemble(&ctx());
    let rendered = result.render();

    assert!(rendered.contains(CACHE_BOUNDARY_MARKER));
    let parts: Vec<&str> = rendered.split(CACHE_BOUNDARY_MARKER).collect();
    assert_eq!(parts.len(), 2);
    assert!(parts[0].contains("Static part."));
    assert!(parts[1].contains("Dynamic part."));
}

#[test]
fn no_boundary_when_no_dynamic_sections() {
    let mut asm = PromptAssembler::new();
    asm.register_section(static_section("identity", 1000, "Only static."));

    let result = asm.assemble(&ctx());
    let rendered = result.render();

    assert!(!rendered.contains(CACHE_BOUNDARY_MARKER));
}

// ---------------------------------------------------------------------------
// Cache invalidation (R-001)
// ---------------------------------------------------------------------------

#[test]
fn invalidate_forces_regeneration() {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU32, Ordering};

    let counter = Arc::new(AtomicU32::new(0));
    let counter_clone = counter.clone();

    let mut asm = PromptAssembler::new();
    asm.register_section(PromptSection {
        name: "versioned".to_string(),
        content_fn: Box::new(move |_| {
            let n = counter_clone.fetch_add(1, Ordering::SeqCst);
            format!("v{n}")
        }),
        cache_lifetime: CacheLifetime::Static,
        priority: 500,
        max_bytes: 1024,
    });

    let ctx = ctx();
    let r1 = asm.assemble(&ctx);
    assert_eq!(r1.static_prefix, "v0");

    // Second call should serve from cache.
    let r2 = asm.assemble(&ctx);
    assert_eq!(r2.static_prefix, "v0");

    // Invalidate and reassemble.
    asm.invalidate("versioned");
    let r3 = asm.assemble(&ctx);
    assert_eq!(r3.static_prefix, "v1");
}

// ---------------------------------------------------------------------------
// SC-005: Assembly metadata
// ---------------------------------------------------------------------------

#[test]
fn metadata_reports_section_details() {
    let mut asm = PromptAssembler::new();
    asm.register_section(static_section("a", 900, "AAA"));
    asm.register_section(dynamic_section("b", 100, "BB"));

    let result = asm.assemble(&ctx());

    assert_eq!(result.metadata.section_count, 2);
    assert_eq!(result.metadata.total_bytes, 5); // "AAA" + "BB"
    assert_eq!(result.metadata.sections.len(), 2);
    assert_eq!(result.metadata.sections[0].name, "a");
    assert_eq!(result.metadata.sections[0].bytes, 3);
    assert_eq!(result.metadata.sections[1].name, "b");
    assert_eq!(result.metadata.sections[1].bytes, 2);
}

// ---------------------------------------------------------------------------
// Dynamic sections rebuilt each turn
// ---------------------------------------------------------------------------

#[test]
fn dynamic_sections_rebuild_each_turn() {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU32, Ordering};

    let counter = Arc::new(AtomicU32::new(0));
    let counter_clone = counter.clone();

    let mut asm = PromptAssembler::new();
    asm.register_section(PromptSection {
        name: "turncount".to_string(),
        content_fn: Box::new(move |_| {
            let n = counter_clone.fetch_add(1, Ordering::SeqCst);
            format!("turn {n}")
        }),
        cache_lifetime: CacheLifetime::Dynamic,
        priority: 100,
        max_bytes: 1024,
    });

    let ctx = ctx();
    assert_eq!(asm.assemble(&ctx).dynamic_suffix, "turn 0");
    assert_eq!(asm.assemble(&ctx).dynamic_suffix, "turn 1");
    assert_eq!(asm.assemble(&ctx).dynamic_suffix, "turn 2");
}

// ---------------------------------------------------------------------------
// PerSession caching
// ---------------------------------------------------------------------------

#[test]
fn per_session_sections_cached_within_session() {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU32, Ordering};

    let counter = Arc::new(AtomicU32::new(0));
    let counter_clone = counter.clone();

    let mut asm = PromptAssembler::new();
    asm.register_section(PromptSection {
        name: "session_ctx".to_string(),
        content_fn: Box::new(move |_| {
            let n = counter_clone.fetch_add(1, Ordering::SeqCst);
            format!("session {n}")
        }),
        cache_lifetime: CacheLifetime::PerSession,
        priority: 600,
        max_bytes: 1024,
    });

    let ctx = ctx();
    assert_eq!(asm.assemble(&ctx).static_prefix, "session 0");
    assert_eq!(asm.assemble(&ctx).static_prefix, "session 0"); // cached

    asm.invalidate("session_ctx");
    assert_eq!(asm.assemble(&ctx).static_prefix, "session 1"); // regenerated
}

// ---------------------------------------------------------------------------
// SC-004 / SC-006: Compaction service
// ---------------------------------------------------------------------------

fn make_messages(n: usize, size_each: usize) -> Vec<Message> {
    (0..n)
        .map(|i| Message {
            role: "user".to_string(),
            content: format!("msg{i} {}", "x".repeat(size_each)),
        })
        .collect()
}

#[test]
fn compaction_triggers_at_threshold() {
    let svc = CompactionService::new(|_msgs| "summary".to_string());

    // Window = 1000, threshold = 0.8 → fires at 800.
    let msgs = make_messages(5, 150); // ~5 * (4 + 4 + 150) ≈ 790
    let prompt_size = 50;

    // 50 + 790 = 840 > 800 → should compact
    assert!(svc.should_compact(prompt_size, &msgs, 1000));

    // Smaller prompt → under threshold
    assert!(!svc.should_compact(0, &msgs, 2000));
}

#[test]
fn compaction_keeps_recent_messages() {
    let svc = CompactionService {
        window_threshold: 0.8,
        keep_recent: 3,
        summarizer: Box::new(|msgs| format!("summarized {} messages", msgs.len())),
    };

    let msgs = make_messages(10, 10);
    let result = svc.compact(&msgs);

    assert_eq!(result.compacted_count, 7);
    assert_eq!(result.kept_messages.len(), 3);
    assert_eq!(result.summary, "summarized 7 messages");
}

#[test]
fn compaction_noop_when_fewer_than_keep_recent() {
    let svc = CompactionService {
        window_threshold: 0.8,
        keep_recent: 10,
        summarizer: Box::new(|_| panic!("should not be called")),
    };

    let msgs = make_messages(5, 10);
    let result = svc.compact(&msgs);

    assert_eq!(result.compacted_count, 0);
    assert_eq!(result.kept_messages.len(), 5);
    assert!(result.summary.is_empty());
}

// ---------------------------------------------------------------------------
// NF-003: Assembly testable without API connection
// ---------------------------------------------------------------------------

#[test]
fn assembly_works_in_isolation() {
    // This entire test suite runs without any network or API connection,
    // demonstrating NF-003.
    let mut asm = PromptAssembler::new();
    asm.register_section(static_section("id", 1000, "System identity."));
    asm.register_section(dynamic_section("env", 100, "env data"));

    let result = asm.assemble(&ctx());
    assert!(!result.render().is_empty());
}

// ---------------------------------------------------------------------------
// AssemblyContext plumbing
// ---------------------------------------------------------------------------

#[test]
fn context_values_available_to_content_fn() {
    let mut asm = PromptAssembler::new();
    asm.register_section(PromptSection {
        name: "ctx_reader".to_string(),
        content_fn: Box::new(|ctx| {
            ctx.values
                .get("model")
                .cloned()
                .unwrap_or_else(|| "unknown".to_string())
        }),
        cache_lifetime: CacheLifetime::Dynamic,
        priority: 100,
        max_bytes: 1024,
    });

    let mut ctx = AssemblyContext::default();
    ctx.values.insert("model".to_string(), "opus-4".to_string());

    let result = asm.assemble(&ctx);
    assert_eq!(result.dynamic_suffix, "opus-4");
}
