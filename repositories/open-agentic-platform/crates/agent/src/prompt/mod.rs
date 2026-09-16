// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: 070-PROMPT_ASSEMBLY_CACHE
// Spec: specs/070-prompt-assembly-cache/spec.md

//! Prompt Assembly and Cache Boundaries (spec 070).
//!
//! Implements modular system prompt assembly with explicit cache boundaries.
//! Static sections (tool schemas, behavioral rules, project instructions) are
//! assembled once and cached across turns. Dynamic sections (memory, workflow
//! state, MCP context) rebuild each turn.

mod assembler;
mod compaction;

pub use assembler::{
    AssembledPrompt, AssemblyContext, AssemblyMetadata, CACHE_BOUNDARY_MARKER, CacheLifetime,
    PromptAssembler, PromptSection, SectionSummary,
};
pub use compaction::{
    // Original API (backward compatible)
    CompactedResult,
    // Spec 046 rich types
    CompactionAuditEntry,
    CompactionMessage,
    CompactionService,
    CompactionTriggerDecision,
    ContentBlock,
    DiffStats,
    FileAction,
    FileModification,
    GitSnapshot,
    InterruptionInfo,
    Message,
    MessageContent,
    ProgrammaticCompactionOutput,
    ProgrammaticCompactor,
    SessionContext,
    SummarizerFn,
    TokenBudgetMonitor,
    TokenUsage,
    // Extraction functions
    build_task_summary,
    // XML rendering
    collapse_file_modification_section,
    detect_interruption,
    extract_file_modifications,
    extract_key_decisions,
    extract_steps,
    find_latest_unresolved_tool_call_id,
    minify_session_context_xml,
    render_session_context_xml,
};

#[cfg(test)]
mod tests;
