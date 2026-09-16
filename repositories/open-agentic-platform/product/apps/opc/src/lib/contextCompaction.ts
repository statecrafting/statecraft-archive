export const DEFAULT_COMPACTION_THRESHOLD = 0.75;
export const DEFAULT_PRESERVE_RECENT_TURNS = 4;
/** Default when model metadata does not specify a window (Claude 3.5 class). */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
export const MIN_COMPACTION_THRESHOLD = 0.5;
export const MAX_COMPACTION_THRESHOLD = 0.95;

export interface ContextCompactionConfigInput {
  compaction?: {
    threshold?: number | string;
    preserve_recent_turns?: number;
  };
}

export interface ContextCompactionConfig {
  threshold: number;
  preserveRecentTurns: number;
}

export type CompactionMessageRole = "system" | "user" | "assistant" | "tool";

export interface CompactionMessageUsage {
  input_tokens?: number;
  output_tokens?: number;
}

export interface CompactionContentTextBlock {
  type: "text";
  text: string;
}

export interface CompactionContentToolUseBlock {
  type: "tool_use";
  id?: string;
  name?: string;
  input?: unknown;
}

export interface CompactionContentToolResultBlock {
  type: "tool_result";
  tool_use_id?: string;
  content?: string;
}

export type CompactionContentBlock =
  | CompactionContentTextBlock
  | CompactionContentToolUseBlock
  | CompactionContentToolResultBlock;

export interface CompactionMessage {
  id: string;
  role: CompactionMessageRole;
  content: string | CompactionContentBlock[];
  timestamp?: string;
  pinned?: boolean;
  usage?: CompactionMessageUsage;
  tool_name?: string;
  tool_call_id?: string;
  meta?: Record<string, unknown>;
}

export interface CompactionHistory {
  messages: CompactionMessage[];
}

export interface TokenBudgetUsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface SessionHistoryRewriteInput {
  rawMessages: unknown[];
  config: ContextCompactionConfig;
  contextWindowTokens: number;
  gitSnapshot: GitSnapshot;
  compactedAt?: Date;
}

export interface SessionHistoryRewriteResult {
  rewrittenMessages: unknown[];
  compacted: boolean;
  trigger: CompactionTriggerDecision;
}

/**
 * Resolves context window size from UI model id (`sonnet` / `opus`) or API-style ids.
 * Extend the map when new models ship different windows.
 */
export function getContextWindowTokensForModel(model?: string): number {
  if (!model || model.trim() === "") return DEFAULT_CONTEXT_WINDOW_TOKENS;
  const m = model.toLowerCase().trim();
  if (m.includes("1m") || m.includes("1-m") || m.includes("1000000")) {
    return 1_000_000;
  }
  if (m.includes("opus") || m.includes("sonnet") || m.includes("haiku")) {
    return DEFAULT_CONTEXT_WINDOW_TOKENS;
  }
  return DEFAULT_CONTEXT_WINDOW_TOKENS;
}

/**
 * Loads git snapshot via Tauri (`git_status`, `git diff` stats, `git_current_branch`, `git_last_commit`).
 * On failure or non-Tauri environments, returns a conservative placeholder (matches prior dummy behavior).
 */
export async function fetchGitSnapshotFromRepo(repoPath: string): Promise<GitSnapshot> {
  const trimmed = repoPath.trim();

  const fallback = (detail: string): GitSnapshot => ({
    branch: "unknown",
    stagedChanges: 0,
    unstagedChanges: 0,
    lastCommitHash: "unknown",
    lastCommitMessage: detail ? `session at ${trimmed} (${detail})` : `session at ${trimmed}`,
    diffStats: {
      insertions: 0,
      deletions: 0,
      filesChanged: 0,
    },
  });

  if (!trimmed) return fallback("empty path");

  try {
    const { commands } = await import("./bindings");
    const statusRes = await commands.gitStatus(trimmed);
    if (statusRes.status === "error") {
      return fallback(statusRes.error.type ?? "git_status");
    }

    let stagedChanges = 0;
    let unstagedChanges = 0;
    for (const entry of statusRes.data) {
      if (entry.staged) stagedChanges += 1;
      else unstagedChanges += 1;
    }

    const diffRes = await commands.gitDiff(trimmed, null, null);
    const diffStats =
      diffRes.status === "ok"
        ? {
            insertions: diffRes.data.insertions,
            deletions: diffRes.data.deletions,
            filesChanged: diffRes.data.files_changed,
          }
        : { insertions: 0, deletions: 0, filesChanged: 0 };

    let branch = "unknown";
    const branchRes = await commands.gitCurrentBranch(trimmed);
    if (branchRes.status === "ok") {
      branch = branchRes.data;
    } else if (branchRes.error.type === "DetachedHead") {
      branch = "detached";
    }

    const commitRes = await commands.gitLastCommit(trimmed);
    const lastCommitHash =
      commitRes.status === "ok" ? commitRes.data.hash.slice(0, 12) : "unknown";
    const lastCommitMessage =
      commitRes.status === "ok" ? commitRes.data.message : "(no commit)";

    return {
      branch,
      stagedChanges,
      unstagedChanges,
      lastCommitHash,
      lastCommitMessage,
      diffStats,
    };
  } catch {
    return fallback("unavailable");
  }
}

