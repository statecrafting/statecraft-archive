// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: 070-PROMPT_ASSEMBLY_CACHE

//! Context compaction service (FR-006, integrates with spec 046).
//!
//! Monitors conversation size against the model's context window and triggers
//! summarization when the threshold is reached. Always keeps the last K messages
//! uncompacted to preserve recent context (R-002 mitigation).
//!
//! The module provides two compaction tiers:
//! - **`CompactionService`** — lightweight byte-budget gate using the simple `Message` type.
//! - **`ProgrammaticCompactor`** — structured compaction using the richer `CompactionMessage`
//!   type, producing spec 046 XML session-context blocks.

use regex::Regex;
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Existing API — kept intact for backward compatibility
// ---------------------------------------------------------------------------

/// A conversation message (role + content) for size accounting.
#[derive(Debug, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
}

impl Message {
    /// Approximate byte size (role + content).
    pub fn byte_size(&self) -> usize {
        self.role.len() + self.content.len()
    }
}

/// Output of a compaction pass.
#[derive(Debug, Clone)]
pub struct CompactedResult {
    /// Summary of the compacted messages.
    pub summary: String,
    /// Recent messages preserved verbatim.
    pub kept_messages: Vec<Message>,
    /// How many messages were summarized.
    pub compacted_count: usize,
}

/// Pluggable summarizer function type.
pub type SummarizerFn = Box<dyn Fn(&[Message]) -> String + Send + Sync>;

/// Compaction service that monitors context size and triggers summarization (FR-006).
pub struct CompactionService {
    /// Fraction of the context window that triggers compaction (default 0.8).
    pub window_threshold: f32,
    /// Number of recent messages to keep uncompacted (default 10).
    pub keep_recent: usize,
    /// Pluggable summarizer — takes a slice of messages, returns a summary string.
    pub summarizer: SummarizerFn,
}

impl CompactionService {
    /// Create a compaction service with defaults and the given summarizer.
    pub fn new(summarizer: impl Fn(&[Message]) -> String + Send + Sync + 'static) -> Self {
        Self {
            window_threshold: 0.8,
            keep_recent: 10,
            summarizer: Box::new(summarizer),
        }
    }

    /// Check whether compaction should fire (FR-006).
    ///
    /// Returns `true` when `prompt_size + message_size >= threshold * model_context_window`.
    pub fn should_compact(
        &self,
        prompt_size: usize,
        messages: &[Message],
        model_context_window: usize,
    ) -> bool {
        let message_size: usize = messages.iter().map(|m| m.byte_size()).sum();
        let total = prompt_size + message_size;
        let limit = (model_context_window as f64 * self.window_threshold as f64) as usize;
        total >= limit
    }

    /// Run compaction: summarize older messages, keep recent ones (R-002).
    pub fn compact(&self, messages: &[Message]) -> CompactedResult {
        if messages.len() <= self.keep_recent {
            // Nothing to compact — all messages are "recent".
            return CompactedResult {
                summary: String::new(),
                kept_messages: messages.to_vec(),
                compacted_count: 0,
            };
        }

        let split = messages.len() - self.keep_recent;
        let to_summarize = &messages[..split];
        let to_keep = &messages[split..];

        let summary = (self.summarizer)(to_summarize);

        CompactedResult {
            summary,
            kept_messages: to_keep.to_vec(),
            compacted_count: split,
        }
    }
}

// ---------------------------------------------------------------------------
// C1: New types for structured (spec 046) compaction
// ---------------------------------------------------------------------------

/// Git diff insertion/deletion statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffStats {
    pub insertions: u32,
    pub deletions: u32,
    pub files_changed: u32,
}

/// Point-in-time snapshot of repository state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitSnapshot {
    pub branch: String,
    pub staged_changes: u32,
    pub unstaged_changes: u32,
    pub last_commit_hash: String,
    pub last_commit_message: String,
    pub diff_stats: DiffStats,
}

/// Information about a detected interruption that must be resumed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterruptionInfo {
    pub detected: bool,
    pub operation: String,
    pub state: String,
    pub resumption_hint: String,
}

/// Describes what happened to a file during the compacted session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileAction {
    Created,
    Modified,
    Deleted,
}

impl FileAction {
    fn as_str(&self) -> &'static str {
        match self {
            FileAction::Created => "created",
            FileAction::Modified => "modified",
            FileAction::Deleted => "deleted",
        }
    }
}

/// A file that was created, modified, or deleted during the session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileModification {
    pub path: String,
    pub action: FileAction,
    pub description: String,
}

/// Full session context produced by the programmatic compactor (spec 046).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionContext {
    pub version: u32,
    pub compacted_at: String,
    pub turn_count_original: usize,
    pub token_count_original: usize,
    pub task_summary: String,
    pub completed_steps: Vec<String>,
    pub pending_steps: Vec<String>,
    pub file_modifications: Vec<FileModification>,
    pub git_state: GitSnapshot,
    pub key_decisions: Vec<String>,
    pub interruption: Option<InterruptionInfo>,
}

/// Audit record produced after a compaction pass.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactionAuditEntry {
    pub session_id: String,
    pub before_count: usize,
    pub after_count: usize,
    pub tokens_saved: usize,
    pub compacted_at: String,
}

/// Token usage for a single message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input_tokens: usize,
    pub output_tokens: usize,
}

/// A content block within a `CompactionMessage`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
    },
    ToolUse {
        id: Option<String>,
        name: Option<String>,
    },
    ToolResult {
        tool_use_id: Option<String>,
        content: Option<String>,
    },
}

/// The content of a `CompactionMessage` — either a plain string or a list of blocks.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

