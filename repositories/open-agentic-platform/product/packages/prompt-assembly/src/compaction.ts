// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature: 070-prompt-assembly-cache

import type {
  CompactionOptions,
  CompactionResult,
  Message,
} from "./types.js";

const DEFAULT_WINDOW_THRESHOLD = 0.8;
const DEFAULT_KEEP_RECENT = 10;

/**
 * Default summarizer: concatenates message content with role prefixes.
 * In production this would call a model for true summarization.
 */
function defaultSummarizer(messages: readonly Message[]): string {
  const lines = messages.map(
    (m) => `[${m.role}]: ${m.content.slice(0, 200)}`,
  );
  return `[Compacted ${messages.length} messages]\n${lines.join("\n")}`;
}

/**
 * Estimate byte size of a message array.
 */
function estimateMessageBytes(messages: readonly Message[]): number {
  const encoder = new TextEncoder();
  let total = 0;
  for (const m of messages) {
    total += encoder.encode(m.role).length + encoder.encode(m.content).length;
  }
  return total;
}

/**
 * CompactionService monitors conversation context size and triggers
 * summarization when approaching the model's context window limit.
 *
 * FR-006: Compaction fires at 80% context window usage.
 * SC-004: Reduces message history to summary + recent messages.
 * R-002: Keeps last K messages uncompacted (default: 10).
 * R-003: Model context window is parameterized, not hardcoded.
 */
export class CompactionService {
  private readonly windowThreshold: number;
  private readonly keepRecent: number;
  private readonly summarizer: (messages: readonly Message[]) => string;

  constructor(options: CompactionOptions = {}) {
    this.windowThreshold = options.windowThreshold ?? DEFAULT_WINDOW_THRESHOLD;
    this.keepRecent = options.keepRecent ?? DEFAULT_KEEP_RECENT;
    this.summarizer = options.summarizer ?? defaultSummarizer;
  }

  /**
   * Determine whether compaction should be triggered.
   *
   * Returns true when (promptSize + messageSize) >= threshold * modelContextWindow.
   */
  shouldCompact(
    promptSizeBytes: number,
    messages: readonly Message[],
    modelContextWindow: number,
  ): boolean {
    const messageBytes = estimateMessageBytes(messages);
    const totalBytes = promptSizeBytes + messageBytes;
    const thresholdBytes = modelContextWindow * this.windowThreshold;
    return totalBytes >= thresholdBytes;
  }

  /**
   * Compact the message history by summarizing older messages and
   * keeping the most recent ones intact.
   *
   * If there are fewer messages than keepRecent, no compaction occurs
   * (returns all messages as kept, empty summary).
   */
  compact(messages: readonly Message[]): CompactionResult {
    if (messages.length <= this.keepRecent) {
      return {
        summary: "",
        keptMessages: messages,
        compactedCount: 0,
        bytesSaved: 0,
      };
    }

    const splitIndex = messages.length - this.keepRecent;
    const toCompact = messages.slice(0, splitIndex);
    const toKeep = messages.slice(splitIndex);

    const originalBytes = estimateMessageBytes(toCompact);
    const summary = this.summarizer(toCompact);
    const summaryBytes = new TextEncoder().encode(summary).length;
    const bytesSaved = Math.max(0, originalBytes - summaryBytes);

    return {
      summary,
      keptMessages: toKeep,
      compactedCount: toCompact.length,
      bytesSaved,
    };
  }
}