export interface CompactionTriggerDecision {
  shouldCompact: boolean;
  reason: string;
  usageRatio: number;
  thresholdRatio: number;
  usedTokens: number;
  contextWindowTokens: number;
}

export interface GitSnapshot {
  branch: string;
  stagedChanges: number;
  unstagedChanges: number;
  lastCommitHash: string;
  lastCommitMessage: string;
  diffStats: {
    insertions: number;
    deletions: number;
    filesChanged: number;
  };
}

export interface InterruptionSummary {
  operation: string;
  state: string;
  resumptionHint: string;
}

export interface ProgrammaticCompactionOutput {
  sessionContextBlock: string;
  preservedMessages: CompactionMessage[];
  compactedMessages: CompactionMessage[];
  interruption: InterruptionSummary | null;
}

interface InterruptionSignals {
  unresolvedToolCallId: string | null;
  uncommittedChanges: boolean;
  asksQuestion: boolean;
  explicitNextStep: boolean;
  hasIncompletePlan: boolean;
}

export class TokenBudgetMonitor {
  private promptTokens = 0;
  private completionTokens = 0;
  private readonly threshold: number;

  constructor(config: ContextCompactionConfig) {
    this.threshold = config.threshold;
  }

  reportUsage(promptTokens: number, completionTokens: number): void {
    this.promptTokens += sanitizeTokenDelta(promptTokens);
    this.completionTokens += sanitizeTokenDelta(completionTokens);
  }

  resetTo(promptTokens: number, completionTokens = 0): void {
    this.promptTokens = sanitizeTokenDelta(promptTokens);
    this.completionTokens = sanitizeTokenDelta(completionTokens);
  }

  getTotals(): TokenBudgetUsageTotals {
    const totalTokens = this.promptTokens + this.completionTokens;
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens,
    };
  }

  shouldCompact(contextWindowTokens: number): CompactionTriggerDecision {
    const safeContextWindow = sanitizeContextWindow(contextWindowTokens);
    const totals = this.getTotals();
    const usageRatio =
      safeContextWindow === 0 ? 0 : totals.totalTokens / safeContextWindow;
    const shouldCompact = usageRatio >= this.threshold;
    const comparison = shouldCompact ? ">=" : "<";
    const reason = `usage ratio ${usageRatio.toFixed(4)} ${comparison} threshold ${this.threshold.toFixed(4)} (${totals.totalTokens}/${safeContextWindow} tokens)`;

    return {
      shouldCompact,
      reason,
      usageRatio,
      thresholdRatio: this.threshold,
      usedTokens: totals.totalTokens,
      contextWindowTokens: safeContextWindow,
    };
  }
}

export class ProgrammaticCompactor {
  private readonly preserveRecentTurns: number;

  constructor(config: ContextCompactionConfig) {
    this.preserveRecentTurns = config.preserveRecentTurns;
  }

  compact(
    history: CompactionHistory,
    gitSnapshot: GitSnapshot,
    compactedAt: Date = new Date(),
  ): ProgrammaticCompactionOutput {
    const messages = history.messages;
    const preserveIds = new Set(
      collectRecentTurnMessageIds(messages, this.preserveRecentTurns),
    );

    for (const message of messages) {
      if (message.role === "system") preserveIds.add(message.id);
      if (message.pinned) preserveIds.add(message.id);
    }

    const activeToolCallId = findLatestUnresolvedToolCallId(messages);
    if (activeToolCallId) {
      for (const message of messages) {
        if (
          message.tool_call_id === activeToolCallId ||
          messageContainsToolUseId(message, activeToolCallId) ||
          messageContainsToolResultId(message, activeToolCallId)
        ) {
          preserveIds.add(message.id);
        }
      }
    }

    const preservedMessages = messages.filter((message) => preserveIds.has(message.id));
    const compactedMessages = messages.filter((message) => !preserveIds.has(message.id));

    const completedSteps = extractSteps(compactedMessages, "completed");
    const pendingSteps = extractSteps(compactedMessages, "pending");
    const fileModifications = extractFileModifications(compactedMessages);
    const keyDecisions = extractKeyDecisions(compactedMessages);
    const interruption = detectInterruption(messages, gitSnapshot, pendingSteps.length);

    const sessionContextBlock = buildSessionContextXml({
      compactedAt,
      originalTurnCount: messages.length,
      originalTokenCount: countTokensFromUsage(messages),
      taskSummary: buildTaskSummary(messages, completedSteps.length, pendingSteps.length),
      completedSteps,
      pendingSteps,
      fileModifications,
      gitSnapshot,
      keyDecisions,
      interruption,
    });

    return {
      sessionContextBlock,
      preservedMessages,
      compactedMessages,
      interruption,
    };
  }
}