impl MessageContent {
    /// Flatten to a plain string for text analysis.
    pub fn to_text(&self) -> String {
        match self {
            MessageContent::Text(s) => s.clone(),
            MessageContent::Blocks(blocks) => {
                let parts: Vec<String> = blocks
                    .iter()
                    .map(|b| match b {
                        ContentBlock::Text { text } => text.clone(),
                        ContentBlock::ToolUse { id, name } => format!(
                            "tool_use:{}:{}",
                            name.as_deref().unwrap_or("unknown"),
                            id.as_deref().unwrap_or("unknown")
                        ),
                        ContentBlock::ToolResult { content, .. } => {
                            content.clone().unwrap_or_default()
                        }
                    })
                    .collect();
                parts.join("\n")
            }
        }
    }
}

/// Rich message type for structured compaction. The existing `Message` is kept for
/// backward compatibility with the lightweight `CompactionService`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactionMessage {
    pub id: String,
    pub role: String,
    pub content: MessageContent,
    pub timestamp: Option<String>,
    pub pinned: bool,
    pub usage: Option<TokenUsage>,
    pub tool_name: Option<String>,
    pub tool_call_id: Option<String>,
}

// ---------------------------------------------------------------------------
// C2: Extraction functions
// ---------------------------------------------------------------------------

/// Find the latest tool_use ID that has no matching tool_result.
pub fn find_latest_unresolved_tool_call_id(messages: &[CompactionMessage]) -> Option<String> {
    // Collect all IDs that have been resolved via tool_result blocks or tool role messages.
    let mut seen_results: std::collections::HashSet<String> = std::collections::HashSet::new();

    for msg in messages {
        if msg.role == "tool"
            && let Some(id) = &msg.tool_call_id
        {
            seen_results.insert(id.clone());
        }
        if let MessageContent::Blocks(blocks) = &msg.content {
            for block in blocks {
                if let ContentBlock::ToolResult {
                    tool_use_id: Some(id),
                    ..
                } = block
                {
                    seen_results.insert(id.clone());
                }
            }
        }
    }

    // Walk in reverse to find the last tool_use that has no result.
    for msg in messages.iter().rev() {
        if let Some(id) = &msg.tool_call_id
            && !seen_results.contains(id.as_str())
        {
            return Some(id.clone());
        }
        if let MessageContent::Blocks(blocks) = &msg.content {
            // Walk blocks in reverse too so we return the last one.
            for block in blocks.iter().rev() {
                if let ContentBlock::ToolUse { id: Some(id), .. } = block
                    && !seen_results.contains(id.as_str())
                {
                    return Some(id.clone());
                }
            }
        }
    }

    None
}

/// Detect interruption based on ≥ 2 signals:
/// - unresolved tool call
/// - uncommitted changes (staged + unstaged > 0)
/// - trailing question in last assistant message
/// - "next step" language in last assistant message
/// - pending steps > 0
pub fn detect_interruption(
    messages: &[CompactionMessage],
    git: &GitSnapshot,
    pending_steps_count: usize,
) -> Option<InterruptionInfo> {
    let unresolved_tool_id = find_latest_unresolved_tool_call_id(messages);
    let uncommitted_changes = git.staged_changes + git.unstaged_changes > 0;

    let last_assistant_text = messages
        .iter()
        .rev()
        .find(|m| m.role == "assistant")
        .map(|m| m.content.to_text())
        .unwrap_or_default();
    let last_assistant_trimmed = last_assistant_text.trim();

    let asks_question = last_assistant_trimmed.ends_with('?');
    let explicit_next_step = {
        let lower = last_assistant_trimmed.to_lowercase();
        lower.contains("next step")
    };
    let has_incomplete_plan = pending_steps_count > 0;

    // Count active signals (asks_question + explicit_next_step counts as one combined signal)
    let mut signal_count = 0usize;
    if unresolved_tool_id.is_some() {
        signal_count += 1;
    }
    if uncommitted_changes {
        signal_count += 1;
    }
    if asks_question || explicit_next_step {
        signal_count += 1;
    }
    if has_incomplete_plan {
        signal_count += 1;
    }

    if signal_count < 2 {
        return None;
    }

    // Determine the most specific interruption description.
    if let Some(tool_id) = unresolved_tool_id {
        return Some(InterruptionInfo {
            detected: true,
            operation: format!("Tool operation {tool_id}"),
            state: "Tool call has no corresponding tool result.".to_string(),
            resumption_hint: "Resume by collecting or replaying the missing tool result."
                .to_string(),
        });
    }

    if uncommitted_changes {
        return Some(InterruptionInfo {
            detected: true,
            operation: "Pending git worktree changes".to_string(),
            state: format!(
                "{} staged and {} unstaged changes detected.",
                git.staged_changes, git.unstaged_changes
            ),
            resumption_hint: "Review current diff and complete or commit the in-progress edits."
                .to_string(),
        });
    }

    if asks_question || explicit_next_step {
        let state = truncate_text(last_assistant_trimmed, 220);
        return Some(InterruptionInfo {
            detected: true,
            operation: "Assistant requested next action".to_string(),
            state,
            resumption_hint: "Answer the pending question or execute the proposed next step."
                .to_string(),
        });
    }

    Some(InterruptionInfo {
        detected: true,
        operation: "Incomplete multi-step plan".to_string(),
        state: format!("{pending_steps_count} step(s) still pending/in-progress."),
        resumption_hint: "Continue remaining pending steps before starting new work.".to_string(),
    })
}