export function rewriteSessionHistoryForCompaction(
  input: SessionHistoryRewriteInput,
): SessionHistoryRewriteResult {
  const normalized = normalizeRuntimeMessages(input.rawMessages);
  const monitor = new TokenBudgetMonitor(input.config);
  for (const message of normalized) {
    const usage = message.usage;
    if (usage) {
      monitor.reportUsage(usage.input_tokens ?? 0, usage.output_tokens ?? 0);
      continue;
    }
    monitor.reportUsage(estimateMessageTokens(message), 0);
  }

  const trigger = monitor.shouldCompact(input.contextWindowTokens);
  if (!trigger.shouldCompact) {
    return {
      rewrittenMessages: elevateSessionContextForInit(input.rawMessages),
      compacted: false,
      trigger,
    };
  }

  const compactor = new ProgrammaticCompactor(input.config);
  const compactedAt = input.compactedAt ?? new Date();
  const output = compactor.compact(
    { messages: normalized },
    input.gitSnapshot,
    compactedAt,
  );

  let sessionContext = output.sessionContextBlock;
  let rewritten = composeCompactedHistory(input.rawMessages, output.preservedMessages, sessionContext);

  const maxCompactedTokens = Math.floor(input.contextWindowTokens * 0.4);
  if (estimateRuntimeHistoryTokens(rewritten) > maxCompactedTokens) {
    sessionContext = collapseFileModificationSection(sessionContext);
    rewritten = composeCompactedHistory(input.rawMessages, output.preservedMessages, sessionContext);
  }
  if (estimateRuntimeHistoryTokens(rewritten) > maxCompactedTokens) {
    sessionContext = minifySessionContextXml(sessionContext);
    rewritten = composeCompactedHistory(input.rawMessages, output.preservedMessages, sessionContext);
  }

  monitor.resetTo(Math.min(estimateRuntimeHistoryTokens(rewritten), maxCompactedTokens));

  return {
    rewrittenMessages: elevateSessionContextForInit(rewritten),
    compacted: true,
    trigger,
  };
}

export function elevateSessionContextForInit(rawMessages: unknown[]): unknown[] {
  const entries = rawMessages.filter((value): value is Record<string, unknown> => isRecord(value));
  if (entries.length === 0) return rawMessages;

  const contextIndex = entries.findIndex((entry) => {
    const text = normalizeUnknownMessageText(entry);
    return text.includes("<session_context");
  });
  if (contextIndex < 0) return rawMessages;

  const systemIndex = entries.findIndex((entry) => inferRuntimeRole(entry) === "system");
  const targetIndex = systemIndex >= 0 ? systemIndex + 1 : 0;
  if (contextIndex === targetIndex) {
    return addInterruptionInitHint(entries);
  }

  const reordered = [...entries];
  const [contextEntry] = reordered.splice(contextIndex, 1);
  reordered.splice(targetIndex, 0, contextEntry);
  return addInterruptionInitHint(reordered);
}

export function readCompactionThresholdFromEnv(
  env = safeProcessEnv(),
): number | undefined {
  const raw = env["OAP_COMPACTION_THRESHOLD"];
  if (raw === undefined || raw === "") return undefined;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return isValidCompactionThreshold(parsed) ? parsed : undefined;
}

export function resolveContextCompactionConfig(
  input?: ContextCompactionConfigInput,
  env = safeProcessEnv(),
): ContextCompactionConfig {
  const envThreshold = readCompactionThresholdFromEnv(env);
  const configThreshold = parseMaybeNumber(input?.compaction?.threshold);

  const threshold = chooseFirstValidThreshold([
    envThreshold,
    configThreshold,
    DEFAULT_COMPACTION_THRESHOLD,
  ]);

  const preserveRecentTurns = sanitizePreserveRecentTurns(
    input?.compaction?.preserve_recent_turns,
  );

  return { threshold, preserveRecentTurns };
}

export function stableSerializeHistory(history: CompactionHistory): string {
  const normalized = history.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content:
      typeof message.content === "string"
        ? message.content
        : message.content.map((block) => stableSortRecord(block as unknown as Record<string, unknown>)),
    timestamp: message.timestamp ?? null,
    pinned: message.pinned ?? false,
    usage: message.usage
      ? {
          input_tokens: message.usage.input_tokens ?? null,
          output_tokens: message.usage.output_tokens ?? null,
        }
      : null,
    tool_name: message.tool_name ?? null,
    tool_call_id: message.tool_call_id ?? null,
    meta: stableSortRecord(message.meta),
  }));

  return JSON.stringify({ messages: normalized });
}

function safeProcessEnv(): Record<string, string | undefined> {
  if (typeof process === "undefined" || !process.env) return {};
  return process.env;
}

function normalizeRuntimeMessages(rawMessages: unknown[]): CompactionMessage[] {
  const output: CompactionMessage[] = [];
  let recordIndex = 0;
  for (let index = 0; index < rawMessages.length; index += 1) {
    const raw = rawMessages[index];
    if (!isRecord(raw)) continue;
    output.push({
      id: resolveRuntimeMessageId(raw, recordIndex),
      role: inferRuntimeRole(raw),
      content: extractRuntimeCompactionContent(raw),
      timestamp: asString(raw["timestamp"]),
      pinned: resolvePinned(raw),
      usage: extractRuntimeUsage(raw),
      tool_name: asString(raw["tool_name"]),
      tool_call_id: asString(raw["tool_call_id"]),
      meta: undefined,
    });
    recordIndex += 1;
  }
  return output;
}

function resolveRuntimeMessageId(raw: Record<string, unknown>, index: number): string {
  const existing = asString(raw["id"]);
  if (existing) return existing;
  const key = stableSortRecord(raw);
  return `runtime-${index}-${stableHash(JSON.stringify(key))}`;
}

function resolvePinned(raw: Record<string, unknown>): boolean {
  if (raw["pinned"] === true) return true;
  return containsPinAnnotation(normalizeUnknownMessageText(raw));
}

function containsPinAnnotation(text: string): boolean {
  return /<!--\s*pin\s*-->/.test(text);
}

function inferRuntimeRole(raw: Record<string, unknown>): CompactionMessageRole {
  const role = asString(raw["role"]);
  if (role === "system" || role === "assistant" || role === "user" || role === "tool") return role;
  const entryType = asString(raw["type"]);
  if (entryType === "system") return "system";
  if (entryType === "assistant") return "assistant";
  if (entryType === "user") return "user";
  if (entryType === "tool") return "tool";
  return "assistant";
}

function extractRuntimeCompactionContent(raw: Record<string, unknown>): string | CompactionContentBlock[] {
  const message = isRecord(raw["message"]) ? raw["message"] : null;
  const directContent = raw["content"];
  const messageContent = message?.["content"];
  const candidate = messageContent ?? directContent;

  if (!Array.isArray(candidate)) {
    if (typeof candidate === "string") return candidate;
    return normalizeUnknownMessageText(raw);
  }

  const blocks: CompactionContentBlock[] = [];
  for (const item of candidate) {
    if (!isRecord(item)) continue;
    const type = asString(item["type"]);
    if (type === "text") {
      blocks.push({
        type: "text",
        text: asString(item["text"]) ?? "",
      });
      continue;
    }
    if (type === "tool_use") {
      blocks.push({
        type: "tool_use",
        id: asString(item["id"]),
        name: asString(item["name"]),
        input: item["input"],
      });
      continue;
    }
    if (type === "tool_result") {
      blocks.push({
        type: "tool_result",
        tool_use_id: asString(item["tool_use_id"]),
        content: normalizeUnknown(item["content"]),
      });
    }
  }

  return blocks.length > 0 ? blocks : normalizeUnknownMessageText(raw);
}

function extractRuntimeUsage(raw: Record<string, unknown>): CompactionMessageUsage | undefined {
  const directUsage = isRecord(raw["usage"]) ? raw["usage"] : null;
  const messageUsage =
    isRecord(raw["message"]) && isRecord((raw["message"] as Record<string, unknown>)["usage"])
      ? ((raw["message"] as Record<string, unknown>)["usage"] as Record<string, unknown>)
      : null;
  const usage = directUsage ?? messageUsage;
  if (!usage) return undefined;
  return {
    input_tokens: asNumber(usage["input_tokens"]) ?? 0,
    output_tokens: asNumber(usage["output_tokens"]) ?? 0,
  };
}