/// Extract completed (`completed = true`) or pending (`completed = false`) steps
/// from markdown checkbox patterns in the messages. Results are deduped and capped at 12.
pub fn extract_steps(messages: &[CompactionMessage], completed: bool) -> Vec<String> {
    let completed_re = Regex::new(r"(?m)^\s*[-*]\s*\[(x|X)\]\s+(.+)$").unwrap();
    let completed_num_re = Regex::new(r"(?m)^\s*\d+\.\s*\[(x|X)\]\s+(.+)$").unwrap();
    let pending_re = Regex::new(r"(?m)^\s*[-*]\s*\[\s*\]\s+(.+)$").unwrap();
    let pending_num_re = Regex::new(r"(?m)^\s*\d+\.\s*\[\s*\]\s+(.+)$").unwrap();

    let mut out: Vec<String> = Vec::new();

    for msg in messages {
        let text = msg.content.to_text();
        if completed {
            for cap in completed_re.captures_iter(&text) {
                if let Some(step) = cap.get(2) {
                    out.push(compact_whitespace(step.as_str()));
                }
            }
            for cap in completed_num_re.captures_iter(&text) {
                if let Some(step) = cap.get(2) {
                    out.push(compact_whitespace(step.as_str()));
                }
            }
        } else {
            for cap in pending_re.captures_iter(&text) {
                if let Some(step) = cap.get(1) {
                    out.push(compact_whitespace(step.as_str()));
                }
            }
            for cap in pending_num_re.captures_iter(&text) {
                if let Some(step) = cap.get(1) {
                    out.push(compact_whitespace(step.as_str()));
                }
            }
        }
    }

    dedup_stable(out, 12)
}

/// Extract key decisions from message content. Scans for leading keywords:
/// `decision:`, `constraint:`, `must `, `should `, `do not `.
/// Results are deduped and capped at 10.
pub fn extract_key_decisions(messages: &[CompactionMessage]) -> Vec<String> {
    let keyword_re = Regex::new(r"(?i)^(decision|constraint|must|should|do not)\b").unwrap();
    let mut values: Vec<String> = Vec::new();

    for msg in messages {
        let text = msg.content.to_text();
        for line in text.lines() {
            let normalized = line.trim();
            if keyword_re.is_match(normalized) {
                values.push(compact_whitespace(normalized));
            }
        }
    }

    dedup_stable(values, 10)
}

/// Extract file modifications from message content. Recognises paths with common
/// extensions. Infers action from surrounding text. Deduped by path (last wins),
/// capped at 20.
pub fn extract_file_modifications(messages: &[CompactionMessage]) -> Vec<FileModification> {
    let path_re = Regex::new(
        r"\b([A-Za-z0-9_./-]+\.(ts|tsx|js|jsx|rs|md|json|yaml|yml|toml|py|go|swift|kt|java|c|cpp|h|hpp|sh|bash|env|lock|sql))\b",
    )
    .unwrap();

    // Use an IndexMap-like ordered map: Vec of (path, modification), last write wins.
    let mut map: std::collections::HashMap<String, FileModification> =
        std::collections::HashMap::new();
    let mut order: Vec<String> = Vec::new();

    for msg in messages {
        let text = msg.content.to_text();
        let action = infer_file_action(&text);
        for cap in path_re.captures_iter(&text) {
            let path = cap[1].to_string();
            if !map.contains_key(&path) {
                order.push(path.clone());
            }
            map.insert(
                path.clone(),
                FileModification {
                    path: path.clone(),
                    action: action.clone(),
                    description: format!("Referenced during {} workflow.", action.as_str()),
                },
            );
        }
    }

    let mut result: Vec<FileModification> =
        order.into_iter().filter_map(|p| map.remove(&p)).collect();
    result.sort_by(|a, b| a.path.cmp(&b.path));
    result.truncate(20);
    result
}

/// Build a task summary from the first user message.
pub fn build_task_summary(
    messages: &[CompactionMessage],
    completed: usize,
    pending: usize,
) -> String {
    let first_user = messages.iter().find(|m| m.role == "user");
    let goal = first_user
        .map(|m| truncate_text(&m.content.to_text(), 180))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Continue current task.".to_string());
    format!("{goal} Completed {completed} step(s); {pending} pending/in-progress.")
}

// ---------------------------------------------------------------------------
// C3: XML rendering
// ---------------------------------------------------------------------------