function composeCompactedHistory(
  rawMessages: unknown[],
  preservedMessages: CompactionMessage[],
  sessionContext: string,
): unknown[] {
  const preservedIds = new Set(preservedMessages.map((m) => m.id));
  const normalizedEntries = rawMessages.filter((value): value is Record<string, unknown> => isRecord(value));
  const preservedRaw = normalizedEntries
    .filter((entry, index) => preservedIds.has(resolveRuntimeMessageId(entry, index)))
    .map((entry) => sanitizeRuntimeEntryForRewrite(entry));
  const contextEntry = createSessionContextRuntimeEntry(sessionContext);
  const systemIndex = preservedRaw.findIndex((entry) => inferRuntimeRole(entry) === "system");
  if (systemIndex >= 0) {
    const output = [...preservedRaw];
    output.splice(systemIndex + 1, 0, contextEntry);
    return output;
  }
  return [contextEntry, ...preservedRaw];
}

function sanitizeRuntimeEntryForRewrite(entry: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = {
    ...entry,
  };
  delete clone["usage"];
  if (isRecord(clone["message"])) {
    const message = { ...(clone["message"] as Record<string, unknown>) };
    delete message["usage"];
    clone["message"] = message;
  }
  return clone;
}

function createSessionContextRuntimeEntry(sessionContext: string): Record<string, unknown> {
  return {
    id: `session-context-${stableHash(sessionContext).slice(0, 12)}`,
    type: "system",
    subtype: "session_context",
    timestamp: new Date().toISOString(),
    pinned: true,
    message: {
      content: [
        {
          type: "text",
          text: sessionContext,
        },
      ],
    },
  };
}

function collapseFileModificationSection(sessionContext: string): string {
  const fileMatches = [...sessionContext.matchAll(/<file path="[^"]+" action="([^"]+)">/g)];
  if (fileMatches.length === 0) return sessionContext;
  const counts = { created: 0, modified: 0, deleted: 0 };
  for (const match of fileMatches) {
    const action = match[1];
    if (action === "created") counts.created += 1;
    if (action === "modified") counts.modified += 1;
    if (action === "deleted") counts.deleted += 1;
  }
  const summary = [
    "  <file_modifications>",
    `    <file path="summary" action="modified">Collapsed ${fileMatches.length} file entries (created=${counts.created}, modified=${counts.modified}, deleted=${counts.deleted}).</file>`,
    "  </file_modifications>",
  ].join("\n");
  return sessionContext.replace(
    /  <file_modifications>[\s\S]*?  <\/file_modifications>/,
    summary,
  );
}

function minifySessionContextXml(sessionContext: string): string {
  return sessionContext
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("");
}

function estimateRuntimeHistoryTokens(messages: unknown[]): number {
  return messages.reduce<number>((total, message) => {
    if (!isRecord(message)) return total;
    const usage = extractRuntimeUsage(message);
    if (usage) {
      return total + sanitizeTokenDelta(usage.input_tokens ?? 0) + sanitizeTokenDelta(usage.output_tokens ?? 0);
    }
    return total + estimateTextTokens(normalizeUnknownMessageText(message));
  }, 0);
}

function estimateMessageTokens(message: CompactionMessage): number {
  const usage = message.usage;
  if (usage) return sanitizeTokenDelta(usage.input_tokens ?? 0) + sanitizeTokenDelta(usage.output_tokens ?? 0);
  return estimateTextTokens(normalizeMessageContent(message.content));
}

function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function normalizeUnknownMessageText(raw: Record<string, unknown>): string {
  const message = isRecord(raw["message"]) ? raw["message"] : null;
  const messageContent = message?.["content"];
  if (typeof messageContent === "string") return messageContent;
  if (Array.isArray(messageContent)) return normalizeUnknown(messageContent);
  if (typeof raw["content"] === "string") return raw["content"] as string;
  if (Array.isArray(raw["content"])) return normalizeUnknown(raw["content"]);
  if (typeof raw["result"] === "string") return raw["result"] as string;
  return normalizeUnknown(raw);
}

function addInterruptionInitHint(messages: Record<string, unknown>[]): Record<string, unknown>[] {
  const hasContext = messages.some((entry) => normalizeUnknownMessageText(entry).includes("<session_context"));
  if (!hasContext) return messages;
  const contextEntry = messages.find((entry) => normalizeUnknownMessageText(entry).includes("<session_context"));
  const hasInterruption =
    contextEntry !== undefined &&
    normalizeUnknownMessageText(contextEntry).includes("<interruption detected=\"true\">");
  const hintText = hasInterruption
    ? "A compacted session context is available. Prioritize interruption resumption first."
    : "A compacted session context is available. Review it before proceeding.";
  const existingHint = messages.some((entry) => normalizeUnknownMessageText(entry) === hintText);
  if (existingHint) return messages;

  const systemIndex = messages.findIndex((entry) => inferRuntimeRole(entry) === "system");
  const hintEntry = {
    id: `session-context-hint-${stableHash(hintText).slice(0, 12)}`,
    type: "system",
    subtype: "context_hint",
    timestamp: new Date().toISOString(),
    message: {
      content: [
        {
          type: "text",
          text: hintText,
        },
      ],
    },
  };
  if (systemIndex >= 0) {
    const output = [...messages];
    output.splice(systemIndex + 1, 0, hintEntry);
    return output;
  }
  return [hintEntry, ...messages];
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => normalizeUnknown(item)).join("\n");
  if (isRecord(value)) {
    if (typeof value["text"] === "string") return value["text"] as string;
    return JSON.stringify(value);
  }
  if (value === null || value === undefined) return "";
  return String(value);
}

function parseMaybeNumber(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  if (value.trim() === "") return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function chooseFirstValidThreshold(
  values: Array<number | undefined>,
): number {
  for (const value of values) {
    if (value !== undefined && isValidCompactionThreshold(value)) {
      return value;
    }
  }
  return DEFAULT_COMPACTION_THRESHOLD;
}

function isValidCompactionThreshold(value: number): boolean {
  return value >= MIN_COMPACTION_THRESHOLD && value <= MAX_COMPACTION_THRESHOLD;
}

function sanitizePreserveRecentTurns(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_PRESERVE_RECENT_TURNS;
  }
  const rounded = Math.floor(value);
  return rounded >= 1 ? rounded : DEFAULT_PRESERVE_RECENT_TURNS;
}

function stableSortRecord(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  const keys = Object.keys(value).sort();
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    output[key] = value[key];
  }
  return output;
}

function sanitizeTokenDelta(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function sanitizeContextWindow(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

interface SessionContextXmlInput {
  compactedAt: Date;
  originalTurnCount: number;
  originalTokenCount: number;
  taskSummary: string;
  completedSteps: string[];
  pendingSteps: string[];
  fileModifications: Array<{
    path: string;
    action: "created" | "modified" | "deleted";
    description: string;
  }>;
  gitSnapshot: GitSnapshot;
  keyDecisions: string[];
  interruption: InterruptionSummary | null;
}

function buildSessionContextXml(input: SessionContextXmlInput): string {
  const lines: string[] = [];
  lines.push(
    `<session_context version="1" compacted_at="${input.compactedAt.toISOString()}" turn_count_original="${input.originalTurnCount}" token_count_original="${input.originalTokenCount}">`,
  );
  lines.push("  <task_summary>");
  lines.push(`    ${xmlEscape(input.taskSummary)}`);
  lines.push("  </task_summary>");
  lines.push("");
  lines.push("  <completed_steps>");
  if (input.completedSteps.length === 0) {
    lines.push('    <step index="1">No completed steps captured yet.</step>');
  } else {
    input.completedSteps.forEach((step, index) => {
      lines.push(`    <step index="${index + 1}">${xmlEscape(step)}</step>`);
    });
  }
  lines.push("  </completed_steps>");
  lines.push("");
  lines.push("  <pending_steps>");
  if (input.pendingSteps.length === 0) {
    lines.push('    <step index="1">No pending steps captured.</step>');
  } else {
    input.pendingSteps.forEach((step, index) => {
      lines.push(`    <step index="${index + 1}">${xmlEscape(step)}</step>`);
    });
  }
  lines.push("  </pending_steps>");
  lines.push("");
  lines.push("  <file_modifications>");
  if (input.fileModifications.length === 0) {
    lines.push('    <file path="none" action="modified">No file modifications detected.</file>');
  } else {
    input.fileModifications.forEach((entry) => {
      lines.push(
        `    <file path="${xmlEscape(entry.path)}" action="${entry.action}">${xmlEscape(entry.description)}</file>`,
      );
    });
  }
  lines.push("  </file_modifications>");
  lines.push("");
  lines.push("  <git_state>");
  lines.push(`    <branch>${xmlEscape(input.gitSnapshot.branch)}</branch>`);
  lines.push(`    <staged_changes>${input.gitSnapshot.stagedChanges}</staged_changes>`);
  lines.push(`    <unstaged_changes>${input.gitSnapshot.unstagedChanges}</unstaged_changes>`);
  lines.push(
    `    <last_commit hash="${xmlEscape(input.gitSnapshot.lastCommitHash)}">${xmlEscape(input.gitSnapshot.lastCommitMessage)}</last_commit>`,
  );
  lines.push(
    `    <diff_stats insertions="${input.gitSnapshot.diffStats.insertions}" deletions="${input.gitSnapshot.diffStats.deletions}" files_changed="${input.gitSnapshot.diffStats.filesChanged}"/>`,
  );
  lines.push("  </git_state>");
  lines.push("");
  lines.push("  <key_decisions>");
  if (input.keyDecisions.length === 0) {
    lines.push("    <decision>No key decisions captured.</decision>");
  } else {
    input.keyDecisions.forEach((decision) => {
      lines.push(`    <decision>${xmlEscape(decision)}</decision>`);
    });
  }
  lines.push("  </key_decisions>");
  if (input.interruption) {
    lines.push("");
    lines.push('  <interruption detected="true">');
    lines.push(`    <operation>${xmlEscape(input.interruption.operation)}</operation>`);
    lines.push(`    <state>${xmlEscape(input.interruption.state)}</state>`);
    lines.push(`    <resumption_hint>${xmlEscape(input.interruption.resumptionHint)}</resumption_hint>`);
    lines.push("  </interruption>");
  }
  lines.push("</session_context>");
  return lines.join("\n");
}

function countTokensFromUsage(messages: CompactionMessage[]): number {
  return messages.reduce((total, message) => {
    const input = message.usage?.input_tokens ?? 0;
    const output = message.usage?.output_tokens ?? 0;
    return total + sanitizeTokenDelta(input) + sanitizeTokenDelta(output);
  }, 0);
}

function buildTaskSummary(messages: CompactionMessage[], completed: number, pending: number): string {
  const firstUser = messages.find((message) => message.role === "user");
  const goal = truncateText(normalizeMessageContent(firstUser?.content), 180) || "Continue current task.";
  return `${goal} Completed ${completed} step(s); ${pending} pending/in-progress.`;
}

function extractSteps(
  messages: CompactionMessage[],
  kind: "completed" | "pending",
): string[] {
  const out: string[] = [];
  const patterns =
    kind === "completed"
      ? [/^\s*[-*]\s*\[(x|X)\]\s+(.+)$/gm, /^\s*\d+\.\s*\[(x|X)\]\s+(.+)$/gm]
      : [/^\s*[-*]\s*\[\s*\]\s+(.+)$/gm, /^\s*\d+\.\s*\[\s*\]\s+(.+)$/gm];
  for (const message of messages) {
    const text = normalizeMessageContent(message.content);
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      match = pattern.exec(text);
      while (match) {
        const value = kind === "completed" ? match[2] : match[1];
        if (value) out.push(compactWhitespace(value));
        match = pattern.exec(text);
      }
    }
  }
  return dedupeStable(out).slice(0, 12);
}

function extractFileModifications(messages: CompactionMessage[]): Array<{
  path: string;
  action: "created" | "modified" | "deleted";
  description: string;
}> {
  const paths: Array<{
    path: string;
    action: "created" | "modified" | "deleted";
    description: string;
  }> = [];
  for (const message of messages) {
    const text = normalizeMessageContent(message.content);
    const matches = text.matchAll(/\b([A-Za-z0-9_.\/-]+\.(ts|tsx|js|jsx|rs|md|json|yaml|yml|toml))\b/g);
    for (const match of matches) {
      const path = match[1];
      const action = inferFileAction(text);
      paths.push({
        path,
        action,
        description: `Referenced during ${action} workflow.`,
      });
    }
  }
  const deduped = new Map<string, { path: string; action: "created" | "modified" | "deleted"; description: string }>();
  for (const pathEntry of paths) {
    deduped.set(pathEntry.path, pathEntry);
  }
  return Array.from(deduped.values()).sort((a, b) => a.path.localeCompare(b.path)).slice(0, 20);
}

function inferFileAction(text: string): "created" | "modified" | "deleted" {
  const lower = text.toLowerCase();
  if (/\b(delete|removed|remove)\b/.test(lower)) return "deleted";
  if (/\b(create|created|add|added)\b/.test(lower)) return "created";
  return "modified";
}

function extractKeyDecisions(messages: CompactionMessage[]): string[] {
  const values: string[] = [];
  for (const message of messages) {
    const text = normalizeMessageContent(message.content);
    const lines = text.split("\n");
    for (const line of lines) {
      const normalized = line.trim();
      if (/^(decision|constraint|must|should|do not)\b/i.test(normalized)) {
        values.push(compactWhitespace(normalized));
      }
    }
  }
  return dedupeStable(values).slice(0, 10);
}

function detectInterruption(
  messages: CompactionMessage[],
  gitSnapshot: GitSnapshot,
  pendingStepsCount: number,
): InterruptionSummary | null {
  const signals = collectInterruptionSignals(messages, gitSnapshot, pendingStepsCount);
  const activeSignalCount = countActiveInterruptionSignals(signals);

  if (activeSignalCount < 2) {
    return null;
  }

  const { unresolvedToolCallId, uncommittedChanges, asksQuestion, explicitNextStep } = signals;
  const lastAssistant = findLastByRole(messages, "assistant");
  const lastAssistantText = normalizeMessageContent(lastAssistant?.content).trim();

  if (unresolvedToolCallId) {
    return {
      operation: `Tool operation ${unresolvedToolCallId}`,
      state: "Tool call has no corresponding tool result.",
      resumptionHint: "Resume by collecting or replaying the missing tool result.",
    };
  }

  if (uncommittedChanges) {
    return {
      operation: "Pending git worktree changes",
      state: `${gitSnapshot.stagedChanges} staged and ${gitSnapshot.unstagedChanges} unstaged changes detected.`,
      resumptionHint: "Review current diff and complete or commit the in-progress edits.",
    };
  }

  if (asksQuestion || explicitNextStep) {
    return {
      operation: "Assistant requested next action",
      state: truncateText(lastAssistantText, 220),
      resumptionHint: "Answer the pending question or execute the proposed next step.",
    };
  }

  return {
    operation: "Incomplete multi-step plan",
    state: `${pendingStepsCount} step(s) still pending/in-progress.`,
    resumptionHint: "Continue remaining pending steps before starting new work.",
  };
}

function findLatestUnresolvedToolCallId(messages: CompactionMessage[]): string | null {
  const seenResults = new Set<string>();
  for (const message of messages) {
    if (message.role === "tool" && message.tool_call_id) {
      seenResults.add(message.tool_call_id);
    }
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          seenResults.add(block.tool_use_id);
        }
      }
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.tool_call_id && !seenResults.has(message.tool_call_id)) {
      return message.tool_call_id;
    }
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "tool_use" && block.id && !seenResults.has(block.id)) {
          return block.id;
        }
      }
    }
  }
  return null;
}