/// Escape XML special characters (`&`, `<`, `>`, `"`, `'`).
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Render a `SessionContext` to the spec 046 XML format.
pub fn render_session_context_xml(ctx: &SessionContext) -> String {
    let mut lines: Vec<String> = Vec::new();

    lines.push(format!(
        r#"<session_context version="{}" compacted_at="{}" turn_count_original="{}" token_count_original="{}">"#,
        ctx.version,
        xml_escape(&ctx.compacted_at),
        ctx.turn_count_original,
        ctx.token_count_original,
    ));

    lines.push("  <task_summary>".to_string());
    lines.push(format!("    {}", xml_escape(&ctx.task_summary)));
    lines.push("  </task_summary>".to_string());
    lines.push(String::new());

    lines.push("  <completed_steps>".to_string());
    if ctx.completed_steps.is_empty() {
        lines.push(r#"    <step index="1">No completed steps captured yet.</step>"#.to_string());
    } else {
        for (i, step) in ctx.completed_steps.iter().enumerate() {
            lines.push(format!(
                r#"    <step index="{}">{}</step>"#,
                i + 1,
                xml_escape(step)
            ));
        }
    }
    lines.push("  </completed_steps>".to_string());
    lines.push(String::new());

    lines.push("  <pending_steps>".to_string());
    if ctx.pending_steps.is_empty() {
        lines.push(r#"    <step index="1">No pending steps captured.</step>"#.to_string());
    } else {
        for (i, step) in ctx.pending_steps.iter().enumerate() {
            lines.push(format!(
                r#"    <step index="{}">{}</step>"#,
                i + 1,
                xml_escape(step)
            ));
        }
    }
    lines.push("  </pending_steps>".to_string());
    lines.push(String::new());

    lines.push("  <file_modifications>".to_string());
    if ctx.file_modifications.is_empty() {
        lines.push(
            r#"    <file path="none" action="modified">No file modifications detected.</file>"#
                .to_string(),
        );
    } else {
        for fm in &ctx.file_modifications {
            lines.push(format!(
                r#"    <file path="{}" action="{}">{}</file>"#,
                xml_escape(&fm.path),
                fm.action.as_str(),
                xml_escape(&fm.description)
            ));
        }
    }
    lines.push("  </file_modifications>".to_string());
    lines.push(String::new());

    let gs = &ctx.git_state;
    lines.push("  <git_state>".to_string());
    lines.push(format!("    <branch>{}</branch>", xml_escape(&gs.branch)));
    lines.push(format!(
        "    <staged_changes>{}</staged_changes>",
        gs.staged_changes
    ));
    lines.push(format!(
        "    <unstaged_changes>{}</unstaged_changes>",
        gs.unstaged_changes
    ));
    lines.push(format!(
        r#"    <last_commit hash="{}">{}</last_commit>"#,
        xml_escape(&gs.last_commit_hash),
        xml_escape(&gs.last_commit_message)
    ));
    lines.push(format!(
        r#"    <diff_stats insertions="{}" deletions="{}" files_changed="{}"/>"#,
        gs.diff_stats.insertions, gs.diff_stats.deletions, gs.diff_stats.files_changed
    ));
    lines.push("  </git_state>".to_string());
    lines.push(String::new());

    lines.push("  <key_decisions>".to_string());
    if ctx.key_decisions.is_empty() {
        lines.push("    <decision>No key decisions captured.</decision>".to_string());
    } else {
        for d in &ctx.key_decisions {
            lines.push(format!("    <decision>{}</decision>", xml_escape(d)));
        }
    }
    lines.push("  </key_decisions>".to_string());

    if let Some(intr) = &ctx.interruption {
        lines.push(String::new());
        lines.push(r#"  <interruption detected="true">"#.to_string());
        lines.push(format!(
            "    <operation>{}</operation>",
            xml_escape(&intr.operation)
        ));
        lines.push(format!("    <state>{}</state>", xml_escape(&intr.state)));
        lines.push(format!(
            "    <resumption_hint>{}</resumption_hint>",
            xml_escape(&intr.resumption_hint)
        ));
        lines.push("  </interruption>".to_string());
    }

    lines.push("</session_context>".to_string());
    lines.join("\n")
}

/// Collapse the `<file_modifications>` section to a count summary when the XML
/// budget is exceeded.
pub fn collapse_file_modification_section(xml: &str) -> String {
    let file_re = Regex::new(r#"<file path="[^"]+" action="([^"]+)">"#).unwrap();
    let matches: Vec<_> = file_re.captures_iter(xml).collect();
    if matches.is_empty() {
        return xml.to_string();
    }

    let mut created = 0usize;
    let mut modified = 0usize;
    let mut deleted = 0usize;
    let total = matches.len();

    for cap in &matches {
        match &cap[1] {
            "created" => created += 1,
            "modified" => modified += 1,
            "deleted" => deleted += 1,
            _ => {}
        }
    }

    let summary = format!(
        "  <file_modifications>\n    <file path=\"summary\" action=\"modified\">Collapsed {total} file entries (created={created}, modified={modified}, deleted={deleted}).</file>\n  </file_modifications>"
    );

    let section_re = Regex::new(r"  <file_modifications>[\s\S]*?  </file_modifications>").unwrap();
    section_re.replace(xml, summary.as_str()).into_owned()
}

/// Minify XML by stripping leading/trailing whitespace per line and removing blank lines.
pub fn minify_session_context_xml(xml: &str) -> String {
    xml.lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("")
}

// ---------------------------------------------------------------------------
// C4: ProgrammaticCompactor
// ---------------------------------------------------------------------------

/// Output of a structured compaction pass.
#[derive(Debug, Clone)]
pub struct ProgrammaticCompactionOutput {
    /// The spec 046 XML block summarising the compacted portion.
    pub session_context_block: String,
    /// Messages preserved verbatim (recent turns + system + pinned + active tool call).
    pub preserved_messages: Vec<CompactionMessage>,
    /// How many messages were compacted (not preserved).
    pub compacted_count: usize,
    /// Detected interruption, if any.
    pub interruption: Option<InterruptionInfo>,
}

/// Structured programmatic compactor — produces a spec 046 XML session-context block
/// from the compacted portion and preserves the most recent turns verbatim.
pub struct ProgrammaticCompactor {
    /// Number of recent user turns (and associated messages) to preserve.
    pub preserve_recent_turns: usize,
}

impl ProgrammaticCompactor {
    pub fn new(preserve_recent_turns: usize) -> Self {
        Self {
            preserve_recent_turns,
        }
    }

    /// Compact the message history.
    ///
    /// 1. Determine the preserve boundary: walk back to the Nth-from-last user message.
    /// 2. Preserve: all messages after that boundary, all system messages, all pinned
    ///    messages, and messages involved in the latest unresolved tool call.
    /// 3. Compacted: everything else.
    /// 4. Run extraction on the compacted set and build the XML block.
    pub fn compact(
        &self,
        messages: &[CompactionMessage],
        git: &GitSnapshot,
        compacted_at: &str,
    ) -> ProgrammaticCompactionOutput {
        let preserve_ids = collect_preserve_ids(messages, self.preserve_recent_turns);

        let preserved_messages: Vec<CompactionMessage> = messages
            .iter()
            .filter(|m| preserve_ids.contains(m.id.as_str()))
            .cloned()
            .collect();
        let compacted_messages: Vec<CompactionMessage> = messages
            .iter()
            .filter(|m| !preserve_ids.contains(m.id.as_str()))
            .cloned()
            .collect();

        let completed_steps = extract_steps(&compacted_messages, true);
        let pending_steps = extract_steps(&compacted_messages, false);
        let file_modifications = extract_file_modifications(&compacted_messages);
        let key_decisions = extract_key_decisions(&compacted_messages);
        let interruption = detect_interruption(messages, git, pending_steps.len());

        let token_count_original: usize = messages
            .iter()
            .map(|m| {
                m.usage
                    .as_ref()
                    .map(|u| u.input_tokens + u.output_tokens)
                    .unwrap_or(0)
            })
            .sum();

        let ctx = SessionContext {
            version: 1,
            compacted_at: compacted_at.to_string(),
            turn_count_original: messages.len(),
            token_count_original,
            task_summary: build_task_summary(messages, completed_steps.len(), pending_steps.len()),
            completed_steps,
            pending_steps,
            file_modifications,
            git_state: git.clone(),
            key_decisions,
            interruption: interruption.clone(),
        };

        let session_context_block = render_session_context_xml(&ctx);
        let compacted_count = compacted_messages.len();

        ProgrammaticCompactionOutput {
            session_context_block,
            preserved_messages,
            compacted_count,
            interruption,
        }
    }
}

// ---------------------------------------------------------------------------
// C5: TokenBudgetMonitor
// ---------------------------------------------------------------------------

/// Decision struct returned by `TokenBudgetMonitor::should_compact`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactionTriggerDecision {
    pub should_compact: bool,
    pub reason: String,
    pub usage_ratio: f64,
    pub threshold_ratio: f64,
    pub used_tokens: usize,
    pub context_window_tokens: usize,
}

/// Monitors token budget across turns and fires compaction when the threshold is reached.
#[derive(Debug, Clone)]
pub struct TokenBudgetMonitor {
    prompt_tokens: usize,
    completion_tokens: usize,
    threshold: f64,
}

impl Default for TokenBudgetMonitor {
    fn default() -> Self {
        Self::new(0.75)
    }
}

impl TokenBudgetMonitor {
    pub fn new(threshold: f64) -> Self {
        Self {
            prompt_tokens: 0,
            completion_tokens: 0,
            threshold,
        }
    }

    /// Accumulate token usage from a turn.
    pub fn report_usage(&mut self, prompt_tokens: usize, completion_tokens: usize) {
        self.prompt_tokens = self.prompt_tokens.saturating_add(prompt_tokens);
        self.completion_tokens = self.completion_tokens.saturating_add(completion_tokens);
    }

    /// Reset the counters (e.g., after a compaction pass).
    pub fn reset_to(&mut self, prompt_tokens: usize, completion_tokens: usize) {
        self.prompt_tokens = prompt_tokens;
        self.completion_tokens = completion_tokens;
    }

    /// Return `(prompt_tokens, completion_tokens)`.
    pub fn get_totals(&self) -> (usize, usize) {
        (self.prompt_tokens, self.completion_tokens)
    }

    /// Decide whether compaction should be triggered.
    pub fn should_compact(&self, context_window_tokens: usize) -> CompactionTriggerDecision {
        let safe_window = if context_window_tokens == 0 {
            0
        } else {
            context_window_tokens
        };
        let used = self.prompt_tokens + self.completion_tokens;
        let usage_ratio = if safe_window == 0 {
            0.0
        } else {
            used as f64 / safe_window as f64
        };
        let compact = usage_ratio >= self.threshold;
        let comparison = if compact { ">=" } else { "<" };
        let reason = format!(
            "usage ratio {:.4} {} threshold {:.4} ({}/{} tokens)",
            usage_ratio, comparison, self.threshold, used, safe_window
        );

        CompactionTriggerDecision {
            should_compact: compact,
            reason,
            usage_ratio,
            threshold_ratio: self.threshold,
            used_tokens: used,
            context_window_tokens: safe_window,
        }
    }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

fn compact_whitespace(s: &str) -> String {
    let re = Regex::new(r"\s+").unwrap();
    re.replace_all(s, " ").trim().to_string()
}

fn truncate_text(s: &str, max_chars: usize) -> String {
    let compacted = compact_whitespace(s);
    if compacted.len() <= max_chars {
        return compacted;
    }
    // Find a safe UTF-8 byte boundary.
    let mut end = max_chars.saturating_sub(1);
    while !compacted.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &compacted[..end])
}

fn infer_file_action(text: &str) -> FileAction {
    let lower = text.to_lowercase();
    if lower.contains("delete") || lower.contains("removed") || lower.contains("remove") {
        FileAction::Deleted
    } else if lower.contains("create")
        || lower.contains("created")
        || lower.contains(" add ")
        || lower.contains("added")
    {
        FileAction::Created
    } else {
        FileAction::Modified
    }
}

/// Dedup while preserving order, then truncate to `cap`.
fn dedup_stable(values: Vec<String>, cap: usize) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for v in values {
        if v.is_empty() || seen.contains(&v) {
            continue;
        }
        seen.insert(v.clone());
        out.push(v);
    }
    out.truncate(cap);
    out
}

/// Build the set of message IDs that must be preserved.
fn collect_preserve_ids(
    messages: &[CompactionMessage],
    preserve_recent_turns: usize,
) -> std::collections::HashSet<&str> {
    let mut ids: std::collections::HashSet<&str> = std::collections::HashSet::new();

    // 1. Recent turns: walk back to find the Nth-from-last user message.
    if preserve_recent_turns > 0 && !messages.is_empty() {
        let mut user_turns_seen = 0usize;
        let mut cutoff = messages.len();

        for (i, msg) in messages.iter().enumerate().rev() {
            if msg.role == "user" {
                user_turns_seen += 1;
                if user_turns_seen == preserve_recent_turns {
                    cutoff = i;
                    break;
                }
            }
        }

        if user_turns_seen < preserve_recent_turns {
            // Fewer user turns than requested — preserve everything.
            for msg in messages {
                ids.insert(msg.id.as_str());
            }
        } else {
            for msg in &messages[cutoff..] {
                ids.insert(msg.id.as_str());
            }
        }
    }

    // 2. System messages and pinned messages are always preserved.
    for msg in messages {
        if msg.role == "system" || msg.pinned {
            ids.insert(msg.id.as_str());
        }
    }

    // 3. Messages involved in the latest unresolved tool call.
    if let Some(tool_id) = find_latest_unresolved_tool_call_id(messages) {
        for msg in messages {
            let matches = msg.tool_call_id.as_deref() == Some(tool_id.as_str())
                || msg_contains_tool_use_id(msg, &tool_id)
                || msg_contains_tool_result_id(msg, &tool_id);
            if matches {
                ids.insert(msg.id.as_str());
            }
        }
    }

    ids
}

fn msg_contains_tool_use_id(msg: &CompactionMessage, tool_use_id: &str) -> bool {
    if let MessageContent::Blocks(blocks) = &msg.content {
        for block in blocks {
            if let ContentBlock::ToolUse { id: Some(id), .. } = block
                && id == tool_use_id
            {
                return true;
            }
        }
    }
    false
}

fn msg_contains_tool_result_id(msg: &CompactionMessage, tool_use_id: &str) -> bool {
    if msg.role == "tool" && msg.tool_call_id.as_deref() == Some(tool_use_id) {
        return true;
    }
    if let MessageContent::Blocks(blocks) = &msg.content {
        for block in blocks {
            if let ContentBlock::ToolResult {
                tool_use_id: Some(id),
                ..
            } = block
                && id == tool_use_id
            {
                return true;
            }
        }
    }
    false
}

// ---------------------------------------------------------------------------
// C7: Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn text_msg(id: &str, role: &str, content: &str) -> CompactionMessage {
        CompactionMessage {
            id: id.to_string(),
            role: role.to_string(),
            content: MessageContent::Text(content.to_string()),
            timestamp: None,
            pinned: false,
            usage: None,
            tool_name: None,
            tool_call_id: None,
        }
    }

    fn pinned_msg(id: &str, role: &str, content: &str) -> CompactionMessage {
        let mut m = text_msg(id, role, content);
        m.pinned = true;
        m
    }

    #[allow(dead_code)]
    fn msg_with_usage(
        id: &str,
        role: &str,
        content: &str,
        inp: usize,
        out: usize,
    ) -> CompactionMessage {
        let mut m = text_msg(id, role, content);
        m.usage = Some(TokenUsage {
            input_tokens: inp,
            output_tokens: out,
        });
        m
    }

    fn git_clean() -> GitSnapshot {
        GitSnapshot {
            branch: "main".to_string(),
            staged_changes: 0,
            unstaged_changes: 0,
            last_commit_hash: "abc123".to_string(),
            last_commit_message: "initial".to_string(),
            diff_stats: DiffStats {
                insertions: 0,
                deletions: 0,
                files_changed: 0,
            },
        }
    }

    fn git_dirty(staged: u32, unstaged: u32) -> GitSnapshot {
        let mut g = git_clean();
        g.staged_changes = staged;
        g.unstaged_changes = unstaged;
        g
    }

    // -----------------------------------------------------------------------
    // TokenBudgetMonitor
    // -----------------------------------------------------------------------

    #[test]
    fn token_budget_triggers_at_threshold() {
        let mut monitor = TokenBudgetMonitor::new(0.75);
        monitor.report_usage(160_000, 0);
        let decision = monitor.should_compact(200_000);
        assert!(
            decision.should_compact,
            "160k/200k = 0.80 >= 0.75, should compact"
        );
    }

    #[test]
    fn token_budget_below_threshold() {
        let mut monitor = TokenBudgetMonitor::new(0.75);
        monitor.report_usage(100_000, 0);
        let decision = monitor.should_compact(200_000);
        assert!(
            !decision.should_compact,
            "100k/200k = 0.50 < 0.75, should not compact"
        );
    }

    #[test]
    fn token_budget_default_threshold_is_0_75() {
        let monitor = TokenBudgetMonitor::default();
        assert_eq!(monitor.threshold, 0.75);
    }

    #[test]
    fn token_budget_reset_to_clears_accumulated() {
        let mut monitor = TokenBudgetMonitor::new(0.75);
        monitor.report_usage(100_000, 50_000);
        monitor.reset_to(10_000, 0);
        let (p, c) = monitor.get_totals();
        assert_eq!(p, 10_000);
        assert_eq!(c, 0);
    }

    // -----------------------------------------------------------------------
    // Interruption detection
    // -----------------------------------------------------------------------

    #[test]
    fn detect_interruption_requires_two_signals() {
        // Only one signal: uncommitted changes — should NOT trigger.
        let messages = vec![text_msg("u1", "user", "do something")];
        let result = detect_interruption(&messages, &git_dirty(2, 0), 0);
        assert!(
            result.is_none(),
            "single signal should not trigger interruption"
        );

        // Two signals: uncommitted changes + pending steps — should trigger.
        let result2 = detect_interruption(&messages, &git_dirty(2, 0), 3);
        assert!(result2.is_some(), "two signals should trigger interruption");
    }

    #[test]
    fn detect_interruption_returns_none_for_clean_state() {
        let messages = vec![
            text_msg("u1", "user", "hello"),
            text_msg("a1", "assistant", "done"),
        ];
        let result = detect_interruption(&messages, &git_clean(), 0);
        assert!(result.is_none());
    }

    // -----------------------------------------------------------------------
    // find_latest_unresolved_tool_call_id
    // -----------------------------------------------------------------------

    #[test]
    fn find_unresolved_tool_call() {
        let mut use_msg = text_msg("m1", "assistant", "");
        use_msg.content = MessageContent::Blocks(vec![ContentBlock::ToolUse {
            id: Some("call-42".to_string()),
            name: Some("bash".to_string()),
        }]);

        let messages = vec![use_msg];
        let id = find_latest_unresolved_tool_call_id(&messages);
        assert_eq!(id, Some("call-42".to_string()));
    }

    #[test]
    fn resolved_tool_call_returns_none() {
        let mut use_msg = text_msg("m1", "assistant", "");
        use_msg.content = MessageContent::Blocks(vec![ContentBlock::ToolUse {
            id: Some("call-99".to_string()),
            name: Some("bash".to_string()),
        }]);

        let mut result_msg = text_msg("m2", "tool", "output");
        result_msg.content = MessageContent::Blocks(vec![ContentBlock::ToolResult {
            tool_use_id: Some("call-99".to_string()),
            content: Some("output".to_string()),
        }]);

        let messages = vec![use_msg, result_msg];
        let id = find_latest_unresolved_tool_call_id(&messages);
        assert!(id.is_none(), "tool call with result should be resolved");
    }

    // -----------------------------------------------------------------------
    // Step extraction
    // -----------------------------------------------------------------------

    #[test]
    fn extract_completed_steps() {
        let messages = vec![text_msg(
            "m1",
            "assistant",
            "- [x] Write tests\n- [X] Update docs\n- [ ] Deploy",
        )];
        let steps = extract_steps(&messages, true);
        assert_eq!(steps, vec!["Write tests", "Update docs"]);
    }

    #[test]
    fn extract_pending_steps() {
        let messages = vec![text_msg(
            "m1",
            "assistant",
            "- [x] Done step\n- [ ] Pending one\n- [ ] Pending two",
        )];
        let steps = extract_steps(&messages, false);
        assert_eq!(steps, vec!["Pending one", "Pending two"]);
    }

    #[test]
    fn extract_steps_dedup() {
        let messages = vec![
            text_msg("m1", "assistant", "- [ ] Step A"),
            text_msg("m2", "assistant", "- [ ] Step A\n- [ ] Step B"),
        ];
        let steps = extract_steps(&messages, false);
        assert_eq!(steps, vec!["Step A", "Step B"]);
    }

    // -----------------------------------------------------------------------
    // Key decisions
    // -----------------------------------------------------------------------

    #[test]
    fn extract_key_decisions_finds_keywords() {
        let messages = vec![text_msg(
            "m1",
            "assistant",
            "decision: use Rust\nmust follow spec\nshould add tests\ndo not break API",
        )];
        let decisions = extract_key_decisions(&messages);
        assert!(
            decisions.iter().any(|d| d.starts_with("decision:")),
            "decision prefix"
        );
        assert!(
            decisions.iter().any(|d| d.starts_with("must")),
            "must prefix"
        );
    }

    // -----------------------------------------------------------------------
    // File modifications
    // -----------------------------------------------------------------------

    #[test]
    fn extract_file_modifications_dedup() {
        let messages = vec![
            text_msg("m1", "assistant", "Modified src/main.rs with changes."),
            text_msg("m2", "assistant", "Deleted src/main.rs from the project."),
        ];
        let mods = extract_file_modifications(&messages);
        let main_rs: Vec<_> = mods.iter().filter(|m| m.path == "src/main.rs").collect();
        // Last reference wins — should be "deleted"
        assert_eq!(main_rs.len(), 1);
        assert_eq!(main_rs[0].action, FileAction::Deleted);
    }

    // -----------------------------------------------------------------------
    // XML
    // -----------------------------------------------------------------------

    #[test]
    fn xml_escape_special_chars() {
        assert_eq!(xml_escape("&"), "&amp;");
        assert_eq!(xml_escape("<"), "&lt;");
        assert_eq!(xml_escape(">"), "&gt;");
        assert_eq!(xml_escape("\""), "&quot;");
        assert_eq!(xml_escape("'"), "&apos;");
        assert_eq!(
            xml_escape("a & b < c > d \"e\" 'f'"),
            "a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;"
        );
    }

    #[test]
    fn render_session_context_xml_golden() {
        let ctx = SessionContext {
            version: 1,
            compacted_at: "2026-04-05T12:00:00Z".to_string(),
            turn_count_original: 10,
            token_count_original: 5000,
            task_summary: "Build the feature.".to_string(),
            completed_steps: vec!["Step one".to_string()],
            pending_steps: vec!["Step two".to_string()],
            file_modifications: vec![FileModification {
                path: "src/lib.rs".to_string(),
                action: FileAction::Modified,
                description: "Updated API.".to_string(),
            }],
            git_state: GitSnapshot {
                branch: "main".to_string(),
                staged_changes: 1,
                unstaged_changes: 0,
                last_commit_hash: "abc12345".to_string(),
                last_commit_message: "feat: init".to_string(),
                diff_stats: DiffStats {
                    insertions: 10,
                    deletions: 2,
                    files_changed: 1,
                },
            },
            key_decisions: vec!["decision: use async".to_string()],
            interruption: None,
        };

        let xml = render_session_context_xml(&ctx);

        assert!(
            xml.starts_with("<session_context version=\"1\""),
            "root element"
        );
        assert!(
            xml.contains("compacted_at=\"2026-04-05T12:00:00Z\""),
            "timestamp"
        );
        assert!(xml.contains("turn_count_original=\"10\""), "turn count");
        assert!(xml.contains("<task_summary>"), "task summary element");
        assert!(xml.contains("Build the feature."), "task summary text");
        assert!(
            xml.contains("<step index=\"1\">Step one</step>"),
            "completed step"
        );
        assert!(
            xml.contains("<step index=\"1\">Step two</step>"),
            "pending step"
        );
        assert!(xml.contains("src/lib.rs"), "file path");
        assert!(xml.contains("action=\"modified\""), "file action");
        assert!(xml.contains("<branch>main</branch>"), "branch");
        assert!(
            xml.contains("<decision>decision: use async</decision>"),
            "decision"
        );
        assert!(xml.ends_with("</session_context>"), "closing tag");
        assert!(
            !xml.contains("<interruption"),
            "no interruption block when None"
        );
    }

    #[test]
    fn render_session_context_xml_with_interruption() {
        let ctx = SessionContext {
            version: 1,
            compacted_at: "2026-04-05T12:00:00Z".to_string(),
            turn_count_original: 5,
            token_count_original: 1000,
            task_summary: "task".to_string(),
            completed_steps: vec![],
            pending_steps: vec![],
            file_modifications: vec![],
            git_state: git_clean(),
            key_decisions: vec![],
            interruption: Some(InterruptionInfo {
                detected: true,
                operation: "op".to_string(),
                state: "st".to_string(),
                resumption_hint: "hint".to_string(),
            }),
        };
        let xml = render_session_context_xml(&ctx);
        assert!(
            xml.contains("<interruption detected=\"true\">"),
            "interruption block"
        );
        assert!(xml.contains("<operation>op</operation>"), "operation");
        assert!(
            xml.contains("<resumption_hint>hint</resumption_hint>"),
            "hint"
        );
    }

    // -----------------------------------------------------------------------
    // ProgrammaticCompactor
    // -----------------------------------------------------------------------

    #[test]
    fn programmatic_compactor_preserves_recent() {
        let messages: Vec<CompactionMessage> = (0..10)
            .map(|i| {
                let role = if i % 2 == 0 { "user" } else { "assistant" };
                text_msg(&format!("m{i}"), role, &format!("content {i}"))
            })
            .collect();

        let compactor = ProgrammaticCompactor::new(2);
        let output = compactor.compact(&messages, &git_clean(), "2026-04-05T12:00:00Z");

        // With preserve_recent_turns=2 and messages alternating user/assistant,
        // we should preserve the last 2 user turns and everything after them.
        let preserved_ids: std::collections::HashSet<&str> = output
            .preserved_messages
            .iter()
            .map(|m| m.id.as_str())
            .collect();

        // The last 2 user messages are m8 (index 8) and m6 (index 6).
        // Everything from m6 onward should be preserved: m6, m7, m8, m9.
        assert!(
            preserved_ids.contains("m6"),
            "m6 (2nd-from-last user turn) preserved"
        );
        assert!(preserved_ids.contains("m7"), "m7 preserved");
        assert!(
            preserved_ids.contains("m8"),
            "m8 (last user turn) preserved"
        );
        assert!(preserved_ids.contains("m9"), "m9 preserved");

        assert!(output.compacted_count > 0, "some messages compacted");
        assert!(!output.session_context_block.is_empty(), "XML produced");
    }

    #[test]
    fn programmatic_compactor_preserves_pinned() {
        let mut messages = vec![
            pinned_msg("pinned1", "assistant", "This is important"),
            text_msg("m2", "user", "message 2"),
            text_msg("m3", "assistant", "response 2"),
            text_msg("m4", "user", "message 3"),
            text_msg("m5", "assistant", "response 3"),
        ];
        // Ensure pinned1 is old enough to be outside the recent window.
        messages[0].pinned = true;

        let compactor = ProgrammaticCompactor::new(1);
        let output = compactor.compact(&messages, &git_clean(), "2026-04-05T12:00:00Z");

        let preserved_ids: std::collections::HashSet<&str> = output
            .preserved_messages
            .iter()
            .map(|m| m.id.as_str())
            .collect();

        assert!(
            preserved_ids.contains("pinned1"),
            "pinned message must never be compacted"
        );
    }

    // -----------------------------------------------------------------------
    // Minification
    // -----------------------------------------------------------------------

    #[test]
    fn minify_xml_strips_whitespace() {
        let xml = "  <root>\n    <child>value</child>\n  </root>\n";
        let minified = minify_session_context_xml(xml);
        assert_eq!(minified, "<root><child>value</child></root>");
    }

    // -----------------------------------------------------------------------
    // collapse_file_modification_section
    // -----------------------------------------------------------------------

    #[test]
    fn collapse_file_modification_section_summarises() {
        let ctx = SessionContext {
            version: 1,
            compacted_at: "2026-04-05T12:00:00Z".to_string(),
            turn_count_original: 5,
            token_count_original: 0,
            task_summary: "t".to_string(),
            completed_steps: vec![],
            pending_steps: vec![],
            file_modifications: vec![
                FileModification {
                    path: "a.rs".to_string(),
                    action: FileAction::Created,
                    description: "d".to_string(),
                },
                FileModification {
                    path: "b.rs".to_string(),
                    action: FileAction::Modified,
                    description: "d".to_string(),
                },
            ],
            git_state: git_clean(),
            key_decisions: vec![],
            interruption: None,
        };
        let xml = render_session_context_xml(&ctx);
        let collapsed = collapse_file_modification_section(&xml);
        assert!(
            collapsed.contains("Collapsed 2 file entries"),
            "collapse summary present"
        );
        assert!(
            !collapsed.contains("<file path=\"a.rs\""),
            "individual file entries removed"
        );
    }
}