function collectRecentTurnMessageIds(
  messages: CompactionMessage[],
  preserveRecentTurns: number,
): string[] {
  if (preserveRecentTurns <= 0 || messages.length === 0) return [];
  let userTurnsSeen = 0;
  let cutoffIndex = messages.length;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== "user") continue;
    userTurnsSeen += 1;
    if (userTurnsSeen === preserveRecentTurns) {
      cutoffIndex = index;
      break;
    }
  }

  if (userTurnsSeen < preserveRecentTurns) {
    return messages.map((message) => message.id);
  }

  return messages.slice(cutoffIndex).map((message) => message.id);
}

function messageContainsToolUseId(message: CompactionMessage, toolUseId: string): boolean {
  if (!Array.isArray(message.content)) return false;
  for (const block of message.content) {
    if (block.type === "tool_use" && block.id === toolUseId) return true;
  }
  return false;
}

function messageContainsToolResultId(message: CompactionMessage, toolUseId: string): boolean {
  if (message.tool_call_id === toolUseId && message.role === "tool") return true;
  if (!Array.isArray(message.content)) return false;
  for (const block of message.content) {
    if (block.type === "tool_result" && block.tool_use_id === toolUseId) return true;
  }
  return false;
}

function collectInterruptionSignals(
  messages: CompactionMessage[],
  gitSnapshot: GitSnapshot,
  pendingStepsCount: number,
): InterruptionSignals {
  const unresolvedToolCallId = findLatestUnresolvedToolCallId(messages);
  const uncommittedChanges = gitSnapshot.stagedChanges + gitSnapshot.unstagedChanges > 0;
  const lastAssistant = findLastByRole(messages, "assistant");
  const lastAssistantText = normalizeMessageContent(lastAssistant?.content).trim();
  const asksQuestion = /\?\s*$/.test(lastAssistantText);
  const explicitNextStep = /\bnext step\b/i.test(lastAssistantText);
  const hasIncompletePlan = pendingStepsCount > 0;

  return {
    unresolvedToolCallId,
    uncommittedChanges,
    asksQuestion,
    explicitNextStep,
    hasIncompletePlan,
  };
}

function countActiveInterruptionSignals(signals: InterruptionSignals): number {
  let count = 0;
  if (signals.unresolvedToolCallId) count += 1;
  if (signals.uncommittedChanges) count += 1;
  if (signals.asksQuestion || signals.explicitNextStep) count += 1;
  if (signals.hasIncompletePlan) count += 1;
  return count;
}

function findLastByRole(
  messages: CompactionMessage[],
  role: CompactionMessageRole,
): CompactionMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === role) return messages[index];
  }
  return undefined;
}

function normalizeMessageContent(content: CompactionMessage["content"] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text") {
      parts.push(block.text);
    } else if (block.type === "tool_use") {
      parts.push(`tool_use:${block.name ?? "unknown"}:${block.id ?? "unknown"}`);
    } else if (block.type === "tool_result") {
      parts.push(block.content ?? "");
    }
  }
  return parts.join("\n");
}

function truncateText(value: string, maxChars: number): string {
  const compacted = compactWhitespace(value);
  if (compacted.length <= maxChars) return compacted;
  return `${compacted.slice(0, Math.max(0, maxChars - 1))}…`;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dedupeStable(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
